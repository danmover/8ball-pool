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
  STARTING_LIVES,
  computeTrajectoryPreview,
  legalTargetBallIds,
  levelProgress,
  activeChallenge,
  modeDescriptor,
  seatIndex,
  xpForResult,
} from '@8ball/shared';
import { playerBannerHtml } from '../render/banner';
import { icon } from '../render/icons';
import { confirmLeave, showToast } from '../render/dialogs';
import { PotCelebrator } from '../render/potCelebration';
import {
  challengeStars,
  equippedLoadout,
  getProfile,
  grantXp,
  recordChallengeStars,
  recordStats,
} from '../profile/profile';
import { recordChallengeEvent } from '../profile/dailyChallenge';
import { openWheel } from '../profile/wheel';
import { getSocket } from '../net/socket';
import { loadSession, loadSettings, saveSettings } from '../settings/settingsStore';
import { TableRenderer, powerToCssColor } from '../render/TableRenderer';
import { powerTierLabel } from '../render/powerTier';
import { ballChipHtml, placeholderChipHtml } from '../render/ballChip';
import { AimController } from '../controller/aimController';
import { createSpinPad } from '../controller/spinPad';
import { createElevationDial } from '../controller/elevationDial';
import { openSettingsPanel } from '../settings/settingsPanel';
import { applyRenderSettings } from '../settings/applySettings';
import { renderLobby } from './lobbyView';
import * as sfx from '../render/sfx';
import { navigate } from '../router';

/** Centre-ball, used when no pad exists yet. */
const ZERO_SPIN = { x: 0, y: 0 };

const SOLID_IDS = [1, 2, 3, 4, 5, 6, 7];
const STRIPE_IDS = [9, 10, 11, 12, 13, 14, 15];

export function renderHostPage(root: HTMLElement, code: string): () => void {
  const socket = getSocket();
  const settings = loadSettings();
  let ownedSeat: Seat | null = null;
  let renderer: TableRenderer | null = null;
  /** In-flight renderer creation, so concurrent callers share one instance. */
  let rendererPromise: Promise<TableRenderer> | null = null;
  let aimController: AimController | null = null;
  let spinPad: ReturnType<typeof createSpinPad> | null = null;
  let elevation: ReturnType<typeof createElevationDial> | null = null;
  /** Listeners registered outside the page root, to be undone when the page is torn down. */
  const cleanups: (() => void)[] = [];
  let lastState: GameState | null = null;
  let lastRoom: RoomStateDTO | null = null;
  let placing = false;
  let lastAimAngle: number | null = null;
  /** Latest drag power, so the cue-ball preview scales with how hard the shot will be. */
  let lastAimPower = 0.5;
  let booted = false;
  let qrDataUrl = '';
  let celebrator: PotCelebrator | null = null;
  /** Consecutive scoring turns per seat — drives the ON FIRE banner state. */
  const streaks: Record<Seat, number> = {};
  /**
   * What each seat did this frame, for the end-of-frame screen. Counted from the shot
   * summaries the client already builds — the server sends nothing extra for this.
   */
  const frameStats: Record<Seat, { pots: number; shots: number; bestCombo: number }> = {};
  let shotSeat: Seat | null = null;
  let lastPotPos: { x: number; y: number } | null = null;
  let rewardsShown = false;
  let winCelebrated = false;
  let autostarted = false;
  let backdropStarted = false;
  let clockRaf = 0;
  /** Tracks the "win without fouling" daily objective across the frame. */
  let fouledThisFrame = false;

  const joinUrl = `${window.location.origin}/play/${code}`;

  root.innerHTML = `
    <div id="tableCanvas" class="table-canvas" style="position:absolute; inset:0"></div>
    <div class="lobby-scrim" id="lobbyScrim"></div>
    <div class="hud" id="gameHud" style="display:none">
      <div class="top-bar">
        <div id="playerPanels" style="display:flex; gap:0.5rem; flex-wrap:wrap; flex:1"></div>
        <div class="top-right">
          <button class="icon-btn" id="settingsBtn" title="Settings">${icon('settings')}</button>
          <button class="icon-btn danger" id="leaveBtn" title="Leave table">${icon('leave')}</button>
        </div>
      </div>
      <!-- The centre column carries anything that must be noticed: the clock counting down and
           the prompt telling you it's your move. Both used to sit off in a corner. -->
      <div class="centre-hud">
        <div class="shot-clock" id="shotClock" style="display:none"></div>
        <div id="callout"></div>
      </div>
      <div class="toast-stack" id="toastStack"></div>
      <div class="challenge-hud" id="challengeHud" style="display:none"></div>
      <div id="bottomArea"></div>
    </div>
    <div class="host-power-wrap" id="hostPowerWrap" style="display:none">
      <div class="power-hud" id="powerHud">
        <div class="power-value" id="powerValue">0%</div>
        <div class="power-tier" id="powerTier">DRAG TO AIM</div>
      </div>
    </div>
    <div class="host-spin-wrap" id="hostSpinWrap" style="display:none">
      <div class="spin-label">SPIN</div>
      <div id="hostSpin"></div>
      <div class="spin-hint">Arrows nudge spin · Shift+arrows fine-aim · C to centre</div>
      <div class="spin-label">CUE</div>
      <div id="hostElevation"></div>
    </div>
    <div id="lobbyWrap"></div>
  `;

  const canvasEl = root.querySelector<HTMLElement>('#tableCanvas')!;
  const gameHud = root.querySelector<HTMLElement>('#gameHud')!;
  const panelsEl = root.querySelector<HTMLElement>('#playerPanels')!;
  const bottomArea = root.querySelector<HTMLElement>('#bottomArea')!;
  const lobbyWrap = root.querySelector<HTMLElement>('#lobbyWrap')!;
  const hostPowerWrap = root.querySelector<HTMLElement>('#hostPowerWrap')!;
  const hostSpinWrap = root.querySelector<HTMLElement>('#hostSpinWrap')!;
  const challengeHud = root.querySelector<HTMLElement>('#challengeHud')!;
  const powerValue = root.querySelector<HTMLElement>('#powerValue')!;
  const powerTier = root.querySelector<HTMLElement>('#powerTier')!;
  const powerHud = root.querySelector<HTMLElement>('#powerHud')!;

  /**
   * Turns the aim by a hair, and pushes it everywhere the drag would have.
   *
   * Aiming by dragging can't resolve a third of a degree, which is roughly what squirt moves a
   * shot by — so without this the deflection would be visible in the guide and impossible to
   * correct for.
   */
  function nudgeAim(radians: number): void {
    if (!aimController || !ownedSeat || lastAimAngle === null) return;
    aimController.nudge(radians);
    lastAimAngle = aimController.angle;
    renderer?.setAimVisual(lastAimAngle, lastAimPower, true);
    socket.emit('updateAim', {
      seat: ownedSeat,
      angle: lastAimAngle,
      spin: spinPad?.getValue() ?? ZERO_SPIN,
      elevation: elevation?.getValue() ?? 0,
    });
    renderPreview(lastAimAngle);
  }

  function setPowerHud(power: number): void {
    const pct = Math.round(power * 100);
    const color = powerToCssColor(power);
    powerValue.textContent = `${pct}%`;
    powerValue.style.color = color;
    powerTier.textContent = powerTierLabel(power);
    powerHud.classList.toggle('charged', power > 0.02);
    powerHud.style.setProperty('--power-scale', String(1 + power * 0.18));
  }

  root.querySelector('#leaveBtn')!.addEventListener('click', () => {
    confirmLeave(
      'Leave the table?',
      'The game ends for everyone at this table.',
      () => navigate('/')
    );
  });

  root.querySelector('#settingsBtn')!.addEventListener('click', () => {
    openSettingsPanel(settings, (s) => {
      Object.assign(settings, s);
      saveSettings(settings);
      applyRenderSettings(renderer, settings);
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
    renderLobby(
      lobbyWrap,
      room,
      qrDataUrl,
      joinUrl.replace(/^https?:\/\//, ''),
      {
        onModeChange: (mode) => socket.emit('hostUpdateLobby', { mode }),
        onSizeChange: (maxPlayers) => socket.emit('hostUpdateLobby', { maxPlayers }),
        onClaimSeat: (seat) =>
          socket.emit('hostClaimSeat', {
            seat,
            loadout: equippedLoadout(),
            name: getProfile().displayName,
          }),
        onReleaseSeat: (seat) => socket.emit('hostReleaseSeat', { seat }),
        onAddBot: (seat, difficulty) => socket.emit('hostAddBot', { seat, difficulty }),
        onRemoveBot: (seat) => socket.emit('hostRemoveBot', { seat }),
        onShotClockChange: (shotClockSeconds) => socket.emit('hostUpdateLobby', { shotClockSeconds }),
        onSeriesChange: (seriesTarget) => socket.emit('hostUpdateLobby', { seriesTarget }),
        onStart: () => socket.emit('hostStartGame'),
      },
      settings.defaultBotDifficulty
    );
  }

  /**
   * "Play Solo" from the home screen drops straight into a game: claim seat one, fill the
   * rest with bots at the chosen difficulty, and start — no lobby step.
   */
  function maybeAutostart(room: RoomStateDTO): void {
    if (autostarted || room.started) return;
    const raw = sessionStorage.getItem(`8ball:autostart:${code}`);
    if (!raw) return;
    autostarted = true;
    sessionStorage.removeItem(`8ball:autostart:${code}`);

    const seats = Object.keys(room.players);
    socket.emit('hostClaimSeat', {
      seat: seats[0],
      loadout: equippedLoadout(),
      name: getProfile().displayName,
    });
    for (const seat of seats.slice(1)) {
      socket.emit('hostAddBot', { seat, difficulty: settings.defaultBotDifficulty });
    }
    // Give the seat claims a beat to land before the server checks the lobby is full.
    setTimeout(() => socket.emit('hostStartGame'), 220);
  }

  /**
   * The lobby sits over a live table rather than a flat panel — the renderer is created up
   * front in attract mode, and `boot()` simply takes it over when the game starts. Same
   * renderer throughout, so the menu table *becomes* the real table instead of being swapped
   * for one.
   */
  async function ensureRenderer(): Promise<TableRenderer> {
    // Memoise the *promise*, not the result. Checking `renderer` alone let two callers past
    // the guard while the first was still awaiting `create()` — which happened for real when
    // a room state with `started: false` was immediately followed by one with `started: true`,
    // leaving two Pixi apps and two stacked canvases in the same container.
    if (!rendererPromise) {
      rendererPromise = TableRenderer.create(canvasEl).then((created) => {
        renderer = created;
        applyRenderSettings(created, settings);
        // The balls are shared table furniture, so they wear the host's set.
        created.setBallSet(equippedLoadout().ballSet);
        created.setShooterLoadout(equippedLoadout());
        return created;
      });
    }
    return rendererPromise;
  }

  async function showLobbyBackdrop(): Promise<void> {
    if (booted || backdropStarted) return;
    backdropStarted = true;
    const created = await ensureRenderer();
    if (booted) return; // the game started while we were setting up
    created.setChromeless(true);
    created.setEffectsIntensity('low');
    if (!settings.reduceMotion) created.startAttractMode();
    root.classList.add('in-lobby');
  }

  async function boot(): Promise<void> {
    if (booted) return;
    booted = true;

    gameHud.style.display = '';
    lobbyWrap.style.display = 'none';
    root.classList.remove('in-lobby');

    renderer = await ensureRenderer();
    // Hand the attract-mode table over to the real game.
    renderer.stopAttractMode();
    renderer.setChromeless(false);
    applyRenderSettings(renderer, settings);
    celebrator = new PotCelebrator(root, () => renderer, settings);
    if (lastState) renderer.updateBalls(lastState.balls);

    // The host screen had no spin control at all, so hosts could only ever play centre-ball.
    // Same pad the phone uses; re-previewing on change is what makes draw/follow learnable.
    spinPad = createSpinPad(() => {
      if (lastAimAngle !== null) renderPreview(lastAimAngle);
    });
    root.querySelector<HTMLElement>('#hostSpin')!.appendChild(spinPad.el);

    // Raising the cue changes where the ball goes, so the guide has to be recomputed for it
    // exactly as it is for spin.
    elevation = createElevationDial(() => {
      if (lastAimAngle !== null) renderPreview(lastAimAngle);
    });
    root.querySelector<HTMLElement>('#hostElevation')!.appendChild(elevation.el);

    // Keyboard shortcuts, because setting spin on a desktop by dragging a small circle with the
    // mouse and *then* dragging the table to aim is two hands' worth of work for one shot.
    //
    // Arrows move the spin tip; holding shift turns them into a fine aim nudge instead, which
    // matters now that english can deflect a shot by a couple of degrees and a mouse drag
    // can't reliably resolve that.
    const AIM_NUDGE = 0.005; // radians — about a third of a degree
    const onShotKey = (e: KeyboardEvent): void => {
      if (hostSpinWrap.style.display === 'none') return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const step = 0.25;
      const aiming = e.shiftKey;
      switch (e.key) {
        case 'ArrowUp':
          if (aiming) elevation?.setValue((elevation?.getValue() ?? 0) + 0.08);
          else spinPad?.nudge(0, -step);
          break;
        case 'ArrowDown':
          if (aiming) elevation?.setValue((elevation?.getValue() ?? 0) - 0.08);
          else spinPad?.nudge(0, step);
          break;
        case 'ArrowLeft':
          if (aiming) nudgeAim(-AIM_NUDGE);
          else spinPad?.nudge(-step, 0);
          break;
        case 'ArrowRight':
          if (aiming) nudgeAim(AIM_NUDGE);
          else spinPad?.nudge(step, 0);
          break;
        case 'c':
        case 'C':
          spinPad?.reset();
          elevation?.reset();
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onShotKey);
    cleanups.push(() => window.removeEventListener('keydown', onShotKey));

    // Holding shift also slows the aim drag itself, for the same reason.
    const onShift = (e: KeyboardEvent): void => aimController?.setPrecise(e.shiftKey);
    window.addEventListener('keydown', onShift);
    window.addEventListener('keyup', onShift);
    cleanups.push(() => {
      window.removeEventListener('keydown', onShift);
      window.removeEventListener('keyup', onShift);
    });

    aimController = new AimController(canvasEl, {
      onAimChange: (angle, power) => {
        if (!ownedSeat || !lastState) return;
        lastAimAngle = angle;
        lastAimPower = power;
        renderer?.setAimVisual(angle, power, true);
        setPowerHud(power);
        socket.emit('updateAim', {
          seat: ownedSeat,
          angle,
          spin: spinPad?.getValue() ?? ZERO_SPIN,
          elevation: elevation?.getValue() ?? 0,
        });
        renderPreview(angle);
      },
      onShoot: (angle, power) => {
        if (!ownedSeat) return;
        setPowerHud(0);
        socket.emit('takeShot', {
          seat: ownedSeat,
          angle,
          power,
          spin: spinPad?.getValue() ?? ZERO_SPIN,
          elevation: elevation?.getValue() ?? 0,
        });
        spinPad?.reset();
        elevation?.reset();
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

  /** The one status badge that matters for the mode in play. */
  function groupBadge(state: GameState, seat: Seat): string {
    const info = state.players[seat];

    if (state.mode === 'rotation') return `<span class="score-pill">${info.score} pts</span>`;

    if (state.mode === 'killer') {
      const lives = info.lives ?? 0;
      const hearts = Array.from({ length: STARTING_LIVES }, (_, i) =>
        i < lives ? '<span class="life">♥</span>' : '<span class="life spent">♥</span>'
      ).join('');
      return `<span class="lives">${hearts}</span>`;
    }

    if (state.mode === 'cutthroat') {
      const left = info.ownedBalls.filter(
        (id) => !(state.balls.find((b) => b.id === id)?.pocketed ?? true)
      ).length;
      return info.eliminated
        ? `<span class="group-badge out">OUT</span>`
        : `<span class="score-pill">${left} ball${left === 1 ? '' : 's'} left</span>`;
    }

    if (state.mode === 'nineball' || state.mode === 'sandbox') {
      return `<span class="group-badge">${modeDescriptor(state.mode).name.toUpperCase()}</span>`;
    }

    if (!info.group) return `<span class="group-badge">OPEN TABLE</span>`;
    const label = info.group === 'solid' ? 'SOLIDS' : 'STRIPES';
    return `<span class="group-badge ${info.group}"><i class="swatch-dot"></i>${label}</span>`;
  }

  /** Which balls to show as this player's row, per mode. */
  function ballRowIdsFor(state: GameState, seat: Seat): number[] | null {
    const info = state.players[seat];
    if (state.mode === 'rotation' || state.mode === 'killer' || state.mode === 'sandbox') return null;
    if (state.mode === 'cutthroat') return info.ownedBalls;
    if (state.mode === 'nineball') return [1, 2, 3, 4, 5, 6, 7, 8, 9];
    return info.group === 'solid' ? SOLID_IDS : info.group === 'stripe' ? STRIPE_IDS : null;
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

        // Modes without per-player ball ownership (killer, rotation) show status instead.
        const ids = ballRowIdsFor(state, seat);
        const showsRow = state.mode !== 'rotation' && state.mode !== 'killer' && state.mode !== 'sandbox';
        const ballRow = !showsRow
          ? ''
          : `<div class="ball-row">${
              ids
                ? ids
                    .map((id) => ballChipHtml(id, state.balls.find((b) => b.id === id)?.pocketed ?? true))
                    .join('')
                : Array.from({ length: 7 }, () => placeholderChipHtml()).join('')
            }</div>`;

        // Frames won so far, when this is a best-of rather than a single frame.
        const seriesTag = state.series
          ? `<span class="series-pill">${state.series.wins[seat] ?? 0}/${state.series.target}</span>`
          : '';

        return playerBannerHtml({
          seat,
          name: info.isBot ? `${name}${icon('bot', { size: 16, className: 'bot-mark' })}` : name,
          seatIndex: seatIndex(seat),
          loadout: info.loadout,
          striped: info.group === 'stripe',
          active,
          muted: !info.connected || info.eliminated,
          // Two scoring turns back to back and you're hot.
          onFire: (streaks[seat] ?? 0) >= 2 && state.phase !== 'game_over',
          extra: `<div style="display:flex; gap:0.35rem; align-items:center; flex-wrap:wrap">${groupBadge(
            state,
            seat
          )}${teamTag}${seriesTag}</div>${ballRow}`,
        });
      })
      .join('');
  }

  /** The live objective panel while a trick shot is in progress. */
  function renderChallengeHud(state: GameState): void {
    const challenge = activeChallenge(state);
    if (!challenge || !state.challenge || state.phase === 'game_over') {
      challengeHud.style.display = 'none';
      return;
    }

    const used = state.challenge.shotsUsed;
    const left = challenge.shotLimit - used;
    challengeHud.style.display = '';
    challengeHud.innerHTML = `
      <div class="challenge-name">${challenge.name}</div>
      <div class="challenge-objective">${challenge.brief}</div>
      <div class="challenge-shots ${left <= 1 ? 'critical' : ''}">
        ${icon('target', { size: 14 })} ${left} shot${left === 1 ? '' : 's'} left
        <span class="challenge-star-hint">${challenge.stars.three} for ★★★</span>
      </div>
      <div class="challenge-hint">${icon('sparkle', { size: 13 })} ${challenge.hint}</div>`;
  }

  /** Stars, rewards, and the retry/next controls once an attempt ends. */
  function renderChallengeResult(state: GameState): void {
    const challenge = activeChallenge(state);
    const progress = state.challenge;
    if (!challenge || !progress) return;

    const before = challengeStars(challenge.id);
    const result = recordChallengeStars(challenge.id, progress.stars, challenge.reward);
    const cleared = progress.stars > 0;

    const overlay = document.createElement('div');
    overlay.id = 'gameOverOverlay';
    overlay.className = 'overlay-center';
    overlay.innerHTML = `
      <div class="challenge-result">
        <h2>${cleared ? challenge.name : 'Not this time'}</h2>
        <div class="result-stars">
          ${[1, 2, 3]
            .map(
              (n) =>
                `<span class="star big${n <= progress.stars ? ' earned' : ''}">${icon('star', {
                  size: 40,
                })}</span>`
            )
            .join('')}
        </div>
        <p>${
          cleared
            ? `Cleared in ${progress.shotsUsed} shot${progress.shotsUsed === 1 ? '' : 's'}.`
            : (state.lastFoulReason ?? 'Out of shots.')
        }</p>
        ${
          result.firstClear
            ? `<p class="reward-earned">+${challenge.reward.xp} XP and ${challenge.reward.chalk} chalk</p>`
            : result.improved
              ? `<p class="reward-earned">New best — ${before} ★ to ${progress.stars} ★</p>`
              : ''
        }
        <div class="dialog-actions">
          <button id="retryChallenge">Try again</button>
          <button class="secondary" id="backToChallenges">All trick shots</button>
        </div>
      </div>`;
    root.appendChild(overlay);

    overlay.querySelector('#retryChallenge')!.addEventListener('click', () => {
      overlay.remove();
      socket.emit('hostStartChallenge', { challengeId: challenge.id });
    });
    overlay.querySelector('#backToChallenges')!.addEventListener('click', () => navigate('/challenges'));
  }

  /**
   * The centre callout: the one instruction the player has to act on right now.
   *
   * Ball-in-hand used to be a thin line of text at the very bottom of the screen — the one
   * place nobody is looking while the balls are on the table — so people missed their turn
   * entirely. It's now a card in the middle, with the cue ball drawn on it.
   */
  function renderCallout(state: GameState): void {
    const slot = root.querySelector<HTMLElement>('#callout')!;
    if (state.phase !== 'ball_in_hand') {
      slot.innerHTML = '';
      return;
    }
    const mine = ownedSeat === state.currentShooter;
    slot.innerHTML = `
      <div class="callout${mine ? ' actionable' : ''}">
        <span class="callout-ball"></span>
        <span class="callout-text">
          <b>Ball in hand</b>
          <small>${
            mine
              ? 'Click anywhere on the table to place the cue ball'
              : `${state.players[state.currentShooter].name} is placing the cue ball`
          }</small>
        </span>
      </div>`;
  }

  function renderBottomArea(state: GameState): void {
    bottomArea.innerHTML = '';

    if (state.phase === 'game_over') {
      if (root.querySelector('#gameOverOverlay')) return;
      // Challenges have their own result screen — stars, not a winner.
      if (state.mode === 'challenge') {
        renderChallengeResult(state);
        return;
      }
      renderGameOver(state);
    }
  }

  /**
   * The end-of-frame screen.
   *
   * It used to be a headline and a single Rematch button, which left the only way to change
   * anything — mode, players, match length — as leaving the table and starting again from a
   * new code. So it now shows what actually happened in the frame and offers the three things
   * anyone wants next: play it again, set it up differently, or stop.
   */
  function renderGameOver(state: GameState): void {
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

    // Series standing, when there's a match running rather than a one-off frame.
    const series = state.series;
    const seriesHtml = series
      ? `<div class="result-series">
           <span class="series-label">Frame ${series.frame} · first to ${series.target}</span>
           <div class="series-pips">
             ${state.seatOrder
               .map((s) => {
                 const won = series.wins[s] ?? 0;
                 return `<span class="series-row"><b>${state.players[s].name}</b>${Array.from(
                   { length: series.target },
                   (_, i) => `<i class="pip${i < won ? ' won' : ''}"></i>`
                 ).join('')}</span>`;
               })
               .join('')}
           </div>
         </div>`
      : '';

    // Per-player frame stats, from what the client watched happen rather than anything new
    // from the server. Rotation scores by ball value, so it gets its own column.
    const statRows = state.seatOrder
      .map((seat) => {
        const stats = frameStats[seat] ?? { pots: 0, shots: 0, bestCombo: 0 };
        const isWinner =
          state.mode === 'teams' && state.winningTeam
            ? state.players[seat].team === state.winningTeam
            : state.winner === seat;
        return `
          <tr class="${isWinner ? 'winner' : ''}">
            <td class="who">${isWinner ? icon('trophy', { size: 15 }) : ''}${state.players[seat].name}</td>
            <td>${stats.pots}</td>
            <td>${stats.shots}</td>
            <td>${stats.bestCombo > 1 ? `${stats.bestCombo}×` : '—'}</td>
            ${state.mode === 'rotation' ? `<td>${state.players[seat].score}</td>` : ''}
          </tr>`;
      })
      .join('');

    overlay.innerHTML = `
      <div class="result-card">
        <h2>${headline}</h2>
        ${state.lastFoulReason ? `<p class="result-reason">${state.lastFoulReason}</p>` : ''}
        ${seriesHtml}
        <table class="result-stats">
          <thead>
            <tr>
              <th>Player</th><th>Potted</th><th>Shots</th><th>Best</th>
              ${state.mode === 'rotation' ? '<th>Score</th>' : ''}
            </tr>
          </thead>
          <tbody>${statRows}</tbody>
        </table>
        <div id="rewardSlot"></div>
        <div class="result-actions">
          <button id="rematchBtn">${icon('replay', { size: 18 })}Play again</button>
          <button class="secondary" id="setupBtn">${icon('settings', { size: 18 })}Change setup</button>
          <button class="secondary" id="menuBtn">${icon('home', { size: 18 })}Main menu</button>
        </div>
      </div>`;
    root.appendChild(overlay);
    renderRewards(state, overlay.querySelector<HTMLElement>('#rewardSlot')!);

    overlay.querySelector('#rematchBtn')!.addEventListener('click', () => {
      socket.emit('requestRematch');
      resetFrameBookkeeping();
      overlay.remove();
    });
    overlay.querySelector('#setupBtn')!.addEventListener('click', () => {
      socket.emit('hostReturnToLobby');
      resetFrameBookkeeping();
      overlay.remove();
    });
    overlay.querySelector('#menuBtn')!.addEventListener('click', () => navigate('/'));
  }

  /** Clears everything scoped to a single frame, so the next one starts from zero. */
  function resetFrameBookkeeping(): void {
    rewardsShown = false;
    for (const seat of Object.keys(streaks)) streaks[seat] = 0;
    for (const seat of Object.keys(frameStats)) delete frameStats[seat];
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

      // Frame-level daily objectives resolve here, where the result is finally known.
      const vsBot = state.seatOrder.some((s) => state.players[s].isBot);
      const done = recordChallengeEvent({ frameWon: iWon, frameClean: !fouledThisFrame, vsBot });
      if (done.justCompleted) showChallengeToast(done.challenge.xp);
      fouledThisFrame = false;
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

  /** Celebration toast when the day's objective is met. */
  function showChallengeToast(xp: number): void {
    showToast(
      root.querySelector<HTMLElement>('#toastStack')!,
      `Daily challenge complete — +${xp} XP and a spin`,
      'reward',
      4000
    );
    if (settings.soundEnabled) sfx.playLevelUp(settings.soundVolume);
  }

  /**
   * Floats a reaction up off the sending player's banner. DOM rather than Pixi, same as the
   * combo callouts — the banners are already HTML, so this lands exactly where it should.
   */
  function showEmote(seat: Seat, emote: string): void {
    const panel = panelsEl.querySelector<HTMLElement>(`[data-seat="${seat}"]`);
    const el = document.createElement('div');
    el.className = 'emote-pop';
    el.textContent = emote;

    const box = panel?.getBoundingClientRect();
    el.style.left = `${box ? box.left + box.width / 2 : window.innerWidth / 2}px`;
    el.style.top = `${box ? box.bottom - 10 : 80}px`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2000);
  }

  /**
   * Drains the shot-clock ring each frame. The state carries an absolute deadline rather than
   * a countdown, so this never drifts from the server's own timer.
   */
  function tickShotClock(): void {
    cancelAnimationFrame(clockRaf);
    const clock = lastState?.shotClock;
    const ring = root.querySelector<HTMLElement>('#shotClock');
    if (!clock || !ring) {
      if (ring) ring.style.display = 'none';
      return;
    }

    let warned = false;
    const step = (): void => {
      const remaining = Math.max(0, clock.endsAt - Date.now()) / 1000;
      const ratio = Math.min(1, remaining / clock.seconds);
      ring.style.display = '';
      ring.style.setProperty('--clock', String(ratio));
      ring.dataset.urgent = remaining <= 5 ? 'true' : 'false';
      ring.textContent = String(Math.ceil(remaining));

      // A tick per second over the last five, so the pressure is audible as well as visible.
      if (remaining <= 5 && settings.soundEnabled && !warned) {
        warned = true;
        sfx.playWheelTick(settings.soundVolume);
        setTimeout(() => (warned = false), 950);
      }
      if (remaining > 0) clockRaf = requestAnimationFrame(step);
    };
    step();
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
      spinPad?.getValue() ?? ZERO_SPIN,
      lastAimPower,
      elevation?.getValue() ?? 0
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
    renderChallengeHud(state);
    tickShotClock();
    renderCallout(state);
    renderBottomArea(state);

    const canAim =
      ownedSeat !== null &&
      state.currentShooter === ownedSeat &&
      (state.phase === 'aiming' || state.phase === 'break');
    aimController?.setEnabled(canAim);
    hostPowerWrap.style.display = canAim ? '' : 'none';
    hostSpinWrap.style.display = canAim ? '' : 'none';
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
    else {
      drawLobby(rs);
      void showLobbyBackdrop();
      maybeAutostart(rs);
    }
  });

  socket.on('emote', ({ seat, emote }) => showEmote(seat, emote));

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
      if (settings.soundEnabled) {
        // The impact sound follows the shooter's equipped hit effect.
        sfx.playHitImpact(
          renderer?.currentHitEffectId() ?? 'hit.spark',
          settings.soundVolume,
          ev.impulse / 1500
        );
      }
      renderer?.spawnSparks(ev.pos, ev.impulse, ev.a, ev.b);
    } else if (ev.type === 'cushion') {
      if (settings.soundEnabled) sfx.playCushionThud(settings.soundVolume);
      renderer?.spawnCushionDust(ev.pos, ev.speed);
    } else if (ev.type === 'pot') {
      lastPotPos = ev.pos;
      // The celebrator owns the pot flash, combo callouts, sound and XP toasts.
      celebrator?.onPot(ev.pos, ev.ballId);
    } else if (ev.type === 'miscue') {
      // Say so out loud. A miscue looks identical to a badly played shot from the outside, and
      // "the game is broken" is the wrong lesson to take from striking too far off centre.
      showToast(root.querySelector<HTMLElement>('#toastStack')!, 'Miscue! Struck too far off centre', 'foul');
      if (settings.soundEnabled) sfx.playMiscue(settings.soundVolume);
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

    const tally = (frameStats[shotSeat] ??= { pots: 0, shots: 0, bestCombo: 0 });
    tally.shots++;
    tally.pots += summary.pots;
    tally.bestCombo = Math.max(tally.bestCombo, summary.pots);

    const shooterIsOurs = lastState?.players[shotSeat]?.isHost ?? false;
    if (shooterIsOurs) {
      if (summary.pots > 0) {
        grantXp(summary.xp);
        recordStats({ pots: summary.pots, bestCombo: summary.bestCombo });
      }
      if (summary.pots === 0 || lastState?.lastFoulReason) fouledThisFrame = true;
      const result = recordChallengeEvent({
        potsThisShot: summary.pots,
        scoringStreak: streaks[shotSeat],
      });
      if (result.justCompleted) showChallengeToast(result.challenge.xp);
    }

    if (lastState) applyState(lastState);
    shotSeat = null;
  }

  socket.on('errorMessage', (msg) => {
    showToast(root.querySelector<HTMLElement>('#toastStack')!, msg, 'foul');
  });

  return () => {
    socket.off('roomState');
    socket.off('gameState');
    socket.off('aimUpdate');
    socket.off('shotFired');
    socket.off('simEvent');
    socket.off('errorMessage');
    socket.off('emote');
    cancelAnimationFrame(clockRaf);
    for (const undo of cleanups) undo();
    aimController?.destroy();
    renderer?.destroy();
  };
}
