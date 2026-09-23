import type { GameState } from '../types.js';
import { CUE_BALL_ID } from '../constants.js';
import { rackNineBall } from '../rack.js';
import { basicFoul, endGame, lowestBallId, nextActiveSeat, respot } from './shared.js';
import type { ModeDescriptor, ModeResult, ShotContext, ShotOutcome } from './types.js';

const NINE = 9;

/**
 * Nine-ball: balls 1-9, always strike the lowest ball first, and whoever legally sinks the 9
 * wins — including off a combination, which is the rule that makes the game.
 */
function resolve(state: GameState, outcome: ShotOutcome, ctx: ShotContext): ModeResult {
  const shooter = state.currentShooter;

  let foul = basicFoul(outcome, ctx.timedOut);
  if (!foul && ctx.lowestBefore !== null && outcome.firstBallContacted !== ctx.lowestBefore) {
    foul = `Must hit the ${ctx.lowestBefore} first`;
  }

  if (outcome.potted.includes(NINE)) {
    if (!foul) {
      endGame(state, shooter, null);
      return { foul: null };
    }
    // Fouled the 9 in: it comes back up on the foot spot and play passes on.
    respot(state, NINE);
  }

  if (foul) {
    state.currentShooter = nextActiveSeat(state, shooter);
    state.phase = 'ball_in_hand';
    state.ballInHandBehindLine = false;
    return { foul };
  }

  state.phase = 'aiming';
  if (!outcome.potted.some((id) => id !== CUE_BALL_ID)) {
    state.currentShooter = nextActiveSeat(state, shooter);
  }
  return { foul: null };
}

export const nineBallMode: ModeDescriptor = {
  id: 'nineball',
  name: '9-Ball',
  blurb: 'Hit the lowest ball first. Sink the 9 — any way you can — and it’s yours.',
  rulesSummary: [
    'Only balls 1–9 are racked',
    'Always strike the lowest-numbered ball first',
    'Legally potting the 9 wins instantly — combinations count',
    'Foul and your opponent gets ball in hand anywhere',
  ],
  minPlayers: 2,
  maxPlayers: 4,
  solo: false,
  supportsShotClock: true,
  usesRuleSet: false,
  rack: () => rackNineBall(),
  assignSeats: (state) => {
    for (const seat of state.seatOrder) state.players[seat].group = null;
  },
  legalTargetBallIds: (state) => {
    const lowest = lowestBallId(state);
    return lowest === null ? [] : [lowest];
  },
  callRequirement: () => 'none',
  resolveShot: resolve,
};
