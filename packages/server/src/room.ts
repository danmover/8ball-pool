import type { Server } from 'socket.io';
import {
  BALL_RADIUS,
  BROADCAST_HZ,
  CUE_BALL_ID,
  DEFAULT_LOBBY,
  DEFAULT_SETTINGS,
  EMOTES,
  EMOTE_COOLDOWN_MS,
  MAX_SEATS,
  clampPlayerCount,
  modeDescriptor,
  applyCueStrike,
  restBall,
  TABLE_LENGTH,
  TABLE_WIDTH,
  Vec2,
  challengeBalls,
  challengeById,
  createInitialGameState,
  isGroupCleared,
  lowestBallId,
  resolveShot,
  seatId,
  stepSimulation,
  summarizeShot,
} from '@8ball/shared';
import type {
  AimInput,
  BallInHandPlacement,
  BotDifficulty,
  ClientToServerEvents,
  GameState,
  Loadout,
  LobbySettings,
  PlayerSettings,
  RoomStateDTO,
  Seat,
  ServerToClientEvents,
  ShootInput,
  SimEvent,
} from '@8ball/shared';
import { generateToken } from './roomCode.js';
import { BotPlayer } from './bot.js';

type IoServer = Server<ClientToServerEvents, ServerToClientEvents>;

export interface Connection {
  seat: Seat;
  socketId: string | null;
  token: string;
  settings: PlayerSettings;
  /** Cosmetics this player brought with them; mirrored into PlayerInfo for broadcast. */
  loadout: Loadout;
  /** Present when this seat is played by the computer. */
  bot?: BotPlayer;
}

export class Room {
  code: string;
  io: IoServer;
  gameState: GameState;
  connections = new Map<Seat, Connection>();
  lobby: LobbySettings = { ...DEFAULT_LOBBY };
  started = false;
  hostSocketId: string | null = null;
  hostToken: string;
  spectatorSocketIds = new Set<string>();

  private preShotGroupCleared = false;
  private preShotLowestBall: number | null = null;
  private shotEvents: SimEvent[] = [];
  private loopHandle: ReturnType<typeof setInterval> | null = null;
  private shotClockHandle: ReturnType<typeof setTimeout> | null = null;
  private botHandle: ReturnType<typeof setTimeout> | null = null;
  /** Spectator sockets in arrival order, so the longest waiting is seated first. */
  private spectatorQueue: string[] = [];
  private lastEmoteAt = new Map<Seat, number>();

  constructor(code: string, io: IoServer, hostToken: string) {
    this.code = code;
    this.io = io;
    this.hostToken = hostToken;
    this.gameState = createInitialGameState(this.lobby.mode, this.defaultNames());
  }

  private defaultNames(): string[] {
    return Array.from({ length: this.lobby.maxPlayers }, (_, i) => `Player ${i + 1}`);
  }

  /** All seat ids this lobby currently allows, whether occupied or not. */
  seats(): Seat[] {
    return Array.from({ length: this.lobby.maxPlayers }, (_, i) => seatId(i));
  }

  roomStateDTO(): RoomStateDTO {
    const players: Record<Seat, ReturnType<() => GameState['players'][string]> | null> = {};
    for (const seat of this.seats()) {
      players[seat] = this.connections.has(seat) ? this.gameState.players[seat] ?? null : null;
    }
    return {
      code: this.code,
      lobby: { ...this.lobby },
      started: this.started,
      players,
      spectatorCount: this.spectatorSocketIds.size,
    };
  }

  updateLobby(patch: Partial<LobbySettings>): void {
    if (this.started) return;
    if (patch.mode) this.lobby.mode = patch.mode;
    if (patch.shotClockSeconds !== undefined) {
      this.lobby.shotClockSeconds =
        patch.shotClockSeconds === null
          ? null
          : Math.max(5, Math.min(120, Math.round(patch.shotClockSeconds)));
    }
    if (patch.seriesTarget !== undefined) {
      this.lobby.seriesTarget = Math.max(1, Math.min(9, Math.round(patch.seriesTarget)));
    }
    if (patch.maxPlayers !== undefined) {
      const clamped = Math.max(2, Math.min(MAX_SEATS, Math.round(patch.maxPlayers)));
      // Never shrink below the seats people have already taken.
      const occupied = [...this.connections.keys()].length;
      this.lobby.maxPlayers = Math.max(clamped, occupied);
    }
    // Each mode seats a different range — cutthroat tops out at 5, classic is strictly 1v1.
    this.lobby.maxPlayers = Math.max(
      clampPlayerCount(this.lobby.mode, this.lobby.maxPlayers),
      Math.min(MAX_SEATS, this.connections.size)
    );
    // Teams mode needs an even split to alternate cleanly around the table.
    if (this.lobby.mode === 'teams' && this.lobby.maxPlayers % 2 !== 0) {
      this.lobby.maxPlayers = Math.min(MAX_SEATS, this.lobby.maxPlayers + 1);
    }
    // A mode with no shot clock support can't carry one.
    if (!modeDescriptor(this.lobby.mode).supportsShotClock) this.lobby.shotClockSeconds = null;
    this.rebuildGameState();
    this.broadcastRoomState();
    this.broadcastGameState();
  }

  /**
   * Re-creates the game for the current lobby shape, preserving who's connected. Carries the
   * series across, since changing the rack shouldn't wipe the running match score.
   */
  private rebuildGameState(startingIndex = 0): void {
    const names = this.seats().map(
      (seat, i) => this.gameState.players[seat]?.name ?? `Player ${i + 1}`
    );
    const series = this.gameState.series;
    const next = createInitialGameState(this.lobby.mode, names, startingIndex);
    for (const seat of next.seatOrder) {
      const conn = this.connections.get(seat);
      const prev = this.gameState.players[seat];
      next.players[seat].connected = Boolean(conn && (conn.socketId || conn.bot));
      next.players[seat].isHost = prev?.isHost ?? false;
      if (prev?.name) next.players[seat].name = prev.name;
      next.players[seat].loadout = { ...(conn?.loadout ?? prev?.loadout ?? {}) };
      next.players[seat].isBot = Boolean(conn?.bot);
      next.players[seat].botDifficulty = conn?.bot?.difficulty ?? null;
    }
    next.series =
      this.lobby.seriesTarget > 1
        ? series ?? { target: this.lobby.seriesTarget, frame: 1, wins: {} }
        : null;
    if (next.series) next.series.target = this.lobby.seriesTarget;
    this.gameState = next;
  }

  startGame(): void {
    if (this.started) return;
    this.started = true;
    this.rebuildGameState();
    this.broadcastRoomState();
    this.broadcastGameState();
    this.onTurnReady();
  }

  /**
   * Reopens the lobby after a game, so the table can be set up differently without everyone
   * having to leave and rejoin with a new code. Seats, names and cosmetics all stay put; only
   * the frame is thrown away.
   */
  returnToLobby(): void {
    if (!this.started) return;
    this.clearShotClock();
    this.clearBotTimer();
    this.started = false;
    // Series score doesn't survive a trip back to the lobby — you're setting up a new match.
    this.gameState.series = null;
    this.rebuildGameState();
    this.broadcastRoomState();
    this.broadcastGameState();
  }

  broadcastRoomState(): void {
    this.io.to(this.code).emit('roomState', this.roomStateDTO());
  }

  broadcastGameState(): void {
    this.io.to(this.code).emit('gameState', this.gameState);
  }

  claimSeat(
    seat: Seat,
    name: string,
    socketId: string,
    isHost: boolean,
    loadout: Loadout = {}
  ): { token: string } {
    const token = generateToken();
    this.connections.set(seat, {
      seat,
      socketId,
      token,
      settings: { ...DEFAULT_SETTINGS },
      loadout: { ...loadout },
    });
    const existing = this.gameState.players[seat];
    this.gameState.players[seat] = {
      seat,
      name,
      connected: true,
      isHost,
      group: existing?.group ?? null,
      team: existing?.team ?? null,
      score: existing?.score ?? 0,
      loadout: { ...loadout },
      lives: existing?.lives ?? null,
      ownedBalls: existing?.ownedBalls ?? [],
      eliminated: existing?.eliminated ?? false,
      isBot: false,
      botDifficulty: null,
    };
    return { token };
  }

  /**
   * Seats a bot. It takes an ordinary `Connection` with a null socket, so seat logic, turn
   * order, loadouts and the scoreboard need no special-casing anywhere else.
   */
  addBot(seat: Seat, difficulty: BotDifficulty): void {
    if (this.connections.has(seat) || !this.seats().includes(seat)) return;
    const takenNames = [...this.connections.keys()].map((s) => this.gameState.players[s]?.name ?? '');
    const bot = new BotPlayer(difficulty, takenNames);
    this.connections.set(seat, {
      seat,
      socketId: null,
      token: generateToken(),
      settings: { ...DEFAULT_SETTINGS },
      loadout: bot.loadout,
      bot,
    });
    const existing = this.gameState.players[seat];
    this.gameState.players[seat] = {
      seat,
      name: bot.name,
      connected: true,
      isHost: false,
      group: existing?.group ?? null,
      team: existing?.team ?? null,
      score: 0,
      loadout: bot.loadout,
      lives: existing?.lives ?? null,
      ownedBalls: existing?.ownedBalls ?? [],
      eliminated: false,
      isBot: true,
      botDifficulty: difficulty,
    };
    this.broadcastRoomState();
    this.broadcastGameState();
    this.onTurnReady();
  }

  removeBot(seat: Seat): void {
    if (!this.connections.get(seat)?.bot) return;
    this.releaseSeat(seat);
    this.broadcastRoomState();
    this.broadcastGameState();
  }

  /**
   * Loads a trick-shot challenge: fixed layout, fresh progress, one seat.
   *
   * Retrying is the same call, which keeps "start" and "retry" from drifting apart — the
   * commonest way a puzzle mode ends up with stale state between attempts.
   */
  startChallenge(challengeId: string): void {
    const challenge = challengeById(challengeId);
    if (!challenge) return;

    this.lobby.mode = 'challenge';
    this.lobby.maxPlayers = 1;
    this.lobby.shotClockSeconds = null;
    this.started = true;

    const name = this.gameState.players.p1?.name ?? 'Player';
    const next = createInitialGameState('challenge', [name]);
    next.balls = challengeBalls(challenge);
    next.phase = 'aiming';
    next.challenge = {
      challengeId,
      shotsUsed: 0,
      pottedOrder: [],
      stars: 0,
      failed: false,
    };

    const conn = this.connections.get('p1');
    next.players.p1.connected = Boolean(conn && (conn.socketId || conn.bot));
    next.players.p1.isHost = this.gameState.players.p1?.isHost ?? true;
    next.players.p1.loadout = { ...(conn?.loadout ?? {}) };

    this.gameState = next;
    this.clearShotClock();
    this.clearBotTimer();
    this.broadcastRoomState();
    this.broadcastGameState();
  }

  /** A player changed cosmetics mid-session; push it straight out to the table. */
  setLoadout(seat: Seat, loadout: Loadout): void {
    const conn = this.connections.get(seat);
    if (!conn) return;
    conn.loadout = { ...loadout };
    const player = this.gameState.players[seat];
    if (player) player.loadout = { ...loadout };
    this.broadcastRoomState();
    this.broadcastGameState();
  }

  releaseSeat(seat: Seat): void {
    this.connections.delete(seat);
    const player = this.gameState.players[seat];
    if (player) {
      player.connected = false;
      player.isHost = false;
    }
  }

  findSeatByToken(token: string): Seat | null {
    for (const [seat, conn] of this.connections) {
      if (conn.token === token) return seat;
    }
    return null;
  }

  reconnectSeat(seat: Seat, socketId: string): void {
    const conn = this.connections.get(seat);
    if (!conn) return;
    conn.socketId = socketId;
    const player = this.gameState.players[seat];
    if (player) player.connected = true;
  }

  disconnectSocket(socketId: string): void {
    if (this.hostSocketId === socketId) this.hostSocketId = null;
    for (const [seat, conn] of this.connections) {
      if (conn.socketId === socketId) {
        conn.socketId = null;
        const player = this.gameState.players[seat];
        if (player) player.connected = false;
      }
    }
    this.spectatorSocketIds.delete(socketId);
    this.spectatorQueue = this.spectatorQueue.filter((id) => id !== socketId);
    this.broadcastRoomState();
    this.offerSeatToSpectator();
  }

  openSeat(): Seat | null {
    return this.seats().find((seat) => !this.connections.has(seat)) ?? null;
  }

  seatSettings(seat: Seat): PlayerSettings | undefined {
    return this.connections.get(seat)?.settings;
  }

  canAct(seat: Seat): boolean {
    return (
      this.gameState.currentShooter === seat &&
      (this.gameState.phase === 'aiming' || this.gameState.phase === 'break')
    );
  }

  handleAim(input: AimInput): void {
    if (!this.canAct(input.seat)) return;
    this.io.to(this.code).emit('aimUpdate', input);
  }

  handleShoot(input: ShootInput): void {
    if (!this.canAct(input.seat)) return;
    const cue = this.gameState.balls.find((b) => b.id === CUE_BALL_ID);
    if (!cue || cue.pocketed) return;

    this.clearShotClock();
    this.clearBotTimer();
    this.preShotGroupCleared = isGroupCleared(this.gameState, input.seat);
    this.preShotLowestBall = lowestBallId(this.gameState);
    // The whole shot — speed, spin, everything — comes out of where the tip meets the ball.
    // `input.spin` is that contact point, straight off the spin pad.
    const strike = applyCueStrike(cue, input.angle, input.power, input.spin);

    this.gameState.phase = 'shot_in_progress';
    this.shotEvents = [];
    // Tell everyone the tip slipped, or the shot just looks broken rather than risky.
    if (strike.miscued) this.io.to(this.code).emit('simEvent', { type: 'miscue' });
    this.io.to(this.code).emit('shotFired', input);
    this.broadcastGameState();
    this.startSimLoop();
  }

  handlePlaceCueBall(payload: BallInHandPlacement): void {
    if (this.gameState.phase !== 'ball_in_hand' || this.gameState.currentShooter !== payload.seat) return;
    const { x, y } = payload.pos;
    const seatSocket = this.connections.get(payload.seat)?.socketId;

    if (x < BALL_RADIUS || x > TABLE_LENGTH - BALL_RADIUS || y < BALL_RADIUS || y > TABLE_WIDTH - BALL_RADIUS) {
      if (seatSocket) this.io.to(seatSocket).emit('errorMessage', 'Cue ball must stay on the table.');
      return;
    }
    const overlaps = this.gameState.balls.some(
      (b) => !b.pocketed && b.id !== CUE_BALL_ID && Vec2.distance(b.pos, payload.pos) < BALL_RADIUS * 2
    );
    if (overlaps) {
      if (seatSocket) this.io.to(seatSocket).emit('errorMessage', "Can't place the cue ball there.");
      return;
    }

    const cue = this.gameState.balls.find((b) => b.id === CUE_BALL_ID)!;
    cue.pos = { x, y };
    restBall(cue);
    cue.pocketed = false;
    this.gameState.phase = 'aiming';
    this.broadcastGameState();
    this.onTurnReady();
  }

  requestRematch(): void {
    if (this.gameState.phase !== 'game_over') return;
    const prev = this.gameState;
    // A finished series has to be reset explicitly rather than rolling into frame 9 of 5.
    const seriesOver =
      prev.series !== null &&
      Object.values(prev.series.wins).some((w) => w >= prev.series!.target);

    // Rotate who breaks so the same seat doesn't always open.
    const nextBreakIndex = (prev.seatOrder.indexOf(prev.currentShooter) + 1) % prev.seatOrder.length;
    const next = createInitialGameState(
      this.lobby.mode,
      prev.seatOrder.map((seat) => prev.players[seat].name),
      nextBreakIndex
    );
    for (const seat of next.seatOrder) {
      const before = prev.players[seat];
      if (!before) continue;
      next.players[seat].connected = before.connected;
      next.players[seat].isHost = before.isHost;
      next.players[seat].loadout = { ...before.loadout };
      next.players[seat].isBot = before.isBot;
      next.players[seat].botDifficulty = before.botDifficulty;
    }

    if (prev.series && !seriesOver) {
      next.series = { ...prev.series, frame: prev.series.frame + 1, wins: { ...prev.series.wins } };
    } else if (this.lobby.seriesTarget > 1) {
      next.series = { target: this.lobby.seriesTarget, frame: 1, wins: {} };
    }

    this.gameState = next;
    this.broadcastGameState();
    this.onTurnReady();
  }

  // ---- Shot clock ----

  /**
   * Called whenever the table becomes someone's to shoot at. Starts (or restarts) the clock
   * and, if that someone is a bot, schedules its shot. One entry point means the two can
   * never disagree about whose turn it is.
   */
  private onTurnReady(): void {
    this.clearShotClock();
    this.clearBotTimer();
    if (!this.started) return;

    const { phase, currentShooter } = this.gameState;
    if (phase !== 'aiming' && phase !== 'break' && phase !== 'ball_in_hand') return;

    const seconds = this.lobby.shotClockSeconds;
    if (seconds && modeDescriptor(this.gameState.mode).supportsShotClock) {
      this.gameState.shotClock = { endsAt: Date.now() + seconds * 1000, seconds };
      this.shotClockHandle = setTimeout(() => this.onShotClockExpired(), seconds * 1000);
      this.broadcastGameState();
    } else {
      this.gameState.shotClock = null;
    }

    const bot = this.connections.get(currentShooter)?.bot;
    if (bot) this.scheduleBotTurn(bot, currentShooter);
  }

  private onShotClockExpired(): void {
    this.shotClockHandle = null;
    const { phase } = this.gameState;
    if (phase !== 'aiming' && phase !== 'break' && phase !== 'ball_in_hand') return;

    // Time-out is a foul: resolve it as a shot that never touched anything.
    this.gameState.shotClock = null;
    resolveShot(
      this.gameState,
      {
        potted: [],
        cueBallPocketed: false,
        eightBallPocketed: false,
        firstBallContacted: null,
        anyCushionAfterContact: false,
        cushionsBeforeContact: 0,
      },
      isGroupCleared(this.gameState, this.gameState.currentShooter),
      lowestBallId(this.gameState),
      true
    );
    this.io.to(this.code).emit('simEvent', { type: 'shotSettled' });
    this.broadcastGameState();
    this.onTurnReady();
  }

  private clearShotClock(): void {
    if (this.shotClockHandle) {
      clearTimeout(this.shotClockHandle);
      this.shotClockHandle = null;
    }
    this.gameState.shotClock = null;
  }

  // ---- Bots ----

  private scheduleBotTurn(bot: BotPlayer, seat: Seat): void {
    const delay = bot.thinkingTimeMs();
    this.botHandle = setTimeout(() => {
      this.botHandle = null;
      if (this.gameState.currentShooter !== seat) return;

      if (this.gameState.phase === 'ball_in_hand') {
        const pos = bot.chooseCueBallPlacement(this.gameState);
        this.handlePlaceCueBall({ seat, pos });
        return; // handlePlaceCueBall re-enters onTurnReady, which schedules the shot
      }

      // The top tiers search by simulating candidate shots, which takes real time and yields
      // between candidates so other rooms keep ticking. By the time it resolves the turn may
      // have moved on — a shot clock expiry, a player leaving — so re-check before acting.
      void bot.chooseShot(this.gameState, seat).then((shot) => {
        if (this.gameState.currentShooter !== seat) return;
        if (this.gameState.phase !== 'aiming' && this.gameState.phase !== 'break') return;
        // Stream the aim first so the table shows the bot lining up, exactly like a human —
        // including the spin it has chosen, so the guide on screen matches the shot it takes.
        this.handleAim({ seat, angle: shot.angle, spin: shot.spin });
        setTimeout(() => this.handleShoot({ seat, ...shot }), 450);
      });
    }, delay);
  }

  private clearBotTimer(): void {
    if (this.botHandle) {
      clearTimeout(this.botHandle);
      this.botHandle = null;
    }
  }

  // ---- Emotes ----

  /** Relays a reaction to the room, rate-limited so it can't be spammed over the table. */
  handleEmote(seat: Seat, emote: string): void {
    if (!(EMOTES as readonly string[]).includes(emote)) return;
    const now = Date.now();
    if (now - (this.lastEmoteAt.get(seat) ?? 0) < EMOTE_COOLDOWN_MS) return;
    this.lastEmoteAt.set(seat, now);
    this.io.to(this.code).emit('emote', { seat, emote });
  }

  // ---- Spectators ----

  addSpectator(socketId: string): void {
    this.spectatorSocketIds.add(socketId);
    if (!this.spectatorQueue.includes(socketId)) this.spectatorQueue.push(socketId);
    this.broadcastRoomState();
  }

  /** Offers a freed seat to the spectator who has been waiting longest. */
  private offerSeatToSpectator(): void {
    const seat = this.openSeat();
    if (!seat) return;
    const next = this.spectatorQueue.find((id) => this.spectatorSocketIds.has(id));
    if (!next) return;
    this.io.to(next).emit('seatAvailable', { seat });
  }

  private startSimLoop(): void {
    if (this.loopHandle) return;
    const dt = 1 / BROADCAST_HZ;
    this.loopHandle = setInterval(() => {
      const { events, settled } = stepSimulation(this.gameState.balls, dt);
      this.shotEvents.push(...events);
      for (const ev of events) this.io.to(this.code).emit('simEvent', ev);
      this.broadcastGameState();

      if (settled) {
        this.stopSimLoop();
        const outcome = summarizeShot(this.shotEvents);
        resolveShot(this.gameState, outcome, this.preShotGroupCleared, this.preShotLowestBall);
        if (this.gameState.phase === 'game_over') this.recordFrameResult();
        this.broadcastGameState();
        this.onTurnReady();
      }
    }, 1000 / BROADCAST_HZ);
  }

  /** Banks a frame win into the running series, if there is one. */
  private recordFrameResult(): void {
    const { series, winner } = this.gameState;
    if (!series || !winner) return;
    series.wins[winner] = (series.wins[winner] ?? 0) + 1;
  }

  private stopSimLoop(): void {
    if (this.loopHandle) {
      clearInterval(this.loopHandle);
      this.loopHandle = null;
    }
  }

  destroy(): void {
    this.stopSimLoop();
    this.clearShotClock();
    this.clearBotTimer();
  }
}
