import { describe, expect, it } from 'vitest';
import {
  levelForXp,
  levelProgress,
  xpForLevel,
  matchRewards,
  dailyMissions,
  dailyStreakCoins,
  daysBetween,
  dayKey,
  CATALOG,
  SLOTS,
  itemsForSlot,
  resolveLoadout,
  DEFAULT_LOADOUT,
  CUPS,
  cupField,
  cupById,
  itemById,
} from '../index.js';

describe('levels', () => {
  it('climbs a smooth curve', () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(xpForLevel(10))).toBe(10);
    expect(levelForXp(xpForLevel(10) - 1)).toBe(9);
    const p = levelProgress(xpForLevel(5) + 50);
    expect(p.level).toBe(5);
    expect(p.into).toBe(50);
  });
});

describe('rewards', () => {
  it('pays more for winning, for tougher bots and for longer matches', () => {
    const base = { mode: 'eightball' as const, versusHumans: false, pots: 5, raceTo: 1, clean: false, bestRun: 2 };
    const loss = matchRewards({ ...base, won: false, botTier: 'rookie' });
    const rookieWin = matchRewards({ ...base, won: true, botTier: 'rookie' });
    const masterWin = matchRewards({ ...base, won: true, botTier: 'master' });
    const longWin = matchRewards({ ...base, won: true, botTier: 'master', raceTo: 3 });
    expect(rookieWin.coins).toBeGreaterThan(loss.coins);
    expect(masterWin.coins).toBeGreaterThan(rookieWin.coins);
    expect(longWin.coins).toBeGreaterThan(masterWin.coins);
    expect(rookieWin.lines.length).toBeGreaterThan(0);
  });
});

describe('missions and streaks', () => {
  it('gives the same three distinct missions to everyone on a day', () => {
    const a = dailyMissions('2026-09-01');
    expect(a).toHaveLength(3);
    expect(new Set(a.map((m) => m.metric)).size).toBe(3);
    expect(dailyMissions('2026-09-01')).toEqual(a);
    const days = new Set(Array.from({ length: 10 }, (_, i) => dailyMissions(`2026-09-${10 + i}`).map((m) => m.id).join()));
    expect(days.size).toBeGreaterThan(3);
  });

  it('pays a growing login streak', () => {
    expect(dailyStreakCoins(1)).toBeLessThan(dailyStreakCoins(7));
    expect(dailyStreakCoins(30)).toBe(dailyStreakCoins(7));
    expect(daysBetween('2026-02-28', '2026-03-01')).toBe(1);
    expect(dayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('locker', () => {
  it('has eight items in each of four slots, all unique', () => {
    expect(CATALOG).toHaveLength(32);
    for (const slot of SLOTS) expect(itemsForSlot(slot)).toHaveLength(8);
    expect(new Set(CATALOG.map((i) => i.id)).size).toBe(32);
  });

  it('resolves stale loadouts to the starter kit', () => {
    expect(resolveLoadout({ cue: 'cue.nope', balls: 'balls.glow' })).toEqual({ ...DEFAULT_LOADOUT, balls: 'balls.glow' });
  });

  it('points every cup prize at a real item that is unlocked by that cup', () => {
    for (const cup of CUPS) {
      if (!cup.reward.item) continue;
      const item = itemById(cup.reward.item)!;
      expect(item.unlock).toEqual({ kind: 'cup', cupId: cup.id });
    }
    for (const item of CATALOG) {
      if (item.unlock.kind === 'cup') expect(cupById(item.unlock.cupId)?.reward.item).toBe(item.id);
    }
  });
});

describe('cups', () => {
  it('draws seven distinct opponents', () => {
    for (const cup of CUPS) {
      const field = cupField(cup, () => 0.42);
      expect(field).toHaveLength(7);
      expect(new Set(field.map((b) => b.id)).size).toBe(7);
    }
  });
});
