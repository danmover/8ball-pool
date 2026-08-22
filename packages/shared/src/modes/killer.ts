import type { GameState } from '../types.js';
import { CUE_BALL_ID } from '../constants.js';
import { rackScattered } from '../rack.js';
import { endGame, nextActiveSeat, remainingBallIds } from './shared.js';
import { activeSeats, type ModeDescriptor, type ShotContext, type ShotOutcome } from './types.js';

/**
 * Killer: everyone gets three lives and has to pot *something* on every visit. Miss, foul, or
 * run out the clock and you drop a life. Lose all three and you're out; last player alive wins.
 *
 * Any object ball is fair game, which keeps it fast and readable with a full lobby of eight.
 */
export const STARTING_LIVES = 3;

function resolve(state: GameState, outcome: ShotOutcome, ctx: ShotContext): void {
  const shooter = state.currentShooter;
  const player = state.players[shooter];

  let foulReason: string | null = null;
  if (ctx.timedOut) foulReason = 'Shot clock expired';
  else if (outcome.cueBallPocketed) foulReason = 'Scratch: cue ball pocketed';
  else if (outcome.firstBallContacted === null) foulReason = 'No ball contacted';

  const potted = outcome.potted.filter((id) => id !== CUE_BALL_ID);
  const survived = !foulReason && potted.length > 0;

  if (!survived) {
    player.lives = Math.max(0, (player.lives ?? STARTING_LIVES) - 1);
    state.lastFoulReason =
      foulReason ?? `${player.name} failed to pot — ${player.lives} ${player.lives === 1 ? 'life' : 'lives'} left`;
    if (player.lives === 0) player.eliminated = true;
  } else {
    state.lastFoulReason = null;
  }

  // Re-rack once the table empties so a long game doesn't simply run out of balls. Seeded
  // off the turn number so each spread differs but stays reproducible.
  if (remainingBallIds(state).length === 0) {
    const fresh = rackScattered(state.turnNumber + 7);
    const cue = state.balls.find((b) => b.id === CUE_BALL_ID);
    state.balls = fresh.map((b) =>
      b.id === CUE_BALL_ID && cue ? { ...cue, pocketed: false } : b
    );
  }

  const stillIn = activeSeats(state);
  if (stillIn.length <= 1) {
    endGame(state, stillIn[0] ?? null, state.lastFoulReason);
    return;
  }

  state.turnNumber++;
  // The table always passes on in killer — that's what makes every visit count.
  state.currentShooter = nextActiveSeat(state, shooter);
  state.phase = outcome.cueBallPocketed ? 'ball_in_hand' : 'aiming';
}

export const killerMode: ModeDescriptor = {
  id: 'killer',
  name: 'Killer',
  blurb: 'Three lives each. Fail to pot on your turn and you lose one.',
  rulesSummary: [
    'Any ball counts — just pot something every visit',
    'A miss, a foul, or the clock running out costs you a life',
    'Lose all three lives and you’re out',
    'The table always passes on, even when you score',
  ],
  minPlayers: 2,
  maxPlayers: 8,
  supportsShotClock: true,
  // Killer is played on an open table: from a tight rack nobody can pot on their first few
  // visits, and with lives on the line the frame ends before the balls ever break up.
  rack: () => rackScattered(),
  assignSeats: (state) => {
    for (const seat of state.seatOrder) {
      state.players[seat].lives = STARTING_LIVES;
      state.players[seat].eliminated = false;
      state.players[seat].group = null;
    }
  },
  legalTargetBallIds: (state) =>
    state.balls.filter((b) => !b.pocketed && b.id !== CUE_BALL_ID).map((b) => b.id),
  resolveShot: resolve,
};

/** Exported so the UI can render a full row of hearts regardless of lives remaining. */
export function livesFor(state: GameState, seat: string): number {
  return state.players[seat]?.lives ?? 0;
}
