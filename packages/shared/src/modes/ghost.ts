import type { GameState } from '../types.js';
import { CUE_BALL_ID } from '../constants.js';
import { rackBalls } from '../rack.js';
import { endGame } from './shared.js';
import type { ModeDescriptor, ShotContext, ShotOutcome } from './types.js';

/**
 * Playing the ghost: one player, one chance.
 *
 * The oldest solo drill there is. You get the table to yourself, and you have to clear every
 * ball in a single unbroken visit — the "ghost" is an imaginary opponent so good that the
 * moment you miss, the rack is theirs. There is no opponent to model, which is exactly why it
 * works: the pressure comes from the format rather than from a bot playing well.
 *
 * It's a far better measure of how you're actually playing than a frame against a bot, because
 * a bot's mistakes can carry you and the ghost's never will.
 */
export const ghostMode: ModeDescriptor = {
  id: 'ghost',
  name: 'Play the Ghost',
  blurb: 'Clear the table in one visit. Miss once and the rack is gone.',
  rulesSummary: [
    'You have the table to yourself — and exactly one visit',
    'Miss, foul or scratch and the rack is lost',
    'Clear all fifteen and you have beaten the ghost',
  ],
  minPlayers: 1,
  maxPlayers: 1,
  supportsShotClock: true,
  rack: () => rackBalls(),
  assignSeats: (state) => {
    for (const seat of state.seatOrder) {
      state.players[seat].group = null;
      state.players[seat].eliminated = false;
      state.players[seat].score = 0;
    }
  },
  legalTargetBallIds: (state) =>
    state.balls.filter((b) => !b.pocketed && b.id !== CUE_BALL_ID).map((b) => b.id),

  resolveShot: (state: GameState, outcome: ShotOutcome, ctx: ShotContext) => {
    const shooter = state.currentShooter;
    state.turnNumber++;

    // The break is free — you can't be expected to pot on it, and losing the rack before you
    // have taken a shot at anything would just be annoying.
    const wasBreak = state.phase === 'break';

    const potted = outcome.potted.filter((id) => id !== CUE_BALL_ID);
    state.players[shooter].score += potted.length;

    const cleared = state.balls.every((b) => b.id === CUE_BALL_ID || b.pocketed);
    if (cleared) {
      endGame(state, shooter, null);
      return;
    }

    if (ctx.timedOut) {
      endGame(state, null, 'Shot clock expired — the ghost takes the rack');
      return;
    }

    let lost: string | null = null;
    if (outcome.cueBallPocketed) lost = 'Scratch — the ghost takes the rack';
    else if (outcome.firstBallContacted === null) lost = 'No contact — the ghost takes the rack';
    else if (!wasBreak && potted.length === 0) lost = 'Missed — the ghost takes the rack';

    if (lost) {
      // `null` winner: nobody won. The ghost isn't a seat, so there is no one to award it to,
      // and inventing a phantom player would ripple through every scoreboard in the game.
      endGame(state, null, lost);
      return;
    }

    state.phase = 'aiming';
    state.lastFoulReason = null;
  },
};
