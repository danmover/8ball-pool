import type { Vec2 } from './vector.js';
import type { Loadout } from './cosmetics.js';
import { DEFAULT_RULE_SET, type RuleSetId } from './ruleSets.js';
import type { Tournament } from './tournament.js';
import type { Pickup, PickupKind, ShotModifiers } from './pickups.js';

export type BallGroup = 'solid' | 'stripe';
export type BallKind = 'cue' | 'eight' | BallGroup;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Ball {
  id: number; // 0 = cue, 1-7 solids, 8 = eight, 9-15 stripes
  kind: BallKind;
  pos: Vec2;
  vel: Vec2;
  /**
   * Angular velocity in radians/sec, in a right-handed frame with x right, y down the screen
   * and **z into the table**.
   *
   * `x` and `y` are the rolling axes: a ball rolling naturally along +x has `y = -|v|/R`. `z`
   * is spin about the vertical axis — english.
   *
   * This replaced a pair of scalars (`spin`, `spinV`) whose every effect was a separate tuned
   * constant bolted onto the collision code. With a real angular state, draw, follow, stun,
   * throw, swerve and cushion english all fall out of one friction model instead of being six
   * special cases that didn't quite agree with each other — or with the aim guide.
   */
  angVel: Vec3;
  /**
   * Height above the cloth, in table units. Zero for a ball on the table.
   *
   * Note the axis: this one is **positive upward**, unlike `angVel`'s z which points into the
   * table. They describe different things — one is where the ball is, the other is how it
   * turns — and "the ball is 40 units in the air" reading as -40 would be worse than having
   * two conventions clearly labelled.
   */
  z: number;
  /** Vertical speed, positive upward. */
  vz: number;
  pocketed: boolean;
}

/** Seat ids are 'p1'...'pN' — see `seatId()`. */
export type Seat = string;
export type Team = 'a' | 'b';

export const MAX_SEATS = 8;

export function seatId(index: number): Seat {
  return `p${index + 1}`;
}

export function seatIndex(seat: Seat): number {
  return Number(seat.slice(1)) - 1;
}

/**
 * - `classic`   : standard 1v1 eight-ball, solids vs stripes.
 * - `teams`     : any number of players split into two teams; seats alternate around the
 *                 table and each team shares a group, exactly like real-life doubles.
 * - `rotation`  : free-for-all; you must strike the lowest-numbered ball on the table first,
 *                 and every ball you legally pot scores its face value. Highest score wins.
 * - `nineball`  : balls 1-9 only, lowest ball first, and whoever legally sinks the 9 wins —
 *                 including off a combination.
 * - `cutthroat` : 3-5 players each own a group of balls; you're out when your last one drops,
 *                 and the last player with a ball still on the table wins.
 * - `killer`    : everyone starts with lives; fail to pot on your turn and you lose one.
 * - `powerup`   : eight-ball with pickups on the cloth; each arms one effect for one shot.
 * - `ghost`     : solo. Clear the whole table in one visit or the rack is lost.
 * - `speed`     : solo against the clock. Clear all fifteen; fouls cost seconds, not the rack.
 * - `sandbox`   : no turns, no fouls, no winner — a practice table.
 */
export type GameMode =
  | 'classic'
  | 'teams'
  | 'rotation'
  | 'nineball'
  | 'cutthroat'
  | 'killer'
  | 'powerup'
  | 'ghost'
  | 'speed'
  | 'sandbox'
  | 'challenge';

export type BotDifficulty = 'rookie' | 'club' | 'shark' | 'legend';

export interface LobbySettings {
  mode: GameMode;
  /** Which optional rules are in force. */
  ruleSet: RuleSetId;
  maxPlayers: number;
  /** Per-shot countdown in seconds; null disables the clock. */
  shotClockSeconds: number | null;
  /** Frames needed to take the match; 1 is a single one-and-done frame. */
  seriesTarget: number;
  /**
   * Per-seat handicaps, so a mixed-skill group can play a real frame.
   *
   * A stronger player takes a tighter clock; a weaker one gets `spots` — take-it-in-hand
   * tokens, claimable once each per frame. Both are subtractive rather than additive: nobody
   * is given help *at the table*, the physics is identical for everyone, and the outcome of
   * any given shot is still entirely down to who played it.
   */
  handicaps: Partial<Record<Seat, SeatHandicap>>;
}

export interface SeatHandicap {
  /** Ball-in-hand tokens this seat may claim per frame. */
  spots: number;
  /** A tighter per-shot clock for this seat only; null follows the table's setting. */
  shotClockSeconds: number | null;
}

export const NO_HANDICAP: SeatHandicap = { spots: 0, shotClockSeconds: null };

export const DEFAULT_LOBBY: LobbySettings = {
  mode: 'classic',
  ruleSet: DEFAULT_RULE_SET,
  maxPlayers: 2,
  shotClockSeconds: null,
  seriesTarget: 1,
  handicaps: {},
};

/**
 * Winner stays on.
 *
 * The oldest format in any pub, and a much better fit for a party than a bracket: nobody is
 * knocked out, the queue is visible, and losing costs you one frame's wait rather than the
 * evening.
 */
export interface KingOfTable {
  /** Who is holding the table. */
  holder: Seat;
  /** Frames won in a row without leaving. */
  streak: number;
  /** Waiting seats, front first. `queue[0]` is at the table right now. */
  queue: Seat[];
  /** The longest streak anyone has managed this session, and who. */
  best: { seat: Seat; streak: number } | null;
}

export interface PlayerInfo {
  seat: Seat;
  name: string;
  connected: boolean;
  isHost: boolean; // true if this seat is being played from the host screen
  group: BallGroup | null; // assigned after first legal pot post-break (classic/teams)
  team: Team | null; // teams mode only
  score: number; // rotation mode only
  /** Cosmetics this player has equipped; rides along in state so the host can render them. */
  loadout: Loadout;
  /** Killer mode: lives remaining. Null in modes without lives. */
  lives: number | null;
  /** Cutthroat: the ball ids this player owns and must protect. */
  ownedBalls: number[];
  /** Out of the frame — eliminated in cutthroat/killer. Skipped in turn order. */
  eliminated: boolean;
  isBot: boolean;
  botDifficulty: BotDifficulty | null;
  /** Handicap ball-in-hand tokens left this frame. Zero when no handicap is set. */
  spotsLeft: number;
}

export type TurnPhase =
  | 'break'
  | 'aiming'
  | 'shot_in_progress'
  | 'ball_in_hand'
  | 'game_over';

export interface GameState {
  mode: GameMode;
  balls: Ball[];
  /** Seats in turn order; also the authoritative list of who is in the game. */
  seatOrder: Seat[];
  players: Record<Seat, PlayerInfo>;
  currentShooter: Seat;
  phase: TurnPhase;
  winner: Seat | null;
  winningTeam: Team | null;
  lastFoulReason: string | null;
  /** Who took the shot that just resolved — the three-foul counter needs it after the turn passes. */
  lastShooter: Seat | null;
  /** Consecutive fouls per seat, for the three-foul rule. Reset by any legal shot. */
  consecutiveFouls: Record<Seat, number>;
  /** How strictly this frame is refereed. */
  ruleSet: RuleSetId;
  /**
   * Ball in hand is restricted to behind the head string — the "kitchen" — which is what a
   * scratch on the break costs you in every serious rule set.
   */
  ballInHandBehindLine: boolean;
  turnNumber: number;
  /**
   * Shot clock deadline as an absolute epoch-millis timestamp rather than a countdown, so
   * clients can't drift out of sync with the server's timer.
   */
  shotClock: { endsAt: number; seconds: number } | null;
  /** Best-of series across frames; null when playing single frames. */
  series: { target: number; frame: number; wins: Record<Seat, number> } | null;
  /** The knockout bracket, when this room is running a tournament. */
  tournament: Tournament | null;
  /** Winner-stays-on, when this room is running king of the table. */
  king: KingOfTable | null;
  /** Pickups on the cloth, and the effects armed for the shot in front of us. Party mode only. */
  pickups: Pickup[] | null;
  modifiers: ShotModifiers | null;
  /**
   * A speed-pool run against the clock. `finalMs` is null until the table is cleared, so a
   * live run is timed from `startedAt` and a finished one is read straight off the state
   * rather than being recomputed against a clock that has kept moving.
   */
  speedRun: {
    startedAt: number;
    penaltyMs: number;
    fouls: number;
    finalMs: number | null;
    stars: number;
  } | null;
  /** Trick-shot progress; null outside challenge mode. */
  challenge: {
    challengeId: string;
    shotsUsed: number;
    pottedOrder: number[];
    stars: number;
    failed: boolean;
  } | null;
}

export interface AimInput {
  seat: Seat;
  angle: number; // radians
  spin: { x: number; y: number }; // -1..1 each, tip offset on cue ball
  /**
   * How far the butt of the cue is raised, in radians. 0 is level.
   *
   * Elevation is what makes a blocked table a decision rather than a dead end: past ~45° the
   * ball leaves the cloth and jumps an obstruction, and any side spin becomes a spin axis
   * pointing along the shot, which curves the ball — a massé.
   */
  elevation?: number;
}

export interface ShootInput extends AimInput {
  power: number; // 0..1
  /**
   * The ball and pocket being nominated, when call shot is in force.
   *
   * Derived from the aim guide and confirmable by the player, rather than a second gesture —
   * the guide already knows which ball is being struck and where it is headed.
   */
  call?: { ballId: number; pocketIndex: number } | null;
}

export interface BallInHandPlacement {
  seat: Seat;
  pos: Vec2;
}

export type TrajectoryPreviewMode = 'off' | 'basic' | 'full';

/**
 * Retained only so older saved settings still parse; the client resolves these onto the
 * richer table themes (cloth + rails + pockets + surround) defined in its theme registry.
 */
export type FeltTheme = 'green' | 'blue' | 'crimson' | 'midnight';

export interface PlayerSettings {
  trajectoryPreview: TrajectoryPreviewMode;
  soundEnabled: boolean;
  soundVolume: number; // 0..1
  /** Background music, scored per table theme. Separate from effects on purpose. */
  musicEnabled: boolean;
  musicVolume: number; // 0..1
  /**
   * The room behind the table, in sound — bar chatter, arcade hum, wind in the ice cavern.
   *
   * Its own switch rather than part of the music one: the two do very different jobs, and
   * plenty of people want the room without the tune.
   */
  ambienceEnabled: boolean;
  ambienceVolume: number; // 0..1
  hapticsEnabled: boolean;
  colorblindPatterns: boolean;
  leftHanded: boolean;
  /** Table theme id — cloth, rails, pockets and the surround behind the table. */
  tableTheme: string;
  effectsIntensity: 'low' | 'high';
  /** Camera shake on hard hits and pots. */
  screenShake: boolean;
  /** Speed trails behind moving balls. */
  ballTrails: boolean;
  /** Master switch that also stills the banner effects and menu backdrop. */
  reduceMotion: boolean;
  /** Defaults carried into new lobbies, so you set them up once. */
  defaultBotDifficulty: BotDifficulty;
  defaultShotClock: number | null;
}

export const DEFAULT_SETTINGS: PlayerSettings = {
  trajectoryPreview: 'full',
  soundEnabled: true,
  soundVolume: 0.7,
  musicEnabled: true,
  musicVolume: 0.35,
  ambienceEnabled: true,
  ambienceVolume: 0.5,
  hapticsEnabled: true,
  colorblindPatterns: false,
  leftHanded: false,
  tableTheme: 'classic',
  effectsIntensity: 'high',
  screenShake: true,
  ballTrails: true,
  reduceMotion: false,
  defaultBotDifficulty: 'club',
  defaultShotClock: null,
};

export interface TrajectorySegment {
  from: Vec2;
  to: Vec2;
  /**
   * True while the ball is off the cloth.
   *
   * A jump shot is the one case where the guide's line passes *through* a ball rather than
   * stopping at it, and a dashed line that does that without explanation looks like a bug.
   * Drawn differently, it reads as the hop it is.
   */
  airborne?: boolean;
}

export interface TrajectoryPreview {
  cueBallPath: TrajectorySegment[];
  ghostBallPos: Vec2 | null;
  firstContactBallId: number | null;
  objectBallPath: TrajectorySegment[];
  /**
   * Where the cue ball goes *after* contact, given the spin on the tip. Without this the
   * whole draw/follow system is invisible — you can't learn a control you can't see.
   */
  cueAfterPath: TrajectorySegment[];
  /** Resting place of the cue ball, drawn as a ghost. */
  cueRestPos: Vec2 | null;
  /**
   * Where a jumped cue ball comes back down, when it left the cloth at all.
   *
   * The single most useful thing to know about a jump before you play it: whether the ball
   * lands past the obstruction or on top of it.
   */
  landingPos?: Vec2 | null;
  /**
   * The line you pointed at, when side spin has deflected the real one off it.
   *
   * Squirt is real and it is punishing, so it has to be *visible*: drawn faintly beside the
   * actual path, the gap between the two is the whole lesson.
   */
  aimLine?: TrajectorySegment;
}

// ---- Socket event contracts ----

export interface ServerToClientEvents {
  roomState: (state: RoomStateDTO) => void;
  gameState: (state: GameState) => void;
  aimUpdate: (input: AimInput) => void;
  shotFired: (input: ShootInput) => void;
  simEvent: (event: SimEvent) => void;
  errorMessage: (message: string) => void;
  /** A player sent a reaction; the host floats it off their banner. */
  emote: (payload: { seat: Seat; emote: string }) => void;
  /** A seat opened up and this spectator is first in line for it. */
  seatAvailable: (payload: { seat: Seat }) => void;
  /** The state of the book on this frame, for everyone watching. */
  bettingBook: (payload: {
    open: boolean;
    bets: { name: string; on: Seat; amount: number }[];
  }) => void;
  /** Sent only to the bettor: what their stake did. `returned` of 0 means they lost it. */
  betSettled: (payload: { staked: number; returned: number; winner: Seat | null }) => void;
  /**
   * Somebody's connection dropped and their seat is on a countdown.
   *
   * Broadcast to the whole table rather than kept quiet: sitting in front of a table that has
   * silently stopped is the worst version of this, and knowing *why* nothing is happening is
   * most of the fix.
   */
  seatDisconnected: (payload: { seat: Seat; name: string; forfeitsAt: number }) => void;
  /** They made it back inside the grace period. */
  seatReconnected: (payload: { seat: Seat; name: string }) => void;
  /** The countdown ran out; the frame was awarded to whoever stayed. */
  seatForfeited: (payload: { seat: Seat; name: string }) => void;
  /** Paired — here is the table to go to. */
  matchFound: (payload: { code: string; opponent: string; opponentRating: number }) => void;
  /** How the search is going, so a wait is not a blank screen. */
  matchSearching: (payload: { waitedMs: number; inQueue: number; band: number | null }) => void;
  /** A ranked frame settled: what it did to your rating. Sent only to the two who played it. */
  ratingChanged: (payload: {
    rating: number;
    delta: number;
    frames: number;
    provisional: boolean;
    tier: string;
  }) => void;
}

/** The fixed reaction set. Server-validated, so clients can't inject arbitrary content. */
export const EMOTES = ['👍', '😂', '😱', '🔥', '🎯', '😭', '🤝', '🐍'] as const;
export type Emote = (typeof EMOTES)[number];
export const EMOTE_COOLDOWN_MS = 1500;

export interface ClientToServerEvents {
  hostCreateRoom: (payload: { hostName: string }, cb: (res: { code: string; token: string }) => void) => void;
  hostRejoin: (
    payload: { code: string; token: string },
    cb: (res: { ok: boolean }) => void
  ) => void;
  joinRoom: (
    payload: { code: string; name: string; token?: string; loadout?: Loadout },
    cb: (res: { ok: true; seat: Seat; token: string } | { ok: false; error: string }) => void
  ) => void;
  hostClaimSeat: (payload: { seat: Seat; loadout?: Loadout; name?: string }) => void;
  setLoadout: (payload: { loadout: Loadout }) => void;
  hostReleaseSeat: (payload: { seat: Seat }) => void;
  hostUpdateLobby: (payload: Partial<LobbySettings>) => void;
  hostStartGame: () => void;
  hostStartKing: (payload: { entrants: number }) => void;
  /** Back a player with chalk. Spectators only, and only before the first shot. */
  placeBet: (payload: { on: Seat; amount: number; name: string }) => void;
  /** Spend one handicap ball-in-hand token. */
  useSpot: (payload: { seat: Seat }) => void;
  /** Reopen the lobby after a game so the table can be set up differently. */
  hostReturnToLobby: () => void;
  /** Run a seeded knockout over everyone seated, filling empty seats with bots. */
  hostStartTournament: (payload: { target: number; entrants: number }) => void;
  updateAim: (input: AimInput) => void;
  takeShot: (input: ShootInput) => void;
  placeCueBall: (payload: BallInHandPlacement) => void;
  updateSettings: (settings: Partial<PlayerSettings>) => void;
  requestRematch: () => void;
  hostAddBot: (payload: { seat: Seat; difficulty: BotDifficulty }) => void;
  hostRemoveBot: (payload: { seat: Seat }) => void;
  sendEmote: (payload: { emote: string }) => void;
  /** Start or retry a trick-shot challenge. Host only; the room becomes a single-seat puzzle. */
  hostStartChallenge: (payload: { challengeId: string }) => void;

  // ---- Online tables ----
  // Named for what they are rather than reusing the `host*` events: those are gated on being
  // the host, and an open table has no host to be.

  /** Makes an open table. The settings given here are fixed for its lifetime. */
  createTable: (
    payload: CreateTablePayload,
    cb: (res: { ok: true; code: string } | { ok: false; error: string }) => void
  ) => void;
  /** Takes a seat at an open table, or resumes one with a seat token from a previous visit. */
  joinTable: (
    payload: { code: string; name: string; loadout?: Loadout; seatToken?: string },
    cb: (
      res:
        | { ok: true; seat: Seat; seatToken: string; spectating: false }
        | { ok: true; seat: null; seatToken: null; spectating: true }
        | { ok: false; error: string }
    ) => void
  ) => void;
  /** Public tables, freshest first. */
  listTables: (cb: (tables: TableSummary[]) => void) => void;
  /**
   * Which of these tables still exist.
   *
   * Asked by the "you are still at table X" strip before it offers one. It used to work this
   * out for itself, from a stored timestamp and a copy of the server's empty-room window — and
   * got it wrong in both directions, because that window only starts running when the socket
   * drops, which walking to another screen in the same tab never does. So a table you were
   * sitting at looked reaped, and a table that really had been reaped looked fine.
   *
   * Only the server knows. This asks it.
   */
  tablesAlive: (payload: { codes: string[] }, cb: (alive: string[]) => void) => void;
  /** Straight into the best waiting table, or a new one if there isn't a good one. */
  quickPlay: (
    payload: { mode?: GameMode; ruleSet?: RuleSetId },
    cb: (res: { ok: true; code: string } | { ok: false; error: string }) => void
  ) => void;
  /** Gives up a seat deliberately, as distinct from dropping off the network. */
  leaveTable: () => void;
  /**
   * Tells the server which player this socket is.
   *
   * The same opaque profile token the profile store already uses, so there is one identity
   * rather than two. Sent once on connect; without it you can still play, just not ranked.
   */
  identify: (
    payload: { token: string; name: string },
    cb: (res: { rating: number; frames: number; provisional: boolean; tier: string }) => void
  ) => void;
  /** Joins the ranked queue. The pairing arrives as a `matchFound` event. */
  rankedQueue: (
    payload: { mode?: GameMode; ruleSet?: RuleSetId },
    cb: (res: { ok: true } | { ok: false; error: string }) => void
  ) => void;
  /** Leaves it again. */
  rankedCancel: () => void;
  /** The scheduled tournaments, and whether one is open to enter right now. */
  listEvents: (
    cb: (
      events: {
        id: string;
        name: string;
        blurb: string;
        mode: GameMode;
        ruleSet: RuleSetId;
        entrants: number;
        phase: 'scheduled' | 'signup' | 'running';
        opensAt: number;
        startsAt: number;
        /** The table hosting it, once sign-ups are open. */
        code: string | null;
      }[]
    ) => void
  ) => void;
  /** The top of the ladder. */
  leaderboard: (
    cb: (rows: { name: string; rating: number; frames: number; wins: number; losses: number }[]) => void
  ) => void;
}

/**
 * How a table is governed.
 *
 * `host` is the party shape — one screen owns the room. `open` is the online shape: nobody is
 * privileged, settings are fixed at creation, and the game starts itself when the seats fill.
 */
export type Governance = 'host' | 'open';

/** Listed for anyone to find, or reachable only by its code. */
export type TableVisibility = 'public' | 'private';

/** One row in the online table browser. */
export interface TableSummary {
  code: string;
  mode: GameMode;
  ruleSet: RuleSetId;
  seatsFilled: number;
  seatsTotal: number;
  /** Already playing — joinable only as a spectator. */
  inPlay: boolean;
  spectators: number;
  createdAt: number;
  ranked: boolean;
  /** Average rating of the players sitting here, for the list. Null when nobody is seated. */
  averageRating: number | null;
  /** Running a knockout rather than a single frame. */
  tournament: boolean;
  /** The scheduled event this table is running, when it is one. */
  eventId: string | null;
}

export interface CreateTablePayload {
  mode: GameMode;
  ruleSet: RuleSetId;
  /** How many seats the table has. Clamped to what the mode can seat. */
  seats: number;
  visibility: TableVisibility;
  seriesTarget: number;
  /**
   * Counts toward your rating.
   *
   * Opt-in, and only ever on a two-seat table — a rating is a statement about one player
   * against one other, and there is no honest way to read a four-way frame as that.
   */
  ranked?: boolean;
  /**
   * Runs a knockout rather than a single frame.
   *
   * `seats` becomes the number of entrants; the bracket is drawn when the last one arrives.
   */
  tournament?: boolean;
}

export interface RoomStateDTO {
  code: string;
  lobby: LobbySettings;
  /** True once the host has started; before that the room is still in the lobby. */
  started: boolean;
  players: Record<Seat, PlayerInfo | null>;
  spectatorCount: number;
  /** Party table or online table — the client shows very different controls for each. */
  governance: Governance;
  visibility: TableVisibility;
}

export type SimEvent =
  /** `pocketIndex` indexes `POCKETS`, so the renderer can drop the ball into the right bag. */
  | { type: 'pot'; ballId: number; pos: Vec2; pocketIndex: number }
  /**
   * A ball met a cushion.
   *
   * `speed` is the *impact* speed — the component of the ball's velocity along the cushion's
   * normal — not how fast the ball was travelling. A ball running the length of a rail and
   * grazing it is barely a contact, however quickly it is moving, and reporting its full speed
   * made a graze kick up the same cloud of chalk and thud as loudly as a square hit.
   *
   * `normal` points back into play, so the dust knows which way to spray and the ball knows
   * which way to squash. It used to be guessed from the ball's position, which worked for the
   * four rails and fell back to "upward" for everything else, jaws included.
   */
  | { type: 'cushion'; ballId: number; pos: Vec2; speed: number; normal: Vec2 }
  | { type: 'ballCollision'; a: number; b: number; pos: Vec2; impulse: number }
  /** The tip slipped off the ball — struck too far off centre to hold. */
  | { type: 'miscue' }
  /** The cue ball rolled over a pickup in the party mode. */
  | { type: 'pickup'; kind: PickupKind; pos: Vec2 }
  /** A jumped ball came back down onto the cloth. */
  | { type: 'land'; ballId: number; pos: Vec2 }
  | { type: 'shotSettled' };
