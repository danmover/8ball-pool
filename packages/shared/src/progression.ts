/**
 * The XP / spin / chalk economy. Everything here is pure and deterministic (the wheel takes
 * its randomness as an injected `rng`) so it can be unit-tested and, later, moved server-side
 * without behaviour changing.
 */

import { CATALOG, STARTER_IDS, type CosmeticItem, type Rarity } from './cosmetics.js';

// ---- XP ----

/** A pot is worth this much before combo bonuses. */
export const XP_PER_POT = 12;
/** Each extra ball dropped on the same shot is worth progressively more. */
export const XP_COMBO_STEP = 8;
export const XP_PER_WIN = 120;
export const XP_PER_LOSS = 30; // showing up still counts for something
/** Sinking a ball on the break. */
export const XP_BREAK_BONUS = 15;

/**
 * @param comboIndex 0 for the first ball potted on a shot, 1 for the second, and so on.
 */
export function xpForPot(comboIndex: number): number {
  const idx = Math.max(0, Math.floor(comboIndex));
  return XP_PER_POT + idx * XP_COMBO_STEP;
}

/** Total XP for a whole shot that potted `count` balls. */
export function xpForShot(count: number): number {
  let total = 0;
  for (let i = 0; i < count; i++) total += xpForPot(i);
  return total;
}

export function xpForResult(won: boolean): number {
  return won ? XP_PER_WIN : XP_PER_LOSS;
}

// ---- Levels ----

const LEVEL_BASE = 120;
const LEVEL_STEP = 40;

/** XP required to advance *from* `level` to `level + 1`. Levels start at 1. */
export function xpToNextLevel(level: number): number {
  return LEVEL_BASE + Math.max(0, level - 1) * LEVEL_STEP;
}

/** Total XP required to reach `level` from zero. */
export function xpForLevel(level: number): number {
  let total = 0;
  for (let l = 1; l < level; l++) total += xpToNextLevel(l);
  return total;
}

export function levelForXp(xp: number): number {
  let level = 1;
  let remaining = Math.max(0, xp);
  while (remaining >= xpToNextLevel(level)) {
    remaining -= xpToNextLevel(level);
    level++;
  }
  return level;
}

/** Progress through the current level, as XP-into-level and the level's size. */
export function levelProgress(xp: number): { level: number; into: number; span: number; ratio: number } {
  const level = levelForXp(xp);
  const into = Math.max(0, xp) - xpForLevel(level);
  const span = xpToNextLevel(level);
  return { level, into, span, ratio: span > 0 ? into / span : 0 };
}

/** Every level gained grants one spin. */
export function spinsForLevelUp(fromLevel: number, toLevel: number): number {
  return Math.max(0, toLevel - fromLevel);
}

// ---- Chalk ----

const DUPLICATE_CHALK: Record<Rarity, number> = {
  common: 10,
  rare: 25,
  epic: 60,
  legendary: 150,
  mystic: 400,
};

const CHALK_PRICE: Record<Rarity, number> = {
  common: 60,
  rare: 150,
  epic: 400,
  legendary: 1000,
  mystic: 3000,
};

export function chalkForDuplicate(rarity: Rarity): number {
  return DUPLICATE_CHALK[rarity];
}

export function chalkPrice(rarity: Rarity): number {
  return CHALK_PRICE[rarity];
}

// ---- The wheel ----

export const RARITY_WEIGHTS: Record<Rarity, number> = {
  common: 55,
  rare: 28,
  epic: 13,
  legendary: 4,
  // Rare enough to be a story when it lands, common enough that it does eventually.
  mystic: 1,
};

export interface WheelResult {
  item: CosmeticItem;
  /** True when the roll landed on something already owned — awards chalk instead. */
  duplicate: boolean;
  chalkAwarded: number;
}

/** Items the wheel is allowed to hand out: everything except the always-owned starters. */
export function wheelPool(): CosmeticItem[] {
  return CATALOG.filter((item) => !STARTER_IDS.includes(item.id));
}

function pickWeighted(items: CosmeticItem[], rng: () => number): CosmeticItem {
  const total = items.reduce((sum, item) => sum + RARITY_WEIGHTS[item.rarity], 0);
  let roll = rng() * total;
  for (const item of items) {
    roll -= RARITY_WEIGHTS[item.rarity];
    if (roll <= 0) return item;
  }
  return items[items.length - 1];
}

/**
 * Rolls one wheel result. Un-owned items are strongly preferred: while anything is still
 * locked the wheel only ever lands on locked items, so a spin always means a new unlock.
 * Once the collection is complete every roll is a duplicate and pays out chalk instead.
 */
export function rollWheel(unlockedIds: readonly string[], rng: () => number): WheelResult {
  const owned = new Set(unlockedIds);
  const pool = wheelPool();
  const locked = pool.filter((item) => !owned.has(item.id));

  if (locked.length > 0) {
    const item = pickWeighted(locked, rng);
    return { item, duplicate: false, chalkAwarded: 0 };
  }

  const item = pickWeighted(pool, rng);
  return { item, duplicate: true, chalkAwarded: chalkForDuplicate(item.rarity) };
}
