import {
  CATALOG,
  SLOT_LABELS,
  SLOT_ORDER,
  cosmeticById,
  itemsForSlot,
  rarityRank,
  type CosmeticItem,
  type CosmeticSlot,
  type Rarity,
} from './cosmetics.js';

/**
 * Making a hundred and thirty items into a collection rather than a wall.
 *
 * A big catalogue with no shape is worse than a small one: everything is equally far away, so
 * nothing feels close. Two things fix that, and both are here — per-slot progress, so there is
 * always a nearly-finished shelf to look at, and **sets**, which pick a handful of items across
 * different slots and turn them into a goal you can actually picture.
 *
 * Sets are cross-slot on purpose. "Collect every cue" is a shopping list; "assemble the whole
 * Neon kit" is an outfit, and an outfit is something people want.
 */

export interface CosmeticSet {
  id: string;
  name: string;
  blurb: string;
  /** Item ids that make up the set. */
  items: string[];
  /** Chalk paid out when the last piece lands. */
  chalk: number;
  /** An item granted on completion — always the one that finishes the theme off. */
  reward: string;
}

/**
 * The sets.
 *
 * Each reward is deliberately *not* in its own `items` list — a set you can complete by owning
 * its own prize would be circular. The reward is the piece you cannot get any other way.
 */
export const COSMETIC_SETS: CosmeticSet[] = [
  {
    id: 'set.neon',
    name: 'Neon Nights',
    blurb: 'Backlit, buzzing, and slightly too loud for a Tuesday.',
    items: ['cue.neon', 'balls.neon', 'trail.electric', 'banner.neon', 'chalk.neon'],
    chalk: 400,
    reward: 'fx.spotlight',
  },
  {
    id: 'set.frost',
    name: 'Cold Snap',
    blurb: 'Everything about this kit is a few degrees under.',
    items: ['trail.ice', 'hit.frost', 'chalk.frost', 'balls.glass'],
    chalk: 350,
    reward: 'cue.stormglass',
  },
  {
    id: 'set.gold',
    name: 'The Full Midas',
    blurb: 'Tasteless, expensive, and unmistakable across a dark room.',
    items: ['cue.midas', 'balls.gold', 'trail.gold', 'banner.gold', 'chalk.midas'],
    chalk: 800,
    reward: 'banner.laurelplate',
  },
  {
    id: 'set.pub',
    name: 'Friday Night',
    blurb: 'The kit of someone who is here every week and never books.',
    items: ['cue.house', 'balls.classic', 'banner.chalkboard', 'avatar.pint', 'chalk.blue'],
    chalk: 200,
    reward: 'fx.dust',
  },
  {
    id: 'set.woodwork',
    name: 'The Workshop',
    blurb: 'Turned, grained and oiled. Nothing here glows.',
    items: ['cue.rosewood', 'balls.wood', 'cue.bamboo', 'cue.driftwood', 'banner.oak'],
    chalk: 350,
    reward: 'balls.bakelite',
  },
  {
    id: 'set.spooky',
    name: 'The Haunting',
    blurb: 'For playing the ghost, against the ghost, as the ghost.',
    items: ['trail.void', 'avatar.ghost', 'hit.glassbreak', 'avatar.skull'],
    chalk: 500,
    reward: 'trail.petals',
  },
  {
    id: 'set.cosmic',
    name: 'Deep Field',
    blurb: 'Every mystic there is. Nobody will believe you.',
    items: ['cue.eventhorizon', 'balls.cosmos', 'trail.timerift', 'hit.bigbang'],
    chalk: 2000,
    reward: 'chalk.singularity',
  },
];

export interface SlotProgress {
  slot: CosmeticSlot;
  label: string;
  owned: number;
  total: number;
  /** 0..1 */
  ratio: number;
}

/** How far along each shelf is. */
export function slotProgress(unlocked: readonly string[]): SlotProgress[] {
  const have = new Set(unlocked);
  return SLOT_ORDER.map((slot) => {
    const items = itemsForSlot(slot);
    const owned = items.filter((i) => have.has(i.id)).length;
    return {
      slot,
      label: SLOT_LABELS[slot],
      owned,
      total: items.length,
      ratio: items.length > 0 ? owned / items.length : 0,
    };
  });
}

/** Overall completion, as owned-over-total across the whole catalogue. */
export function collectionProgress(unlocked: readonly string[]): {
  owned: number;
  total: number;
  ratio: number;
} {
  const have = new Set(unlocked);
  const owned = CATALOG.filter((i) => have.has(i.id)).length;
  return { owned, total: CATALOG.length, ratio: CATALOG.length > 0 ? owned / CATALOG.length : 0 };
}

export interface SetProgress {
  set: CosmeticSet;
  owned: string[];
  missing: CosmeticItem[];
  complete: boolean;
  /** Already claimed — the reward has been handed over. */
  claimed: boolean;
}

/** Where each set stands. Ordered nearest-to-finished first, so there is always a next one. */
export function setProgress(
  unlocked: readonly string[],
  claimedSets: readonly string[] = []
): SetProgress[] {
  const have = new Set(unlocked);
  const claimed = new Set(claimedSets);

  return COSMETIC_SETS.map((set) => {
    const owned = set.items.filter((id) => have.has(id));
    const missing = set.items
      .filter((id) => !have.has(id))
      .map((id) => cosmeticById(id))
      .filter((i): i is CosmeticItem => Boolean(i));
    return {
      set,
      owned,
      missing,
      complete: missing.length === 0,
      claimed: claimed.has(set.id),
    };
  }).sort((a, b) => {
    // Claimed sets drop to the bottom; otherwise the closest to finishing comes first, which
    // is the one worth showing someone.
    if (a.claimed !== b.claimed) return a.claimed ? 1 : -1;
    if (a.complete !== b.complete) return a.complete ? -1 : 1;
    return a.missing.length - b.missing.length;
  });
}

/** Sets that are finished but whose reward has not been handed over yet. */
export function claimableSets(
  unlocked: readonly string[],
  claimedSets: readonly string[] = []
): CosmeticSet[] {
  return setProgress(unlocked, claimedSets)
    .filter((p) => p.complete && !p.claimed)
    .map((p) => p.set);
}

/**
 * Every set an item belongs to — for the "part of: Neon Nights" line on its card.
 *
 * Includes sets the item is the *reward* for, since that is worth knowing before you go
 * looking for it in a shop that does not sell it.
 */
export function setsContaining(itemId: string): CosmeticSet[] {
  return COSMETIC_SETS.filter((s) => s.items.includes(itemId) || s.reward === itemId);
}

/** Items only obtainable by completing a set — they are never in the wheel or the shop. */
export function setRewardIds(): Set<string> {
  return new Set(COSMETIC_SETS.map((s) => s.reward));
}

/** Sort orders the locker grid offers. */
export type SortMode = 'rarity' | 'name' | 'owned';

export interface FilterOptions {
  /** Free-text match against name and blurb. */
  search?: string;
  /** Only items you own, only ones you don't, or everything. */
  ownership?: 'all' | 'owned' | 'missing';
  /** Only items you could buy right now. Ignored unless a chalk balance is given. */
  affordableWith?: number | null;
  /** Restrict to one rarity. */
  rarity?: Rarity | 'all';
  sort?: SortMode;
}

/**
 * Filters and sorts a slot's items for the grid.
 *
 * Pure, and in `shared` rather than in the page, because "which items match this filter" is
 * exactly the kind of thing that is tedious to check by clicking and trivial to check in a
 * test — and it has to agree with the counts shown beside the tabs.
 */
export function filterItems(
  items: readonly CosmeticItem[],
  unlocked: readonly string[],
  opts: FilterOptions = {},
  priceOf: (rarity: Rarity) => number = () => 0
): CosmeticItem[] {
  const have = new Set(unlocked);
  const needle = (opts.search ?? '').trim().toLowerCase();

  const out = items.filter((item) => {
    if (needle && !`${item.name} ${item.blurb}`.toLowerCase().includes(needle)) return false;

    const owned = have.has(item.id);
    if (opts.ownership === 'owned' && !owned) return false;
    if (opts.ownership === 'missing' && owned) return false;

    if (opts.rarity && opts.rarity !== 'all' && item.rarity !== opts.rarity) return false;

    // "Affordable" means something you could actually buy — an item you already own is not a
    // purchase, so it never shows under this filter however much chalk you have.
    if (opts.affordableWith !== null && opts.affordableWith !== undefined) {
      if (owned || priceOf(item.rarity) > opts.affordableWith) return false;
    }
    return true;
  });

  const sort = opts.sort ?? 'rarity';
  return out.sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name);
    if (sort === 'owned') {
      const ao = have.has(a.id) ? 0 : 1;
      const bo = have.has(b.id) ? 0 : 1;
      if (ao !== bo) return ao - bo;
    }
    const byRarity = rarityRank(a.rarity) - rarityRank(b.rarity);
    return byRarity !== 0 ? byRarity : a.name.localeCompare(b.name);
  });
}
