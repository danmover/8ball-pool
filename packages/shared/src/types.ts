import type { Vec2 } from './vector.js';
import type { RuleSetId } from './ruleSets.js';
import type { PowerId, PowerState } from './powers.js';

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
   */
  angVel: Vec3;
  /** Height above the cloth, in table units, positive upward. Zero for a ball on the table. */
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
 * The games.
 *
 * - `eightball`  : solids vs stripes, 1v1 or 2v2 doubles.
 * - `nineball`   : balls 1-9, lowest first, the 9 wins.
 * - `killer`     : lives; pot every visit or lose one. Party mode for up to eight.
 * - `power`      : a points race with power orbs on the cloth.
 * - `practice`   : no rules, undo, place the cue ball anywhere.
 * - `timeattack` : clear fifteen against the clock.
 * - `trickshot`  : a hand-built puzzle with a shot budget.
 */
export type GameMode =
  | 'eightball'
  | 'nineball'
  | 'killer'
  | 'power'
  | 'practice'
  | 'timeattack'
  | 'trickshot';

export const MULTIPLAYER_MODES: GameMode[] = ['eightball', 'nineball', 'killer', 'power'];
export const SOLO_MODES: GameMode[] = ['practice', 'timeattack', 'trickshot'];

export type BotTier = 'rookie' | 'amateur' | 'pro' | 'master';

/** What one player did this frame — for the results screen and the missions. */
export interface FrameStats {
  shots: number;
  pots: number;
  fouls: number;
  /** Most balls potted in one unbroken visit. */
  bestRun: number;
  /** Most balls potted with one shot. */
  bestShot: number;
}

export function emptyFrameStats(): FrameStats {
  return { shots: 0, pots: 0, fouls: 0, bestRun: 0, bestShot: 0 };
}

export interface PlayerInfo {
  seat: Seat;
  name: string;
  /** Assigned after the first legal pot of a group (8-ball). */
  group: BallGroup | null;
  /** 2v2 eight-ball only. */
  team: Team | null;
  /** Power Pool points. */
  score: number;
  /** Killer lives. Null in modes without lives. */
  lives: number | null;
  /** Out of the frame — eliminated in killer, or not playing this tournament match. */
  eliminated: boolean;
  isBot: boolean;
  frame: FrameStats;
}

export type TurnPhase = 'break' | 'aiming' | 'shot_in_progress' | 'ball_in_hand' | 'game_over';

/** What the last shot did, in a form the table can talk about. */
export interface ShotSummary {
  seat: Seat;
  potted: number[];
  foul: string | null;
  /** The visit continues. */
  kept: boolean;
  /** Balls potted so far in this visit, including this shot. */
  run: number;
  /** Rails the cue ball hit before first contact. */
  railsFirst: number;
  jumped: boolean;
  /** Power that was spent on this shot. */
  power: PowerId | null;
  /** Orbs collected by this shot. */
  collected: PowerId[];
  /** Points scored (Power Pool). */
  points: number;
  /** A life was lost (Killer) or gained. */
  lifeDelta: number;
  /** Frame decided by this shot. */
  wonFrame: boolean;
}

export interface GameState {
  mode: GameMode;
  ruleSet: RuleSetId;
  balls: Ball[];
  /** Seats in turn order; also the authoritative list of who is in the frame. */
  seatOrder: Seat[];
  players: Record<Seat, PlayerInfo>;
  currentShooter: Seat;
  phase: TurnPhase;
  winner: Seat | null;
  winningTeam: Team | null;
  lastFoulReason: string | null;
  /** Who took the shot that just resolved. */
  lastShooter: Seat | null;
  /** Consecutive fouls per seat, for the three-foul rule. */
  consecutiveFouls: Record<Seat, number>;
  /** Ball in hand is restricted to behind the head string (the kitchen). */
  ballInHandBehindLine: boolean;
  turnNumber: number;
  /** Balls potted in the current unbroken visit. */
  visitRun: number;
  /**
   * The shot clock, as time remaining when this state was sent. Clients turn it into a local
   * deadline on receipt, so the host's and the phone's clocks never have to agree.
   */
  clock: { totalMs: number; remainingMs: number } | null;
  lastShot: ShotSummary | null;
  power: PowerState | null;
  timeAttack: {
    /** Milliseconds elapsed on the run, not counting the shot in flight. */
    elapsedMs: number;
    penaltyMs: number;
    fouls: number;
    finalMs: number | null;
    stars: number;
  } | null;
  trick: {
    challengeId: string;
    shotsUsed: number;
    pottedOrder: number[];
    stars: number;
    failed: boolean;
  } | null;
}

/** The live aim of whoever is at the table, streamed to everyone watching. */
export interface AimState {
  angle: number;
  /** Tip offset on the cue ball, -1..1 each; y positive is below centre (draw). */
  spin: { x: number; y: number };
  /** Cue elevation in radians. */
  elevation: number;
  /** How far the cue is drawn back, 0..1, while the shot is being charged. */
  power: number;
}

export interface ShootInput {
  angle: number;
  power: number;
  spin: { x: number; y: number };
  elevation: number;
  /** Nominated ball and pocket, when the rules want one. */
  call?: { ballId: number; pocketIndex: number } | null;
}

export interface TrajectorySegment {
  from: Vec2;
  to: Vec2;
  /** True while the ball is off the cloth — a jump reads as the hop it is. */
  airborne?: boolean;
}

export interface TrajectoryPreview {
  cueBallPath: TrajectorySegment[];
  ghostBallPos: Vec2 | null;
  firstContactBallId: number | null;
  objectBallPath: TrajectorySegment[];
  /** Where the cue ball goes after contact, given the spin on the tip. */
  cueAfterPath: TrajectorySegment[];
  /** Resting place of the cue ball. */
  cueRestPos: Vec2 | null;
  /** Where a jumped cue ball comes back down. */
  landingPos?: Vec2 | null;
  /** The line you pointed at, when side spin has deflected the real one off it. */
  aimLine?: TrajectorySegment;
}

export type SimEvent =
  /** `pocketIndex` indexes `POCKETS`, so the renderer can drop the ball into the right bag. */
  | { type: 'pot'; ballId: number; pos: Vec2; pocketIndex: number }
  /** `speed` is the impact speed along the cushion normal; `normal` points back into play. */
  | { type: 'cushion'; ballId: number; pos: Vec2; speed: number; normal: Vec2 }
  | { type: 'ballCollision'; a: number; b: number; pos: Vec2; impulse: number }
  | { type: 'miscue' }
  /** The cue ball rolled through a Power Pool orb. */
  | { type: 'orb'; power: PowerId; orbId: number; pos: Vec2 }
  /** An armed bomb went off at the cue ball's first contact. */
  | { type: 'bomb'; pos: Vec2 }
  /** A jumped ball came back down onto the cloth. */
  | { type: 'land'; ballId: number; pos: Vec2 }
  | { type: 'shotSettled' };
