import { Application, Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { Ball, TrajectoryPreview } from '@8ball/shared';
import { BALL_RADIUS, POCKETS, TABLE_LENGTH, TABLE_WIDTH } from '@8ball/shared';
import { styleForBall } from './ballStyle';

const TEX_SIZE = 128;
const POT_ANIM_MS = 260;

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

  const highlight = ctx.createRadialGradient(r * 0.62, r * 0.5, r * 0.08, r * 0.62, r * 0.5, r * 1.35);
  highlight.addColorStop(0, 'rgba(255,255,255,0.9)');
  highlight.addColorStop(0.28, 'rgba(255,255,255,0.18)');
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

  const rim = ctx.createRadialGradient(r, r, r * 0.72, r, r, r);
  rim.addColorStop(0, 'rgba(0,0,0,0)');
  rim.addColorStop(1, 'rgba(0,0,0,0.4)');
  ctx.fillStyle = rim;
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  ctx.restore();
  return canvas;
}

interface BallVisual {
  sprite: Sprite;
  target: { x: number; y: number };
  potStart: number | null;
}

export class TableRenderer {
  app: Application;
  private container: HTMLElement;
  private root = new Container();
  private shadowLayer = new Graphics();
  private ballLayer = new Container();
  private guideLayer = new Graphics();
  private cueLayer = new Graphics();
  private fxLayer = new Container();
  private ballVisuals = new Map<number, BallVisual>();
  private textureCache = new Map<string, Texture>();
  private scale = 1;
  private aim: { angle: number; power: number; visible: boolean } = { angle: 0, power: 0, visible: false };
  private placementGhost: { x: number; y: number } | null = null;
  private colorblind = false;

  private constructor(container: HTMLElement, app: Application) {
    this.container = container;
    this.app = app;
  }

  static async create(container: HTMLElement): Promise<TableRenderer> {
    const app = new Application();
    await app.init({ resizeTo: container, backgroundAlpha: 0, antialias: true });
    container.appendChild(app.canvas);
    const renderer = new TableRenderer(container, app);
    renderer.buildTable();
    app.stage.addChild(renderer.root);
    app.ticker.add((ticker) => renderer.tick(ticker.deltaTime));
    return renderer;
  }

  private buildTable(): void {
    const g = new Graphics();
    const rail = 46;
    g.roundRect(-rail, -rail, TABLE_LENGTH + rail * 2, TABLE_WIDTH + rail * 2, 28).fill({ color: 0x4a2a15 });
    g.roundRect(-rail + 8, -rail + 8, TABLE_LENGTH + rail * 2 - 16, TABLE_WIDTH + rail * 2 - 16, 22).fill({
      color: 0x6b3f22,
    });
    g.rect(0, 0, TABLE_LENGTH, TABLE_WIDTH).fill({ color: 0x14703c });
    g.rect(0, 0, TABLE_LENGTH, TABLE_WIDTH).stroke({ width: 18, color: 0x0b3d24, alpha: 0.3 });

    for (const p of POCKETS) {
      g.circle(p.x, p.y, p.radius + 5).fill({ color: 0x030303, alpha: 0.5 });
      g.circle(p.x, p.y, p.radius).fill({ color: 0x050505 });
    }

    this.root.addChild(g, this.shadowLayer, this.ballLayer, this.guideLayer, this.fxLayer, this.cueLayer);
  }

  private layout(): void {
    const w = this.app.renderer.width;
    const h = this.app.renderer.height;
    const pad = 30;
    this.scale = Math.min((w - pad * 2) / TABLE_LENGTH, (h - pad * 2) / TABLE_WIDTH);
    this.root.scale.set(this.scale);
    this.root.position.set((w - TABLE_LENGTH * this.scale) / 2, (h - TABLE_WIDTH * this.scale) / 2);
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
      visual = { sprite, target: { x: sprite.x, y: sprite.y }, potStart: null };
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
      visual.sprite.scale.set(1);
      visual.target.x = ball.pos.x;
      visual.target.y = ball.pos.y;
      if (visual.sprite.x === 0 && visual.sprite.y === 0) {
        visual.sprite.position.set(ball.pos.x, ball.pos.y);
      }
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

  setPlacementGhost(pos: { x: number; y: number } | null): void {
    this.placementGhost = pos;
  }

  spawnPotFlash(pos: { x: number; y: number }): void {
    const flash = new Graphics();
    flash.circle(0, 0, BALL_RADIUS * 1.8).fill({ color: 0xffe27a, alpha: 0.8 });
    flash.position.set(pos.x, pos.y);
    this.fxLayer.addChild(flash);
    const start = performance.now();
    const step = () => {
      const t = (performance.now() - start) / 350;
      if (t >= 1) {
        this.fxLayer.removeChild(flash);
        flash.destroy();
        return;
      }
      flash.scale.set(1 + t * 1.6);
      flash.alpha = 1 - t;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  private tick(deltaFrames: number): void {
    this.layout();

    const lerp = 1 - Math.pow(0.001, deltaFrames / 60);
    this.shadowLayer.clear();
    for (const visual of this.ballVisuals.values()) {
      if (visual.potStart !== null) {
        const t = (performance.now() - visual.potStart) / POT_ANIM_MS;
        if (t >= 1) {
          visual.sprite.visible = false;
          visual.potStart = null;
        } else {
          visual.sprite.alpha = 1 - t;
          visual.sprite.scale.set(1 - t * 0.9);
        }
        continue;
      }
      visual.sprite.x += (visual.target.x - visual.sprite.x) * lerp;
      visual.sprite.y += (visual.target.y - visual.sprite.y) * lerp;
      this.shadowLayer
        .ellipse(visual.sprite.x + 4, visual.sprite.y + 6, BALL_RADIUS * 0.95, BALL_RADIUS * 0.7)
        .fill({ color: 0x000000, alpha: 0.28 });
    }

    this.drawCue();
  }

  private drawCue(): void {
    const g = this.cueLayer;
    g.clear();

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

    g.moveTo(buttX, buttY).lineTo(tipX, tipY);
    g.stroke({ width: 9, color: 0xd9b98a, alpha: 0.95, cap: 'round' });
    g.moveTo(buttX, buttY).lineTo(buttX + dirX * BALL_RADIUS * 2.4, buttY + dirY * BALL_RADIUS * 2.4);
    g.stroke({ width: 9, color: 0x3a2413, alpha: 0.9, cap: 'round' });
  }

  destroy(): void {
    this.app.destroy(true, { children: true });
  }
}
