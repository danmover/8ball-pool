import type { SimEvent } from './types.js';
import { CUE_BALL_ID, TABLE_LENGTH } from './constants.js';

/**
 * Reading a shot back in words.
 *
 * Every one of these is derived from the events the shot actually produced — no thresholds
 * invented to make the game flatter you. "Three rails" means the cue ball hit three cushions
 * before contact, and a shot that didn't do that never gets the callout, however good it was.
 *
 * That restraint is the whole point. Praise that fires on everything stops being praise, and
 * the first time a player notices the game calling a tap-in a "long pot" they stop believing
 * any of it.
 */

export interface ShotFacts {
  pots: number;
  /** Distance the potted ball travelled, in table units. */
  potDistance: number;
  /** Cushions the cue ball struck before it touched anything. */
  railsBeforeContact: number;
  /** Cushions struck by any ball after first contact. */
  railsAfterContact: number;
  /** The shot won the frame. */
  wonFrame: boolean;
  /** Balls left on the table after the shot, excluding the cue ball. */
  ballsRemaining: number;
  /** The visit that this shot ended, in balls potted across it. */
  visitRun: number;
  /** The cue ball left the cloth. */
  jumped: boolean;
  /** The cue was elevated past the point where the shot is a massé. */
  massed: boolean;
  /** The shot was a foul. */
  fouled: boolean;
}

export interface Callout {
  /** Short, shouted. */
  text: string;
  /** Higher wins when several apply — only one is ever shown. */
  weight: number;
  /** Drives the styling: a foul should not look like a triumph. */
  tone: 'great' | 'good' | 'wry';
}

/** A pot from beyond this is a long one, on a table this length. */
const LONG_POT = TABLE_LENGTH * 0.55;

/**
 * Everything that applies to this shot, best first.
 *
 * Returned as a list rather than a single answer so the caller can decide how much to say —
 * and so the whole thing stays a pure function of the facts, which is what makes it testable.
 */
export function calloutsFor(facts: ShotFacts): Callout[] {
  const out: Callout[] = [];

  // A foul is the one thing that overrides everything else. Congratulating someone on the
  // three-rail route their cue ball took into a pocket would be worse than saying nothing.
  if (facts.fouled) {
    if (facts.railsBeforeContact >= 3) out.push({ text: 'SCENIC ROUTE', weight: 20, tone: 'wry' });
    else if (facts.jumped) out.push({ text: 'AIRBORNE — AND A FOUL', weight: 20, tone: 'wry' });
    return out;
  }

  if (facts.wonFrame) out.push({ text: 'THAT WINS IT', weight: 100, tone: 'great' });

  if (facts.ballsRemaining === 0 && facts.pots > 0) {
    out.push({ text: 'TABLE CLEARED', weight: 95, tone: 'great' });
  }

  if (facts.pots > 0 && facts.massed) out.push({ text: 'MASSÉ!', weight: 90, tone: 'great' });
  if (facts.pots > 0 && facts.jumped) out.push({ text: 'JUMP SHOT!', weight: 88, tone: 'great' });

  if (facts.pots > 0 && facts.railsBeforeContact >= 3) {
    out.push({ text: 'THREE RAILS', weight: 86, tone: 'great' });
  } else if (facts.pots > 0 && facts.railsBeforeContact === 2) {
    out.push({ text: 'DOUBLE BANK', weight: 70, tone: 'good' });
  } else if (facts.pots > 0 && facts.railsBeforeContact === 1) {
    out.push({ text: 'OFF THE RAIL', weight: 55, tone: 'good' });
  }

  if (facts.pots >= 3) out.push({ text: 'THREE AT ONCE', weight: 84, tone: 'great' });
  else if (facts.pots === 2) out.push({ text: 'TWO IN ONE', weight: 68, tone: 'good' });

  if (facts.visitRun >= 5) out.push({ text: `${facts.visitRun} IN A ROW`, weight: 82, tone: 'great' });
  else if (facts.visitRun === 4) out.push({ text: 'FOUR ON THE TROT', weight: 66, tone: 'good' });

  if (facts.pots > 0 && facts.potDistance >= LONG_POT) {
    out.push({ text: 'LONG POT', weight: 60, tone: 'good' });
  }

  if (facts.pots === 0 && facts.railsAfterContact >= 3) {
    // Not a pot, but a deliberate-looking safety is worth noticing.
    out.push({ text: 'GOOD SAFETY', weight: 30, tone: 'good' });
  }

  return out.sort((a, b) => b.weight - a.weight);
}

/** The single callout worth showing, or null when the shot was simply a shot. */
export function bestCallout(facts: ShotFacts): Callout | null {
  return calloutsFor(facts)[0] ?? null;
}

/**
 * Reads the facts a callout needs out of a shot's raw events.
 *
 * The rest — whether the frame was won, how long the visit ran — is state the caller knows and
 * the events do not.
 */
export function factsFromEvents(
  events: SimEvent[],
  rest: Pick<ShotFacts, 'wonFrame' | 'ballsRemaining' | 'visitRun' | 'jumped' | 'massed' | 'fouled'>,
  startPositions: Map<number, { x: number; y: number }>
): ShotFacts {
  let contacted = false;
  let railsBefore = 0;
  let railsAfter = 0;
  let pots = 0;
  let potDistance = 0;

  for (const ev of events) {
    if (ev.type === 'cushion') {
      if (ev.ballId === CUE_BALL_ID && !contacted) railsBefore++;
      else if (contacted) railsAfter++;
    } else if (ev.type === 'ballCollision') {
      if (ev.a === CUE_BALL_ID || ev.b === CUE_BALL_ID) contacted = true;
    } else if (ev.type === 'pot' && ev.ballId !== CUE_BALL_ID) {
      pots++;
      const from = startPositions.get(ev.ballId);
      if (from) {
        potDistance = Math.max(potDistance, Math.hypot(ev.pos.x - from.x, ev.pos.y - from.y));
      }
    }
  }

  return { pots, potDistance, railsBeforeContact: railsBefore, railsAfterContact: railsAfter, ...rest };
}
