import { describe, expect, it } from 'vitest';
import {
  NEAR_MISS_INDEX,
  REEL_LENGTH,
  REEL_WINNER_INDEX,
  buildReel,
  reelEase,
  reelTiming,
} from '../reel.js';
import { wheelPool } from '../progression.js';
import { COSMETIC_SETS } from '../collection.js';
import { cosmeticById, rarityRank, type CosmeticItem } from '../cosmetics.js';

/**
 * The one property that must never break: the reel decides what you *see*, never what you
 * *get*. Everything else here is about the tease being honest — a near-miss that changes the
 * odds is a con, a near-miss that changes only the last second of the animation is a story.
 */

/** A little deterministic generator, so a strip can be pinned exactly. */
function seeded(seed = 7): () => number {
  let n = seed;
  return () => ((n = (n * 1103515245 + 12345) % 2147483648) / 2147483648);
}

const item = (id: string): CosmeticItem => cosmeticById(id)!;

describe('the strip', () => {
  it('is the length it says it is', () => {
    expect(buildReel(item('cue.neon'), seeded())).toHaveLength(REEL_LENGTH);
  });

  it('puts the prize exactly where the marker will be', () => {
    const reel = buildReel(item('cue.neon'), seeded());
    expect(reel[REEL_WINNER_INDEX].item.id).toBe('cue.neon');
    expect(reel[REEL_WINNER_INDEX].winner).toBe(true);
  });

  it('marks exactly one winner', () => {
    const reel = buildReel(item('balls.prism'), seeded());
    expect(reel.filter((c) => c.winner)).toHaveLength(1);
  });

  it('leaves cells after the prize, so the strip never visibly runs out', () => {
    expect(REEL_LENGTH - REEL_WINNER_INDEX).toBeGreaterThanOrEqual(3);
  });

  it('never shows the prize anywhere else', () => {
    // Seeing the thing you are about to win slide past three times gives the ending away.
    for (let seed = 1; seed <= 40; seed++) {
      const reel = buildReel(item('cue.midas'), seeded(seed));
      const appearances = reel.filter((c) => c.item.id === 'cue.midas');
      expect(appearances, `seed ${seed}`).toHaveLength(1);
    }
  });

  it('is the same strip twice from the same source of randomness', () => {
    const a = buildReel(item('trail.void'), seeded(3)).map((c) => c.item.id);
    const b = buildReel(item('trail.void'), seeded(3)).map((c) => c.item.id);
    expect(a).toEqual(b);
  });

  it('copes with a pool of one', () => {
    const only = [item('cue.neon')];
    const reel = buildReel(item('cue.neon'), seeded(), only);
    expect(reel).toHaveLength(REEL_LENGTH);
    expect(reel[REEL_WINNER_INDEX].winner).toBe(true);
  });
});

describe('the near miss', () => {
  it('teases something better, right before the prize', () => {
    // Won a common: the cell before it should be rarer, and flagged as the tease.
    for (let seed = 1; seed <= 25; seed++) {
      const prize = item('cue.chalkline'); // common
      const reel = buildReel(prize, seeded(seed));
      const tease = reel[NEAR_MISS_INDEX];
      expect(rarityRank(tease.item.rarity), `seed ${seed}`).toBeGreaterThan(
        rarityRank(prize.rarity)
      );
      expect(tease.nearMiss).toBe(true);
    }
  });

  it('sits immediately before the prize, not somewhere in the middle', () => {
    expect(NEAR_MISS_INDEX).toBe(REEL_WINNER_INDEX - 1);
  });

  it('does not invent a let-down when you won the best thing there is', () => {
    // Nothing outranks a mystic, so there is nothing honest to tease with.
    const prize = wheelPool().find((i) => i.rarity === 'mystic')!;
    const reel = buildReel(prize, seeded(11));
    expect(reel[NEAR_MISS_INDEX].nearMiss).toBe(false);
  });

  it('changes nothing about what was won', () => {
    // The whole defence of the tease: it is animation, not odds.
    const prize = item('balls.candy');
    for (let seed = 1; seed <= 30; seed++) {
      const reel = buildReel(prize, seeded(seed));
      expect(reel[REEL_WINNER_INDEX].item.id).toBe('balls.candy');
    }
  });
});

describe('timing', () => {
  it('gives a rarer prize a longer run and a longer settle', () => {
    const common = reelTiming('common');
    const mystic = reelTiming('mystic');
    expect(mystic.durationMs).toBeGreaterThan(common.durationMs);
    expect(mystic.settleMs).toBeGreaterThan(common.settleMs);
  });

  it('rises monotonically through the rarities', () => {
    const durations = (['common', 'rare', 'epic', 'legendary', 'mystic'] as const).map(
      (r) => reelTiming(r).durationMs
    );
    for (let i = 1; i < durations.length; i++) {
      expect(durations[i]).toBeGreaterThan(durations[i - 1]);
    }
  });
});

describe('the ease', () => {
  it('starts at nothing and finishes exactly at the prize', () => {
    expect(reelEase(0, 0.2)).toBeCloseTo(0, 6);
    expect(reelEase(1, 0.2)).toBeCloseTo(1, 6);
  });

  it('never goes backwards', () => {
    // A reel that jitters backwards looks broken, not tense.
    let last = -1;
    for (let t = 0; t <= 1.0001; t += 0.005) {
      const v = reelEase(t, 0.25);
      expect(v).toBeGreaterThanOrEqual(last - 1e-9);
      last = v;
    }
  });

  it('spends the last stretch of time on the last sliver of distance', () => {
    // This is the whole point: fast, then slow, then agonising. A plain ease-out would be
    // smooth, which is exactly wrong.
    const settle = 0.25;
    const atCrossover = reelEase(1 - settle, settle);
    expect(atCrossover).toBeGreaterThan(0.94);
    expect(atCrossover).toBeLessThan(0.97);
  });

  it('clamps input outside the run', () => {
    expect(reelEase(-3, 0.2)).toBe(0);
    expect(reelEase(9, 0.2)).toBeCloseTo(1, 6);
  });

  it('tolerates a silly settle fraction rather than dividing by zero', () => {
    expect(Number.isFinite(reelEase(0.5, 0))).toBe(true);
    expect(Number.isFinite(reelEase(0.5, 5))).toBe(true);
  });
});

describe('what the reel may hand out', () => {
  it('never offers a set reward', () => {
    // Those are the one thing luck cannot give you, which is the entire reason a set is worth
    // finishing. Handing one out on a spin would quietly delete the goal.
    // Asserted against the set data rather than a hard-coded list, so adding a set cannot
    // quietly reopen the hole this closes.
    const ids = new Set(wheelPool().map((i) => i.id));
    for (const set of COSMETIC_SETS) {
      expect(ids.has(set.reward), `${set.id} reward ${set.reward} is in the pool`).toBe(false);
    }
    expect(COSMETIC_SETS.length).toBeGreaterThan(0);
  });
});
