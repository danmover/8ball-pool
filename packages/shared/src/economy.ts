import type { BotTier, GameMode } from './types.js';
import { CATALOG, type CosmeticItem } from './cosmetics.js';

/**
 * XP, levels and coins. Pure functions, so the whole economy can be tested and tuned without a
 * browser — and so a frame's rewards are shown to the player exactly as they were computed.
 */

// ------------------------------------------------------------------ levels

/** XP needed to go from `level` to `level + 1`. */
export function xpToNextLevel(level: number): number {
  return 200 + Math.max(0, level - 1) * 60;
}

/** Total XP needed to reach `level` from zero. */
export function xpForLevel(level: number): number {
  let total = 0;
  for (let l = 1; l < level; l++) total += xpToNextLevel(l);
  return total;
}

export function levelForXp(xp: number): number {
  let level = 1;
  let remaining = Math.max(0, xp);
  while (remaining >= xpToNextLevel(level) && level < 999) {
    remaining -= xpToNextLevel(level);
    level++;
  }
  return level;
}

export function levelProgress(xp: number): { level: number; into: number; span: number; ratio: number } {
  const level = levelForXp(xp);
  const into = Math.max(0, xp) - xpForLevel(level);
  const span = xpToNextLevel(level);
  return { level, into, span, ratio: span > 0 ? into / span : 0 };
}

/** Coins handed over for reaching `level`. */
export function levelUpCoins(level: number): number {
  return 100 + level * 20;
}

/** Items that unlock on reaching exactly this level. */
export function levelUnlocks(level: number): CosmeticItem[] {
  return CATALOG.filter((item) => item.unlock.kind === 'level' && item.unlock.level === level);
}

// ------------------------------------------------------------------ match rewards

export interface MatchContext {
  mode: GameMode;
  won: boolean;
  /** Against the computer at this tier, or null for people. */
  botTier: BotTier | null;
  /** Everyone at the table was a person other than you. */
  versusHumans: boolean;
  pots: number;
  /** Frames needed to win the match; longer matches pay more. */
  raceTo: number;
  /** Won without a foul. */
  clean: boolean;
  /** Best visit in balls. */
  bestRun: number;
}

export interface RewardLine {
  label: string;
  xp: number;
  coins: number;
}

export interface MatchRewards {
  xp: number;
  coins: number;
  lines: RewardLine[];
}

const TIER_BONUS: Record<BotTier, number> = { rookie: 0, amateur: 20, pro: 50, master: 90 };

export function matchRewards(ctx: MatchContext): MatchRewards {
  const lines: RewardLine[] = [];
  const length = Math.max(1, ctx.raceTo);
  const lengthScale = 1 + (length - 1) * 0.5;

  if (ctx.won) {
    const base = ctx.versusHumans ? 110 : 70;
    const tier = ctx.botTier ? TIER_BONUS[ctx.botTier] : 0;
    lines.push({ label: 'Victory', xp: Math.round(120 * lengthScale), coins: Math.round((base + tier) * lengthScale) });
  } else {
    lines.push({ label: 'Played', xp: Math.round(45 * lengthScale), coins: Math.round((ctx.versusHumans ? 30 : 15) * lengthScale) });
  }
  if (ctx.pots > 0) {
    lines.push({ label: `${ctx.pots} ball${ctx.pots === 1 ? '' : 's'} potted`, xp: ctx.pots * 6, coins: Math.min(60, ctx.pots * 3) });
  }
  if (ctx.won && ctx.clean) lines.push({ label: 'Clean win', xp: 40, coins: 25 });
  if (ctx.bestRun >= 5) lines.push({ label: `${ctx.bestRun}-ball run`, xp: 30 + ctx.bestRun * 5, coins: 20 + ctx.bestRun * 2 });

  return {
    xp: lines.reduce((s, l) => s + l.xp, 0),
    coins: lines.reduce((s, l) => s + l.coins, 0),
    lines,
  };
}

// ------------------------------------------------------------------ daily login

/** Coins for day 1..7 of a login streak; day 7 repeats after that. */
export const DAILY_STREAK_COINS = [50, 75, 100, 125, 150, 200, 300];

export function dailyStreakCoins(day: number): number {
  const i = Math.max(1, Math.min(DAILY_STREAK_COINS.length, day)) - 1;
  return DAILY_STREAK_COINS[i];
}

/** `YYYY-MM-DD` in local time — the key missions and the daily reward are stamped with. */
export function dayKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Whole days between two day keys. */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  const ta = Date.UTC(ay, am - 1, ad);
  const tb = Date.UTC(by, bm - 1, bd);
  return Math.round((tb - ta) / 86_400_000);
}

/** Starting balance for a brand-new player — enough for one rare item on day one. */
export const STARTING_COINS = 600;
