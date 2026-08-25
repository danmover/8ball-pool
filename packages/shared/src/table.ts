import { Vec2 } from './vector.js';
import {
  BALL_RADIUS,
  CORNER_MOUTH,
  JAW_RADIUS,
  SIDE_MOUTH,
  TABLE_LENGTH,
  TABLE_WIDTH,
} from './constants.js';

/**
 * The table's playing geometry, in one place.
 *
 * This module exists because the simulation and the picture used to disagree. The renderer drew
 * corner pockets with a ~99-unit mouth and side pockets with a 116-unit mouth, while the physics
 * ran an unbroken cushion wall along the *entire* rail — straight across every pocket — and only
 * dropped a ball when its centre came within 39 units of a point. A ball rolling through the
 * visual middle of a corner mouth is 59 units from that point, so it hit a wall that wasn't drawn
 * anywhere and bounced back out. That is the "it looked like it went in" bug.
 *
 * Now there is one description of where the cushions are and where the holes are, and physics,
 * the aim guide, the bot and the renderer all read it. They cannot drift apart again.
 */

/** A straight run of cushion, as the *nose* line the ball actually rebounds off. */
export interface CushionSegment {
  /** 'h' runs along x at a fixed y; 'v' runs along y at a fixed x. */
  axis: 'h' | 'v';
  /** The nose line's position on the other axis. */
  base: number;
  /** -1 for the top/left cushion (play is at +base), +1 for bottom/right. */
  side: -1 | 1;
  /** Extent along `axis`, ordered low to high. */
  from: number;
  to: number;
}

/**
 * A pocket, described by its mouth rather than as a circle.
 *
 * `a` and `b` are the jaw tips on the nose line; a ball is in the pocket once its centre crosses
 * the chord between them heading outward. `capture` is where it comes to rest in the bag, used
 * for the drop animation and for aiming at the pocket.
 */
export interface Pocket {
  index: number;
  kind: 'corner' | 'side';
  a: Vec2;
  b: Vec2;
  /** Outward unit normal of the mouth chord — away from the playing surface. */
  out: Vec2;
  /** Chord midpoint. */
  mid: Vec2;
  /** Rest point inside the bag. */
  capture: Vec2;
  /** Half the mouth width, i.e. |a-b|/2. Bigger mouth, easier pot. */
  halfWidth: number;
}

/** Where the cushion nose meets a pocket mouth. Balls rattle off these. */
export interface Jaw {
  /** Circle centre, set back into the rail by JAW_RADIUS so it is tangent to the nose line. */
  pos: Vec2;
  radius: number;
}

const L = TABLE_LENGTH;
const W = TABLE_WIDTH;
const MID = L / 2;

/**
 * Six cushion runs. The short rails carry one each; the long rails are split by the side
 * pockets, so they carry two. Everything between them is open — that is the point.
 */
export const CUSHIONS: CushionSegment[] = [
  // Top rail (y = 0), split by the top side pocket.
  { axis: 'h', base: 0, side: -1, from: CORNER_MOUTH, to: MID - SIDE_MOUTH },
  { axis: 'h', base: 0, side: -1, from: MID + SIDE_MOUTH, to: L - CORNER_MOUTH },
  // Bottom rail (y = W).
  { axis: 'h', base: W, side: 1, from: CORNER_MOUTH, to: MID - SIDE_MOUTH },
  { axis: 'h', base: W, side: 1, from: MID + SIDE_MOUTH, to: L - CORNER_MOUTH },
  // Short rails.
  { axis: 'v', base: 0, side: -1, from: CORNER_MOUTH, to: W - CORNER_MOUTH },
  { axis: 'v', base: L, side: 1, from: CORNER_MOUTH, to: W - CORNER_MOUTH },
];

/** How far past the mouth chord the ball settles. Purely cosmetic — it is already potted. */
const BAG_DEPTH = BALL_RADIUS * 1.6;

function pocket(index: number, kind: Pocket['kind'], a: Vec2, b: Vec2, out: Vec2): Pocket {
  const mid = Vec2.scale(Vec2.add(a, b), 0.5);
  return {
    index,
    kind,
    a,
    b,
    out,
    mid,
    capture: Vec2.add(mid, Vec2.scale(out, BAG_DEPTH)),
    halfWidth: Vec2.distance(a, b) / 2,
  };
}

const D = Math.SQRT1_2;

/**
 * The six pockets, as mouths between jaw tips.
 *
 * Corner mouths run diagonally across the corner between the two rails that end there; side
 * mouths run flat along the long rail. These are the *same* numbers the renderer draws the bags
 * with, which is the whole point of the module.
 */
export const POCKETS: Pocket[] = [
  pocket(0, 'corner', { x: CORNER_MOUTH, y: 0 }, { x: 0, y: CORNER_MOUTH }, { x: -D, y: -D }),
  pocket(1, 'side', { x: MID - SIDE_MOUTH, y: 0 }, { x: MID + SIDE_MOUTH, y: 0 }, { x: 0, y: -1 }),
  pocket(
    2,
    'corner',
    { x: L - CORNER_MOUTH, y: 0 },
    { x: L, y: CORNER_MOUTH },
    { x: D, y: -D }
  ),
  pocket(
    3,
    'corner',
    { x: 0, y: W - CORNER_MOUTH },
    { x: CORNER_MOUTH, y: W },
    { x: -D, y: D }
  ),
  pocket(
    4,
    'side',
    { x: MID - SIDE_MOUTH, y: W },
    { x: MID + SIDE_MOUTH, y: W },
    { x: 0, y: 1 }
  ),
  pocket(
    5,
    'corner',
    { x: L, y: W - CORNER_MOUTH },
    { x: L - CORNER_MOUTH, y: W },
    { x: D, y: D }
  ),
];

/**
 * Twelve jaw circles, two per cushion run.
 *
 * Set back into the rail by exactly their own radius so each circle is *tangent* to the nose
 * line. That tangency matters: it means a ball running down the rail slides past the jaw without
 * catching on it, while a ball arriving into the mouth at an angle clips the inside of the jaw
 * and rattles — which is what a real pocket does, and what a bare gap in a wall would not.
 */
export const JAWS: Jaw[] = CUSHIONS.flatMap((c) => {
  const back = c.base + JAW_RADIUS * c.side;
  const at = (along: number): Vec2 =>
    c.axis === 'h' ? { x: along, y: back } : { x: back, y: along };
  return [
    { pos: at(c.from), radius: JAW_RADIUS },
    { pos: at(c.to), radius: JAW_RADIUS },
  ];
});

/**
 * How far `point` sits past a pocket's mouth chord, positive meaning inside the bag.
 *
 * This single scalar replaces the old distance-to-a-point test. Crossing the chord is what
 * "went in" means, so the rule now matches the drawn mouth exactly.
 */
export function mouthDepth(pocket: Pocket, point: Vec2): number {
  return Vec2.dot(Vec2.sub(point, pocket.mid), pocket.out);
}

/** The pocket `point` has fallen into, or null if it is still on the table. */
export function pocketContaining(point: Vec2): Pocket | null {
  for (const p of POCKETS) {
    if (mouthDepth(p, point) < 0) continue;
    // Guard the ends: past the chord but wide of the jaws is off the side of the bag, which
    // only happens transiently while a ball is being pushed out of a jaw.
    const along = Vec2.sub(point, p.mid);
    const axis = Vec2.normalize(Vec2.sub(p.b, p.a));
    if (Math.abs(Vec2.dot(along, axis)) > p.halfWidth + BALL_RADIUS) continue;
    return p;
  }
  return null;
}

/**
 * Is `point` inside a pocket mouth's approach — the region where there is no cushion?
 *
 * Used by the aim guide so it stops drawing rebounds off cushions that do not exist there.
 */
export function inPocketApproach(point: Vec2, slack = BALL_RADIUS): boolean {
  return POCKETS.some((p) => {
    const along = Vec2.sub(point, p.mid);
    const axis = Vec2.normalize(Vec2.sub(p.b, p.a));
    const depth = Vec2.dot(along, p.out);
    return depth > -slack && Math.abs(Vec2.dot(along, axis)) < p.halfWidth + slack;
  });
}

/** The nearest point on a cushion segment's nose line to `p`, clamped to the run. */
export function closestOnCushion(c: CushionSegment, p: Vec2): Vec2 {
  const along = Math.max(c.from, Math.min(c.to, c.axis === 'h' ? p.x : p.y));
  return c.axis === 'h' ? { x: along, y: c.base } : { x: c.base, y: along };
}
