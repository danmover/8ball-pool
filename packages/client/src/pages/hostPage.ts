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
import { CUE_BALL_ID, computeTrajectoryPreview, legalTargetBallIds } from '@8ball/shared';
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
      onClaimSeat: (seat) => socket.emit('hostClaimSeat', { seat }),
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
        const initials = info.connected ? name.slice(0, 2).toUpperCase() : seat.toUpperCase();
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

        return `
          <div class="player-panel${active ? ' active' : ''}">
            <div class="avatar">${initials}</div>
            <div class="player-info">
              <div class="player-name">${name}</div>
              <div style="display:flex; gap:0.35rem; align-items:center">${groupBadge(state, seat)}${teamTag}</div>
              ${ballRow}
            </div>
          </div>`;
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
          <button id="rematchBtn">Rematch</button>
        </div>`;
      root.appendChild(overlay);
      overlay.querySelector('#rematchBtn')!.addEventListener('click', () => {
        socket.emit('requestRematch');
        overlay.remove();
      });
    }
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
    if (settings.soundEnabled) sfx.playCueStrike(settings.soundVolume, 0.6);
    const cuePos = lastState?.balls.find((b) => b.id === CUE_BALL_ID)?.pos;
    if (cuePos) renderer?.spawnChalkPuff(cuePos, input.angle);
    renderer?.setAimVisual(0, 0, false);
    renderer?.setAimPreview(CUE_BALL_ID, null);
  });

  socket.on('simEvent', (ev: SimEvent) => {
    if (ev.type === 'ballCollision') {
      if (settings.soundEnabled) sfx.playBallClick(settings.soundVolume, ev.impulse / 1500);
      renderer?.spawnSparks(ev.pos, ev.impulse);
    } else if (ev.type === 'cushion') {
      if (settings.soundEnabled) sfx.playCushionThud(settings.soundVolume);
      renderer?.spawnCushionDust(ev.pos, ev.speed);
    } else if (ev.type === 'pot') {
      if (settings.soundEnabled) sfx.playPocketSwish(settings.soundVolume);
      renderer?.spawnPotFlash(ev.pos, ev.ballId);
    }
  });

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
