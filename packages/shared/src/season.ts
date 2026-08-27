import { CATALOG, type CosmeticItem } from './cosmetics.js';

/**
 * Weekly missions and the season reward track.
 *
 * Both are derived from the date, exactly as `dailyChallenge.ts` is — no server state, no clock
 * sync, and every device agrees on what this week's missions are because they compute the same
 * answer from the same calendar. Worth keeping even now that there *is* a server: state you
 * never store is state that can never disagree with itself.
 */

// ---- Calendar ----

/**
 * ISO week key, e.g. `2026-W35`.
 *
 * ISO weeks start on Monday and belong to whichever year holds their Thursday, which is why
 * this shuffles to the Thursday before counting rather than dividing the day-of-year by seven.
 */
export function weekKey(date = new Date()): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7; // Sunday counts as 7
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Seasons run four weeks. Long enough to finish the track, short enough to come round again. */
export const SEASON_WEEKS = 4;

export function seasonKey(date = new Date()): string {
  const [year, week] = weekKey(date).split('-W');
  const index = Math.floor((Number(week) - 1) / SEASON_WEEKS) + 1;
  return `${year}-S${index}`;
}

function hash(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ---- Weekly missions ----

export type MissionKind =
  | 'potCount'
  | 'winCount'
  | 'multiPot'
  | 'cleanFrames'
  | 'careerWins'
  | 'challengeStars'
  | 'jumpPots'
  | 'massePots';

export interface Mission {
  id: string;
  kind: MissionKind;
  text: string;
  target: number;
  xp: number;
  chalk: number;
}

const MISSION_POOL: Omit<Mission, 'id'>[] = [
  { kind: 'potCount', target: 60, text: 'Pot 60 balls', xp: 400, chalk: 120 },
  { kind: 'potCount', target: 120, text: 'Pot 120 balls', xp: 700, chalk: 220 },
  { kind: 'winCount', target: 3, text: 'Win 3 frames', xp: 450, chalk: 140 },
  { kind: 'winCount', target: 8, text: 'Win 8 frames', xp: 800, chalk: 260 },
  { kind: 'multiPot', target: 3, text: 'Pot two balls on one shot, 3 times', xp: 550, chalk: 180 },
  { kind: 'cleanFrames', target: 2, text: 'Win 2 frames without fouling', xp: 600, chalk: 200 },
  { kind: 'careerWins', target: 2, text: 'Beat 2 career opponents', xp: 700, chalk: 240 },
  { kind: 'challengeStars', target: 5, text: 'Earn 5 trick-shot stars', xp: 500, chalk: 160 },
  { kind: 'jumpPots', target: 2, text: 'Pot 2 balls with a jump shot', xp: 650, chalk: 220 },
  { kind: 'massePots', target: 2, text: 'Pot 2 balls with a curved shot', xp: 650, chalk: 220 },
];

/** How many missions run at once. Three is enough to choose between, few enough to finish. */
export const MISSIONS_PER_WEEK = 3;

/**
 * This week's missions.
 *
 * Picked by walking the pool from a hashed offset with a coprime stride, which guarantees three
 * *different* missions — sampling independently would sometimes hand out the same one twice and
 * look like a bug.
 */
export function missionsForWeek(date = new Date()): Mission[] {
  const key = weekKey(date);
  const seed = hash(key);
  const stride = 3; // coprime with a 10-entry pool, so it never repeats within a week
  return Array.from({ length: MISSIONS_PER_WEEK }, (_, i) => {
    const entry = MISSION_POOL[(seed + i * stride) % MISSION_POOL.length];
    return { id: `${key}:${i}`, ...entry };
  });
}

// ---- Season track ----

export interface SeasonTier {
  tier: number;
  /** Total season XP needed to reach this tier. */
  xp: number;
  reward: { kind: 'cosmetic'; id: string } | { kind: 'chalk'; amount: number } | { kind: 'spin' };
}

/** Tiers get further apart as they go, so the last one is an actual achievement. */
function tierCost(tier: number): number {
  return Math.round(600 * tier + 40 * tier * tier);
}

/**
 * The season's reward ladder.
 *
 * The cosmetic prizes are picked from the catalogue by the season key, so each season hands out
 * a different set without anyone hand-authoring twelve of them per season. Chalk and spins fill
 * the gaps, so no tier is ever a blank.
 */
export function seasonTrack(date = new Date()): SeasonTier[] {
  const seed = hash(seasonKey(date));
  // Only items that aren't starters, so a season prize is always something new to somebody.
  const pool = CATALOG.filter((c: CosmeticItem) => c.rarity !== 'common');

  return Array.from({ length: 12 }, (_, i) => {
    const tier = i + 1;
    const xp = tierCost(tier);
    // Every third tier is a cosmetic; the rest alternate chalk and a spin.
    if (tier % 3 === 0) {
      const item = pool[(seed + tier * 7) % pool.length];
      return { tier, xp, reward: { kind: 'cosmetic' as const, id: item.id } };
    }
    if (tier % 2 === 0) return { tier, xp, reward: { kind: 'spin' as const } };
    return { tier, xp, reward: { kind: 'chalk' as const, amount: 100 + tier * 40 } };
  });
}

/** How far up the track a given amount of season XP reaches. */
export function seasonTierFor(seasonXp: number, date = new Date()): number {
  const track = seasonTrack(date);
  let reached = 0;
  for (const t of track) if (seasonXp >= t.xp) reached = t.tier;
  return reached;
}
