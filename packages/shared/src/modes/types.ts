import type { Ball, GameMode, GameState, Seat } from '../types.js';
import type { RuleOptions } from '../ruleSets.js';
import type { PowerId } from '../powers.js';

/** Everything the rules engine learns about a shot once the balls have stopped. */
export interface ShotOutcome {
  potted: number[];
  cueBallPocketed: boolean;
  eightBallPocketed: boolean;
  firstBallContacted: number | null;
  anyCushionAfterContact: boolean;
  /** Rails the cue ball struck *before* touching any object ball — the bank/kick test. */
  cushionsBeforeContact: number;
  /** Distinct object balls that reached a rail after first contact (the break rule wants four). */
  objectBallsToRail: number;
  /** Which pocket each potted ball went into, so a called shot can be judged. */
  pottedIn: Record<number, number>;
  /** Power Pool orbs the cue ball rolled through. */
  collected: PowerId[];
  /** The cue ball left the cloth at some point. */
  jumped: boolean;
}

/**
 * State the caller must capture *before* stepping the simulation, because it can't be
 * recovered afterwards — potting your last group ball and the 8-ball on the same shot is
 * illegal even though both read as "pocketed" by the time the shot resolves.
 */
export interface ShotContext {
  /** Was the shooter's group already cleared before this shot? */
  groupCleared: boolean;
  rules: RuleOptions;
  /** The ball and pocket the shooter nominated. */
  call: { ballId: number; pocketIndex: number } | null;
  /** Lowest ball on the table before the shot (9-ball legal contact). */
  lowestBefore: number | null;
  /** The clock ran out instead of a shot being taken. */
  timedOut: boolean;
  /** When the shot settled, epoch millis — injected so timed modes are testable. */
  now: number;
  /** The Power Pool power spent on this shot. */
  armed: PowerId | null;
  /** Seeded randomness owned by the host. */
  rand: () => number;
}

/** What a mode decided about a shot. The wrapper in `rules.ts` turns it into stats and a summary. */
export interface ModeResult {
  /** Why the shot was a foul, or null. */
  foul: string | null;
  /** A non-foul line worth showing ("Alex lost a life"). */
  note?: string | null;
  points?: number;
  lifeDelta?: number;
}

/** Which nomination, if any, the shooter owes before this shot. */
export type CallRequirement = 'none' | 'pocket' | 'ballAndPocket';

/**
 * A game mode is data plus a handful of small functions. Adding a mode means adding a file here
 * and one registry entry — never touching a shared switch.
 */
export interface ModeDescriptor {
  id: GameMode;
  name: string;
  /** One line for the menu card. */
  blurb: string;
  /** Bullet points for the rules panel. */
  rulesSummary: string[];
  minPlayers: number;
  maxPlayers: number;
  /** Whether the mode is played alone. */
  solo: boolean;
  /** Whether a shot clock makes sense here. */
  supportsShotClock: boolean;
  /** Whether Standard/Pro means anything here. */
  usesRuleSet: boolean;

  /** The starting ball layout. */
  rack(seatCount: number, rand: () => number): Ball[];

  /** Groups, lives, orbs — anything that depends on who is seated. Called on every new frame. */
  assignSeats(state: GameState, rand: () => number): void;

  /** Which balls the shooter may legally strike first — drives the highlight rings. */
  legalTargetBallIds(state: GameState): number[];

  /** What the shooter has to nominate before shooting. */
  callRequirement(state: GameState, rules: RuleOptions): CallRequirement;

  /** Apply this mode's rules to a settled shot, mutating `state`. */
  resolveShot(state: GameState, outcome: ShotOutcome, ctx: ShotContext): ModeResult;
}

/** Seats still in the frame, in turn order. */
export function activeSeats(state: GameState): Seat[] {
  return state.seatOrder.filter((seat) => !state.players[seat].eliminated);
}
