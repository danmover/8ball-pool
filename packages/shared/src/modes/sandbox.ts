import type { GameState } from '../types.js';
import { CUE_BALL_ID } from '../constants.js';
import { rackBalls } from '../rack.js';
import type { ModeDescriptor } from './types.js';

/**
 * Trick-shot sandbox: no turns, no fouls, no winner. The shooter never changes and a scratch
 * just gives the cue ball back, so you can set up and practise a shot indefinitely.
 */
export const sandboxMode: ModeDescriptor = {
  id: 'sandbox',
  name: 'Trick Shot',
  blurb: 'No rules, no turns. Set the table up however you like and fire away.',
  rulesSummary: [
    'No fouls and no turn order — the table is always yours',
    'Scratch and the cue ball comes straight back',
    'Re-rack any time from the table menu',
  ],
  minPlayers: 1,
  maxPlayers: 8,
  supportsShotClock: false,
  rack: () => rackBalls(),
  assignSeats: (state) => {
    for (const seat of state.seatOrder) {
      state.players[seat].group = null;
      state.players[seat].eliminated = false;
    }
  },
  legalTargetBallIds: (state) =>
    state.balls.filter((b) => !b.pocketed && b.id !== CUE_BALL_ID).map((b) => b.id),
  resolveShot: (state, outcome) => {
    state.turnNumber++;
    state.lastFoulReason = null;
    // A scratch hands the cue ball back rather than passing the table on.
    state.phase = outcome.cueBallPocketed ? 'ball_in_hand' : 'aiming';
  },
};
