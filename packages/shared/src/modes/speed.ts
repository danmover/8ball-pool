import type { GameState } from '../types.js';
import { CUE_BALL_ID } from '../constants.js';
import { rackBalls } from '../rack.js';
import { endGame } from './shared.js';
import type { ModeDescriptor, ShotContext, ShotOutcome } from './types.js';

/** What a foul costs. Ten seconds hurts without ending the run, which is the point. */
export const SPEED_FOUL_PENALTY_MS = 10_000;

/**
 * The times a run is graded against, fastest first. Three stars is quick; one is a finish.
 * Fifteen balls in ninety seconds is roughly a strong club player having a good day.
 */
export const SPEED_PAR_MS = [90_000, 150_000, 240_000];

/** Elapsed time plus penalties — the number on the board. */
export function speedTotalMs(run: { startedAt: number; penaltyMs: number }, now: number): number {
  return Math.max(0, now - run.startedAt) + run.penaltyMs;
}

/** Stars for a finished run: 3 for beating the first par time, down to 1 for finishing at all. */
export function speedStars(totalMs: number): number {
  for (let i = 0; i < SPEED_PAR_MS.length; i++) {
    if (totalMs <= SPEED_PAR_MS[i]) return SPEED_PAR_MS.length - i;
  }
  return 1;
}

/** mm:ss.t, which is how a run this length reads most naturally. */
export function formatSpeedTime(ms: number): string {
  const total = Math.max(0, ms);
  const minutes = Math.floor(total / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const tenths = Math.floor((total % 1000) / 100);
  return `${minutes}:${String(seconds).padStart(2, '0')}.${tenths}`;
}

/**
 * Speed pool: fifteen balls, one player, and a clock that never stops.
 *
 * The opposite pressure to the ghost. There, one miss ends everything and the answer is to
 * slow down and play safe; here missing only costs you seconds, so the answer is to keep
 * moving and take the shot that's on. The two together cover both halves of playing well.
 *
 * Fouls carry a time penalty rather than ending the run, because a run that ends on a scratch
 * fifteen seconds in isn't a race, it's the ghost with extra steps.
 */
export const speedMode: ModeDescriptor = {
  id: 'speed',
  name: 'Speed Pool',
  blurb: 'Clear all fifteen against the clock. Fouls cost ten seconds.',
  rulesSummary: [
    'Clear every ball as fast as you can — the clock starts on the break',
    'Any order, any pocket; there is no missing, only slower',
    'A scratch or a miss of the whole rack adds ten seconds',
    'Under 1:30 is three stars',
  ],
  minPlayers: 1,
  maxPlayers: 1,
  supportsShotClock: false,
  rack: () => rackBalls(),

  assignSeats: (state) => {
    for (const seat of state.seatOrder) {
      state.players[seat].group = null;
      state.players[seat].eliminated = false;
      state.players[seat].score = 0;
    }
    // The clock starts with the frame. A new rack is a new run.
    state.speedRun = { startedAt: Date.now(), penaltyMs: 0, fouls: 0, finalMs: null, stars: 0 };
  },

  legalTargetBallIds: (state) =>
    state.balls.filter((b) => !b.pocketed && b.id !== CUE_BALL_ID).map((b) => b.id),

  resolveShot: (state: GameState, outcome: ShotOutcome, ctx: ShotContext) => {
    const shooter = state.currentShooter;
    state.turnNumber++;
    const now = ctx.now ?? Date.now();
    const run = state.speedRun ?? { startedAt: now, penaltyMs: 0, fouls: 0, finalMs: null, stars: 0 };
    state.speedRun = run;

    const potted = outcome.potted.filter((id) => id !== CUE_BALL_ID);
    state.players[shooter].score += potted.length;

    // The penalty is for the shot going wrong, not for the table being awkward — hitting a
    // ball and failing to pot it is simply a slower route, and is not punished twice.
    const fouled = outcome.cueBallPocketed || outcome.firstBallContacted === null;
    if (fouled) {
      run.fouls++;
      run.penaltyMs += SPEED_FOUL_PENALTY_MS;
    }

    const cleared = state.balls.every((b) => b.id === CUE_BALL_ID || b.pocketed);
    if (cleared) {
      run.finalMs = speedTotalMs(run, now);
      run.stars = speedStars(run.finalMs);
      endGame(state, shooter, null);
      return;
    }

    // The shooter never loses the table — there is nobody to lose it to.
    state.phase = outcome.cueBallPocketed ? 'ball_in_hand' : 'aiming';
    state.lastFoulReason = fouled ? `Foul — +${SPEED_FOUL_PENALTY_MS / 1000}s` : null;
  },
};
