import * as THREE from 'three';
import { ballColor, type BallSetStyle } from '@8ball/shared';

/**
 * Every texture in the game is painted here, at runtime, from the catalogue's numbers — there are
 * no image files to download, so the whole table works offline and every item is exactly what its
 * data says it is.
 */

// ------------------------------------------------------------------ noise

function hash3(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647) ^ Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** 3D value noise in 0..1. */
export function noise3(x: number, y: number, z: number, seed = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = smooth(x - xi);
  const yf = smooth(y - yi);
  const zf = smooth(z - zi);
  const c = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz, seed);
  const x00 = c(0, 0, 0) + (c(1, 0, 0) - c(0, 0, 0)) * xf;
  const x10 = c(0, 1, 0) + (c(1, 1, 0) - c(0, 1, 0)) * xf;
  const x01 = c(0, 0, 1) + (c(1, 0, 1) - c(0, 0, 1)) * xf;
  const x11 = c(0, 1, 1) + (c(1, 1, 1) - c(0, 1, 1)) * xf;
  const y0 = x00 + (x10 - x00) * yf;
  const y1 = x01 + (x11 - x01) * yf;
  return y0 + (y1 - y0) * zf;
}

export function fbm(x: number, y: number, z: number, octaves = 4, seed = 0): number {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise3(x * f, y * f, z * f, seed + i * 17) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

// ------------------------------------------------------------------ colour

type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function scaleRgb(a: RGB, s: number): RGB {
  return [a[0] * s, a[1] * s, a[2] * s];
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })!];
}

function toTexture(c: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

// ------------------------------------------------------------------ balls

export interface BallTextures {
  map: THREE.Texture;
  emissive?: THREE.Texture;
  /** Grey mask: white where metal (gold and chrome finishes). */
  metal?: THREE.Texture;
  rough?: THREE.Texture;
}

/** Renders a number the way it will sit inside the disc. */
function numberSprite(n: number, ink: string, size: number): ImageData {
  const [c, ctx] = canvas(size, size);
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const digits = String(n).length;
  ctx.font = `900 ${Math.round(size * (digits > 1 ? 0.6 : 0.72))}px ${getComputedStyle(document.documentElement).getPropertyValue('--font') || 'sans-serif'}`;
  ctx.fillText(String(n), size / 2, size / 2 + size * 0.04);
  // An underline on 6 and 9 so they can't be misread upside down.
  if (n === 6 || n === 9) ctx.fillRect(size * 0.36, size * 0.8, size * 0.28, size * 0.05);
  void c;
  return ctx.getImageData(0, 0, size, size);
}

/**
 * Paints one ball as an equirectangular map.
 *
 * Every pixel is worked out from the 3D direction it lands on, so the number discs are true
 * circles on the sphere and the numbers inside them are undistorted — the tell-tale sign of a
 * cheap pool game is a number smeared across the top of the ball.
 */
export function paintBall(set: BallSetStyle, id: number, width: number): BallTextures {
  const height = width / 2;
  const [c, ctx] = canvas(width, height);
  const img = ctx.createImageData(width, height);
  const data = img.data;
  const emissiveCanvas = set.finish === 'neon' ? canvas(width, height) : null;
  const eData = emissiveCanvas ? emissiveCanvas[1].createImageData(width, height) : null;
  const metalCanvas = set.finish === 'gold' || set.finish === 'chrome' ? canvas(width, height) : null;
  const mData = metalCanvas ? metalCanvas[1].createImageData(width, height) : null;

  const isCue = id === 0;
  const stripe = id >= 9;
  const color = hexToRgb(ballColor(set, id));
  const base = hexToRgb(set.base);
  const ink = set.ink;
  const discAngle = isCue ? 0 : 0.47; // angular radius of the number disc: big enough to read from the full view
  const band = 0.56; // stripe half-width in latitude (radians)
  const spriteSize = 128;
  const sprite = isCue ? null : numberSprite(id, ink, spriteSize);
  const dots = isCue && set.cueDots ? hexToRgb(set.cueDots) : null;
  const seed = id * 31 + 7;

  // Disc centres: two, opposite each other on the equator.
  const centres: [number, number, number][] = [
    [0, 0, 1],
    [0, 0, -1],
  ];
  const dotDirs: [number, number, number][] = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];

  for (let py = 0; py < height; py++) {
    const lat = Math.PI / 2 - ((py + 0.5) / height) * Math.PI;
    const cl = Math.cos(lat);
    const sl = Math.sin(lat);
    for (let px = 0; px < width; px++) {
      const lon = ((px + 0.5) / width) * Math.PI * 2 - Math.PI;
      // three.js SphereGeometry: x = -cos(lon)·cos(lat), y = sin(lat), z = sin(lon)·cos(lat)
      const x = -Math.cos(lon) * cl;
      const y = sl;
      const z = Math.sin(lon) * cl;

      let rgb: RGB;
      let glow = 0;
      let metal = set.finish === 'chrome' ? 1 : 0;

      // Body colour.
      if (isCue) rgb = hexToRgb(set.cue);
      else if (stripe) rgb = Math.abs(lat) < band ? color : base;
      else rgb = color;

      // Surface finishes that vary across the body.
      if (set.finish === 'marble' && !isCue) {
        const n = fbm(x * 2.2 + seed, y * 2.2, z * 2.2, 5, seed);
        const vein = Math.pow(1 - Math.abs(Math.sin((x * 3 + y * 5 + n * 9) * 1.3)), 10);
        const tone = 0.85 + n * 0.3;
        rgb = mix(scaleRgb(rgb, tone), [245, 245, 240], vein * 0.55);
      } else if (set.finish === 'planet' && !isCue && !(stripe && Math.abs(lat) >= band)) {
        const n = fbm(x * 1.6 + seed, y * 6 + seed, z * 1.6, 5, seed);
        const bands = Math.sin(y * 12 + n * 6 + seed) * 0.5 + 0.5;
        rgb = mix(scaleRgb(rgb, 0.55), mix(rgb, [255, 250, 235], 0.35), bands * 0.8 + n * 0.2);
      } else if (set.finish === 'planet' && isCue) {
        const n = fbm(x * 4, y * 4, z * 4, 4, 99);
        const crater = Math.pow(Math.max(0, fbm(x * 7, y * 7, z * 7, 3, 5) - 0.55), 1.2) * 3;
        rgb = scaleRgb(rgb, 0.78 + n * 0.25 - crater * 0.3);
      } else if (set.finish === 'satin') {
        rgb = scaleRgb(rgb, 0.97 + fbm(x * 30, y * 30, z * 30, 2, seed) * 0.05);
      }

      if (set.finish === 'neon' && !isCue) {
        // Dark shell; the colour lives in a glowing ring and the band.
        const onColour = stripe ? Math.abs(lat) < band : Math.abs(lat) < 0.22;
        rgb = onColour ? color : base;
        glow = onColour ? 1 : 0;
      }
      if (set.finish === 'gold' && !isCue) {
        const goldPart = stripe ? Math.abs(lat) < band : id !== 8 ? Math.abs(lat) < 0.3 : true;
        rgb = goldPart ? color : base;
        metal = goldPart ? 1 : 0;
      }

      // Number discs.
      if (sprite) {
        for (const [cx, cy, cz] of centres) {
          const dot = x * cx + y * cy + z * cz;
          if (dot <= Math.cos(discAngle + 0.02)) continue;
          const ang = Math.acos(Math.min(1, dot));
          const edge = Math.min(1, Math.max(0, (discAngle + 0.02 - ang) / 0.02));
          const disc: RGB = set.finish === 'neon' ? [250, 250, 250] : set.finish === 'gold' ? hexToRgb('#fff1c4') : base;
          rgb = mix(rgb, disc, edge);
          if (metalCanvas) metal *= 1 - edge;
          if (set.finish === 'neon') glow = Math.max(glow, edge * 0.25);
          // Gnomonic projection onto the tangent plane at the disc centre: straight lines stay
          // straight, so the digits keep their shape.
          const u = x / dot;
          const v = y / dot;
          const uu = cz > 0 ? u : -u;
          const scale = Math.tan(discAngle) * 1.05;
          const sx = Math.round(((uu / scale) * 0.5 + 0.5) * (spriteSize - 1));
          const sy = Math.round(((-v / scale) * 0.5 + 0.5) * (spriteSize - 1));
          if (sx >= 0 && sx < spriteSize && sy >= 0 && sy < spriteSize) {
            const a = sprite.data[(sy * spriteSize + sx) * 4 + 3] / 255;
            if (a > 0) {
              const inkRgb = hexToRgb(ink);
              rgb = mix(rgb, set.finish === 'neon' ? [20, 20, 30] : inkRgb, a);
            }
          }
        }
      }

      if (dots) {
        for (const [dx, dy, dz] of dotDirs) {
          const dot = x * dx + y * dy + z * dz;
          if (dot > Math.cos(0.12)) rgb = dots;
        }
      }

      const i = (py * width + px) * 4;
      data[i] = rgb[0];
      data[i + 1] = rgb[1];
      data[i + 2] = rgb[2];
      data[i + 3] = 255;
      if (eData) {
        const g = scaleRgb(rgb, glow);
        eData.data[i] = g[0];
        eData.data[i + 1] = g[1];
        eData.data[i + 2] = g[2];
        eData.data[i + 3] = 255;
      }
      if (mData) {
        const m = metal * 255;
        mData.data[i] = m;
        mData.data[i + 1] = m;
        mData.data[i + 2] = m;
        mData.data[i + 3] = 255;
      }
    }
  }

  ctx.putImageData(img, 0, 0);
  const out: BallTextures = { map: toTexture(c) };
  if (emissiveCanvas && eData) {
    emissiveCanvas[1].putImageData(eData, 0, 0);
    out.emissive = toTexture(emissiveCanvas[0]);
  }
  if (metalCanvas && mData) {
    metalCanvas[1].putImageData(mData, 0, 0);
    // Metalness is read from the blue channel and roughness from green; one mask serves both.
    out.metal = toTexture(metalCanvas[0], false);
  }
  return out;
}

// ------------------------------------------------------------------ cloth & wood

/**
 * Fine woven cloth, as a grey detail map tinted by the material colour.
 *
 * Built only from things that repeat exactly — per-pixel grain and a weave on an integer period —
 * so the texture tiles across the bed without a seam.
 */
export function paintCloth(size = 512): { map: THREE.Texture; bump: THREE.Texture } {
  const [c, ctx] = canvas(size, size);
  const img = ctx.createImageData(size, size);
  const k = (Math.PI * 2 * 96) / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const weave = Math.sin(x * k) * Math.sin(y * k);
      const grain = hash3(x, y, 0, 11) - 0.5;
      const fibre = hash3(x >> 1, y, 3, 17) - 0.5;
      const v = 190 + grain * 14 + fibre * 9 + weave * 5;
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.max(0, Math.min(255, v));
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const map = toTexture(c);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  const bump = toTexture(c, false);
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  return { map, bump };
}

/** Wood grain for the rails. Lacquer and metal finishes get a subtle brushed texture instead. */
export function paintRail(body: string, grain: string, finish: 'wood' | 'lacquer' | 'metal'): THREE.Texture {
  const w = 1024;
  const h = 256;
  const [c, ctx] = canvas(w, h);
  const img = ctx.createImageData(w, h);
  const a = hexToRgb(body);
  const b = hexToRgb(grain);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let rgb: RGB;
      if (finish === 'wood') {
        // Long straight grain with a gentle wander, fine pores and the odd darker streak.
        const warp = fbm(x * 0.0015, y * 0.02, 0, 3, 21) * 7;
        const rings = Math.sin((y * 0.19 + warp) * 2.1) * 0.5 + 0.5;
        const pores = hash3(x >> 2, y, 0, 5) > 0.93 ? 0.25 : 0;
        const streak = fbm(x * 0.0008, y * 0.06, 3, 2, 12);
        const t = Math.pow(rings, 3) * 0.45 + streak * 0.35 + pores;
        rgb = mix(a, b, Math.min(1, t));
      } else if (finish === 'metal') {
        const brushed = hash3(0, y, 0, 3) * 0.12 + fbm(x * 0.002, y * 0.4, 0, 2, 4) * 0.12;
        rgb = scaleRgb(a, 0.9 + brushed);
      } else {
        rgb = scaleRgb(a, 0.96 + fbm(x * 0.01, y * 0.01, 0, 3, 8) * 0.08);
      }
      const i = (y * w + x) * 4;
      img.data[i] = rgb[0];
      img.data[i + 1] = rgb[1];
      img.data[i + 2] = rgb[2];
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = toTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function shadeHex(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(amount >= 0 ? v + (255 - v) * amount : v * (1 + amount))));
  return `#${[f(r), f(g), f(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** A soft round sprite, for particles and glows. */
export function paintGlow(size = 64): THREE.Texture {
  const [c, ctx] = canvas(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return toTexture(c);
}

/** An emoji painted onto a transparent square — for the Power Pool orbs. */
export function paintGlyph(glyph: string, size = 128): THREE.Texture {
  const [c, ctx] = canvas(size, size);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.round(size * 0.62)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  ctx.fillText(glyph, size / 2, size / 2 + size * 0.04);
  return toTexture(c);
}

/** A radial darkening, drawn under each ball as a contact shadow. */
export function paintShadow(size = 64): THREE.Texture {
  const [c, ctx] = canvas(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.75)');
  g.addColorStop(0.45, 'rgba(0,0,0,0.38)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return toTexture(c);
}

/** The floor pool of light and shadow the table stands in. */
export function paintFloor(room: string, lamp: string, size = 512): THREE.Texture {
  const [c, ctx] = canvas(size, size);
  const r = hexToRgb(room);
  const l = hexToRgb(lamp);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  const lit = mix(r, l, 0.12);
  g.addColorStop(0, `rgb(${lit.map(Math.round).join(',')})`);
  g.addColorStop(0.5, `rgb(${r.map(Math.round).join(',')})`);
  g.addColorStop(1, `rgb(${scaleRgb(r, 0.35).map(Math.round).join(',')})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return toTexture(c);
}
