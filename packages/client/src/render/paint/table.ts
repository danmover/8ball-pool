import * as THREE from 'three';
import { HEAD_STRING_X, TABLE_LENGTH, type TableEmblem, type TableStyle } from '@8ball/shared';
import { CUSHION_DEPTH, HALF_L, HALF_W, toWorldX } from '../coords';
import { fbm, hexToRgb, noise3 } from '../textures';

/**
 * Painters for the table: the cloth and its weave, the rail finishes, the little studio the
 * metal and lacquer reflect, and the neon underglow. Everything is drawn at runtime from the
 * catalogue's colours, so a table works offline and looks exactly like its data says.
 */

type RGB = [number, number, number];

export interface Point {
  x: number;
  z: number;
}

/** A style with every optional field filled in, so older saves draw like everything else. */
export type TableLook = Required<TableStyle>;

export function tableLook(style: TableStyle): TableLook {
  return {
    ...style,
    emblem: style.emblem ?? 'none',
    liner: style.liner ?? '#2b1c14',
    apron: style.apron ?? style.rail,
  };
}

/** The cloth art covers the bed out to the backs of the cushions, centred on the origin. */
export const ART_HALF_X = HALF_L + CUSHION_DEPTH;
export const ART_HALF_Z = HALF_W + CUSHION_DEPTH;

/** World size of one tile of weave: 32 threads, a little over 2 mm apart. */
export const WEAVE_TILE = 0.072;

function smoothstep(a: number, b: number, t: number): number {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function put(data: Uint8ClampedArray, i: number, rgb: RGB, s = 1): void {
  data[i] = rgb[0] * s;
  data[i + 1] = rgb[1] * s;
  data[i + 2] = rgb[2] * s;
  data[i + 3] = 255;
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })!];
}

function texture(c: HTMLCanvasElement, srgb: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/** Relative luminance of a hex colour, 0..1. */
function luma(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/**
 * The lamp's pool of light, baked in: 1 over the middle of the bed, falling away toward the
 * cushions and furthest into the corners. Shared by the cloth and the cushions so they agree.
 */
export function lampPool(x: number, z: number): number {
  const p = 2.6;
  const q = Math.pow(Math.pow(Math.abs(x) / (HALF_L * 1.1), p) + Math.pow(Math.abs(z) / (HALF_W * 1.28), p), 1 / p);
  return 1.04 - 0.26 * smoothstep(0.28, 1.1, q);
}

// ------------------------------------------------------------------ cloth

/**
 * The bed's colour, painted once across the whole playing surface: the lamp pool, faint brush
 * marks in the nap, soft occlusion where the cushions overhang and the pockets fall away, the
 * head string and spots, and the table's emblem pressed into the middle.
 *
 * `cushions` are the cushions' footprints and `holes` the pocket throats, in world x/z.
 */
export function paintClothArt(style: TableLook, width: number, cushions: Point[][], holes: (Point & { radius: number })[]): THREE.Texture {
  const W = width;
  const H = Math.round((width * ART_HALF_Z) / ART_HALF_X);
  const k = W / (ART_HALF_X * 2);
  const px = (x: number) => (x + ART_HALF_X) * k;
  const py = (z: number) => (z + ART_HALF_Z) * k;
  const [c, ctx] = canvas(W, H);

  // Everything low-frequency is worked out per pixel on a small canvas and scaled up smoothly.
  const lw = 320;
  const lh = Math.round((lw * H) / W);
  const [lc, lctx] = canvas(lw, lh);
  const img = lctx.createImageData(lw, lh);
  const cloth = hexToRgb(style.cloth);
  const warm = mix(cloth, hexToRgb(style.lamp), 0.2);
  for (let j = 0; j < lh; j++) {
    const z = ((j + 0.5) / lh) * 2 * ART_HALF_Z - ART_HALF_Z;
    for (let i = 0; i < lw; i++) {
      const x = ((i + 0.5) / lw) * 2 * ART_HALF_X - ART_HALF_X;
      const pool = lampPool(x, z);
      // The nap is brushed along the table, so its faint streaks run lengthways.
      const nap = (fbm(x * 0.8, z * 15, 0.5, 3, 7) - 0.5) * 0.045;
      const rgb = mix(cloth, warm, smoothstep(0.86, 1.04, pool) * 0.5);
      put(img.data, (j * lw + i) * 4, rgb, pool + nap);
    }
  }
  lctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(lc, 0, 0, W, H);

  // Occlusion: a tight, dark line where the cushion noses overhang the bed and a wide, faint one
  // for the cushions as a whole. Drawn as the shadows of shapes held off-canvas, so only the
  // blur lands.
  const off = W * 2;
  const occlude = (spread: number, alpha: number) => {
    ctx.save();
    ctx.shadowColor = `rgba(0,0,0,${alpha})`;
    ctx.shadowBlur = Math.max(1.5, spread * k);
    ctx.shadowOffsetX = -off;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    for (const poly of cushions) {
      poly.forEach((p, i) => (i ? ctx.lineTo(px(p.x) + off, py(p.z)) : ctx.moveTo(px(p.x) + off, py(p.z))));
      ctx.closePath();
    }
    ctx.fill();
    ctx.restore();
  };
  occlude(0.05, 0.32);
  occlude(0.012, 0.6);
  for (const h of holes) {
    const g = ctx.createRadialGradient(px(h.x), py(h.z), h.radius * k * 0.95, px(h.x), py(h.z), (h.radius + 0.035) * k);
    g.addColorStop(0, 'rgba(0,0,0,0.6)');
    g.addColorStop(0.4, 'rgba(0,0,0,0.22)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(px(h.x - h.radius - 0.04), py(h.z - h.radius - 0.04), (h.radius + 0.04) * 2 * k, (h.radius + 0.04) * 2 * k);
  }

  // Markings: chalk-fine, a touch lighter than the cloth, so they read as part of it.
  const light = luma(style.cloth) > 0.42;
  const chalk = (a: number) => (light ? `rgba(255,255,255,${a * 1.3})` : `rgba(235,245,240,${a})`);
  const line = Math.max(1.2, 0.0018 * k);
  const headX = px(toWorldX(HEAD_STRING_X));
  ctx.fillStyle = chalk(0.2);
  ctx.fillRect(headX - line / 2, py(-HALF_W), line, HALF_W * 2 * k);
  for (const x of [toWorldX(HEAD_STRING_X), toWorldX(TABLE_LENGTH * 0.72)]) {
    ctx.beginPath();
    ctx.arc(px(x), py(0), Math.max(1.5, 0.0045 * k), 0, Math.PI * 2);
    ctx.fillStyle = chalk(0.38);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(px(x), py(0), Math.max(3, 0.0095 * k), 0, Math.PI * 2);
    ctx.lineWidth = Math.max(1, line * 0.7);
    ctx.strokeStyle = chalk(0.16);
    ctx.stroke();
  }

  if (style.emblem !== 'none') {
    ctx.save();
    ctx.translate(px(0), py(0));
    ctx.scale(k, k);
    // Pressed into the nap: a darker shadow a hair below, the lit edge a hair above.
    const e = emblem(style.emblem);
    const lift = 1.6 / k;
    const draw = (dy: number, colour: string, fillAlpha: number, lineAlpha: number) => {
      ctx.save();
      ctx.translate(0, dy);
      ctx.fillStyle = colour.replace('A', String(fillAlpha));
      ctx.fill(e.fill);
      ctx.strokeStyle = colour.replace('A', String(lineAlpha));
      ctx.lineWidth = e.width;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke(e.line);
      ctx.restore();
    };
    draw(lift, 'rgba(0,0,0,A)', 0.07, 0.1);
    draw(0, light ? 'rgba(255,255,255,A)' : 'rgba(255,248,230,A)', 0.075, 0.09);
    ctx.restore();
  }

  const t = texture(c, true);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** The centre marks, in metres around the middle of the table. */
function emblem(kind: TableEmblem): { fill: Path2D; line: Path2D; width: number } {
  const fill = new Path2D();
  const line = new Path2D();
  const ring = (p: Path2D, r: number) => {
    p.moveTo(r, 0);
    p.arc(0, 0, r, 0, Math.PI * 2);
  };
  const dot = (p: Path2D, x: number, y: number, r: number) => {
    p.moveTo(x + r, y);
    p.arc(x, y, r, 0, Math.PI * 2);
  };
  const poly = (p: Path2D, pts: number[][]) => {
    pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
    p.closePath();
  };
  const rhombus = (p: Path2D, a: number, b: number) =>
    poly(p, [
      [a, 0],
      [0, b],
      [-a, 0],
      [0, -b],
    ]);
  let width = 0.0035;
  switch (kind) {
    case 'roundel': {
      // A club badge: a beaded double ring around a figure eight.
      ring(line, 0.15);
      ring(line, 0.127);
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        dot(fill, Math.cos(a) * 0.1385, Math.sin(a) * 0.1385, 0.0028);
      }
      ring(line, 0.055);
      dot(line, 0, -0.0135, 0.0115);
      dot(line, 0, 0.0125, 0.0135);
      break;
    }
    case 'target': {
      // Tournament medallion: a broken ring with four pointers in.
      ring(line, 0.152);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        line.moveTo(Math.cos(a - 0.5) * 0.126, Math.sin(a - 0.5) * 0.126);
        line.arc(0, 0, 0.126, a - 0.5, a + 0.5);
        const b = a + Math.PI / 4;
        poly(fill, [
          [Math.cos(b) * 0.138, Math.sin(b) * 0.138],
          [Math.cos(b - 0.07) * 0.115, Math.sin(b - 0.07) * 0.115],
          [Math.cos(b) * 0.1, Math.sin(b) * 0.1],
          [Math.cos(b + 0.07) * 0.115, Math.sin(b + 0.07) * 0.115],
        ]);
      }
      ring(line, 0.05);
      dot(fill, 0, 0, 0.013);
      break;
    }
    case 'diamond': {
      // Art deco: nested diamonds with rays to the points.
      rhombus(line, 0.22, 0.125);
      rhombus(line, 0.185, 0.104);
      rhombus(fill, 0.07, 0.04);
      for (const [x, y, x2, y2] of [
        [0.085, 0, 0.17, 0],
        [-0.085, 0, -0.17, 0],
        [0, 0.05, 0, 0.094],
        [0, -0.05, 0, -0.094],
      ]) {
        line.moveTo(x, y);
        line.lineTo(x2, y2);
      }
      break;
    }
    case 'star': {
      // A compass rose: eight points, each half filled.
      ring(line, 0.118);
      const pts: number[][] = [];
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2 - Math.PI / 2;
        const r = i % 2 ? 0.032 : i % 4 === 0 ? 0.172 : 0.105;
        pts.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
      poly(line, pts);
      for (let i = 0; i < 16; i += 2) {
        const [tx, ty] = pts[i];
        const [vx, vy] = pts[(i + 1) % 16];
        poly(fill, [
          [0, 0],
          [tx, ty],
          [vx, vy],
        ]);
      }
      break;
    }
    case 'bolt': {
      // Arcade: a lightning bolt in a double ring with ticks like a dial.
      ring(line, 0.15);
      ring(line, 0.136);
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        line.moveTo(Math.cos(a) * 0.158, Math.sin(a) * 0.158);
        line.lineTo(Math.cos(a) * 0.172, Math.sin(a) * 0.172);
      }
      poly(fill, [
        [0.03, -0.105],
        [-0.05, 0.012],
        [-0.004, 0.012],
        [-0.03, 0.105],
        [0.05, -0.016],
        [0.004, -0.016],
      ]);
      break;
    }
    case 'flake': {
      // Glacier: a six-armed snowflake.
      width = 0.004;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const cx = Math.cos(a);
        const sy = Math.sin(a);
        line.moveTo(cx * 0.03, sy * 0.03);
        line.lineTo(cx * 0.155, sy * 0.155);
        for (const [at, len] of [
          [0.075, 0.04],
          [0.115, 0.028],
        ]) {
          for (const s of [-1, 1]) {
            const b = a + s * 0.75;
            line.moveTo(cx * at, sy * at);
            line.lineTo(cx * at + Math.cos(b) * len, sy * at + Math.sin(b) * len);
          }
        }
      }
      const hex: number[][] = [];
      for (let i = 0; i < 6; i++) hex.push([Math.cos((i / 6) * Math.PI * 2) * 0.03, Math.sin((i / 6) * Math.PI * 2) * 0.03]);
      poly(fill, hex);
      break;
    }
    case 'sun': {
      // Desert: a sun disc with long and short rays.
      dot(fill, 0, 0, 0.05);
      ring(line, 0.062);
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const r = i % 2 ? 0.118 : 0.16;
        poly(fill, [
          [Math.cos(a - 0.07) * 0.074, Math.sin(a - 0.07) * 0.074],
          [Math.cos(a) * r, Math.sin(a) * r],
          [Math.cos(a + 0.07) * 0.074, Math.sin(a + 0.07) * 0.074],
        ]);
      }
      break;
    }
    case 'crown': {
      // Royale: a crown in a double ring.
      ring(line, 0.15);
      ring(line, 0.137);
      poly(fill, [
        [-0.075, 0.038],
        [-0.088, -0.036],
        [-0.042, 0.0],
        [0, -0.058],
        [0.042, 0.0],
        [0.088, -0.036],
        [0.075, 0.038],
      ]);
      poly(fill, [
        [-0.075, 0.048],
        [0.075, 0.048],
        [0.075, 0.062],
        [-0.075, 0.062],
      ]);
      dot(fill, -0.088, -0.048, 0.0085);
      dot(fill, 0, -0.071, 0.0095);
      dot(fill, 0.088, -0.048, 0.0085);
      break;
    }
    default:
      break;
  }
  return { fill, line, width };
}

/**
 * Twill weave, as a grey detail map around 0.5 that the cloth shader multiplies in.
 *
 * Each thread is shaded as a rounded strand that dips where it passes under its neighbour, on a
 * 2/2 twill so the ribs run diagonally. Only things with an exact period go in, so it tiles
 * without a seam; it is fine enough to vanish into an even tone at full-table size.
 */
export function paintWeave(size: number): THREE.Texture {
  const [c, ctx] = canvas(size, size);
  const img = ctx.createImageData(size, size);
  const threads = 32;
  const P = size / threads;
  for (let y = 0; y < size; y++) {
    const j = Math.floor(y / P);
    const fy = ((y % P) + 0.5) / P;
    for (let x = 0; x < size; x++) {
      const i = Math.floor(x / P);
      const fx = ((x % P) + 0.5) / P;
      const phase = (i + j) & 3;
      const warp = phase < 2;
      const across = warp ? fx : fy;
      const along = warp ? (phase + fy) / 2 : (phase - 2 + fx) / 2;
      const strand = Math.pow(Math.sin(Math.PI * across), 0.55) * (0.7 + 0.3 * Math.sin(Math.PI * along));
      const tone = 0.9 + 0.2 * noise3(warp ? i : j, warp ? 0 : 1, 0, 31);
      const fibre = (noise3(x, y, 0, 5) - 0.5) * 0.16;
      const v = 0.5 + (strand * tone - 0.62) * 0.8 + fibre;
      const idx = (y * size + x) * 4;
      img.data[idx] = img.data[idx + 1] = img.data[idx + 2] = Math.max(0, Math.min(255, v * 255));
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = texture(c, false);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ------------------------------------------------------------------ rails

/**
 * The rail's surface, laid out with `u` along the rail (it tiles) and `v` across its profile from
 * the inner bevel to the outer lip. Wood gets figured grain with dark latewood lines and pores;
 * lacquer is a deep, nearly solid colour whose life comes from the clear coat; metal is brushed
 * lengthways.
 */
export function paintRailFinish(style: TableLook, width: number): THREE.Texture {
  const W = width;
  const H = width / 4;
  const [c, ctx] = canvas(W, H);
  const img = ctx.createImageData(W, H);
  const body = hexToRgb(style.rail);
  const grain = hexToRgb(style.grain);
  const poreCols = Math.round(W / 6);
  for (let y = 0; y < H; y++) {
    const v = (y + 0.5) / H;
    for (let x = 0; x < W; x++) {
      // Sample noise around a circle in u so the texture wraps along the rail seamlessly.
      const a = ((x + 0.5) / W) * Math.PI * 2;
      const cu = Math.cos(a);
      const su = Math.sin(a);
      let rgb: RGB;
      let s = 1;
      if (style.railFinish === 'wood') {
        const warp = fbm(cu * 1.4, su * 1.4, v * 2.5, 3, 21);
        const drift = fbm(cu * 0.5, su * 0.5, v * 0.7 + 4, 2, 5);
        const t = v * 20 + warp * 4.5 + drift * 3;
        const ring = t - Math.floor(t);
        const late = smoothstep(0.58, 0.88, ring) * (1 - smoothstep(0.9, 1, ring));
        const broad = fbm(cu * 0.8, su * 0.8, v * 4 + 9, 3, 9);
        const pore = noise3(Math.floor(x / 6) % poreCols, y, 0, 13) > 0.94 ? 0.22 : 0;
        rgb = mix(body, grain, Math.min(1, Math.max(0, late * 0.7 + (broad - 0.5) * 1.1 + 0.18)));
        s = (0.94 + broad * 0.12) * (1 - pore);
      } else if (style.railFinish === 'metal') {
        const streak = (noise3(0, y, 0, 3) - 0.5) * 0.1 + (fbm(cu * 2, su * 2, v * 30, 2, 4) - 0.5) * 0.14;
        rgb = mix(body, grain, fbm(cu * 0.6, su * 0.6, v * 3, 2, 8));
        s = 0.97 + streak;
      } else {
        rgb = body;
        s = 0.96 + fbm(cu * 0.9, su * 0.9, v * 2, 2, 3) * 0.08;
      }
      put(img.data, (y * W + x) * 4, rgb, s);
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = texture(c, true);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// ------------------------------------------------------------------ reflections

/**
 * The studio the table's metal and lacquer reflect, as an equirectangular map: a warm softbox
 * overhead (what a flat plate sees looking up), a bright ring low on the horizon (what a bevel
 * catches, so every edge gets its line of light), two softboxes off the ends, and a dark floor.
 */
export function paintStudio(style: TableLook, width: number): THREE.Texture {
  const W = width;
  const H = width / 2;
  const [c, ctx] = canvas(W, H);
  const img = ctx.createImageData(W, H);
  const lamp = hexToRgb(style.lamp);
  const room = mix(hexToRgb(style.room), [30, 30, 34], 0.35);
  for (let y = 0; y < H; y++) {
    const lat = Math.PI / 2 - ((y + 0.5) / H) * Math.PI;
    for (let x = 0; x < W; x++) {
      const lon = ((x + 0.5) / W) * Math.PI * 2 - Math.PI;
      let rgb: RGB = room;
      let s = 1;
      if (lat > 0) {
        const over = smoothstep(0.62, 1.2, lat);
        const rim = Math.exp(-Math.pow((lat - 0.3) / 0.07, 2));
        // Softboxes off either end of the table (the +x and -x directions).
        const end = Math.min(Math.abs(lon), Math.abs(Math.abs(lon) - Math.PI));
        const box = smoothstep(0.5, 0.35, end) * smoothstep(0.35, 0.5, lat) * smoothstep(0.95, 0.8, lat);
        const glow = Math.min(1, over * 0.85 + rim * 0.95 + box * 0.75);
        rgb = mix(room, lamp, glow);
        s = 0.5 + lat * 0.35 + glow * 0.5;
      } else {
        s = 0.35 + (1 + lat / (Math.PI / 2)) * 0.4;
      }
      put(img.data, (y * W + x) * 4, rgb, s);
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = texture(c, true);
  t.mapping = THREE.EquirectangularReflectionMapping;
  return t;
}

// ------------------------------------------------------------------ neon

/**
 * The underglow's falloff around a rounded-rectangle table of half-size `hx` × `hz`, painted
 * over a plane `margin` larger on every side. White in the middle, a bright band hugging the
 * table's edge and a long soft tail; tinted by the material.
 */
export function paintUnderglow(hx: number, hz: number, corner: number, margin: number, width: number): THREE.Texture {
  const W = width;
  const H = Math.round((width * (hz + margin)) / (hx + margin));
  const [c, ctx] = canvas(W, H);
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const z = (((y + 0.5) / H) * 2 - 1) * (hz + margin);
    for (let x = 0; x < W; x++) {
      const wx = (((x + 0.5) / W) * 2 - 1) * (hx + margin);
      const qx = Math.abs(wx) - (hx - corner);
      const qz = Math.abs(z) - (hz - corner);
      const d = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - corner;
      const g = d <= 0 ? 1 : Math.min(1, Math.exp(-d / 0.035) * 0.75 + Math.exp(-d / 0.16) * 0.4);
      const v = g * (1 - smoothstep(margin * 0.7, margin, d)) * 255;
      const i = (y * W + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return texture(c, false);
}
