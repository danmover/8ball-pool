import QRCode from 'qrcode';
import type {
  AimInput,
  GameState,
  RoomStateDTO,
  Seat,
  ShootInput,
  SimEvent,
  TrajectoryPreview,
} from '@8ball/shared';
import {
  CUE_BALL_ID,
  computeTrajectoryPreview,
  legalTargetBallIds,
  levelProgress,
  resolveLoadout,
  seatIndex,
  xpForResult,
} from '@8ball/shared';
import { playerBannerHtml } from '../render/banner';
import { PotCelebrator } from '../render/potCelebration';
import { equippedLoadout, getProfile, grantXp, recordStats } from '../profile/profile';
import { openWheel } from '../profile/wheel';
import { getSocket } from '../net/socket';
import { loadSession, loadSettings, saveSettings } from '../settings/settingsStore';
import { TableRenderer, powerToCssColor } from '../render/TableRenderer';
import { powerTierLabel } from '../render/powerTier';
import { ballChipHtml, placeholderChipHtml } from '../render/ballChip';
import { AimController } from '../controller/aimController';
import { openSettingsPanel } from '../settings/settingsPanel';
import { renderLobby } from './lobbyView';
import * as sfx from '../render/sfx';
import { navigate } from '../router';

const SOLID_IDS = [1, 2, 3, 4, 5, 6, 7];
const STRIPE_IDS = [9, 10, 11, 12, 13, 14, 15];

export function renderHostPage(root: HTMLElement, code: string): () => void {
  const socket = getSocket();
  const settings = loadSettings();
  let ownedSeat: Seat | null = null;
  let renderer: TableRenderer | null = null;
  let aimController: AimController | null = null;
  let lastState: GameState | null = null;
  let lastRoom: RoomStateDTO | null = null;
  let placing = false;
  let lastAimAngle: number | null = null;
  let booted = false;
  let qrDataUrl = '';
  let celebrator: PotCelebrator | null = null;
  /** Consecutive scoring turns per seat — drives the ON FIRE banner state. */
  const streaks: Record<Seat, number> = {};
  let shotSeat: Seat | null = null;
  let lastPotPos: { x: number; y: number } | null = null;
  let rewardsShown = false;
  let winCelebrated = false;

  const joinUrl = `${window.location.origin}/play/${code}`;

  root.innerHTML = `
    <div id="tableCanvas" style="position:absolute; inset:0; display:none"></div>
    <div class="hud" id="gameHud" style="display:none">
      <div class="top-bar">
        <div id="playerPanels" style="display:flex; gap:0.5rem; flex-wrap:wrap; flex:1"></div>
        <button class="icon-btn" id="settingsBtn">⚙</button>
      </div>
      <div></div>
      <div id="bottomArea"></div>
    </div>
    <div class="host-power-wrap" id="hostPowerWrap" style="display:none">
      <div class="power-hud" id="powerHud">
        <div class="power-value" id="powerValue">0%</div>
        <div class="power-tier" id="powerTier">DRAG TO AIM</div>
      </div>
    </div>
    <div id="lobbyWrap"></div>
  `;

  const canvasEl = root.querySelector<HTMLElement>('#tableCanvas')!;
  const gameHud = root.querySelector<HTMLElement>('#gameHud')!;
  const panelsEl = root.querySelector<HTMLElement>('#playerPanels')!;
  const bottomArea = root.querySelector<HTMLElement>('#bottomArea')!;
  const lobbyWrap = root.querySelector<HTMLElement>('#lobbyWrap')!;
  const hostPowerWrap = root.querySelector<HTMLElement>('#hostPowerWrap')!;
  const powerValue = root.querySelector<HTMLElement>('#powerValue')!;
  const powerTier = root.querySelector<HTMLElement>('#powerTier')!;
  const powerHud = root.querySelector<HTMLElement>('#powerHud')!;

  function setPowerHud(power: number): void {
    const pct = Math.round(power * 100);
    const color = powerToCssColor(power);
    powerValue.textContent = `${pct}%`;
    powerValue.style.color = color;
    powerTier.textContent = powerTierLabel(power);
    powerHud.classList.toggle('charged', power > 0.02);
    powerHud.style.setProperty('--power-scale', String(1 + power * 0.18));
  }

  root.querySelector('#settingsBtn')!.addEventListener('click', () => {
    openSettingsPanel(settings, (s) => {
      Object.assign(settings, s);
      saveSettings(settings);
      renderer?.setColorblindPatterns(settings.colorblindPatterns);
      renderer?.setFeltTheme(settings.feltTheme);
      renderer?.setEffectsIntensity(settings.effectsIntensity);
      if (lastAimAngle !== null) renderPreview(lastAimAngle);
    });
  });

  function showFatalError(message: string): void {
    root.innerHTML = `
      <div class="overlay-center">
        <div>
          <p style="font-size:1.1rem; margin-bottom:1rem;">${message}</p>
          <button id="goHome">Back to home</button>
        </div>
      </div>`;
    root.querySelector('#goHome')!.addEventListener('click', () => navigate('/'));
  }

  const hostSession = loadSession(code, 'host');
  if (!hostSession) {
    showFatalError("This table wasn't created from this device, so it can't be hosted here.");
    return () => {};
  }

  void QRCode.toDataURL(joinUrl, { margin: 1, width: 176, color: { dark: '#0a0c11' } }).then((url) => {
    qrDataUrl = url;
    if (lastRoom && !lastRoom.started) drawLobby(lastRoom);
  });

  socket.emit('hostRejoin', { code, token: hostSession.token }, (res) => {
    if (!res.ok) showFatalError('This table has expired.');
  });

  function drawLobby(room: RoomStateDTO): void {
    renderLobby(lobbyWrap, room, qrDataUrl, joinUrl.replace(/^https?:\/\//, ''), {
      onModeChange: (mode) => socket.emit('hostUpdateLobby', { mode }),
      onSizeChange: (maxPlayers) => socket.emit('hostUpdateLobby', { maxPlayers }),
      onClaimSeat: (seat) =>
        socket.emit('hostClaimSeat', {
          seat,
          loadout: equippedLoadout(),
          name: getProfile().displayName,
        }),
      onReleaseSeat: (seat) => socket.emit('hostReleaseSeat', { seat }),
      onStart: () => socket.emit('hostStartGame'),
    });
  }

  async function boot(): Promise<void> {
    if (booted) return;
    booted = true;

    canvasEl.style.display = '';
    gameHud.style.display = '';
    lobbyWrap.style.display = 'none';

    renderer = await TableRenderer.create(canvasEl);
    renderer.setColorblindPatterns(settings.colorblindPatterns);
    renderer.setFeltTheme(settings.feltTheme);
    renderer.setEffectsIntensity(settings.effectsIntensity);
    // The balls are shared table furniture, so they wear the host's set.
    renderer.setBallSet(equippedLoadout().ballSet);
    document.body.classList.toggle('fx-low', settings.effectsIntensity === 'low');
    celebrator = new PotCelebrator(root, () => renderer, settings);
    if (lastState) renderer.updateBalls(lastState.balls);

    aimController = new AimController(canvasEl, {
      onAimChange: (angle, power) => {
        if (!ownedSeat || !lastState) return;
        lastAimAngle = angle;
        renderer?.setAimVisual(angle, power, true);
        setPowerHud(power);
        socket.emit('updateAim', { seat: ownedSeat, angle, spin: { x: 0, y: 0 } });
        renderPreview(angle);
      },
      onShoot: (angle, power) => {
        if (!ownedSeat) return;
        setPowerHud(0);
        socket.emit('takeShot', { seat: ownedSeat, angle, power, spin: { x: 0, y: 0 } });
      },
    });
    aimController.setEnabled(false);

    canvasEl.addEventListener('pointerdown', onPlacementPointer);
    canvasEl.addEventListener('pointermove', onPlacementPointer);
    canvasEl.addEventListener('pointerup', onPlacementRelease);

    if (lastState) applyState(lastState);
  }

  function onPlacementPointer(e: PointerEvent): void {
    if (!placing || !renderer) return;
    renderer.setPlacementGhost(renderer.screenToTable(e.clientX, e.clientY));
  }

  function onPlacementRelease(e: PointerEvent): void {
    if (!placing || !renderer || !ownedSeat) return;
    socket.emit('placeCueBall', { seat: ownedSeat, pos: renderer.screenToTable(e.clientX, e.clientY) });
  }

  function groupBadge(state: GameState, seat: Seat): string {
    const info = state.players[seat];
    if (state.mode === 'rotation') {
      return `<span class="score-pill">${info.score} pts</span>`;
    }
    if (!info.group) return `<span class="group-badge">OPEN TABLE</span>`;
    const label = info.group === 'solid' ? 'SOLIDS' : 'STRIPES';
    return `<span class="group-badge ${info.group}"><i class="swatch-dot"></i>${label}</span>`;
  }

  function renderScoreboard(state: GameState): void {
    const many = state.seatOrder.length > 2;
    panelsEl.style.justifyContent = many ? 'center' : 'space-between';

    panelsEl.innerHTML = state.seatOrder
      .map((seat) => {
        const info = state.players[seat];
        const active = state.phase !== 'game_over' && state.currentShooter === seat;
        const name = info.connected ? info.name : 'Open seat';
        const teamTag =
          state.mode === 'teams' && info.team
            ? `<span class="seat-team team-${info.team}">TEAM ${info.team.toUpperCase()}</span>`
            : '';

        // Rotation mode has no per-player group, so show the score instead of a ball row.
        const ids = info.group === 'solid' ? SOLID_IDS : info.group === 'stripe' ? STRIPE_IDS : null;
        const ballRow =
          state.mode === 'rotation'
            ? ''
            : `<div class="ball-row">${
                ids
                  ? ids
                      .map((id) => ballChipHtml(id, state.balls.find((b) => b.id === id)?.pocketed ?? false))
                      .join('')
                  : Array.from({ length: 7 }, () => placeholderChipHtml()).join('')
              }</div>`;

        return playerBannerHtml({
          name,
          seatIndex: seatIndex(seat),
          loadout: info.loadout,
          striped: info.group === 'stripe',
          active,
          muted: !info.connected,
          // Two scoring turns back to back and you're hot.
          onFire: (streaks[seat] ?? 0) >= 2 && state.phase !== 'game_over',
          extra: `<div style="display:flex; gap:0.35rem; align-items:center">${groupBadge(
            state,
            seat
          )}${teamTag}</div>${ballRow}`,
        });
      })
      .join('');
  }

  function renderBottomArea(state: GameState): void {
    bottomArea.innerHTML = '';
    if (state.phase === 'ball_in_hand') {
      const banner = document.createElement('div');
      banner.className = 'turn-banner';
      banner.style.cssText = 'position:static; margin:0 auto; width:fit-content';
      banner.textContent =
        ownedSeat === state.currentShooter
          ? 'Ball in hand — tap the table to place the cue ball'
          : `${state.players[state.currentShooter].name} is placing the cue ball`;
      bottomArea.appendChild(banner);
    }

    if (state.phase === 'game_over') {
      if (root.querySelector('#gameOverOverlay')) return;
      const overlay = document.createElement('div');
      overlay.id = 'gameOverOverlay';
      overlay.className = 'overlay-center';
      const winnerName = state.winner ? state.players[state.winner].name : null;
      const headline =
        state.mode === 'teams' && state.winningTeam
          ? `Team ${state.winningTeam.toUpperCase()} wins!`
          : winnerName
            ? `${winnerName} wins!`
            : 'Game over';
      const scores =
        state.mode === 'rotation'
          ? `<p style="color:var(--muted); font-size:0.9rem">${state.seatOrder
              .map((s) => `${state.players[s].name}: ${state.players[s].score}`)
              .join(' &nbsp;·&nbsp; ')}</p>`
          : '';
      overlay.innerHTML = `
        <div>
          <h2>${headline}</h2>
          ${scores}
          ${state.lastFoulReason ? `<p style="color:var(--muted)">${state.lastFoulReason}</p>` : ''}
          <div id="rewardSlot"></div>
          <button id="rematchBtn">Rematch</button>
        </div>`;
      root.appendChild(overlay);
      renderRewards(state, overlay.querySelector<HTMLElement>('#rewardSlot')!);
      overlay.querySelector('#rematchBtn')!.addEventListener('click', () => {
        socket.emit('requestRematch');
        rewardsShown = false;
        for (const seat of Object.keys(streaks)) streaks[seat] = 0;
        overlay.remove();
      });
    }
  }

  /**
   * Post-match rewards for the seats this device actually played. XP is awarded once per
   * game (guarded by `rewardsShown`) so a re-render of the overlay can't double-pay.
   */
  function renderRewards(state: GameState, slot: HTMLElement): void {
    const mySeats = state.seatOrder.filter((s) => state.players[s].isHost);
    if (mySeats.length === 0) return;

    const iWon = mySeats.some((s) =>
      state.mode === 'teams' && state.winningTeam
        ? state.players[s].team === state.winningTeam
        : state.winner === s
    );

    let award = { xp: 0, spinsGained: 0, levelsGained: 0, levelAfter: getProfile().level };
    if (!rewardsShown) {
      rewardsShown = true;
      award = grantXp(xpForResult(iWon));
      recordStats({ games: 1, wins: iWon ? 1 : 0 });
      if (award.levelsGained > 0 && settings.soundEnabled) sfx.playLevelUp(settings.soundVolume);
    }

    const profile = getProfile();
    const progress = levelProgress(profile.xp);
    slot.innerHTML = `
      <div class="reward-panel">
        <div class="reward-line"><span>${iWon ? 'Win bonus' : 'Match played'}</span><b>+${
          award.xp
        } XP</b></div>
        ${award.levelsGained > 0 ? `<div class="level-up">LEVEL ${award.levelAfter}!</div>` : ''}
        <div class="xp-bar">
          <div class="xp-fill" style="width:${Math.round(progress.ratio * 100)}%"></div>
          <span class="xp-label">Level ${progress.level} · ${progress.into} / ${progress.span} XP</span>
        </div>
        <div class="reward-line"><span>Spins available</span><b>${profile.spins}</b></div>
        ${profile.spins > 0 ? '<button id="spinNow">SPIN THE WHEEL</button>' : ''}
      </div>`;

    slot.querySelector('#spinNow')?.addEventListener('click', () => {
      void openWheel(root).then(() => {
        // The new loadout should show on the table straight away.
        socket.emit('setLoadout', { loadout: equippedLoadout() });
        renderer?.setBallSet(equippedLoadout().ballSet);
        renderRewards(state, slot);
      });
    });
  }

  function renderPreview(angle: number): void {
    if (!renderer || !lastState || settings.trajectoryPreview === 'off') {
      renderer?.setAimPreview(CUE_BALL_ID, null);
      return;
    }
    const preview: TrajectoryPreview = computeTrajectoryPreview(
      lastState.balls,
      CUE_BALL_ID,
      angle,
      settings.trajectoryPreview
    );
    renderer.setAimPreview(CUE_BALL_ID, preview);
  }

  function applyState(state: GameState): void {
    // If the host has claimed several seats (hotseat on one screen), always control
    // whichever of them is actually up — not just the first claimed.
    const hostSeats = state.seatOrder.filter((s) => state.players[s].isHost);
    ownedSeat = hostSeats.find((s) => s === state.currentShooter) ?? hostSeats[0] ?? null;

    // Cue and trail belong to whoever is shooting, so they swap on every turn change.
    renderer?.setShooterLoadout(state.players[state.currentShooter]?.loadout);
    renderer?.setStreakFire((streaks[state.currentShooter] ?? 0) >= 2);

    renderer?.updateBalls(state.balls);
    renderer?.setLegalTargets(legalTargetBallIds(state));
    renderScoreboard(state);
    renderBottomArea(state);

    const canAim =
      ownedSeat !== null &&
      state.currentShooter === ownedSeat &&
      (state.phase === 'aiming' || state.phase === 'break');
    aimController?.setEnabled(canAim);
    hostPowerWrap.style.display = canAim ? '' : 'none';
    if (!canAim) setPowerHud(0);

    // The win only resolves after the shot settles, so the takeover fires here rather than
    // on the pot event itself.
    if (state.phase === 'game_over' && !winCelebrated) {
      winCelebrated = true;
      celebrator?.celebrateWin(lastPotPos);
    } else if (state.phase !== 'game_over') {
      winCelebrated = false;
    }

    placing = ownedSeat !== null && state.phase === 'ball_in_hand' && state.currentShooter === ownedSeat;
    if (!placing) renderer?.setPlacementGhost(null);

    if (state.phase === 'shot_in_progress') {
      renderer?.setAimVisual(0, 0, false);
      renderer?.setAimPreview(CUE_BALL_ID, null);
      lastAimAngle = null;
    }
  }

  socket.on('roomState', (rs) => {
    lastRoom = rs;
    if (rs.started) void boot();
    else drawLobby(rs);
  });

  socket.on('gameState', (state) => {
    lastState = state;
    if (booted) applyState(state);
  });

  socket.on('aimUpdate', (input: AimInput) => {
    if (input.seat === ownedSeat) return; // local drag already renders instantly
    renderer?.setAimVisual(input.angle, 0.3, true);
    lastAimAngle = input.angle;
    renderPreview(input.angle);
  });

  socket.on('shotFired', (input: ShootInput) => {
    shotSeat = input.seat;
    lastPotPos = null;
    if (settings.soundEnabled) sfx.playCueStrike(settings.soundVolume, 0.6);
    const cuePos = lastState?.balls.find((b) => b.id === CUE_BALL_ID)?.pos;
    if (cuePos) renderer?.spawnChalkPuff(cuePos, input.angle);
    renderer?.setAimVisual(0, 0, false);
    renderer?.setAimPreview(CUE_BALL_ID, null);
  });

  socket.on('simEvent', (ev: SimEvent) => {
    if (ev.type === 'ballCollision') {
      if (settings.soundEnabled) sfx.playBallClick(settings.soundVolume, ev.impulse / 1500);
      renderer?.spawnSparks(ev.pos, ev.impulse, ev.a, ev.b);
    } else if (ev.type === 'cushion') {
      if (settings.soundEnabled) sfx.playCushionThud(settings.soundVolume);
      renderer?.spawnCushionDust(ev.pos, ev.speed);
    } else if (ev.type === 'pot') {
      lastPotPos = ev.pos;
      // The celebrator owns the pot flash, combo callouts, sound and XP toasts.
      celebrator?.onPot(ev.pos, ev.ballId);
    } else if (ev.type === 'shotSettled') {
      onShotSettled();
    }
  });

  /**
   * End of a shot: bank the streak for whoever took it, and award XP for any seat this
   * device is actually playing (a phone player's XP is banked on their own phone).
   */
  function onShotSettled(): void {
    const summary = celebrator?.onShotSettled();
    if (!summary || !shotSeat) return;

    streaks[shotSeat] = summary.pots > 0 ? (streaks[shotSeat] ?? 0) + 1 : 0;

    const shooterIsOurs = lastState?.players[shotSeat]?.isHost ?? false;
    if (shooterIsOurs && summary.pots > 0) {
      grantXp(summary.xp);
      recordStats({ pots: summary.pots, bestCombo: summary.bestCombo });
    }

    if (lastState) applyState(lastState);
    shotSeat = null;
  }

  socket.on('errorMessage', (msg) => {
    const toast = document.createElement('div');
    toast.className = 'turn-banner';
    toast.style.background = 'rgba(180,40,40,0.85)';
    toast.textContent = msg;
    root.appendChild(toast);
    setTimeout(() => toast.remove(), 2200);
  });

  return () => {
    socket.off('roomState');
    socket.off('gameState');
    socket.off('aimUpdate');
    socket.off('shotFired');
    socket.off('simEvent');
    socket.off('errorMessage');
    aimController?.destroy();
    renderer?.destroy();
  };
}
