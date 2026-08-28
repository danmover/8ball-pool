import { DEFAULT_LOADOUT, STARTER_IDS, type Loadout, type RivalRecord } from '@8ball/shared';

/**
 * A player's persistent identity and collection. Deliberately kept behind the
 * `ProfileStore` interface below so this can move to a server-backed store later
 * without any of the cosmetics or wheel code changing.
 */
export interface Profile {
  displayName: string;
  xp: number;
  /** Cached level; always re-derived from xp on load so the curve can be retuned freely. */
  level: number;
  chalk: number;
  spins: number;
  unlocked: string[];
  loadout: Loadout;
  /** Lifetime stats, shown on the profile card. */
  stats: { pots: number; wins: number; games: number; bestCombo: number };
  /** Today's daily-challenge progress, stamped with the day so it self-resets. */
  daily?: { date: string; value: number; completed: boolean; claimed: boolean };
  /** Best stars earned per trick-shot challenge, keyed by challenge id. */
  challengeStars?: Record<string, number>;
  /** Career opponents beaten, by id. */
  careerBeaten?: string[];
  /** Achievement ids earned. */
  achievements?: string[];
  /**
   * Counters the achievement predicates read. Separate from `stats` because that is what the
   * profile card has always shown, and widening it would change every existing save's meaning.
   */
  feats?: {
    bestRun: number;
    cleanFrames: number;
    winStreak: number;
    bestWinStreak: number;
    beatenTiers: string[];
    jumpPots: number;
    massePots: number;
    calledPots: number;
    miscues: number;
  };
  /** This week's mission progress, stamped with the week so it self-resets. */
  weekly?: { week: string; progress: Record<string, number>; claimed: string[] };
  /** Season XP and which tiers have been collected, stamped with the season. */
  season?: { season: string; xp: number; claimed: number[] };
  /** Elo against the bots — "am I actually getting better" needs an answer. */
  rating?: number;
  /** Head-to-head records, keyed by `rivalKey(name)`. */
  rivals?: Record<string, RivalRecord>;
  /**
   * Counters the stats page reads. Kept apart from `stats` for the same reason `feats` is —
   * that object is what the profile card has always shown, and widening it would change what
   * every existing save means.
   */
  history?: {
    /** Frames played per mode, so "favourite mode" is a fact rather than a guess. */
    modeFrames: Record<string, number>;
    /** Most balls potted in a single unbroken visit. */
    longestClearance: number;
    /** Shots taken, so a pot rate can be computed honestly. */
    shots: number;
    /** Frames that went to a decider, and how they went. */
    decidersWon: number;
    decidersLost: number;
  };
}

export interface ProfileStore {
  load(): Profile;
  save(profile: Profile): void;
}

const PROFILE_KEY = '8ball:profile';

export function createDefaultProfile(): Profile {
  return {
    displayName: '',
    xp: 0,
    level: 1,
    chalk: 0,
    // One free spin up front so nobody's first look at the wheel is a locked one.
    spins: 1,
    unlocked: [...STARTER_IDS],
    loadout: { ...DEFAULT_LOADOUT },
    stats: { pots: 0, wins: 0, games: 0, bestCombo: 0 },
    challengeStars: {},
    careerBeaten: [],
    achievements: [],
    feats: {
      bestRun: 0,
      cleanFrames: 0,
      winStreak: 0,
      bestWinStreak: 0,
      beatenTiers: [],
      jumpPots: 0,
      massePots: 0,
      calledPots: 0,
      miscues: 0,
    },
    // 1000 is the conventional Elo starting point, and "beat Club to climb" is a fair floor.
    rating: 1000,
  };
}

/** localStorage-backed store. Mirrors settingsStore's defaults-merge + try/catch shape. */
export class LocalProfileStore implements ProfileStore {
  load(): Profile {
    const fallback = createDefaultProfile();
    try {
      const raw = localStorage.getItem(PROFILE_KEY);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw) as Partial<Profile>;
      return {
        ...fallback,
        ...parsed,
        // Starters are always owned, even if an older save predates one of them.
        unlocked: [...new Set([...STARTER_IDS, ...(parsed.unlocked ?? [])])],
        loadout: { ...DEFAULT_LOADOUT, ...(parsed.loadout ?? {}) },
        stats: { ...fallback.stats, ...(parsed.stats ?? {}) },
        challengeStars: { ...(parsed.challengeStars ?? {}) },
        careerBeaten: [...(parsed.careerBeaten ?? [])],
        achievements: [...(parsed.achievements ?? [])],
        feats: { ...fallback.feats!, ...(parsed.feats ?? {}) },
        rating: parsed.rating ?? fallback.rating,
      };
    } catch {
      return fallback;
    }
  }

  save(profile: Profile): void {
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    } catch {
      // Private-browsing quota errors shouldn't take the game down.
    }
  }
}
