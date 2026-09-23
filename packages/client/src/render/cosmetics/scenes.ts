import { Graphics } from 'pixi.js';
import type { TableTheme } from './tableThemes';

/**
 * What is behind the table: nothing, and a light.
 *
 * This replaced seven drawn rooms — plank floors, rugs, chairs, cues lying about, an ice cavern,
 * a shag-carpet rec room. They were detailed and they were the wrong idea, for a reason worth
 * writing down: **a room competes with the table**. Every chair and rug was another object with
 * its own edges and its own colour sitting in the same frame as the one object the player is
 * actually reading, and the more carefully each prop was drawn the more it took. A pool table
 * under a low lamp in a dark room is not a room you can see. It is a table, a pool of light, and
 * black.
 *
 * So the backdrop is now that, and only that: graded darkness, a soft pool of light thrown down
 * over the table, the penumbra it casts just past the rails, and enough fine mottling that the
 * gradients do not band. Everything moving in it — the dust turning over in the beam — is in
 * `ambientFx.ts` on top.
 *
 * The one functional gain, beyond looking better: this is generated entirely from the theme's own
 * lamp and cloth, so a table built in the Theme Studio gets a backdrop that is genuinely *its*,
 * rather than borrowing the nearest preset's room. There is no venue list here any more.
 *
 * Drawn once per resize/theme change into a single Graphics — never per frame.
 */

/** The table's footprint on screen, so the light can be centred on it. */
export interface TableRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function rgbOf(hex: string): { r: number; g: number; b: number } {
  const n = parseInt(hex.replace('#', ''), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Mixes toward black and returns a Pixi colour int. */
function shade(hex: string, keep: number): number {
  const { r, g, b } = rgbOf(hex);
  return ((r * keep) << 16) | ((g * keep) << 8) | (b * keep);
}

function toHex(hex: string): number {
  return parseInt(hex.replace('#', ''), 16) || 0x000000;
}

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/**
 * The pool of light on the floor.
 *
 * Built as a stack of concentric ellipses from wide-and-faint to tight-and-bright, which is the
 * only way to get a soft-edged light out of a vector context without a blur filter. `focus` sets
 * how fast it closes: a theatrical spot collapses to a hard bright disc, a daylight wash barely
 * narrows at all and just lifts the whole frame.
 *
 * Thirty-two steps rather than the five the old `lightPool` used. Five is visibly a set of rings;
 * this has to be the main event in an otherwise empty frame, and at five steps the banding is the
 * first thing you see.
 */
function pool(
  g: Graphics,
  table: TableRect,
  color: number,
  focus: number,
  strength: number
): void {
  const cx = table.x + table.w / 2;
  const cy = table.y + table.h / 2;
  const STEPS = 32;
  // A tight lamp throws a pool barely wider than the table; a soft one spills much further.
  const reach = 2.4 - focus * 1.15;

  for (let i = STEPS; i >= 1; i--) {
    const f = i / STEPS;
    // Squared so the ramp is dense and bright near the middle and long and faint at the edge,
    // which is how light actually falls off rather than how a linear ramp looks.
    const spread = 0.55 + f * f * reach;
    g.ellipse(cx, cy, table.w * 0.5 * spread, table.h * 0.62 * spread).fill({
      color,
      alpha: 0.021 * strength,
    });
  }
}

/**
 * The shadow the table drops onto the floor around it.
 *
 * A lamp hanging directly over a table puts almost nothing on the floor beneath it and a soft
 * dark skirt just past the rails. Drawn *after* the pool, because it falls on the lit floor.
 */
function penumbra(g: Graphics, table: TableRect): void {
  const cx = table.x + table.w / 2;
  const cy = table.y + table.h / 2 + table.h * 0.03;
  const STEPS = 14;
  for (let i = STEPS; i >= 1; i--) {
    const f = i / STEPS;
    const spread = 1 + f * 0.42;
    g.ellipse(cx, cy, (table.w / 2) * spread, (table.h / 2) * spread).fill({
      color: 0x000000,
      alpha: 0.05,
    });
  }
}

/**
 * Fine mottling across the whole frame.
 *
 * Large smooth gradients on an 8-bit display band into visible contour rings, and this backdrop
 * is almost nothing *but* large smooth gradients. A scatter of very faint blobs at a scale well
 * below the gradient's own is enough to break the contours up — it is dithering, done with
 * ellipses because that is what this context has.
 */
function mottle(g: Graphics, w: number, h: number, tint: number, rand: () => number): void {
  const count = Math.round((w * h) / 5200);
  for (let i = 0; i < count; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const r = 18 + rand() * 62;
    g.ellipse(x, y, r, r * (0.6 + rand() * 0.7)).fill({
      color: rand() > 0.5 ? tint : 0x000000,
      alpha: 0.012,
    });
  }
}

/** Takes the outer frame down to black, so the lit area is unmistakably the subject. */
function edgeFalloff(g: Graphics, w: number, h: number, table: TableRect): void {
  const cx = table.x + table.w / 2;
  const cy = table.y + table.h / 2;
  const STEPS = 18;
  // Starts outside the table and reaches the corners of the frame.
  const inner = Math.max(table.w, table.h) * 0.72;
  const outer = Math.hypot(w, h) * 0.62;
  for (let i = 1; i <= STEPS; i++) {
    const f = i / STEPS;
    const r = outer + (inner - outer) * f;
    g.ellipse(cx, cy, r * 1.15, r * 0.95).fill({ color: 0x000000, alpha: 0.045 });
  }
}

/**
 * Paints the backdrop for `theme` across a `w × h` canvas. `table` is the table's footprint on
 * screen, so the light can be hung over it rather than over the middle of the window.
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

  const lamp = toHex(theme.lamp.color);
  // The dark is the cloth, taken almost all the way down. Green rooms sit fractionally green and
  // blue rooms fractionally blue — far too little to name, just enough that switching cloth
  // changes the whole screen rather than the middle of it.
  const voidTint = shade(theme.dark, 0.1);
  const rand = seeded(theme.id.split('').reduce((a, ch) => a + ch.charCodeAt(0), 11));

  g.rect(0, 0, w, h).fill({ color: 0x000000 });
  g.rect(0, 0, w, h).fill({ color: voidTint, alpha: 0.9 });

  // Light in the air above the floor, before any of it lands: a very wide, very faint wash.
  const cx = table.x + table.w / 2;
  const cy = table.y + table.h / 2;
  for (let i = 6; i >= 1; i--) {
    g.ellipse(cx, cy - table.h * 0.06, Math.max(w, h) * (0.25 + i * 0.11), Math.max(w, h) * (0.2 + i * 0.09)).fill({
      color: lamp,
      alpha: 0.008 * theme.lamp.strength,
    });
  }

  pool(g, table, lamp, theme.lamp.focus, theme.lamp.strength);
  penumbra(g, table);
  mottle(g, w, h, lamp, rand);
  edgeFalloff(g, w, h, table);
}
