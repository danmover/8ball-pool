import * as THREE from 'three';
import type { CuePattern, CueStyle } from '@8ball/shared';
import { fbm, hexToRgb, noise3, shadeHex } from '../textures';

/**
 * Cue liveries, painted at runtime from the catalogue's numbers.
 *
 * The cue is a lathe, so every layer shares one layout: `u` runs once around it — the top, the
 * side the overhead camera sees, is u = 0.5, and the cue is always rolled to keep it there — and
 * `v` runs tip to butt. Four layers are painted in step (colour; surface = clearcoat, roughness,
 * metalness; bump; glow), so one stroke makes a gold point gold, polished and proud of the wood.
 * Shapes are drawn in millimetres on the cue's surface, so a pearl dot is round however thick
 * the cue is where it sits.
 */

export const CUE_LENGTH = 1.16;

/** Where each part begins, as a fraction of the length from the tip. */
export const PART = {
  ferrule: 0.0085,
  shaft: 0.028,
  collar: 0.4685,
  forearm: 0.508,
  ring: 0.745,
  wrap: 0.756,
  ring2: 0.926,
  sleeve: 0.934,
  bumper: 0.99,
} as const;

/**
 * The turned shape, [fraction from the tip, radius]. Heavier than a real cue so it still reads at
 * phone size, and every part sits a step proud of the next so the joints catch the light as
 * bevels. A third value of `true` rounds the lathe over that point instead of creasing it.
 */
export const CUE_PROFILE: [number, number, boolean?][] = [
  // Tip: a domed crown.
  [0, 0, true],
  [0.0005, 0.0033, true],
  [0.0014, 0.0053, true],
  [0.0028, 0.0064, true],
  [0.0046, 0.0068],
  [PART.ferrule, 0.0068],
  // Ferrule, a hair proud of the tip.
  [PART.ferrule, 0.0071],
  [PART.shaft - 0.0006, 0.0072],
  [PART.shaft, 0.00705],
  // Shaft: straight for a hand's length, then a long taper to the joint.
  [0.2, 0.0074, true],
  [PART.collar, 0.0097],
  // Joint collar, bevelled at both ends.
  [PART.collar + 0.0015, 0.0106],
  [PART.forearm - 0.0015, 0.0106],
  [PART.forearm, 0.0101],
  // Forearm.
  [PART.ring, 0.0127],
  // Trim ring.
  [PART.ring + 0.0012, 0.0132],
  [PART.wrap - 0.0012, 0.0132],
  [PART.wrap, 0.0127],
  // Wrap, set in a touch.
  [PART.wrap, 0.0124],
  [PART.ring2, 0.0137],
  // Second ring.
  [PART.ring2 + 0.0012, 0.0143],
  [PART.sleeve - 0.0008, 0.0143],
  [PART.sleeve, 0.014],
  // Butt sleeve.
  [PART.bumper, 0.0148],
  // Rubber bumper.
  [PART.bumper, 0.0143],
  [0.9945, 0.0141, true],
  [0.9975, 0.0126, true],
  [0.9993, 0.0085, true],
  [1, 0, true],
];

/** The cue's radius at a fraction of its length. */
export function radiusAt(f: number): number {
  for (let i = 1; i < CUE_PROFILE.length; i++) {
    const [f1, r1] = CUE_PROFILE[i];
    if (f1 < f) continue;
    const [f0, r0] = CUE_PROFILE[i - 1];
    return f1 > f0 ? r0 + ((r1 - r0) * (f - f0)) / (f1 - f0) : r1;
  }
  return 0;
}

export interface CueTextures {
  map: THREE.Texture;
  /** R clearcoat, G roughness, B metalness — one texture for all three maps. */
  surface: THREE.Texture;
  bump: THREE.Texture | null;
  emissive: THREE.Texture | null;
  /** How strongly each stretch of the cue glows, tip to butt, for the light it spills on the cloth. */
  glow: Float32Array | null;
}

export const GLOW_BINS = 24;

// ------------------------------------------------------------------ painter

type RGB = [number, number, number];
/** [clearcoat, roughness, metalness], 0..1. */
type Surface = [number, number, number];
/** A fill, or a function making one in the shape's millimetre space (x around, y along). */
type Fill = string | ((g: CanvasRenderingContext2D, around: number, along: number) => string | CanvasGradient);
interface Paint {
  color?: Fill;
  surface?: Surface;
  /** Height, 0..1 around a flat 0.5. */
  bump?: number;
  glow?: Fill;
}
interface Px {
  color: RGB;
  glow: RGB;
  surface: Surface;
  bump: number;
}

type Layer = 'color' | 'surface' | 'bump' | 'glow';
const LAYERS: Layer[] = ['color', 'surface', 'bump', 'glow'];
const TAU = Math.PI * 2;
const MM = CUE_LENGTH * 1000;

const GLOSS: Surface = [1, 0.42, 0];
const SATIN: Surface = [0.35, 0.55, 0];
const POLISHED: Surface = [0.6, 0.16, 1];
const BRUSHED: Surface = [0.15, 0.36, 1];

const IVORY = '#f6f0e1';
const EBONY = '#120c09';

function circumference(f: number): number {
  return TAU * radiusAt(f) * 1000;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

function mixTo(out: RGB, a: RGB, b: RGB, t: number): void {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
}

function css(c: RGB, a = 1): string {
  return `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
}

function alpha(hex: string, a: number): string {
  return css(hexToRgb(hex), a);
}

/** Seamless noise on the cue's surface; `a` around and `b` along in mm, `k` features per mm. */
function skin(a: number, b: number, C: number, k: number, octaves: number, seed: number, stretch = 1): number {
  const ang = (a / C) * TAU;
  const rad = (C / TAU) * k;
  return fbm(Math.cos(ang) * rad, Math.sin(ang) * rad, (b * k) / stretch, octaves, seed);
}

/** A small deterministic generator, so a shape drawn once per layer lands in the same place each time. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function vgrad(g: CanvasRenderingContext2D, y0: number, y1: number, stops: string[]): CanvasGradient {
  const gr = g.createLinearGradient(0, y0, 0, y1);
  stops.forEach((c, i) => gr.addColorStop(i / (stops.length - 1), c));
  return gr;
}

class Painter {
  readonly h: number;
  glowing = false;
  readonly canvas = {} as Record<Layer, HTMLCanvasElement>;
  private readonly ctx = {} as Record<Layer, CanvasRenderingContext2D>;

  constructor(readonly w: number) {
    this.h = w * 8;
    for (const layer of LAYERS) {
      const c = document.createElement('canvas');
      c.width = this.w;
      c.height = this.h;
      const g = c.getContext('2d', { willReadFrequently: true })!;
      g.fillStyle = layer === 'surface' ? surfaceCss(GLOSS) : layer === 'bump' ? '#808080' : '#000';
      g.fillRect(0, 0, this.w, this.h);
      this.canvas[layer] = c;
      this.ctx[layer] = g;
    }
  }

  /** Fills a path drawn in millimetres on the section [f0, f1]; x runs around (0..C), y along. */
  shape(f0: number, f1: number, path: (g: CanvasRenderingContext2D, C: number, len: number) => void, paint: Paint, stroke = 0): void {
    const C = circumference((f0 + f1) / 2);
    const len = (f1 - f0) * MM;
    const y0 = f0 * this.h;
    const y1 = f1 * this.h;
    for (const layer of LAYERS) {
      const fill = layer === 'surface' ? paint.surface && surfaceCss(paint.surface) : layer === 'bump' ? paint.bump !== undefined && grey(paint.bump) : paint[layer];
      if (!fill) continue;
      if (layer === 'glow') this.glowing = true;
      const g = this.ctx[layer];
      g.save();
      g.beginPath();
      g.rect(0, y0, this.w, y1 - y0);
      g.clip();
      for (const k of [-1, 0, 1]) {
        g.setTransform(this.w / C, 0, 0, (y1 - y0) / len, k * this.w, y0);
        const style = typeof fill === 'function' ? fill(g, C, len) : fill;
        g.beginPath();
        path(g, C, len);
        if (stroke) {
          g.lineWidth = stroke;
          g.lineCap = 'round';
          g.lineJoin = 'round';
          g.strokeStyle = style;
          g.stroke();
        } else {
          g.fillStyle = style;
          g.fill();
        }
      }
      g.restore();
    }
  }

  /** Fills the whole section, all the way round. */
  band(f0: number, f1: number, paint: Paint): void {
    this.shape(f0, f1, (g, C, len) => g.rect(-1, -1, C + 2, len + 2), paint);
  }

  /** Paints every texel of a section; `a` is millimetres around, `b` along from the tip. */
  pixels(f0: number, f1: number, fn: (px: Px, a: number, b: number, C: number, u: number, f: number) => void): void {
    const y0 = Math.max(0, Math.floor(f0 * this.h));
    const y1 = Math.min(this.h, Math.ceil(f1 * this.h));
    const rows = y1 - y0;
    if (rows <= 0) return;
    const images = LAYERS.map((l) => this.ctx[l].getImageData(0, y0, this.w, rows));
    const [cd, sd, bd, gd] = images.map((im) => im.data);
    const px: Px = { color: [0, 0, 0], glow: [0, 0, 0], surface: [0, 0, 0], bump: 0 };
    let lit = false;
    for (let y = 0; y < rows; y++) {
      const f = (y0 + y + 0.5) / this.h;
      const C = circumference(f);
      const b = f * MM;
      for (let x = 0; x < this.w; x++) {
        const i = (y * this.w + x) * 4;
        const u = (x + 0.5) / this.w;
        px.color[0] = cd[i];
        px.color[1] = cd[i + 1];
        px.color[2] = cd[i + 2];
        px.glow[0] = gd[i];
        px.glow[1] = gd[i + 1];
        px.glow[2] = gd[i + 2];
        px.surface[0] = sd[i] / 255;
        px.surface[1] = sd[i + 1] / 255;
        px.surface[2] = sd[i + 2] / 255;
        px.bump = bd[i] / 255;
        fn(px, u * C, b, C, u, f);
        cd[i] = px.color[0];
        cd[i + 1] = px.color[1];
        cd[i + 2] = px.color[2];
        gd[i] = px.glow[0];
        gd[i + 1] = px.glow[1];
        gd[i + 2] = px.glow[2];
        sd[i] = px.surface[0] * 255;
        sd[i + 1] = px.surface[1] * 255;
        sd[i + 2] = px.surface[2] * 255;
        bd[i] = bd[i + 1] = bd[i + 2] = px.bump * 255;
        if (gd[i] + gd[i + 1] + gd[i + 2] > 6) lit = true;
      }
    }
    LAYERS.forEach((l, k) => this.ctx[l].putImageData(images[k], 0, y0));
    if (lit) this.glowing = true;
  }

  finish(withBump: boolean): CueTextures {
    const tex = (layer: Layer, srgb: boolean): THREE.Texture => {
      const t = new THREE.CanvasTexture(this.canvas[layer]);
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = THREE.RepeatWrapping;
      t.anisotropy = 8;
      t.needsUpdate = true;
      return t;
    };
    let glow: Float32Array | null = null;
    if (this.glowing) {
      // Average each row's glow, keep the brightest row in each bin.
      glow = new Float32Array(GLOW_BINS);
      const d = this.ctx.glow.getImageData(0, 0, this.w, this.h).data;
      for (let y = 0; y < this.h; y++) {
        let sum = 0;
        for (let x = 0; x < this.w; x++) {
          const i = (y * this.w + x) * 4;
          sum += Math.max(d[i], d[i + 1], d[i + 2]);
        }
        const bin = Math.min(GLOW_BINS - 1, Math.floor((y / this.h) * GLOW_BINS));
        glow[bin] = Math.max(glow[bin], sum / (this.w * 255));
      }
    }
    return {
      map: tex('color', true),
      surface: tex('surface', false),
      bump: withBump ? tex('bump', false) : null,
      emissive: this.glowing ? tex('glow', true) : null,
      glow,
    };
  }
}

function surfaceCss(s: Surface): string {
  return `rgb(${Math.round(s[0] * 255)},${Math.round(s[1] * 255)},${Math.round(s[2] * 255)})`;
}

function grey(v: number): string {
  const n = Math.round(clamp01(v) * 255);
  return `rgb(${n},${n},${n})`;
}

// ------------------------------------------------------------------ materials

/** Long-grain wood: warped lengthwise figure, broad tone and fine fibre. */
function wood(p: Painter, f0: number, f1: number, o: { base: string; dark: string; figure?: number; contrast?: number; fibre?: number; seed?: number }): void {
  const base = hexToRgb(o.base);
  const dark = hexToRgb(o.dark);
  const light = hexToRgb(shadeHex(o.base, 0.14));
  const figure = o.figure ?? 5;
  const contrast = o.contrast ?? 0.5;
  const fibre = o.fibre ?? 0.08;
  const seed = o.seed ?? 3;
  const tone: RGB = [0, 0, 0];
  p.pixels(f0, f1, (px, a, b, C) => {
    const field = skin(a, b, C, 0.09, 3, seed, 9);
    const s = Math.abs(Math.sin(field * figure * TAU));
    const line = 1 - smoothstep(0, 0.3, s);
    const broad = skin(a, b, C, 0.035, 2, seed + 9, 6);
    const fib = skin(a, b, C, 0.9, 1, seed + 5, 12);
    mixTo(tone, base, light, clamp01((broad - 0.45) * 2.2));
    mixTo(px.color, tone, dark, line * contrast + Math.max(0, 0.5 - broad) * contrast * 0.5);
    const k = 1 + (fib - 0.5) * fibre * 2;
    px.color[0] *= k;
    px.color[1] *= k;
    px.color[2] *= k;
    px.surface[0] = 1;
    px.surface[1] = 0.4;
    px.surface[2] = 0;
    px.bump = 0.5 + (fib - 0.5) * 0.15 - line * 0.06;
  });
}

/** A 2×2 twill of carbon tows; each tow is a rounded bundle, bright along its middle. */
function weave(p: Painter, f0: number, f1: number, dark: string, light: string, tow: number, contrast = 1): void {
  const D = hexToRgb(dark);
  const L = hexToRgb(light);
  const n = Math.max(8, Math.round(circumference((f0 + f1) / 2) / tow / 4) * 4);
  p.pixels(f0, f1, (px, _a, b, _C, u) => {
    const x = u * n;
    const y = b / tow;
    const ci = Math.floor(x);
    const cj = Math.floor(y);
    const over = (ci + cj) % 4 < 2;
    const across = over ? y - cj : x - ci;
    const sheen = Math.sin(across * Math.PI);
    const t = over ? 0.3 + 0.7 * sheen : 0.08 + 0.42 * sheen;
    mixTo(px.color, D, L, 0.5 + (t - 0.5) * contrast);
    px.surface[0] = 1;
    px.surface[1] = 0.3 + (1 - sheen) * 0.2;
    px.surface[2] = 0;
    px.bump = 0.5 + (sheen - 0.5) * 0.5 * contrast;
  });
}

/** A turned metal ring, with a dark hairline groove at each end so it reads as a part of its own. */
function metal(p: Painter, f0: number, f1: number, color: string, finish: Surface = POLISHED): void {
  p.band(f0, f1, { color: (g, _C, len) => vgrad(g, 0, len, [shadeHex(color, 0.25), color, shadeHex(color, -0.12)]), surface: finish, bump: 0.62 });
  const groove = { color: shadeHex(color, -0.7), bump: 0.25, surface: [0, 0.6, 0.3] as Surface };
  p.band(f0, f0 + 0.0011, groove);
  p.band(f1 - 0.0011, f1, groove);
}

/** A thin line of colour all the way round. */
function line(p: Painter, f: number, width: number, paint: Paint): void {
  p.band(f - width / 2, f + width / 2, paint);
}

/** A ring of round inlays, the first centred on the top. */
function dots(p: Painter, f: number, count: number, size: number, paint: Paint, phase = 0.5): void {
  const half = (size / MM) * 0.75;
  p.shape(f - half, f + half, (g, C, len) => {
    for (let k = 0; k < count; k++) {
      const x = ((phase + k / count) % 1) * C;
      g.moveTo(x + size / 2, len / 2);
      g.ellipse(x, len / 2, size / 2, size / 2, 0, 0, TAU);
    }
  }, paint);
}

/** Mother-of-pearl: a cool white with a pastel shimmer, as a radial fill for small inlays. */
function pearl(): Fill {
  return (g, C, len) => {
    const gr = g.createLinearGradient(0, 0, C / 8, len);
    gr.addColorStop(0, '#fdfbff');
    gr.addColorStop(0.4, '#e3f1f6');
    gr.addColorStop(0.7, '#f7e6f1');
    gr.addColorStop(1, '#f2f6e6');
    return gr;
  };
}

/**
 * Spliced points: `count` spears rising from the butt end of a section (or from the tip end,
 * `reverse`), `reach` of the way along it, each drawn as nested veneers `inset` mm apart.
 */
function points(p: Painter, f0: number, f1: number, count: number, reach: number, veneers: { inset: number; paint: Paint }[], reverse = false, phase = 0.5, width = 0.92): void {
  for (const { inset, paint } of veneers) {
    p.shape(f0, f1, (g, C, len) => {
      const half = (C / count / 2) * width;
      const height = len * reach;
      const slant = Math.hypot(half, height);
      const h = half - (inset * slant) / height;
      const lift = (inset * slant) / half;
      if (h <= 0 || lift >= height) return;
      const baseY = reverse ? -1 : len + 1;
      const apexY = reverse ? height - lift : len - height + lift;
      for (let k = 0; k < count; k++) {
        const x = ((phase + k / count) % 1) * C;
        g.moveTo(x - h, baseY);
        g.lineTo(x, apexY);
        g.lineTo(x + h, baseY);
        g.closePath();
      }
    }, paint);
  }
}

/** Small lozenges ahead of each point, the classic finishing touch. */
function diamonds(p: Painter, f: number, count: number, w: number, h: number, paint: Paint, phase = 0.5): void {
  const half = (h / MM) * 0.6;
  p.shape(f - half, f + half, (g, C, len) => {
    for (let k = 0; k < count; k++) {
      const x = ((phase + k / count) % 1) * C;
      g.moveTo(x, len / 2 - h / 2);
      g.lineTo(x + w / 2, len / 2);
      g.lineTo(x, len / 2 + h / 2);
      g.lineTo(x - w / 2, len / 2);
      g.closePath();
    }
  }, paint);
}

/** A diagonal crosshatch — Irish linen, a knurled grip, a quilted panel, an LED mesh. */
function hatch(p: Painter, f0: number, f1: number, pitch: number, fn: (px: Px, seam: number, cell: number, a: number, b: number, C: number) => void): void {
  const n = Math.max(6, Math.round(circumference((f0 + f1) / 2) / pitch));
  p.pixels(f0, f1, (px, a, b, C, u) => {
    const s1 = u * n + b / pitch;
    const s2 = u * n - b / pitch;
    const d1 = Math.abs(s1 - Math.round(s1));
    const d2 = Math.abs(s2 - Math.round(s2));
    // `seam` is 0 on a crossing line and 0.5 in the middle of a diamond.
    fn(px, Math.min(d1, d2), Math.floor(s1) * 7 + Math.floor(s2), a, b, C);
  });
}

/** Irish linen: tight crossing threads with a little slub. */
function linen(p: Painter, f0: number, f1: number, base: string, thread: string, seed = 31): void {
  const B = hexToRgb(base);
  const T = hexToRgb(thread);
  hatch(p, f0, f1, 1.3, (px, seam, _cell, a, b, C) => {
    const slub = skin(a, b, C, 0.5, 2, seed);
    mixTo(px.color, B, T, clamp01(smoothstep(0.08, 0.3, seam) * 0.55 + (slub - 0.5) * 0.5));
    px.surface[0] = 0;
    px.surface[1] = 0.85;
    px.surface[2] = 0;
    px.bump = 0.25 + smoothstep(0, 0.3, seam) * 0.6;
  });
}

/** Pebbled leather with a stitched seam at each end. */
function leather(p: Painter, f0: number, f1: number, base: string, thread: string): void {
  const B = hexToRgb(base);
  const hi = hexToRgb(shadeHex(base, 0.12));
  p.pixels(f0, f1, (px, a, b, C) => {
    const pebble = skin(a, b, C, 0.8, 2, 21);
    const tone = skin(a, b, C, 0.06, 2, 22);
    mixTo(px.color, B, hi, clamp01((pebble - 0.45) * 1.4 + (tone - 0.5) * 0.8));
    px.surface[0] = 0.15;
    px.surface[1] = 0.5 + (0.5 - pebble) * 0.3;
    px.surface[2] = 0;
    px.bump = 0.5 + (pebble - 0.5) * 0.9;
  });
  for (const f of [f0 + 0.0045, f1 - 0.0045]) stitches(p, f, thread, 1.9);
}

/** A row of stitches round the cue. */
function stitches(p: Painter, f: number, thread: string, pitch: number): void {
  p.shape(f - 0.002, f + 0.002, (g, C, len) => {
    const n = Math.round(C / pitch);
    for (let k = 0; k < n; k++) {
      const x = (k / n) * C;
      g.moveTo(x, len / 2 + 0.35);
      g.lineTo(x + pitch * 0.6, len / 2 - 0.35);
    }
  }, { color: thread, bump: 0.8, surface: SATIN }, 0.55);
}

/** Moulded rubber: fine rings you can see the light run along. */
function ribs(p: Painter, f0: number, f1: number, base: string, pitch: number): void {
  const B = hexToRgb(base);
  const hi = hexToRgb(shadeHex(base, 0.22));
  p.pixels(f0, f1, (px, _a, b) => {
    const t = b / pitch;
    const crest = Math.sin((t - Math.floor(t)) * Math.PI);
    mixTo(px.color, B, hi, crest * crest);
    px.surface[0] = 0;
    px.surface[1] = 0.62;
    px.surface[2] = 0;
    px.bump = 0.2 + crest * 0.7;
  });
}

/** Bright lines running along the cue at the given positions round it, with a soft halo. */
function lightLines(p: Painter, f0: number, f1: number, at: number[], width: number, core: string, glow: string, fadeIn = 0): void {
  const path = (w: number) => (g: CanvasRenderingContext2D, C: number, len: number) => {
    for (const u of at) g.rect(u * C - w / 2, 0, w, len);
    void len;
  };
  const fade = (c: string, a: number): Fill => (g, _C, len) => vgrad(g, 0, len, fadeIn ? [alpha(c, 0), alpha(c, a), alpha(c, a)] : [alpha(c, a), alpha(c, a)]);
  p.shape(f0, f1, path(width * 3.2), { color: fade(glow, 0.35), glow: fade(glow, 0.45) });
  p.shape(f0, f1, path(width), { color: fade(core, 1), glow: fade(glow, 1), surface: [1, 0.2, 0] });
}

/** Stars: fine dots, and now and then a four-pointed sparkle. */
function stars(p: Painter, f0: number, f1: number, density: number, seed: number, glow = true): void {
  const draw = (sparkle: boolean) => (g: CanvasRenderingContext2D, C: number, len: number) => {
    const r = rng(seed);
    const n = Math.round(((C * len) / 100) * density);
    for (let i = 0; i < n; i++) {
      const x = r() * C;
      const y = r() * len;
      const big = r() > 0.9;
      const s = big ? 0.5 + r() * 0.4 : 0.2 + r() * 0.25;
      if (sparkle !== big) continue;
      if (big) {
        const arm = s * 4;
        g.moveTo(x, y - arm);
        g.quadraticCurveTo(x, y, x + arm, y);
        g.quadraticCurveTo(x, y, x, y + arm);
        g.quadraticCurveTo(x, y, x - arm, y);
        g.quadraticCurveTo(x, y, x, y - arm);
      } else {
        g.moveTo(x + s, y);
        g.ellipse(x, y, s, s, 0, 0, TAU);
      }
    }
  };
  for (const sparkle of [false, true]) p.shape(f0, f1, draw(sparkle), { color: '#ffffff', glow: glow ? '#ffffff' : undefined, surface: [1, 0.15, 0] });
}

// ------------------------------------------------------------------ common parts

/** Blue chalk worked into the leather: dustier at the crown, scuffed on the side. */
function tip(p: Painter): void {
  const deep = hexToRgb('#1f55c9');
  const dust = hexToRgb('#6fa2ff');
  p.pixels(0, PART.ferrule, (px, a, b, C) => {
    const n = skin(a, b, C, 1.1, 2, 5);
    const crown = 1 - b / (PART.ferrule * MM);
    mixTo(px.color, deep, dust, clamp01((n - 0.4) * 1.6 + crown * 0.35));
    px.surface[0] = 0;
    px.surface[1] = 0.95;
    px.surface[2] = 0;
    px.bump = 0.5 + (n - 0.5) * 0.7;
  });
  line(p, PART.ferrule - 0.0006, 0.0012, { color: '#0d1d3f' });
}

function ferrule(p: Painter, tint = IVORY): void {
  p.band(PART.ferrule, PART.shaft, { color: (g, _C, len) => vgrad(g, 0, len, ['#ffffff', tint, shadeHex(tint, -0.04)]), surface: [1, 0.18, 0], bump: 0.55 });
  line(p, PART.shaft - 0.0007, 0.0014, { color: shadeHex(tint, -0.35), bump: 0.3 });
}

function bumper(p: Painter): void {
  p.band(PART.bumper, 1, { color: '#131314', surface: [0, 0.78, 0], bump: 0.5 });
  line(p, PART.bumper + 0.0025, 0.0012, { color: '#2a2a2c', bump: 0.3 });
}

/** A shaft finish that darkens a touch toward the joint, as real ones do where hands have been. */
function shaftShade(p: Painter, amount: number): void {
  p.band(PART.shaft, PART.collar, { color: (g, _C, len) => vgrad(g, 0, len, ['rgba(0,0,0,0)', 'rgba(0,0,0,0)', `rgba(0,0,0,${amount})`]) });
}

// ------------------------------------------------------------------ liveries

/** Honey maple, a figured walnut butt, brass fittings and a stitched leather wrap. */
function oak(p: Painter, s: CueStyle): void {
  const brass = s.collar ?? s.accent;
  wood(p, PART.shaft, PART.collar, { base: s.shaft, dark: shadeHex(s.shaft, -0.16), figure: 3, contrast: 0.28, fibre: 0.05, seed: 11 });
  shaftShade(p, 0.1);
  const c0 = PART.collar;
  const c1 = PART.forearm;
  metal(p, c0, c0 + 0.009, brass);
  wood(p, c0 + 0.009, c1 - 0.009, { base: s.butt, dark: shadeHex(s.butt, -0.5), figure: 4, seed: 6 });
  line(p, c0 + 0.0115, 0.0016, { color: IVORY });
  line(p, c1 - 0.0115, 0.0016, { color: IVORY });
  metal(p, c1 - 0.009, c1, brass);
  wood(p, c1, PART.ring, { base: s.butt, dark: shadeHex(s.butt, -0.55), figure: 6, contrast: 0.6, seed: 4 });
  line(p, c1 + 0.006, 0.0016, { color: IVORY });
  line(p, PART.ring - 0.006, 0.0016, { color: IVORY });
  metal(p, PART.ring, PART.wrap, brass);
  leather(p, PART.wrap, PART.ring2, s.wrap, brass);
  metal(p, PART.ring2, PART.sleeve, brass);
  wood(p, PART.sleeve, PART.bumper, { base: s.butt, dark: shadeHex(s.butt, -0.55), figure: 6, contrast: 0.6, seed: 8 });
  metal(p, 0.958, 0.966, brass);
  line(p, 0.975, 0.0016, { color: IVORY });
}

/** Black carbon weave, brushed steel and a moulded rubber grip — a tool, not an ornament. */
function carbon(p: Painter, s: CueStyle): void {
  const steel = s.collar ?? s.accent;
  weave(p, PART.shaft, PART.collar, shadeHex(s.shaft, -0.3), shadeHex(s.shaft, 0.1), 3, 0.35);
  // Laser-etched graphics toward the joint, on top where you look down the cue.
  line(p, 0.392, 0.0014, { color: steel, surface: POLISHED });
  p.shape(0.4, 0.458, (g, C, len) => {
    for (const u of [0.5, 0]) {
      for (let k = 0; k < 7; k++) {
        const x = u * C;
        const y = 4 + k * ((len - 8) / 6);
        g.moveTo(x - 4.2, y + 2.6);
        g.lineTo(x, y);
        g.lineTo(x + 4.2, y + 2.6);
      }
    }
  }, { color: steel, surface: POLISHED, bump: 0.65 }, 0.9);
  line(p, 0.463, 0.0014, { color: steel, surface: POLISHED });
  metal(p, PART.collar, PART.forearm, steel, BRUSHED);
  line(p, PART.collar + 0.013, 0.0012, { color: shadeHex(steel, -0.6), bump: 0.25 });
  line(p, PART.forearm - 0.013, 0.0012, { color: shadeHex(steel, -0.6), bump: 0.25 });
  weave(p, PART.forearm, PART.ring, s.butt, shadeHex(s.shaft, 0.28), 4);
  metal(p, 0.708, 0.72, steel, BRUSHED);
  metal(p, PART.ring, PART.wrap, steel, BRUSHED);
  ribs(p, PART.wrap, PART.ring2, s.wrap, 2.4);
  metal(p, PART.ring2, PART.sleeve, steel, BRUSHED);
  weave(p, PART.sleeve, PART.bumper, s.butt, shadeHex(s.shaft, 0.28), 4);
  // A knurled steel band: diamonds cut into the metal.
  const S = hexToRgb(steel);
  const lo = hexToRgb(shadeHex(steel, -0.45));
  hatch(p, 0.95, 0.974, 1.5, (px, seam) => {
    const ridge = smoothstep(0.05, 0.4, seam);
    mixTo(px.color, lo, S, ridge);
    px.surface[0] = 0.1;
    px.surface[1] = 0.3;
    px.surface[2] = 1;
    px.bump = 0.2 + ridge * 0.7;
  });
  line(p, 0.95, 0.0012, { color: shadeHex(steel, -0.6) });
  line(p, 0.974, 0.0012, { color: shadeHex(steel, -0.6) });
}

/** Pale maple on jet-black ebony: gold points edged in ivory, pearl inlays, gold fittings. */
function ebony(p: Painter, s: CueStyle): void {
  const gold = s.collar ?? s.accent;
  const blackWood = (f0: number, f1: number, seed: number) => wood(p, f0, f1, { base: s.butt, dark: '#000000', figure: 5, contrast: 0.5, fibre: 0.12, seed });
  wood(p, PART.shaft, PART.collar, { base: s.shaft, dark: shadeHex(s.shaft, -0.1), figure: 3, contrast: 0.2, fibre: 0.04, seed: 12 });
  shaftShade(p, 0.06);
  const c0 = PART.collar;
  const c1 = PART.forearm;
  metal(p, c0, c0 + 0.006, gold);
  blackWood(c0 + 0.006, c1 - 0.006, 2);
  dots(p, (c0 + c1) / 2, 6, 3.4, { color: pearl(), surface: [1, 0.12, 0], bump: 0.6 });
  metal(p, c1 - 0.006, c1, gold);
  blackWood(c1, PART.ring, 5);
  points(p, c1, PART.ring, 4, 0.8, [
    { inset: 0, paint: { color: IVORY, surface: GLOSS, bump: 0.58 } },
    { inset: 1, paint: { color: EBONY } },
    { inset: 1.6, paint: { color: (g, _C, len) => vgrad(g, 0, len, [shadeHex(gold, 0.3), gold, shadeHex(gold, -0.15)]), surface: POLISHED, bump: 0.62 } },
  ]);
  diamonds(p, c1 + 0.028, 4, 3.4, 8, { color: pearl(), surface: [1, 0.12, 0], bump: 0.62 });
  dots(p, PART.ring - 0.012, 4, 2.4, { color: pearl(), surface: [1, 0.12, 0], bump: 0.6 }, 0.625);
  metal(p, PART.ring, PART.wrap, gold);
  line(p, (PART.ring + PART.wrap) / 2, 0.0014, { color: EBONY });
  linen(p, PART.wrap, PART.ring2, s.wrap, shadeHex(s.wrap, 0.3));
  metal(p, PART.ring2, PART.sleeve, gold);
  blackWood(PART.sleeve, PART.bumper, 9);
  points(p, PART.sleeve, 0.978, 4, 0.72, [
    { inset: 0, paint: { color: IVORY, surface: GLOSS } },
    { inset: 0.8, paint: { color: gold, surface: POLISHED, bump: 0.62 } },
  ], true);
  dots(p, 0.955, 4, 2.6, { color: pearl(), surface: [1, 0.12, 0], bump: 0.6 }, 0.625);
  metal(p, 0.981, 0.986, gold);
}

/** Midnight lacquer with light running through it: lines along the shaft, rings on the butt. */
function neon(p: Painter, s: CueStyle): void {
  const glow = s.glow ?? s.accent;
  const core = shadeHex(glow, 0.65);
  const chrome = s.collar ?? '#3b4252';
  p.band(PART.shaft, PART.collar, { color: (g, _C, len) => vgrad(g, 0, len, [shadeHex(s.shaft, 0.1), s.shaft, shadeHex(s.shaft, -0.25)]), surface: [1, 0.3, 0] });
  lightLines(p, PART.shaft + 0.012, PART.collar, [0.5, 0], 1.1, core, glow, 1);
  metal(p, PART.collar, PART.forearm, chrome);
  const mid = (PART.collar + PART.forearm) / 2;
  p.band(mid - 0.0045, mid + 0.0045, { color: core, glow, surface: [1, 0.2, 0], bump: 0.4 });
  p.band(PART.forearm, PART.ring, { color: (g, _C, len) => vgrad(g, 0, len, [s.butt, shadeHex(s.butt, 0.08), s.butt]), surface: [1, 0.28, 0] });
  lightLines(p, PART.forearm, PART.ring, [0.5, 0], 0.9, core, glow);
  // Rings, stepping wider toward the butt, each a hot white core in a halo.
  const rings = [0.54, 0.572, 0.6, 0.625, 0.648, 0.668, 0.686, 0.702, 0.716, 0.729];
  rings.forEach((f, i) => {
    const w = 0.0016 + i * 0.00032;
    p.band(f - w * 1.6, f + w * 1.6, { color: alpha(glow, 0.45), glow: alpha(glow, 0.5) });
    p.band(f - w / 2, f + w / 2, { color: core, glow, surface: [1, 0.2, 0], bump: 0.4 });
  });
  p.band(PART.ring, PART.wrap, { color: core, glow, surface: [1, 0.2, 0], bump: 0.6 });
  // Grip: a fine LED mesh over dark rubber.
  const W = hexToRgb(s.wrap);
  const G = hexToRgb(glow);
  hatch(p, PART.wrap, PART.ring2, 3.2, (px, seam) => {
    const on = 1 - smoothstep(0.02, 0.07, seam);
    mixTo(px.color, W, G, on * 0.7);
    px.glow[0] = G[0] * on * 0.55;
    px.glow[1] = G[1] * on * 0.55;
    px.glow[2] = G[2] * on * 0.55;
    px.surface[0] = 0.2;
    px.surface[1] = 0.6;
    px.surface[2] = 0;
    px.bump = 0.5 - on * 0.2;
  });
  metal(p, PART.ring2, PART.sleeve, chrome);
  p.band(PART.sleeve, PART.bumper, { color: (g, _C, len) => vgrad(g, 0, len, [shadeHex(chrome, -0.3), shadeHex(chrome, -0.5)]), surface: POLISHED, bump: 0.6 });
  for (const f of [0.948, 0.962, 0.976]) p.band(f - 0.0018, f + 0.0018, { color: core, glow, surface: [1, 0.2, 0], bump: 0.45 });
  line(p, PART.bumper - 0.002, 0.0016, { color: core, glow });
}

/** Hot-rod flames: tongues licking from `base` toward the tip, in nested heats. */
function flames(p: Painter, f0: number, f1: number, count: number, seed: number, heat: number): void {
  const tongues = (scale: number) => (g: CanvasRenderingContext2D, C: number, len: number) => {
    const r = rng(seed);
    for (let k = 0; k < count; k++) {
      const x = ((0.5 + k / count) % 1) * C + (r() - 0.5) * (C / count) * 0.3;
      const hw = (C / count) * 0.62 * scale;
      const tall = len * (0.55 + r() * 0.45) * scale;
      const sway = (r() - 0.5) * hw * 2.4;
      const baseY = len + 1;
      const tipY = len - tall;
      g.moveTo(x - hw, baseY);
      g.bezierCurveTo(x - hw * 1.1, baseY - tall * 0.45, x + sway - hw * 0.9, tipY + tall * 0.4, x + sway, tipY);
      g.bezierCurveTo(x + sway - hw * 0.1, tipY + tall * 0.42, x + hw * 1.15, baseY - tall * 0.5, x + hw, baseY);
      g.closePath();
    }
  };
  p.shape(f0, f1, tongues(1), {
    color: (g, _C, len) => vgrad(g, 0, len, ['#8e1606', '#e0330c', '#ff6a12']),
    glow: (g, _C, len) => vgrad(g, 0, len, [alpha('#c42008', 0.5 * heat), alpha('#ff5a14', 0.8 * heat)]),
    surface: [1, 0.3, 0],
    bump: 0.58,
  });
  p.shape(f0, f1, tongues(0.66), {
    color: (g, _C, len) => vgrad(g, 0, len, ['#ff7a18', '#ffb12a']),
    glow: (g, _C, len) => vgrad(g, 0, len, [alpha('#ff7a18', 0.8 * heat), alpha('#ffb12a', heat)]),
  });
  p.shape(f0, f1, tongues(0.36), {
    color: (g, _C, len) => vgrad(g, 0, len, ['#ffd84a', '#fff4c2']),
    glow: (g, _C, len) => vgrad(g, 0, len, [alpha('#ffd84a', heat), alpha('#fff4c2', heat)]),
  });
}

/** Charred lacquer, flames from the joint and the butt, embers drifting up the shaft. */
function inferno(p: Painter, s: CueStyle): void {
  const copper = s.collar ?? '#c8683a';
  const glow = s.glow ?? s.accent;
  p.band(PART.shaft, PART.collar, { color: (g, _C, len) => vgrad(g, 0, len, [shadeHex(s.shaft, -0.2), s.shaft, s.shaft, '#5a160a']), surface: [1, 0.3, 0] });
  // Embers, thickening toward the joint.
  p.shape(0.2, PART.collar, (g, C, len) => {
    const r = rng(77);
    for (let i = 0; i < 90; i++) {
      const y = len * Math.sqrt(r());
      const x = r() * C;
      const s2 = 0.25 + r() * 0.4;
      g.moveTo(x + s2, y);
      g.ellipse(x, y, s2, s2 * 1.6, 0, 0, TAU);
    }
  }, { color: '#ffb347', glow: '#ff7a1a' });
  flames(p, 0.36, PART.collar, 6, 5, 0.8);
  metal(p, PART.collar, PART.forearm, '#2b2324');
  const mid = (PART.collar + PART.forearm) / 2;
  p.band(mid - 0.008, mid + 0.008, {
    color: (g, _C, len) => vgrad(g, 0, len, ['#5a1206', '#ff7a1a', '#ffd76a', '#ff7a1a', '#5a1206']),
    glow: (g, _C, len) => vgrad(g, 0, len, ['#000000', glow, '#ffc34a', glow, '#000000']),
    surface: [1, 0.25, 0],
  });
  p.band(PART.forearm, PART.ring, { color: s.butt, surface: [1, 0.3, 0] });
  flames(p, PART.forearm, PART.ring, 5, 9, 0.9);
  metal(p, PART.ring, PART.wrap, copper);
  // Grip: black with lava glowing through the cracks.
  const W = hexToRgb(s.wrap);
  const R = hexToRgb('#ff4a10');
  const Y = hexToRgb('#ffb12a');
  const hot: RGB = [0, 0, 0];
  p.pixels(PART.wrap, PART.ring2, (px, a, b, C) => {
    const n = skin(a, b, C, 0.16, 3, 13);
    const crack = 1 - smoothstep(0, 0.045, Math.abs(n - 0.5));
    const pore = skin(a, b, C, 0.9, 1, 14);
    mixTo(hot, R, Y, crack * crack);
    mixTo(px.color, W, hot, crack * 0.85);
    px.color[0] *= 0.85 + pore * 0.3;
    px.glow[0] = hot[0] * crack * 0.75;
    px.glow[1] = hot[1] * crack * 0.75;
    px.glow[2] = hot[2] * crack * 0.75;
    px.surface[0] = 0.1;
    px.surface[1] = 0.7;
    px.surface[2] = 0;
    px.bump = 0.6 - crack * 0.35 + (pore - 0.5) * 0.2;
  });
  metal(p, PART.ring2, PART.sleeve, copper);
  p.band(PART.sleeve, PART.bumper, { color: s.butt, surface: [1, 0.3, 0] });
  flames(p, PART.sleeve, PART.bumper, 6, 21, 0.7);
  metal(p, 0.972, 0.978, copper);
}

/** Dendrites of frost, growing from `base` toward the tip. */
function frostFern(p: Painter, f0: number, f1: number, seed: number, paint: Paint, width: number): void {
  p.shape(f0, f1, (g, C, len) => {
    const r = rng(seed);
    const grow = (x: number, y: number, ang: number, l: number, depth: number): void => {
      const x2 = x + Math.sin(ang) * l;
      const y2 = y - Math.cos(ang) * l;
      g.moveTo(x, y);
      g.lineTo(x2, y2);
      if (depth <= 0) return;
      const sprigs = 2 + Math.floor(r() * 2);
      for (let i = 1; i <= sprigs; i++) {
        const t = i / (sprigs + 1);
        const side = i % 2 ? 1 : -1;
        grow(x + (x2 - x) * t, y + (y2 - y) * t, ang + side * (0.8 + r() * 0.3), l * (0.38 - t * 0.12), depth - 1);
      }
      grow(x2, y2, ang + (r() - 0.5) * 0.5, l * 0.62, depth - 1);
    };
    const n = 9;
    for (let k = 0; k < n; k++) grow(((k + r() * 0.6) / n) * C, len + 1, (r() - 0.5) * 0.7, len * (0.3 + r() * 0.25), 3);
  }, paint, width);
}

/** Ice-white resin with frost creeping from the joint, a crystal butt, snowflakes on the sleeve. */
function frost(p: Painter, s: CueStyle): void {
  const glow = s.glow ?? s.accent;
  const silver = s.collar ?? '#e8f0f6';
  const ice = hexToRgb(s.shaft);
  const white = hexToRgb('#ffffff');
  const blue = hexToRgb(shadeHex(s.shaft, -0.12));
  p.pixels(PART.shaft, PART.collar, (px, a, b, C) => {
    const n = skin(a, b, C, 0.05, 3, 17, 4);
    mixTo(px.color, blue, ice, smoothstep(0.3, 0.6, n));
    mixTo(px.color, px.color, white, smoothstep(0.6, 0.85, n) * 0.6);
    px.surface[0] = 1;
    px.surface[1] = 0.22;
    px.surface[2] = 0;
    px.bump = 0.5;
  });
  frostFern(p, 0.34, PART.collar, 3, { color: alpha('#ffffff', 0.9), glow: alpha(glow, 0.35), bump: 0.62 }, 0.42);
  metal(p, PART.collar, PART.forearm, silver);
  const mid = (PART.collar + PART.forearm) / 2;
  p.band(mid - 0.004, mid + 0.004, { color: '#e9fbff', glow, surface: [1, 0.15, 0] });
  // Forearm: cut crystal, pale at the joint and deepening to the wrap.
  p.band(PART.forearm, PART.ring, { color: (g, _C, len) => vgrad(g, 0, len, ['#c8ecff', s.butt, shadeHex(s.butt, -0.45)]), surface: [1, 0.12, 0] });
  const facets = (fill: (r: () => number) => string) => (g: CanvasRenderingContext2D, C: number, len: number) => {
    const r = rng(41);
    for (let i = 0; i < 70; i++) {
      const cx = r() * C;
      const cy = r() * len;
      const size = 3 + r() * 9;
      const sides = 3 + Math.floor(r() * 3);
      const spin = r() * TAU;
      const style = fill(r);
      g.fillStyle = style;
      g.beginPath();
      for (let k = 0; k < sides; k++) {
        const ang = spin + (k / sides) * TAU + (r() - 0.5) * 0.6;
        const rad = size * (0.6 + r() * 0.5);
        g.lineTo(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad * 1.8);
      }
      g.closePath();
      g.fill();
    }
  };
  p.shape(PART.forearm, PART.ring, facets((r) => (r() > 0.5 ? `rgba(255,255,255,${0.1 + r() * 0.22})` : `rgba(10,50,110,${0.08 + r() * 0.18})`)), { color: 'rgba(0,0,0,0)' });
  points(p, PART.forearm, PART.ring, 4, 0.74, [
    { inset: 0, paint: { color: '#ffffff', glow: alpha(glow, 0.5), surface: [1, 0.1, 0], bump: 0.62 } },
    { inset: 1.1, paint: { color: (g, _C, len) => vgrad(g, 0, len, ['#e6f7ff', '#9fd8ff']), surface: [1, 0.1, 0] } },
  ], false, 0.5, 0.55);
  metal(p, PART.ring, PART.wrap, silver);
  linen(p, PART.wrap, PART.ring2, s.wrap, '#a9d6f2', 33);
  metal(p, PART.ring2, PART.sleeve, silver);
  p.band(PART.sleeve, PART.bumper, { color: (g, _C, len) => vgrad(g, 0, len, [s.butt, shadeHex(s.butt, -0.35)]), surface: [1, 0.12, 0] });
  // Snowflakes, one on top and one beneath.
  p.shape(PART.sleeve, 0.978, (g, C, len) => {
    for (const u of [0.5, 0, 0.25, 0.75]) {
      const x = u * C;
      const y = len * 0.48;
      const R = u === 0.5 || u === 0 ? 7 : 4.5;
      for (let k = 0; k < 6; k++) {
        const ang = (k / 6) * TAU;
        const dx = Math.cos(ang);
        const dy = Math.sin(ang);
        g.moveTo(x, y);
        g.lineTo(x + dx * R, y + dy * R);
        for (const t of [0.45, 0.72]) {
          const bx = x + dx * R * t;
          const by = y + dy * R * t;
          for (const side of [-1, 1]) {
            const a2 = ang + side * 0.8;
            g.moveTo(bx, by);
            g.lineTo(bx + Math.cos(a2) * R * 0.28, by + Math.sin(a2) * R * 0.28);
          }
        }
      }
    }
  }, { color: '#ffffff', glow: alpha(glow, 0.8), bump: 0.62, surface: [1, 0.1, 0] }, 0.7);
  metal(p, 0.981, 0.986, silver);
}

/** Painted cloud: deep space through violet and magenta to a cyan-white core, with its own light. */
function nebulaCloud(p: Painter, f0: number, f1: number, s: CueStyle, strength: (f: number) => number, seed: number): void {
  const deep = hexToRgb(s.butt);
  const mid = hexToRgb(s.shaft);
  const violet = hexToRgb(s.glow ?? '#b57bff');
  const pink = hexToRgb('#ff5fcf');
  const cyan = hexToRgb('#8ff3ff');
  const c: RGB = [0, 0, 0];
  p.pixels(f0, f1, (px, a, b, C, _u, f) => {
    const k = strength(f);
    const big = skin(a, b, C, 0.03, 4, seed, 2);
    const wisp = skin(a, b, C, 0.09, 3, seed + 7, 1.6);
    const cloud = smoothstep(0.38, 0.78, big) * k;
    mixTo(c, deep, mid, clamp01(big * 1.4));
    mixTo(c, c, violet, cloud);
    mixTo(c, c, pink, smoothstep(0.52, 0.8, wisp) * cloud);
    mixTo(c, c, cyan, smoothstep(0.72, 0.9, big) * smoothstep(0.35, 0.6, wisp) * k);
    px.color[0] = c[0];
    px.color[1] = c[1];
    px.color[2] = c[2];
    const g = cloud * 0.55;
    px.glow[0] = c[0] * g;
    px.glow[1] = c[1] * g;
    px.glow[2] = c[2] * g;
    px.surface[0] = 1;
    px.surface[1] = 0.25;
    px.surface[2] = 0;
    px.bump = 0.5;
  });
}

/** A galaxy turned on a lathe: a starry shaft brightening into a blazing nebula butt. */
function nebula(p: Painter, s: CueStyle): void {
  const silver = s.collar ?? '#dcdff0';
  const glow = s.glow ?? s.accent;
  nebulaCloud(p, PART.shaft, PART.collar, s, (f) => smoothstep(0.12, PART.collar, f) * 0.75, 42);
  stars(p, PART.shaft + 0.01, PART.collar, 0.5, 3);
  metal(p, PART.collar, PART.forearm, silver);
  const mid = (PART.collar + PART.forearm) / 2;
  p.band(mid - 0.004, mid + 0.004, { color: s.accent, glow, surface: [1, 0.15, 0] });
  nebulaCloud(p, PART.forearm, PART.ring, s, () => 1, 43);
  stars(p, PART.forearm, PART.ring, 1.2, 4);
  metal(p, PART.ring, PART.wrap, silver);
  linen(p, PART.wrap, PART.ring2, s.wrap, shadeHex(s.wrap, 0.35), 35);
  stars(p, PART.wrap, PART.ring2, 0.35, 5, false);
  metal(p, PART.ring2, PART.sleeve, silver);
  nebulaCloud(p, PART.sleeve, PART.bumper, s, () => 0.9, 44);
  stars(p, PART.sleeve, PART.bumper, 1, 6);
  metal(p, 0.977, 0.982, silver);
}

/** Engraved acanthus: little scrolls curling in alternate directions, cut into the metal. */
function scrollwork(p: Painter, f0: number, f1: number, color: string, seed: number): void {
  p.shape(f0, f1, (g, C, len) => {
    const r = rng(seed);
    const cols = Math.max(4, Math.round(C / 11));
    const rows = Math.max(2, Math.round(len / 11));
    const cw = C / cols;
    const rh = len / rows;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const cx = (i + 0.5 + (j % 2) * 0.5) * cw;
        const cy = (j + 0.5) * rh;
        const dir = (i + j) % 2 ? 1 : -1;
        const start = r() * TAU;
        g.moveTo(cx + Math.cos(start) * cw * 0.42, cy + Math.sin(start) * rh * 0.42);
        for (let t = 0; t <= 1.001; t += 0.05) {
          const ang = start + dir * t * TAU * 1.4;
          const rad = 0.42 * (1 - t * 0.8);
          g.lineTo(cx + Math.cos(ang) * cw * rad, cy + Math.sin(ang) * rh * rad);
        }
      }
    }
  }, { color, bump: 0.3, surface: [0.3, 0.4, 1] }, 0.5);
}

/** Solid gold: engraved, set with black enamel points and diamonds, on a quilted black grip. */
function midas(p: Painter, s: CueStyle): void {
  const gold = s.shaft;
  const plat = s.collar ?? '#eceae4';
  const cut = shadeHex(s.butt, -0.45);
  p.band(PART.shaft, PART.collar, { color: (g, _C, len) => vgrad(g, 0, len, [shadeHex(gold, 0.1), gold, shadeHex(gold, -0.08)]), surface: [0.8, 0.14, 1] });
  line(p, 0.44, 0.0012, { color: cut, bump: 0.3 });
  line(p, 0.448, 0.0012, { color: cut, bump: 0.3 });
  metal(p, PART.collar, PART.collar + 0.006, plat);
  p.band(PART.collar + 0.006, PART.forearm - 0.006, { color: '#0c0b0a', surface: [1, 0.15, 0] });
  const sparkle: Paint = { color: '#ffffff', glow: '#ffffff', surface: [1, 0.05, 0], bump: 0.7 };
  diamonds(p, (PART.collar + PART.forearm) / 2, 6, 3, 6, sparkle);
  metal(p, PART.forearm - 0.006, PART.forearm, plat);
  p.band(PART.forearm, PART.ring, { color: (g, _C, len) => vgrad(g, 0, len, [shadeHex(gold, 0.08), s.butt, gold]), surface: [0.6, 0.2, 1] });
  scrollwork(p, PART.forearm, PART.ring, cut, 7);
  points(p, PART.forearm, PART.ring, 4, 0.82, [
    { inset: 0, paint: { color: plat, surface: POLISHED, bump: 0.66 } },
    { inset: 0.9, paint: { color: '#0b0a09', surface: [1, 0.12, 0], bump: 0.6 } },
  ], false, 0.5, 0.7);
  diamonds(p, PART.forearm + 0.022, 4, 3, 7, sparkle);
  metal(p, PART.ring, PART.wrap, plat);
  // Grip: black leather quilted with gold thread.
  const B = hexToRgb(s.wrap);
  const hi = hexToRgb(shadeHex(s.wrap, 0.2));
  const G = hexToRgb(s.accent);
  hatch(p, PART.wrap, PART.ring2, 6, (px, seam, _cell, _a, b) => {
    const puff = smoothstep(0, 0.45, seam);
    mixTo(px.color, B, hi, puff * 0.8);
    const stitch = seam < 0.03 && Math.sin(b * 2.4) > 0 ? 1 : 0;
    mixTo(px.color, px.color, G, stitch);
    px.surface[0] = 0.3;
    px.surface[1] = stitch ? 0.35 : 0.5;
    px.surface[2] = stitch;
    px.bump = 0.25 + puff * 0.6;
  });
  metal(p, PART.ring2, PART.sleeve, gold);
  p.band(PART.sleeve, PART.bumper, { color: (g, _C, len) => vgrad(g, 0, len, [gold, s.butt]), surface: [0.6, 0.2, 1] });
  scrollwork(p, PART.sleeve, 0.962, cut, 9);
  p.band(0.964, 0.976, { color: '#0c0b0a', surface: [1, 0.15, 0] });
  diamonds(p, 0.97, 6, 2.6, 5, sparkle);
  metal(p, 0.978, 0.984, plat);
}

const LIVERIES: Record<CuePattern, (p: Painter, s: CueStyle) => void> = {
  plain: oak,
  carbon,
  points: ebony,
  rings: neon,
  flame: inferno,
  ice: frost,
  nebula,
  gold: midas,
};

/** Texture height for each quality: the length of the cue, in texels. The width is an eighth. */
const DETAIL = { low: 512, medium: 1024, high: 2048 } as const;

/** Paints a cue's livery. `quality` sets the texture size; 'low' also skips the bump map. */
export function paintCue(style: CueStyle, quality: keyof typeof DETAIL = 'medium'): CueTextures {
  const p = new Painter(DETAIL[quality] / 8);
  tip(p);
  ferrule(p);
  LIVERIES[style.pattern](p, style);
  bumper(p);
  return p.finish(quality !== 'low');
}
