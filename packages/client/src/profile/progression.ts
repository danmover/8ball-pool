import {
  ACHIEVEMENTS,
  CAREER,
  cosmeticById,
  careerOpponentById,
  missionsForWeek,
  newlyEarned,
  seasonKey,
  seasonTierFor,
  seasonTrack,
  weekKey,
  type Achievement,
  type AchievementStats,
  type Mission,
} from '@8ball/shared';
import { getProfile, grantXp, mutateProfile } from './profile';
import type { Profile } from './profileStore';

/**
 * Career, achievements, weekly missions and the season track.
 *
 * Kept together and away from `profile.ts` because they all read the *same* counters and would
 * otherwise be four places that each nudge a different field after a shot. One function runs
 * after every shot and one after every frame; everything else is derived.
 */

// ---- The stats achievements are judged on ----

export function achievementStats(profile = getProfile()): AchievementStats {
  const feats = profile.feats;
  const stars = Object.values(profile.challengeStars ?? {}).reduce((a, b) => a + b, 0);
  const beaten = new Set(profile.careerBeaten ?? []);

  return {
    pots: profile.stats.pots,
    wins: profile.stats.wins,
    games: profile.stats.games,
    bestCombo: profile.stats.bestCombo,
    bestRun: feats?.bestRun ?? 0,
    cleanFrames: feats?.cleanFrames ?? 0,
    bestWinStreak: feats?.bestWinStreak ?? 0,
    beatenTiers: feats?.beatenTiers ?? [],
    careerBeaten: profile.careerBeaten ?? [],
    chaptersCleared: CAREER.filter((c) => c.opponents.every((o) => beaten.has(o.id))).length,
    unlocked: profile.unlocked.length,
    mysticsOwned: profile.unlocked.filter((id) => cosmeticById(id)?.rarity === 'mystic').length,
    challengeStars: stars,
    jumpPots: feats?.jumpPots ?? 0,
    massePots: feats?.massePots ?? 0,
    calledPots: feats?.calledPots ?? 0,
    miscues: feats?.miscues ?? 0,
  };
}

// ---- Weekly missions ----

/** This week's missions with progress attached, resetting the store if the week has turned. */
export function weeklyMissions(): { mission: Mission; progress: number; claimed: boolean }[] {
  const profile = getProfile();
  const week = weekKey();
  const store = profile.weekly?.week === week ? profile.weekly : { week, progress: {}, claimed: [] };
  return missionsForWeek().map((mission) => ({
    mission,
    progress: Math.min(mission.target, store.progress[mission.kind] ?? 0),
    claimed: store.claimed.includes(mission.id),
  }));
}

/** Adds to whichever missions track this kind of event. Silently ignores unknown kinds. */
function bumpMissions(draft: Profile, kind: Mission['kind'], amount: number): void {
  if (amount <= 0) return;
  const week = weekKey();
  const store =
    draft.weekly?.week === week ? draft.weekly : { week, progress: {}, claimed: [] };
  store.progress[kind] = (store.progress[kind] ?? 0) + amount;
  draft.weekly = store;
}

export function claimMission(missionId: string): boolean {
  const entry = weeklyMissions().find((m) => m.mission.id === missionId);
  if (!entry || entry.claimed || entry.progress < entry.mission.target) return false;

  mutateProfile((draft) => {
    draft.weekly!.claimed = [...draft.weekly!.claimed, missionId];
    draft.chalk += entry.mission.chalk;
  });
  grantXp(entry.mission.xp);
  addSeasonXp(entry.mission.xp);
  return true;
}

// ---- Season track ----

export function seasonState(): { xp: number; tier: number; claimed: number[] } {
  const profile = getProfile();
  const key = seasonKey();
  const store = profile.season?.season === key ? profile.season : { season: key, xp: 0, claimed: [] };
  return { xp: store.xp, tier: seasonTierFor(store.xp), claimed: store.claimed };
}

/** Season XP tracks total XP earned, but resets with the season. */
export function addSeasonXp(amount: number): void {
  if (amount <= 0) return;
  mutateProfile((draft) => {
    const key = seasonKey();
    const store = draft.season?.season === key ? draft.season : { season: key, xp: 0, claimed: [] };
    store.xp += amount;
    draft.season = store;
  });
}

export function claimSeasonTier(tier: number): boolean {
  const state = seasonState();
  if (tier > state.tier || state.claimed.includes(tier)) return false;
  const entry = seasonTrack().find((t) => t.tier === tier);
  if (!entry) return false;

  mutateProfile((draft) => {
    draft.season!.claimed = [...draft.season!.claimed, tier];
    if (entry.reward.kind === 'chalk') draft.chalk += entry.reward.amount;
    if (entry.reward.kind === 'spin') draft.spins += 1;
    if (entry.reward.kind === 'cosmetic' && !draft.unlocked.includes(entry.reward.id)) {
      draft.unlocked = [...draft.unlocked, entry.reward.id];
    }
  });
  return true;
}

// ---- Achievements ----

/**
 * Awards everything now earned, and pays out for it.
 *
 * Re-evaluated from the full stats snapshot rather than from what just happened, so an
 * achievement added in a later version is granted retroactively the next time you play instead
 * of being permanently out of reach.
 */
export function checkAchievements(): Achievement[] {
  const profile = getProfile();
  const earned = newlyEarned(achievementStats(profile), profile.achievements ?? []);
  if (earned.length === 0) return [];

  mutateProfile((draft) => {
    draft.achievements = [...(draft.achievements ?? []), ...earned.map((a) => a.id)];
    draft.chalk += earned.reduce((sum, a) => sum + a.chalk, 0);
  });
  const xp = earned.reduce((sum, a) => sum + a.xp, 0);
  grantXp(xp);
  addSeasonXp(xp);
  return earned;
}

export function achievementSummary(): { earned: number; total: number } {
  const have = new Set(getProfile().achievements ?? []);
  return { earned: ACHIEVEMENTS.filter((a) => have.has(a.id)).length, total: ACHIEVEMENTS.length };
}

// ---- The two hooks the game calls ----

export interface ShotFeats {
  pots: number;
  /** Balls potted so far in this unbroken visit. */
  runSoFar: number;
  jumped: boolean;
  curved: boolean;
  called: boolean;
  miscued: boolean;
}

/** Called once per settled shot that belonged to this device's player. */
export function recordShotFeats(f: ShotFeats): void {
  mutateProfile((draft) => {
    const feats = draft.feats!;
    feats.bestRun = Math.max(feats.bestRun, f.runSoFar);
    if (f.jumped) feats.jumpPots += f.pots;
    if (f.curved) feats.massePots += f.pots;
    if (f.called) feats.calledPots += f.pots;
    if (f.miscued) feats.miscues += 1;

    bumpMissions(draft, 'potCount', f.pots);
    if (f.pots >= 2) bumpMissions(draft, 'multiPot', 1);
    if (f.jumped) bumpMissions(draft, 'jumpPots', f.pots);
    if (f.curved) bumpMissions(draft, 'massePots', f.pots);
  });
}

export interface FrameResult {
  won: boolean;
  clean: boolean;
  /** The bot tier faced, when this was a solo frame. */
  botTier?: string | null;
  /** The career opponent faced, when this frame came off the ladder. */
  careerOpponentId?: string | null;
}

/**
 * Called once per finished frame. Returns whatever it handed out, so the caller can show it.
 *
 * The career reward is granted here rather than at the ladder screen because this is the only
 * place that knows the frame was actually won — and it's guarded on first win, so replaying a
 * favourite opponent doesn't farm the same cosmetic.
 */
export function recordFrameResult(r: FrameResult): {
  achievements: Achievement[];
  careerReward: string | null;
} {
  let careerReward: string | null = null;

  mutateProfile((draft) => {
    const feats = draft.feats!;
    feats.winStreak = r.won ? feats.winStreak + 1 : 0;
    feats.bestWinStreak = Math.max(feats.bestWinStreak, feats.winStreak);
    if (r.won && r.clean) feats.cleanFrames += 1;
    if (r.won && r.botTier && !feats.beatenTiers.includes(r.botTier)) {
      feats.beatenTiers = [...feats.beatenTiers, r.botTier];
    }

    bumpMissions(draft, 'winCount', r.won ? 1 : 0);
    if (r.won && r.clean) bumpMissions(draft, 'cleanFrames', 1);

    if (r.won && r.careerOpponentId) {
      const already = (draft.careerBeaten ?? []).includes(r.careerOpponentId);
      if (!already) {
        draft.careerBeaten = [...(draft.careerBeaten ?? []), r.careerOpponentId];
        bumpMissions(draft, 'careerWins', 1);
        const opponent = careerOpponentById(r.careerOpponentId);
        if (opponent && !draft.unlocked.includes(opponent.reward)) {
          draft.unlocked = [...draft.unlocked, opponent.reward];
          careerReward = opponent.reward;
        }
      }
    }
  });

  if (r.botTier) updateRating(r.won, r.botTier);
  return { achievements: checkAchievements(), careerReward };
}

// ---- Rating ----

/** Roughly where each bot tier sits, so beating one moves you a sensible amount. */
const TIER_RATING: Record<string, number> = {
  rookie: 800,
  club: 1000,
  shark: 1300,
  legend: 1600,
};

/**
 * Standard Elo against a fixed opponent rating.
 *
 * Deliberately not used for matchmaking — this game doesn't have any. It exists so that "am I
 * actually getting better" has an answer beyond a rising pile of cosmetics, which lifetime
 * totals can't give you because they only ever go up.
 */
export function updateRating(won: boolean, tier: string): void {
  const opponent = TIER_RATING[tier];
  if (opponent === undefined) return;
  mutateProfile((draft) => {
    const current = draft.rating ?? 1000;
    const expected = 1 / (1 + 10 ** ((opponent - current) / 400));
    draft.rating = Math.round(current + 32 * ((won ? 1 : 0) - expected));
  });
}
