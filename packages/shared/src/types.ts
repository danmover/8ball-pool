import type { Vec2 } from './vector.js';
import type { Loadout } from './cosmetics.js';

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
 * - `sandbox`   : no turns, no fouls, no winner — a practice table.
 */
export type GameMode =
  | 'classic'
  | 'teams'
  | 'rotation'
  | 'nineball'
  | 'cutthroat'
  | 'killer'
  | 'sandbox'
  | 'challenge';

export type BotDifficulty = 'rookie' | 'club' | 'shark' | 'legend';

export interface LobbySettings {
  mode: GameMode;
  maxPlayers: number;
  /** Per-shot countdown in seconds; null disables the clock. */
  shotClockSeconds: number | null;
  /** Frames needed to take the match; 1 is a single one-and-done frame. */
  seriesTarget: number;
}

export const DEFAULT_LOBBY: LobbySettings = {
  mode: 'classic',
  maxPlayers: 2,
  shotClockSeconds: null,
  seriesTarget: 1,
};

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
  turnNumber: number;
  /**
   * Shot clock deadline as an absolute epoch-millis timestamp rather than a countdown, so
   * clients can't drift out of sync with the server's timer.
   */
  shotClock: { endsAt: number; seconds: number } | null;
  /** Best-of series across frames; null when playing single frames. */
  series: { target: number; frame: number; wins: Record<Seat, number> } | null;
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
}

export interface ShootInput extends AimInput {
  power: number; // 0..1
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
}

export interface RoomStateDTO {
  code: string;
  lobby: LobbySettings;
  /** True once the host has started; before that the room is still in the lobby. */
  started: boolean;
  players: Record<Seat, PlayerInfo | null>;
  spectatorCount: number;
}

export type SimEvent =
  /** `pocketIndex` indexes `POCKETS`, so the renderer can drop the ball into the right bag. */
  | { type: 'pot'; ballId: number; pos: Vec2; pocketIndex: number }
  | { type: 'cushion'; ballId: number; pos: Vec2; speed: number }
  | { type: 'ballCollision'; a: number; b: number; pos: Vec2; impulse: number }
  | { type: 'shotSettled' };
