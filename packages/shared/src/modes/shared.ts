import type { GameState, Seat } from '../types.js';
import { CUE_BALL_ID, TABLE_LENGTH, TABLE_WIDTH, BALL_DIAMETER } from '../constants.js';
import { restBall } from '../physics.js';
import { Vec2 } from '../vector.js';
import { activeSeats } from './types.js';

/** Helpers used by more than one mode. */

/** Next seat still in the frame, wrapping around. Falls back to `seat` if nobody's left. */
export function nextActiveSeat(state: GameState, seat: Seat): Seat {
  const order = activeSeats(state);
  if (order.length === 0) return seat;
  const i = order.indexOf(seat);
  // If the current shooter was just eliminated they're no longer in `order`, so fall back to
  // whoever follows them in the full seat order.
  if (i === -1) {
    const all = state.seatOrder;
    const from = all.indexOf(seat);
    for (let step = 1; step <= all.length; step++) {
      const candidate = all[(from + step) % all.length];
      if (!state.players[candidate].eliminated) return candidate;
    }
    return seat;
  }
  return order[(i + 1) % order.length];
}

export function endGame(state: GameState, winner: Seat | null, reason: string | null = null): void {
  state.phase = 'game_over';
  state.winner = winner;
  state.winningTeam = winner ? (state.players[winner]?.team ?? null) : null;
  state.lastFoulReason = reason;
  state.clock = null;
}

/** Object balls (everything but the cue) still on the table. */
export function remainingBallIds(state: GameState): number[] {
  return state.balls.filter((b) => !b.pocketed && b.id !== CUE_BALL_ID).map((b) => b.id);
}

/** Lowest-numbered object ball still up — the only legal first contact in 9-ball. */
export function lowestBallId(state: GameState): number | null {
  const remaining = remainingBallIds(state);
  return remaining.length ? Math.min(...remaining) : null;
}

/** Every object ball still up. */
export function anyBall(state: GameState): number[] {
  return remainingBallIds(state);
}

/**
 * The standard foul checks shared by every mode that has fouls: timeout, scratch, no contact,
 * and no rail after contact. Modes layer their own legal-target rule on top.
 */
export function basicFoul(
  outcome: {
    cueBallPocketed: boolean;
    firstBallContacted: number | null;
    potted: number[];
    anyCushionAfterContact: boolean;
  },
  timedOut = false,
  requireRail = true
): string | null {
  if (timedOut) return 'Shot clock expired';
  if (outcome.cueBallPocketed) return 'Scratch — cue ball potted';
  if (outcome.firstBallContacted === null) return 'No ball hit';
  if (requireRail && outcome.potted.length === 0 && !outcome.anyCushionAfterContact) {
    return 'No rail after contact';
  }
  return null;
}

/** Foot spot: where a re-spotted ball goes. */
export const FOOT_SPOT = { x: TABLE_LENGTH * 0.72, y: TABLE_WIDTH / 2 };

/**
 * Brings a potted ball back up on the foot spot, sliding it back along the centre line until it
 * is clear of other balls — the way a referee would.
 */
export function respot(state: GameState, id: number): void {
  const ball = state.balls.find((b) => b.id === id);
  if (!ball) return;
  let x = FOOT_SPOT.x;
  const clear = (px: number): boolean =>
    state.balls.every(
      (b) => b.id === id || b.pocketed || Vec2.distance(b.pos, { x: px, y: FOOT_SPOT.y }) >= BALL_DIAMETER
    );
  while (!clear(x) && x < TABLE_LENGTH - BALL_DIAMETER) x += BALL_DIAMETER * 0.5;
  ball.pocketed = false;
  ball.pos = { x, y: FOOT_SPOT.y };
  restBall(ball);
}
