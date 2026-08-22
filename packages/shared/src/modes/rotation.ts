import type { GameState } from '../types.js';
import { CUE_BALL_ID } from '../constants.js';
import { rackBalls } from '../rack.js';
import { endGame, lowestBallId, nextActiveSeat } from './shared.js';
import type { ModeDescriptor, ShotContext, ShotOutcome } from './types.js';

/** Free-for-all rotation: lowest ball first, every ball you pot scores its face value. */

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

  // Balls potted on a foul don't score, but they stay down.
  const scored = foul ? [] : outcome.potted.filter((id) => id !== CUE_BALL_ID);
  for (const id of scored) state.players[shooter].score += id;

  const tableCleared = state.balls.every((b) => b.id === CUE_BALL_ID || b.pocketed);
  if (tableCleared) {
    let best = state.seatOrder[0] ?? null;
    for (const seat of state.seatOrder) {
      if (best === null || state.players[seat].score > state.players[best].score) best = seat;
    }
    endGame(state, best, foulReason);
    return;
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
  if (scored.length === 0) state.currentShooter = nextActiveSeat(state, shooter);
}

export const rotationMode: ModeDescriptor = {
  id: 'rotation',
  name: 'Rotation',
  blurb: 'Free-for-all. Hit the lowest ball first; every pot scores its number.',
  rulesSummary: [
    'You must strike the lowest-numbered ball on the table first',
    'Every ball you legally pot scores its face value',
    'Highest score when the table clears takes it',
  ],
  minPlayers: 2,
  maxPlayers: 8,
  supportsShotClock: true,
  rack: () => rackBalls(),
  assignSeats: () => {},
  legalTargetBallIds: (state) => {
    const lowest = lowestBallId(state);
    return lowest === null ? [] : [lowest];
  },
  resolveShot: resolve,
};
