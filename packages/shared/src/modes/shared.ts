import type { GameState, Seat } from '../types.js';
import { CUE_BALL_ID } from '../constants.js';
import { activeSeats } from './types.js';

/**
 * Helpers used by more than one mode. Kept here rather than in `rules.ts` so the mode
 * modules don't have to import from their own dispatcher.
 */

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

export function endGame(state: GameState, winner: Seat | null, foulReason: string | null): void {
  state.phase = 'game_over';
  state.winner = winner;
  state.winningTeam = winner ? (state.players[winner]?.team ?? null) : null;
  state.lastFoulReason = foulReason;
  state.shotClock = null;
}

/** Object balls (everything but the cue) still on the table. */
export function remainingBallIds(state: GameState): number[] {
  return state.balls.filter((b) => !b.pocketed && b.id !== CUE_BALL_ID).map((b) => b.id);
}

/** Lowest-numbered object ball still up — the only legal first contact in rotation/9-ball. */
export function lowestBallId(state: GameState): number | null {
  const remaining = remainingBallIds(state);
  return remaining.length ? Math.min(...remaining) : null;
}

/**
 * The standard foul checks shared by every mode that has fouls: scratch, no contact, and no
 * rail after contact. Modes layer their own legal-target rule on top.
 */
export function basicFoul(outcome: {
  cueBallPocketed: boolean;
  firstBallContacted: number | null;
  potted: number[];
  anyCushionAfterContact: boolean;
}): string | null {
  if (outcome.cueBallPocketed) return 'Scratch: cue ball pocketed';
  if (outcome.firstBallContacted === null) return 'No ball contacted';
  if (outcome.potted.length === 0 && !outcome.anyCushionAfterContact) return 'No rail after contact';
  return null;
}

/** Hands the frame to the next player with ball in hand after a foul. */
export function giveBallInHand(state: GameState, foulReason: string | null): void {
  state.currentShooter = nextActiveSeat(state, state.currentShooter);
  state.phase = 'ball_in_hand';
  state.lastFoulReason = foulReason;
}
