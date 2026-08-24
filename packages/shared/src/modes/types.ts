import type { Ball, GameMode, GameState, Seat } from '../types.js';

/** Everything the rules engine learns about a shot once the balls have stopped. */
export interface ShotOutcome {
  potted: number[];
  cueBallPocketed: boolean;
  eightBallPocketed: boolean;
  firstBallContacted: number | null;
  anyCushionAfterContact: boolean;
  /** Rails the cue ball struck *before* touching any object ball — the bank-shot test. */
  cushionsBeforeContact: number;
}

/**
 * State the caller must capture *before* stepping the simulation, because it can't be
 * recovered afterwards — potting your last group ball and the 8-ball on the same shot is
 * illegal even though both read as "pocketed" by the time the shot resolves.
 */
export interface ShotContext {
  /** Was the shooter's group already cleared before this shot? */
  groupCleared: boolean;
  /** Lowest ball on the table before the shot (rotation / 9-ball legal contact). */
  lowestBefore: number | null;
  /** The clock ran out instead of a shot being taken. */
  timedOut?: boolean;
}

/**
 * A game mode is data plus four small functions. Adding a mode means adding a file here and
 * one registry entry — never touching a shared `resolveShot` switch.
 */
export interface ModeDescriptor {
  id: GameMode;
  name: string;
  /** One line for the menu card. */
  blurb: string;
  /** Bullet points for the mode card's rules panel. */
  rulesSummary: string[];
  minPlayers: number;
  maxPlayers: number;
  /** Whether a shot clock makes sense here (it doesn't in sandbox). */
  supportsShotClock: boolean;

  /** The starting ball layout. */
  rack(seatCount: number): Ball[];

  /** Assign groups / lives / owned balls once seats are known. Called on every new frame. */
  assignSeats(state: GameState): void;

  /** Which balls the shooter may legally strike first — drives the on-table highlight ring. */
  legalTargetBallIds(state: GameState): number[];

  /** Apply this mode's rules to a settled shot, mutating `state`. */
  resolveShot(state: GameState, outcome: ShotOutcome, ctx: ShotContext): void;
}

/** Seats still in the frame, in turn order. */
export function activeSeats(state: GameState): Seat[] {
  return state.seatOrder.filter((seat) => !state.players[seat].eliminated);
}
