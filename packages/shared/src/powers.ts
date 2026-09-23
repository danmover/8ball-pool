import { hypot2, type Vec2 } from './vector.js';
import { BALL_DIAMETER, BALL_RADIUS, CUE_BALL_ID, TABLE_LENGTH, TABLE_WIDTH } from './constants.js';
import { POCKETS, pocketContaining } from './table.js';
import type { Ball, Seat } from './types.js';

/**
 * Power Pool: orbs on the cloth, collected by routing the cue ball through them.
 *
 * A collected power goes into your hand (up to three) and is **armed** before a shot, so the
 * decision is yours and everybody at the table can see it coming. Two powers act on the
 * physics (Big Pockets, Bomb); the rest act on the rules or the aim guide.
 */

export type PowerId = 'bigPockets' | 'bomb' | 'double' | 'guide' | 'extra' | 'freeze';

export const POWER_IDS: PowerId[] = ['bigPockets', 'bomb', 'double', 'guide', 'extra', 'freeze'];

export interface PowerInfo {
  name: string;
  blurb: string;
  /** A single emoji, used on orbs, buttons and notices. */
  glyph: string;
  /** Hex colour of the orb and its effects. */
  color: string;
}

export const POWER_INFO: Record<PowerId, PowerInfo> = {
  bigPockets: {
    name: 'Big Pockets',
    blurb: 'Every pocket swallows balls from further out this shot.',
    glyph: '🕳️',
    color: '#39d98a',
  },
  bomb: {
    name: 'Bomb',
    blurb: 'Your first contact explodes and blasts nearby balls outward.',
    glyph: '💣',
    color: '#ff6b4a',
  },
  double: {
    name: 'Double Points',
    blurb: 'Everything you pot this shot scores twice.',
    glyph: '✖️',
    color: '#ffc542',
  },
  guide: {
    name: 'Long Guide',
    blurb: 'See the full path, rebounds and all, for this shot.',
    glyph: '🔭',
    color: '#4fc3ff',
  },
  extra: {
    name: 'Extra Shot',
    blurb: 'Keep the table this visit even if you miss.',
    glyph: '🔁',
    color: '#b57bff',
  },
  freeze: {
    name: 'Freeze',
    blurb: "The next player's aim guide goes dark for their turn.",
    glyph: '🧊',
    color: '#9be7ff',
  },
};

export interface Orb {
  id: number;
  power: PowerId;
  pos: Vec2;
  /** Stays on the list once taken so the client can animate it away. */
  taken: boolean;
}

/** Effects the physics step itself has to know about. */
export interface PhysicsMods {
  bigPockets: boolean;
  bomb: boolean;
}

/** Radius of an orb on the cloth. Generous — hunting for a pixel isn't the fun part. */
export const ORB_RADIUS = BALL_RADIUS * 1.5;
/** How much further out a Big Pocket reaches. */
export const BIG_POCKET_BONUS = BALL_RADIUS * 1.6;
/** Reach of the bomb blast, in table units. */
export const BOMB_RADIUS = BALL_DIAMETER * 6;
/** Speed given to a ball right at the centre of the blast. */
export const BOMB_SPEED = 1500;
/** Most powers one player can hold. */
export const MAX_HELD_POWERS = 3;
/** Orbs kept on the cloth. */
export const ORBS_ON_TABLE = 3;

export interface PowerState {
  orbs: Orb[];
  /** Powers each seat is holding, oldest first. */
  held: Record<Seat, PowerId[]>;
  /** What the current shooter has armed for the shot in front of them. */
  armed: PowerId | null;
  /** Seats whose next turn has no aim guide. */
  frozen: Seat[];
  nextOrbId: number;
  /** Turn on which each seat last changed score — breaks a tie on a cleared table. */
  reachedAt?: Record<Seat, number>;
}

export function emptyPowerState(): PowerState {
  return { orbs: [], held: {}, armed: null, frozen: [], nextOrbId: 1, reachedAt: {} };
}

/** Orbs the cue ball at `pos` is currently touching. */
export function orbsUnder(orbs: Orb[], pos: Vec2): Orb[] {
  const reach = ORB_RADIUS + BALL_RADIUS;
  return orbs.filter((o) => !o.taken && hypot2(o.pos.x - pos.x, o.pos.y - pos.y) <= reach);
}

/** The physics part of an armed power. */
export function physicsModsFor(armed: PowerId | null): PhysicsMods {
  return { bigPockets: armed === 'bigPockets', bomb: armed === 'bomb' };
}

/**
 * Tops the cloth back up to `ORBS_ON_TABLE`.
 *
 * Orbs keep clear of balls, pockets and each other, so none is collected by accident or sits
 * where the cue ball can never go. `rand` is injected so the host's seeded generator decides —
 * clients receive the result in state and never roll anything themselves.
 */
export function refillOrbs(state: PowerState, balls: readonly Ball[], rand: () => number): Orb[] {
  const live = state.orbs.filter((o) => !o.taken);
  const added: Orb[] = [];
  const margin = ORB_RADIUS * 2.5;
  for (let attempt = 0; attempt < 400 && live.length + added.length < ORBS_ON_TABLE; attempt++) {
    const pos = {
      x: margin + rand() * (TABLE_LENGTH - margin * 2),
      y: margin + rand() * (TABLE_WIDTH - margin * 2),
    };
    if (pocketContaining(pos)) continue;
    const nearPocket = POCKETS.some((p) => hypot2(p.mid.x - pos.x, p.mid.y - pos.y) < BALL_DIAMETER * 3);
    if (nearPocket) continue;
    const clash = balls.some(
      (b) => !b.pocketed && hypot2(b.pos.x - pos.x, b.pos.y - pos.y) < ORB_RADIUS + BALL_DIAMETER
    );
    if (clash) continue;
    const crowded = [...live, ...added].some(
      (o) => hypot2(o.pos.x - pos.x, o.pos.y - pos.y) < ORB_RADIUS * 6
    );
    if (crowded) continue;
    const power = POWER_IDS[Math.floor(rand() * POWER_IDS.length) % POWER_IDS.length];
    added.push({ id: state.nextOrbId++, power, pos, taken: false });
  }
  state.orbs = [...live, ...added];
  return added;
}

/** Point value of a ball in Power Pool. The 8 is the prize. */
export function ballPoints(id: number): number {
  if (id === CUE_BALL_ID) return 0;
  return id === 8 ? 3 : 1;
}
