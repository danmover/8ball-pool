import type { GameState } from '../types.js';
import { TABLE_LENGTH, TABLE_WIDTH } from '../constants.js';
import { rackNineBall } from '../rack.js';
import { restBall } from '../physics.js';
import { endGame, lowestBallId, nextActiveSeat } from './shared.js';
import type { ModeDescriptor, ShotContext, ShotOutcome } from './types.js';

const NINE = 9;

/**
 * Proper nine-ball: balls 1-9 only, always strike the lowest ball first, and whoever legally
 * sinks the 9 wins — including off a combination, which is the rule that makes the mode.
 */
function resolve(state: GameState, outcome: ShotOutcome, ctx: ShotContext): void {
  const shooter = state.currentShooter;

  let foulReason: string | null = null;
  if (ctx.timedOut) {
    foulReason = 'Shot clock expired';
  } else if (outcome.cueBallPocketed) {
    foulReason = 'Scratch: cue ball pocketed';
  } else if (outcome.firstBallContacted === null) {
    foulReason = 'No ball contacted';
  } else if (ctx.lowestBefore !== null && outcome.firstBallContacted !== ctx.lowestBefore) {
    foulReason = `Must hit the ${ctx.lowestBefore} ball first`;
  } else if (outcome.potted.length === 0 && !outcome.anyCushionAfterContact) {
    foulReason = 'No rail after contact';
  }
  const foul = foulReason !== null;

  if (outcome.potted.includes(NINE)) {
    if (!foul) {
      endGame(state, shooter, null);
      return;
    }
    // Fouled the 9 in: it comes back up on the foot spot and play passes on.
    const nine = state.balls.find((b) => b.id === NINE);
    if (nine) {
      nine.pocketed = false;
      nine.pos = { x: TABLE_LENGTH * 0.72, y: TABLE_WIDTH / 2 };
      restBall(nine);
    }
  }

  state.turnNumber++;
  if (foul) {
    state.currentShooter = nextActiveSeat(state, shooter);
    state.phase = 'ball_in_hand';
    state.lastFoulReason = foulReason;
    return;
  }

  state.phase = 'aiming';
  state.lastFoulReason = null;
  // Pot anything legally and you stay at the table; otherwise it's a handover.
  if (outcome.potted.length === 0) state.currentShooter = nextActiveSeat(state, shooter);
}

export const nineBallMode: ModeDescriptor = {
  id: 'nineball',
  name: '9-Ball',
  blurb: 'Balls 1 to 9. Lowest first — sink the 9 however you can and it’s yours.',
  rulesSummary: [
    'Only balls 1-9 are on the table',
    'Always strike the lowest-numbered ball first',
    'Legally potting the 9 wins instantly, combinations included',
    'Foul the 9 in and it comes straight back up',
  ],
  minPlayers: 2,
  maxPlayers: 8,
  supportsShotClock: true,
  rack: () => rackNineBall(),
  assignSeats: () => {},
  legalTargetBallIds: (state) => {
    const lowest = lowestBallId(state);
    return lowest === null ? [] : [lowest];
  },
  resolveShot: resolve,
};
