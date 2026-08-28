import { describe, expect, it } from 'vitest';
import { createInitialGameState, resolveShot } from '../rules.js';
import {
  formatSpeedTime,
  speedStars,
  speedTotalMs,
  SPEED_FOUL_PENALTY_MS,
} from '../modes/index.js';
import { CUE_BALL_ID } from '../constants.js';
import type { GameState } from '../types.js';
import type { ShotOutcome } from '../modes/types.js';

/**
 * A timing mode is only as trustworthy as its clock, so every test here pins `now` explicitly
 * rather than letting real time leak in — otherwise a slow CI machine would change the result.
 */

const outcome = (over: Partial<ShotOutcome> = {}): ShotOutcome => ({
  potted: [],
  cueBallPocketed: false,
  eightBallPocketed: false,
  firstBallContacted: 1,
  anyCushionAfterContact: true,
  cushionsBeforeContact: 0,
  objectBallsToRail: 4,
  pottedIn: {},
  ...over,
});

function newRun(startedAt = 1_000_000): GameState {
  const state = createInitialGameState('speed', ['Solo']);
  state.speedRun!.startedAt = startedAt;
  return state;
}

/**
 * Sinks every object ball — the state the simulation would hand `resolveShot` on the run's
 * final pot. The outcome object describes the shot, but "cleared" is read from the balls, so
 * both have to say the same thing.
 */
function clearTable(state: GameState): void {
  for (const ball of state.balls) {
    if (ball.id !== CUE_BALL_ID) ball.pocketed = true;
  }
}

describe('the run', () => {
  it('starts a clock when the rack is set', () => {
    const state = createInitialGameState('speed', ['Solo']);
    expect(state.speedRun).not.toBeNull();
    expect(state.speedRun!.finalMs).toBeNull();
    expect(state.speedRun!.penaltyMs).toBe(0);
  });

  it('leaves the shooter at the table however badly they play', () => {
    // The whole distinction from the ghost: missing costs time, not the rack.
    const state = newRun();
    resolveShot(state, outcome({ potted: [] }), false, null, false, null, 1_005_000);
    expect(state.phase).toBe('aiming');
    expect(state.winner).toBeNull();
    expect(state.speedRun!.penaltyMs).toBe(0);
  });

  it('charges ten seconds for a scratch and hands ball in hand back', () => {
    const state = newRun();
    resolveShot(
      state,
      outcome({ cueBallPocketed: true, potted: [CUE_BALL_ID] }),
      false,
      null,
      false,
      null,
      1_005_000
    );
    expect(state.speedRun!.penaltyMs).toBe(SPEED_FOUL_PENALTY_MS);
    expect(state.speedRun!.fouls).toBe(1);
    expect(state.phase).toBe('ball_in_hand');
  });

  it('charges for missing everything', () => {
    const state = newRun();
    resolveShot(state, outcome({ firstBallContacted: null }), false, null, false, null, 1_005_000);
    expect(state.speedRun!.fouls).toBe(1);
  });

  it('accumulates penalties across a scrappy run', () => {
    const state = newRun();
    for (let i = 0; i < 3; i++) {
      resolveShot(state, outcome({ firstBallContacted: null }), false, null, false, null, 1_005_000);
    }
    expect(state.speedRun!.penaltyMs).toBe(3 * SPEED_FOUL_PENALTY_MS);
  });
});

describe('finishing', () => {
  it('stops the clock at the last ball and keeps the time', () => {
    const state = newRun(1_000_000);
    clearTable(state);
    resolveShot(state, outcome({ potted: [9] }), false, null, false, null, 1_060_000);
    expect(state.phase).toBe('game_over');
    expect(state.winner).toBe('p1');
    expect(state.speedRun!.finalMs).toBe(60_000);
  });

  it('adds penalties to the finishing time', () => {
    const state = newRun(1_000_000);
    resolveShot(state, outcome({ firstBallContacted: null }), false, null, false, null, 1_010_000);
    clearTable(state);
    resolveShot(state, outcome({ potted: [9] }), false, null, false, null, 1_060_000);
    // 60s on the clock, plus the ten-second foul.
    expect(state.speedRun!.finalMs).toBe(70_000);
  });

  it('is the penalty that decides the stars on a close run', () => {
    const clean = newRun(1_000_000);
    clearTable(clean);
    resolveShot(clean, outcome({ potted: [9] }), false, null, false, null, 1_085_000);
    expect(clean.speedRun!.stars).toBe(3);

    const fouled = newRun(1_000_000);
    resolveShot(fouled, outcome({ firstBallContacted: null }), false, null, false, null, 1_010_000);
    clearTable(fouled);
    resolveShot(fouled, outcome({ potted: [9] }), false, null, false, null, 1_085_000);
    expect(fouled.speedRun!.stars).toBe(2);
  });
});

describe('scoring helpers', () => {
  it('grades against the par times', () => {
    expect(speedStars(60_000)).toBe(3);
    expect(speedStars(90_000)).toBe(3); // exactly on par still counts
    expect(speedStars(120_000)).toBe(2);
    expect(speedStars(200_000)).toBe(1);
    expect(speedStars(10 * 60_000)).toBe(1); // finishing at all is worth a star
  });

  it('never reports a negative total from a clock that jumped', () => {
    expect(speedTotalMs({ startedAt: 2_000, penaltyMs: 0 }, 1_000)).toBe(0);
  });

  it('formats to a tenth, which is the resolution people race at', () => {
    expect(formatSpeedTime(0)).toBe('0:00.0');
    expect(formatSpeedTime(9_450)).toBe('0:09.4');
    expect(formatSpeedTime(63_200)).toBe('1:03.2');
    expect(formatSpeedTime(-500)).toBe('0:00.0');
  });
});
