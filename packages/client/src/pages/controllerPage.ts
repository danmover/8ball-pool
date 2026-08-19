import type { AimInput, GameState, Seat, ShootInput, SimEvent, TrajectoryPreview } from '@8ball/shared';
import { CUE_BALL_ID, computeTrajectoryPreview, legalTargetBallIds } from '@8ball/shared';
import { getSocket } from '../net/socket';
import { loadSession, loadSettings, saveSettings, saveSession } from '../settings/settingsStore';
import { TableRenderer, powerToCssColor } from '../render/TableRenderer';
import { powerTierLabel } from '../render/powerTier';
import { ballChipHtml, placeholderChipHtml } from '../render/ballChip';
import { AimController } from '../controller/aimController';
import { createSpinPad } from '../controller/spinPad';
import { openSettingsPanel } from '../settings/settingsPanel';
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
  let placing = false;
  let lastAimAngle = 0;
  let turnBannerEl: HTMLElement | null = null;
  let ballRowEl: HTMLElement | null = null;

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
          <input id="nameInput" placeholder="Your name" maxlength="20" autocomplete="off" />
          <button id="joinBtn">Join Game</button>
          <p id="joinError" class="error">${errorMsg ?? ''}</p>
        </div>
      </div>`;
    const nameInput = root.querySelector<HTMLInputElement>('#nameInput')!;
    const joinBtn = root.querySelector<HTMLButtonElement>('#joinBtn')!;
    const joinError = root.querySelector<HTMLElement>('#joinError')!;

    joinBtn.addEventListener('click', () => {
      sfx.unlockAudio();
      const name = nameInput.value.trim() || 'Player';
      socket.emit('joinRoom', { code, name }, (res) => {
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
    socket.emit('joinRoom', { code, name: '', token: existing.token }, (res) => {
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
      settings.trajectoryPreview
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
      const group = state.players[seat].group;
      const ids = group === 'solid' ? SOLID_IDS : group === 'stripe' ? STRIPE_IDS : null;
      ballRowEl.innerHTML = ids
        ? ids.map((id) => ballChipHtml(id, state.balls.find((b) => b.id === id)?.pocketed ?? false)).join('')
        : Array.from({ length: 7 }, () => placeholderChipHtml()).join('');
    }

    showGameOverIfNeeded(state);
  }

  function showGameOverIfNeeded(state: GameState): void {
    if (state.phase !== 'game_over' || root.querySelector('#gameOverOverlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'gameOverOverlay';
    overlay.className = 'overlay-center';
    const iWon = state.winner === seat;
    overlay.innerHTML = `
      <div>
        <h2>${iWon ? 'You win! 🎉' : state.winner ? `${state.players[state.winner].name} wins` : 'Game over'}</h2>
        ${state.lastFoulReason ? `<p style="opacity:0.7">${state.lastFoulReason}</p>` : ''}
        <button id="rematchBtn">Rematch</button>
      </div>`;
    root.appendChild(overlay);
    overlay.querySelector('#rematchBtn')!.addEventListener('click', () => {
      socket.emit('requestRematch');
      overlay.remove();
    });
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
      </div>
      <button class="icon-btn" id="settingsBtn" style="position:fixed; top:10px; right:10px; z-index:5;">⚙</button>
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
    renderer.setColorblindPatterns(settings.colorblindPatterns);
    renderer.setFeltTheme(settings.feltTheme);
    renderer.setEffectsIntensity(settings.effectsIntensity);
    if (lastState) renderer.updateBalls(lastState.balls);

    spinPad = createSpinPad();
    Object.assign(spinPad.el.style, { position: 'absolute', bottom: '54px', right: '18px' });
    controlArea.appendChild(spinPad.el);

    root.querySelector('#settingsBtn')!.addEventListener('click', () => {
      openSettingsPanel(settings, (s) => {
        Object.assign(settings, s);
        saveSettings(settings);
        socket.emit('updateSettings', s);
        renderer?.setColorblindPatterns(settings.colorblindPatterns);
        renderer?.setFeltTheme(settings.feltTheme);
        renderer?.setEffectsIntensity(settings.effectsIntensity);
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
        setPowerHud(power);
        const spin = spinPad?.getValue() ?? { x: 0, y: 0 };
        socket.emit('updateAim', { seat, angle, spin });
        renderer?.setAimVisual(angle, power, true);
        renderPreview(angle);
      },
      onShoot: (angle, power) => {
        if (!seat) return;
        setPowerHud(0);
        const spin = spinPad?.getValue() ?? { x: 0, y: 0 };
        socket.emit('takeShot', { seat, angle, power, spin });
        spinPad?.reset();
      },
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
      if (settings.soundEnabled) sfx.playCueStrike(settings.soundVolume, 0.6);
      const cuePos = lastState?.balls.find((b) => b.id === CUE_BALL_ID)?.pos;
      if (cuePos) renderer?.spawnChalkPuff(cuePos, input.angle);
      renderer?.setAimVisual(0, 0, false);
      renderer?.setAimPreview(CUE_BALL_ID, null);
    },
    simEvent: (ev: SimEvent) => {
      if (ev.type === 'ballCollision') {
        if (settings.soundEnabled) sfx.playBallClick(settings.soundVolume, ev.impulse / 1500);
        if (settings.hapticsEnabled) navigator.vibrate?.(8);
        renderer?.spawnSparks(ev.pos, ev.impulse);
      } else if (ev.type === 'cushion') {
        if (settings.soundEnabled) sfx.playCushionThud(settings.soundVolume);
        renderer?.spawnCushionDust(ev.pos, ev.speed);
      } else if (ev.type === 'pot') {
        if (settings.soundEnabled) sfx.playPocketSwish(settings.soundVolume);
        if (settings.hapticsEnabled) navigator.vibrate?.([15, 40, 15]);
        renderer?.spawnPotFlash(ev.pos, ev.ballId);
      }
    },
    errorMessage: (msg: string) => {
      const toast = document.createElement('div');
      toast.className = 'turn-banner';
      toast.style.background = 'rgba(180,40,40,0.85)';
      toast.textContent = msg;
      root.appendChild(toast);
      setTimeout(() => toast.remove(), 2200);
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
