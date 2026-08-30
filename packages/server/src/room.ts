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
  ABANDON_GRACE_MS,
  OPEN_TABLE_ADVANCE_MS,
  endGame,
  createTournament,
  newRound,
  placeBet,
  settle,
  applyPickup,
  splitModifiers,
  NO_MODIFIERS,
  modeDescriptor,
  nextMatch,
  recordFrameWin,
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
  Tournament,
  KingOfTable,
  ShotModifiers,
  BettingRound,
  Governance,
  TableVisibility,
  TableSummary,
} from '@8ball/shared';
import { HEAD_STRING_X, RULE_SETS } from '@8ball/shared';
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
  /**
   * Who is allowed to change this table.
   *
   * `host` is the party shape: one screen owns the room and everyone else is a controller.
   * `open` is the online shape — **nobody is privileged**. Settings are fixed when the table is
   * made and the game starts itself once the seats fill.
   *
   * There is deliberately no host migration. An open table has no authority to hand over when
   * someone leaves, which removes a whole class of edge case rather than solving it.
   */
  governance: Governance = 'host';
  /** Listed publicly, or only reachable by code. Open tables only. */
  visibility: TableVisibility = 'private';
  /** When this table was created — the public list shows the freshest first. */
  readonly createdAt = Date.now();
  /**
   * Counts toward the players' ratings.
   *
   * Only ever set on two-seat open tables. A rating is a statement about one player against
   * one other, and there is no honest way to read a four-way frame as that.
   */
  ranked = false;
  /** Profile token per seat, set by `identify`. Ranked results are written against these. */
  playerTokens = new Map<Seat, string>();
  /** Runs a knockout rather than a single frame. Open tables only. */
  isTournament = false;
  /** The scheduled event this table is running, when it is one. */
  eventId: string | null = null;
  /** Frames to take a match, when this is a tournament. */
  tournamentTarget = 1;

  /**
   * Fixes how many are in the draw, as distinct from how many a *match* seats.
   *
   * The same distinction the party bracket needed: eight-ball seats exactly two, so using the
   * lobby's player limit for both turns an eight-entrant knockout into a single final.
   */
  setTournamentEntrants(count: number): void {
    this.tournamentEntrants = Math.max(2, Math.min(MAX_SEATS, Math.round(count)));
  }
  /** Called when a ranked frame settles, so the server can write the result it refereed. */
  onRankedResult:
    | ((winner: { seat: Seat; token: string; name: string }, loser: { seat: Seat; token: string; name: string }) => void)
    | null = null;

  private preShotGroupCleared = false;
  /** The ball and pocket nominated for the shot in flight, when call shot is on. */
  private preShotCall: { ballId: number; pocketIndex: number } | null = null;
  private preShotLowestBall: number | null = null;
  private shotEvents: SimEvent[] = [];
  private loopHandle: ReturnType<typeof setInterval> | null = null;
  private shotClockHandle: ReturnType<typeof setTimeout> | null = null;
  private botHandle: ReturnType<typeof setTimeout> | null = null;
  /** Spectator sockets in arrival order, so the longest waiting is seated first. */
  private spectatorQueue: string[] = [];
  /** The knockout in progress, when this room is running one. */
  private tournament: Tournament | null = null;
  /** Entrants in the knockout, which is independent of how many a *match* seats. */
  private tournamentEntrants: number | null = null;
  private king: KingOfTable | null = null;
  /** Power-up effects banked per seat, cashed when that seat next shoots. */
  private pendingModifiers = new Map<Seat, ShotModifiers>();
  /** The book on the current frame. Spectators only; the players themselves cannot bet. */
  private betting: BettingRound = newRound();
  private kingSeats: number | null = null;
  private lastEmoteAt = new Map<Seat, number>();
  /** Seats on a disconnection countdown, with the timer that will forfeit them. */
  private forfeitTimers = new Map<Seat, ReturnType<typeof setTimeout>>();
  /** Pending auto-advance to the next frame on an open table. */
  private advanceHandle: ReturnType<typeof setTimeout> | null = null;

  constructor(code: string, io: IoServer, hostToken: string) {
    this.code = code;
    this.io = io;
    this.hostToken = hostToken;
    this.gameState = createInitialGameState(this.lobby.mode, this.defaultNames());
  }

  /**
   * May this socket change the table's setup — settings, seats, bots, starting?
   *
   * The one predicate the fourteen scattered `hostSocketId !== socket.id` checks collapse into.
   * On an open table it is false for everyone, including whoever made it: an online table's
   * rules are decided once, at creation, and then it is just a table.
   */
  canConfigure(socketId: string): boolean {
    if (this.governance === 'open') return false;
    return this.hostSocketId === socketId;
  }

  /** Mean rating of the seated players, for the list. Null when nobody is seated. */
  averageRating: number | null = null;

  /** How many seats currently have somebody (or some bot) in them. */
  filledSeats(): number {
    return this.seats().filter((seat) => this.connections.has(seat)).length;
  }

  /** A row in the public table list. */
  summary(): TableSummary {
    return {
      code: this.code,
      mode: this.lobby.mode,
      ruleSet: this.lobby.ruleSet,
      ranked: this.ranked,
      averageRating: this.averageRating,
      tournament: this.isTournament,
      eventId: this.eventId,
      seatsFilled: this.filledSeats(),
      seatsTotal: this.seats().length,
      inPlay: this.started,
      spectators: this.spectatorSocketIds.size,
      createdAt: this.createdAt,
    };
  }

  private defaultNames(): string[] {
    return Array.from({ length: this.lobby.maxPlayers }, (_, i) => `Player ${i + 1}`);
  }

  /**
   * All seat ids this lobby currently allows, whether occupied or not.
   *
   * A tournament overrides the mode's own limit, because those are two different numbers that
   * `maxPlayers` was quietly serving both of: how many people are *in* the event, and how many
   * play at once. Eight-ball is strictly 1v1, which is exactly right for a match and exactly
   * wrong for a bracket — asking for eight entrants otherwise silently produced a one-match
   * "tournament" between the first two.
   */
  seats(): Seat[] {
    const count = this.tournamentEntrants ?? this.kingSeats ?? this.lobby.maxPlayers;
    return Array.from({ length: count }, (_, i) => seatId(i));
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
      governance: this.governance,
      visibility: this.visibility,
    };
  }

  updateLobby(patch: Partial<LobbySettings>): void {
    if (this.started) return;
    // An open table's settings are decided once, when it is made. Nobody at it has the standing
    // to change the rules on everyone else half way through the evening.
    if (this.governance === 'open') return;
    if (patch.mode) this.lobby.mode = patch.mode;
    if (patch.ruleSet && RULE_SETS[patch.ruleSet]) this.lobby.ruleSet = patch.ruleSet;
    if (patch.shotClockSeconds !== undefined) {
      this.lobby.shotClockSeconds =
        patch.shotClockSeconds === null
          ? null
          : Math.max(5, Math.min(120, Math.round(patch.shotClockSeconds)));
    }
    if (patch.handicaps !== undefined) {
      // Replace wholesale rather than merge: the lobby UI always sends the full picture, and a
      // merge would make "remove this player's handicap" impossible to express.
      this.lobby.handicaps = {};
      for (const [seat, h] of Object.entries(patch.handicaps)) {
        if (!h) continue;
        this.lobby.handicaps[seat] = {
          spots: Math.max(0, Math.min(3, Math.round(h.spots))),
          shotClockSeconds:
            h.shotClockSeconds === null || h.shotClockSeconds === undefined
              ? null
              : Math.max(5, Math.min(120, Math.round(h.shotClockSeconds))),
        };
      }
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
    const next = createInitialGameState(this.lobby.mode, names, startingIndex, this.lobby.ruleSet);
    for (const seat of next.seatOrder) {
      const conn = this.connections.get(seat);
      const prev = this.gameState.players[seat];
      next.players[seat].connected = Boolean(conn && (conn.socketId || conn.bot));
      next.players[seat].isHost = prev?.isHost ?? false;
      if (prev?.name) next.players[seat].name = prev.name;
      next.players[seat].loadout = { ...(conn?.loadout ?? prev?.loadout ?? {}) };
      next.players[seat].isBot = Boolean(conn?.bot);
      next.players[seat].botDifficulty = conn?.bot?.difficulty ?? null;
      // Handicap tokens refill every frame — a spot you didn't need last frame isn't banked.
      next.players[seat].spotsLeft = this.lobby.handicaps[seat]?.spots ?? 0;
    }
    // A new rack clears every banked power-up: an effect armed last frame has nothing to act on.
    this.pendingModifiers.clear();
    // And re-opens the book. Stakes from a frame that no longer exists cannot be settled.
    if (!this.betting.open) this.betting = newRound();
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
    this.gameState.tournament = null;
    this.tournament = null;
    this.tournamentEntrants = null;
    this.gameState.king = null;
    this.king = null;
    this.kingSeats = null;
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
      spotsLeft: this.lobby.handicaps[seat]?.spots ?? 0,
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
      spotsLeft: this.lobby.handicaps[seat]?.spots ?? 0,
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

  /**
   * Gives up a seat on purpose.
   *
   * Distinct from `disconnectSocket`, which is the network dropping. Somebody who has told us
   * they are leaving does not get a thirty-second countdown — that grace exists for people who
   * are trying to come back.
   */
  leaveSeat(seat: Seat): void {
    this.cancelForfeitCountdown(seat);
    if (this.started && this.governance === 'open' && this.gameState.phase !== 'game_over') {
      this.forfeitSeat(seat);
      return;
    }
    this.releaseSeat(seat);
    this.broadcastRoomState();
    this.broadcastGameState();
  }

  /**
   * Re-creates the game for settings that were just set directly.
   *
   * `updateLobby` is the party path and refuses to run on an open table by design; this is the
   * one-time application of settings an open table is *created* with.
   */
  rebuildForLobby(): void {
    this.rebuildGameState();
    this.broadcastRoomState();
    this.broadcastGameState();
  }

  findSeatByToken(token: string): Seat | null {
    for (const [seat, conn] of this.connections) {
      if (conn.token === token) return seat;
    }
    return null;
  }

  reconnectSeat(seat: Seat, socketId: string): void {
    this.cancelForfeitCountdown(seat);
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
        this.beginForfeitCountdown(seat);
      }
    }
    this.spectatorSocketIds.delete(socketId);
    this.spectatorQueue = this.spectatorQueue.filter((id) => id !== socketId);
    this.broadcastRoomState();
    this.offerSeatToSpectator();
  }

  /**
   * Starts the clock on a seat whose player has vanished.
   *
   * Only on a live open table. In a party room a phone locking its screen is completely normal
   * and forfeiting the frame for it would be absurd — there, the person is still standing next
   * to the television. Online there is nobody to ask, so a table cannot be allowed to sit dead
   * for ever waiting on someone who has closed the tab.
   */
  private beginForfeitCountdown(seat: Seat): void {
    if (this.governance !== 'open') return;
    if (this.gameState.phase === 'game_over') return;
    if (this.connections.get(seat)?.bot) return;
    if (this.forfeitTimers.has(seat)) return;

    const forfeitsAt = Date.now() + ABANDON_GRACE_MS;
    const name = this.gameState.players[seat]?.name ?? seat;
    this.io.to(this.code).emit('seatDisconnected', { seat, name, forfeitsAt });

    const timer = setTimeout(() => {
      this.forfeitTimers.delete(seat);
      if (this.started) {
        this.forfeitSeat(seat);
        return;
      }
      // Not started yet, so there is no frame to forfeit — the seat simply opens up again.
      //
      // Without this, somebody who joins a public table and closes the tab holds a chair for
      // ever: the table fills with ghosts, never starts, and quick play keeps sending people
      // into it. That is exactly what happened the first time this was run for real.
      this.releaseSeat(seat);
      this.broadcastRoomState();
      this.broadcastGameState();
    }, ABANDON_GRACE_MS);
    timer.unref?.();
    this.forfeitTimers.set(seat, timer);
  }

  /** They came back inside the grace period. */
  private cancelForfeitCountdown(seat: Seat): void {
    const timer = this.forfeitTimers.get(seat);
    if (!timer) return;
    clearTimeout(timer);
    this.forfeitTimers.delete(seat);
    const name = this.gameState.players[seat]?.name ?? seat;
    this.io.to(this.code).emit('seatReconnected', { seat, name });
  }

  /**
   * The countdown ran out.
   *
   * Two-seat tables end the frame in favour of whoever stayed. Bigger tables eliminate the
   * leaver and play on — knocking a four-player game over because one person's train went into
   * a tunnel would punish the three who are still here.
   */
  private forfeitSeat(seat: Seat): void {
    if (!this.started || this.gameState.phase === 'game_over') return;
    const name = this.gameState.players[seat]?.name ?? seat;
    this.io.to(this.code).emit('seatForfeited', { seat, name });

    const player = this.gameState.players[seat];
    if (player) player.eliminated = true;

    const remaining = this.gameState.seatOrder.filter((s) => !this.gameState.players[s].eliminated);
    if (remaining.length <= 1) {
      endGame(this.gameState, remaining[0] ?? null, `${name} left the table`);
      this.recordFrameResult();
    } else {
      this.gameState.lastFoulReason = `${name} left the table`;
      if (this.gameState.currentShooter === seat) {
        this.gameState.currentShooter = remaining[0];
      }
    }
    this.releaseSeat(seat);
    this.broadcastRoomState();
    this.broadcastGameState();
    this.onTurnReady();
    // A frame can end by somebody walking out as well as by the black going down, and an open
    // table has to move on either way. Without this a knockout stopped dead on the result of
    // the first match anybody quit.
    this.scheduleAutoAdvance();
  }

  /**
   * Starts an open table once every seat is taken.
   *
   * The replacement for a host pressing a button. Deliberately requires the table to be *full*
   * rather than merely playable: on an open table nobody has the standing to decide that four
   * is enough for a six-seat game.
   */
  maybeAutoStart(): void {
    if (this.governance !== 'open' || this.started) return;
    const seats = this.seats();
    if (seats.length === 0) return;
    if (seats.some((seat) => !this.connections.has(seat))) return;

    if (this.isTournament) {
      this.startTournament(this.tournamentTarget, seats.length);
      return;
    }
    this.startGame();
  }

  /**
   * Moves an open table on to its next frame.
   *
   * The party version of this is a person pressing "play again" on the result card. An open
   * table has nobody with the standing to do that on everyone else's behalf, so the server does
   * it after a pause long enough to read the result — a tournament that jumped straight to the
   * next match would leave people wondering whether they had won.
   */
  scheduleAutoAdvance(delayMs = OPEN_TABLE_ADVANCE_MS): void {
    if (this.governance !== 'open') return;
    if (this.gameState.phase !== 'game_over') return;
    // Nothing to advance to: a finished bracket, or a single frame that is simply over.
    if (this.tournament?.champion) return;
    if (!this.isTournament && !this.gameState.series) return;
    if (this.advanceHandle) return;

    this.advanceHandle = setTimeout(() => {
      this.advanceHandle = null;
      if (this.gameState.phase === 'game_over') this.requestRematch();
    }, delayMs);
    this.advanceHandle.unref?.();
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
    this.preShotCall = input.call ?? null;
    this.preShotLowestBall = lowestBallId(this.gameState);
    // The whole shot — speed, spin, everything — comes out of where the tip meets the ball.
    // `input.spin` is that contact point, straight off the spin pad.
    const strike = applyCueStrike(
      cue,
      input.angle,
      input.power,
      input.spin,
      undefined,
      input.elevation ?? 0
    );

    this.gameState.phase = 'shot_in_progress';
    // The book closes the moment the balls move. Backing a player once you have seen how the
    // frame is going is not a wager, it is a refund with extra steps.
    if (this.betting.open) {
      this.betting.open = false;
      this.broadcastBook();
    }
    this.shotEvents = [];
    // Tell everyone the tip slipped, or the shot just looks broken rather than risky.
    if (strike.miscued) this.io.to(this.code).emit('simEvent', { type: 'miscue' });
    this.io.to(this.code).emit('shotFired', input);
    this.broadcastGameState();
    this.startSimLoop();
  }

  /**
   * Spends one of a seat's handicap tokens: take the cue ball in hand, right now.
   *
   * Claimable only on your own turn and before you shoot, which keeps it a decision about the
   * table you were left rather than a way to undo a shot you've already played.
   */
  useSpot(seat: Seat): void {
    const state = this.gameState;
    if (!this.started || state.currentShooter !== seat) return;
    if (state.phase !== 'aiming' && state.phase !== 'break') return;
    const player = state.players[seat];
    if (!player || player.spotsLeft <= 0) return;

    player.spotsLeft--;
    state.phase = 'ball_in_hand';
    // A spot is a free placement anywhere, not the restricted one a break scratch earns.
    state.ballInHandBehindLine = false;
    state.lastFoulReason = `${player.name} took a spot`;
    this.broadcastGameState();
    this.onTurnReady();
  }

  handlePlaceCueBall(payload: BallInHandPlacement): void {
    if (this.gameState.phase !== 'ball_in_hand' || this.gameState.currentShooter !== payload.seat) return;
    const { x, y } = payload.pos;
    const seatSocket = this.connections.get(payload.seat)?.socketId;

    if (x < BALL_RADIUS || x > TABLE_LENGTH - BALL_RADIUS || y < BALL_RADIUS || y > TABLE_WIDTH - BALL_RADIUS) {
      if (seatSocket) this.io.to(seatSocket).emit('errorMessage', 'Cue ball must stay on the table.');
      return;
    }
    // After a scratch on the break the incoming player is confined to the kitchen. Checked
    // here rather than trusted from the client, like every other rule.
    if (this.gameState.ballInHandBehindLine && x > HEAD_STRING_X) {
      if (seatSocket) {
        this.io.to(seatSocket).emit('errorMessage', 'Behind the head string only.');
      }
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
    this.gameState.ballInHandBehindLine = false;
    this.gameState.phase = 'aiming';
    this.broadcastGameState();
    this.onTurnReady();
  }

  requestRematch(): void {
    if (this.gameState.phase !== 'game_over') return;

    // In a tournament "play again" means the next frame of the bracket, not a rerun of the
    // pairing that just finished — the bracket decides who is at the table, not the players.
    if (this.tournament) {
      if (this.tournament.champion) return; // nothing left to play
      this.rebuildGameState();
      this.gameState.tournament = this.tournament;
      this.seatCurrentMatch();
      this.broadcastGameState();
      return;
    }
    // King of the table: the winner keeps their chair and the next challenger steps up.
    if (this.king) {
      this.rebuildGameState();
      this.gameState.king = this.king;
      this.seatKingMatch();
      this.broadcastGameState();
      return;
    }

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
      nextBreakIndex,
      this.lobby.ruleSet
    );
    for (const seat of next.seatOrder) {
      const before = prev.players[seat];
      if (!before) continue;
      next.players[seat].connected = before.connected;
      next.players[seat].isHost = before.isHost;
      next.players[seat].loadout = { ...before.loadout };
      next.players[seat].isBot = before.isBot;
      next.players[seat].botDifficulty = before.botDifficulty;
      // Handicap tokens refill with the rack. They're seeded from the lobby rather than
      // carried over: a spot you didn't need last frame isn't banked, and one you spent
      // isn't held against you.
      next.players[seat].spotsLeft = this.lobby.handicaps[seat]?.spots ?? 0;
    }

    // Likewise every banked power-up. An effect armed last frame has nothing left to act on.
    this.pendingModifiers.clear();

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

    // A seat's own handicap clock overrides the table's — that is the whole point of it.
    const seconds =
      this.lobby.handicaps[currentShooter]?.shotClockSeconds ?? this.lobby.shotClockSeconds;
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
        objectBallsToRail: 0,
        pottedIn: {},
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

  /**
   * Hands a ranked frame to whoever is keeping the ratings.
   *
   * Called from `recordFrameResult`, which is the one place in the server where a frame result
   * exists — and it exists there because the server refereed the physics that produced it.
   * That is the whole basis for the rating being trustworthy, so it is deliberately not
   * reachable from anywhere a client can reach.
   *
   * Bots never count. A rating earned against the shot search would mean nothing, and losing to
   * one would be a strange thing to be punished for.
   */
  private reportRankedResult(winner: Seat): void {
    if (!this.ranked || !this.onRankedResult) return;
    const seats = this.gameState.seatOrder;
    if (seats.length !== 2) return;

    const loser = seats.find((s) => s !== winner);
    if (!loser) return;
    if (this.connections.get(winner)?.bot || this.connections.get(loser)?.bot) return;

    const winnerToken = this.playerTokens.get(winner);
    const loserToken = this.playerTokens.get(loser);
    // No identity, no rating. Playing anonymously is allowed; it just does not count.
    if (!winnerToken || !loserToken || winnerToken === loserToken) return;

    this.onRankedResult(
      { seat: winner, token: winnerToken, name: this.gameState.players[winner]?.name ?? 'Player' },
      { seat: loser, token: loserToken, name: this.gameState.players[loser]?.name ?? 'Player' }
    );
  }

  // ---- Spectator betting ----

  /**
   * Takes a spectator's stake.
   *
   * Players are refused outright. Someone with a cue in their hand betting on the frame they
   * are playing is a different game entirely, and not one worth having in a pub.
   */
  placeSpectatorBet(socketId: string, name: string, on: Seat, amount: number): void {
    // Deliberately *not* gated on the game having started. The natural moment to back someone
    // is while everyone is still settling in, and requiring `started` refused every bet placed
    // in the lobby — silently, which is the worst way for a rule to work. The book's own
    // `open` flag is the right condition, and the first shot closes it.
    if (!this.spectatorSocketIds.has(socketId)) return;
    if (!this.gameState.seatOrder.includes(on)) return;
    if (this.gameState.players[on]?.eliminated) return;

    if (placeBet(this.betting, { bettorId: socketId, name, on, amount })) {
      this.broadcastBook();
    }
  }

  /**
   * Pays the book out against the frame the server refereed.
   *
   * Every bettor is told, winners and losers alike — a silent loss reads as a bug, and the
   * client needs to move the chalk either way.
   */
  private settleBets(winner: Seat | null): void {
    if (this.betting.bets.length === 0) return;
    for (const payout of settle(this.betting, winner)) {
      this.io.to(payout.bettorId).emit('betSettled', {
        staked: payout.staked,
        returned: payout.returned,
        winner,
      });
    }
    this.betting = newRound();
    this.broadcastBook();
  }

  private bookDTO(): { open: boolean; bets: { name: string; on: Seat; amount: number }[] } {
    return {
      open: this.betting.open,
      bets: this.betting.bets.map((b) => ({ name: b.name, on: b.on, amount: b.amount })),
    };
  }

  private broadcastBook(): void {
    this.io.to(this.code).emit('bettingBook', this.bookDTO());
  }

  /** The book, to one socket — for someone who has only just started watching. */
  private sendBook(socketId: string): void {
    this.io.to(socketId).emit('bettingBook', this.bookDTO());
  }

  // ---- Spectators ----

  addSpectator(socketId: string): void {
    this.spectatorSocketIds.add(socketId);
    if (!this.spectatorQueue.includes(socketId)) this.spectatorQueue.push(socketId);
    this.broadcastRoomState();
    // Tell them the state of the book *now*, not at the next change. Someone who walks up
    // mid-frame would otherwise be shown an open book that isn't, tap a stake, and have
    // nothing happen — a silent refusal is the worst way to explain a rule.
    this.sendBook(socketId);
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
      // Only the party mode passes anything here; every other mode runs the plain engine.
      const { events, settled } = stepSimulation(this.gameState.balls, dt, {
        pickups: this.gameState.pickups ?? undefined,
        modifiers: this.gameState.modifiers ?? undefined,
      });
      this.shotEvents.push(...events);
      for (const ev of events) this.io.to(this.code).emit('simEvent', ev);
      this.broadcastGameState();

      if (settled) {
        this.stopSimLoop();
        const outcome = summarizeShot(this.shotEvents);
        resolveShot(
          this.gameState,
          outcome,
          this.preShotGroupCleared,
          this.preShotLowestBall,
          false,
          this.preShotCall
        );
        // The whole shot's events, not the last tick's — a disc is almost always collected
        // while the cue ball is still rolling, so `events` here would be empty every time.
        // `summarizeShot` above reads the same accumulated list for the same reason.
        this.rollModifiers(this.shotEvents);
        if (this.gameState.phase === 'game_over') {
          this.recordFrameResult();
          this.scheduleAutoAdvance();
        }
        this.broadcastGameState();
        this.onTurnReady();
      }
    }, 1000 / BROADCAST_HZ);
  }

  /**
   * Turns the pickups collected during a shot into the effects for the *next* one.
   *
   * Called after `resolveShot`, so `currentShooter` has already moved on if the visit ended.
   * That is what makes "self" and "opponent" effects a single rule rather than two: the half
   * that follows the shooter and the half that's handed on are split by `splitModifiers`, and
   * whether those are the same person is simply whether the shooter kept the table.
   */
  private rollModifiers(events: SimEvent[]): void {
    if (!this.gameState.pickups) return;

    let armed = { ...NO_MODIFIERS };
    for (const ev of events) {
      if (ev.type === 'pickup') armed = applyPickup(armed, ev.kind, ev.pos);
    }

    const collector = this.gameState.lastShooter;
    if (collector) {
      const { mine, theirs } = splitModifiers(armed);
      // Banked per seat rather than applied straight to the next shot. Two things go wrong
      // otherwise: arming a freeze and *keeping* the table blinds you with your own power-up,
      // and arming a magnet and then missing throws it away silently — which is the worse of
      // the two, because you paid for it by routing the cue ball there.
      this.bankModifiers(collector, mine);
      for (const seat of this.gameState.seatOrder) {
        if (seat !== collector) this.bankModifiers(seat, theirs);
      }
    }

    // Whoever is about to shoot cashes their bank. It is spent by being played, so the entry
    // is cleared here rather than after the shot — an effect lasts exactly one stroke.
    const shooter = this.gameState.currentShooter;
    this.gameState.modifiers = this.pendingModifiers.get(shooter) ?? { ...NO_MODIFIERS };
    this.pendingModifiers.delete(shooter);
  }

  /** Merges effects into a seat's bank. Same-kind effects replace rather than stack. */
  private bankModifiers(seat: Seat, add: ShotModifiers): void {
    const held = this.pendingModifiers.get(seat) ?? { ...NO_MODIFIERS };
    this.pendingModifiers.set(seat, {
      magnetPocket: add.magnetPocket ?? held.magnetPocket,
      blockedPocket: add.blockedPocket ?? held.blockedPocket,
      ghostLine: add.ghostLine || held.ghostLine,
      freezeGuide: add.freezeGuide || held.freezeGuide,
      bonusVisit: add.bonusVisit || held.bonusVisit,
    });
  }

  /** Banks a frame win into the running series or tournament, whichever is in play. */
  private recordFrameResult(): void {
    const { winner } = this.gameState;
    this.settleBets(winner);
    if (!winner) return;
    this.reportRankedResult(winner);

    if (this.tournament) {
      const current = nextMatch(this.tournament);
      if (current) {
        const decided = recordFrameWin(this.tournament, current.id, winner);
        // Only a *decided* match changes the bracket; frames inside a best-of just move the
        // score along, which is what the bracket screen shows between them.
        if (decided) this.broadcastRoomState();
      }
      this.gameState.tournament = this.tournament;
      return;
    }

    if (this.king) {
      const king = this.king;
      const loser = king.holder === winner ? king.queue[0] : king.holder;
      if (king.holder === winner) {
        king.streak++;
      } else {
        king.holder = winner;
        king.streak = 1;
      }
      // The challenger always leaves the front of the queue; the loser rejoins the back. When
      // the holder wins those are the same seat, and the shift-then-push does the right thing
      // either way rather than needing two branches.
      king.queue.shift();
      if (loser !== undefined) king.queue.push(loser);
      if (!king.best || king.streak > king.best.streak) {
        king.best = { seat: king.holder, streak: king.streak };
      }
      this.gameState.king = king;
      this.broadcastRoomState();
      return;
    }

    const { series } = this.gameState;
    if (!series) return;
    series.wins[winner] = (series.wins[winner] ?? 0) + 1;
  }

  // ---- King of the table ----

  /**
   * Winner stays on. Everyone seated joins the queue; the first two play, and from then on the
   * loser goes to the back.
   *
   * Built on the same "seat everyone, mark the rest eliminated" trick as the tournament, for
   * the same reason: rebuilding the room between frames would drop cosmetics, reconnect tokens
   * and the spectator queue purely to avoid skipping seats in the turn order.
   */
  startKingOfTable(entrants: number): void {
    if (this.started) return;
    // The count has to be passed in for the same reason the bracket's is: eight-ball seats
    // exactly two, so `lobby.maxPlayers` is how many play at once, not how many are in the
    // queue. Deriving it from `connections.size` had the same failure — the clamp rejects the
    // third and fourth players before they can be counted.
    //
    // At least three makes it a queue rather than a rematch; bots fill any gap, exactly as
    // they do for a bracket.
    this.kingSeats = Math.max(3, Math.min(MAX_SEATS, Math.round(entrants)));
    for (const seat of this.seats()) {
      if (!this.connections.has(seat)) this.addBot(seat, DEFAULT_SETTINGS.defaultBotDifficulty);
    }
    const order = this.seats();
    this.king = { holder: order[0], streak: 0, queue: order.slice(1), best: null };
    this.startGame();
    this.seatKingMatch();
  }

  /** Puts the holder and the front of the queue at the table; everyone else waits. */
  private seatKingMatch(): void {
    const king = this.king;
    if (!king) return;
    const challenger = king.queue[0];
    if (challenger === undefined) return;

    for (const seat of this.gameState.seatOrder) {
      this.gameState.players[seat].eliminated = seat !== king.holder && seat !== challenger;
    }
    // The challenger breaks — the holder has had the table, so the incoming player gets the
    // one advantage that costs the holder nothing.
    this.gameState.currentShooter = challenger;
    this.gameState.king = king;
    this.broadcastGameState();
    this.onTurnReady();
  }

  // ---- Tournament ----

  /**
   * Starts a knockout over everyone seated, filling any empty seats with bots.
   *
   * Seeding is seat order, which is the only ranking a party game has — and being explicit
   * about that is better than pretending to compute one from a handful of frames.
   */
  startTournament(target: number, entrants: number): void {
    if (this.started) return;
    this.tournamentEntrants = Math.max(2, Math.min(MAX_SEATS, Math.round(entrants)));
    const seats = this.seats();
    for (const seat of seats) {
      if (!this.connections.has(seat)) this.addBot(seat, DEFAULT_SETTINGS.defaultBotDifficulty);
    }
    this.tournament = createTournament(seats, Math.max(1, Math.min(9, target)));
    this.startGame();
    this.seatCurrentMatch();
  }

  /**
   * Puts the next pairing at the table.
   *
   * Everyone stays seated — the bracket decides who *shoots*, and the rest are spectators for
   * that match. Rebuilding the room per match would drop cosmetics, reconnect tokens and the
   * spectator queue, all to avoid skipping two seats in the turn order.
   */
  private seatCurrentMatch(): void {
    if (!this.tournament) return;
    const match = nextMatch(this.tournament);
    if (!match) return;

    for (const seat of this.gameState.seatOrder) {
      this.gameState.players[seat].eliminated = seat !== match.a && seat !== match.b;
    }
    this.gameState.currentShooter = match.a!;
    this.gameState.tournament = this.tournament;
    this.broadcastGameState();
    this.onTurnReady();
  }

  private stopSimLoop(): void {
    if (this.loopHandle) {
      clearInterval(this.loopHandle);
      this.loopHandle = null;
    }
  }

  /**
   * Is anybody actually here?
   *
   * Bots do not count. A room of nothing but bots playing to an empty gallery is exactly what
   * the sweeper exists to clear away, and they would otherwise keep it alive for ever.
   */
  isOccupied(): boolean {
    if (this.hostSocketId) return true;
    if (this.spectatorSocketIds.size > 0) return true;
    for (const conn of this.connections.values()) {
      if (conn.socketId) return true;
    }
    return false;
  }

  destroy(): void {
    this.stopSimLoop();
    this.clearShotClock();
    this.clearBotTimer();
    for (const timer of this.forfeitTimers.values()) clearTimeout(timer);
    this.forfeitTimers.clear();
    if (this.advanceHandle) clearTimeout(this.advanceHandle);
    this.advanceHandle = null;
  }
}
