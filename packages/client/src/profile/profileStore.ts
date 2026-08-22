import { DEFAULT_LOADOUT, STARTER_IDS, type Loadout } from '@8ball/shared';

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
