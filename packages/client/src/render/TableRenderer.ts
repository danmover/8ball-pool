import { Application, BlurFilter, Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { Ball, FeltTheme, TrajectoryPreview } from '@8ball/shared';
import { BALL_RADIUS, POCKETS, TABLE_LENGTH, TABLE_WIDTH } from '@8ball/shared';
import { styleForBall } from './ballStyle';
import { ParticleSystem } from './Particles';

const TEX_SIZE = 128;
const POT_ANIM_MS = 320;

const FELT_THEMES: Record<FeltTheme, { light: string; dark: string; rail: string; railDark: string }> = {
  green: { light: '#1f8a4c', dark: '#0b3d24', rail: '#7a4a26', railDark: '#432712' },
  blue: { light: '#1f6fa8', dark: '#0a2b42', rail: '#5a4636', railDark: '#2e2419' },
  crimson: { light: '#9c2b3a', dark: '#3d0f16', rail: '#3a2a20', railDark: '#1c130e' },
  midnight: { light: '#2c2f52', dark: '#0a0b1c', rail: '#2a2a30', railDark: '#131317' },
};

function hexToCss(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

function generateBallCanvas(id: number, colorblindPatterns: boolean): HTMLCanvasElement {
  const style = styleForBall(id);
  const canvas = document.createElement('canvas');
  canvas.width = TEX_SIZE;
  canvas.height = TEX_SIZE;
  const ctx = canvas.getContext('2d')!;
  const r = TEX_SIZE / 2;

  ctx.save();
  ctx.beginPath();
  ctx.arc(r, r, r - 2, 0, Math.PI * 2);
  ctx.clip();

  if (style.stripe) {
    ctx.fillStyle = '#f6f2e6';
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

  // Soft broad highlight for the overall glossy sphere feel.
  const highlight = ctx.createRadialGradient(r * 0.6, r * 0.46, r * 0.06, r * 0.6, r * 0.46, r * 1.4);
  highlight.addColorStop(0, 'rgba(255,255,255,0.9)');
  highlight.addColorStop(0.28, 'rgba(255,255,255,0.16)');
  highlight.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = highlight;
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  if (style.label) {
    ctx.fillStyle = '#f6f2e6';
    ctx.beginPath();
    ctx.arc(r, r, r * 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#161616';
    ctx.font = `800 ${Math.round(r * 0.46)}px 'Segoe UI', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(style.label, r, r + 1);
  }

  // Rim shading gives the sphere an edge instead of a flat disc.
  const rim = ctx.createRadialGradient(r, r, r * 0.7, r, r, r);
  rim.addColorStop(0, 'rgba(0,0,0,0)');
  rim.addColorStop(1, 'rgba(0,0,0,0.42)');
  ctx.fillStyle = rim;
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  // A tight secondary specular dot sells the "wet gloss" look on top of the broad highlight.
  const spec = ctx.createRadialGradient(r * 0.42, r * 0.34, 0, r * 0.42, r * 0.34, r * 0.22);
  spec.addColorStop(0, 'rgba(255,255,255,0.95)');
  spec.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = spec;
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  ctx.restore();
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

  const grad = ctx.createRadialGradient(w / 2, h / 2, h * 0.15, w / 2, h / 2, w * 0.72);
  grad.addColorStop(0, colors.light);
  grad.addColorStop(1, colors.dark);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

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

  // Vignette toward the cushions.
  const vignette = ctx.createRadialGradient(w / 2, h / 2, w * 0.35, w / 2, h / 2, w * 0.62);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.38)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);

  return canvas;
}

interface BallVisual {
  sprite: Sprite;
  target: { x: number; y: number };
  prevTarget: { x: number; y: number };
  potStart: number | null;
  highlightPhase: number;
  highlighted: boolean;
}

export class TableRenderer {
  app: Application;
  private container: HTMLElement;
  private root = new Container();
  private tableLayer = new Container();
  private diamondLayer = new Graphics();
  private feltSprite: Sprite | null = null;
  private shadowLayer = new Graphics();
  private highlightLayer = new Graphics();
  private ballLayer = new Container();
  private guideLayer = new Graphics();
  private fxLayer = new Container();
  private cueGlowLayer = new Graphics();
  private cueLayer = new Graphics();
  private particles: ParticleSystem;
  private ballVisuals = new Map<number, BallVisual>();
  private textureCache = new Map<string, Texture>();
  private feltTextureCache = new Map<FeltTheme, Texture>();
  private scale = 1;
  private aim: { angle: number; power: number; visible: boolean } = { angle: 0, power: 0, visible: false };
  private placementGhost: { x: number; y: number } | null = null;
  private colorblind = false;
  private feltTheme: FeltTheme = 'green';
  private legalTargets: Set<number> = new Set();
  private shakeMag = 0;
  private elapsed = 0;

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
    app.ticker.add((ticker) => renderer.tick(ticker.deltaTime, ticker.deltaMS / 1000));
    return renderer;
  }

  private buildTable(): void {
    const rail = 50;
    const wood = new Graphics();
    const colors = FELT_THEMES[this.feltTheme];
    wood
      .roundRect(-rail, -rail, TABLE_LENGTH + rail * 2, TABLE_WIDTH + rail * 2, 30)
      .fill({ color: colors.railDark });
    wood
      .roundRect(-rail + 6, -rail + 6, TABLE_LENGTH + rail * 2 - 12, TABLE_WIDTH + rail * 2 - 12, 26)
      .fill({ color: colors.rail });
    // Bevel: a lighter inner edge catching the light, darker outer shadow edge.
    wood
      .roundRect(-rail + 6, -rail + 6, TABLE_LENGTH + rail * 2 - 12, TABLE_WIDTH + rail * 2 - 12, 26)
      .stroke({ width: 4, color: 0xffffff, alpha: 0.08 });
    wood.roundRect(-14, -14, TABLE_LENGTH + 28, TABLE_WIDTH + 28, 12).fill({ color: colors.railDark, alpha: 0.55 });

    this.feltSprite = new Sprite(this.feltTextureFor(this.feltTheme));
    this.feltSprite.width = TABLE_LENGTH;
    this.feltSprite.height = TABLE_WIDTH;

    const pocketGfx = new Graphics();
    for (const p of POCKETS) {
      pocketGfx.circle(p.x, p.y, p.radius + 6).fill({ color: 0x000000, alpha: 0.4 });
      pocketGfx.circle(p.x, p.y, p.radius).fill({ color: 0x040404 });
      pocketGfx.circle(p.x, p.y, p.radius * 0.55).fill({ color: 0x000000, alpha: 0.6 });
    }

    this.buildDiamonds();

    this.tableLayer.removeChildren();
    this.tableLayer.addChild(wood, this.feltSprite, pocketGfx, this.diamondLayer);

    this.root.addChild(
      this.tableLayer,
      this.shadowLayer,
      this.highlightLayer,
      this.ballLayer,
      this.guideLayer,
      this.fxLayer,
      this.cueGlowLayer,
      this.cueLayer
    );

    if (!this.cueGlowLayer.filters) {
      this.cueGlowLayer.filters = [new BlurFilter({ strength: 5, quality: 3 })];
    }
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

  private layout(): void {
    const w = this.app.renderer.width;
    const h = this.app.renderer.height;
    const pad = 30;
    this.scale = Math.min((w - pad * 2) / TABLE_LENGTH, (h - pad * 2) / TABLE_WIDTH);
    this.root.scale.set(this.scale);
    let ox = (w - TABLE_LENGTH * this.scale) / 2;
    let oy = (h - TABLE_WIDTH * this.scale) / 2;
    if (this.shakeMag > 0.01) {
      ox += (Math.random() - 0.5) * this.shakeMag;
      oy += (Math.random() - 0.5) * this.shakeMag;
    }
    this.root.position.set(ox, oy);
  }

  setColorblindPatterns(enabled: boolean): void {
    if (this.colorblind === enabled) return;
    this.colorblind = enabled;
    this.textureCache.clear();
    for (const [id, visual] of this.ballVisuals) {
      visual.sprite.texture = this.textureFor(id);
    }
  }

  private textureFor(id: number): Texture {
    const key = `${id}:${this.colorblind}`;
    let tex = this.textureCache.get(key);
    if (!tex) {
      tex = Texture.from(generateBallCanvas(id, this.colorblind));
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
      visual = {
        sprite,
        target: { x: sprite.x, y: sprite.y },
        prevTarget: { x: sprite.x, y: sprite.y },
        potStart: null,
        highlightPhase: Math.random() * Math.PI * 2,
        highlighted: false,
      };
      this.ballVisuals.set(id, visual);
    }
    return visual;
  }

  updateBalls(balls: Ball[]): void {
    for (const ball of balls) {
      const visual = this.ensureVisual(ball.id);
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
      visual.prevTarget.x = visual.target.x;
      visual.prevTarget.y = visual.target.y;
      visual.target.x = ball.pos.x;
      visual.target.y = ball.pos.y;
      if (visual.sprite.x === 0 && visual.sprite.y === 0) {
        visual.sprite.position.set(ball.pos.x, ball.pos.y);
        visual.prevTarget.x = ball.pos.x;
        visual.prevTarget.y = ball.pos.y;
      }
    }
  }

  /** Which balls to draw a soft pulsing "legal target" ring around, for the current shooter. */
  setLegalTargets(ids: number[]): void {
    this.legalTargets = new Set(ids);
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

  setPlacementGhost(pos: { x: number; y: number } | null): void {
    this.placementGhost = pos;
  }

  /** Screen shake, magnitude in table units; scale roughly with collision impulse. */
  shake(strength: number): void {
    this.shakeMag = Math.max(this.shakeMag, Math.min(strength, 18));
  }

  spawnSparks(pos: { x: number; y: number }, impulse: number): void {
    const strength = Math.min(impulse / 2200, 1.4);
    this.particles.sparks(pos.x, pos.y, strength);
    if (strength > 0.35) this.shake(strength * 6);
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

  spawnPotFlash(pos: { x: number; y: number }, ballId: number): void {
    const style = styleForBall(ballId);
    this.particles.confetti(pos.x, pos.y, style.base);
    this.shake(5);

    const flash = new Graphics();
    flash.circle(0, 0, BALL_RADIUS * 1.6).fill({ color: 0xfff2c0, alpha: 0.9 });
    flash.position.set(pos.x, pos.y);
    this.fxLayer.addChild(flash);

    const ring = new Graphics();
    ring.circle(0, 0, BALL_RADIUS).stroke({ width: 5, color: 0xffe27a, alpha: 0.9 });
    ring.position.set(pos.x, pos.y);
    this.fxLayer.addChild(ring);

    const start = performance.now();
    const step = (): void => {
      const t = (performance.now() - start) / 480;
      if (t >= 1) {
        this.fxLayer.removeChild(flash, ring);
        flash.destroy();
        ring.destroy();
        return;
      }
      flash.scale.set(1 + t * 1.4);
      flash.alpha = (1 - t) * 0.9;
      ring.scale.set(1 + t * 4);
      ring.alpha = 1 - t;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  private tick(deltaFrames: number, deltaSeconds: number): void {
    this.elapsed += deltaSeconds;
    this.shakeMag *= Math.pow(0.001, deltaSeconds);
    this.layout();

    const lerp = 1 - Math.pow(0.001, deltaFrames / 60);
    this.shadowLayer.clear();
    this.highlightLayer.clear();

    for (const [id, visual] of this.ballVisuals) {
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
        continue;
      }

      const dx = visual.target.x - visual.prevTarget.x;
      const dy = visual.target.y - visual.prevTarget.y;
      const rollDist = Math.hypot(dx, dy);
      if (rollDist > 0.02) {
        visual.sprite.rotation += (rollDist / BALL_RADIUS) * Math.sign(dx || dy || 1) * 0.6;
      }

      visual.sprite.x += (visual.target.x - visual.sprite.x) * lerp;
      visual.sprite.y += (visual.target.y - visual.sprite.y) * lerp;

      this.shadowLayer
        .ellipse(visual.sprite.x + 4, visual.sprite.y + 6, BALL_RADIUS * 0.95, BALL_RADIUS * 0.7)
        .fill({ color: 0x000000, alpha: 0.3 });

      if (this.legalTargets.has(id)) {
        visual.highlightPhase += deltaSeconds * 3.2;
        const pulse = 0.45 + Math.sin(visual.highlightPhase) * 0.25;
        this.highlightLayer
          .circle(visual.sprite.x, visual.sprite.y, BALL_RADIUS + 5)
          .stroke({ width: 2.5, color: 0xffe27a, alpha: pulse });
      }
    }

    this.particles.update(deltaSeconds);
    this.drawCue();
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
    glow.moveTo(buttX, buttY).lineTo(tipX, tipY);
    glow.stroke({ width: 14 + p * 10, color: glowColor, alpha: 0.35 + p * 0.35, cap: 'round' });

    g.moveTo(buttX, buttY).lineTo(tipX, tipY);
    g.stroke({ width: 9, color: 0xd9b98a, alpha: 0.95, cap: 'round' });
    g.moveTo(buttX, buttY).lineTo(buttX + dirX * BALL_RADIUS * 2.4, buttY + dirY * BALL_RADIUS * 2.4);
    g.stroke({ width: 9, color: 0x3a2413, alpha: 0.9, cap: 'round' });

    // Chalk-tip accent.
    g.circle(tipX, tipY, 5).fill({ color: 0x6d9dc9, alpha: 0.9 });
  }

  destroy(): void {
    this.particles.clear();
    this.app.destroy(true, { children: true });
  }
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
