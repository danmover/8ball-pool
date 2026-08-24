import type { GameState } from '../types.js';
import { CUE_BALL_ID } from '../constants.js';
import { challengeBalls, challengeById, starsFor, type Challenge } from '../challenges.js';
import { endGame } from './shared.js';
import type { ModeDescriptor, ShotContext, ShotOutcome } from './types.js';

/**
 * Trick-shot challenges: a fixed layout, one objective, and a shot budget.
 *
 * The active challenge is carried on the game state rather than held in a module variable, so
 * the server stays stateless per room and two rooms can run different challenges at once.
 */

/** Which challenge a room is playing, plus the progress toward its objective. */
export interface ChallengeState {
  challengeId: string;
  shotsUsed: number;
  /** Balls potted so far, in the order they dropped — used by `potOrder`. */
  pottedOrder: number[];
  /** Set when the objective is met; the frame ends immediately after. */
  stars: number;
  failed: boolean;
}

/** The challenge a state is currently playing, if any. */
export function activeChallenge(state: GameState): Challenge | undefined {
  return state.challenge ? challengeById(state.challenge.challengeId) : undefined;
}

function judge(
  challenge: Challenge,
  state: GameState,
  outcome: ShotOutcome,
  progress: ChallengeState
): boolean {
  const potted = outcome.potted.filter((id) => id !== CUE_BALL_ID);
  const goal = challenge.goal;

  switch (goal.kind) {
    case 'potInOne':
      return potted.length >= goal.count;

    case 'cleanPot':
      // Must be the first thing the cue ball touched, so it can't be nudged in off another.
      return potted.includes(goal.ballId) && outcome.firstBallContacted === goal.ballId;

    case 'bankShot':
      return potted.includes(goal.ballId) && outcome.cushionsBeforeContact >= goal.cushions;

    case 'potOrder':
      // Compare against everything potted across the whole attempt, not just this shot.
      return (
        progress.pottedOrder.length >= goal.order.length &&
        goal.order.every((id, i) => progress.pottedOrder[i] === id)
      );

    case 'clearTable':
      return state.balls.every((b) => b.id === CUE_BALL_ID || b.pocketed);

    default:
      return false;
  }
}

function resolve(state: GameState, outcome: ShotOutcome, ctx: ShotContext): void {
  const progress = state.challenge;
  const challenge = activeChallenge(state);
  if (!progress || !challenge) {
    state.phase = 'aiming';
    return;
  }

  progress.shotsUsed++;
  for (const id of outcome.potted) {
    if (id !== CUE_BALL_ID) progress.pottedOrder.push(id);
  }

  // A scratch is never fatal here — you just get the cue ball back and try again. Losing a
  // whole attempt to a scratch on shot one would be miserable in a puzzle.
  const scratched = outcome.cueBallPocketed;

  if (judge(challenge, state, outcome, progress)) {
    progress.stars = starsFor(challenge, progress.shotsUsed);
    endGame(state, state.currentShooter, null);
    return;
  }

  // An out-of-order pot in a sequence challenge can't be recovered from.
  const goal = challenge.goal;
  const brokenOrder =
    goal.kind === 'potOrder' &&
    progress.pottedOrder.some((id, i) => i < goal.order.length && id !== goal.order[i]);

  if (brokenOrder || progress.shotsUsed >= challenge.shotLimit) {
    progress.failed = true;
    progress.stars = 0;
    endGame(state, null, brokenOrder ? 'Wrong order' : 'Out of shots');
    return;
  }

  state.turnNumber++;
  state.lastFoulReason = scratched ? 'Scratch — cue ball returned' : null;
  state.phase = scratched ? 'ball_in_hand' : 'aiming';
  void ctx;
}

export const challengeMode: ModeDescriptor = {
  id: 'challenge',
  name: 'Trick Shots',
  blurb: 'Hand-built puzzles. One objective, a handful of shots, three stars to earn.',
  rulesSummary: [
    'Each layout has a single objective and a shot budget',
    'Fewer shots means more stars',
    'Scratching just hands the cue ball back — only the budget really matters',
  ],
  minPlayers: 1,
  maxPlayers: 1,
  supportsShotClock: false,
  // The real layout is installed by the server when a challenge is chosen; this is the
  // fallback so the mode is never in an invalid state.
  rack: () => challengeBalls(challengeById('ch.straight')!),
  assignSeats: (state) => {
    for (const seat of state.seatOrder) {
      state.players[seat].group = null;
      state.players[seat].eliminated = false;
    }
  },
  legalTargetBallIds: (state) => {
    const challenge = activeChallenge(state);
    const live = state.balls.filter((b) => !b.pocketed && b.id !== CUE_BALL_ID).map((b) => b.id);
    if (!challenge) return live;

    // Highlight only what the objective actually cares about, so the target is never ambiguous.
    const goal = challenge.goal;
    switch (goal.kind) {
      case 'cleanPot':
      case 'bankShot':
        return live.filter((id) => id === goal.ballId);
      case 'potOrder': {
        const next = goal.order[state.challenge?.pottedOrder.length ?? 0];
        return next === undefined ? live : live.filter((id) => id === next);
      }
      default:
        return live;
    }
  },
  resolveShot: resolve,
};
