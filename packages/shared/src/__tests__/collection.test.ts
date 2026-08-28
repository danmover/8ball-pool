import { describe, expect, it } from 'vitest';
import {
  COSMETIC_SETS,
  claimableSets,
  collectionProgress,
  filterItems,
  setProgress,
  setRewardIds,
  setsContaining,
  slotProgress,
} from '../collection.js';
import { CATALOG, SLOT_ORDER, cosmeticById, itemsForSlot, type Rarity } from '../cosmetics.js';

/**
 * The sets are hand-written data, so the tests that matter most are the ones that catch a typo
 * — a set referring to an item that does not exist would show as a permanently unfinishable
 * goal, and nobody would ever report it as a bug.
 */

const price = (rarity: Rarity): number =>
  ({ common: 100, rare: 250, epic: 600, legendary: 1500, mystic: 5000 })[rarity];

describe('the set data itself', () => {
  it('only names items that exist', () => {
    for (const set of COSMETIC_SETS) {
      for (const id of set.items) {
        expect(cosmeticById(id), `${set.id} wants ${id}`).toBeDefined();
      }
      expect(cosmeticById(set.reward), `${set.id} rewards ${set.reward}`).toBeDefined();
    }
  });

  it('never asks you to own the thing it gives you', () => {
    // A set completed by owning its own prize is circular and can never be finished.
    for (const set of COSMETIC_SETS) {
      expect(set.items, set.id).not.toContain(set.reward);
    }
  });

  it('gives each set its own reward', () => {
    const rewards = COSMETIC_SETS.map((s) => s.reward);
    expect(new Set(rewards).size).toBe(rewards.length);
  });

  it('has unique ids', () => {
    const ids = COSMETIC_SETS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('asks for more than one thing', () => {
    for (const set of COSMETIC_SETS) {
      expect(set.items.length, set.id).toBeGreaterThan(1);
    }
  });
});

describe('progress', () => {
  it('counts an empty collection as nothing owned', () => {
    const p = collectionProgress([]);
    expect(p.owned).toBe(0);
    expect(p.total).toBe(CATALOG.length);
    expect(p.ratio).toBe(0);
  });

  it('counts a full collection as everything', () => {
    const p = collectionProgress(CATALOG.map((i) => i.id));
    expect(p.owned).toBe(p.total);
    expect(p.ratio).toBe(1);
  });

  it('ignores ids that are not real items', () => {
    // A profile from an older build can name things that no longer exist; they must not
    // inflate the count past 100%.
    const p = collectionProgress(['not.a.thing', 'cue.neon']);
    expect(p.owned).toBe(1);
  });

  it('reports a shelf at a time', () => {
    const shelves = slotProgress(['cue.neon', 'cue.midas']);
    expect(shelves).toHaveLength(SLOT_ORDER.length);
    const cues = shelves.find((s) => s.slot === 'cue')!;
    expect(cues.owned).toBe(2);
    expect(cues.total).toBe(itemsForSlot('cue').length);
    expect(cues.ratio).toBeCloseTo(2 / cues.total, 6);
  });
});

describe('sets', () => {
  const neon = COSMETIC_SETS.find((s) => s.id === 'set.neon')!;

  it('knows what is still missing', () => {
    const p = setProgress([neon.items[0]]).find((x) => x.set.id === 'set.neon')!;
    expect(p.owned).toEqual([neon.items[0]]);
    expect(p.missing.map((i) => i.id).sort()).toEqual(neon.items.slice(1).sort());
    expect(p.complete).toBe(false);
  });

  it('completes when the last piece lands', () => {
    const p = setProgress(neon.items).find((x) => x.set.id === 'set.neon')!;
    expect(p.complete).toBe(true);
    expect(p.missing).toEqual([]);
  });

  it('puts the nearly-finished set first, so there is always a next one', () => {
    // One away from Neon Nights, nothing at all towards the rest.
    const ordered = setProgress(neon.items.slice(0, -1));
    expect(ordered[0].set.id).toBe('set.neon');
  });

  it('drops a claimed set to the bottom', () => {
    const ordered = setProgress(neon.items, ['set.neon']);
    expect(ordered[ordered.length - 1].set.id).toBe('set.neon');
  });

  it('offers a finished set for claiming exactly once', () => {
    expect(claimableSets(neon.items).map((s) => s.id)).toContain('set.neon');
    expect(claimableSets(neon.items, ['set.neon']).map((s) => s.id)).not.toContain('set.neon');
  });

  it('tells an item which sets it belongs to, including as a reward', () => {
    expect(setsContaining(neon.items[0]).map((s) => s.id)).toContain('set.neon');
    expect(setsContaining(neon.reward).map((s) => s.id)).toContain('set.neon');
  });

  it('keeps every reward out of the wheel pool', () => {
    const rewards = setRewardIds();
    for (const set of COSMETIC_SETS) expect(rewards.has(set.reward)).toBe(true);
  });
});

describe('filtering the grid', () => {
  const cues = itemsForSlot('cue');

  it('returns everything by default', () => {
    expect(filterItems(cues, [])).toHaveLength(cues.length);
  });

  it('splits owned from missing', () => {
    const owned = filterItems(cues, ['cue.neon'], { ownership: 'owned' });
    expect(owned.map((i) => i.id)).toEqual(['cue.neon']);
    expect(filterItems(cues, ['cue.neon'], { ownership: 'missing' })).toHaveLength(cues.length - 1);
  });

  it('matches on name and on blurb', () => {
    expect(filterItems(cues, [], { search: 'neon' }).map((i) => i.id)).toContain('cue.neon');
    const byBlurb = filterItems(cues, [], { search: 'gold seam' });
    expect(byBlurb.map((i) => i.id)).toContain('cue.obsidian');
  });

  it('ignores case and stray spaces in the search', () => {
    expect(filterItems(cues, [], { search: '  NEON ' }).map((i) => i.id)).toContain('cue.neon');
  });

  it('treats affordability as "could buy now", not "cheap"', () => {
    // Something already owned is not a purchase, however much chalk you are holding.
    const affordable = filterItems(cues, ['cue.neon'], { affordableWith: 100000 }, price);
    expect(affordable.map((i) => i.id)).not.toContain('cue.neon');
    expect(affordable.length).toBeGreaterThan(0);

    const broke = filterItems(cues, [], { affordableWith: 0 }, price);
    expect(broke).toHaveLength(0);
  });

  it('filters by rarity', () => {
    const epics = filterItems(cues, [], { rarity: 'epic' });
    expect(epics.every((i) => i.rarity === 'epic')).toBe(true);
    expect(epics.length).toBeGreaterThan(0);
  });

  it('sorts common to mystic by default', () => {
    const sorted = filterItems(cues, []);
    const ranks = sorted.map((i) => ['common', 'rare', 'epic', 'legendary', 'mystic'].indexOf(i.rarity));
    for (let i = 1; i < ranks.length; i++) expect(ranks[i]).toBeGreaterThanOrEqual(ranks[i - 1]);
  });

  it('sorts by name when asked', () => {
    const sorted = filterItems(cues, [], { sort: 'name' });
    const names = sorted.map((i) => i.name);
    expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names);
  });

  it('floats what you own to the top when asked', () => {
    const sorted = filterItems(cues, ['cue.midas'], { sort: 'owned' });
    expect(sorted[0].id).toBe('cue.midas');
  });

  it('combines filters rather than picking one', () => {
    const out = filterItems(cues, [], { ownership: 'missing', rarity: 'legendary', search: 'gold' });
    expect(out.every((i) => i.rarity === 'legendary')).toBe(true);
    expect(out.map((i) => i.id)).toContain('cue.midas');
  });

  it('returns nothing rather than everything when nothing matches', () => {
    expect(filterItems(cues, [], { search: 'zzzzzz' })).toHaveLength(0);
  });
});
