import {
  chalkPrice,
  cosmeticById,
  levelForXp,
  resolveLoadout,
  rollWheel,
  spinsForLevelUp,
  type CosmeticSlot,
  type Loadout,
  type WheelResult,
} from '@8ball/shared';
import {
  LocalProfileStore,
  createDefaultProfile,
  type Profile,
  type ProfileStore,
} from './profileStore';

/**
 * Single source of truth for the local player's profile. Every mutation goes through
 * here so persistence and level-up bookkeeping can't be forgotten at a call site.
 */

let store: ProfileStore = new LocalProfileStore();
let cached: Profile | null = null;
const listeners = new Set<(profile: Profile) => void>();

/** Swap in a different backing store (the seam for a future server-backed profile). */
export function useProfileStore(next: ProfileStore): void {
  store = next;
  cached = null;
}

export function getProfile(): Profile {
  if (!cached) cached = store.load();
  return cached;
}

function commit(profile: Profile): Profile {
  cached = profile;
  store.save(profile);
  for (const listener of listeners) listener(profile);
  return profile;
}

export function onProfileChange(listener: (profile: Profile) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setDisplayName(name: string): Profile {
  return commit({ ...getProfile(), displayName: name.slice(0, 16) });
}

/** The equipped loadout, always complete and always valid. */
export function equippedLoadout(): Required<Loadout> {
  return resolveLoadout(getProfile().loadout);
}

export function equip(slot: CosmeticSlot, id: string): Profile {
  const profile = getProfile();
  if (!profile.unlocked.includes(id)) return profile;
  if (cosmeticById(id)?.slot !== slot) return profile;
  return commit({ ...profile, loadout: { ...profile.loadout, [slot]: id } });
}

export interface XpAward {
  xp: number;
  levelsGained: number;
  spinsGained: number;
  levelBefore: number;
  levelAfter: number;
}

export function grantXp(amount: number): XpAward {
  const profile = getProfile();
  const levelBefore = levelForXp(profile.xp);
  const xp = Math.max(0, profile.xp + Math.round(amount));
  const levelAfter = levelForXp(xp);
  const spinsGained = spinsForLevelUp(levelBefore, levelAfter);

  commit({ ...profile, xp, level: levelAfter, spins: profile.spins + spinsGained });

  return {
    xp: Math.round(amount),
    levelsGained: levelAfter - levelBefore,
    spinsGained,
    levelBefore,
    levelAfter,
  };
}

export function recordStats(patch: Partial<Profile['stats']>): Profile {
  const profile = getProfile();
  const stats = { ...profile.stats };
  stats.pots += patch.pots ?? 0;
  stats.wins += patch.wins ?? 0;
  stats.games += patch.games ?? 0;
  stats.bestCombo = Math.max(stats.bestCombo, patch.bestCombo ?? 0);
  return commit({ ...profile, stats });
}

/**
 * Spends one spin and applies the result. Returns null when there's nothing to spend —
 * callers should check `getProfile().spins` before offering the button, but this keeps a
 * double-click from ever awarding twice.
 */
export function spendSpin(rng: () => number = Math.random): WheelResult | null {
  const profile = getProfile();
  if (profile.spins <= 0) return null;

  const result = rollWheel(profile.unlocked, rng);
  commit({
    ...profile,
    spins: profile.spins - 1,
    chalk: profile.chalk + result.chalkAwarded,
    unlocked: result.duplicate ? profile.unlocked : [...profile.unlocked, result.item.id],
  });
  return result;
}

export function canAfford(id: string): boolean {
  const item = cosmeticById(id);
  if (!item) return false;
  const profile = getProfile();
  return !profile.unlocked.includes(id) && profile.chalk >= chalkPrice(item.rarity);
}

export function buyWithChalk(id: string): boolean {
  if (!canAfford(id)) return false;
  const item = cosmeticById(id)!;
  const profile = getProfile();
  commit({
    ...profile,
    chalk: profile.chalk - chalkPrice(item.rarity),
    unlocked: [...profile.unlocked, id],
  });
  return true;
}

/** Debug/testing helper — also what a future "reset progress" button would call. */
export function resetProfile(): Profile {
  return commit(createDefaultProfile());
}
