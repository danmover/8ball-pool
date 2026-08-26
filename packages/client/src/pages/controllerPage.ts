import type { AimInput, GameState, Seat, ShootInput, SimEvent, TrajectoryPreview } from '@8ball/shared';
import {
  CUE_BALL_ID,
  EMOTES,
  EMOTE_COOLDOWN_MS,
  computeTrajectoryPreview,
  legalTargetBallIds,
  levelProgress,
  xpForResult,
} from '@8ball/shared';
import { PotCelebrator } from '../render/potCelebration';
import { equippedLoadout, getProfile, grantXp, recordStats, setDisplayName } from '../profile/profile';
import { openWheel } from '../profile/wheel';
import { getSocket } from '../net/socket';
import { loadSession, loadSettings, saveSettings, saveSession } from '../settings/settingsStore';
import { TableRenderer, powerToCssColor } from '../render/TableRenderer';
import { powerTierLabel } from '../render/powerTier';
import { ballChipHtml, placeholderChipHtml } from '../render/ballChip';
import { AimController } from '../controller/aimController';
import { createSpinPad } from '../controller/spinPad';
import { createElevationDial } from '../controller/elevationDial';
import { openSettingsPanel } from '../settings/settingsPanel';
import { applyRenderSettings } from '../settings/applySettings';
import { icon } from '../render/icons';
import { confirmLeave, showToast } from '../render/dialogs';
import * as sfx from '../render/sfx';
import { navigate } from '../router';

export function renderControllerPage(root: HTMLElement, code: string): () => void {
  const socket = getSocket();
  const settings = loadSettings();
  const existing = loadSession(code, 'player');

  let seat: Seat | null = existing?.seat ?? null;
  let lastState: GameState | null = null;
  let renderer: TableRenderer | null = null;
  let aimController: AimController | null = null;
  let spinPad: ReturnType<typeof createSpinPad> | null = null;
  let elevationDial: ReturnType<typeof createElevationDial> | null = null;
  let placing = false;
  let lastAimAngle = 0;
  /** Latest drag power, so the cue-ball preview scales with how hard the shot will be. */
  let lastAimPower = 0.5;
  let turnBannerEl: HTMLElement | null = null;
  let ballRowEl: HTMLElement | null = null;
  let celebrator: PotCelebrator | null = null;
  let shotSeat: Seat | null = null;
  let streak = 0;
  let rewardsShown = false;

  const SOLID_IDS = [1, 2, 3, 4, 5, 6, 7];
  const STRIPE_IDS = [9, 10, 11, 12, 13, 14, 15];

  function showFatal(message: string): void {
    root.innerHTML = `
      <div class="overlay-center">
        <div>
          <p style="font-size:1.1rem; margin-bottom:1rem;">${message}</p>
          <button id="goHome">Back to home</button>
        </div>
      </div>`;
    root.querySelector('#goHome')!.addEventListener('click', () => navigate('/'));
  }

  function showNameEntry(errorMsg?: string): void {
    root.innerHTML = `
      <div class="landing">
        <h1>🎱 Join Table</h1>
        <div class="room-code">${code}</div>
        <div class="card">
          <input id="nameInput" placeholder="Your name" maxlength="20" autocomplete="off"
                 value="${getProfile().displayName.replace(/"/g, '&quot;')}" />
          <button id="joinBtn">Join Game</button>
          <button id="lockerBtn" class="secondary">🎡 Locker &amp; Wheel</button>
          <p id="joinError" class="error">${errorMsg ?? ''}</p>
        </div>
      </div>`;
    const nameInput = root.querySelector<HTMLInputElement>('#nameInput')!;
    const joinBtn = root.querySelector<HTMLButtonElement>('#joinBtn')!;
    const joinError = root.querySelector<HTMLElement>('#joinError')!;

    root.querySelector('#lockerBtn')!.addEventListener('click', () => navigate('/profile'));

    joinBtn.addEventListener('click', () => {
      sfx.unlockAudio();
      const name = nameInput.value.trim() || 'Player';
      setDisplayName(name);
      socket.emit('joinRoom', { code, name, loadout: equippedLoadout() }, (res) => {
        if (!res.ok) {
          joinError.textContent = res.error;
          return;
        }
        seat = res.seat;
        saveSession(code, 'player', { token: res.token, seat: res.seat });
        void boot();
      });
    });
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') joinBtn.click();
    });
  }

  function attemptEntry(): void {
    if (!existing) {
      showNameEntry();
      return;
    }
    socket.emit('joinRoom', { code, name: '', token: existing.token, loadout: equippedLoadout() }, (res) => {
      if (!res.ok) {
        showNameEntry(res.error);
        return;
      }
      seat = res.seat;
      void boot();
    });
  }

  function onPlacementPointer(e: PointerEvent): void {
    if (!placing || !renderer) return;
    renderer.setPlacementGhost(renderer.screenToTable(e.clientX, e.clientY));
  }

  function onPlacementRelease(e: PointerEvent): void {
    if (!placing || !renderer || !seat) return;
    socket.emit('placeCueBall', { seat, pos: renderer.screenToTable(e.clientX, e.clientY) });
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
      settings.trajectoryPreview,
      spinPad?.getValue() ?? { x: 0, y: 0 },
      lastAimPower,
      elevationDial?.getValue() ?? 0
    );
    renderer.setAimPreview(CUE_BALL_ID, preview);
  }

  function applyState(state: GameState): void {
    lastState = state;
    renderer?.updateBalls(state.balls);
    renderer?.setLegalTargets(legalTargetBallIds(state));

    const myTurn = seat !== null && state.currentShooter === seat;
    const canAim = myTurn && (state.phase === 'aiming' || state.phase === 'break');
    aimController?.setEnabled(canAim);
    placing = myTurn && state.phase === 'ball_in_hand';
    if (!placing) renderer?.setPlacementGhost(null);

    if (state.phase === 'shot_in_progress') {
      renderer?.setAimVisual(0, 0, false);
      renderer?.setAimPreview(CUE_BALL_ID, null);
    }

    if (turnBannerEl) {
      if (state.phase === 'game_over') {
        turnBannerEl.textContent = state.winner
          ? `${state.players[state.winner].name} wins!`
          : 'Game over';
      } else if (state.phase === 'ball_in_hand') {
        turnBannerEl.textContent = myTurn ? 'Tap the table to place the cue ball' : "Opponent's ball in hand";
      } else {
        turnBannerEl.textContent = myTurn ? 'Your shot' : `${state.players[state.currentShooter].name}'s shot`;
      }
    }

    if (ballRowEl && seat) {
      const me = state.players[seat];
      if (state.mode === 'rotation') {
        // No groups in rotation — show the running score and which ball you must hit next.
        const targets = legalTargetBallIds(state);
        ballRowEl.innerHTML =
          `<span class="score-pill" style="padding:0 6px">${me?.score ?? 0} pts</span>` +
          (targets.length ? `<span style="font-size:0.62rem;color:var(--muted);padding:0 4px">HIT</span>` + ballChipHtml(targets[0], false) : '');
      } else {
        const ids = me?.group === 'solid' ? SOLID_IDS : me?.group === 'stripe' ? STRIPE_IDS : null;
        ballRowEl.innerHTML = ids
          ? ids.map((id) => ballChipHtml(id, state.balls.find((b) => b.id === id)?.pocketed ?? false)).join('')
          : Array.from({ length: 7 }, () => placeholderChipHtml()).join('');
      }
    }

    showGameOverIfNeeded(state);
  }

  /** End of a shot: bank this player's streak and XP if the shot was theirs. */
  function onShotSettled(): void {
    const summary = celebrator?.onShotSettled();
    if (!summary || !shotSeat) return;

    if (shotSeat === seat) {
      streak = summary.pots > 0 ? streak + 1 : 0;
      if (summary.pots > 0) {
        grantXp(summary.xp);
        recordStats({ pots: summary.pots, bestCombo: summary.bestCombo });
      }
    }
    renderer?.setStreakFire(shotSeat === seat && streak >= 2);
    shotSeat = null;
  }

  function showGameOverIfNeeded(state: GameState): void {
    if (state.phase !== 'game_over' || root.querySelector('#gameOverOverlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'gameOverOverlay';
    overlay.className = 'overlay-center';
    const myTeam = seat ? state.players[seat]?.team : null;
    const iWon =
      state.mode === 'teams' && state.winningTeam ? myTeam === state.winningTeam : state.winner === seat;
    const otherWins =
      state.mode === 'teams' && state.winningTeam
        ? `Team ${state.winningTeam.toUpperCase()} wins`
        : state.winner
          ? `${state.players[state.winner].name} wins`
          : 'Game over';
    overlay.innerHTML = `
      <div>
        <h2>${iWon ? 'You win! 🎉' : otherWins}</h2>
        ${state.lastFoulReason ? `<p style="color:var(--muted)">${state.lastFoulReason}</p>` : ''}
        <div id="rewardSlot"></div>
        <button id="rematchBtn">Rematch</button>
      </div>`;
    root.appendChild(overlay);
    renderRewards(iWon, overlay.querySelector<HTMLElement>('#rewardSlot')!);
    overlay.querySelector('#rematchBtn')!.addEventListener('click', () => {
      socket.emit('requestRematch');
      rewardsShown = false;
      streak = 0;
      overlay.remove();
    });
  }

  /**
   * The phone is where a player actually wants to spin, so the full reward summary lives
   * here as well as on the host screen. XP is banked once per match.
   */
  function renderRewards(iWon: boolean, slot: HTMLElement): void {
    let award = { xp: 0, levelsGained: 0, levelAfter: getProfile().level };
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
        <button id="lockerBtn" class="secondary">Open locker</button>
      </div>`;

    slot.querySelector('#spinNow')?.addEventListener('click', () => {
      void openWheel(root).then(() => {
        socket.emit('setLoadout', { loadout: equippedLoadout() });
        renderer?.setBallSet(equippedLoadout().ballSet);
        renderRewards(iWon, slot);
      });
    });
    slot.querySelector('#lockerBtn')?.addEventListener('click', () => navigate('/profile'));
  }

  async function boot(): Promise<void> {
    root.innerHTML = `
      <div class="controller-root">
        <div class="mini-table-wrap" id="miniTable">
          <div class="mini-ball-strip"><div class="ball-row" id="myBalls"></div></div>
        </div>
        <div class="control-area" id="controlArea">
          <div class="turn-banner" id="turnBanner"></div>
          <div class="power-hud" id="powerHud">
            <div class="power-value" id="powerValue">0%</div>
            <div class="power-tier" id="powerTier">DRAG TO AIM</div>
          </div>
          <div class="hint" id="hint">Drag anywhere &amp; pull back like a slingshot, release to shoot</div>
          <div class="power-ring"><div class="power-fill" id="powerFill"></div></div>
        </div>
        <!-- Outside .control-area on purpose: that whole region is the aim drag surface,
             and its pointer capture swallows taps on anything nested inside it. -->
        <div class="emote-bar" id="emoteBar">
          ${EMOTES.map((e) => `<button class="emote-btn" data-emote="${e}">${e}</button>`).join('')}
        </div>
      </div>
      <div class="toast-stack" id="toastStack"></div>
      <div class="ctrl-buttons">
        <button class="icon-btn" id="settingsBtn" title="Settings">${icon('settings')}</button>
        <button class="icon-btn danger" id="leaveBtn" title="Leave table">${icon('leave')}</button>
      </div>
    `;

    const miniTableEl = root.querySelector<HTMLElement>('#miniTable')!;
    const controlArea = root.querySelector<HTMLElement>('#controlArea')!;
    turnBannerEl = root.querySelector<HTMLElement>('#turnBanner')!;
    ballRowEl = root.querySelector<HTMLElement>('#myBalls')!;
    const powerFill = root.querySelector<HTMLElement>('#powerFill')!;
    const powerValue = root.querySelector<HTMLElement>('#powerValue')!;
    const powerTier = root.querySelector<HTMLElement>('#powerTier')!;
    const powerHud = root.querySelector<HTMLElement>('#powerHud')!;

    renderer = await TableRenderer.create(miniTableEl);
    renderer.setChromeless(true); // no chute/power bar on the small phone preview
    applyRenderSettings(renderer, settings);
    // This preview is the player's own screen, so it shows their own ball set — the shared
    // table on the host screen is the one that follows the host's set.
    renderer.setBallSet(equippedLoadout().ballSet);
    celebrator = new PotCelebrator(root, () => renderer, settings);
    if (lastState) renderer.updateBalls(lastState.balls);

    spinPad = createSpinPad(() => renderPreview(lastAimAngle));
    Object.assign(spinPad.el.style, { position: 'absolute', bottom: '54px', right: '18px' });
    controlArea.appendChild(spinPad.el);

    elevationDial = createElevationDial(() => renderPreview(lastAimAngle));
    Object.assign(elevationDial.el.style, { position: 'absolute', bottom: '54px', left: '18px' });
    controlArea.appendChild(elevationDial.el);

    root.querySelector('#leaveBtn')!.addEventListener('click', () => {
      confirmLeave('Leave this table?', 'Your seat opens up for whoever is waiting.', () => {
        socket.disconnect();
        navigate('/');
      });
    });

    root.querySelector('#settingsBtn')!.addEventListener('click', () => {
      openSettingsPanel(settings, (s) => {
        Object.assign(settings, s);
        saveSettings(settings);
        socket.emit('updateSettings', s);
        applyRenderSettings(renderer, settings);
        renderPreview(lastAimAngle);
      });
    });

    controlArea.addEventListener(
      'pointerdown',
      () => sfx.unlockAudio(),
      { once: true }
    );

    function setPowerHud(power: number): void {
      const pct = Math.round(power * 100);
      const color = powerToCssColor(power);
      powerFill.style.width = `${pct}%`;
      powerFill.style.background = color;
      powerValue.textContent = `${pct}%`;
      powerValue.style.color = color;
      powerTier.textContent = powerTierLabel(power);
      powerHud.classList.toggle('charged', power > 0.02);
      powerHud.style.setProperty('--power-scale', String(1 + power * 0.18));
    }

    aimController = new AimController(controlArea, {
      onAimChange: (angle, power) => {
        if (!seat) return;
        lastAimAngle = angle;
        lastAimPower = power;
        setPowerHud(power);
        const spin = spinPad?.getValue() ?? { x: 0, y: 0 };
        socket.emit('updateAim', { seat, angle, spin, elevation: elevationDial?.getValue() ?? 0 });
        renderer?.setAimVisual(angle, power, true);
        renderPreview(angle);
      },
      onShoot: (angle, power) => {
        if (!seat) return;
        setPowerHud(0);
        const spin = spinPad?.getValue() ?? { x: 0, y: 0 };
        socket.emit('takeShot', {
          seat, angle, power, spin, elevation: elevationDial?.getValue() ?? 0,
        });
        spinPad?.reset();
        elevationDial?.reset();
      },
    });

    // Reactions go to the host table. The server rate-limits them, and the button dims
    // locally for the same window so the cooldown is visible rather than silent.
    root.querySelectorAll<HTMLButtonElement>('.emote-btn').forEach((btn) => {
      btn.addEventListener('pointerdown', (e) => e.stopPropagation());
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        socket.emit('sendEmote', { emote: btn.dataset.emote! });
        if (settings.hapticsEnabled) navigator.vibrate?.(10);
        const bar = root.querySelector<HTMLElement>('#emoteBar');
        bar?.classList.add('cooling');
        setTimeout(() => bar?.classList.remove('cooling'), EMOTE_COOLDOWN_MS);
      });
    });

    miniTableEl.addEventListener('pointerdown', onPlacementPointer);
    miniTableEl.addEventListener('pointermove', onPlacementPointer);
    miniTableEl.addEventListener('pointerup', onPlacementRelease);

    if (lastState) applyState(lastState);
  }

  const socketHandlers = {
    gameState: (state: GameState) => applyState(state),
    aimUpdate: (input: AimInput) => {
      if (input.seat === seat) return;
      renderer?.setAimVisual(input.angle, 0.3, true);
      renderPreview(input.angle);
    },
    shotFired: (input: ShootInput) => {
      shotSeat = input.seat;
      if (settings.soundEnabled) sfx.playCueStrike(settings.soundVolume, 0.6);
      const cuePos = lastState?.balls.find((b) => b.id === CUE_BALL_ID)?.pos;
      if (cuePos) renderer?.spawnChalkPuff(cuePos, input.angle);
      renderer?.setAimVisual(0, 0, false);
      renderer?.setAimPreview(CUE_BALL_ID, null);
    },
    simEvent: (ev: SimEvent) => {
      if (ev.type === 'ballCollision') {
        if (settings.soundEnabled) {
        // The impact sound follows the shooter's equipped hit effect.
        sfx.playHitImpact(
          renderer?.currentHitEffectId() ?? 'hit.spark',
          settings.soundVolume,
          ev.impulse / 1500
        );
      }
        if (settings.hapticsEnabled) navigator.vibrate?.(8);
        renderer?.spawnSparks(ev.pos, ev.impulse, ev.a, ev.b);
      } else if (ev.type === 'cushion') {
        if (settings.soundEnabled) sfx.playCushionThud(settings.soundVolume);
        renderer?.spawnCushionDust(ev.pos, ev.speed);
      } else if (ev.type === 'pot') {
        const combo = celebrator?.onPot(ev.pos, ev.ballId) ?? 0;
        // Longer buzz the deeper into a combo you get.
        if (settings.hapticsEnabled) navigator.vibrate?.([15, 40, 15 + combo * 25]);
      } else if (ev.type === 'shotSettled') {
        onShotSettled();
      }
    },
    errorMessage: (msg: string) => {
      const stack = root.querySelector<HTMLElement>('#toastStack');
      if (stack) showToast(stack, msg, 'foul');
    },
  };

  socket.on('gameState', socketHandlers.gameState);
  socket.on('aimUpdate', socketHandlers.aimUpdate);
  socket.on('shotFired', socketHandlers.shotFired);
  socket.on('simEvent', socketHandlers.simEvent);
  socket.on('errorMessage', socketHandlers.errorMessage);

  socket.on('connect_error', () => showFatal('Could not connect to the table.'));

  attemptEntry();

  return () => {
    socket.off('gameState', socketHandlers.gameState);
    socket.off('aimUpdate', socketHandlers.aimUpdate);
    socket.off('shotFired', socketHandlers.shotFired);
    socket.off('simEvent', socketHandlers.simEvent);
    socket.off('errorMessage', socketHandlers.errorMessage);
    aimController?.destroy();
    renderer?.destroy();
  };
}
