import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENTS,
  achievementById,
  newlyEarned,
  type AchievementStats,
} from '../achievements.js';
import {
  MISSIONS_PER_WEEK,
  missionsForWeek,
  seasonKey,
  seasonTierFor,
  seasonTrack,
  weekKey,
} from '../season.js';
import { CATALOG } from '../cosmetics.js';

function stats(over: Partial<AchievementStats> = {}): AchievementStats {
  return {
    pots: 0,
    wins: 0,
    games: 0,
    bestCombo: 0,
    bestRun: 0,
    cleanFrames: 0,
    bestWinStreak: 0,
    beatenTiers: [],
    careerBeaten: [],
    chaptersCleared: 0,
    unlocked: 0,
    mysticsOwned: 0,
    challengeStars: 0,
    jumpPots: 0,
    massePots: 0,
    calledPots: 0,
    miscues: 0,
    ...over,
  };
}

describe('achievements', () => {
  it('has unique ids', () => {
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
  });

  it('awards nothing to a brand new player', () => {
    // If any achievement is earned by doing literally nothing, its predicate is wrong.
    expect(newlyEarned(stats(), [])).toEqual([]);
  });

  it('awards the first tier as soon as the feat happens', () => {
    const earned = newlyEarned(stats({ pots: 1 }), []);
    expect(earned.map((a) => a.id)).toContain('pots.1');
  });

  it('awards every tier the stats have passed, not just the highest', () => {
    const earned = newlyEarned(stats({ pots: 600 }), []).map((a) => a.id);
    expect(earned).toContain('pots.1');
    expect(earned).toContain('pots.2');
    expect(earned).toContain('pots.3');
    expect(earned).not.toContain('pots.4');
  });

  it('never awards the same one twice', () => {
    expect(newlyEarned(stats({ pots: 5 }), ['pots.1'])).toEqual([]);
  });

  it('backfills achievements added after the feat was already done', () => {
    // The reason this is a pure predicate over a snapshot rather than an event handler: a
    // veteran shouldn't be locked out of an achievement added in a later version.
    const veteran = stats({ pots: 12000, wins: 600, games: 1200 });
    expect(newlyEarned(veteran, []).length).toBeGreaterThan(10);
  });

  it('pays more for the harder tiers', () => {
    for (const base of ['pots', 'wins', 'combo']) {
      const tiered = ACHIEVEMENTS.filter((a) => a.id.startsWith(`${base}.`));
      for (let i = 1; i < tiered.length; i++) {
        expect(tiered[i].xp).toBeGreaterThan(tiered[i - 1].xp);
      }
    }
  });

  it('reports partial progress for a bar', () => {
    expect(achievementById('pots.2')!.progress(stats({ pots: 50 }))).toBeCloseTo(0.5, 2);
    expect(achievementById('pots.2')!.progress(stats({ pots: 999 }))).toBe(1);
  });

  it('tracks the elevation feats separately from ordinary pots', () => {
    const jumped = newlyEarned(stats({ jumpPots: 1 }), []).map((a) => a.id);
    expect(jumped).toContain('jump.1');
    expect(jumped).not.toContain('masse.1');
  });
});

describe('week and season keys', () => {
  it('gives the same week for every day of one ISO week', () => {
    // Mon 24 Aug 2026 through Sun 30 Aug 2026.
    const keys = new Set<string>();
    for (let d = 24; d <= 30; d++) keys.add(weekKey(new Date(Date.UTC(2026, 7, d))));
    expect(keys.size).toBe(1);
  });

  it('rolls over on Monday, not Sunday', () => {
    const sunday = weekKey(new Date(Date.UTC(2026, 7, 30)));
    const monday = weekKey(new Date(Date.UTC(2026, 7, 31)));
    expect(monday).not.toBe(sunday);
  });

  it('puts an early-January week with the year that owns its Thursday', () => {
    // 1 Jan 2027 is a Friday, so it belongs to ISO week 53 of 2026 — the classic trap.
    expect(weekKey(new Date(Date.UTC(2027, 0, 1)))).toBe('2026-W53');
  });

  it('groups four weeks into a season', () => {
    const a = seasonKey(new Date(Date.UTC(2026, 7, 24)));
    const b = seasonKey(new Date(Date.UTC(2026, 7, 31)));
    expect(a).toBe(b);
  });
});

describe('weekly missions', () => {
  it('gives everyone the same missions for the same week', () => {
    const a = missionsForWeek(new Date(Date.UTC(2026, 7, 24)));
    const b = missionsForWeek(new Date(Date.UTC(2026, 7, 28)));
    expect(a).toEqual(b);
  });

  it('changes them the following week', () => {
    const a = missionsForWeek(new Date(Date.UTC(2026, 7, 24)));
    const b = missionsForWeek(new Date(Date.UTC(2026, 8, 7)));
    expect(a.map((m) => m.kind)).not.toEqual(b.map((m) => m.kind));
  });

  it('never hands out the same mission twice in one week', () => {
    // Sampling independently would occasionally duplicate one, which reads as a bug.
    for (let w = 0; w < 60; w++) {
      const set = missionsForWeek(new Date(Date.UTC(2026, 0, 5 + w * 7)));
      expect(set).toHaveLength(MISSIONS_PER_WEEK);
      expect(new Set(set.map((m) => m.kind)).size).toBe(MISSIONS_PER_WEEK);
    }
  });
});

describe('season track', () => {
  const track = seasonTrack(new Date(Date.UTC(2026, 7, 24)));

  it('costs more with every tier', () => {
    for (let i = 1; i < track.length; i++) {
      expect(track[i].xp).toBeGreaterThan(track[i - 1].xp);
    }
  });

  it('never leaves a tier empty', () => {
    for (const tier of track) expect(tier.reward).toBeDefined();
  });

  it('only awards cosmetics that exist', () => {
    const ids = new Set(CATALOG.map((c) => c.id));
    for (const tier of track) {
      const reward = tier.reward;
      if (reward.kind === 'cosmetic') expect(ids.has(reward.id)).toBe(true);
    }
  });

  it('never puts a plain common item on the track', () => {
    // A season prize should be something you'd want; commons are handed out constantly.
    for (const tier of track) {
      const reward = tier.reward;
      if (reward.kind !== 'cosmetic') continue;
      expect(CATALOG.find((c) => c.id === reward.id)?.rarity).not.toBe('common');
    }
  });

  it('works out which tier a given amount of XP reaches', () => {
    const when = new Date(Date.UTC(2026, 7, 24));
    expect(seasonTierFor(0, when)).toBe(0);
    expect(seasonTierFor(track[0].xp, when)).toBe(1);
    expect(seasonTierFor(track[2].xp, when)).toBe(3);
    expect(seasonTierFor(999999, when)).toBe(track.length);
  });
});
