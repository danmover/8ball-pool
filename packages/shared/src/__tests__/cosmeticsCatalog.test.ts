import { describe, expect, it } from 'vitest';
import {
  CATALOG,
  DEFAULT_LOADOUT,
  SLOT_ORDER,
  STARTER_IDS,
  cosmeticById,
  itemsForSlot,
  resolveLoadout,
  rollWheel,
  wheelPool,
} from '../index.js';
import type { CosmeticSlot } from '../cosmetics.js';

function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe('expanded catalog', () => {
  it('keeps every id unique', () => {
    const ids = CATALOG.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every slot a starter item and several unlockables', () => {
    for (const slot of SLOT_ORDER) {
      const items = itemsForSlot(slot);
      expect(items.length).toBeGreaterThanOrEqual(4);
      const starter = items.filter((i) => STARTER_IDS.includes(i.id));
      expect(starter).toHaveLength(1);
      expect(cosmeticById(DEFAULT_LOADOUT[slot as CosmeticSlot]!)?.slot).toBe(slot);
    }
  });

  it('spreads rarities so the wheel has something at every tier', () => {
    for (const rarity of ['common', 'rare', 'epic', 'legendary'] as const) {
      expect(wheelPool().some((i) => i.rarity === rarity)).toBe(true);
    }
  });

  it('still unlocks the whole pool in exactly one spin per item', () => {
    const rng = seededRng(4242);
    const owned = [...STARTER_IDS];
    const total = wheelPool().length;
    for (let i = 0; i < total; i++) {
      const result = rollWheel(owned, rng);
      expect(result.duplicate).toBe(false);
      owned.push(result.item.id);
    }
    expect(rollWheel(owned, rng).duplicate).toBe(true);
  });

  it('resolves a loadout that predates the hit-effect slot', () => {
    const old = { cue: 'cue.neon', ballSet: 'balls.classic' };
    const resolved = resolveLoadout(old);
    expect(resolved.cue).toBe('cue.neon');
    expect(resolved.hitEffect).toBe(DEFAULT_LOADOUT.hitEffect);
  });
});
