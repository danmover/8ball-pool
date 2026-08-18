import QRCode from 'qrcode';
import type { AimInput, GameState, Seat, ShootInput, SimEvent, TrajectoryPreview } from '@8ball/shared';
import { CUE_BALL_ID, computeTrajectoryPreview, legalTargetBallIds } from '@8ball/shared';
import { getSocket } from '../net/socket';
import { loadSession, loadSettings, saveSettings } from '../settings/settingsStore';
import { TableRenderer } from '../render/TableRenderer';
import { AimController } from '../controller/aimController';
import { openSettingsPanel } from '../settings/settingsPanel';
import * as sfx from '../render/sfx';
import { navigate } from '../router';

export function renderHostPage(root: HTMLElement, code: string): () => void {
  const socket = getSocket();
  const settings = loadSettings();
  let ownedSeat: Seat | null = null;
  let renderer: TableRenderer | null = null;
  let aimController: AimController | null = null;
  let lastState: GameState | null = null;
  let placing = false;

  root.innerHTML = `
    <div id="tableCanvas" style="position:absolute; inset:0;"></div>
    <div class="hud">
      <div class="top-bar">
        <div class="scoreboard" id="scoreboard"></div>
        <button class="icon-btn" id="settingsBtn">⚙</button>
      </div>
      <div></div>
      <div id="bottomArea"></div>
    </div>
    <div id="joinPanelWrap"></div>
  `;

  const canvasEl = root.querySelector<HTMLElement>('#tableCanvas')!;
  const scoreboardEl = root.querySelector<HTMLElement>('#scoreboard')!;
  const bottomArea = root.querySelector<HTMLElement>('#bottomArea')!;
  const joinPanelWrap = root.querySelector<HTMLElement>('#joinPanelWrap')!;

  root.querySelector('#settingsBtn')!.addEventListener('click', () => {
    openSettingsPanel(settings, (s) => {
      Object.assign(settings, s);
      saveSettings(settings);
      renderer?.setColorblindPatterns(settings.colorblindPatterns);
      renderer?.setFeltTheme(settings.feltTheme);
      renderer?.setEffectsIntensity(settings.effectsIntensity);
      refreshPreview();
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

  socket.emit('hostRejoin', { code, token: hostSession.token }, (res) => {
    if (!res.ok) {
      showFatalError('This table has expired.');
      return;
    }
    void boot();
  });

  async function boot(): Promise<void> {
    renderer = await TableRenderer.create(canvasEl);
    renderer.setColorblindPatterns(settings.colorblindPatterns);
    renderer.setFeltTheme(settings.feltTheme);
    renderer.setEffectsIntensity(settings.effectsIntensity);
    if (lastState) renderer.updateBalls(lastState.balls);

    await renderInvite();
    if (lastState) {
      renderSeatSlots(lastState);
      renderScoreboard(lastState);
    }

    aimController = new AimController(canvasEl, {
      onAimChange: (angle, power) => {
        if (!ownedSeat || !lastState) return;
        lastAimAngle = angle;
        renderer?.setAimVisual(angle, power, true);
        socket.emit('updateAim', { seat: ownedSeat, angle, spin: { x: 0, y: 0 } });
        renderPreview(angle);
      },
      onShoot: (angle, power) => {
        if (!ownedSeat) return;
        socket.emit('takeShot', { seat: ownedSeat, angle, power, spin: { x: 0, y: 0 } });
      },
    });
    aimController.setEnabled(false);

    canvasEl.addEventListener('pointerdown', onPlacementPointer);
    canvasEl.addEventListener('pointermove', onPlacementPointer);
    canvasEl.addEventListener('pointerup', onPlacementRelease);
  }

  function onPlacementPointer(e: PointerEvent): void {
    if (!placing || !renderer) return;
    const pos = renderer.screenToTable(e.clientX, e.clientY);
    renderer.setPlacementGhost(pos);
  }

  function onPlacementRelease(e: PointerEvent): void {
    if (!placing || !renderer || !ownedSeat) return;
    const pos = renderer.screenToTable(e.clientX, e.clientY);
    socket.emit('placeCueBall', { seat: ownedSeat, pos });
  }

  async function renderInvite(): Promise<void> {
    const joinUrl = `${window.location.origin}/play/${code}`;
    const qrDataUrl = await QRCode.toDataURL(joinUrl, { margin: 1, width: 176, color: { dark: '#0d1a12' } });
    joinPanelWrap.innerHTML = `
      <div class="hud" style="align-items:center; justify-content:center;">
        <div class="join-panel" id="joinPanel">
          <div class="room-code">${code}</div>
          <img src="${qrDataUrl}" width="176" height="176" alt="QR code to join" />
          <p style="margin:0; opacity:0.7; font-size:0.85rem">Scan to join from your phone</p>
          <div class="seat-slots" id="seatSlots"></div>
        </div>
      </div>`;
  }

  function renderSeatSlots(state: GameState): void {
    const slots = joinPanelWrap.querySelector<HTMLElement>('#seatSlots');
    if (!slots) return;
    slots.innerHTML = '';
    (['p1', 'p2'] as Seat[]).forEach((seat) => {
      const info = state.players[seat];
      const box = document.createElement('div');
      box.className = 'seat-slot';
      if (info.connected) {
        box.textContent = `${info.name}${info.isHost ? ' (this screen)' : ''}`;
      } else {
        box.innerHTML = '';
        const btn = document.createElement('button');
        btn.className = 'secondary';
        btn.textContent = `Play as ${seat === 'p1' ? 'Player 1' : 'Player 2'}`;
        btn.style.width = '100%';
        btn.addEventListener('click', () => socket.emit('hostClaimSeat', { seat }));
        box.appendChild(btn);
      }
      slots.appendChild(box);
    });

    const bothSeated = state.players.p1.connected && state.players.p2.connected;
    joinPanelWrap.style.display = bothSeated ? 'none' : '';
  }

  function renderScoreboard(state: GameState): void {
    scoreboardEl.innerHTML = '';
    (['p1', 'p2'] as Seat[]).forEach((seat) => {
      const info = state.players[seat];
      const chip = document.createElement('div');
      chip.className = 'player-chip' + (state.currentShooter === seat ? ' active' : '');
      const dot = document.createElement('span');
      dot.className = 'group-dot' + (info.group ? ` ${info.group}` : '');
      chip.appendChild(dot);
      chip.appendChild(document.createTextNode(info.connected ? info.name : `Seat ${seat === 'p1' ? 1 : 2} open`));
      scoreboardEl.appendChild(chip);
    });
  }

  function renderBottomArea(state: GameState): void {
    bottomArea.innerHTML = '';
    if (state.phase === 'ball_in_hand') {
      const banner = document.createElement('div');
      banner.className = 'turn-banner';
      banner.style.position = 'static';
      banner.style.margin = '0 auto';
      banner.style.width = 'fit-content';
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
      overlay.innerHTML = `
        <div>
          <h2>${state.winner ? state.players[state.winner].name + ' wins!' : 'Game over'}</h2>
          ${state.lastFoulReason ? `<p style="opacity:0.7">${state.lastFoulReason}</p>` : ''}
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

  function refreshPreview(): void {
    if (lastAimAngle !== null) renderPreview(lastAimAngle);
  }

  let lastAimAngle: number | null = null;

  socket.on('roomState', (rs) => {
    if (lastState) {
      // keep local isHost/connected view in sync for the seat slot UI even before gameState arrives
      (['p1', 'p2'] as Seat[]).forEach((seat) => {
        if (rs.players[seat]) lastState!.players[seat] = rs.players[seat]!;
      });
      renderSeatSlots(lastState);
      renderScoreboard(lastState);
    }
  });

  socket.on('gameState', (state) => {
    lastState = state;
    // If the host has claimed both seats (playing solo on one screen), always control
    // whichever of them is actually up — not just the first one claimed — or the host's
    // controls would silently stay locked to p1 forever during p2's turn.
    const hostSeats = (['p1', 'p2'] as Seat[]).filter((s) => state.players[s].isHost);
    ownedSeat = hostSeats.find((s) => s === state.currentShooter) ?? hostSeats[0] ?? null;
    renderer?.updateBalls(state.balls);
    renderer?.setLegalTargets(legalTargetBallIds(state));
    renderSeatSlots(state);
    renderScoreboard(state);
    renderBottomArea(state);

    const canAim = ownedSeat !== null && state.currentShooter === ownedSeat && (state.phase === 'aiming' || state.phase === 'break');
    aimController?.setEnabled(canAim);
    placing = ownedSeat !== null && state.phase === 'ball_in_hand' && state.currentShooter === ownedSeat;
    if (!placing) renderer?.setPlacementGhost(null);

    if (state.phase === 'shot_in_progress') {
      renderer?.setAimVisual(0, 0, false);
      renderer?.setAimPreview(CUE_BALL_ID, null);
      lastAimAngle = null;
    }
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
      if (settings.hapticsEnabled) navigator.vibrate?.([15, 40, 15]);
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
