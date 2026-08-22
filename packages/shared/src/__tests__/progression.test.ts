import { describe, expect, it } from 'vitest';
import {
  CATALOG,
  DEFAULT_LOADOUT,
  STARTER_IDS,
  chalkForDuplicate,
  cosmeticById,
  levelForXp,
  levelProgress,
  resolveLoadout,
  rollWheel,
  spinsForLevelUp,
  wheelPool,
  xpForLevel,
  xpForPot,
  xpForShot,
  xpToNextLevel,
} from '../index.js';

/** Deterministic stand-in for Math.random so wheel behaviour is reproducible. */
function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe('catalog', () => {
  it('has unique ids and every default loadout entry exists in its slot', () => {
    const ids = CATALOG.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const [slot, id] of Object.entries(DEFAULT_LOADOUT)) {
      expect(cosmeticById(id)?.slot).toBe(slot);
    }
  });

  it('never offers a starter item on the wheel', () => {
    for (const item of wheelPool()) {
      expect(STARTER_IDS).not.toContain(item.id);
    }
  });
});

describe('resolveLoadout', () => {
  it('fills missing slots with the starter items', () => {
    expect(resolveLoadout({})).toEqual(DEFAULT_LOADOUT);
    expect(resolveLoadout(undefined)).toEqual(DEFAULT_LOADOUT);
  });

  it('ignores unknown ids and ids equipped into the wrong slot', () => {
    const resolved = resolveLoadout({ cue: 'cue.nope', trail: 'cue.neon' });
    expect(resolved.cue).toBe(DEFAULT_LOADOUT.cue);
    expect(resolved.trail).toBe(DEFAULT_LOADOUT.trail);
  });

  it('keeps valid ids', () => {
    expect(resolveLoadout({ cue: 'cue.neon' }).cue).toBe('cue.neon');
  });
});

describe('xp and levels', () => {
  it('pays more for each extra ball on the same shot', () => {
    expect(xpForPot(1)).toBeGreaterThan(xpForPot(0));
    expect(xpForShot(3)).toBe(xpForPot(0) + xpForPot(1) + xpForPot(2));
  });

  it('levels up exactly at the threshold', () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(xpToNextLevel(1) - 1)).toBe(1);
    expect(levelForXp(xpToNextLevel(1))).toBe(2);
  });

  it('agrees between xpForLevel and levelForXp across a long run', () => {
    for (let level = 1; level <= 25; level++) {
      expect(levelForXp(xpForLevel(level))).toBe(level);
      expect(levelForXp(xpForLevel(level) - 1)).toBe(Math.max(1, level - 1));
    }
  });

  it('reports progress inside the current level', () => {
    const p = levelProgress(xpForLevel(4) + 30);
    expect(p.level).toBe(4);
    expect(p.into).toBe(30);
    expect(p.span).toBe(xpToNextLevel(4));
    expect(p.ratio).toBeCloseTo(30 / xpToNextLevel(4));
  });

  it('grants one spin per level gained', () => {
    expect(spinsForLevelUp(3, 6)).toBe(3);
    expect(spinsForLevelUp(3, 3)).toBe(0);
    expect(spinsForLevelUp(5, 2)).toBe(0);
  });
});

describe('rollWheel', () => {
  it('only lands on locked items while anything is still locked', () => {
    const rng = seededRng(7);
    const owned = [...STARTER_IDS];
    for (let i = 0; i < wheelPool().length; i++) {
      const result = rollWheel(owned, rng);
      expect(result.duplicate).toBe(false);
      expect(owned).not.toContain(result.item.id);
      owned.push(result.item.id);
    }
  });

  it('unlocks the entire pool in exactly one spin per item', () => {
    const rng = seededRng(99);
    const owned = [...STARTER_IDS];
    const total = wheelPool().length;
    for (let i = 0; i < total; i++) owned.push(rollWheel(owned, rng).item.id);
    expect(new Set(owned).size).toBe(STARTER_IDS.length + total);
  });

  it('pays chalk once the collection is complete', () => {
    const rng = seededRng(3);
    const owned = [...STARTER_IDS, ...wheelPool().map((i) => i.id)];
    const result = rollWheel(owned, rng);
    expect(result.duplicate).toBe(true);
    expect(result.chalkAwarded).toBe(chalkForDuplicate(result.item.rarity));
    expect(result.chalkAwarded).toBeGreaterThan(0);
  });

  it('favours common items over legendary ones', () => {
    const rng = seededRng(1234);
    const owned = [...STARTER_IDS];
    const counts: Record<string, number> = { common: 0, rare: 0, epic: 0, legendary: 0 };
    // Roll without recording unlocks so the pool stays constant across samples.
    for (let i = 0; i < 4000; i++) counts[rollWheel(owned, rng).item.rarity]++;
    expect(counts.common).toBeGreaterThan(counts.rare);
    expect(counts.rare).toBeGreaterThan(counts.legendary);
  });
});
