import * as THREE from 'three';
import type { TableStyle } from '@8ball/shared';
import { fbm, hexToRgb } from '../textures';

/**
 * The floor each hall stands on, painted as one seamless tile.
 *
 * It is only ever seen dimly, inside the spill of the lamp, so the patterns are big and simple —
 * enough to say "planks" or "carpet" at a glance, never enough to compete with the table.
 */

export type FloorKind = 'planks' | 'carpet' | 'arcade' | 'tiles';

/** Which floor a table stands on, read from its finish so each hall keeps its own character. */
export function floorKind(style: TableStyle): FloorKind {
  if (style.railFinish === 'metal') return 'tiles';
  if (style.neon) return 'arcade';
  if (style.railFinish === 'lacquer') return 'carpet';
  return 'planks';
}

type RGB = [number, number, number];

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function css(c: RGB, a = 1): string {
  return `rgba(${c.map((v) => Math.round(Math.max(0, Math.min(255, v)))).join(',')},${a})`;
}

/** A near-black room colour brought up to a readable level, keeping its hue. */
function lift(hex: string, level: number): RGB {
  const c = hexToRgb(hex);
  const m = Math.max(1, c[0], c[1], c[2]);
  return [(c[0] / m) * level, (c[1] / m) * level, (c[2] / m) * level];
}

function hash(a: number, b: number): number {
  const h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** Floorboards: eight rows a tile, two boards a row, staggered, with a lit bevel on each gap. */
function planks(ctx: CanvasRenderingContext2D, size: number, style: TableStyle): void {
  const wood = mix([84, 58, 38], lift(style.room, 150), 0.32);
  const img = ctx.createImageData(size, size);
  const rows = 8;
  const rowH = size / rows;
  const gap = Math.max(1, size / 256);
  for (let y = 0; y < size; y++) {
    const row = Math.floor(y / rowH);
    const inRow = y - row * rowH;
    const offset = Math.floor(hash(row, 1) * 4) * (size / 4);
    for (let x = 0; x < size; x++) {
      const along = (x - offset + size) % size;
      const board = along < size / 2 ? 0 : 1;
      const local = along - board * (size / 2);
      const seed = row * 2 + board;
      const tone = 0.78 + hash(seed, 7) * 0.34;
      const grain = fbm(local * 0.018, inRow * 0.22, seed * 3.1, 3, 5);
      const streak = Math.pow(Math.abs(Math.sin((inRow * 0.5 + grain * 9) * 1.4)), 6) * 0.12;
      let v = tone * (0.86 + grain * 0.28 - streak);
      if (inRow < gap || local < gap) v = 0.22;
      else if (inRow < gap * 2 || local < gap * 2) v *= 1.22;
      const i = (y * size + x) * 4;
      img.data[i] = wood[0] * v;
      img.data[i + 1] = wood[1] * v;
      img.data[i + 2] = wood[2] * v;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** A hall carpet: a diamond lattice in the table's trim colour over a short-pile ground. */
function carpet(ctx: CanvasRenderingContext2D, size: number, style: TableStyle): void {
  const ground = lift(style.room, 70);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = 0.9 + hash(x, y) * 0.2;
      const i = (y * size + x) * 4;
      img.data[i] = ground[0] * v;
      img.data[i + 1] = ground[1] * v;
      img.data[i + 2] = ground[2] * v;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const trim = hexToRgb(style.trim);
  const cell = size / 4;
  ctx.lineWidth = size / 170;
  ctx.strokeStyle = css(trim, 0.5);
  // Diagonals at 45°, spaced so they meet the tile edge exactly where the next tile continues them.
  for (let k = -4; k <= 8; k++) {
    ctx.beginPath();
    ctx.moveTo(k * cell, 0);
    ctx.lineTo(k * cell + size, size);
    ctx.moveTo(k * cell, size);
    ctx.lineTo(k * cell + size, 0);
    ctx.stroke();
  }
  ctx.fillStyle = css(trim, 0.7);
  for (let gx = 0; gx <= 4; gx++) {
    for (let gy = 0; gy <= 4; gy++) {
      const cx = gx * cell + cell / 2;
      const cy = gy * cell + cell / 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy - cell * 0.12);
      ctx.lineTo(cx + cell * 0.12, cy);
      ctx.lineTo(cx, cy + cell * 0.12);
      ctx.lineTo(cx - cell * 0.12, cy);
      ctx.fill();
    }
  }
}

/** A black-light arcade carpet: neon squiggles, rings and triangles scattered on black. */
function arcade(ctx: CanvasRenderingContext2D, size: number, style: TableStyle): void {
  ctx.fillStyle = css(lift(style.room, 22));
  ctx.fillRect(0, 0, size, size);
  const inks = [hexToRgb(style.neon ?? style.trim), hexToRgb(style.sight), hexToRgb(style.trim)];
  ctx.lineWidth = size / 110;
  ctx.lineCap = 'round';
  // Each shape is drawn at its wrapped copies too, so the tile repeats without a seam.
  const wrapped = (draw: (ox: number, oy: number) => void) => {
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) draw(ox, oy);
  };
  for (let k = 0; k < 26; k++) {
    const x = hash(k, 1) * size;
    const y = hash(k, 2) * size;
    const ink = inks[k % inks.length];
    const r = size * (0.025 + hash(k, 3) * 0.03);
    const turn = hash(k, 4) * Math.PI * 2;
    ctx.strokeStyle = css(ink, 0.9);
    wrapped((ox, oy) => {
      ctx.beginPath();
      const cx = x + ox;
      const cy = y + oy;
      if (k % 3 === 0) {
        for (let s = 0; s <= 16; s++) {
          const t = s / 16;
          const px = cx + Math.cos(turn) * (t - 0.5) * r * 4 - Math.sin(turn) * Math.sin(t * Math.PI * 3) * r * 0.6;
          const py = cy + Math.sin(turn) * (t - 0.5) * r * 4 + Math.cos(turn) * Math.sin(t * Math.PI * 3) * r * 0.6;
          if (s === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
      } else if (k % 3 === 1) {
        ctx.arc(cx, cy, r * 0.8, 0, Math.PI * 2);
      } else {
        for (let s = 0; s <= 3; s++) {
          const a = turn + (s / 3) * Math.PI * 2;
          if (s === 0) ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
          else ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        }
      }
      ctx.stroke();
    });
  }
}

/** Big stone tiles with thin grout, each a slightly different cut of the same stone. */
function tiles(ctx: CanvasRenderingContext2D, size: number, style: TableStyle): void {
  const stone = mix([96, 108, 122], lift(style.room, 150), 0.4);
  const img = ctx.createImageData(size, size);
  const n = 4;
  const cell = size / n;
  const grout = Math.max(1, size / 200);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const tx = Math.floor(x / cell);
      const ty = Math.floor(y / cell);
      const lx = x - tx * cell;
      const ly = y - ty * cell;
      const seed = tx * 7 + ty * 13;
      const tone = 0.8 + hash(tx, ty) * 0.3;
      const mottle = fbm(lx * 0.03, ly * 0.03, seed, 3, 9);
      let v = tone * (0.82 + mottle * 0.32);
      if (lx < grout || ly < grout) v = 0.35;
      else if (lx < grout * 2.5 || ly < grout * 2.5) v *= 1.18;
      const i = (y * size + x) * 4;
      img.data[i] = stone[0] * v;
      img.data[i + 1] = stone[1] * v;
      img.data[i + 2] = stone[2] * v;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** How many world units one tile of each floor covers. */
export const FLOOR_TILE: Record<FloorKind, number> = { planks: 0.9, carpet: 0.7, arcade: 1.1, tiles: 0.85 };

/** Paints the floor tile for a table. */
export function paintRoomFloor(style: TableStyle, size: number): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const kind = floorKind(style);
  if (kind === 'planks') planks(ctx, size, style);
  else if (kind === 'carpet') carpet(ctx, size, style);
  else if (kind === 'arcade') arcade(ctx, size, style);
  else tiles(ctx, size, style);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
