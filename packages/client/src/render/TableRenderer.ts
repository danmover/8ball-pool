import { Application, BlurFilter, Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { Ball, Loadout, TrajectoryPreview } from '@8ball/shared';
import {
  BALL_RADIUS,
  DEFAULT_LOADOUT,
  POCKETS,
  TABLE_LENGTH,
  TABLE_WIDTH,
  rackBalls,
  resolveLoadout,
  stepSimulation,
} from '@8ball/shared';
import { styleForBall } from './ballStyle';
import { ParticleSystem } from './Particles';
import { ballSetFor, styleForBallInSet, type BallSet } from './cosmetics/ballSets';
import { cueSkinFor, type CueSkin } from './cosmetics/cueSkins';
import { sampleRamp, trailStyleFor, type TrailStyle } from './cosmetics/trailStyles';
import { applyTableThemeToPage, tableThemeFor, type TableTheme } from './cosmetics/tableThemes';
import { hitEffectFor, type HitEffect } from './cosmetics/hitEffects';
import { drawScene } from './cosmetics/scenes';

const TEX_SIZE = 192;
const POT_ANIM_MS = 320;

/** '#rrggbb' → 0xrrggbb, for feeding CSS-authored theme colours to Pixi. */
function cssToHex(css: string): number {
  return Number.parseInt(css.replace('#', ''), 16);
}

/** Cue length in table units — long enough to read as a real cue behind the ball. */
const CUE_LENGTH = BALL_RADIUS * 27;

/** Board furniture around the playing surface, in table units. */
const RAIL = 62;
const SIDE_GAP = 26;
/** Sized so a ball sitting in the return track is exactly its on-table size. */
const CHUTE_BALL = BALL_RADIUS * 2;
const CHUTE_W = CHUTE_BALL + 26;
const BAR_W = 52; // power bar down the left

const BOARD_LEFT = -(RAIL + SIDE_GAP + BAR_W);
const BOARD_RIGHT = TABLE_LENGTH + RAIL + SIDE_GAP + CHUTE_W;
const BOARD_TOP = -RAIL;
const BOARD_BOTTOM = TABLE_WIDTH + RAIL;
const BOARD_W = BOARD_RIGHT - BOARD_LEFT;
const BOARD_H = BOARD_BOTTOM - BOARD_TOP;

function hexToCss(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

/** Deterministic per-ball randomness, so a ball's markings never change between renders. */
function seeded(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x100000000;
  };
}

function shiftHex(hex: number, amount: number): string {
  const clamp = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp(((hex >> 16) & 0xff) + amount);
  const g = clamp(((hex >> 8) & 0xff) + amount);
  const b = clamp((hex & 0xff) + amount);
  return `rgb(${r},${g},${b})`;
}

/**
 * Paints the set's surface treatment across the ball, inside the caller's circular clip.
 *
 * This is the part that actually makes the sets distinguishable. A palette swap alone reads
 * as "the same balls in other colours" once they're 45 units across on the cloth — what the
 * eye picks up at that size is structure: veining, grain, a starfield, milled facets.
 */
function paintBallPattern(
  ctx: CanvasRenderingContext2D,
  size: number,
  id: number,
  set: BallSet,
  base: number
): void {
  const r = size / 2;
  const rand = seeded(id + 1);

  switch (set.pattern) {
    case 'marble': {
      // A few soft veins wandering across the surface, plus fainter hairlines.
      for (let i = 0; i < 5; i++) {
        const y = rand() * size;
        ctx.strokeStyle = `rgba(70,66,80,${0.1 + rand() * 0.22})`;
        ctx.lineWidth = 1.5 + rand() * 5;
        ctx.beginPath();
        ctx.moveTo(-10, y);
        for (let x = 0; x <= size + 10; x += size / 5) {
          ctx.lineTo(x, y + Math.sin((x / size) * Math.PI * 2 + i) * (12 + rand() * 26));
        }
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.32)';
      ctx.lineWidth = 1.4;
      for (let i = 0; i < 4; i++) {
        const y = rand() * size;
        ctx.beginPath();
        ctx.moveTo(-10, y);
        ctx.bezierCurveTo(size * 0.3, y - 30, size * 0.7, y + 30, size + 10, y);
        ctx.stroke();
      }
      break;
    }

    case 'wood': {
      // Concentric growth rings offset from centre, like a turned billet.
      const cx = r * (0.55 + rand() * 0.4);
      const cy = r * (0.5 + rand() * 0.5);
      for (let ring = 1; ring < 16; ring++) {
        ctx.strokeStyle = `rgba(60,34,14,${0.06 + (ring % 3 === 0 ? 0.14 : 0.05)})`;
        ctx.lineWidth = 1 + (ring % 3 === 0 ? 2.6 : 1);
        ctx.beginPath();
        ctx.ellipse(cx, cy, ring * 9, ring * 11, 0.4, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    }

    case 'swirl': {
      // Peppermint spiral from the centre out.
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = size * 0.09;
      ctx.lineCap = 'round';
      for (let arm = 0; arm < 3; arm++) {
        ctx.beginPath();
        for (let t = 0; t < 40; t++) {
          const a = (t / 40) * Math.PI * 2.4 + (arm / 3) * Math.PI * 2;
          const rad = (t / 40) * r * 1.5;
          const x = r + Math.cos(a) * rad;
          const y = r + Math.sin(a) * rad;
          if (t === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      break;
    }

    case 'starfield': {
      // Nebula wash, then stars — small, bright and unevenly spread.
      const neb = ctx.createRadialGradient(r * 0.7, r * 0.6, r * 0.1, r, r, r);
      neb.addColorStop(0, `${hexToCss(base)}dd`);
      neb.addColorStop(0.55, 'rgba(40,10,80,0.75)');
      neb.addColorStop(1, 'rgba(5,2,12,0.95)');
      ctx.fillStyle = neb;
      ctx.fillRect(0, 0, size, size);
      for (let i = 0; i < 70; i++) {
        const x = rand() * size;
        const y = rand() * size;
        const s = rand();
        ctx.fillStyle = `rgba(255,255,255,${0.35 + s * 0.65})`;
        ctx.beginPath();
        ctx.arc(x, y, s * 2.2 + 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }

    case 'glass': {
      // Lit from within, with a denser rim where the "glass" thickens.
      const core = ctx.createRadialGradient(r * 0.75, r * 0.7, r * 0.05, r, r, r);
      core.addColorStop(0, '#ffffff');
      core.addColorStop(0.35, `${hexToCss(base)}f2`);
      core.addColorStop(1, shiftHex(base, -70));
      ctx.fillStyle = core;
      ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = size * 0.045;
      ctx.beginPath();
      ctx.arc(r, r, r * 0.78, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }

    case 'engraved': {
      // Milled facets around the edge and a struck ring, so it reads as worked metal.
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(r + Math.cos(a) * r * 0.82, r + Math.sin(a) * r * 0.82);
        ctx.lineTo(r + Math.cos(a) * r, r + Math.sin(a) * r);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(r, r, r * 0.78, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(r, r, r * 0.72, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }

    case 'crackle': {
      // Aged glaze: irregular crazing plus a dusting of speckle.
      ctx.strokeStyle = 'rgba(70,50,30,0.3)';
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 18; i++) {
        let x = rand() * size;
        let y = rand() * size;
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let seg = 0; seg < 4; seg++) {
          x += (rand() - 0.5) * 44;
          y += (rand() - 0.5) * 44;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      for (let i = 0; i < 90; i++) {
        ctx.fillStyle = `rgba(90,70,40,${rand() * 0.16})`;
        ctx.fillRect(rand() * size, rand() * size, 2.5, 2.5);
      }
      break;
    }

    case 'prism': {
      // Refraction sweep across the face.
      const sweep = ctx.createLinearGradient(0, size, size, 0);
      const stops = ['#ff4d4d', '#ffc94d', '#39ff88', '#4aa8ff', '#b44dff'];
      stops.forEach((c, i) => sweep.addColorStop(i / (stops.length - 1), c));
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = sweep;
      ctx.fillRect(0, 0, size, size);
      ctx.globalAlpha = 1;
      // Hard-edged refraction bands, like light split through a facet.
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = `rgba(255,255,255,${0.16 + i * 0.05})`;
        ctx.save();
        ctx.translate(r, r);
        ctx.rotate(-0.7 + i * 0.22);
        ctx.fillRect(-size, -size * 0.06 + i * 22, size * 2, size * 0.05);
        ctx.restore();
      }
      break;
    }

    case 'circuit': {
      // Etched traces with solder pads, lit against a dark board.
      ctx.fillStyle = 'rgba(6,10,20,0.55)';
      ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = `${hexToCss(base)}`;
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'square';
      for (let i = 0; i < 9; i++) {
        let x = rand() * size;
        let y = rand() * size;
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let seg = 0; seg < 3; seg++) {
          // Traces only run at right angles, which is what makes them read as circuitry.
          if (rand() > 0.5) x += (rand() - 0.5) * 90;
          else y += (rand() - 0.5) * 90;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.fillStyle = hexToCss(base);
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }

    default:
      break;
  }
}

function generateBallCanvas(
  id: number,
  colorblindPatterns: boolean,
  set: BallSet
): HTMLCanvasElement {
  const style = styleForBallInSet(id, set);
  const canvas = document.createElement('canvas');
  canvas.width = TEX_SIZE;
  canvas.height = TEX_SIZE;
  const ctx = canvas.getContext('2d')!;
  const r = TEX_SIZE / 2;

  // A neon set is lit from within: lay a colour halo down before the ball itself.
  if (set.finish === 'neon') {
    const halo = ctx.createRadialGradient(r, r, r * 0.6, r, r, r);
    halo.addColorStop(0, `${hexToCss(style.base)}cc`);
    halo.addColorStop(1, `${hexToCss(style.base)}00`);
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
  }

  ctx.save();
  ctx.beginPath();
  ctx.arc(r, r, r - 2, 0, Math.PI * 2);
  ctx.clip();

  const bandHalf = TEX_SIZE * ((set.stripeWidth ?? 0.58) / 2);

  if (style.stripe) {
    ctx.fillStyle = hexToCss(set.backing);
    ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
    ctx.fillStyle = hexToCss(style.base);
    ctx.fillRect(0, r - bandHalf, TEX_SIZE, bandHalf * 2);
    // The surface treatment belongs to the coloured band only — a marbled *stripe* on a
    // plain white ball is what a real patterned set looks like.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, r - bandHalf, TEX_SIZE, bandHalf * 2);
    ctx.clip();
    paintBallPattern(ctx, TEX_SIZE, id, set, style.base);
    ctx.restore();
  } else {
    ctx.fillStyle = hexToCss(style.base);
    ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
    paintBallPattern(ctx, TEX_SIZE, id, set, style.base);
  }

  if (colorblindPatterns && id !== 0 && id !== 8) {
    ctx.strokeStyle = style.stripe ? '#ffffff' : 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 3;
    const spacing = 10;
    ctx.save();
    ctx.beginPath();
    ctx.arc(r, r, r - 2, 0, Math.PI * 2);
    ctx.clip();
    for (let x = -TEX_SIZE; x < TEX_SIZE * 2; x += spacing) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + TEX_SIZE, TEX_SIZE);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Cartoon shading: one soft crescent of shadow low-right rather than a smooth falloff,
  // which keeps the fill flat and saturated the way stylised game art does.
  const shadeStrength = set.finish === 'matte' ? 0.3 : set.finish === 'metallic' ? 0.55 : 0.42;
  const shade = ctx.createRadialGradient(r * 1.3, r * 1.34, r * 0.35, r * 0.62, r * 0.6, r * 1.42);
  shade.addColorStop(0, `rgba(20,10,30,${shadeStrength})`);
  shade.addColorStop(0.45, `rgba(20,10,30,${shadeStrength * 0.33})`);
  shade.addColorStop(1, 'rgba(20,10,30,0)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  // A metallic ball gets a hard horizon band instead of a soft sheen — that abrupt
  // light/dark split across the middle is what reads as polished metal.
  if (set.finish === 'metallic') {
    const band = ctx.createLinearGradient(0, r * 0.55, 0, r * 1.5);
    band.addColorStop(0, 'rgba(255,255,255,0.55)');
    band.addColorStop(0.48, 'rgba(255,255,255,0.05)');
    band.addColorStop(0.52, 'rgba(0,0,0,0.28)');
    band.addColorStop(1, 'rgba(255,255,255,0.22)');
    ctx.fillStyle = band;
    ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
  }

  // Broad soft sheen across the upper-left.
  const sheen = set.finish === 'matte' ? 0.3 : 0.6;
  const highlight = ctx.createRadialGradient(r * 0.56, r * 0.4, r * 0.05, r * 0.56, r * 0.4, r * 1.05);
  highlight.addColorStop(0, `rgba(255,255,255,${sheen})`);
  highlight.addColorStop(0.35, 'rgba(255,255,255,0.1)');
  highlight.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = highlight;
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  // Bold, well-defined cartoon catchlight — a big soft blob plus a small hard dot.
  // Matte cloth-finish balls skip the hard dot; they scatter light instead of mirroring it.
  const catchlight = set.finish === 'matte' ? 0.4 : 0.92;
  ctx.fillStyle = `rgba(255,255,255,${catchlight})`;
  ctx.beginPath();
  ctx.ellipse(r * 0.6, r * 0.44, r * 0.26, r * 0.19, -0.7, 0, Math.PI * 2);
  ctx.fill();
  if (set.finish !== 'matte') {
    ctx.fillStyle = 'rgba(255,255,255,0.99)';
    ctx.beginPath();
    ctx.ellipse(r * 1.36, r * 1.3, r * 0.16, r * 0.09, -0.7, 0, Math.PI * 2);
    ctx.fill();
  }

  // Rim shading, then a crisp dark outline — the outline is what really sells "cartoon".
  const rim = ctx.createRadialGradient(r, r, r * 0.74, r, r, r);
  rim.addColorStop(0, 'rgba(0,0,0,0)');
  rim.addColorStop(1, set.finish === 'neon' ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.42)');
  ctx.fillStyle = rim;
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  ctx.restore();

  ctx.strokeStyle = `${hexToCss(set.outline)}bf`;
  ctx.lineWidth = TEX_SIZE * 0.045;
  ctx.beginPath();
  ctx.arc(r, r, r - ctx.lineWidth / 2 - 1, 0, Math.PI * 2);
  ctx.stroke();

  return canvas;
}

/**
 * The number patch is drawn as its own sprite so it can be projected onto the ball's
 * surface as it rolls (moving across the face, squashing, and hiding round the back)
 * rather than just spinning flat with the whole ball.
 */
function generateNumberCanvas(id: number): HTMLCanvasElement | null {
  const style = styleForBall(id);
  const canvas = document.createElement('canvas');
  const size = 96;
  canvas.width = size;
  canvas.height = size;
  if (!style.label) return null;
  const ctx = canvas.getContext('2d')!;
  const r = size / 2;

  ctx.fillStyle = '#fbf8ef';
  ctx.beginPath();
  ctx.arc(r, r, r * 0.9, 0, Math.PI * 2);
  ctx.fill();

  // Slight inner shading so the patch doesn't look like a flat sticker.
  const patchShade = ctx.createRadialGradient(r * 0.72, r * 0.66, r * 0.1, r, r, r);
  patchShade.addColorStop(0, 'rgba(0,0,0,0)');
  patchShade.addColorStop(1, 'rgba(0,0,0,0.2)');
  ctx.fillStyle = patchShade;
  ctx.beginPath();
  ctx.arc(r, r, r * 0.9, 0, Math.PI * 2);
  ctx.fill();

  // Crisp outline to match the ball's cartoon edge.
  ctx.strokeStyle = 'rgba(12,10,20,0.4)';
  ctx.lineWidth = size * 0.035;
  ctx.beginPath();
  ctx.arc(r, r, r * 0.9, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = '#14141a';
  ctx.font = `900 ${Math.round(r * 1.1)}px 'Segoe UI', sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(style.label, r, r + 2);

  return canvas;
}

function generateFeltCanvas(colors: TableTheme): HTMLCanvasElement {
  const w = 1024;
  const h = Math.round((w * TABLE_WIDTH) / TABLE_LENGTH);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createRadialGradient(w / 2, h * 0.42, h * 0.1, w / 2, h / 2, w * 0.66);
  grad.addColorStop(0, colors.light);
  grad.addColorStop(1, colors.dark);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Baulk/head string, centre line and the two spots, as on a real cloth. Neon skips them —
  // painted lines on a backlit table read as dirt.
  if (colors.markings) {
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 2;
    for (const frac of [0.25, 0.5]) {
      ctx.beginPath();
      ctx.moveTo(w * frac, 0);
      ctx.lineTo(w * frac, h);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    for (const frac of [0.25, 0.72]) {
      ctx.beginPath();
      ctx.arc(w * frac, h / 2, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Faint woven-fabric speckle.
  const speckleCount = Math.round((w * h) / 260);
  ctx.globalAlpha = 1;
  for (let i = 0; i < speckleCount; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const shade = Math.random() > 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.045)';
    ctx.fillStyle = shade;
    ctx.fillRect(x, y, 1.4, 1.4);
  }

  // Directional sheen streak, like light raking across cloth.
  const sheen = ctx.createLinearGradient(0, 0, w, h * 0.6);
  sheen.addColorStop(0, 'rgba(255,255,255,0.05)');
  sheen.addColorStop(0.4, 'rgba(255,255,255,0)');
  sheen.addColorStop(1, 'rgba(0,0,0,0.08)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, w, h);

  // Light vignette toward the cushions — kept subtle so the cloth stays vivid.
  const vignette = ctx.createRadialGradient(w / 2, h / 2, w * 0.4, w / 2, h / 2, w * 0.68);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.2)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);

  return canvas;
}

/** Warm wood grain for the rails, generated once and tiled over the frame. */
function generateWoodCanvas(rail: string, railDark: string): HTMLCanvasElement {
  const w = 512;
  const h = 512;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = rail;
  ctx.fillRect(0, 0, w, h);

  // Long grain streaks with gently varying darkness.
  for (let i = 0; i < 200; i++) {
    const y = Math.random() * h;
    const thickness = 0.6 + Math.random() * 2.6;
    const dark = Math.random() * 0.16;
    ctx.strokeStyle = `rgba(60,34,14,${dark.toFixed(3)})`;
    ctx.lineWidth = thickness;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= w; x += 32) {
      ctx.lineTo(x, y + Math.sin((x / w) * Math.PI * 2 + i) * 3);
    }
    ctx.stroke();
  }

  // Broad tonal banding so the frame isn't a flat slab of colour.
  const band = ctx.createLinearGradient(0, 0, 0, h);
  band.addColorStop(0, 'rgba(255,255,255,0.10)');
  band.addColorStop(0.5, 'rgba(0,0,0,0)');
  band.addColorStop(1, railDark + '55');
  ctx.fillStyle = band;
  ctx.fillRect(0, 0, w, h);

  return canvas;
}

interface BallVisual {
  sprite: Sprite;
  /** Number patch, projected onto the rolling sphere surface. Null for the cue ball. */
  numberSprite: Sprite | null;
  /** Accumulated roll as a surface angle vector (radians) — drives the 3D number motion. */
  surface: { x: number; y: number };
  /** Recent screen positions, newest last, used to draw the speed trail. */
  trail: { x: number; y: number }[];
  /** Surface pose this ball is easing toward while at rest; re-rolled on each stop. */
  restTarget: { x: number; y: number } | null;
  /** Mirrors the server's pocketed flag so tick() can skip pocketed balls entirely. */
  pocketed: boolean;
  /** Active squash-and-stretch from a recent impact, oriented along the contact normal. */
  squash: { start: number; angle: number; power: number } | null;
  serverPos: { x: number; y: number };
  serverVel: { x: number; y: number };
  prevServerPos: { x: number; y: number };
  receivedAt: number;
  potStart: number | null;
  highlightPhase: number;
  highlighted: boolean;
}

/** Cap how far we'll dead-reckon a ball forward if network updates stall. */
const MAX_EXTRAPOLATION_S = 0.12;

export class TableRenderer {
  app: Application;
  private container: HTMLElement;
  private root = new Container();
  /** The themed room behind the table, drawn in screen space. */
  private sceneLayer = new Graphics();
  /** Canvas size and theme the scene was last painted for, so it only redraws on change. */
  private sceneKey = '';
  private tableLayer = new Container();
  private diamondLayer = new Graphics();
  private feltSprite: Sprite | null = null;
  private shadowLayer = new Graphics();
  private trailLayer = new Graphics();
  private highlightLayer = new Graphics();
  private ballLayer = new Container();
  private guideLayer = new Graphics();
  private fxLayer = new Container();
  private cueGlowLayer = new Graphics();
  private cueLayer = new Graphics();
  private chuteLayer = new Graphics();
  private chuteBallLayer = new Container();
  private powerBarLayer = new Graphics();
  private particles: ParticleSystem;
  private ballVisuals = new Map<number, BallVisual>();
  private chuteSprites = new Map<
    number,
    {
      ball: Sprite;
      number: Sprite | null;
      surface: { x: number; y: number };
      pos: { x: number; y: number };
      slot: { x: number; y: number };
      /** Has this ball finished its flight and slammed into the track yet? */
      landed: boolean;
      /** Timestamp of the landing impact, driving the squash-and-settle bounce. */
      landedAt: number;
      /** Vertical nudge from a neighbour landing, springing back to zero. */
      jostle: number;
    }
  >();
  /** Where each ball was last seen dropping, so its chute flight can start there. */
  private lastPotPos = new Map<number, { x: number; y: number }>();
  private textureCache = new Map<string, Texture>();
  private feltTextureCache = new Map<string, Texture>();
  private woodTextureCache = new Map<string, Texture>();
  private scale = 1;
  private aim: { angle: number; power: number; visible: boolean } = { angle: 0, power: 0, visible: false };
  private placementGhost: { x: number; y: number } | null = null;
  private colorblind = false;
  private theme: TableTheme = tableThemeFor(undefined);
  /** Table-wide ball art (the host's set) and the current shooter's cue/trail. */
  private ballSetId: string = DEFAULT_LOADOUT.ballSet;
  private ballSet: BallSet = ballSetFor(undefined);
  private cueSkin: CueSkin = cueSkinFor(undefined);
  private trailStyle: TrailStyle = trailStyleFor(undefined);
  private hitEffect: HitEffect = hitEffectFor(undefined);
  private hitEffectId: string = DEFAULT_LOADOUT.hitEffect;
  /** Shooter is on a scoring streak: their trail burns regardless of what's equipped. */
  private streakFire = false;
  /** Menu backdrop state — see startAttractMode. */
  private attract: { balls: Ball[]; idle: number } | null = null;
  private trailsEnabled = true;
  private shakeEnabled = true;
  private legalTargets: Set<number> = new Set();
  private shakeMag = 0;
  private elapsed = 0;
  private chromeless = false;

  private constructor(container: HTMLElement, app: Application) {
    this.container = container;
    this.app = app;
    this.particles = new ParticleSystem(this.fxLayer);
  }

  static async create(container: HTMLElement): Promise<TableRenderer> {
    const app = new Application();
    await app.init({ resizeTo: container, backgroundAlpha: 0, antialias: true });
    container.appendChild(app.canvas);
    const renderer = new TableRenderer(container, app);
    renderer.buildTable();
    // The room goes on the stage directly, in screen space, so it doesn't scale or shake
    // with the table sitting in it.
    app.stage.addChild(renderer.sceneLayer);
    app.stage.addChild(renderer.root);
    app.ticker.add((ticker) => renderer.tick(ticker.deltaMS / 1000));
    return renderer;
  }

  private buildTable(): void {
    const colors = this.theme;
    const outerX = -RAIL;
    const outerY = -RAIL;
    const outerW = TABLE_LENGTH + RAIL * 2;
    const outerH = TABLE_WIDTH + RAIL * 2;

    // --- Wood frame: drop shadow, dark under-edge, grained face, bevel highlights ---
    const frame = new Graphics();
    frame.roundRect(outerX + 6, outerY + 12, outerW, outerH, 40).fill({ color: 0x000000, alpha: 0.45 });
    frame.roundRect(outerX, outerY, outerW, outerH, 38).fill({ color: cssToHex(colors.railDark) });

    const woodSprite = new Sprite(this.woodTextureFor(colors.rail, colors.railDark));
    woodSprite.position.set(outerX + 7, outerY + 7);
    woodSprite.width = outerW - 14;
    woodSprite.height = outerH - 14;
    const woodMask = new Graphics()
      .roundRect(outerX + 7, outerY + 7, outerW - 14, outerH - 14, 32)
      .fill({ color: 0xffffff });
    woodSprite.mask = woodMask;

    const frameTop = new Graphics();
    // Light catching the top edge of the rail, shadow along the bottom.
    frameTop
      .roundRect(outerX + 7, outerY + 7, outerW - 14, outerH - 14, 32)
      .stroke({ width: 3, color: 0xffffff, alpha: 0.22 });
    frameTop.roundRect(outerX, outerY, outerW, outerH, 38).stroke({ width: 3, color: 0x000000, alpha: 0.35 });
    // Inner lip where the cushion meets the cloth.
    frameTop
      .roundRect(-12, -12, TABLE_LENGTH + 24, TABLE_WIDTH + 24, 14)
      .fill({ color: cssToHex(colors.railDark) });
    frameTop
      .roundRect(-12, -12, TABLE_LENGTH + 24, TABLE_WIDTH + 24, 14)
      .stroke({ width: 2.5, color: 0x000000, alpha: 0.4 });

    this.feltSprite = new Sprite(this.feltTextureFor(this.theme));
    this.feltSprite.width = TABLE_LENGTH;
    this.feltSprite.height = TABLE_WIDTH;

    const pocketGfx = this.buildPockets(this.theme);
    this.buildDiamonds();
    this.buildChute();

    this.tableLayer.removeChildren();
    this.tableLayer.addChild(frame, woodMask, woodSprite, frameTop, this.feltSprite, pocketGfx, this.diamondLayer);

    this.root.addChild(
      this.tableLayer,
      this.shadowLayer,
      this.trailLayer,
      this.highlightLayer,
      this.ballLayer,
      this.guideLayer,
      this.fxLayer,
      this.cueGlowLayer,
      this.cueLayer,
      this.chuteLayer,
      this.chuteBallLayer,
      this.powerBarLayer
    );

    if (!this.cueGlowLayer.filters) {
      this.cueGlowLayer.filters = [new BlurFilter({ strength: 5, quality: 3 })];
    }
  }

  /**
   * Pockets drawn the way a real table reads: a dark throat, with the cushions cut back
   * into angled jaws around each mouth rather than a plain circle punched in the cloth.
   * The cushion run is drawn as trapezoids whose playing edge (the nose) is the narrowest
   * point, so each pocket visibly opens up behind the nose like the real thing.
   */
  private buildPockets(theme: TableTheme): Graphics {
    const g = new Graphics();
    const CUSH = 30; // cushion depth from the playing edge outward
    const JAW = 26; // how far each cushion end angles back toward the pocket
    const cushion = cssToHex(theme.cushion);
    const leather = cssToHex(theme.pocket);
    const throat = cssToHex(theme.pocketDark);
    const cornerGap = 70;
    const sideGap = 58;
    const midX = TABLE_LENGTH / 2;

    /**
     * A pocket mouth is not a circle punched in the cloth — it's an opening *between* two
     * cushion jaws, bagging outward past the playing surface. Each one is built from the two
     * jaw tips plus an outward bulge, so corner pockets open on the diagonal and side pockets
     * open square, exactly as they do on a real table.
     */
    type Mouth = {
      a: { x: number; y: number };
      b: { x: number; y: number };
      out: { x: number; y: number };
      depth: number;
    };

    const D = Math.SQRT1_2;
    const mouths: Mouth[] = [
      // Corners, opening on the diagonal.
      // `depth` is how far the back of the bag sits past the *chord* between the jaw tips.
      // For a corner that chord already cuts across the corner, so the depth has to clear it
      // before the pocket reads as cutting into the rail at all.
      { a: { x: cornerGap, y: 0 }, b: { x: 0, y: cornerGap }, out: { x: -D, y: -D }, depth: 98 },
      {
        a: { x: TABLE_LENGTH - cornerGap, y: 0 },
        b: { x: TABLE_LENGTH, y: cornerGap },
        out: { x: D, y: -D },
        depth: 98,
      },
      {
        a: { x: 0, y: TABLE_WIDTH - cornerGap },
        b: { x: cornerGap, y: TABLE_WIDTH },
        out: { x: -D, y: D },
        depth: 98,
      },
      {
        a: { x: TABLE_LENGTH, y: TABLE_WIDTH - cornerGap },
        b: { x: TABLE_LENGTH - cornerGap, y: TABLE_WIDTH },
        out: { x: D, y: D },
        depth: 98,
      },
      // Sides, opening square to the rail.
      {
        a: { x: midX - sideGap, y: 0 },
        b: { x: midX + sideGap, y: 0 },
        out: { x: 0, y: -1 },
        depth: 50,
      },
      {
        a: { x: midX + sideGap, y: TABLE_WIDTH },
        b: { x: midX - sideGap, y: TABLE_WIDTH },
        out: { x: 0, y: 1 },
        depth: 50,
      },
    ];

    /**
     * Traces the bag: jaw tip → outward curve → other jaw tip → straight back across.
     *
     * A quadratic's midpoint is `0.5·mid + 0.5·control`, not the control point itself, so to
     * land the back of the bag exactly `depth` past the chord the control has to go *twice*
     * that far. Getting this wrong is what makes a pocket look like a shallow notch.
     */
    const bag = (m: Mouth, grow: number): void => {
      const mid = { x: (m.a.x + m.b.x) / 2, y: (m.a.y + m.b.y) / 2 };
      const d = (m.depth + grow) * 2;
      const ctrl = { x: mid.x + m.out.x * d, y: mid.y + m.out.y * d };
      const aOut = { x: m.a.x + m.out.x * grow, y: m.a.y + m.out.y * grow };
      const bOut = { x: m.b.x + m.out.x * grow, y: m.b.y + m.out.y * grow };
      g.moveTo(aOut.x, aOut.y).quadraticCurveTo(ctrl.x, ctrl.y, bOut.x, bOut.y).closePath();
    };

    for (const m of mouths) {
      // Leather surround, then the dark throat inside it, then a shadow across the top of
      // the throat so the hole reads as having depth rather than being a flat black shape.
      bag(m, 13);
      g.fill({ color: leather });
      bag(m, 13);
      g.stroke({ width: 3, color: 0x000000, alpha: 0.45 });

      bag(m, 0);
      g.fill({ color: throat });

      // Inner shadow pooling at the back of the bag, so it reads as depth not a flat shape.
      const mid = { x: (m.a.x + m.b.x) / 2, y: (m.a.y + m.b.y) / 2 };
      const back = { x: mid.x + m.out.x * m.depth * 0.55, y: mid.y + m.out.y * m.depth * 0.55 };
      g.circle(back.x, back.y, m.depth * 0.4).fill({ color: 0x000000, alpha: 0.5 });

      // A sliver of light on the far lip, which is what makes it look like a hole.
      bag(m, 6);
      g.stroke({ width: 2.5, color: 0xffffff, alpha: 0.12 });
    }

    // A cushion run along one edge: `along` walks the rail, `depth` points out of play.
    const run = (
      from: number,
      to: number,
      axis: 'h' | 'v',
      side: -1 | 1 // -1 = top/left cushion, 1 = bottom/right
    ): void => {
      const base = axis === 'h' ? (side < 0 ? 0 : TABLE_WIDTH) : side < 0 ? 0 : TABLE_LENGTH;
      const nose = base;
      const back = base + CUSH * side;
      const pt = (along: number, d: number): [number, number] =>
        axis === 'h' ? [along, d] : [d, along];

      const shape = [
        ...pt(from, nose),
        ...pt(to, nose),
        ...pt(to - JAW, back),
        ...pt(from + JAW, back),
      ];

      // Ink outline first, so the cushion carries the same cartoon edge as everything else.
      g.poly(shape).stroke({ width: 5, color: 0x1a1410, alpha: 0.85 });
      g.poly(shape).fill({ color: cushion });

      // Rounded lit nose along the playing edge — the highlight is what makes the rubber
      // read as a raised cushion rather than a flat painted band.
      g.moveTo(...pt(from + 3, nose + 2.5 * side)).lineTo(...pt(to - 3, nose + 2.5 * side));
      g.stroke({ width: 4, color: 0xffffff, alpha: 0.3, cap: 'round' });
      // Shadow cast onto the cloth just in front of it.
      g.moveTo(...pt(from, nose - 3 * side)).lineTo(...pt(to, nose - 3 * side));
      g.stroke({ width: 6, color: 0x000000, alpha: 0.18 });
    };

    // Long rails are split either side of the middle pocket; short rails run uninterrupted.
    run(cornerGap, midX - sideGap, 'h', -1);
    run(midX + sideGap, TABLE_LENGTH - cornerGap, 'h', -1);
    run(cornerGap, midX - sideGap, 'h', 1);
    run(midX + sideGap, TABLE_LENGTH - cornerGap, 'h', 1);
    run(cornerGap, TABLE_WIDTH - cornerGap, 'v', -1);
    run(cornerGap, TABLE_WIDTH - cornerGap, 'v', 1);

    return g;
  }

  /** The ball-return track down the right-hand side that collects potted balls. */
  private buildChute(): void {
    const g = this.chuteLayer;
    g.clear();
    const x = TABLE_LENGTH + RAIL + SIDE_GAP;
    const y = -RAIL + 10;
    const h = TABLE_WIDTH + RAIL * 2 - 20;
    const r = CHUTE_W / 2;

    g.roundRect(x + 4, y + 8, CHUTE_W, h, r).fill({ color: 0x000000, alpha: 0.45 });
    // Maple casing matching the rails, so the return track belongs to the same table.
    g.roundRect(x, y, CHUTE_W, h, r).fill({ color: cssToHex(this.theme.railDark) });
    g.roundRect(x + 3, y + 3, CHUTE_W - 6, h - 6, r - 3).fill({ color: cssToHex(this.theme.rail) });
    g.roundRect(x, y, CHUTE_W, h, r).stroke({ width: 3, color: 0x1a1410, alpha: 0.9 });
    // Recessed inner channel the balls sit in.
    const inset = 9;
    g.roundRect(x + inset, y + inset, CHUTE_W - inset * 2, h - inset * 2, r - inset).fill({
      color: cssToHex(this.theme.pocketDark),
    });
    g.roundRect(x + inset, y + inset, CHUTE_W - inset * 2, h - inset * 2, r - inset).stroke({
      width: 2.5,
      color: 0x1a1410,
      alpha: 0.9,
    });
  }

  private buildDiamonds(): void {
    const g = this.diamondLayer;
    g.clear();
    const inset = 22;
    const sight = cssToHex(this.theme.diamond);
    const draw = (x: number, y: number) => {
      g.circle(x, y, 4.5).fill({ color: sight, alpha: 0.85 });
    };
    for (let i = 1; i < 8; i++) {
      if (i === 4) continue; // no diamond over the side pockets
      const x = (TABLE_LENGTH * i) / 8;
      draw(x, -inset);
      draw(x, TABLE_WIDTH + inset);
    }
    for (const frac of [0.25, 0.5, 0.75]) {
      const y = TABLE_WIDTH * frac;
      draw(-inset, y);
      draw(TABLE_LENGTH + inset, y);
    }
  }

  private woodTextureFor(rail: string, railDark: string): Texture {
    const key = `${rail}|${railDark}`;
    let tex = this.woodTextureCache.get(key);
    if (!tex) {
      tex = Texture.from(generateWoodCanvas(rail, railDark));
      this.woodTextureCache.set(key, tex);
    }
    return tex;
  }

  private feltTextureFor(theme: TableTheme): Texture {
    let tex = this.feltTextureCache.get(theme.id);
    if (!tex) {
      tex = Texture.from(generateFeltCanvas(theme));
      this.feltTextureCache.set(theme.id, tex);
    }
    return tex;
  }

  /** Swaps the whole table — cloth, rails, pockets — and repaints the room behind it. */
  setTableTheme(id: string): void {
    const theme = tableThemeFor(id);
    if (this.theme.id === theme.id) return;
    this.theme = theme;
    applyTableThemeToPage(theme);
    this.buildTable();
  }

  setEffectsIntensity(level: 'low' | 'high'): void {
    this.particles.intensity = level;
  }

  /**
   * Fits the whole board — power bar, table, and ball-return chute — into the canvas as
   * one unit, then offsets so table-space (0,0) still lands on the cloth's top-left
   * corner. `chromeless` (the phone's mini table) drops the side furniture from the fit.
   */
  private layout(): void {
    const w = this.app.renderer.width;
    const h = this.app.renderer.height;
    const pad = 18;
    const left = this.chromeless ? -RAIL : BOARD_LEFT;
    const right = this.chromeless ? TABLE_LENGTH + RAIL : BOARD_RIGHT;
    const boardW = right - left;
    const boardH = this.chromeless ? TABLE_WIDTH + RAIL * 2 : BOARD_H;

    // Deliberately short of a perfect fit. At 100% the table crowds the screen edges, the
    // scoreboard sits on the rails, and — since themes became whole rooms — the room is
    // reduced to a sliver at the top and bottom.
    const FIT = this.chromeless ? 1 : 0.8;
    this.scale = Math.min((w - pad * 2) / boardW, (h - pad * 2) / boardH) * FIT;
    this.root.scale.set(this.scale);

    let ox = (w - boardW * this.scale) / 2 - left * this.scale;
    let oy = (h - boardH * this.scale) / 2 - BOARD_TOP * this.scale;
    if (this.shakeMag > 0.01) {
      ox += (Math.random() - 0.5) * this.shakeMag;
      oy += (Math.random() - 0.5) * this.shakeMag;
    }
    this.root.position.set(ox, oy);

    // Repaint the room only when the canvas or the theme actually changes — it's a lot of
    // geometry and none of it moves.
    const tableTop = oy + BOARD_TOP * this.scale;
    const key = `${this.theme.id}|${Math.round(w)}x${Math.round(h)}`;
    if (key !== this.sceneKey) {
      this.sceneKey = key;
      drawScene(this.sceneLayer, this.theme, w, h, tableTop);
    }
  }

  /** Hides the chute/power-bar furniture — used by the phone's small table preview. */
  setChromeless(enabled: boolean): void {
    this.chromeless = enabled;
    this.chuteLayer.visible = !enabled;
    this.chuteBallLayer.visible = !enabled;
    this.powerBarLayer.visible = !enabled;
  }

  setColorblindPatterns(enabled: boolean): void {
    if (this.colorblind === enabled) return;
    this.colorblind = enabled;
    this.textureCache.clear();
    for (const [id, visual] of this.ballVisuals) {
      visual.sprite.texture = this.textureFor(id);
    }
  }

  /**
   * The ball set is table furniture, so it comes from one place (the host's loadout) rather
   * than swapping per shooter — re-skinning all 16 balls mid-frame would be disorienting.
   */
  setBallSet(id: string | undefined): void {
    const next = id ?? DEFAULT_LOADOUT.ballSet;
    if (next === this.ballSetId) return;
    this.ballSetId = next;
    this.ballSet = ballSetFor(next);
    for (const [ballId, visual] of this.ballVisuals) visual.sprite.texture = this.textureFor(ballId);
    for (const [ballId, entry] of this.chuteSprites) entry.ball.texture = this.textureFor(ballId);
  }

  /** Cue and trail follow whoever is shooting, so a turn change visibly changes the kit. */
  setShooterLoadout(loadout: Loadout | undefined): void {
    const resolved = resolveLoadout(loadout);
    this.cueSkin = cueSkinFor(resolved.cue);
    this.trailStyle = trailStyleFor(resolved.trail);
    this.hitEffect = hitEffectFor(resolved.hitEffect);
    this.hitEffectId = resolved.hitEffect;
  }

  /** The shooter's equipped hit effect, so the impact *sound* can match the visual. */
  currentHitEffectId(): string {
    return this.hitEffectId;
  }

  setStreakFire(onFire: boolean): void {
    this.streakFire = onFire;
  }

  /** Speed trails can be switched off from settings on lower-end phones. */
  setTrailsEnabled(enabled: boolean): void {
    this.trailsEnabled = enabled;
    if (!enabled) {
      for (const visual of this.ballVisuals.values()) visual.trail.length = 0;
    }
  }

  private textureFor(id: number): Texture {
    const key = `${this.ballSetId}:${id}:${this.colorblind}`;
    let tex = this.textureCache.get(key);
    if (!tex) {
      tex = Texture.from(generateBallCanvas(id, this.colorblind, this.ballSet));
      this.textureCache.set(key, tex);
    }
    return tex;
  }

  private numberTextureFor(id: number): Texture | null {
    const key = `num:${id}`;
    let tex = this.textureCache.get(key);
    if (!tex) {
      const canvas = generateNumberCanvas(id);
      if (!canvas) return null;
      tex = Texture.from(canvas);
      this.textureCache.set(key, tex);
    }
    return tex;
  }

  private ensureVisual(id: number): BallVisual {
    let visual = this.ballVisuals.get(id);
    if (!visual) {
      const sprite = new Sprite(this.textureFor(id));
      sprite.anchor.set(0.5);
      sprite.width = BALL_RADIUS * 2;
      sprite.height = BALL_RADIUS * 2;
      this.ballLayer.addChild(sprite);

      const numTex = this.numberTextureFor(id);
      let numberSprite: Sprite | null = null;
      if (numTex) {
        numberSprite = new Sprite(numTex);
        numberSprite.anchor.set(0.5);
        this.ballLayer.addChild(numberSprite);
      }

      visual = {
        sprite,
        numberSprite,
        surface: { x: 0, y: 0 },
        trail: [],
        restTarget: null,
        pocketed: false,
        squash: null,
        serverPos: { x: sprite.x, y: sprite.y },
        serverVel: { x: 0, y: 0 },
        prevServerPos: { x: sprite.x, y: sprite.y },
        receivedAt: performance.now(),
        potStart: null,
        highlightPhase: Math.random() * Math.PI * 2,
        highlighted: false,
      };
      this.ballVisuals.set(id, visual);
    }
    return visual;
  }

  updateBalls(balls: Ball[]): void {
    this.updateChute(balls);
    for (const ball of balls) {
      const visual = this.ensureVisual(ball.id);
      visual.pocketed = ball.pocketed;
      if (ball.pocketed) {
        if (visual.potStart === null && visual.sprite.visible) {
          visual.potStart = performance.now();
        }
        continue;
      }
      visual.potStart = null;
      visual.sprite.visible = true;
      visual.sprite.alpha = 1;
      // Restore full size in case this ball was mid pot-animation shrink (e.g. a rematch
      // revived it) — use the width/height setters rather than a bare scale.set(1), since
      // scale 1 means "native texture pixels", not "the ball's actual table-unit size".
      visual.sprite.width = BALL_RADIUS * 2;
      visual.sprite.height = BALL_RADIUS * 2;
      visual.prevServerPos.x = visual.serverPos.x;
      visual.prevServerPos.y = visual.serverPos.y;
      visual.serverPos.x = ball.pos.x;
      visual.serverPos.y = ball.pos.y;
      visual.serverVel.x = ball.vel.x;
      visual.serverVel.y = ball.vel.y;
      visual.receivedAt = performance.now();
      if (visual.sprite.x === 0 && visual.sprite.y === 0) {
        visual.sprite.position.set(ball.pos.x, ball.pos.y);
        visual.prevServerPos.x = ball.pos.x;
        visual.prevServerPos.y = ball.pos.y;
      }
    }
  }

  /** Which balls to draw a soft pulsing "legal target" ring around, for the current shooter. */
  setLegalTargets(ids: number[]): void {
    this.legalTargets = new Set(ids);
  }

  /** Stacks every potted ball down the right-hand return chute, newest at the bottom. */
  private updateChute(balls: Ball[]): void {
    const potted = balls.filter((b) => b.pocketed && b.id !== 0).map((b) => b.id);
    const wanted = new Set(potted);

    for (const [id, entry] of this.chuteSprites) {
      if (!wanted.has(id)) {
        this.chuteBallLayer.removeChild(entry.ball);
        entry.ball.destroy();
        if (entry.number) {
          this.chuteBallLayer.removeChild(entry.number);
          entry.number.destroy();
        }
        this.chuteSprites.delete(id);
      }
    }

    const cx = TABLE_LENGTH + RAIL + SIDE_GAP + CHUTE_W / 2;
    const size = CHUTE_BALL;
    const step = size + 6;
    const top = -RAIL + 26 + size / 2;

    potted.forEach((id, i) => {
      let entry = this.chuteSprites.get(id);
      if (!entry) {
        const ball = new Sprite(this.textureFor(id));
        ball.anchor.set(0.5);
        ball.width = size;
        ball.height = size;
        this.chuteBallLayer.addChild(ball);

        // Each ball settles at its own random orientation, so the chute doesn't look
        // like a column of identically-posed stickers.
        const angle = Math.random() * 0.85;
        const dir = Math.random() * Math.PI * 2;
        const surface = { x: Math.cos(dir) * angle, y: Math.sin(dir) * angle };

        let number: Sprite | null = null;
        const numTex = this.numberTextureFor(id);
        if (numTex) {
          number = new Sprite(numTex);
          number.anchor.set(0.5);
          this.chuteBallLayer.addChild(number);
        }

        // Start the flight from the pocket it actually dropped into, when we know it.
        const from = this.lastPotPos.get(id);
        const pos = { x: from?.x ?? cx, y: from?.y ?? top };
        ball.position.set(pos.x, pos.y);
        entry = {
          ball,
          number,
          surface,
          pos,
          slot: { x: cx, y: top + i * step },
          // A ball that was already potted before this renderer existed (a reconnect, say)
          // shouldn't replay its landing — only ones we actually saw drop do.
          landed: !from,
          landedAt: 0,
          jostle: 0,
        };
        this.chuteSprites.set(id, entry);
      }

      entry.slot.x = cx;
      entry.slot.y = top + i * step;
      // Size is owned by animateChute (it squashes on landing), so don't reset it here.
    });
  }

  /**
   * Eases each chute ball toward its slot. Freshly potted balls fly in from the pocket
   * they dropped into, arcing rather than sliding straight; already-parked ones just
   * shuffle smoothly when the stack reorders, so nothing ever snaps into place.
   */
  private animateChute(deltaSeconds: number): void {
    const lerp = 1 - Math.exp(-deltaSeconds * 6.5);
    const now = performance.now();
    const SLAM_MS = 420;

    for (const entry of this.chuteSprites.values()) {
      const { ball, slot, number, pos } = entry;
      pos.x += (slot.x - pos.x) * lerp;
      pos.y += (slot.y - pos.y) * lerp;

      // Hop height falls off as the ball nears its slot, giving a settling arc. `pos` is
      // the ground-truth track position; the sprite is drawn lifted off it.
      const remaining = Math.hypot(slot.x - pos.x, slot.y - pos.y);
      const arc = Math.min(remaining * 0.35, 46);

      // Touchdown: the ball slams into the track, squashes, and knocks the stack below it.
      if (!entry.landed && remaining < 4) {
        entry.landed = true;
        entry.landedAt = now;
        entry.jostle = 0;
        for (const other of this.chuteSprites.values()) {
          if (other === entry) continue;
          if (other.slot.y > entry.slot.y) other.jostle += 5;
        }
        this.shake(2.5);
      }

      // Springy decay on the jostle so neighbours rattle rather than slide.
      entry.jostle += (0 - entry.jostle) * (1 - Math.exp(-deltaSeconds * 11));

      let squash = 0;
      if (entry.landed && entry.landedAt) {
        const t = (now - entry.landedAt) / SLAM_MS;
        if (t < 1) squash = 0.38 * Math.cos(t * Math.PI * 1.5) * (1 - t);
        else entry.landedAt = 0;
      }

      const drawY = pos.y - arc + entry.jostle;
      const spin = remaining > 1 ? this.elapsed * 5 : 0;

      ball.position.set(pos.x, drawY);
      ball.rotation = spin;
      ball.width = CHUTE_BALL * (1 + squash * 0.55);
      ball.height = CHUTE_BALL * (1 - squash);

      if (number) {
        const r = ball.width / 2;
        const a = Math.hypot(entry.surface.x, entry.surface.y);
        const depth = Math.cos(a);
        const sin = Math.sin(a);
        const ux = a > 1e-6 ? entry.surface.x / a : 0;
        const uy = a > 1e-6 ? entry.surface.y / a : 0;
        number.visible = depth > 0.05;
        number.position.set(pos.x + ux * sin * r, drawY + uy * sin * r);
        number.rotation = Math.atan2(uy * sin, ux * sin) + spin;
        number.width = r * 0.86 * depth;
        number.height = r * 0.86;
      }
    }
  }

  /** Vertical power gauge down the left of the table, chevroned like an arcade meter. */
  private drawPowerBar(): void {
    const g = this.powerBarLayer;
    g.clear();
    if (this.chromeless) return;

    const x = -(RAIL + SIDE_GAP + BAR_W);
    const y = -RAIL + 10;
    const h = TABLE_WIDTH + RAIL * 2 - 20;
    const r = BAR_W / 2;

    // Housing: maple casing with the same ink outline as the rest of the game.
    g.roundRect(x + 4, y + 10, BAR_W, h, r).fill({ color: 0x000000, alpha: 0.45 });
    g.roundRect(x, y, BAR_W, h, r).fill({ color: cssToHex(this.theme.railDark) });
    g.roundRect(x + 3, y + 3, BAR_W - 6, h - 6, r - 3).fill({ color: cssToHex(this.theme.rail) });
    g.roundRect(x, y, BAR_W, h, r).stroke({ width: 3, color: 0x1a1410, alpha: 0.9 });

    const innerX = x + 12;
    const innerY = y + 12;
    const innerW = BAR_W - 24;
    const innerH = h - 24;
    g.roundRect(innerX, innerY, innerW, innerH, innerW / 2).fill({ color: 0x241a12 });
    g.roundRect(innerX, innerY, innerW, innerH, innerW / 2).stroke({
      width: 2,
      color: 0x1a1410,
      alpha: 0.9,
    });

    const p = this.aim.visible ? this.aim.power : 0;
    const maxed = p > 0.965;

    // The meter is built from discrete segments rather than one smooth bar — it reads as a
    // charge level at a glance, and the top segments flashing is what sells "max power".
    const SEGMENTS = 14;
    const gap = 3;
    const segH = (innerH - gap * (SEGMENTS - 1)) / SEGMENTS;
    const lit = p * SEGMENTS;

    for (let i = 0; i < SEGMENTS; i++) {
      const frac = (i + 0.5) / SEGMENTS;
      const segY = innerY + innerH - (i + 1) * segH - i * gap;
      const on = i < lit;
      const partial = !on && i < lit + 1 ? lit - i : 0;

      const color =
        frac < 0.5
          ? lerpColor(0x4ac26b, 0xffe27a, frac / 0.5)
          : lerpColor(0xffe27a, 0xff4d4d, (frac - 0.5) / 0.5);

      if (!on && partial <= 0) {
        // Unlit segments stay clearly visible so the meter reads as a meter at rest, not as
        // an empty slot in the woodwork.
        g.roundRect(innerX + 2, segY, innerW - 4, segH, 3).fill({ color, alpha: 0.26 });
        continue;
      }

      const alpha = on ? 1 : 0.35 + partial * 0.5;
      // Flash the whole stack at full power.
      const flash = maxed ? 0.72 + 0.28 * Math.sin(this.elapsed * 22) : 1;
      g.roundRect(innerX + 2, segY, innerW - 4, segH, 3).fill({ color, alpha: alpha * flash });
      g.roundRect(innerX + 2, segY, innerW - 4, segH * 0.4, 3).fill({
        color: 0xffffff,
        alpha: 0.22 * alpha,
      });
    }

    // A highlight sweeping up the charged section, so the meter feels alive while held.
    if (p > 0.04) {
      const sweep = ((this.elapsed * 0.6) % 1) * p;
      const sweepY = innerY + innerH - sweep * innerH;
      g.roundRect(innerX + 1, sweepY - 7, innerW - 2, 14, 6).fill({ color: 0xffffff, alpha: 0.16 });
    }

    // Notch marks at the quarter points, cut into the wood beside the tube.
    for (let i = 1; i < 4; i++) {
      const ty = innerY + (innerH * i) / 4;
      g.roundRect(x + 4, ty - 1.5, 6, 3, 1.5).fill({ color: 0x1a1410, alpha: 0.6 });
      g.roundRect(x + BAR_W - 10, ty - 1.5, 6, 3, 1.5).fill({ color: 0x1a1410, alpha: 0.6 });
    }

    // Max-power crown at the top of the housing.
    if (maxed) {
      const glow = 0.55 + 0.45 * Math.sin(this.elapsed * 22);
      g.circle(x + BAR_W / 2, y + 6, 7).fill({ color: 0xff4d4d, alpha: glow });
    }
  }

  setAimVisual(angle: number, power: number, visible: boolean): void {
    this.aim = { angle, power, visible };
  }

  setAimPreview(cueBallId: number, preview: TrajectoryPreview | null): void {
    const g = this.guideLayer;
    g.clear();
    if (!preview) return;

    for (const seg of preview.cueBallPath) {
      this.dashedLine(g, seg.from, seg.to);
    }
    g.stroke({ width: 4, color: 0xffffff, alpha: 0.55 });

    if (preview.ghostBallPos) {
      g.circle(preview.ghostBallPos.x, preview.ghostBallPos.y, BALL_RADIUS);
      g.stroke({ width: 3, color: 0xffffff, alpha: 0.6 });
    }

    if (preview.objectBallPath.length) {
      for (const seg of preview.objectBallPath) {
        this.dashedLine(g, seg.from, seg.to);
      }
      g.stroke({ width: 3, color: 0xffe27a, alpha: 0.55 });
    }

    // Where the cue ball itself finishes — drawn in the accent colour so it's never confused
    // with the object ball's line. This is the only way the spin is visible before you shoot.
    if (preview.cueAfterPath.length) {
      for (const seg of preview.cueAfterPath) {
        this.dashedLine(g, seg.from, seg.to);
      }
      g.stroke({ width: 3, color: 0x34e2b0, alpha: 0.7 });
    }
    if (preview.cueRestPos) {
      g.circle(preview.cueRestPos.x, preview.cueRestPos.y, BALL_RADIUS);
      g.stroke({ width: 2.5, color: 0x34e2b0, alpha: 0.75 });
    }
    void cueBallId;
  }

  private dashedLine(g: Graphics, from: { x: number; y: number }, to: { x: number; y: number }): void {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy);
    const dash = 14;
    const gap = 10;
    const steps = Math.floor(len / (dash + gap));
    const ux = dx / (len || 1);
    const uy = dy / (len || 1);
    let d = 0;
    for (let i = 0; i <= steps; i++) {
      const sx = from.x + ux * d;
      const sy = from.y + uy * d;
      const ex = from.x + ux * Math.min(d + dash, len);
      const ey = from.y + uy * Math.min(d + dash, len);
      g.moveTo(sx, sy).lineTo(ex, ey);
      d += dash + gap;
    }
  }

  screenToTable(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.app.canvas.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    return {
      x: (localX - this.root.position.x) / this.scale,
      y: (localY - this.root.position.y) / this.scale,
    };
  }

  /**
   * Attract mode for the menu backdrop: the renderer drives its own simulation instead of
   * waiting for server snapshots, nudging balls again whenever the table settles. Uses the
   * same `stepSimulation` the server does, so the menu is showing real pool, not a loop.
   */
  startAttractMode(): void {
    if (this.attract) return;
    this.attract = { balls: rackBalls(), idle: 0 };
    // Scatter the rack so it doesn't open on a perfect triangle every time.
    for (const ball of this.attract.balls) {
      ball.pos.x = BALL_RADIUS * 3 + Math.random() * (TABLE_LENGTH - BALL_RADIUS * 6);
      ball.pos.y = BALL_RADIUS * 3 + Math.random() * (TABLE_WIDTH - BALL_RADIUS * 6);
    }
    this.nudgeAttractBalls();
  }

  stopAttractMode(): void {
    this.attract = null;
  }

  private nudgeAttractBalls(): void {
    if (!this.attract) return;
    const live = this.attract.balls.filter((b) => !b.pocketed);
    // Send two or three balls off at a gentle pace — this is wallpaper, not a break.
    for (let i = 0; i < 3; i++) {
      const ball = live[Math.floor(Math.random() * live.length)];
      if (!ball) continue;
      const angle = Math.random() * Math.PI * 2;
      const speed = 700 + Math.random() * 900;
      ball.vel = { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed };
    }
  }

  private tickAttract(deltaSeconds: number): void {
    const attract = this.attract;
    if (!attract) return;

    const { settled } = stepSimulation(attract.balls, Math.min(deltaSeconds, 1 / 30));
    // Balls that drop are put straight back so the table never empties out.
    for (const ball of attract.balls) {
      if (!ball.pocketed) continue;
      ball.pocketed = false;
      ball.pos = {
        x: BALL_RADIUS * 3 + Math.random() * (TABLE_LENGTH - BALL_RADIUS * 6),
        y: BALL_RADIUS * 3 + Math.random() * (TABLE_WIDTH - BALL_RADIUS * 6),
      };
      ball.vel = { x: 0, y: 0 };
    }

    if (settled) {
      attract.idle += deltaSeconds;
      if (attract.idle > 1.6) {
        attract.idle = 0;
        this.nudgeAttractBalls();
      }
    } else {
      attract.idle = 0;
    }

    this.updateBalls(attract.balls);
  }

  /** Inverse of screenToTable — used to fly DOM effects (XP toasts) off a table position. */
  tableToScreen(x: number, y: number): { x: number; y: number } {
    const rect = this.app.canvas.getBoundingClientRect();
    return {
      x: rect.left + this.root.position.x + x * this.scale,
      y: rect.top + this.root.position.y + y * this.scale,
    };
  }

  setPlacementGhost(pos: { x: number; y: number } | null): void {
    this.placementGhost = pos;
  }

  /** Screen shake, magnitude in table units; scale roughly with collision impulse. */
  shake(strength: number): void {
    if (!this.shakeEnabled) return;
    this.shakeMag = Math.max(this.shakeMag, Math.min(strength, 18));
  }

  setShakeEnabled(enabled: boolean): void {
    this.shakeEnabled = enabled;
    if (!enabled) this.shakeMag = 0;
  }

  /**
   * Full cartoon impact: sparks, a comic starburst, a shockwave ring, screen shake, and
   * squash-and-stretch on both balls along the contact normal.
   */
  spawnSparks(pos: { x: number; y: number }, impulse: number, aId?: number, bId?: number): void {
    const strength = Math.min(impulse / 2200, 1.4);
    this.particles.sparks(pos.x, pos.y, strength);
    if (strength > 0.35) this.shake(strength * 6);
    if (strength > 0.12) this.spawnImpactBurst(pos, strength);

    // Squash both balls along the line joining their centres.
    if (aId !== undefined && bId !== undefined && strength > 0.1) {
      const a = this.ballVisuals.get(aId);
      const b = this.ballVisuals.get(bId);
      if (a && b) {
        const angle = Math.atan2(b.sprite.y - a.sprite.y, b.sprite.x - a.sprite.x);
        const power = Math.min(0.34, 0.12 + strength * 0.2);
        a.squash = { start: performance.now(), angle, power };
        b.squash = { start: performance.now(), angle, power };
      }
    }
  }

  /**
   * The contact effect, drawn to whatever the shooter has equipped. The geometry differs per
   * shape but the life cycle is shared: pop out fast, then shrink and fade — the classic
   * squashy cartoon impact curve.
   */
  private spawnImpactBurst(pos: { x: number; y: number }, strength: number): void {
    const fx = this.hitEffect;
    const [core, mid, outerCol] = fx.colors;
    const outer = BALL_RADIUS * (0.85 + strength * 0.9) * fx.scale;

    const star = new Graphics();
    star.position.set(pos.x, pos.y);
    star.rotation = Math.random() * Math.PI;
    this.fxLayer.addChild(star);

    /** Star/burst outline built from alternating long and short radii. */
    const spikes = (count: number, innerRatio: number, jitter: number): number[] => {
      const pts: number[] = [];
      for (let i = 0; i < count * 2; i++) {
        // Jitter each point so the burst looks hand-drawn rather than machined.
        const r = (i % 2 === 0 ? outer : outer * innerRatio) * (1 - jitter + Math.random() * jitter * 2);
        const a = (i / (count * 2)) * Math.PI * 2;
        pts.push(Math.cos(a) * r, Math.sin(a) * r);
      }
      return pts;
    };

    const drawOutlined = (pts: number[], fill: number, stroke: number): void => {
      if (fx.outlined) star.poly(pts).stroke({ width: 7, color: 0x140f22, alpha: 0.85 });
      star.poly(pts).fill({ color: fill, alpha: 0.95 });
      star.poly(pts).stroke({ width: 3, color: stroke, alpha: 0.9 });
    };

    switch (fx.shape) {
      case 'pow':
        drawOutlined(spikes(Math.round(10 * fx.density), 0.4, 0.22), core, mid);
        break;

      case 'ring':
        // Mostly rings, so keep the centre small and let the shockwave do the work.
        star.circle(0, 0, outer * 0.42).fill({ color: core, alpha: 0.9 });
        star.circle(0, 0, outer * 0.75).stroke({ width: 5, color: mid, alpha: 0.8 });
        break;

      case 'puff':
        for (let i = 0; i < Math.round(7 * fx.density); i++) {
          const a = Math.random() * Math.PI * 2;
          const d = Math.random() * outer * 0.7;
          star
            .circle(Math.cos(a) * d, Math.sin(a) * d, outer * (0.3 + Math.random() * 0.35))
            .fill({ color: i % 2 ? core : mid, alpha: 0.5 });
        }
        break;

      case 'confetti':
        for (let i = 0; i < Math.round(12 * fx.density); i++) {
          const a = Math.random() * Math.PI * 2;
          const d = outer * (0.3 + Math.random() * 0.8);
          const c = [core, mid, outerCol][i % 3];
          star
            .rect(Math.cos(a) * d - 3, Math.sin(a) * d - 1.5, 7, 3.5)
            .fill({ color: c, alpha: 0.95 });
        }
        break;

      case 'bolt':
        for (let i = 0; i < Math.round(5 * fx.density); i++) {
          const a = Math.random() * Math.PI * 2;
          // Each bolt walks outward in three kinked segments.
          let x = 0;
          let y = 0;
          star.moveTo(0, 0);
          for (let seg = 1; seg <= 3; seg++) {
            const jitter = (Math.random() - 0.5) * 0.9;
            const r = (outer * 1.4 * seg) / 3;
            x = Math.cos(a + jitter) * r;
            y = Math.sin(a + jitter) * r;
            star.lineTo(x, y);
          }
          star.stroke({ width: 3 - i * 0.2, color: i % 2 ? core : mid, alpha: 0.95 });
        }
        break;

      case 'shard':
        for (let i = 0; i < Math.round(7 * fx.density); i++) {
          const a = (i / Math.round(7 * fx.density)) * Math.PI * 2 + Math.random() * 0.4;
          const len = outer * (0.7 + Math.random() * 0.7);
          const w = outer * 0.18;
          drawOutlined(
            [
              Math.cos(a) * len,
              Math.sin(a) * len,
              Math.cos(a + 0.5) * w,
              Math.sin(a + 0.5) * w,
              Math.cos(a - 0.5) * w,
              Math.sin(a - 0.5) * w,
            ],
            core,
            mid
          );
        }
        break;

      case 'splat':
        star.circle(0, 0, outer * 0.5).fill({ color: core, alpha: 0.9 });
        for (let i = 0; i < Math.round(8 * fx.density); i++) {
          const a = Math.random() * Math.PI * 2;
          const d = outer * (0.4 + Math.random() * 0.9);
          star
            .circle(Math.cos(a) * d, Math.sin(a) * d, outer * (0.08 + Math.random() * 0.22))
            .fill({ color: i % 2 ? core : mid, alpha: 0.85 });
        }
        break;

      case 'nova':
        star.circle(0, 0, outer * 0.9).fill({ color: outerCol, alpha: 0.28 });
        drawOutlined(spikes(Math.round(14 * fx.density), 0.24, 0.3), core, mid);
        star.circle(0, 0, outer * 0.36).fill({ color: 0xffffff, alpha: 0.95 });
        break;

      default: {
        // 'spark' — the original hand-drawn starburst, hot at high impact.
        const hot = strength > 0.7;
        drawOutlined(spikes(Math.round(9 * fx.density), 0.45, 0.18), hot ? core : 0xfff6d8, hot ? outerCol : mid);
      }
    }

    const ring = new Graphics();
    if (fx.ring) {
      ring.circle(0, 0, BALL_RADIUS * 0.8).stroke({ width: 4, color: mid, alpha: 0.85 });
    }
    ring.position.set(pos.x, pos.y);
    this.fxLayer.addChild(ring);

    const life = 240 + strength * 120;
    const start = performance.now();
    const step = (): void => {
      const t = (performance.now() - start) / life;
      if (t >= 1) {
        this.fxLayer.removeChild(star, ring);
        star.destroy();
        ring.destroy();
        return;
      }
      // Pop out fast, then shrink away — the classic squashy cartoon impact curve.
      const pop = t < 0.3 ? 0.35 + (t / 0.3) * 0.85 : 1.2 - (t - 0.3) * 0.5;
      star.scale.set(pop);
      star.alpha = 1 - t * t;
      ring.scale.set(1 + t * (2.2 + strength * 2));
      ring.alpha = (1 - t) * 0.7;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  spawnCushionDust(pos: { x: number; y: number }, speed: number): void {
    const normal = {
      x: pos.x < BALL_RADIUS * 2 ? 1 : pos.x > TABLE_LENGTH - BALL_RADIUS * 2 ? -1 : 0,
      y: pos.y < BALL_RADIUS * 2 ? 1 : pos.y > TABLE_WIDTH - BALL_RADIUS * 2 ? -1 : 0,
    };
    if (normal.x === 0 && normal.y === 0) normal.y = 1;
    this.particles.dust(pos.x, pos.y, normal, Math.min(speed / 1800, 1));
  }

  spawnChalkPuff(pos: { x: number; y: number }, angle: number): void {
    this.particles.chalkPuff(pos.x, pos.y, angle + Math.PI);
  }

  /**
   * The drop moment: a flash and shockwave tinted in the ball's own colour, a wide ripple
   * running out across the cloth, and confetti. `combo` (0 for the first ball on a shot)
   * scales the whole thing up so a multi-ball shot escalates visibly.
   */
  spawnPotFlash(pos: { x: number; y: number }, ballId: number, combo = 0): void {
    this.lastPotPos.set(ballId, { ...pos });
    const style = styleForBallInSet(ballId, this.ballSet);
    const boost = 1 + Math.min(combo, 4) * 0.28;

    this.particles.confetti(pos.x, pos.y, style.base);
    this.shake(5 * boost);

    const flash = new Graphics();
    flash.circle(0, 0, BALL_RADIUS * 1.6).fill({ color: 0xfff2c0, alpha: 0.9 });
    flash.position.set(pos.x, pos.y);
    this.fxLayer.addChild(flash);

    // Shockwave in the potted ball's colour, so a red ball drops with a red bang.
    const ring = new Graphics();
    ring.circle(0, 0, BALL_RADIUS).stroke({ width: 5 * boost, color: style.base, alpha: 0.95 });
    ring.position.set(pos.x, pos.y);
    this.fxLayer.addChild(ring);

    // Wide, slower ripple across the cloth — reads as the table itself reacting.
    const ripple = new Graphics();
    ripple.circle(0, 0, BALL_RADIUS * 1.4).stroke({ width: 3, color: 0xffffff, alpha: 0.5 });
    ripple.position.set(pos.x, pos.y);
    this.fxLayer.addChild(ripple);

    const start = performance.now();
    const step = (): void => {
      const t = (performance.now() - start) / (480 + combo * 90);
      if (t >= 1) {
        this.fxLayer.removeChild(flash, ring, ripple);
        flash.destroy();
        ring.destroy();
        ripple.destroy();
        return;
      }
      flash.scale.set(1 + t * 1.4 * boost);
      flash.alpha = (1 - t) * 0.9;
      ring.scale.set(1 + t * 4 * boost);
      ring.alpha = 1 - t;
      ripple.scale.set(1 + Math.pow(t, 0.6) * 7 * boost);
      ripple.alpha = (1 - t) * 0.45;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  private tick(deltaSeconds: number): void {
    this.elapsed += deltaSeconds;
    this.shakeMag *= Math.pow(0.001, deltaSeconds);
    this.layout();
    this.tickAttract(deltaSeconds);

    // Snappy correction toward the (moving) predicted point rather than a slow chase of a
    // stale snapshot — see the extrapolation note above updateBalls/tick.
    const posLerp = 1 - Math.exp(-deltaSeconds / 0.05);
    this.shadowLayer.clear();
    this.highlightLayer.clear();
    this.trailLayer.clear();

    for (const [id, visual] of this.ballVisuals) {
      // A pocketed ball is skipped outright once its drop animation finishes — otherwise
      // it keeps falling through to the normal path below and goes on painting a shadow
      // and a trail at its last table position forever.
      if (visual.pocketed) {
        visual.trail.length = 0;
        if (visual.numberSprite) visual.numberSprite.visible = false;

        if (visual.potStart !== null) {
          const t = (performance.now() - visual.potStart) / POT_ANIM_MS;
          if (t >= 1) {
            visual.sprite.visible = false;
            visual.potStart = null;
          } else {
            const shrink = 1 - t * 0.85;
            visual.sprite.alpha = 1 - t;
            visual.sprite.width = BALL_RADIUS * 2 * shrink;
            visual.sprite.height = BALL_RADIUS * 2 * shrink;
            visual.sprite.rotation += deltaSeconds * 10;
          }
        } else {
          visual.sprite.visible = false;
        }
        continue;
      }

      // Dead-reckon from the last server snapshot using its velocity, instead of just
      // lerping toward a position that's already up to a whole network tick stale — that
      // stale-target lag is what made bounces look like they happened short of the rail.
      const age = Math.min((performance.now() - visual.receivedAt) / 1000, MAX_EXTRAPOLATION_S);
      const predictedX = visual.serverPos.x + visual.serverVel.x * age;
      const predictedY = visual.serverPos.y + visual.serverVel.y * age;

      const prevX = visual.sprite.x;
      const prevY = visual.sprite.y;
      visual.sprite.x += (predictedX - visual.sprite.x) * posLerp;
      visual.sprite.y += (predictedY - visual.sprite.y) * posLerp;

      // Roll the ball's surface by however far it actually moved this frame. A rolling
      // sphere turns by (distance / radius) radians about the axis perpendicular to travel,
      // so the surface point tracking the number moves opposite the direction of travel.
      const movedX = visual.sprite.x - prevX;
      const movedY = visual.sprite.y - prevY;
      if (Math.hypot(movedX, movedY) > 0.01) {
        visual.surface.x -= movedX / BALL_RADIUS;
        visual.surface.y -= movedY / BALL_RADIUS;
      }

      const speed = Math.hypot(visual.serverVel.x, visual.serverVel.y);

      // Once a ball is nearly stopped, ease its number toward a resting pose. Each stop
      // picks a fresh random-ish pose (biased toward camera so most numbers stay readable)
      // so a settled table doesn't look like every ball is stamped identically.
      if (speed < 120) {
        if (visual.restTarget === null) {
          const angle = Math.random() * 0.7;
          const dir = Math.random() * Math.PI * 2;
          visual.restTarget = { x: Math.cos(dir) * angle, y: Math.sin(dir) * angle };
        }
        const settle = 1 - Math.exp(-deltaSeconds * 3.5);
        visual.surface.x += (visual.restTarget.x - visual.surface.x) * settle;
        visual.surface.y += (visual.restTarget.y - visual.surface.y) * settle;
      } else {
        visual.restTarget = null; // moving again: re-roll the pose next time it stops
      }

      this.applySquash(visual);
      this.updateTrail(visual, speed);

      this.shadowLayer
        .ellipse(visual.sprite.x + 4, visual.sprite.y + 6, BALL_RADIUS * 0.95, BALL_RADIUS * 0.7)
        .fill({ color: 0x000000, alpha: 0.3 });

      this.positionNumber(visual);

      if (this.legalTargets.has(id)) {
        visual.highlightPhase += deltaSeconds * 3.2;
        const pulse = 0.45 + Math.sin(visual.highlightPhase) * 0.25;
        this.highlightLayer
          .circle(visual.sprite.x, visual.sprite.y, BALL_RADIUS + 5)
          .stroke({ width: 2.5, color: 0xffe27a, alpha: pulse });
      }
    }

    this.particles.update(deltaSeconds);
    this.animateChute(deltaSeconds);
    this.drawCue();
    this.drawPowerBar();
  }

  /** Cartoon squash-and-stretch: compress along the impact normal, bulge across it. */
  private applySquash(visual: BallVisual): void {
    const D = BALL_RADIUS * 2;
    const s = visual.squash;
    if (!s) {
      visual.sprite.rotation = 0;
      visual.sprite.width = D;
      visual.sprite.height = D;
      return;
    }

    const SQUASH_MS = 190;
    const t = (performance.now() - s.start) / SQUASH_MS;
    if (t >= 1) {
      visual.squash = null;
      visual.sprite.rotation = 0;
      visual.sprite.width = D;
      visual.sprite.height = D;
      return;
    }

    // Springy release: hard squash on contact, overshoot slightly, then settle.
    const amount = s.power * Math.cos(t * Math.PI * 1.5) * (1 - t);
    visual.sprite.rotation = s.angle;
    visual.sprite.width = D * (1 - amount);
    visual.sprite.height = D * (1 + amount * 0.65);
  }

  /**
   * Speed-reactive comet trail: nothing at a crawl, a soft warm streak at pace, and a hot
   * red one on a hard strike. Length and width scale with speed too, so a slowing ball's
   * tail visibly shortens rather than snapping off.
   */
  private updateTrail(visual: BallVisual, speed: number): void {
    if (!this.trailsEnabled) return;

    // Low threshold so even a gently rolling ball leaves a faint wake, with the colour
    // ramp reaching red well before top speed so hard strikes read as hot immediately.
    const MIN_SPEED = 70;
    const MAX_SPEED = 2200;

    if (speed < MIN_SPEED) {
      if (visual.trail.length) visual.trail.shift(); // let the tail retract, don't blink out
    } else {
      visual.trail.push({ x: visual.sprite.x, y: visual.sprite.y });
    }

    // A scoring streak overrides the equipped style — the table should show you're hot.
    const style = this.streakFire ? trailStyleFor('trail.fire') : this.trailStyle;

    // Curve the ramp so slow rolls still show a visible (if cool-toned) tail.
    const raw = Math.min(1, Math.max(0, (speed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED)));
    const t = Math.pow(raw, 0.65);
    const maxPoints = Math.round((4 + t * 16) * style.length);
    while (visual.trail.length > maxPoints) visual.trail.shift();
    if (visual.trail.length < 2) return;

    const color = sampleRamp(style.ramp, t);
    const g = this.trailLayer;

    for (let i = 1; i < visual.trail.length; i++) {
      const a = visual.trail[i - 1];
      const b = visual.trail[i];
      const frac = i / visual.trail.length; // 0 at the tail, 1 at the ball
      // A comet tapers hard toward the tail; fire flares wide and wobbles.
      const shapeWidth =
        style.shape === 'comet'
          ? Math.pow(frac, 1.7)
          : style.shape === 'fire'
            ? frac * (0.8 + 0.35 * Math.sin(this.elapsed * 22 + i))
            : frac;
      const width = BALL_RADIUS * 1.6 * shapeWidth * (0.45 + t * 0.55) * style.width;

      if (style.glow) {
        g.moveTo(a.x, a.y).lineTo(b.x, b.y);
        g.stroke({ width: width * 2.1, color, alpha: frac * 0.18 * style.alpha, cap: 'round' });
      }

      g.moveTo(a.x, a.y).lineTo(b.x, b.y);
      g.stroke({
        width,
        color,
        alpha: frac * (0.25 + t * 0.5) * style.alpha,
        cap: 'round',
      });

      // Stardust scatters bright motes along the path rather than a continuous ribbon.
      if (style.shape === 'sparkle' && i % 2 === 0) {
        const jx = (Math.random() - 0.5) * BALL_RADIUS * 1.6;
        const jy = (Math.random() - 0.5) * BALL_RADIUS * 1.6;
        g.circle(b.x + jx, b.y + jy, 1.6 + frac * 2.4).fill({
          color: 0xffffff,
          alpha: frac * 0.7 * style.alpha,
        });
      }
    }
  }

  /**
   * Projects the number patch onto the ball's surface for the current roll state, so the
   * number slides across the face, foreshortens toward the edge, and disappears round the
   * back — instead of just spinning flat with the sprite.
   */
  private positionNumber(visual: BallVisual): void {
    const num = visual.numberSprite;
    if (!num) return;

    const ax = visual.surface.x;
    const ay = visual.surface.y;
    const angle = Math.hypot(ax, ay);

    // Surface point on a unit sphere: rotate the "front" pole (0,0,1) by `angle` about the
    // axis perpendicular to (ax, ay). depth > 0 means it's on the visible near hemisphere.
    const sinA = Math.sin(angle);
    const dirX = angle > 1e-6 ? ax / angle : 0;
    const dirY = angle > 1e-6 ? ay / angle : 0;
    const offX = dirX * sinA;
    const offY = dirY * sinA;
    const depth = Math.cos(angle);

    if (depth <= 0.05) {
      num.visible = false;
      return;
    }

    num.visible = visual.sprite.visible;
    num.x = visual.sprite.x + offX * BALL_RADIUS;
    num.y = visual.sprite.y + offY * BALL_RADIUS;

    // Foreshortening: the patch is rotated so its local X axis points radially outward
    // from the ball's centre, so squashing width by `depth` (and leaving height alone)
    // gives the correct "lying on a curved surface" compression as it nears the edge.
    const base = BALL_RADIUS * 0.86;
    num.rotation = Math.atan2(offY, offX);
    num.width = base * depth;
    num.height = base;
    num.alpha = visual.sprite.alpha * Math.min(1, depth * 4);
  }

  private drawCue(): void {
    const g = this.cueLayer;
    const glow = this.cueGlowLayer;
    g.clear();
    glow.clear();

    if (this.placementGhost) {
      g.circle(this.placementGhost.x, this.placementGhost.y, BALL_RADIUS).fill({ color: 0xffffff, alpha: 0.55 });
      g.circle(this.placementGhost.x, this.placementGhost.y, BALL_RADIUS).stroke({
        width: 2,
        color: 0xffffff,
        alpha: 0.9,
      });
      return;
    }

    if (!this.aim.visible) return;
    const cue = this.ballVisuals.get(0);
    if (!cue) return;

    const dirX = Math.cos(this.aim.angle);
    const dirY = Math.sin(this.aim.angle);
    const pullBack = BALL_RADIUS * 1.6 + this.aim.power * BALL_RADIUS * 5;
    const tipX = cue.sprite.x - dirX * pullBack;
    const tipY = cue.sprite.y - dirY * pullBack;
    const buttX = tipX - dirX * BALL_RADIUS * 9;
    const buttY = tipY - dirY * BALL_RADIUS * 9;

    // Power glow: green at low power, ramping through yellow to red at full power.
    const p = this.aim.power;
    const glowColor = p < 0.5 ? lerpColor(0x4ac26b, 0xffe27a, p / 0.5) : lerpColor(0xffe27a, 0xff4d4d, (p - 0.5) / 0.5);

    // Radial power gauge ring around the cue ball, so power reads clearly on the table
    // itself — not just on whichever device is holding the phone controller.
    const ringR = BALL_RADIUS * 2.6;
    const ringWidth = 6;
    g.circle(cue.sprite.x, cue.sprite.y, ringR).stroke({ width: ringWidth, color: 0xffffff, alpha: 0.18 });
    if (p > 0.015) {
      const start = -Math.PI / 2;
      const end = start + Math.PI * 2 * p;
      // arc() continues the existing path, and on a freshly-cleared Graphics the current
      // point is (0,0) — the top-left pocket — so it would draw a stray connector line
      // from the corner to the arc's start. moveTo the arc start first to avoid that.
      const arcStartX = cue.sprite.x + ringR * Math.cos(start);
      const arcStartY = cue.sprite.y + ringR * Math.sin(start);
      glow.moveTo(arcStartX, arcStartY).arc(cue.sprite.x, cue.sprite.y, ringR, start, end).stroke({
        width: ringWidth + 8,
        color: glowColor,
        alpha: 0.55,
        cap: 'round',
      });
      g.moveTo(arcStartX, arcStartY).arc(cue.sprite.x, cue.sprite.y, ringR, start, end).stroke({
        width: ringWidth,
        color: glowColor,
        alpha: 0.95,
        cap: 'round',
      });
    }

    glow.moveTo(buttX, buttY).lineTo(tipX, tipY);
    glow.stroke({ width: 14 + p * 10, color: glowColor, alpha: 0.35 + p * 0.35, cap: 'round' });

    // Cue-skin aura sits under the power glow, so a legendary cue reads as lit even at rest.
    const skin = this.cueSkin;
    if (skin.aura) {
      const tailX = tipX - dirX * CUE_LENGTH;
      const tailY = tipY - dirY * CUE_LENGTH;
      glow.moveTo(tailX, tailY).lineTo(tipX, tipY);
      glow.stroke({ width: 30, color: skin.aura, alpha: 0.22, cap: 'round' });
    }

    // Inferno's embers drift off the shaft while you're lining up.
    if (skin.embers && Math.random() < 0.35) {
      const f = 0.15 + Math.random() * 0.7;
      this.particles.embers(
        tipX - dirX * CUE_LENGTH * f,
        tipY - dirY * CUE_LENGTH * f
      );
    }

    this.drawCueStick(g, tipX, tipY, dirX, dirY);
  }

  /**
   * A proper two-piece cue rather than a coloured line: tapered from a slim ferrule up to
   * the butt, with a leather tip, joint collar, wrap section and butt cap, plus a specular
   * line along the top edge to give it roundness.
   *
   * Built from quads because Pixi strokes are constant-width — the taper is the whole point.
   */
  private drawCueStick(g: Graphics, tipX: number, tipY: number, dirX: number, dirY: number): void {
    const LEN = CUE_LENGTH;
    const R_TIP = 4.6;
    const R_BUTT = 13.5;
    // Perpendicular to the cue, used to fan each segment out to its half-width.
    const nx = -dirY;
    const ny = dirX;

    // Distance from the tip, as a fraction of total length, for each construction point.
    const stops = [0, 0.018, 0.05, 0.5, 0.545, 0.58, 0.86, 0.94, 1];
    const at = (f: number): { x: number; y: number; r: number } => ({
      x: tipX - dirX * LEN * f,
      y: tipY - dirY * LEN * f,
      r: R_TIP + (R_BUTT - R_TIP) * Math.pow(f, 0.72),
    });
    const seg = (f0: number, f1: number, color: number, alpha = 1): void => {
      const a = at(f0);
      const b = at(f1);
      g.poly([
        a.x + nx * a.r,
        a.y + ny * a.r,
        b.x + nx * b.r,
        b.y + ny * b.r,
        b.x - nx * b.r,
        b.y - ny * b.r,
        a.x - nx * a.r,
        a.y - ny * a.r,
      ]).fill({ color, alpha });
    };

    // Soft drop shadow, offset down-right like the ball shadows.
    const s0 = at(0);
    const s1 = at(1);
    g.poly([
      s0.x + nx * s0.r + 5,
      s0.y + ny * s0.r + 7,
      s1.x + nx * s1.r + 5,
      s1.y + ny * s1.r + 7,
      s1.x - nx * s1.r + 5,
      s1.y - ny * s1.r + 7,
      s0.x - nx * s0.r + 5,
      s0.y - ny * s0.r + 7,
    ]).fill({ color: 0x000000, alpha: 0.28 });

    // Palette ties the cue to the rest of the game: the table's tan rail wood for the
    // shaft and forearm, the UI's gold for the collars, and the accent blue for the tip.
    // Dark silhouette behind the whole stick, so the cue carries the same crisp cartoon
    // outline as the balls instead of reading as a different art style laid over them.
    const OUTLINE = 2.6;
    const o0 = at(0);
    const o1 = at(1);
    g.poly([
      o0.x + nx * (o0.r + OUTLINE),
      o0.y + ny * (o0.r + OUTLINE),
      o1.x + nx * (o1.r + OUTLINE),
      o1.y + ny * (o1.r + OUTLINE),
      o1.x - nx * (o1.r + OUTLINE),
      o1.y - ny * (o1.r + OUTLINE),
      o0.x - nx * (o0.r + OUTLINE),
      o0.y - ny * (o0.r + OUTLINE),
    ]).fill({ color: 0x0c0a14, alpha: 0.78 });
    g.circle(o1.x, o1.y, o1.r + OUTLINE).fill({ color: 0x0c0a14, alpha: 0.78 });

    // Section colours come from the equipped cue skin; the default is the house cue, whose
    // palette ties back to the table (rail wood shaft, UI gold collars, accent blue tip).
    const skin = this.cueSkin;
    // Aurora-style skins drift their shaft hue while you line the shot up.
    const shaft = skin.shimmer ? hueShift(skin.shaft, this.elapsed * 0.35) : skin.shaft;

    seg(stops[0], stops[1], skin.tip);
    seg(stops[1], stops[2], skin.ferrule);
    seg(stops[2], stops[3], shaft);
    seg(stops[3], stops[4], skin.collar);
    seg(stops[4], stops[5], skin.ring);
    seg(stops[5], stops[6], skin.forearm);
    seg(stops[6], stops[7], skin.wrap);
    seg(stops[7], stops[8], skin.butt);

    // Thin trim rings where the sections meet, like inlay on a real custom cue.
    for (const f of [0.58, 0.86, 0.94]) {
      seg(f - 0.008, f + 0.008, skin.inlay);
    }

    // Rounded-off butt end.
    const b = at(1);
    g.circle(b.x, b.y, b.r).fill({ color: skin.butt });

    // Specular highlight riding just off-centre along the length.
    const h0 = at(0.06);
    const h1 = at(0.97);
    g.poly([
      h0.x + nx * h0.r * 0.42,
      h0.y + ny * h0.r * 0.42,
      h1.x + nx * h1.r * 0.42,
      h1.y + ny * h1.r * 0.42,
      h1.x + nx * h1.r * 0.05,
      h1.y + ny * h1.r * 0.05,
      h0.x + nx * h0.r * 0.05,
      h0.y + ny * h0.r * 0.05,
    ]).fill({ color: 0xffffff, alpha: 0.22 });

    // Shaded underside edge to round the silhouette off.
    g.poly([
      h0.x - nx * h0.r,
      h0.y - ny * h0.r,
      h1.x - nx * h1.r,
      h1.y - ny * h1.r,
      h1.x - nx * h1.r * 0.55,
      h1.y - ny * h1.r * 0.55,
      h0.x - nx * h0.r * 0.55,
      h0.y - ny * h0.r * 0.55,
    ]).fill({ color: 0x000000, alpha: 0.22 });
  }

  destroy(): void {
    this.particles.clear();
    this.app.destroy(true, { children: true });
  }
}

/** Same green -> yellow -> red gradient used for the cue glow/power ring, as a CSS color. */
export function powerToCssColor(power: number): string {
  const hex =
    power < 0.5 ? lerpColor(0x4ac26b, 0xffe27a, power / 0.5) : lerpColor(0xffe27a, 0xff4d4d, (power - 0.5) / 0.5);
  return `#${hex.toString(16).padStart(6, '0')}`;
}

/** Rotates a colour's hue by `turns` (1 = full circle). Used by shimmering cue skins. */
function hueShift(color: number, turns: number): number {
  const r = ((color >> 16) & 0xff) / 255;
  const g = ((color >> 8) & 0xff) / 255;
  const b = (color & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return color;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h =
    max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = ((h / 6 + turns) % 1 + 1) % 1;

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number): number => {
    let v = ((t % 1) + 1) % 1;
    if (v < 1 / 6) v = p + (q - p) * 6 * v;
    else if (v < 1 / 2) v = q;
    else if (v < 2 / 3) v = p + (q - p) * (2 / 3 - v) * 6;
    else v = p;
    return Math.round(v * 255);
  };
  return (channel(h + 1 / 3) << 16) | (channel(h) << 8) | channel(h - 1 / 3);
}

function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}
