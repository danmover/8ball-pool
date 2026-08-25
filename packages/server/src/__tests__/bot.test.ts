import { describe, expect, it } from 'vitest';
import {
  BALL_RADIUS,
  CUE_BALL_ID,
  POCKETS,
  TABLE_LENGTH,
  TABLE_WIDTH,
  Vec2,
  applyCueStrike,
  createBall,
  createInitialGameState,
  stepSimulation,
  summarizeShot,
} from '@8ball/shared';
import type { Ball, GameState } from '@8ball/shared';
import { BotPlayer } from '../bot.js';

/**
 * The top tiers pick their shot by simulating candidates with the real engine, which is the
 * only way a bot can find a combination or a two-ball drop — ghost-ball geometry can answer
 * "can I send this ball to that pocket" and nothing else.
 *
 * These tests build layouts where the good shot is unambiguous and check the bot finds it.
 */

/** A frame with exactly the balls given, everything else already potted. */
function layout(live: { id: number; x: number; y: number }[], cue: { x: number; y: number }): GameState {
  const state = createInitialGameState('classic', ['A', 'B']);
  state.phase = 'aiming';
  // Solids are open to whoever; assign so every live numbered ball is a legal target.
  state.players.p1.group = 'solid';
  state.players.p2.group = 'stripe';

  const kept = new Map(live.map((b) => [b.id, b]));
  state.balls = state.balls.map((b) => {
    if (b.id === CUE_BALL_ID) return { ...createBall(CUE_BALL_ID, 'cue', cue.x, cue.y) };
    const want = kept.get(b.id);
    if (!want) return { ...b, pocketed: true };
    return { ...createBall(b.id, b.kind, want.x, want.y) };
  });
  return state;
}

/** Plays a shot on a copy of the state and reports which balls dropped. */
function play(state: GameState, shot: { angle: number; power: number; spin: { x: number; y: number } }) {
  const balls: Ball[] = state.balls.map((b) => ({
    ...b,
    pos: { ...b.pos },
    vel: { ...b.vel },
    angVel: { ...b.angVel },
  }));
  const cue = balls.find((b) => b.id === CUE_BALL_ID)!;
  applyCueStrike(cue, shot.angle, shot.power, shot.spin);

  const events = [];
  for (let i = 0; i < 600; i++) {
    const step = stepSimulation(balls, 1 / 60);
    events.push(...step.events);
    if (step.settled) break;
  }
  return summarizeShot(events);
}

describe('BotPlayer search', () => {
  it('finds a shot that drops two balls at once', async () => {
    // Two solids sitting side by side across a corner mouth, cue ball straight back down the
    // pocket's centre line. One firm shot into the pair sends both in.
    //
    // A brute-force sweep of every angle at four powers confirms two balls really is available
    // here (and, for the record, on a stacked pair and on two separate corners too) — there is
    // no point asserting the bot can find a shot the physics doesn't offer. What's being
    // tested is that simulating candidates *notices* it, which ghost-ball geometry cannot: it
    // can only ever answer "can I send this one ball to that one pocket".
    const p = POCKETS[0];
    const into = Vec2.scale(p.out, -1); // from the bag back into the table
    const along = (t: number): { x: number; y: number } => Vec2.add(p.capture, Vec2.scale(into, t));
    const axis = Vec2.normalize(Vec2.sub(p.b, p.a));

    const base = along(BALL_RADIUS * 1.6);
    const a = Vec2.add(base, Vec2.scale(axis, BALL_RADIUS * 1.05));
    const b = Vec2.sub(base, Vec2.scale(axis, BALL_RADIUS * 1.05));
    const cue = along(BALL_RADIUS * 12);

    const state = layout(
      [
        { id: 1, x: a.x, y: a.y },
        { id: 2, x: b.x, y: b.y },
      ],
      cue
    );

    // Several attempts: delivery still carries the tier's aiming error, so a single run proves
    // nothing either way. What's being tested is that the shot is found and chosen.
    const bot = new BotPlayer('legend');
    let bestPots = 0;
    for (let i = 0; i < 6; i++) {
      const shot = await bot.chooseShot(state, 'p1');
      const result = play(state, shot);
      bestPots = Math.max(bestPots, result.potted.filter((id) => id !== CUE_BALL_ID).length);
      if (bestPots >= 2) break;
    }
    expect(bestPots).toBeGreaterThanOrEqual(2);
  });

  it('pots a hanging ball rather than fouling', async () => {
    const pocket = POCKETS[0];
    const hanging = Vec2.add(pocket.capture, Vec2.scale(pocket.out, -BALL_RADIUS * 3));
    const state = layout(
      [{ id: 1, x: hanging.x, y: hanging.y }],
      { x: hanging.x + 500, y: hanging.y + 500 }
    );

    const bot = new BotPlayer('legend');
    const shot = await bot.chooseShot(state, 'p1');
    const result = play(state, shot);
    expect(result.firstBallContacted).toBe(1);
    expect(result.potted).toContain(1);
  });

  it('keeps the search inside its time budget', async () => {
    // A full rack is the worst case: the most candidates and the longest shots to simulate.
    const state = createInitialGameState('classic', ['A', 'B']);
    state.phase = 'aiming';

    const bot = new BotPlayer('legend');
    const started = Date.now();
    await bot.chooseShot(state, 'p1');
    const elapsed = Date.now() - started;

    // The budget is 1100ms; allow generous slack for one candidate overrunning the deadline
    // and for a cold JIT on the first call.
    expect(elapsed).toBeLessThan(4000);
  });

  it('never returns a shot outside the legal power range', async () => {
    const state = createInitialGameState('classic', ['A', 'B']);
    state.phase = 'aiming';
    for (const difficulty of ['rookie', 'club', 'shark', 'legend'] as const) {
      const shot = await new BotPlayer(difficulty).chooseShot(state, 'p1');
      expect(shot.power).toBeGreaterThan(0);
      expect(shot.power).toBeLessThanOrEqual(1);
      expect(Number.isFinite(shot.angle)).toBe(true);
      expect(Math.hypot(shot.spin.x, shot.spin.y)).toBeLessThanOrEqual(1.001);
    }
  });
});
