import {
  SLOT_ORDER,
  claimableSets,
  cosmeticById,
  resolveLoadout,
  type CosmeticSet,
  type Loadout,
} from '@8ball/shared';
import { getProfile, mutateProfile } from './profile';

/**
 * The locker's own operations: saved kits, and cashing in a finished set.
 *
 * Kept out of the page so both can be tested without a DOM — a preset that silently drops a
 * slot, or a set reward handed out twice, are exactly the bugs that are invisible by eye and
 * obvious in a test.
 */

/** More than this and the list stops being a shortcut. */
export const MAX_PRESETS = 6;

export interface Preset {
  name: string;
  loadout: Loadout;
}

export function presets(): Preset[] {
  return getProfile().presets ?? [];
}

/**
 * Saves the kit currently equipped under `name`.
 *
 * Saving over an existing name replaces it, which is what someone typing the same name again
 * plainly means. The full resolved loadout is stored rather than the sparse one, so a preset
 * keeps working when the defaults change under it.
 */
export function savePreset(name: string): Preset[] {
  const clean = name.trim().slice(0, 20);
  if (!clean) return presets();

  mutateProfile((draft) => {
    const list = [...(draft.presets ?? [])];
    const entry: Preset = { name: clean, loadout: { ...resolveLoadout(draft.loadout) } };
    const existing = list.findIndex((p) => p.name.toLowerCase() === clean.toLowerCase());
    if (existing >= 0) list[existing] = entry;
    else if (list.length < MAX_PRESETS) list.push(entry);
    else return; // full, and silently dropping the oldest would lose someone's kit
    draft.presets = list;
  });
  return presets();
}

export function deletePreset(name: string): Preset[] {
  mutateProfile((draft) => {
    draft.presets = (draft.presets ?? []).filter(
      (p) => p.name.toLowerCase() !== name.toLowerCase()
    );
  });
  return presets();
}

/**
 * Wears a saved kit.
 *
 * Only equips pieces still owned — a preset saved before a profile transfer can name things
 * this device has not unlocked, and half a kit is better than a rejected one. Returns how many
 * pieces were skipped so the page can say so rather than quietly doing less than asked.
 */
export function applyPreset(name: string): { applied: number; skipped: number } {
  const preset = presets().find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (!preset) return { applied: 0, skipped: 0 };

  let applied = 0;
  let skipped = 0;
  mutateProfile((draft) => {
    const next: Loadout = { ...draft.loadout };
    for (const slot of SLOT_ORDER) {
      const id = preset.loadout[slot];
      if (!id) continue;
      if (!draft.unlocked.includes(id) || cosmeticById(id)?.slot !== slot) {
        skipped++;
        continue;
      }
      next[slot] = id;
      applied++;
    }
    draft.loadout = next;
  });
  return { applied, skipped };
}

/**
 * Hands over the reward for a finished set.
 *
 * Guarded on `claimedSets` rather than on whether the reward is already owned: the reward can
 * also arrive from a later set or a future giveaway, and "you own it, so no chalk for you"
 * would be a nasty way to lose a payout you earned.
 */
export function claimSet(setId: string): CosmeticSet | null {
  const profile = getProfile();
  const ready = claimableSets(profile.unlocked, profile.claimedSets ?? []);
  const set = ready.find((s) => s.id === setId);
  if (!set) return null;

  mutateProfile((draft) => {
    draft.claimedSets = [...(draft.claimedSets ?? []), set.id];
    draft.chalk += set.chalk;
    if (!draft.unlocked.includes(set.reward)) {
      draft.unlocked = [...draft.unlocked, set.reward];
    }
  });
  return set;
}

/** Sets finished but not yet cashed in — drives the badge on the locker tile. */
export function pendingSets(): CosmeticSet[] {
  const profile = getProfile();
  return claimableSets(profile.unlocked, profile.claimedSets ?? []);
}
