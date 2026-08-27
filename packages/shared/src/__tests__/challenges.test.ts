import { describe, expect, it } from 'vitest';
import {
  BALL_RADIUS,
  CHALLENGES,
  TABLE_LENGTH,
  TABLE_WIDTH,
  challengeBalls,
  challengeById,
  challengeSets,
  createInitialGameState,
  legalTargetBallIds,
  resolveShot,
  starsFor,
} from '../index.js';
import type { Challenge } from '../challenges.js';
import type { GameState } from '../types.js';
import type { ShotOutcome } from '../rules.js';

function outcome(over: Partial<ShotOutcome> = {}): ShotOutcome {
  return {
    potted: [],
    cueBallPocketed: false,
    eightBallPocketed: false,
    firstBallContacted: null,
    anyCushionAfterContact: false,
    objectBallsToRail: 0,
    pottedIn: {},
    cushionsBeforeContact: 0,
    ...over,
  };
}

/** A challenge room, set up the way `Room.startChallenge` does it. */
function play(challenge: Challenge): GameState {
  const state = createInitialGameState('challenge', ['Solo']);
  state.balls = challengeBalls(challenge);
  state.phase = 'aiming';
  state.challenge = {
    challengeId: challenge.id,
    shotsUsed: 0,
    pottedOrder: [],
    stars: 0,
    failed: false,
  };
  return state;
}

/** Marks a ball down, as the physics would. */
function sink(state: GameState, ...ids: number[]): void {
  for (const id of ids) {
    const ball = state.balls.find((b) => b.id === id);
    if (ball) ball.pocketed = true;
  }
}

describe('challenge catalogue', () => {
  it('has unique ids and sane budgets', () => {
    const ids = CHALLENGES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of CHALLENGES) {
      expect(c.stars.three).toBeLessThanOrEqual(c.stars.two);
      expect(c.stars.two).toBeLessThanOrEqual(c.shotLimit);
      expect(c.reward.xp).toBeGreaterThan(0);
    }
  });

  it('lays every ball out on the table without overlaps', () => {
    for (const c of CHALLENGES) {
      const balls = challengeBalls(c);
      expect(balls.some((b) => b.id === 0)).toBe(true);
      for (const b of balls) {
        expect(b.pos.x).toBeGreaterThan(BALL_RADIUS);
        expect(b.pos.x).toBeLessThan(TABLE_LENGTH - BALL_RADIUS);
        expect(b.pos.y).toBeGreaterThan(BALL_RADIUS);
        expect(b.pos.y).toBeLessThan(TABLE_WIDTH - BALL_RADIUS);
      }
      for (let i = 0; i < balls.length; i++) {
        for (let j = i + 1; j < balls.length; j++) {
          const d = Math.hypot(balls[i].pos.x - balls[j].pos.x, balls[i].pos.y - balls[j].pos.y);
          expect(d).toBeGreaterThanOrEqual(BALL_RADIUS * 2);
        }
      }
    }
  });

  it('groups challenges into sets in catalogue order', () => {
    const sets = challengeSets();
    expect(sets.length).toBeGreaterThan(1);
    expect(sets.flatMap((s) => s.challenges)).toHaveLength(CHALLENGES.length);
  });

  it('awards more stars for fewer shots', () => {
    const c = challengeById('ch.runout')!;
    expect(starsFor(c, c.stars.three)).toBe(3);
    expect(starsFor(c, c.stars.two)).toBe(2);
    expect(starsFor(c, c.shotLimit)).toBe(1);
  });
});

describe('challenge judging', () => {
  it('completes a clean pot only when the target was struck first', () => {
    const c = challengeById('ch.straight')!;

    const wrongBall = play(c);
    sink(wrongBall, 1);
    resolveShot(wrongBall, outcome({ potted: [1], firstBallContacted: 3 }), false);
    expect(wrongBall.challenge!.stars).toBe(0);

    const clean = play(c);
    sink(clean, 1);
    resolveShot(clean, outcome({ potted: [1], firstBallContacted: 1 }), false);
    expect(clean.phase).toBe('game_over');
    expect(clean.challenge!.stars).toBe(3);
  });

  it('requires the cushion count for a bank shot', () => {
    const c = challengeById('ch.bank2')!;

    const tooFew = play(c);
    sink(tooFew, 13);
    resolveShot(tooFew, outcome({ potted: [13], firstBallContacted: 13, cushionsBeforeContact: 1 }), false);
    expect(tooFew.challenge!.stars).toBe(0);
    expect(tooFew.phase).not.toBe('game_over');

    const enough = play(c);
    sink(enough, 13);
    resolveShot(enough, outcome({ potted: [13], firstBallContacted: 13, cushionsBeforeContact: 2 }), false);
    expect(enough.phase).toBe('game_over');
    expect(enough.challenge!.stars).toBe(3);
  });

  it('tracks a pot order across shots and fails on the wrong ball', () => {
    const c = challengeById('ch.follow')!; // order [4, 5]

    const right = play(c);
    sink(right, 4);
    resolveShot(right, outcome({ potted: [4], firstBallContacted: 4 }), false);
    expect(right.phase).toBe('aiming');
    sink(right, 5);
    resolveShot(right, outcome({ potted: [5], firstBallContacted: 5 }), false);
    expect(right.phase).toBe('game_over');
    expect(right.challenge!.stars).toBe(3);

    const wrong = play(c);
    sink(wrong, 5);
    resolveShot(wrong, outcome({ potted: [5], firstBallContacted: 5 }), false);
    expect(wrong.challenge!.failed).toBe(true);
    expect(wrong.lastFoulReason).toBe('Wrong order');
  });

  it('fails once the shot budget runs out', () => {
    const c = challengeById('ch.straight')!;
    const state = play(c);
    for (let i = 0; i < c.shotLimit; i++) {
      resolveShot(state, outcome({ firstBallContacted: null }), false);
    }
    expect(state.challenge!.failed).toBe(true);
    expect(state.phase).toBe('game_over');
    expect(state.lastFoulReason).toBe('Out of shots');
  });

  it('hands the cue ball back on a scratch rather than ending the attempt', () => {
    const c = challengeById('ch.runout')!;
    const state = play(c);
    resolveShot(state, outcome({ cueBallPocketed: true, potted: [0] }), false);
    expect(state.phase).toBe('ball_in_hand');
    expect(state.challenge!.failed).toBe(false);
  });

  it('highlights only the ball the objective is asking for', () => {
    const state = play(challengeById('ch.follow')!); // order [4, 5]
    expect(legalTargetBallIds(state)).toEqual([4]);
    state.challenge!.pottedOrder.push(4);
    sink(state, 4);
    expect(legalTargetBallIds(state)).toEqual([5]);
  });

  it('completes a clear-table challenge only when nothing is left', () => {
    const c = challengeById('ch.runout')!;
    const state = play(c);
    const ids = c.balls.map((b) => b.id);
    sink(state, ...ids.slice(0, -1));
    resolveShot(state, outcome({ potted: [ids[0]], firstBallContacted: ids[0] }), false);
    expect(state.phase).toBe('aiming');

    sink(state, ids[ids.length - 1]);
    resolveShot(state, outcome({ potted: [ids[ids.length - 1]], firstBallContacted: ids[0] }), false);
    expect(state.phase).toBe('game_over');
    expect(state.challenge!.stars).toBeGreaterThan(0);
  });
});
