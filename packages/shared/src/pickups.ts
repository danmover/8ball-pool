import type { Vec2 } from './vector.js';
import { BALL_RADIUS, TABLE_LENGTH, TABLE_WIDTH } from './constants.js';
import { POCKETS, pocketContaining } from './table.js';

/**
 * Pickups — the party mode.
 *
 * Deliberately kept out of every other mode and out of the physics defaults: `stepSimulation`
 * takes them as an *option*, so the aim guide and the bot's search run the identical engine
 * they always did unless the caller opts in. A party mode that quietly changed how the serious
 * modes played would not be worth having.
 *
 * Every effect lasts exactly one shot, and every one of them is *declared before the shot* —
 * you can see what you armed and so can your opponent. A power-up that surprises you halfway
 * through your own stroke would just feel like the game cheating.
 */

export type PickupKind = 'magnet' | 'blocker' | 'ghost' | 'freeze' | 'bonus';

export interface Pickup {
  id: number;
  kind: PickupKind;
  pos: Vec2;
  /** Once taken it stays on the list, greyed out, so the client can animate it away. */
  taken: boolean;
}

/** Radius of the disc on the cloth. Generous — hunting for a pixel isn't the fun part. */
export const PICKUP_RADIUS = BALL_RADIUS * 1.6;

/** How much wider a magnet pocket's mouth reads. */
export const MAGNET_BONUS = BALL_RADIUS * 1.5;

export interface PickupInfo {
  label: string;
  blurb: string;
  /** Whether the effect lands on you or on the next player. */
  target: 'self' | 'opponent';
}

export const PICKUP_INFO: Record<PickupKind, PickupInfo> = {
  magnet: {
    label: 'Magnet Pocket',
    blurb: 'Your next shot: one pocket pulls balls in from wider.',
    target: 'self',
  },
  blocker: {
    label: 'Blocker',
    blurb: "A bumper covers a pocket on your opponent's next shot.",
    target: 'opponent',
  },
  ghost: {
    label: 'Ghost Line',
    blurb: 'Your next shot: the full path is drawn, cushions and all.',
    target: 'self',
  },
  freeze: {
    label: 'Freeze',
    blurb: "Your opponent's aim guide goes dark for one shot.",
    target: 'opponent',
  },
  bonus: {
    label: 'Bonus Visit',
    blurb: 'Keep the table for one more shot, potted or not.',
    target: 'self',
  },
};

/**
 * Effects in force for the shot about to be played.
 *
 * A flat record rather than a list, because two of the same never stack — a second magnet just
 * moves which pocket it is on, and "two magnets" would need a rule nobody would remember.
 */
export interface ShotModifiers {
  /** Index into `POCKETS` of the widened pocket, or null. */
  magnetPocket: number | null;
  /** Index into `POCKETS` of a pocket that rejects balls this shot, or null. */
  blockedPocket: number | null;
  ghostLine: boolean;
  freezeGuide: boolean;
  bonusVisit: boolean;
}

export const NO_MODIFIERS: ShotModifiers = {
  magnetPocket: null,
  blockedPocket: null,
  ghostLine: false,
  freezeGuide: false,
  bonusVisit: false,
};

/** Which pocket a pickup should act on: the one nearest where it was collected. */
export function nearestPocketIndex(pos: Vec2): number {
  let best = 0;
  let bestDist = Infinity;
  for (const pocket of POCKETS) {
    const dx = pocket.mid.x - pos.x;
    const dy = pocket.mid.y - pos.y;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      best = pocket.index;
    }
  }
  return best;
}

/** Folds one collected pickup into the modifier set. */
export function applyPickup(mods: ShotModifiers, kind: PickupKind, at: Vec2): ShotModifiers {
  switch (kind) {
    case 'magnet':
      return { ...mods, magnetPocket: nearestPocketIndex(at) };
    case 'blocker':
      return { ...mods, blockedPocket: nearestPocketIndex(at) };
    case 'ghost':
      return { ...mods, ghostLine: true };
    case 'freeze':
      return { ...mods, freezeGuide: true };
    case 'bonus':
      return { ...mods, bonusVisit: true };
  }
}

/** Splits a modifier set into the half that follows the shooter and the half that's handed on. */
export function splitModifiers(mods: ShotModifiers): { mine: ShotModifiers; theirs: ShotModifiers } {
  return {
    mine: {
      ...NO_MODIFIERS,
      magnetPocket: mods.magnetPocket,
      ghostLine: mods.ghostLine,
      bonusVisit: mods.bonusVisit,
    },
    theirs: {
      ...NO_MODIFIERS,
      blockedPocket: mods.blockedPocket,
      freezeGuide: mods.freezeGuide,
    },
  };
}

const KINDS: PickupKind[] = ['magnet', 'blocker', 'ghost', 'freeze', 'bonus'];

/**
 * Scatters `count` pickups over the open cloth.
 *
 * Kept out of the rack triangle, off the pockets and away from each other, so none of them is
 * unreachable or collected by accident on the break. `rand` is injected so a test can pin the
 * layout — everything else about this module is already deterministic.
 */
export function spawnPickups(count = 4, rand: () => number = Math.random): Pickup[] {
  const out: Pickup[] = [];
  const margin = PICKUP_RADIUS * 2.5;
  // The rack sits in the far quarter; leave it alone or the break collects the lot.
  const minX = TABLE_LENGTH * 0.3;
  const maxX = TABLE_LENGTH * 0.68;

  for (let attempt = 0; attempt < count * 200 && out.length < count; attempt++) {
    const pos = {
      x: minX + rand() * (maxX - minX),
      y: margin + rand() * (TABLE_WIDTH - margin * 2),
    };
    if (pocketContaining(pos)) continue;
    if (out.some((p) => Math.hypot(p.pos.x - pos.x, p.pos.y - pos.y) < PICKUP_RADIUS * 5)) continue;
    out.push({ id: out.length, kind: KINDS[out.length % KINDS.length], pos, taken: false });
  }
  return out;
}

/** Pickups the ball at `pos` is currently sitting on. */
export function pickupsUnder(pickups: Pickup[], pos: Vec2): Pickup[] {
  const reach = PICKUP_RADIUS + BALL_RADIUS;
  return pickups.filter(
    (p) => !p.taken && Math.hypot(p.pos.x - pos.x, p.pos.y - pos.y) <= reach
  );
}
