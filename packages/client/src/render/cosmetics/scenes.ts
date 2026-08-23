import { Graphics } from 'pixi.js';
import type { TableTheme } from './tableThemes';

/**
 * The room each table lives in, drawn behind the table in screen space.
 *
 * A table theme used to be a palette swap; this is what makes it a *place*. Everything is
 * flat-shaded with the same crisp ink outlines the balls and cue carry, so the scenes read as
 * detailed cartoon sets rather than attempts at realism.
 *
 * Drawn once per resize/theme change into a single Graphics — never per frame.
 */

const INK = 0x140f0a;

interface Ctx {
  g: Graphics;
  w: number;
  h: number;
  /** Where the table's top edge roughly sits, so scenery can sit behind rather than over it. */
  horizon: number;
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

/** Warm pool of light falling from a lamp onto the floor. */
function lampCone(c: Ctx, x: number, y: number, spread: number, reach: number, color: number): void {
  const { g } = c;
  for (let i = 3; i >= 1; i--) {
    const f = i / 3;
    g.poly([x, y, x - spread * f, y + reach, x + spread * f, y + reach]).fill({
      color,
      alpha: 0.07 * (4 - i),
    });
  }
}

/** A hanging billiard lamp: flex, shade, and the bulb glow under it. */
function hangingLamp(c: Ctx, x: number, shadeW: number, drop: number, shade: number, glow: number): void {
  const { g } = c;
  g.rect(x - 2, 0, 4, drop).fill({ color: INK });
  shape(
    g,
    (gg) => gg.poly([x - shadeW, drop + 34, x + shadeW, drop + 34, x + shadeW * 0.45, drop, x - shadeW * 0.45, drop]),
    shade,
    3
  );
  // Lit underside and the glow beneath the shade.
  g.ellipse(x, drop + 34, shadeW, 8).fill({ color: 0xfff0c0, alpha: 0.9 });
  g.circle(x, drop + 44, shadeW * 0.55).fill({ color: glow, alpha: 0.35 });
  lampCone(c, x, drop + 40, shadeW * 2.6, c.h, 0xffe9a8);
}

// ---------------------------------------------------------------- scenes

/** Old-school pool hall: plank floor, panelled wall, lamps over the table. */
function classicHall(c: Ctx): void {
  const { g, w, h, horizon } = c;
  const wall = horizon * 0.62;

  g.rect(0, 0, w, wall).fill({ color: 0x3a2c22 });
  // Wainscot panelling with a chair rail.
  for (let x = 0; x < w; x += 120) {
    shape(g, (gg) => gg.roundRect(x + 14, wall * 0.32, 92, wall * 0.52, 6), 0x46352a, 2);
  }
  g.rect(0, wall * 0.24, w, 12).fill({ color: 0x5c4430 });
  g.rect(0, wall - 14, w, 16).fill({ color: 0x5c4430 });

  // Framed pictures and a cue rack.
  for (const [fx, fw] of [
    [w * 0.12, 90],
    [w * 0.78, 110],
  ] as const) {
    shape(g, (gg) => gg.roundRect(fx, wall * 0.05, fw, wall * 0.16, 4), 0x8a6a3a, 3);
    g.roundRect(fx + 7, wall * 0.05 + 7, fw - 14, wall * 0.16 - 14, 2).fill({ color: 0x2c7a4c });
  }
  shape(g, (gg) => gg.roundRect(w * 0.44, wall * 0.04, 120, wall * 0.2, 5), 0x5c4430, 3);
  for (let i = 0; i < 4; i++) {
    g.rect(w * 0.46 + i * 26, wall * 0.05, 6, wall * 0.18).fill({ color: 0xc99a63 });
  }

  // Floorboards running away from the viewer.
  g.rect(0, wall, w, h - wall).fill({ color: 0x2a2018 });
  for (let y = wall; y < h; y += 26) {
    g.rect(0, y, w, 2).fill({ color: 0x000000, alpha: 0.25 });
  }
  for (let x = 0; x < w; x += 150) {
    g.rect(x, wall, 2, h - wall).fill({ color: 0x000000, alpha: 0.18 });
  }

  hangingLamp(c, w * 0.34, 54, wall * 0.1, 0x2f6f45, 0xffe9a8);
  hangingLamp(c, w * 0.66, 54, wall * 0.1, 0x2f6f45, 0xffe9a8);
}

/** Late-night lounge: city window, neon sign, dark panelling. */
function midnightLounge(c: Ctx): void {
  const { g, w, h, horizon, rand } = c;
  const wall = horizon * 0.66;

  g.rect(0, 0, w, wall).fill({ color: 0x141c28 });

  // Window onto a city at night.
  const wx = w * 0.06;
  const ww = w * 0.3;
  shape(g, (gg) => gg.roundRect(wx, wall * 0.08, ww, wall * 0.68, 8), 0x0b1520, 4);
  g.circle(wx + ww * 0.72, wall * 0.25, 26).fill({ color: 0xf2f0d8 });
  for (let i = 0; i < 9; i++) {
    const bx = wx + 14 + i * (ww / 9);
    const bh = wall * (0.18 + rand() * 0.34);
    g.rect(bx, wall * 0.76 - bh, ww / 11, bh).fill({ color: 0x1b2b40 });
    for (let k = 0; k < 5; k++) {
      if (rand() > 0.55) {
        g.rect(bx + 4, wall * 0.76 - bh + 8 + k * 12, 6, 6).fill({ color: 0xffe9a8, alpha: 0.85 });
      }
    }
  }
  g.roundRect(wx, wall * 0.08, ww, wall * 0.68, 8).stroke({ width: 6, color: 0x2a3a50 });

  // Neon sign on the far wall.
  const nx = w * 0.62;
  g.roundRect(nx - 10, wall * 0.16, 240, 86, 14).fill({ color: 0x0d1420 });
  g.roundRect(nx - 10, wall * 0.16, 240, 86, 14).stroke({ width: 3, color: INK });
  for (const [ox, oy, ow, oh] of [
    [16, 20, 60, 46],
    [92, 20, 46, 46],
    [154, 20, 62, 46],
  ] as const) {
    g.roundRect(nx + ox, wall * 0.16 + oy, ow, oh, 10).stroke({ width: 7, color: 0x7ec8ff, alpha: 0.25 });
    g.roundRect(nx + ox, wall * 0.16 + oy, ow, oh, 10).stroke({ width: 3, color: 0xbfe6ff });
  }

  // Bar stools in silhouette.
  for (const sx of [w * 0.46, w * 0.53]) {
    g.rect(sx - 3, wall - 70, 6, 70).fill({ color: 0x0a1018 });
    g.ellipse(sx, wall - 74, 22, 8).fill({ color: 0x0a1018 });
  }

  g.rect(0, wall, w, h - wall).fill({ color: 0x0d141d });
  for (let y = wall; y < h; y += 30) g.rect(0, y, w, 2).fill({ color: 0x000000, alpha: 0.3 });
  hangingLamp(c, w * 0.5, 60, wall * 0.06, 0x1f4a6e, 0x9fd8ff);
}

/** Velvet club: damask wall, sconces, chandelier, carpet. */
function crimsonClub(c: Ctx): void {
  const { g, w, h, horizon } = c;
  const wall = horizon * 0.64;

  g.rect(0, 0, w, wall).fill({ color: 0x3a151c });
  // Damask: a lattice of diamonds with a fleur at each crossing.
  for (let y = 0; y < wall; y += 64) {
    for (let x = ((y / 64) % 2) * 40; x < w; x += 80) {
      g.poly([x, y, x + 26, y + 28, x, y + 56, x - 26, y + 28]).stroke({
        width: 2,
        color: 0x6e2530,
        alpha: 0.9,
      });
      g.circle(x, y + 28, 5).fill({ color: 0x8a3040, alpha: 0.8 });
    }
  }
  g.rect(0, wall - 18, w, 20).fill({ color: 0x8a6a2a });

  // Wall sconces.
  for (const sx of [w * 0.16, w * 0.84]) {
    shape(g, (gg) => gg.roundRect(sx - 14, wall * 0.3, 28, 46, 8), 0xd9a441, 3);
    g.circle(sx, wall * 0.3, 20).fill({ color: 0xffe9a8, alpha: 0.5 });
    g.circle(sx, wall * 0.3, 34).fill({ color: 0xffc94d, alpha: 0.16 });
  }

  // Chandelier.
  const cx = w * 0.5;
  g.rect(cx - 2, 0, 4, 54).fill({ color: 0x8a6a2a });
  for (let i = -2; i <= 2; i++) {
    const dx = cx + i * 34;
    g.moveTo(cx, 54).lineTo(dx, 74).stroke({ width: 3, color: 0xd9a441 });
    g.circle(dx, 80, 7).fill({ color: 0xfff0c0 });
    g.circle(dx, 80, 15).fill({ color: 0xffc94d, alpha: 0.22 });
  }
  lampCone(c, cx, 92, w * 0.3, h, 0xffd08a);

  g.rect(0, wall, w, h - wall).fill({ color: 0x2a1014 });
  // Carpet border.
  g.roundRect(w * 0.05, wall + 16, w * 0.9, h - wall - 32, 18).fill({ color: 0x3d161d });
  g.roundRect(w * 0.05, wall + 16, w * 0.9, h - wall - 32, 18).stroke({ width: 4, color: 0x8a6a2a, alpha: 0.6 });
}

/** Sunlit patio: adobe arches, plants, warm light shafts. */
function sandstonePatio(c: Ctx): void {
  const { g, w, h, horizon } = c;
  const wall = horizon * 0.66;

  g.rect(0, 0, w, wall).fill({ color: 0xc9a273 });
  // Arched openings onto a bright sky.
  for (const ax of [w * 0.14, w * 0.5, w * 0.86]) {
    const aw = w * 0.12;
    shape(
      g,
      (gg) => {
        gg.moveTo(ax - aw / 2, wall);
        gg.lineTo(ax - aw / 2, wall * 0.42);
        gg.arc(ax, wall * 0.42, aw / 2, Math.PI, 0);
        gg.lineTo(ax + aw / 2, wall);
        gg.closePath();
      },
      0x8fc9e8,
      4
    );
    g.circle(ax, wall * 0.34, aw * 0.24).fill({ color: 0xfff0b8, alpha: 0.9 });
  }
  // Brick coursing.
  for (let y = 0; y < wall; y += 34) {
    g.rect(0, y, w, 2).fill({ color: 0xa8794a, alpha: 0.4 });
  }
  g.rect(0, wall - 20, w, 22).fill({ color: 0xa8794a });

  // Hanging plants.
  for (const px of [w * 0.3, w * 0.7]) {
    g.rect(px - 2, 0, 4, 40).fill({ color: 0x6b4a3a });
    shape(g, (gg) => gg.roundRect(px - 22, 40, 44, 26, 6), 0xb5713f, 3);
    for (let i = 0; i < 7; i++) {
      const a = -0.4 + (i / 6) * 0.8;
      g.moveTo(px, 62)
        .quadraticCurveTo(px + Math.sin(a) * 40, 100, px + Math.sin(a) * 56, 150 + i * 8)
        .stroke({ width: 5, color: 0x4f8a3a, cap: 'round' });
    }
  }

  // Terracotta tiled floor.
  g.rect(0, wall, w, h - wall).fill({ color: 0x9c6a44 });
  for (let y = wall; y < h; y += 44) {
    for (let x = ((y - wall) / 44) % 2 ? -22 : 0; x < w; x += 44) {
      g.roundRect(x + 3, y + 3, 38, 38, 4).fill({ color: 0xb07a4a });
    }
  }
  lampCone(c, w * 0.5, 0, w * 0.4, h, 0xfff0b8);
}

/** Arcade: neon grid floor, glowing tubes, dark everything else. */
function neonArcade(c: Ctx): void {
  const { g, w, h, horizon, rand } = c;
  const wall = horizon * 0.6;

  g.rect(0, 0, w, h).fill({ color: 0x0a0618 });

  // Horizon glow.
  g.rect(0, wall - 60, w, 60).fill({ color: 0x5ffbf1, alpha: 0.06 });
  g.rect(0, wall - 3, w, 4).fill({ color: 0x5ffbf1, alpha: 0.8 });

  // Perspective grid running to the horizon.
  for (let i = -14; i <= 14; i++) {
    g.moveTo(w / 2 + i * 46, wall)
      .lineTo(w / 2 + i * 340, h)
      .stroke({ width: 2, color: 0xb44dff, alpha: 0.4 });
  }
  let step = 6;
  for (let y = wall + 4; y < h; y += step) {
    g.rect(0, y, w, 1.6).fill({ color: 0x5ffbf1, alpha: 0.28 });
    step *= 1.32;
  }

  // Neon tube signs and cabinet silhouettes.
  for (const [nx, ny, nw, col] of [
    [w * 0.1, wall * 0.28, 150, 0xff2e6a],
    [w * 0.72, wall * 0.2, 190, 0x5ffbf1],
    [w * 0.42, wall * 0.1, 120, 0xffee32],
  ] as const) {
    g.roundRect(nx, ny, nw, 54, 16).stroke({ width: 12, color: col, alpha: 0.18 });
    g.roundRect(nx, ny, nw, 54, 16).stroke({ width: 4, color: col, alpha: 0.95 });
  }
  for (let i = 0; i < 6; i++) {
    const cx = 40 + rand() * (w - 80);
    const ch = 90 + rand() * 60;
    g.roundRect(cx, wall - ch, 54, ch, 8).fill({ color: 0x160e2e });
    g.roundRect(cx + 8, wall - ch + 12, 38, 30, 4).fill({ color: 0x2ee6ff, alpha: 0.5 });
  }
}

/** Frozen cavern: ice walls, icicles, cold light. */
function iceCavern(c: Ctx): void {
  const { g, w, h, horizon, rand } = c;
  const wall = horizon * 0.68;

  g.rect(0, 0, w, wall).fill({ color: 0x2a4256 });
  // Faceted ice wall.
  for (let i = 0; i < 16; i++) {
    const x = (i / 16) * w;
    const fw = w / 16 + 30;
    g.poly([x, 0, x + fw, 0, x + fw * 0.7, wall, x - 10, wall]).fill({
      color: i % 2 ? 0x35506a : 0x2e4760,
      alpha: 0.9,
    });
  }
  // Icicles along the ceiling.
  for (let i = 0; i < 22; i++) {
    const x = rand() * w;
    const len = 30 + rand() * 90;
    shape(g, (gg) => gg.poly([x - 11, 0, x + 11, 0, x, len]), 0xcfe9f5, 2, 0.92);
    g.poly([x - 4, 0, x + 2, 0, x, len * 0.7]).fill({ color: 0xffffff, alpha: 0.6 });
  }

  // Snow drift and floor.
  g.rect(0, wall, w, h - wall).fill({ color: 0xdfeef7 });
  g.ellipse(w * 0.2, wall + 10, w * 0.35, 40).fill({ color: 0xffffff });
  g.ellipse(w * 0.75, wall + 4, w * 0.3, 34).fill({ color: 0xffffff });
  g.rect(0, wall - 2, w, 5).fill({ color: 0x9fc4d8 });

  lampCone(c, w * 0.5, 0, w * 0.34, h, 0xbfe6ff);
  // Drifting flecks of frost.
  for (let i = 0; i < 40; i++) {
    g.circle(rand() * w, rand() * h, rand() * 2 + 0.8).fill({ color: 0xffffff, alpha: 0.35 });
  }
}

/** 70s rec room: wood panelling, starburst clock, shag carpet. */
function vintageRec(c: Ctx): void {
  const { g, w, h, horizon } = c;
  const wall = horizon * 0.64;

  g.rect(0, 0, w, wall).fill({ color: 0x6b4a26 });
  for (let x = 0; x < w; x += 46) {
    g.rect(x, 0, 3, wall).fill({ color: 0x4a3218, alpha: 0.7 });
    g.rect(x + 6, 0, 1.5, wall).fill({ color: 0x8a6438, alpha: 0.5 });
  }
  g.rect(0, wall - 16, w, 18).fill({ color: 0x4a3218 });

  // Starburst clock.
  const cx = w * 0.5;
  const cy = wall * 0.34;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    g.moveTo(cx + Math.cos(a) * 28, cy + Math.sin(a) * 28)
      .lineTo(cx + Math.cos(a) * (i % 2 ? 52 : 74), cy + Math.sin(a) * (i % 2 ? 52 : 74))
      .stroke({ width: 5, color: 0xe0c47a, cap: 'round' });
  }
  shape(g, (gg) => gg.circle(cx, cy, 26), 0xf0e3c0, 3);
  g.moveTo(cx, cy).lineTo(cx, cy - 16).stroke({ width: 3, color: INK });
  g.moveTo(cx, cy).lineTo(cx + 12, cy + 6).stroke({ width: 3, color: INK });

  // Chunky standing lamp.
  const lx = w * 0.13;
  g.rect(lx - 4, wall * 0.5, 8, wall * 0.5).fill({ color: 0x3a2a14 });
  shape(g, (gg) => gg.poly([lx - 34, wall * 0.5, lx + 34, wall * 0.5, lx + 22, wall * 0.28, lx - 22, wall * 0.28]), 0xd8873a, 3);
  g.circle(lx, wall * 0.52, 44).fill({ color: 0xffb45c, alpha: 0.2 });

  // Shag carpet — dense short strokes rather than a flat fill.
  g.rect(0, wall, w, h - wall).fill({ color: 0x6b6f34 });
  const rand = c.rand;
  for (let i = 0; i < 900; i++) {
    const x = rand() * w;
    const y = wall + rand() * (h - wall);
    g.moveTo(x, y)
      .lineTo(x + (rand() - 0.5) * 6, y - 6 - rand() * 7)
      .stroke({ width: 2, color: rand() > 0.5 ? 0x808a3e : 0x5a602a, alpha: 0.75 });
  }
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
 * Paints the room for `theme` across a `w × h` canvas. `tableTop` is where the table's top
 * edge lands on screen, so scenery can be arranged around it.
 */
export function drawScene(g: Graphics, theme: TableTheme, w: number, h: number, tableTop: number): void {
  g.clear();
  if (w <= 0 || h <= 0) return;

  const ctx: Ctx = {
    g,
    w,
    h,
    horizon: Math.max(120, tableTop),
    // Seeded from the theme id so a room's clutter stays put across resizes.
    rand: seeded(theme.id.split('').reduce((a, ch) => a + ch.charCodeAt(0), 7)),
  };

  (SCENES[theme.id] ?? classicHall)(ctx);

  // Vignette, so the table stays the brightest thing on screen. Built from stacked edge
  // bands rather than a subtractive cut — `cut()` left a hard rounded-rectangle seam across
  // the floor instead of a soft falloff.
  const BANDS = 7;
  for (let i = 0; i < BANDS; i++) {
    const inset = (i / BANDS) * Math.min(w, h) * 0.16;
    const alpha = 0.045;
    g.rect(0, inset, w, 2 + inset * 0.4).fill({ color: 0x000000, alpha });
    g.rect(0, h - inset - (2 + inset * 0.4), w, 2 + inset * 0.4).fill({ color: 0x000000, alpha });
    g.rect(inset, 0, 2 + inset * 0.4, h).fill({ color: 0x000000, alpha });
    g.rect(w - inset - (2 + inset * 0.4), 0, 2 + inset * 0.4, h).fill({ color: 0x000000, alpha });
  }
}
