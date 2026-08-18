import { Container, Graphics } from 'pixi.js';

interface Particle {
  gfx: Graphics;
  vx: number;
  vy: number;
  gravity: number;
  drag: number;
  age: number;
  life: number;
  spin: number;
  shrink: boolean;
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** A small pooled-free particle system: circles/streaks with velocity, drag, gravity, and fade-out. */
export class ParticleSystem {
  private container: Container;
  private particles: Particle[] = [];
  intensity: 'low' | 'high' = 'high';

  constructor(container: Container) {
    this.container = container;
  }

  private countFor(base: number): number {
    return this.intensity === 'low' ? Math.max(1, Math.round(base * 0.4)) : base;
  }

  private spawnOne(x: number, y: number, gfx: Graphics, opts: Partial<Particle> & { life: number }): void {
    gfx.position.set(x, y);
    this.container.addChild(gfx);
    this.particles.push({
      gfx,
      vx: opts.vx ?? 0,
      vy: opts.vy ?? 0,
      gravity: opts.gravity ?? 0,
      drag: opts.drag ?? 0.9,
      age: 0,
      life: opts.life,
      spin: opts.spin ?? 0,
      shrink: opts.shrink ?? true,
    });
  }

  /** Bright, fast streaks for a ball-on-ball hit; scale count/speed with impact strength. */
  sparks(x: number, y: number, strength: number): void {
    const n = this.countFor(Math.round(4 + Math.min(strength, 1) * 10));
    for (let i = 0; i < n; i++) {
      const angle = rand(0, Math.PI * 2);
      const speed = rand(220, 520) * (0.5 + strength);
      const g = new Graphics();
      const len = rand(6, 14);
      g.moveTo(0, 0)
        .lineTo(len, 0)
        .stroke({ width: 2.2, color: Math.random() > 0.4 ? 0xfff2c0 : 0xffe27a, alpha: 0.95, cap: 'round' });
      g.rotation = angle;
      this.spawnOne(x, y, g, {
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        drag: 0.88,
        life: rand(0.18, 0.32),
      });
    }
  }

  /** Soft pale puffs for a cushion hit. */
  dust(x: number, y: number, normal: { x: number; y: number }, strength: number): void {
    const n = this.countFor(Math.round(2 + Math.min(strength, 1) * 3));
    for (let i = 0; i < n; i++) {
      const spread = rand(-0.7, 0.7);
      const dirX = normal.x * Math.cos(spread) - normal.y * Math.sin(spread);
      const dirY = normal.x * Math.sin(spread) + normal.y * Math.cos(spread);
      const speed = rand(40, 140);
      const g = new Graphics();
      g.circle(0, 0, rand(3, 6)).fill({ color: 0xe8e2d0, alpha: 0.5 });
      this.spawnOne(x, y, g, {
        vx: dirX * speed,
        vy: dirY * speed,
        drag: 0.85,
        life: rand(0.35, 0.6),
      });
    }
  }

  /** Colorful celebratory burst for a pocketed ball. */
  confetti(x: number, y: number, color: number): void {
    const n = this.countFor(14);
    const palette = [color, 0xffe27a, 0xffffff, 0x8fe3a0];
    for (let i = 0; i < n; i++) {
      const angle = rand(0, Math.PI * 2);
      const speed = rand(120, 340);
      const g = new Graphics();
      const c = palette[Math.floor(Math.random() * palette.length)];
      if (Math.random() > 0.5) {
        g.rect(-3, -1.5, 6, 3).fill({ color: c, alpha: 0.95 });
      } else {
        g.circle(0, 0, rand(2, 3.5)).fill({ color: c, alpha: 0.95 });
      }
      this.spawnOne(x, y, g, {
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 60,
        gravity: 420,
        drag: 0.96,
        spin: rand(-8, 8),
        life: rand(0.6, 1.1),
      });
    }
  }

  /** Small chalky puff at the cue tip when a shot fires. */
  chalkPuff(x: number, y: number, angleAwayFrom: number): void {
    const n = this.countFor(6);
    for (let i = 0; i < n; i++) {
      const spread = angleAwayFrom + rand(-0.5, 0.5);
      const speed = rand(30, 90);
      const g = new Graphics();
      g.circle(0, 0, rand(2, 4)).fill({ color: 0x9fc4e8, alpha: 0.55 });
      this.spawnOne(x, y, g, {
        vx: Math.cos(spread) * speed,
        vy: Math.sin(spread) * speed,
        drag: 0.9,
        life: rand(0.3, 0.5),
      });
    }
  }

  update(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += dt;
      if (p.age >= p.life) {
        this.container.removeChild(p.gfx);
        p.gfx.destroy();
        this.particles.splice(i, 1);
        continue;
      }
      p.vx *= Math.pow(p.drag, dt * 60);
      p.vy *= Math.pow(p.drag, dt * 60);
      p.vy += p.gravity * dt;
      p.gfx.x += p.vx * dt;
      p.gfx.y += p.vy * dt;
      if (p.spin) p.gfx.rotation += p.spin * dt;
      const t = p.age / p.life;
      p.gfx.alpha = 1 - t;
      if (p.shrink) p.gfx.scale.set(1 - t * 0.4);
    }
  }

  clear(): void {
    for (const p of this.particles) {
      this.container.removeChild(p.gfx);
      p.gfx.destroy();
    }
    this.particles = [];
  }
}
