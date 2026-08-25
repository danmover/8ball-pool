import { Graphics } from 'pixi.js';
import type { TableTheme } from './tableThemes';

/**
 * The room each table lives in, drawn behind the table in screen space.
 *
 * Drawn from **directly above**, like the table itself. That is the whole point of this file's
 * second draft: these rooms used to be drawn in elevation — a wall band with hanging lamps, a
 * floor band below it, pictures at eye level — while the table was drawn as a plan view. Two
 * incompatible viewpoints on one screen, which is why the result looked wrong no matter how
 * carefully any individual prop was drawn. Nothing was fixable prop by prop; the camera was the
 * problem.
 *
 * So: floor fills the frame, a lamp is a pool of light cast *on* that floor, and every prop is
 * the shape you would see looking down on it — chairs as rings, cues as long slivers, a rug
 * under the table. Everything is flat-shaded with the same crisp ink outlines the balls and cue
 * carry, so the rooms read as detailed cartoon sets rather than attempts at realism.
 *
 * Drawn once per resize/theme change into a single Graphics — never per frame.
 */

const INK = 0x140f0a;

/** The table's footprint on screen, so props can be arranged around it rather than under it. */
export interface TableRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Ctx {
  g: Graphics;
  w: number;
  h: number;
  table: TableRect;
  rand: () => number;
}

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** Filled shape with the house ink outline. */
function shape(g: Graphics, draw: (g: Graphics) => void, fill: number, outline = 0, alpha = 1): void {
  if (outline) {
    draw(g);
    g.stroke({ width: outline, color: INK, alpha: 0.85 });
  }
  draw(g);
  g.fill({ color: fill, alpha });
}

// ---------------------------------------------------------------- floors

/** Boards running the length of the room, with the odd knot and a seam every few planks. */
function plankFloor(c: Ctx, base: number, dark: number, light: number, pitch = 54): void {
  const { g, w, h, rand } = c;
  g.rect(0, 0, w, h).fill({ color: base });
  for (let y = 0; y < h; y += pitch) {
    g.rect(0, y, w, pitch * 0.5).fill({ color: light, alpha: 0.35 });
    g.rect(0, y, w, 2).fill({ color: dark, alpha: 0.6 });
    // Butt joints, staggered row to row so it doesn't read as a grid.
    for (let x = (rand() * 400) | 0; x < w; x += 260 + rand() * 320) {
      g.rect(x, y, 3, pitch).fill({ color: dark, alpha: 0.5 });
    }
    if (rand() > 0.72) {
      g.ellipse(rand() * w, y + pitch * 0.5, 7, 4).fill({ color: dark, alpha: 0.45 });
    }
  }
}

/** Square tiles with grout, offset row to row. */
function tileFloor(c: Ctx, grout: number, a: number, b: number, size = 62): void {
  const { g, w, h } = c;
  g.rect(0, 0, w, h).fill({ color: grout });
  let row = 0;
  for (let y = -size; y < h; y += size, row++) {
    for (let x = row % 2 ? -size / 2 : 0; x < w; x += size) {
      g.roundRect(x + 3, y + 3, size - 6, size - 6, 5).fill({ color: row % 2 ? a : b });
      g.roundRect(x + 3, y + 3, size - 6, size - 6, 5).stroke({ width: 1.5, color: grout, alpha: 0.5 });
    }
  }
}

/**
 * A pool of light on the floor, as a lamp over the table would actually cast it.
 *
 * Kept tight and faint on purpose. The first version spread six near-full-screen ellipses at
 * 5% each across the whole canvas, which washed every floor to a flat pastel — the shag carpet
 * came out plain orange and the plank floor vanished entirely. A lamp lights the table and a
 * ring of floor around it, and leaves the rest of the room dim; that contrast is the effect.
 */
function lightPool(c: Ctx, color: number, strength = 1): void {
  const { g, table } = c;
  const cx = table.x + table.w / 2;
  const cy = table.y + table.h / 2;
  for (let i = 5; i >= 1; i--) {
    const f = i / 5;
    g.ellipse(cx, cy, table.w * (0.5 + f * 0.22), table.h * (0.62 + f * 0.34)).fill({
      color,
      alpha: 0.03 * strength,
    });
  }
}

/**
 * Darkens the outer edge of the room so the lit table stays the centre of attention.
 *
 * Reaches only a little way in. At a third of the short side it swallowed the very band of
 * floor the furniture stands on — the chairs were being drawn correctly and then crushed to
 * the same value as the boards under them.
 */
function falloff(c: Ctx, strength = 1): void {
  const { g, w, h } = c;
  const BANDS = 9;
  for (let i = 0; i < BANDS; i++) {
    const inset = (i / BANDS) * Math.min(w, h) * 0.13;
    const t = 3 + inset * 0.5;
    const alpha = 0.05 * strength;
    g.rect(0, inset, w, t).fill({ color: 0x000000, alpha });
    g.rect(0, h - inset - t, w, t).fill({ color: 0x000000, alpha });
    g.rect(inset, 0, t, h).fill({ color: 0x000000, alpha });
    g.rect(w - inset - t, 0, t, h).fill({ color: 0x000000, alpha });
  }
}

/** The shadow the table casts on the floor, offset the way the light falls. */
function tableShadow(c: Ctx, alpha = 0.4): void {
  const { g, table } = c;
  for (let i = 4; i >= 1; i--) {
    const spread = i * 9;
    g.roundRect(
      table.x - spread + 10,
      table.y - spread + 16,
      table.w + spread * 2,
      table.h + spread * 2,
      26 + spread
    ).fill({ color: 0x000000, alpha: (alpha * 0.3) / i });
  }
}

// ---------------------------------------------------------------- props (all from above)

/** A chair seen from above: seat plate with the back rail across one edge. */
function chair(c: Ctx, x: number, y: number, r: number, seat: number, angle = 0): void {
  const { g } = c;
  // Back rail first, so the seat overlaps it the way it does in life.
  const bx = x + Math.cos(angle) * r * 0.95;
  const by = y + Math.sin(angle) * r * 0.95;
  const long = r * 1.15;
  const short = r * 0.42;
  const horizontal = Math.abs(Math.cos(angle)) > 0.5;
  shape(
    g,
    (gg) =>
      gg.roundRect(
        bx - (horizontal ? short : long),
        by - (horizontal ? long : short),
        (horizontal ? short : long) * 2,
        (horizontal ? long : short) * 2,
        6
      ),
    seat,
    3
  );
  shape(g, (gg) => gg.roundRect(x - r, y - r, r * 2, r * 2, r * 0.42), seat, 3);
  // A lighter panel inset on the seat, so it isn't a flat blob.
  g.roundRect(x - r * 0.62, y - r * 0.62, r * 1.24, r * 1.24, r * 0.3).fill({
    color: 0xffffff,
    alpha: 0.1,
  });
  g.roundRect(x - r * 0.62, y - r * 0.62, r * 1.24, r * 1.24, r * 0.3).stroke({
    width: 1.5,
    color: INK,
    alpha: 0.25,
  });
}

/** A stool: just a disc and a ring, which is all you can see of one from up here. */
function stool(c: Ctx, x: number, y: number, r: number, top: number): void {
  shape(c.g, (gg) => gg.circle(x, y, r), top, 3);
  c.g.circle(x, y, r * 0.62).stroke({ width: 2, color: INK, alpha: 0.3 });
}

/** A cue lying on the floor: butt, wrap, shaft and tip, tapering along its length. */
function cue(c: Ctx, x: number, y: number, len: number, angle: number, wood: number): void {
  const { g } = c;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const at = (t: number): [number, number] => [x + dx * len * t, y + dy * len * t];
  g.moveTo(...at(0)).lineTo(...at(1)).stroke({ width: 8, color: INK, alpha: 0.5, cap: 'round' });
  g.moveTo(...at(0)).lineTo(...at(0.42)).stroke({ width: 6, color: 0x2a1c12, cap: 'round' });
  g.moveTo(...at(0.42)).lineTo(...at(0.96)).stroke({ width: 4.5, color: wood, cap: 'round' });
  g.moveTo(...at(0.96)).lineTo(...at(1)).stroke({ width: 4, color: 0x5aa9d8, cap: 'round' });
}

/** A drinks glass from above: rim, liquid, and a highlight. */
function glass(c: Ctx, x: number, y: number, r: number, liquid: number): void {
  const { g } = c;
  shape(g, (gg) => gg.circle(x, y, r), 0xd8e8f0, 2.5, 0.9);
  g.circle(x, y, r * 0.72).fill({ color: liquid, alpha: 0.9 });
  g.circle(x - r * 0.3, y - r * 0.3, r * 0.22).fill({ color: 0xffffff, alpha: 0.55 });
}

/** A cube of chalk, lid open. */
function chalk(c: Ctx, x: number, y: number, s: number, color: number): void {
  shape(c.g, (gg) => gg.roundRect(x, y, s, s, 2), color, 2.5);
  c.g.roundRect(x + s * 0.18, y + s * 0.18, s * 0.64, s * 0.64, 1.5).fill({
    color: 0x000000,
    alpha: 0.22,
  });
}

/** The triangle, left leaning on the floor. */
function triangleRack(c: Ctx, x: number, y: number, s: number, color: number): void {
  const { g } = c;
  const pts = [x, y - s, x + s * 0.87, y + s * 0.5, x - s * 0.87, y + s * 0.5];
  g.poly(pts).stroke({ width: 9, color: INK, alpha: 0.5 });
  g.poly(pts).stroke({ width: 6, color });
}

/**
 * A rug beneath the table, with a woven border.
 *
 * Only a little larger than the table. Sized generously it simply became the floor, which
 * defeats the point of having drawn a floor.
 */
function rug(c: Ctx, fill: number, border: number, pattern?: number): void {
  const { g, table, w, h } = c;
  const rx = Math.max(6, table.x - table.w * 0.05);
  const ry = Math.max(6, table.y - table.h * 0.12);
  const rw = Math.min(w - rx - 6, table.w * 1.1);
  const rh = Math.min(h - ry - 6, table.h * 1.24);
  shape(g, (gg) => gg.roundRect(rx, ry, rw, rh, 14), fill, 4);
  g.roundRect(rx + 14, ry + 14, rw - 28, rh - 28, 8).stroke({ width: 5, color: border, alpha: 0.85 });
  g.roundRect(rx + 26, ry + 26, rw - 52, rh - 52, 6).stroke({ width: 2, color: border, alpha: 0.5 });
  if (pattern !== undefined) {
    for (let x = rx + 40; x < rx + rw - 40; x += 56) {
      g.poly([x, ry + 20, x + 12, ry + 32, x, ry + 44, x - 12, ry + 32]).fill({ color: pattern, alpha: 0.5 });
      g.poly([x, ry + rh - 20, x + 12, ry + rh - 32, x, ry + rh - 44, x - 12, ry + rh - 32]).fill({
        color: pattern,
        alpha: 0.5,
      });
    }
  }
}

/**
 * Where props can go: the four bands of floor the table doesn't cover.
 *
 * Everything decorative goes through here, because a chair drawn under the table is invisible
 * and a chair drawn over it is a bug.
 */
function margins(c: Ctx): { left: number; right: number; top: number; bottom: number } {
  return {
    left: c.table.x,
    right: c.w - (c.table.x + c.table.w),
    top: c.table.y,
    bottom: c.h - (c.table.y + c.table.h),
  };
}

// ---------------------------------------------------------------- scenes

/** Old-school pool hall: board floor, rug, chairs and a cue or two left lying about. */
function classicHall(c: Ctx): void {
  const { g, w, h, table, rand } = c;
  plankFloor(c, 0x2b2015, 0x160d06, 0x3b2c1c);
  // Deep red, deliberately not green: a green rug under a green table left the whole screen
  // one colour and the table with no edge to sit against.
  rug(c, 0x5a2028, 0xc9a15e, 0x8a3040);
  tableShadow(c);
  lightPool(c, 0xffe9a8, 1.15);

  const m = margins(c);
  // Chairs down whichever side has room for them.
  if (m.left > 70) {
    for (const y of [table.y + table.h * 0.24, table.y + table.h * 0.72]) {
      chair(c, m.left * 0.48, y, Math.min(30, m.left * 0.32), 0xa8683a, Math.PI);
    }
  }
  if (m.right > 70) {
    for (const y of [table.y + table.h * 0.34, table.y + table.h * 0.8]) {
      chair(c, w - m.right * 0.48, y, Math.min(30, m.right * 0.32), 0xa8683a, 0);
    }
  }
  // Cues left on the floor at the head of the table, plus the small change of a game.
  if (m.top > 60) {
    cue(c, w * 0.2, m.top * 0.42, 210, 0.16, 0xc99a63);
    cue(c, w * 0.26, m.top * 0.66, 210, 0.05, 0xa8763f);
    chalk(c, w * 0.52, m.top * 0.5, 15, 0x2f6f45);
    triangleRack(c, w * 0.72, m.top * 0.52, 26, 0xc99a63);
  }
  if (m.bottom > 60) {
    glass(c, w * 0.3, h - m.bottom * 0.45, 13, 0xc98a2e);
    glass(c, w * 0.34, h - m.bottom * 0.62, 11, 0xc98a2e);
  }
  // A few scuffs so the floor isn't perfectly clean.
  for (let i = 0; i < 24; i++) {
    g.ellipse(rand() * w, rand() * h, 10 + rand() * 26, 3).fill({ color: 0x000000, alpha: 0.07 });
  }
  falloff(c, 1.2);
}

/** Late-night lounge: dark boards, neon spill across the floor, stools pulled up. */
function midnightLounge(c: Ctx): void {
  const { g, w, h, table } = c;
  plankFloor(c, 0x111a26, 0x080d14, 0x1a2634, 46);
  tableShadow(c, 0.55);

  // Light thrown across the floor from a window and a sign somewhere off-frame. Long soft
  // parallelograms, the way spill actually lands on a floor seen from above.
  for (const [x, tint, wide] of [
    [w * 0.1, 0x7ec8ff, 120],
    [w * 0.2, 0x7ec8ff, 90],
    [w * 0.82, 0xff5fa2, 130],
  ] as const) {
    g.poly([x, 0, x + wide, 0, x + wide + 140, h, x + 140, h]).fill({ color: tint, alpha: 0.05 });
  }
  lightPool(c, 0x9fd8ff, 1.1);

  const m = margins(c);
  if (m.top > 60) {
    for (const x of [w * 0.3, w * 0.4, w * 0.62]) stool(c, x, m.top * 0.5, Math.min(22, m.top * 0.3), 0x3a6a94);
    glass(c, w * 0.5, m.top * 0.5, 12, 0x2ee6ff);
  }
  if (m.bottom > 60) {
    stool(c, w * 0.24, h - m.bottom * 0.5, 20, 0x3a6a94);
    cue(c, w * 0.56, h - m.bottom * 0.5, 200, -0.08, 0x3d5a72);
  }
  if (m.left > 60) chair(c, m.left * 0.5, table.y + table.h * 0.5, Math.min(26, m.left * 0.3), 0x33587c, Math.PI);
  falloff(c, 1.5);
}

/** Velvet club: patterned carpet wall to wall, gilt chairs, a chandelier's pool of light. */
function crimsonClub(c: Ctx): void {
  const { g, w, h, table } = c;
  g.rect(0, 0, w, h).fill({ color: 0x2b0f14 });
  // Damask, laid flat as carpet rather than hung as wallpaper.
  for (let y = 0; y < h + 64; y += 64) {
    for (let x = ((y / 64) % 2) * 40; x < w + 40; x += 80) {
      g.poly([x, y, x + 26, y + 28, x, y + 56, x - 26, y + 28]).stroke({
        width: 2,
        color: 0x6e2530,
        alpha: 0.8,
      });
      g.circle(x, y + 28, 5).fill({ color: 0x8a3040, alpha: 0.7 });
    }
  }
  rug(c, 0x4d1a24, 0xd9a441, 0x8a3040);
  tableShadow(c, 0.5);
  lightPool(c, 0xffd08a, 1.3);

  const m = margins(c);
  if (m.left > 70) {
    for (const y of [table.y + table.h * 0.28, table.y + table.h * 0.7]) {
      chair(c, m.left * 0.5, y, Math.min(30, m.left * 0.32), 0xb8384c, Math.PI);
    }
  }
  if (m.right > 70) {
    for (const y of [table.y + table.h * 0.3, table.y + table.h * 0.74]) {
      chair(c, w - m.right * 0.5, y, Math.min(30, m.right * 0.32), 0xb8384c, 0);
    }
  }
  if (m.top > 60) {
    glass(c, w * 0.36, m.top * 0.5, 13, 0x8a1d2c);
    glass(c, w * 0.41, m.top * 0.62, 11, 0x8a1d2c);
    triangleRack(c, w * 0.68, m.top * 0.52, 26, 0xd9a441);
  }
  if (m.bottom > 60) cue(c, w * 0.34, h - m.bottom * 0.5, 220, 0.04, 0x8a6a2a);
  falloff(c, 1.3);
}

/** Sunlit patio: terracotta tiles, planters, hard bright light and plant shadows. */
function sandstonePatio(c: Ctx): void {
  const { g, w, h, table, rand } = c;
  tileFloor(c, 0x6b4527, 0x9c6440, 0xa87049, 66);
  tableShadow(c, 0.45);
  lightPool(c, 0xfff0b8, 1.4);

  const m = margins(c);
  /** A potted plant from above: rim, soil, and leaves radiating out. */
  const planter = (x: number, y: number, r: number): void => {
    // Shadow first, thrown clear of the pot since the light here is high and hard.
    g.ellipse(x + r * 0.45, y + r * 0.5, r * 1.15, r * 0.8).fill({ color: 0x000000, alpha: 0.14 });
    // Leaves under the rim, so the plant sits *in* the pot rather than on top of it. Short and
    // broad: long thin strokes radiating out just read as a scribble at this size.
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + rand() * 0.2;
      const len = r * (0.95 + rand() * 0.35);
      g.moveTo(x, y)
        .quadraticCurveTo(
          x + Math.cos(a + 0.35) * len * 0.65,
          y + Math.sin(a + 0.35) * len * 0.65,
          x + Math.cos(a) * len,
          y + Math.sin(a) * len
        )
        .stroke({ width: 9, color: INK, alpha: 0.35, cap: 'round' });
      g.moveTo(x, y)
        .quadraticCurveTo(
          x + Math.cos(a + 0.35) * len * 0.65,
          y + Math.sin(a + 0.35) * len * 0.65,
          x + Math.cos(a) * len,
          y + Math.sin(a) * len
        )
        .stroke({ width: 6, color: i % 2 ? 0x4f8a3a : 0x67a84e, cap: 'round' });
    }
    shape(g, (gg) => gg.circle(x, y, r * 0.72), 0xb5713f, 3);
    g.circle(x, y, r * 0.52).fill({ color: 0x4a2f1c });
    g.circle(x, y, r * 0.72).stroke({ width: 3, color: 0xd08b52, alpha: 0.7 });
  };

  if (m.left > 70) {
    planter(m.left * 0.5, table.y + table.h * 0.2, Math.min(26, m.left * 0.3));
    planter(m.left * 0.5, table.y + table.h * 0.78, Math.min(24, m.left * 0.28));
  }
  if (m.right > 70) planter(w - m.right * 0.5, table.y + table.h * 0.5, Math.min(28, m.right * 0.3));
  if (m.top > 60) {
    for (const x of [w * 0.3, w * 0.66]) chair(c, x, m.top * 0.48, Math.min(26, m.top * 0.3), 0xd9a441, -Math.PI / 2);
    glass(c, w * 0.48, m.top * 0.5, 12, 0xf0c454);
  }
  if (m.bottom > 60) cue(c, w * 0.3, h - m.bottom * 0.5, 210, 0.06, 0xd9a441);
  falloff(c, 0.9);
}

/** Arcade: a glowing floor grid, light bleeding up from underneath. */
function neonArcade(c: Ctx): void {
  const { g, w, h, table, rand } = c;
  g.rect(0, 0, w, h).fill({ color: 0x0a0618 });

  // A true grid, not a perspective one — we are looking straight down at it now.
  for (let x = 0; x <= w; x += 58) {
    g.rect(x - 1, 0, 2, h).fill({ color: 0xb44dff, alpha: 0.28 });
  }
  for (let y = 0; y <= h; y += 58) {
    g.rect(0, y - 1, w, 2).fill({ color: 0x5ffbf1, alpha: 0.22 });
  }
  // A scatter of lit cells, so the floor pulses rather than being uniform.
  for (let i = 0; i < 40; i++) {
    const gx = Math.floor(rand() * (w / 58)) * 58;
    const gy = Math.floor(rand() * (h / 58)) * 58;
    g.rect(gx + 2, gy + 2, 54, 54).fill({ color: rand() > 0.5 ? 0x5ffbf1 : 0xff2e6a, alpha: 0.07 });
  }

  tableShadow(c, 0.7);
  // Neon doesn't pool warmly; it rings. A bright halo hugging the table instead.
  for (let i = 5; i >= 1; i--) {
    g.roundRect(
      table.x - i * 13,
      table.y - i * 13,
      table.w + i * 26,
      table.h + i * 26,
      20 + i * 10
    ).stroke({ width: 5, color: 0x5ffbf1, alpha: 0.05 });
  }

  const m = margins(c);
  if (m.top > 60) {
    // Floor-mounted light bars, glowing.
    for (const [x, col] of [
      [w * 0.22, 0xff2e6a],
      [w * 0.5, 0xffee32],
      [w * 0.76, 0x5ffbf1],
    ] as const) {
      g.roundRect(x - 70, m.top * 0.42, 140, 12, 6).fill({ color: col, alpha: 0.2 });
      g.roundRect(x - 70, m.top * 0.46, 140, 5, 3).fill({ color: col, alpha: 0.95 });
    }
  }
  if (m.bottom > 60) {
    for (const x of [w * 0.3, w * 0.68]) {
      g.roundRect(x - 60, h - m.bottom * 0.5, 120, 5, 3).fill({ color: 0xb44dff, alpha: 0.9 });
    }
  }
  if (m.left > 60) stool(c, m.left * 0.5, table.y + table.h * 0.5, Math.min(22, m.left * 0.3), 0x241a3d);
  if (m.right > 60) stool(c, w - m.right * 0.5, table.y + table.h * 0.5, Math.min(22, m.right * 0.3), 0x241a3d);
  falloff(c, 1.6);
}

/** Frozen cavern: cracked ice underfoot, drifts of snow, cold light. */
function iceCavern(c: Ctx): void {
  const { g, w, h, table, rand } = c;
  g.rect(0, 0, w, h).fill({ color: 0x6e97ae });

  // Facets of ice, as irregular plates rather than a wall of prisms.
  for (let i = 0; i < 46; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const r = 60 + rand() * 130;
    const pts: number[] = [];
    const sides = 5 + Math.floor(rand() * 3);
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2;
      const rr = r * (0.6 + rand() * 0.5);
      pts.push(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    g.poly(pts).fill({ color: rand() > 0.5 ? 0xa8cddd : 0x9cc3d6, alpha: 0.55 });
    g.poly(pts).stroke({ width: 1.5, color: 0xdff0f8, alpha: 0.4 });
  }
  // Cracks running across the surface.
  for (let i = 0; i < 14; i++) {
    let x = rand() * w;
    let y = rand() * h;
    g.moveTo(x, y);
    for (let k = 0; k < 5; k++) {
      x += (rand() - 0.5) * 180;
      y += (rand() - 0.5) * 180;
      g.lineTo(x, y);
    }
    g.stroke({ width: 1.5, color: 0x5f8ba3, alpha: 0.4 });
  }

  // Snow drifted into the corners.
  for (const [x, y, rx, ry] of [
    [0, 0, w * 0.3, h * 0.22],
    [w, h, w * 0.34, h * 0.24],
    [w, 0, w * 0.22, h * 0.18],
  ] as const) {
    g.ellipse(x, y, rx, ry).fill({ color: 0xffffff, alpha: 0.75 });
  }

  tableShadow(c, 0.3);
  lightPool(c, 0xdff0f8, 1.5);

  const m = margins(c);
  if (m.top > 60) triangleRack(c, w * 0.7, m.top * 0.5, 26, 0xdff0f8);
  if (m.bottom > 60) cue(c, w * 0.3, h - m.bottom * 0.5, 210, 0.05, 0xcfe9f5);
  if (m.left > 60) stool(c, m.left * 0.5, table.y + table.h * 0.5, Math.min(24, m.left * 0.3), 0xd8cbb8);
  // Frost sparkle.
  for (let i = 0; i < 70; i++) {
    g.circle(rand() * w, rand() * h, rand() * 1.8 + 0.6).fill({ color: 0xffffff, alpha: 0.5 });
  }
  falloff(c, 0.8);
}

/** 70s rec room: shag carpet, a starburst rug, chunky furniture. */
function vintageRec(c: Ctx): void {
  const { g, w, h, table, rand } = c;
  g.rect(0, 0, w, h).fill({ color: 0x4a4e22 });
  // Shag: dense short strokes in every direction, which is what it looks like from above.
  for (let i = 0; i < 2600; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const a = rand() * Math.PI * 2;
    g.moveTo(x, y)
      .lineTo(x + Math.cos(a) * 7, y + Math.sin(a) * 7)
      .stroke({ width: 2, color: rand() > 0.5 ? 0x808a3e : 0x5a602a, alpha: 0.7 });
  }

  // Starburst rug under the table — the clock off the old wall, laid on the floor. Kept inside
  // the table's own footprint plus a margin, or it stops being a rug and becomes the floor.
  const cx = table.x + table.w / 2;
  const cy = table.y + table.h / 2;
  const rx = table.w * 0.56;
  const ry = table.h * 0.72;
  g.ellipse(cx, cy, rx, ry).fill({ color: 0x7a4a1e });
  g.ellipse(cx, cy, rx, ry).stroke({ width: 5, color: INK, alpha: 0.6 });
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const outer = i % 2 ? 0.7 : 0.94;
    g.moveTo(cx + Math.cos(a) * rx * 0.3, cy + Math.sin(a) * ry * 0.3)
      .lineTo(cx + Math.cos(a) * rx * outer, cy + Math.sin(a) * ry * outer)
      .stroke({ width: 7, color: 0xe0c47a, alpha: 0.7, cap: 'round' });
  }

  tableShadow(c, 0.45);
  lightPool(c, 0xffb45c, 1.2);

  const m = margins(c);
  if (m.left > 70) {
    chair(c, m.left * 0.5, table.y + table.h * 0.3, Math.min(30, m.left * 0.32), 0xd8873a, Math.PI);
    chair(c, m.left * 0.5, table.y + table.h * 0.74, Math.min(28, m.left * 0.3), 0xb5652a, Math.PI);
  }
  if (m.right > 70) chair(c, w - m.right * 0.5, table.y + table.h * 0.5, Math.min(30, m.right * 0.32), 0xd8873a, 0);
  if (m.top > 60) {
    glass(c, w * 0.42, m.top * 0.5, 13, 0xb5652a);
    chalk(c, w * 0.56, m.top * 0.5, 15, 0x5a602a);
    triangleRack(c, w * 0.72, m.top * 0.52, 26, 0xe0c47a);
  }
  if (m.bottom > 60) cue(c, w * 0.32, h - m.bottom * 0.5, 215, -0.05, 0xc99a63);
  falloff(c, 1.1);
}

const SCENES: Record<string, (c: Ctx) => void> = {
  classic: classicHall,
  midnight: midnightLounge,
  crimson: crimsonClub,
  sandstone: sandstonePatio,
  neon: neonArcade,
  ice: iceCavern,
  vintage: vintageRec,
};

/**
 * Paints the room for `theme` across a `w × h` canvas. `table` is the table's footprint on
 * screen, so the floor can be arranged around it and nothing is drawn where it can't be seen.
 */
export function drawScene(
  g: Graphics,
  theme: TableTheme,
  w: number,
  h: number,
  table: TableRect
): void {
  g.clear();
  if (w <= 0 || h <= 0) return;

  const ctx: Ctx = {
    g,
    w,
    h,
    table,
    // Seeded from the theme id so a room's clutter stays put across resizes.
    rand: seeded(theme.id.split('').reduce((a, ch) => a + ch.charCodeAt(0), 7)),
  };

  (SCENES[theme.id] ?? classicHall)(ctx);
}
