import type { GameState } from '../types.js';
import { CUE_BALL_ID } from '../constants.js';
import { rackBalls } from '../rack.js';
import { challengeBalls, challengeById, CHALLENGES, starsFor, type Challenge } from '../challenges.js';
import { endGame, remainingBallIds } from './shared.js';
import type { ModeDescriptor, ModeResult, ShotContext, ShotOutcome } from './types.js';

/**
 * The three solo modes. None of them ever passes the table on — there is nobody to pass it to.
 */

// ---------------------------------------------------------------- practice

export const practiceMode: ModeDescriptor = {
  id: 'practice',
  name: 'Practice',
  blurb: 'No rules. Place the cue ball anywhere, undo shots, re-rack whenever you like.',
  rulesSummary: [
    'No fouls and no turns — the table is always yours',
    'Drag the cue ball to set up any shot',
    'Undo a shot, or re-rack from the menu',
  ],
  minPlayers: 1,
  maxPlayers: 1,
  solo: true,
  supportsShotClock: false,
  usesRuleSet: false,
  rack: () => rackBalls(),
  assignSeats: () => {},
  legalTargetBallIds: (state) => remainingBallIds(state),
  callRequirement: () => 'none',
  resolveShot: (state, outcome) => {
    state.phase = outcome.cueBallPocketed ? 'ball_in_hand' : 'aiming';
    state.ballInHandBehindLine = false;
    return { foul: null, note: outcome.cueBallPocketed ? 'Scratch — place the cue ball' : null };
  },
};

// ---------------------------------------------------------------- time attack

/** What a foul costs. Ten seconds hurts without ending the run. */
export const TIME_ATTACK_PENALTY_MS = 10_000;

/** Par times, fastest first: under the first is three stars. */
export const TIME_ATTACK_PAR_MS = [100_000, 160_000, 260_000];

export function timeAttackStars(totalMs: number): number {
  for (let i = 0; i < TIME_ATTACK_PAR_MS.length; i++) {
    if (totalMs <= TIME_ATTACK_PAR_MS[i]) return TIME_ATTACK_PAR_MS.length - i;
  }
  return 1;
}

/** m:ss.t */
export function formatRunTime(ms: number): string {
  const total = Math.max(0, ms);
  const minutes = Math.floor(total / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const tenths = Math.floor((total % 1000) / 100);
  return `${minutes}:${String(seconds).padStart(2, '0')}.${tenths}`;
}

export const timeAttackMode: ModeDescriptor = {
  id: 'timeattack',
  name: 'Time Attack',
  blurb: 'Clear all fifteen as fast as you can. Fouls cost ten seconds.',
  rulesSummary: [
    'The clock starts on the break and never stops',
    'Any ball, any pocket, any order',
    'A scratch or a clean miss adds ten seconds',
    'Beat 1:40 for three stars',
  ],
  minPlayers: 1,
  maxPlayers: 1,
  solo: true,
  supportsShotClock: false,
  usesRuleSet: false,
  rack: () => rackBalls(),
  assignSeats: (state) => {
    state.timeAttack = { elapsedMs: 0, penaltyMs: 0, fouls: 0, finalMs: null, stars: 0 };
  },
  legalTargetBallIds: (state) => remainingBallIds(state),
  callRequirement: () => 'none',
  resolveShot: (state: GameState, outcome: ShotOutcome, ctx: ShotContext): ModeResult => {
    const run = (state.timeAttack ??= { elapsedMs: 0, penaltyMs: 0, fouls: 0, finalMs: null, stars: 0 });
    const foul = outcome.cueBallPocketed || outcome.firstBallContacted === null;
    if (foul) {
      run.fouls++;
      run.penaltyMs += TIME_ATTACK_PENALTY_MS;
    }
    if (remainingBallIds(state).length === 0) {
      run.finalMs = run.elapsedMs + run.penaltyMs;
      run.stars = timeAttackStars(run.finalMs);
      endGame(state, state.currentShooter, null);
      return { foul: null };
    }
    state.phase = outcome.cueBallPocketed ? 'ball_in_hand' : 'aiming';
    state.ballInHandBehindLine = false;
    void ctx;
    return {
      foul: foul ? `+${TIME_ATTACK_PENALTY_MS / 1000}s — ${outcome.cueBallPocketed ? 'scratch' : 'missed everything'}` : null,
    };
  },
};

// ---------------------------------------------------------------- trick shots

/** The challenge a state is playing, if any. */
export function activeChallenge(state: GameState): Challenge | undefined {
  return state.trick ? challengeById(state.trick.challengeId) : undefined;
}

function judge(challenge: Challenge, state: GameState, outcome: ShotOutcome): boolean {
  // Nothing counts with the cue ball down a pocket.
  if (outcome.cueBallPocketed) return false;
  const potted = outcome.potted.filter((id) => id !== CUE_BALL_ID);
  const goal = challenge.goal;
  const progress = state.trick!;
  switch (goal.kind) {
    case 'potInOne':
      return potted.length >= goal.count;
    case 'cleanPot':
      return potted.includes(goal.ballId) && outcome.firstBallContacted === goal.ballId;
    case 'position': {
      const cue = state.balls.find((b) => b.id === CUE_BALL_ID);
      if (!cue || !potted.includes(goal.ballId) || outcome.firstBallContacted !== goal.ballId) return false;
      const dx = cue.pos.x - goal.zone.x;
      const dy = cue.pos.y - goal.zone.y;
      return dx * dx + dy * dy <= goal.zone.r * goal.zone.r;
    }
    case 'kick':
      return (
        potted.includes(goal.ballId) &&
        outcome.firstBallContacted === goal.ballId &&
        outcome.cushionsBeforeContact >= goal.cushions
      );
    case 'bank':
      return outcome.banked.includes(goal.ballId) && outcome.firstBallContacted === goal.ballId;
    case 'combo':
      return potted.includes(goal.ballId) && outcome.firstBallContacted === goal.via;
    case 'jump':
      return potted.includes(goal.ballId) && outcome.firstBallContacted === goal.ballId && outcome.jumped;
    case 'potOrder':
      return (
        progress.pottedOrder.length >= goal.order.length &&
        goal.order.every((id, i) => progress.pottedOrder[i] === id)
      );
    case 'clearTable':
      return remainingBallIds(state).length === 0;
    default:
      return false;
  }
}

/** The ball a challenge wants hit first, if it names one. */
export function challengeTarget(challenge: Challenge, pottedSoFar: number): number | null {
  const goal = challenge.goal;
  switch (goal.kind) {
    case 'cleanPot':
    case 'position':
    case 'kick':
    case 'bank':
    case 'jump':
      return goal.ballId;
    case 'combo':
      return goal.via;
    case 'potOrder':
      return goal.order[pottedSoFar] ?? null;
    default:
      return null;
  }
}

export const trickShotMode: ModeDescriptor = {
  id: 'trickshot',
  name: 'Trick Shots',
  blurb: 'Hand-built puzzles. One objective, a few shots, three stars to earn.',
  rulesSummary: [
    'Each layout has one objective and a shot budget',
    'Fewer shots, more stars',
    'A scratch just hands the cue ball back',
  ],
  minPlayers: 1,
  maxPlayers: 1,
  solo: true,
  supportsShotClock: false,
  usesRuleSet: false,
  rack: () => challengeBalls(CHALLENGES[0]),
  assignSeats: () => {},
  legalTargetBallIds: (state) => {
    const challenge = activeChallenge(state);
    const live = remainingBallIds(state);
    if (!challenge) return live;
    const target = challengeTarget(challenge, state.trick?.pottedOrder.length ?? 0);
    return target === null ? live : live.filter((id) => id === target);
  },
  callRequirement: () => 'none',
  resolveShot: (state, outcome) => {
    const progress = state.trick;
    const challenge = activeChallenge(state);
    if (!progress || !challenge) {
      state.phase = 'aiming';
      return { foul: null };
    }
    progress.shotsUsed++;
    for (const id of outcome.potted) if (id !== CUE_BALL_ID) progress.pottedOrder.push(id);

    if (judge(challenge, state, outcome)) {
      progress.stars = starsFor(challenge, progress.shotsUsed);
      endGame(state, state.currentShooter, null);
      return { foul: null };
    }

    const goal = challenge.goal;
    const brokenOrder =
      goal.kind === 'potOrder' &&
      progress.pottedOrder.some((id, i) => i < goal.order.length && id !== goal.order[i]);
    if (brokenOrder || progress.shotsUsed >= challenge.shotLimit) {
      progress.failed = true;
      progress.stars = 0;
      endGame(state, null, brokenOrder ? 'Wrong order' : 'Out of shots');
      return { foul: null };
    }

    state.phase = outcome.cueBallPocketed ? 'ball_in_hand' : 'aiming';
    state.ballInHandBehindLine = false;
    return { foul: null, note: outcome.cueBallPocketed ? 'Scratch — cue ball returned' : null };
  },
};
