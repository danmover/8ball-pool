/**
 * The air, moving.
 *
 * `scenes.ts` paints the backdrop once and caches it, which is right — a light pool and a
 * gradient do not need repainting sixty times a second. But a beam of light with nothing
 * floating in it is a flat shape, and the one detail that makes a lamp read as a *lamp* is the
 * dust turning over inside its cone. That is what this layer is for.
 *
 * A second layer over the static one, redrawn every frame and deliberately cheap — a few hundred
 * primitives, no filters, no per-frame allocation. Effects are named entries in a *recipe*
 * rather than bespoke functions, and the recipe is chosen by the theme's lamp, so a table built
 * in the Studio gets air that matches its own light.
 *
 * It is drawn in screen space, behind the table, and it is the first thing switched off by
 * "reduce motion" — the whole point of that setting is the things on this list.
 */

import { Graphics } from 'pixi.js';
import type { TableRect } from './cosmetics/scenes';
import type { TableTheme } from './cosmetics/tableThemes';

type EffectId =
  | 'motes'
  | 'embers'
  | 'bokeh'
  | 'snow'
  | 'bubbles'
  | 'aurora'
  | 'caustics'
  | 'flicker'
  | 'pulseRings'
  | 'beamSweep'
  | 'lampBreathe';

interface EffectSpec {
  id: EffectId;
  /** Particle count, ring count, blade count — whatever the effect counts. */
  count?: number;
  /** Overall strength, 0..1-ish. Scaled again by the user's effects setting. */
  amount?: number;
  /** Overridden colour; most effects default to the lamp's. */
  color?: number;
  /** Rate multiplier. */
  speed?: number;
}

/**
 * What is alive in the dark, keyed on the lamp rather than on a venue.
 *
 * This used to be one list per drawn room, and four of the effects in it only made sense inside
 * one: a ceiling fan needs a ceiling, film grain needs a projector, blowing sand needs outdoors,
 * a CRT scanline needs a screen. The rooms are gone, so those went with them rather than being
 * left to play over a void where they read as glitches.
 *
 * Keying on the lamp is what the backdrop itself does, and it means a table built in the Theme
 * Studio gets air that matches its light instead of borrowing the nearest preset's. Kept to two
 * or three apiece: the failure mode of an effects layer is that everything ends up with
 * everything on it and none of it is anywhere in particular.
 */
const BY_LAMP: Record<string, EffectSpec[]> = {
  // A low warm bulb: dust turning over in the cone, and the filament never quite steady.
  pendant: [
    { id: 'lampBreathe', amount: 0.6 },
    { id: 'motes', count: 64, amount: 0.65 },
  ],
  // A cold hard spot: very little in the air, and the beam itself visible as it moves.
  spot: [
    { id: 'beamSweep', amount: 0.5, speed: 0.24 },
    { id: 'motes', count: 26, amount: 0.35 },
    { id: 'lampBreathe', amount: 0.35 },
  ],
  // Tube light: it pulses, it flickers, and the floor answers it.
  neon: [
    { id: 'pulseRings', count: 3, amount: 0.55 },
    { id: 'flicker', amount: 0.5 },
    { id: 'motes', count: 22, amount: 0.3 },
  ],
  // A flame: embers coming off it, and a much softer, slower breath.
  candle: [
    { id: 'embers', count: 24, amount: 0.6 },
    { id: 'motes', count: 42, amount: 0.5 },
    { id: 'lampBreathe', amount: 0.5 },
  ],
  // A broad wash: almost no beam to see, so all that is left is what floats in it.
  daylight: [
    { id: 'motes', count: 54, amount: 0.5 },
    { id: 'lampBreathe', amount: 0.3 },
  ],
  // UV: the beam is the whole effect, and everything in the air glows in it.
  ultraviolet: [
    { id: 'beamSweep', amount: 0.45, speed: 0.32 },
    { id: 'motes', count: 68, amount: 0.7 },
    { id: 'lampBreathe', amount: 0.4 },
  ],
  // Banked heat: embers, close and warm.
  ember: [
    { id: 'embers', count: 28, amount: 0.7 },
    { id: 'motes', count: 34, amount: 0.45 },
    { id: 'lampBreathe', amount: 0.5 },
  ],
};

/**
 * The handful of tables that keep a signature of their own.
 *
 * Only where the effect still reads correctly with nothing behind it — a ribbon of cold light
 * and drifting flakes work perfectly well in a void, which is why Ice keeps them where the ice
 * cavern's floor caustics did not.
 */
const BY_THEME: Record<string, EffectSpec[]> = {
  ice: [
    { id: 'aurora', count: 3, amount: 0.45 },
    { id: 'snow', count: 60, amount: 0.55 },
    { id: 'motes', count: 20, amount: 0.3, color: 0xdff0ff },
  ],
  champagne: [
    { id: 'bubbles', count: 40, amount: 0.6 },
    { id: 'motes', count: 40, amount: 0.5 },
    { id: 'lampBreathe', amount: 0.55 },
  ],
  midnight: [
    { id: 'bokeh', count: 12, amount: 0.4 },
    { id: 'beamSweep', amount: 0.4, speed: 0.24 },
    { id: 'motes', count: 26, amount: 0.35 },
  ],
  emerald: [
    { id: 'lampBreathe', amount: 0.6 },
    { id: 'motes', count: 56, amount: 0.65, color: 0xffd88a },
    { id: 'caustics', count: 5, amount: 0.16, color: 0x2fbf7a },
  ],
};

/** One drifting thing. Reused in place — the array is allocated once per resize and never grows. */
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  /** Phase for whatever wobble this effect applies. */
  p: number;
  /** Per-particle rate variation, so nothing pulses in lockstep. */
  k: number;
  a: number;
}

function cssToHex(color: string): number {
  return parseInt(color.replace('#', ''), 16) || 0xffffff;
}

export class AmbientFx {
  private g: Graphics;
  private w = 0;
  private h = 0;
  private table: TableRect = { x: 0, y: 0, w: 0, h: 0 };
  private effects: EffectSpec[] = [];
  private theme: TableTheme | null = null;
  private lamp = 0xffd9a0;
  private t = 0;
  /** Particle pools, one per effect index, so two effects can't fight over the same array. */
  private pools: Particle[][] = [];
  /** Master gain: 0 stills the layer entirely, which is what "reduce motion" wants. */
  private gain = 1;
  /** Irregular flicker state, kept between frames so it isn't re-rolled every draw. */
  private flickerUntil = 0;
  private flickerNext = 0;
  private flickerDepth = 0;
  /**
   * Time banked since the last rebuild.
   *
   * This layer is a Pixi `Graphics`, and clearing one and re-adding its paths means the whole
   * thing is re-tessellated and re-uploaded — for the ice room that was 88 shapes and 513 line
   * segments, *every frame*, on the table and behind the menu both. None of it needs that rate:
   * it is dust drifting and light breathing. Rebuilding at ~32Hz halves the work and leaves the
   * previous geometry on screen in between, which is indistinguishable because nothing here
   * moves faster than a few pixels a frame.
   */
  private banked = 0;

  constructor(g: Graphics) {
    this.g = g;
  }

  /**
   * How much of this layer to draw.
   *
   * `low` keeps the slow, large-scale movement (a lamp breathing, a beam crossing) and drops the
   * particle counts hard, because those are what actually cost anything. `off` clears once and
   * then does no work at all per frame.
   */
  setIntensity(level: 'off' | 'low' | 'high'): void {
    const next = level === 'off' ? 0 : level === 'low' ? 0.4 : 1;
    if (next === this.gain) return;
    this.gain = next;
    if (next === 0) this.g.clear();
    else this.seed();
  }

  setTheme(theme: TableTheme): void {
    this.theme = theme;
    this.lamp = cssToHex(theme.lamp.color);
    this.effects = BY_THEME[theme.id] ?? BY_LAMP[theme.lamp.id] ?? BY_LAMP.pendant;
    this.seed();
  }

  resize(w: number, h: number, table: TableRect): void {
    if (w === this.w && h === this.h && table.w === this.table.w && table.x === this.table.x) return;
    this.w = w;
    this.h = h;
    this.table = { ...table };
    this.seed();
  }

  /** Lays out each effect's particles across the current canvas. */
  private seed(): void {
    this.pools = this.effects.map((fx) => {
      const n = Math.round((fx.count ?? 0) * (this.gain > 0.5 ? 1 : 0.35));
      const out: Particle[] = [];
      for (let i = 0; i < n; i++) out.push(this.spawn(fx, true));
      return out;
    });
  }

  /** A fresh particle for `fx`. `initial` scatters it across the frame instead of at its inlet. */
  private spawn(fx: EffectSpec, initial: boolean): Particle {
    const { w, h } = this;
    const r = Math.random;
    switch (fx.id) {
      case 'snow':
        return {
          x: r() * w,
          y: initial ? r() * h : -10,
          vx: (r() - 0.5) * 12,
          vy: 18 + r() * 36,
          r: 1 + r() * 2.6,
          p: r() * 6.3,
          k: 0.5 + r(),
          a: 0.3 + r() * 0.5,
        };
      case 'embers':
        return {
          x: r() * w,
          y: initial ? r() * h : h + 8,
          vx: (r() - 0.5) * 16,
          vy: -(14 + r() * 30),
          r: 0.9 + r() * 1.8,
          p: r() * 6.3,
          k: 0.8 + r() * 1.6,
          a: 0.35 + r() * 0.5,
        };
      case 'bubbles':
        return {
          x: r() * w,
          y: initial ? r() * h : h + 6,
          vx: 0,
          vy: -(20 + r() * 46),
          r: 0.9 + r() * 2.4,
          p: r() * 6.3,
          k: 1 + r() * 2,
          a: 0.25 + r() * 0.4,
        };
      case 'bokeh':
        return {
          x: r() * w,
          y: r() * h,
          vx: (r() - 0.5) * 9,
          vy: (r() - 0.5) * 6,
          r: 16 + r() * 46,
          p: r() * 6.3,
          k: 0.3 + r() * 0.7,
          a: 0.05 + r() * 0.07,
        };
      default:
        // motes, and anything else that just hangs in the air
        return {
          x: r() * w,
          y: r() * h,
          vx: (r() - 0.5) * 7,
          vy: -(2 + r() * 8),
          r: 0.7 + r() * 1.9,
          p: r() * 6.3,
          k: 0.4 + r() * 1.1,
          a: 0.18 + r() * 0.4,
        };
    }
  }

  /** Seconds between rebuilds. Anything faster is work nobody can see. */
  private static readonly STEP = 1 / 32;

  update(dt: number): void {
    if (this.gain === 0 || !this.theme || this.w <= 0) return;
    // A tab that has been in the background hands back a huge delta; stepping the whole layer
    // by it teleports every particle across the frame at once.
    this.banked += Math.min(dt, 1 / 20);
    // Under the threshold there is nothing to do — and, importantly, the Graphics is left
    // untouched, so Pixi keeps the geometry it already has rather than rebuilding it.
    if (this.banked < AmbientFx.STEP) return;
    const d = this.banked;
    this.banked = 0;
    this.t += d;

    const g = this.g;
    g.clear();

    for (let i = 0; i < this.effects.length; i++) {
      const fx = this.effects[i];
      const amount = (fx.amount ?? 0.5) * this.gain;
      const color = fx.color ?? this.lamp;
      const pool = this.pools[i] ?? [];
      switch (fx.id) {
        case 'motes':
          this.drawDrifters(pool, fx, d, color, amount, true);
          break;
        case 'snow':
          this.drawDrifters(pool, fx, d, 0xffffff, amount, false);
          break;
        case 'embers':
          this.drawEmbers(pool, fx, d, amount);
          break;
        case 'bubbles':
          this.drawBubbles(pool, fx, d, color, amount);
          break;
        case 'bokeh':
          this.drawBokeh(pool, fx, d, color, amount);
          break;
        case 'aurora':
          this.drawAurora(fx, amount);
          break;
        case 'caustics':
          this.drawCaustics(fx, color, amount);
          break;
        case 'flicker':
          this.drawFlicker(d, color, amount);
          break;
        case 'pulseRings':
          this.drawPulseRings(fx, color, amount);
          break;
        case 'beamSweep':
          this.drawBeamSweep(fx, color, amount);
          break;
        case 'lampBreathe':
          this.drawLampBreathe(color, amount);
          break;
      }
    }
  }

  // ------------------------------------------------------------ particle effects

  /**
   * Dust and snow: drift, wobble, wrap.
   *
   * `litByLamp` is what makes dust read as dust rather than as static: a mote is only visible
   * when it happens to be in the light, so its alpha is scaled by how near the lamp's pool it
   * is. Away from the table it disappears completely, exactly as it should.
   */
  private drawDrifters(
    pool: Particle[],
    fx: EffectSpec,
    d: number,
    color: number,
    amount: number,
    litByLamp: boolean
  ): void {
    const cx = this.table.x + this.table.w / 2;
    const cy = this.table.y + this.table.h / 2;
    const reach = Math.max(this.table.w, 1) * 0.85;

    for (const p of pool) {
      p.p += d * p.k;
      p.x += (p.vx + Math.sin(p.p) * 9) * d;
      p.y += p.vy * d;
      if (p.y < -12) {
        p.y = this.h + 8;
        p.x = Math.random() * this.w;
      } else if (p.y > this.h + 12) {
        p.y = -8;
        p.x = Math.random() * this.w;
      }
      if (p.x < -12) p.x = this.w + 8;
      else if (p.x > this.w + 12) p.x = -8;

      let alpha = p.a * amount * (0.65 + Math.sin(p.p * 1.7) * 0.35);
      if (litByLamp) {
        const dist = Math.hypot(p.x - cx, (p.y - cy) * 1.5);
        alpha *= Math.max(0, 1 - dist / reach);
      }
      if (alpha <= 0.004) continue;
      this.g.circle(p.x, p.y, p.r).fill({ color, alpha });
    }
  }

  private drawEmbers(pool: Particle[], fx: EffectSpec, d: number, amount: number): void {
    for (const p of pool) {
      p.p += d * p.k * 3;
      p.x += (p.vx + Math.sin(p.p) * 14) * d;
      p.y += p.vy * d;
      // Embers cool as they rise, and die out before they reach the ceiling.
      const life = 1 - p.y / this.h;
      if (p.y < -6) {
        p.y = this.h + 6;
        p.x = Math.random() * this.w;
      }
      const flick = 0.55 + Math.sin(p.p) * 0.45;
      const alpha = p.a * amount * flick * Math.max(0, 1 - life * 0.6);
      if (alpha <= 0.01) continue;
      // Hot core, cooler halo.
      this.g.circle(p.x, p.y, p.r * 2.4).fill({ color: 0xff6a2a, alpha: alpha * 0.3 });
      this.g.circle(p.x, p.y, p.r).fill({ color: 0xffc266, alpha });
    }
  }

  private drawBubbles(pool: Particle[], fx: EffectSpec, d: number, color: number, amount: number): void {
    for (const p of pool) {
      p.p += d * p.k;
      p.x += Math.sin(p.p * 1.3) * 8 * d;
      p.y += p.vy * d;
      if (p.y < -8) {
        p.y = this.h + 6;
        p.x = Math.random() * this.w;
      }
      const alpha = p.a * amount;
      // A ring rather than a disc — a bubble is mostly the edge of a bubble.
      this.g.circle(p.x, p.y, p.r).stroke({ width: 1, color, alpha });
      this.g.circle(p.x - p.r * 0.3, p.y - p.r * 0.3, p.r * 0.34).fill({ color: 0xffffff, alpha: alpha * 0.8 });
    }
  }

  private drawBokeh(pool: Particle[], fx: EffectSpec, d: number, color: number, amount: number): void {
    for (const p of pool) {
      p.p += d * p.k * 0.4;
      p.x += p.vx * d;
      p.y += p.vy * d;
      if (p.x < -p.r) p.x = this.w + p.r;
      else if (p.x > this.w + p.r) p.x = -p.r;
      if (p.y < -p.r) p.y = this.h + p.r;
      else if (p.y > this.h + p.r) p.y = -p.r;
      const alpha = p.a * amount * (0.7 + Math.sin(p.p) * 0.3);
      // Two rings and a fill: an out-of-focus point light has a bright rim.
      this.g.circle(p.x, p.y, p.r).fill({ color, alpha: alpha * 0.55 });
      this.g.circle(p.x, p.y, p.r).stroke({ width: p.r * 0.14, color, alpha });
    }
  }

  // ------------------------------------------------------------ field effects

  /** Ribbons of light overhead, three sines that never quite line up. */
  private drawAurora(fx: EffectSpec, amount: number): void {
    const bands = fx.count ?? 3;
    const colors = [0x7cf5d4, 0x9fb8ff, 0xd28cff];
    for (let b = 0; b < bands; b++) {
      const phase = this.t * (0.09 + b * 0.035) + b * 2.1;
      const baseY = this.h * (0.1 + b * 0.075);
      const amp = this.h * (0.045 + b * 0.012);
      const color = colors[b % colors.length];
      /*
       * Two strokes rather than three, and a much coarser step.
       *
       * At a 26px step across a 1440px window this was 57 points per stroke, times three
       * layers, times three bands — 513 line segments re-tessellated every frame, which was
       * far and away the most expensive thing on this layer. A sine that gentle is perfectly
       * smooth sampled every 72px, and the wide soft strokes hide the joints entirely.
       */
      for (let layer = 0; layer < 2; layer++) {
        const width = 12 + layer * 20;
        const alpha = (0.05 - layer * 0.015) * amount * (0.7 + Math.sin(phase * 1.7) * 0.3);
        if (alpha <= 0.002) continue;
        this.g.moveTo(-20, baseY);
        for (let x = -20; x <= this.w + 20; x += 72) {
          const t = x / this.w;
          const y =
            baseY +
            Math.sin(t * 3.1 + phase) * amp +
            Math.sin(t * 7.3 - phase * 1.4) * amp * 0.4;
          this.g.lineTo(x, y);
        }
        this.g.stroke({ width, color, alpha });
      }
    }
  }

  /** Light rippling off ice: overlapping ellipses whose radii breathe out of phase. */
  private drawCaustics(fx: EffectSpec, color: number, amount: number): void {
    const n = fx.count ?? 8;
    const cx = this.table.x + this.table.w / 2;
    const cy = this.table.y + this.table.h / 2;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this.t * 0.06;
      const rr = this.table.w * (0.36 + (i % 3) * 0.15);
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr * 0.55;
      const breathe = 0.6 + Math.sin(this.t * (0.7 + i * 0.13) + i) * 0.4;
      this.g
        .ellipse(x, y, this.table.w * 0.13 * breathe, this.table.h * 0.1 * breathe)
        .stroke({ width: 2.5, color, alpha: 0.07 * amount * breathe });
    }
  }

  /** A tube that never quite settles: mostly steady, with irregular dips. */
  private drawFlicker(d: number, color: number, amount: number): void {
    this.flickerNext -= d;
    if (this.flickerNext <= 0) {
      this.flickerNext = 0.4 + Math.random() * 3.2;
      this.flickerUntil = 0.04 + Math.random() * 0.14;
      this.flickerDepth = 0.3 + Math.random() * 0.7;
    }
    let level = 0.035;
    if (this.flickerUntil > 0) {
      this.flickerUntil -= d;
      level += this.flickerDepth * 0.06 * (Math.random() * 0.5 + 0.5);
    }
    this.g.rect(0, 0, this.w, this.h).fill({ color, alpha: level * amount });
  }

  /** Rings pushing out from under the table, like something on the floor is keeping time. */
  private drawPulseRings(fx: EffectSpec, color: number, amount: number): void {
    const n = fx.count ?? 3;
    const cx = this.table.x + this.table.w / 2;
    const cy = this.table.y + this.table.h / 2;
    const period = 3.4;
    for (let i = 0; i < n; i++) {
      const phase = ((this.t / period + i / n) % 1);
      const scale = 0.55 + phase * 1.5;
      const alpha = 0.16 * amount * (1 - phase) * phase * 4;
      if (alpha <= 0.004) continue;
      this.g
        .ellipse(cx, cy, this.table.w * 0.5 * scale, this.table.h * 0.6 * scale)
        .stroke({ width: 3, color, alpha });
    }
  }

  /** One hard light crossing the room, the way a moving head does over a stage. */
  private drawBeamSweep(fx: EffectSpec, color: number, amount: number): void {
    const reach = Math.hypot(this.w, this.h);
    const a = Math.sin(this.t * (fx.speed ?? 0.3)) * 1.1 - Math.PI / 2;
    const ox = this.w * 0.5;
    const oy = -this.h * 0.35;
    // Three nested wedges, narrowest brightest — a soft-edged beam without a blur filter.
    for (let i = 3; i >= 1; i--) {
      const spread = 0.06 * i;
      this.g
        .moveTo(ox, oy)
        .lineTo(ox + Math.cos(a - spread) * reach, oy + Math.sin(a - spread) * reach)
        .lineTo(ox + Math.cos(a + spread) * reach, oy + Math.sin(a + spread) * reach)
        .fill({ color, alpha: (0.05 / i) * amount });
    }
  }

  /** The lamp over the table, never quite steady. */
  private drawLampBreathe(color: number, amount: number): void {
    const cx = this.table.x + this.table.w / 2;
    const cy = this.table.y + this.table.h / 2;
    const breathe = 1 + Math.sin(this.t * 0.5) * 0.055 + Math.sin(this.t * 1.31) * 0.02;
    for (let i = 4; i >= 1; i--) {
      const f = i / 4;
      this.g
        .ellipse(cx, cy, this.table.w * (0.55 + f * 0.45) * breathe, this.table.h * (0.7 + f * 0.6) * breathe)
        .fill({ color, alpha: 0.016 * amount });
    }
  }
}
