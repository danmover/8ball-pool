import { describe, expect, it } from 'vitest';
import {
  planBotTurn,
  createInitialGameState,
  applyCueStrike,
  runShot,
  summarizeShot,
  cloneBalls,
  BOTS,
  TIER_ORDER,
  pickBot,
  HEAD_STRING_X,
  BALL_DIAMETER,
  CUE_BALL_ID,
  type GameState,
} from '../index.js';

const noYield = () => Promise.resolve();

/** A table with a handful of makeable balls and nothing in the way. */
function openTable(): GameState {
  const s = createInitialGameState('eightball', ['Bot', 'Human'], { rand: () => 0.2 });
  s.phase = 'aiming';
  const layout: Record<number, { x: number; y: number }> = {
    0: { x: 700, y: 520 },
    1: { x: 1200, y: 300 },
    2: { x: 1500, y: 700 },
    3: { x: 400, y: 250 },
    9: { x: 1000, y: 800 },
    8: { x: 1700, y: 500 },
  };
  for (const b of s.balls) {
    const at = layout[b.id];
    if (at) b.pos = at;
    else b.pocketed = true;
  }
  s.players.p1.group = 'solid';
  s.players.p2.group = 'stripe';
  return s;
}

async function potRate(botId: string, trials: number): Promise<number> {
  let pots = 0;
  for (let seed = 1; seed <= trials; seed++) {
    const state = openTable();
    const plan = await planBotTurn({ state, seat: 'p1', botId, seed, budgetMs: 60 }, noYield);
    if (plan.kind !== 'shot') continue;
    const balls = cloneBalls(state.balls);
    const cue = balls.find((b) => b.id === CUE_BALL_ID)!;
    applyCueStrike(cue, plan.shot.angle, plan.shot.power, plan.shot.spin, () => 1, plan.shot.elevation);
    const outcome = summarizeShot(runShot(balls).events);
    if (outcome.potted.some((id) => [1, 2, 3].includes(id)) && !outcome.cueBallPocketed) pots++;
  }
  return pots / trials;
}

describe('bot roster', () => {
  it('has twelve distinct personalities across four tiers', () => {
    expect(BOTS).toHaveLength(12);
    expect(new Set(BOTS.map((b) => b.id)).size).toBe(12);
    for (const tier of TIER_ORDER) expect(BOTS.filter((b) => b.tier === tier)).toHaveLength(3);
  });

  it('never seats the same bot twice while others are free', () => {
    const taken: string[] = [];
    for (let i = 0; i < 12; i++) taken.push(pickBot('master', taken, () => 0.3).id);
    expect(new Set(taken).size).toBe(12);
  });
});

describe('bot brain', () => {
  it('pots a straightforward ball far more often as a Master than as a Rookie', async () => {
    const master = await potRate('bot.viper', 10);
    const rookie = await potRate('bot.charlie', 10);
    expect(master).toBeGreaterThanOrEqual(0.7);
    expect(master).toBeGreaterThan(rookie);
  }, 60_000);

  it('nominates a pocket when shooting at the 8', async () => {
    const state = openTable();
    for (const b of state.balls) if ([1, 2, 3].includes(b.id)) b.pocketed = true;
    const plan = await planBotTurn({ state, seat: 'p1', botId: 'bot.professor', seed: 3, budgetMs: 60 }, noYield);
    expect(plan.kind).toBe('shot');
    if (plan.kind === 'shot') expect(plan.shot.call?.ballId).toBe(8);
  });

  it('places the cue ball legally, and behind the line when it must', async () => {
    for (const kitchen of [false, true]) {
      const state = openTable();
      state.phase = 'ball_in_hand';
      state.ballInHandBehindLine = kitchen;
      const plan = await planBotTurn({ state, seat: 'p1', botId: 'bot.shark', seed: 9, budgetMs: 60 }, noYield);
      expect(plan.kind).toBe('place');
      if (plan.kind !== 'place') continue;
      if (kitchen) expect(plan.pos.x).toBeLessThanOrEqual(HEAD_STRING_X);
      for (const b of state.balls) {
        if (b.pocketed || b.id === CUE_BALL_ID) continue;
        const d = Math.hypot(b.pos.x - plan.pos.x, b.pos.y - plan.pos.y);
        expect(d).toBeGreaterThanOrEqual(BALL_DIAMETER);
      }
    }
  });

  it('breaks hard at the rack', async () => {
    const state = createInitialGameState('eightball', ['Bot', 'Human']);
    const plan = await planBotTurn({ state, seat: 'p1', botId: 'bot.ray', seed: 1 }, noYield);
    expect(plan.kind).toBe('shot');
    if (plan.kind === 'shot') {
      expect(plan.intent).toBe('break');
      expect(plan.shot.power).toBeGreaterThan(0.85);
    }
  });
});
