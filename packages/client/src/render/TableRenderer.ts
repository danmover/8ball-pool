import { Application, BlurFilter, Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { Ball, FeltTheme, Loadout, TrajectoryPreview } from '@8ball/shared';
import { BALL_RADIUS, DEFAULT_LOADOUT, POCKETS, TABLE_LENGTH, TABLE_WIDTH, resolveLoadout } from '@8ball/shared';
import { styleForBall } from './ballStyle';
import { ParticleSystem } from './Particles';
import { ballSetFor, styleForBallInSet, type BallSet } from './cosmetics/ballSets';
import { cueSkinFor, type CueSkin } from './cosmetics/cueSkins';
import { sampleRamp, trailStyleFor, type TrailStyle } from './cosmetics/trailStyles';

const TEX_SIZE = 192;
const POT_ANIM_MS = 320;

// Light tan/maple rails around bright cloth, matching the reference art style.
// The light/dark pair is deliberately close together so the cloth reads as one flat,
// vivid colour with only a gentle centre glow rather than a heavy vignette.
const FELT_THEMES: Record<FeltTheme, { light: string; dark: string; rail: string; railDark: string }> = {
  green: { light: '#5fd88a', dark: '#28a85c', rail: '#c99a63', railDark: '#7d5533' },
  blue: { light: '#4fc0ee', dark: '#1f80b8', rail: '#c99a63', railDark: '#7d5533' },
  crimson: { light: '#e8697a', dark: '#a83244', rail: '#c99a63', railDark: '#7d5533' },
  midnight: { light: '#6e73ad', dark: '#383c6e', rail: '#8d8f9c', railDark: '#4a4c58' },
};

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

  if (style.stripe) {
    ctx.fillStyle = hexToCss(set.backing);
    ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
    ctx.fillStyle = hexToCss(style.base);
    ctx.fillRect(0, r - TEX_SIZE * 0.29, TEX_SIZE, TEX_SIZE * 0.58);
  } else {
    ctx.fillStyle = hexToCss(style.base);
    ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
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

function generateFeltCanvas(theme: FeltTheme): HTMLCanvasElement {
  const colors = FELT_THEMES[theme];
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

  // Baulk/head string and centre line, as on a real cloth.
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = 2;
  for (const frac of [0.25, 0.5]) {
    ctx.beginPath();
    ctx.moveTo(w * frac, 0);
    ctx.lineTo(w * frac, h);
    ctx.stroke();
  }
  // Head spot and foot spot.
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  for (const frac of [0.25, 0.72]) {
    ctx.beginPath();
    ctx.arc(w * frac, h / 2, 3.5, 0, Math.PI * 2);
    ctx.fill();
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
  private feltTextureCache = new Map<FeltTheme, Texture>();
  private woodTextureCache = new Map<string, Texture>();
  private scale = 1;
  private aim: { angle: number; power: number; visible: boolean } = { angle: 0, power: 0, visible: false };
  private placementGhost: { x: number; y: number } | null = null;
  private colorblind = false;
  private feltTheme: FeltTheme = 'green';
  /** Table-wide ball art (the host's set) and the current shooter's cue/trail. */
  private ballSetId: string = DEFAULT_LOADOUT.ballSet;
  private ballSet: BallSet = ballSetFor(undefined);
  private cueSkin: CueSkin = cueSkinFor(undefined);
  private trailStyle: TrailStyle = trailStyleFor(undefined);
  /** Shooter is on a scoring streak: their trail burns regardless of what's equipped. */
  private streakFire = false;
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
    app.stage.addChild(renderer.root);
    app.ticker.add((ticker) => renderer.tick(ticker.deltaMS / 1000));
    return renderer;
  }

  private buildTable(): void {
    const colors = FELT_THEMES[this.feltTheme];
    const outerX = -RAIL;
    const outerY = -RAIL;
    const outerW = TABLE_LENGTH + RAIL * 2;
    const outerH = TABLE_WIDTH + RAIL * 2;

    // --- Wood frame: drop shadow, dark under-edge, grained face, bevel highlights ---
    const frame = new Graphics();
    frame.roundRect(outerX + 6, outerY + 12, outerW, outerH, 40).fill({ color: 0x000000, alpha: 0.45 });
    frame.roundRect(outerX, outerY, outerW, outerH, 38).fill({ color: colors.railDark });

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
    frameTop.roundRect(-12, -12, TABLE_LENGTH + 24, TABLE_WIDTH + 24, 14).fill({ color: colors.railDark });
    frameTop
      .roundRect(-12, -12, TABLE_LENGTH + 24, TABLE_WIDTH + 24, 14)
      .stroke({ width: 2.5, color: 0x000000, alpha: 0.4 });

    this.feltSprite = new Sprite(this.feltTextureFor(this.feltTheme));
    this.feltSprite.width = TABLE_LENGTH;
    this.feltSprite.height = TABLE_WIDTH;

    const pocketGfx = this.buildPockets(colors);
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
  private buildPockets(colors: { light: string; dark: string; rail: string; railDark: string }): Graphics {
    const g = new Graphics();
    const CUSH = 30; // cushion depth from the playing edge outward
    const JAW = 26; // how far each cushion end angles back toward the pocket
    const cushion = Number('0x' + colors.dark.slice(1));
    const cornerGap = 62;
    const sideGap = 54;
    const midX = TABLE_LENGTH / 2;

    // Throats first, so the cushions overlap their edges.
    for (const p of POCKETS) {
      g.circle(p.x, p.y, p.radius * 1.55).fill({ color: 0x000000, alpha: 0.2 });
      g.circle(p.x, p.y, p.radius * 1.22).fill({ color: 0x08080a, alpha: 0.85 });
      g.circle(p.x, p.y, p.radius).fill({ color: 0x050507 });
      g.circle(p.x, p.y + p.radius * 0.2, p.radius * 0.66).fill({ color: 0x000000, alpha: 0.8 });
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

      g.poly([
        ...pt(from, nose),
        ...pt(to, nose),
        ...pt(to - JAW, back),
        ...pt(from + JAW, back),
      ]).fill({ color: cushion });

      // Lit nose edge and a shadow where the cushion meets the cloth.
      g.moveTo(...pt(from, nose)).lineTo(...pt(to, nose));
      g.stroke({ width: 3, color: 0xffffff, alpha: 0.18 });
      g.moveTo(...pt(from, nose + 3 * side)).lineTo(...pt(to, nose + 3 * side));
      g.stroke({ width: 5, color: 0x000000, alpha: 0.16 });
    };

    // Long rails are split either side of the middle pocket; short rails run uninterrupted.
    run(cornerGap, midX - sideGap, 'h', -1);
    run(midX + sideGap, TABLE_LENGTH - cornerGap, 'h', -1);
    run(cornerGap, midX - sideGap, 'h', 1);
    run(midX + sideGap, TABLE_LENGTH - cornerGap, 'h', 1);
    run(cornerGap, TABLE_WIDTH - cornerGap, 'v', -1);
    run(cornerGap, TABLE_WIDTH - cornerGap, 'v', 1);

    // Chrome pocket collars, like the plates on a real table.
    for (const p of POCKETS) {
      g.circle(p.x, p.y, p.radius * 1.24).stroke({ width: 4, color: 0xd8dbe2, alpha: 0.22 });
      g.circle(p.x, p.y, p.radius * 1.24).stroke({ width: 1.5, color: 0x000000, alpha: 0.35 });
    }

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
    g.roundRect(x, y, CHUTE_W, h, r).fill({ color: 0x1b1f29 });
    g.roundRect(x, y, CHUTE_W, h, r).stroke({ width: 3, color: 0xffffff, alpha: 0.09 });
    // Recessed inner channel the balls sit in.
    const inset = 9;
    g.roundRect(x + inset, y + inset, CHUTE_W - inset * 2, h - inset * 2, r - inset).fill({ color: 0x0b0d13 });
    g.roundRect(x + inset, y + inset, CHUTE_W - inset * 2, h - inset * 2, r - inset).stroke({
      width: 2,
      color: 0x000000,
      alpha: 0.6,
    });
  }

  private buildDiamonds(): void {
    const g = this.diamondLayer;
    g.clear();
    const inset = 22;
    const draw = (x: number, y: number) => {
      g.circle(x, y, 4.5).fill({ color: 0xf1e6c8, alpha: 0.85 });
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

  private feltTextureFor(theme: FeltTheme): Texture {
    let tex = this.feltTextureCache.get(theme);
    if (!tex) {
      tex = Texture.from(generateFeltCanvas(theme));
      this.feltTextureCache.set(theme, tex);
    }
    return tex;
  }

  setFeltTheme(theme: FeltTheme): void {
    if (this.feltTheme === theme) return;
    this.feltTheme = theme;
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

    this.scale = Math.min((w - pad * 2) / boardW, (h - pad * 2) / boardH);
    this.root.scale.set(this.scale);

    let ox = (w - boardW * this.scale) / 2 - left * this.scale;
    let oy = (h - boardH * this.scale) / 2 - BOARD_TOP * this.scale;
    if (this.shakeMag > 0.01) {
      ox += (Math.random() - 0.5) * this.shakeMag;
      oy += (Math.random() - 0.5) * this.shakeMag;
    }
    this.root.position.set(ox, oy);
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
  }

  setStreakFire(onFire: boolean): void {
    this.streakFire = onFire;
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

    g.roundRect(x + 3, y + 8, BAR_W, h, r).fill({ color: 0x000000, alpha: 0.45 });
    g.roundRect(x, y, BAR_W, h, r).fill({ color: 0x1b1f29 });
    g.roundRect(x, y, BAR_W, h, r).stroke({ width: 3, color: 0xffffff, alpha: 0.09 });

    const innerX = x + 11;
    const innerY = y + 11;
    const innerW = BAR_W - 22;
    const innerH = h - 22;
    g.roundRect(innerX, innerY, innerW, innerH, innerW / 2).fill({ color: 0x0b0d13 });

    const p = this.aim.visible ? this.aim.power : 0;
    if (p > 0.01) {
      const fillH = innerH * p;
      const fillY = innerY + innerH - fillH;
      const color =
        p < 0.5 ? lerpColor(0x4ac26b, 0xffe27a, p / 0.5) : lerpColor(0xffe27a, 0xff4d4d, (p - 0.5) / 0.5);
      g.roundRect(innerX, fillY, innerW, fillH, innerW / 2).fill({ color, alpha: 0.95 });

      // Chevrons marching up the filled section.
      const chevGap = 26;
      const phase = (this.elapsed * 40) % chevGap;
      for (let cy = innerY + innerH - phase; cy > fillY; cy -= chevGap) {
        const half = innerW * 0.3;
        g.moveTo(innerX + innerW / 2 - half, cy)
          .lineTo(innerX + innerW / 2, cy - 9)
          .lineTo(innerX + innerW / 2 + half, cy);
        g.stroke({ width: 3, color: 0xffffff, alpha: 0.4 });
      }
    }

    // Tick marks so the scale reads even when empty.
    for (let i = 1; i < 4; i++) {
      const ty = innerY + (innerH * i) / 4;
      g.moveTo(innerX + 4, ty).lineTo(innerX + innerW - 4, ty);
      g.stroke({ width: 1.5, color: 0xffffff, alpha: 0.12 });
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
    this.shakeMag = Math.max(this.shakeMag, Math.min(strength, 18));
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

  /** A jagged comic-book starburst plus an expanding ring at the point of contact. */
  private spawnImpactBurst(pos: { x: number; y: number }, strength: number): void {
    const spikes = 9;
    const outer = BALL_RADIUS * (0.85 + strength * 0.9);
    const inner = outer * 0.45;
    const pts: number[] = [];
    for (let i = 0; i < spikes * 2; i++) {
      // Jitter each spike so the burst looks hand-drawn rather than machined.
      const r = (i % 2 === 0 ? outer : inner) * (0.82 + Math.random() * 0.36);
      const a = (i / (spikes * 2)) * Math.PI * 2;
      pts.push(Math.cos(a) * r, Math.sin(a) * r);
    }

    const hot = strength > 0.7;
    const star = new Graphics();
    star.poly(pts).fill({ color: hot ? 0xffd25e : 0xfff6d8, alpha: 0.95 });
    star.poly(pts).stroke({ width: 3, color: hot ? 0xff6a2d : 0xffb43d, alpha: 0.9 });
    star.position.set(pos.x, pos.y);
    star.rotation = Math.random() * Math.PI;
    this.fxLayer.addChild(star);

    const ring = new Graphics();
    ring.circle(0, 0, BALL_RADIUS * 0.8).stroke({ width: 4, color: 0xffffff, alpha: 0.85 });
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
      const tailX = tipX - dirX * BALL_RADIUS * 23;
      const tailY = tipY - dirY * BALL_RADIUS * 23;
      glow.moveTo(tailX, tailY).lineTo(tipX, tipY);
      glow.stroke({ width: 30, color: skin.aura, alpha: 0.22, cap: 'round' });
    }

    // Inferno's embers drift off the shaft while you're lining up.
    if (skin.embers && Math.random() < 0.35) {
      const f = 0.15 + Math.random() * 0.7;
      this.particles.embers(
        tipX - dirX * BALL_RADIUS * 23 * f,
        tipY - dirY * BALL_RADIUS * 23 * f
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
    const LEN = BALL_RADIUS * 23;
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
