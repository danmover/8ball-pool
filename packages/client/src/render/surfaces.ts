/**
 * The table's two big surfaces, generated procedurally: the cloth and the rail stock.
 *
 * Both used to be a gradient with some noise flicked at it, and both were the reason the table
 * read as a *diagram* of a pool table rather than as one. The thing that actually sells cloth is
 * the weave — a bed of tiny threads crossing over and under each other, catching the light on
 * their rounded tops — and you cannot get that out of a handful of `fillRect` speckles. So the
 * cloth is built a pixel at a time through `ImageData`, which sounds extravagant and costs about
 * fifty milliseconds *once per theme*, cached for the rest of the session. Getting it to fifty
 * from the four hundred and fifty it started at is the note over the weave loop.
 *
 * Everything here is driven by the material fields on the theme, so the eleven presets and any
 * table built in the Studio all come out of the same two functions. There is no "premium" path
 * and no plain one.
 */

import { TABLE_LENGTH, TABLE_WIDTH } from '@8ball/shared';
import type { TableTheme } from './cosmetics/tableThemes';

/**
 * Cloth texture size.
 *
 * Sized so one weave cell lands on roughly three or four *screen* pixels at a normal table fit.
 * Going finer is what produces moiré: a weave whose cell approaches one screen pixel beats
 * against the display grid and shimmers when the camera eases. Going coarser turns worsted
 * cloth into hessian.
 */
const CLOTH_W = 1600;
const CLOTH_H = Math.round((CLOTH_W * TABLE_WIDTH) / TABLE_LENGTH);

/** Pocket mouths in normalised cloth coordinates, for the wear that collects around them. */
const POCKET_UV: [number, number][] = [
  [0, 0],
  [0.5, 0],
  [1, 0],
  [0, 1],
  [0.5, 1],
  [1, 1],
];

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Cheap deterministic hash noise. Same pixel, same value, every regeneration. */
function hash2(x: number, y: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * A tile of loose-fibre noise, built once for the life of the page.
 *
 * The fibre term is one hash call per pixel, and at 1.28M pixels per cloth that hash was a
 * measurable slice of the whole generator. It is a ±0.055 wobble on brightness: nobody can see
 * that it repeats every 256 pixels, and everybody could see the extra 30ms.
 */
const FIBRE_BITS = 8;
const FIBRE_SIZE = 1 << FIBRE_BITS;
const FIBRE_MASK = FIBRE_SIZE - 1;
let fibreTile: Float32Array | null = null;

function fibre(): Float32Array {
  if (fibreTile) return fibreTile;
  const t = new Float32Array(FIBRE_SIZE * FIBRE_SIZE);
  for (let y = 0; y < FIBRE_SIZE; y++) {
    for (let x = 0; x < FIBRE_SIZE; x++) t[(y << FIBRE_BITS) + x] = hash2(x, y) - 0.5;
  }
  fibreTile = t;
  return t;
}

/** Smooth value noise from the hash above — used for the broad blotching in the nap. */
function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const sx = xf * xf * (3 - 2 * xf);
  const sy = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}

/**
 * The bed cloth.
 *
 * Built in four passes: a lamp-lit base gradient laid down with the 2D context, a per-pixel pass
 * that does the weave, the nap and the wear, then the painted markings, then the specular and
 * vignette that tie it to the light hanging over the table.
 */
export function generateClothCanvas(theme: TableTheme): HTMLCanvasElement {
  const w = CLOTH_W;
  const h = CLOTH_H;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  /*
   * --- 1. Base: the cloth, lit from wherever the lamp is, which is over the middle. ---
   *
   * The falloff *is* the depth. An early draft held the cloth at full brightness out to
   * two-thirds of the bed and only then dropped to the edge colour, and the result was a flat
   * mint slab: with no gradient across the middle there is nothing for the weave to sit *in*,
   * and a table lit from a point above it does not look like that. A tight spot falls off
   * fast, a daylight wash barely at all — which is exactly the lamp's `focus`.
   */
  const lampSpread = 0.42 + (1 - theme.lamp.focus) * 0.34;
  const base = ctx.createRadialGradient(w / 2, h * 0.44, h * 0.04, w / 2, h * 0.5, w * lampSpread);
  base.addColorStop(0, theme.light);
  base.addColorStop(0.45, theme.light);
  base.addColorStop(1, theme.dark);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  // Corners go a step past the cloth's own dark, so the bed reads as a dish rather than a disc.
  const deep = ctx.createRadialGradient(w / 2, h / 2, w * 0.3, w / 2, h / 2, w * 0.66);
  deep.addColorStop(0, 'rgba(0,0,0,0)');
  deep.addColorStop(1, 'rgba(0,0,0,0.26)');
  ctx.fillStyle = deep;
  ctx.fillRect(0, 0, w, h);

  /*
   * --- 2. The weave. ---
   *
   * A million and a quarter pixels, so what happens per pixel is the whole performance story.
   * Written the obvious way — a `Math.cos` per axis, a two-octave value noise, and a loop over
   * six pockets doing a `Math.sqrt` each — this took **450ms**, which is not a texture
   * generator, it is a half-second freeze every time somebody tries a different cloth.
   *
   * Everything expensive here is either *periodic in a very small period* or *varies slowly*,
   * and both of those are precomputable:
   *
   *   * The thread crown is `cos` of a position within one cell, and a cell is 4–12 pixels
   *     wide, so there are only ever that many distinct values. Table.
   *   * The blotching and the pocket wear vary over tens of pixels, not one. They are built on
   *     a coarse grid and sampled bilinearly — 18k evaluations instead of 1.28M, and nobody can
   *     see the difference because there was nothing at that frequency to lose.
   *
   * What is left per pixel is table lookups, one integer hash and a few multiplies.
   */
  const img = ctx.getImageData(0, 0, w, h);
  const px = img.data;

  // Plain weave: warp over weft in alternating cells. `cell` is the thread pitch in texture
  // pixels; the theme carries it in the same units the cloth catalogue is authored in.
  const cell = Math.max(2, Math.round(theme.weave * 2));
  const napAmt = theme.nap;
  // Wear reaches about a ball's width and a half out from each mouth.
  const wearReach = 0.19;

  // The rounded top of a thread, one entry per pixel across a cell.
  const crownLut = new Float32Array(cell);
  for (let k = 0; k < cell; k++) crownLut[k] = Math.cos((k / cell - 0.5) * Math.PI);
  const fib = fibre();

  // Per-column constants: which cell we are in, and where across it.
  const cellIx = new Int32Array(w);
  const cellFx = new Int32Array(w);
  for (let x = 0; x < w; x++) {
    const ix = (x / cell) | 0;
    cellIx[x] = ix;
    cellFx[x] = x - ix * cell;
  }

  // The two slow-varying fields, on a coarse grid.
  const GW = 200;
  const GH = 100;
  const blotch = new Float32Array(GW * GH);
  const wearGrid = new Float32Array(GW * GH);
  for (let gy = 0; gy < GH; gy++) {
    const v = gy / (GH - 1);
    for (let gx = 0; gx < GW; gx++) {
      const u = gx / (GW - 1);
      const g = gy * GW + gx;
      blotch[g] = valueNoise(u * 70, v * 34) - 0.5;
      let wear = 0;
      for (const [pu, pv] of POCKET_UV) {
        // The bed is 2:1, so u is scaled back into table proportions before measuring.
        const dx = (u - pu) * 2;
        const dy = v - pv;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < wearReach) wear = Math.max(wear, 1 - d / wearReach);
      }
      wearGrid[g] = wear;
    }
  }

  // Per-column grid coordinates for the bilinear sample.
  const gxIdx = new Int32Array(w);
  const gxFrac = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    const f = (x / (w - 1)) * (GW - 1);
    const i0 = Math.min(GW - 2, f | 0);
    gxIdx[x] = i0;
    gxFrac[x] = f - i0;
  }

  for (let y = 0; y < h; y++) {
    const v = y / h;
    // Nap: fine brush streaks running the length of the bed, so they vary across the width.
    const nap = Math.sin(v * 190) * 0.5 + valueNoise(v * 26, 3.7) - 0.5;
    const napTerm = nap * 0.045 * napAmt;

    // Row constants for the weave: the cell row, and this row's position across a thread.
    const iy = (y / cell) | 0;
    const crownY = crownLut[y - iy * cell];
    const dipYBase = crownY * 0.5 + 0.5;

    // Row constants for the coarse fields.
    const gf = (y / (h - 1)) * (GH - 1);
    const gy0 = Math.min(GH - 2, gf | 0);
    const ty = gf - gy0;
    const rowA = gy0 * GW;
    const rowB = rowA + GW;
    const fibRow = (y & FIBRE_MASK) << FIBRE_BITS;

    let i = y * w * 4;
    for (let x = 0; x < w; x++, i += 4) {
      const warpOnTop = ((cellIx[x] + iy) & 1) === 0;
      const crownX = crownLut[cellFx[x]];
      // A thread is a cylinder: bright along its crown, falling away to its edges. The one
      // passing underneath sits in the other's shadow.
      const crown = warpOnTop ? crownX : crownY;
      const dip = warpOnTop ? dipYBase : crownX * 0.5 + 0.5;
      let mul = 1 + crown * 0.15 - 0.055 - (1 - dip) * 0.06;

      // Bilinear sample of the two coarse fields.
      const gx0 = gxIdx[x];
      const tx = gxFrac[x];
      const a = rowA + gx0;
      const b = rowB + gx0;
      const bl =
        (blotch[a] + (blotch[a + 1] - blotch[a]) * tx) * (1 - ty) +
        (blotch[b] + (blotch[b + 1] - blotch[b]) * tx) * ty;
      const wear =
        (wearGrid[a] + (wearGrid[a + 1] - wearGrid[a]) * tx) * (1 - ty) +
        (wearGrid[b] + (wearGrid[b + 1] - wearGrid[b]) * tx) * ty;

      // Broad woolly blotching, stronger on coarse cloths, plus loose fibre.
      mul += bl * 0.09 * napAmt + napTerm + fib[fibRow + (x & FIBRE_MASK)] * 0.055;

      // Wear around the mouths: cloth that has had ten thousand balls dragged over it goes
      // lighter, flatter and shinier. The weave is polished down rather than gone, so the
      // contrast is pulled toward 1 rather than the colour being repainted.
      if (wear > 0) {
        const k = wear * wear * 0.6;
        mul = mul * (1 - k) + (1 + crown * 0.05) * k + k * 0.12;
      }

      const r = px[i] * mul;
      const g2 = px[i + 1] * mul;
      const b2 = px[i + 2] * mul;
      px[i] = r > 255 ? 255 : r;
      px[i + 1] = g2 > 255 ? 255 : g2;
      px[i + 2] = b2 > 255 ? 255 : b2;
    }
  }
  ctx.putImageData(img, 0, 0);

  // --- 3. Markings, chalk and the cushion shadow. ---
  // Neon skips the painted lines — lines on a backlit table read as dirt.
  if (theme.markings) {
    // Head string and centre line. Drawn twice: a dark hairline under a light one, because
    // paint on cloth sits *proud* of it and catches its own edge shadow.
    for (const frac of [0.25, 0.5]) {
      const x = Math.round(w * frac);
      ctx.fillStyle = 'rgba(0,0,0,0.10)';
      ctx.fillRect(x - 1, 0, 3, h);
      ctx.fillStyle = 'rgba(255,255,255,0.13)';
      ctx.fillRect(x, 0, 1.6, h);
    }
    // Head and foot spots, each with the little shadow a stuck-on spot casts.
    for (const frac of [0.25, 0.75]) {
      const x = w * frac;
      const y = h / 2;
      ctx.beginPath();
      ctx.arc(x + 1, y + 1.5, 5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fill();
    }
  }

  // Chalk dust. It collects where cue balls get struck, so it is weighted toward the baulk end
  // rather than scattered evenly — a detail nobody will consciously notice and everybody would
  // notice the absence of.
  ctx.globalAlpha = 1;
  for (let i = 0; i < 420; i++) {
    const x = Math.pow(Math.random(), 1.7) * w * 0.6 + Math.random() * w * 0.4;
    const y = Math.random() * h;
    const r = Math.random() * 1.6 + 0.4;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(190,215,235,${(0.05 + Math.random() * 0.09).toFixed(3)})`;
    ctx.fill();
  }

  // --- 4. The light hanging over it. ---
  // Specular: a soft sheen sitting slightly above centre, in the lamp's own colour. This is
  // what makes cloth look like a surface rather than a colour.
  const [lr, lg, lb] = rgb(theme.lamp.color);
  const sheen = ctx.createRadialGradient(
    w * 0.5,
    h * 0.36,
    h * 0.02,
    w * 0.5,
    h * 0.42,
    w * (0.3 + (1 - theme.lamp.focus) * 0.35)
  );
  const peak = 0.16 * theme.lamp.strength;
  sheen.addColorStop(0, `rgba(${lr},${lg},${lb},${peak.toFixed(3)})`);
  sheen.addColorStop(0.55, `rgba(${lr},${lg},${lb},${(peak * 0.35).toFixed(3)})`);
  sheen.addColorStop(1, `rgba(${lr},${lg},${lb},0)`);
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, w, h);

  // A raking streak across the bed, angled so it doesn't sit parallel to anything.
  const rake = ctx.createLinearGradient(0, 0, w, h * 0.7);
  rake.addColorStop(0, 'rgba(255,255,255,0.045)');
  rake.addColorStop(0.42, 'rgba(255,255,255,0)');
  rake.addColorStop(1, 'rgba(0,0,0,0.07)');
  ctx.fillStyle = rake;
  ctx.fillRect(0, 0, w, h);

  // The cushions stand proud of the bed and throw a shadow onto it all the way round. Drawn as
  // an inset band rather than a vignette, because a vignette darkens the middle of the long
  // rails just as much as the corners and that is not how a shadow from a straight edge falls.
  const band = Math.round(h * 0.075);
  const edges: [number, number, number, number, number, number][] = [
    [0, 0, w, band, 0, 1],
    [0, h - band, w, band, 0, -1],
    [0, 0, band, h, 1, 0],
    [w - band, 0, band, h, -1, 0],
  ];
  for (const [ex, ey, ew, eh, dx, dy] of edges) {
    const gx = dx === 0 ? ex : dx > 0 ? ex : ex + ew;
    const gy = dy === 0 ? ey : dy > 0 ? ey : ey + eh;
    const grad = ctx.createLinearGradient(gx, gy, gx + dx * ew, gy + dy * eh);
    grad.addColorStop(0, 'rgba(0,0,0,0.30)');
    grad.addColorStop(0.5, 'rgba(0,0,0,0.07)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(ex, ey, ew, eh);
  }

  // Corners get a touch more, where two cushion shadows meet.
  const corner = ctx.createRadialGradient(w / 2, h / 2, w * 0.36, w / 2, h / 2, w * 0.62);
  corner.addColorStop(0, 'rgba(0,0,0,0)');
  corner.addColorStop(1, 'rgba(0,0,0,0.18)');
  ctx.fillStyle = corner;
  ctx.fillRect(0, 0, w, h);

  return canvas;
}

/**
 * The rail stock.
 *
 * Three things separate timber from a brown rectangle: figure (the long cathedral streaks that
 * follow the grain), pore (the open speckle you can feel with a fingernail) and the varnish over
 * the top of both. Each is a field on the theme, so ebony comes out closed and near-black under
 * a mirror finish while weathered teak comes out open, dry and matte from the same code.
 */
export function generateRailCanvas(theme: TableTheme): HTMLCanvasElement {
  const w = 768;
  const h = 768;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = theme.rail;
  ctx.fillRect(0, 0, w, h);

  const [dr, dg, db] = rgb(theme.railDark);
  const grain = theme.grain;
  const pore = theme.pore;

  // --- Figure: long streaks following the grain, wandering as real grain does. ---
  const streaks = Math.round(70 + grain * 260);
  for (let i = 0; i < streaks; i++) {
    const y = Math.random() * h;
    const thickness = 0.5 + Math.random() * (1 + grain * 3);
    const dark = (0.04 + Math.random() * 0.2) * (0.35 + grain);
    ctx.strokeStyle = `rgba(${dr},${dg},${db},${dark.toFixed(3)})`;
    ctx.lineWidth = thickness;
    ctx.beginPath();
    ctx.moveTo(0, y);
    // Two sines at different rates so the wander never repeats visibly across the tile.
    const a1 = Math.random() * 6.3;
    const a2 = Math.random() * 6.3;
    const amp = 2 + grain * 9;
    for (let x = 0; x <= w; x += 24) {
      const t = x / w;
      ctx.lineTo(x, y + Math.sin(t * Math.PI * 2 + a1) * amp + Math.sin(t * Math.PI * 5 + a2) * amp * 0.35);
    }
    ctx.stroke();
  }

  // Occasional cathedral arch, where the saw crossed a growth ring at an angle. Only on woods
  // with real figure — putting one in ebony or carbon fibre would be a lie about the material.
  if (grain > 0.45) {
    for (let i = 0; i < Math.round(grain * 7); i++) {
      const cx = Math.random() * w;
      const cy = Math.random() * h;
      for (let r = 0; r < 7; r++) {
        ctx.strokeStyle = `rgba(${dr},${dg},${db},${(0.06 * grain).toFixed(3)})`;
        ctx.lineWidth = 1 + Math.random() * 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, 12 + r * 9, 46 + r * 26, Math.PI / 2, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  // --- Pore: the open speckle. Short dashes lying along the grain, not round dots. ---
  const pores = Math.round(pore * 2600);
  for (let i = 0; i < pores; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const len = 1.5 + Math.random() * 5;
    ctx.strokeStyle = `rgba(${dr},${dg},${db},${(0.1 + Math.random() * 0.25).toFixed(3)})`;
    ctx.lineWidth = 0.7 + Math.random() * 0.8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + len, y + (Math.random() - 0.5) * 1.2);
    ctx.stroke();
  }

  // --- Varnish. ---
  // A gloss finish is a *reflection*, so it reads as a broad bright sweep with a hard-ish edge
  // rather than as an even lightening. Matte finishes get almost none of this.
  if (theme.gloss > 0.05) {
    const sweep = ctx.createLinearGradient(0, 0, w * 0.9, h);
    const g = theme.gloss;
    sweep.addColorStop(0, `rgba(255,255,255,0)`);
    sweep.addColorStop(0.34, `rgba(255,255,255,${(0.05 * g).toFixed(3)})`);
    sweep.addColorStop(0.44, `rgba(255,255,255,${(0.22 * g).toFixed(3)})`);
    sweep.addColorStop(0.56, `rgba(255,255,255,${(0.05 * g).toFixed(3)})`);
    sweep.addColorStop(1, `rgba(255,255,255,0)`);
    ctx.fillStyle = sweep;
    ctx.fillRect(0, 0, w, h);

    // Deep lacquer darkens the timber under it and adds depth at the far edge.
    ctx.fillStyle = `rgba(${dr},${dg},${db},${(0.1 * g).toFixed(3)})`;
    ctx.fillRect(0, 0, w, h);
  }

  // Broad tonal banding so the frame isn't a flat slab of colour.
  const band = ctx.createLinearGradient(0, 0, 0, h);
  band.addColorStop(0, 'rgba(255,255,255,0.11)');
  band.addColorStop(0.5, 'rgba(0,0,0,0)');
  band.addColorStop(1, `rgba(${dr},${dg},${db},0.36)`);
  ctx.fillStyle = band;
  ctx.fillRect(0, 0, w, h);

  return canvas;
}

/** Cache key covering every material field either generator reads. */
/**
 * The generated pixels, kept for the session rather than for the renderer.
 *
 * This is the single biggest stall in the app, and it was being paid over and over for no
 * reason. Generating a cloth is ~50ms of per-pixel work; the caches that held the result lived
 * on the `TableRenderer` *instance*, and the menu builds one renderer while the table builds
 * another. So every menu → table → menu round trip threw away every generated surface and made
 * them all again: measured at load, that is three frames of 80–190ms in the first half second,
 * every single navigation.
 *
 * Caching the canvas rather than the `Texture` is deliberate. A `Texture` is bound to the GL
 * context that uploaded it, and handing one from a destroyed renderer to a live one is the kind
 * of thing that works until it silently draws black. The canvas is just pixels: each renderer
 * uploads its own texture from it, which costs a memcpy instead of a minute of arithmetic.
 *
 * Bounded, because a cloth canvas is 1600×800×4 ≈ 5MB of backing store and browsing the picker
 * would otherwise park all of them for the session.
 */
const CLOTH_CANVASES = new Map<string, HTMLCanvasElement>();
const RAIL_CANVASES = new Map<string, HTMLCanvasElement>();

const CLOTH_KEEP = 3;
const RAIL_KEEP = 4;

/** Re-inserting moves a key to the end, so plain `Map` order is a usable LRU. */
function remember(
  cache: Map<string, HTMLCanvasElement>,
  key: string,
  make: () => HTMLCanvasElement,
  limit: number
): HTMLCanvasElement {
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }

  const made = make();
  cache.set(key, made);
  while (cache.size > limit) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    const dead = cache.get(oldest);
    cache.delete(oldest);
    /*
     * Zeroing the dimensions is what actually frees a canvas's backing store — dropping the
     * last reference only makes it eligible, and the GC is in no hurry about 5MB when the
     * machine is already short of memory. Nothing can still be drawing it: a texture uploaded
     * from it took a copy.
     */
    if (dead) {
      dead.width = 0;
      dead.height = 0;
    }
  }
  return made;
}

/** The cloth for this theme, generated once per session. */
export function clothCanvasFor(theme: TableTheme): HTMLCanvasElement {
  return remember(CLOTH_CANVASES, surfaceKey(theme), () => generateClothCanvas(theme), CLOTH_KEEP);
}

/** The rail stock for this theme, generated once per session. */
export function railCanvasFor(theme: TableTheme): HTMLCanvasElement {
  return remember(RAIL_CANVASES, surfaceKey(theme), () => generateRailCanvas(theme), RAIL_KEEP);
}

export function surfaceKey(theme: TableTheme): string {
  return [
    theme.light,
    theme.dark,
    theme.rail,
    theme.railDark,
    theme.lamp.id,
    theme.weave,
    theme.nap,
    theme.grain,
    theme.pore,
    theme.gloss,
    theme.markings ? 'm' : '-',
  ].join('|');
}

export { CLOTH_W, CLOTH_H, TABLE_LENGTH as SURFACE_TABLE_LENGTH };
