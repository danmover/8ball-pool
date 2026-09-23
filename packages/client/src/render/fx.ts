import * as THREE from 'three';
import type { FxStyle } from '@8ball/shared';
import { R } from './coords';
import { paintGlow } from './textures';

/**
 * Shot effects: one pooled particle system and a ribbon trail per ball.
 *
 * Everything is additive light over the cloth, so effects can never hide a ball or a line —
 * they only ever brighten the table.
 */

const MAX_PARTICLES = 900;

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  r: number;
  g: number;
  b: number;
  gravity: number;
  drag: number;
  /** Pulled toward this point (the Void pocket). */
  pull: THREE.Vector3 | null;
}

export class Particles {
  readonly points: THREE.Points;
  private list: Particle[] = [];
  private positions = new Float32Array(MAX_PARTICLES * 3);
  private colors = new Float32Array(MAX_PARTICLES * 3);
  private sizes = new Float32Array(MAX_PARTICLES);
  private alphas = new Float32Array(MAX_PARTICLES);
  private geometry = new THREE.BufferGeometry();
  private material: THREE.ShaderMaterial;
  private sprite = paintGlow(64);

  constructor() {
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));
    this.geometry.setAttribute('alpha', new THREE.BufferAttribute(this.alphas, 1));
    this.material = new THREE.ShaderMaterial({
      uniforms: { map: { value: this.sprite }, scale: { value: 800 } },
      vertexShader: `
        attribute float size;
        attribute float alpha;
        varying vec3 vColor;
        varying float vAlpha;
        uniform float scale;
        void main() {
          vColor = color;
          vAlpha = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * scale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D map;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float a = texture2D(map, gl_PointCoord).a * vAlpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor * a, a);
        }`,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  setScale(pixelsPerUnitAtOne: number): void {
    this.material.uniforms.scale.value = pixelsPerUnitAtOne;
  }

  spawn(p: Partial<Particle> & { x: number; y: number; z: number }): void {
    if (this.list.length >= MAX_PARTICLES) this.list.shift();
    const life = p.max ?? 0.6;
    this.list.push({
      vx: 0,
      vy: 0,
      vz: 0,
      size: R * 0.5,
      r: 1,
      g: 1,
      b: 1,
      gravity: 0,
      drag: 1.5,
      pull: null,
      ...p,
      life,
      max: life,
    });
  }

  update(dt: number): void {
    const next: Particle[] = [];
    for (const p of this.list) {
      p.life -= dt;
      if (p.life <= 0) continue;
      if (p.pull) {
        const dx = p.pull.x - p.x;
        const dz = p.pull.z - p.z;
        p.vx += (dx * 18 - p.vz * 6) * dt;
        p.vz += (dz * 18 + p.vx * 6) * dt;
      }
      p.vy -= p.gravity * dt;
      const d = Math.exp(-p.drag * dt);
      p.vx *= d;
      p.vy *= d;
      p.vz *= d;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < 0.002 && p.gravity > 0) {
        p.y = 0.002;
        p.vy = -p.vy * 0.3;
      }
      next.push(p);
    }
    this.list = next;
    const n = this.list.length;
    for (let i = 0; i < n; i++) {
      const p = this.list[i];
      const t = p.life / p.max;
      this.positions[i * 3] = p.x;
      this.positions[i * 3 + 1] = p.y;
      this.positions[i * 3 + 2] = p.z;
      this.colors[i * 3] = p.r;
      this.colors[i * 3 + 1] = p.g;
      this.colors[i * 3 + 2] = p.b;
      this.sizes[i] = p.size * (0.4 + 0.6 * t);
      this.alphas[i] = Math.min(1, t * 1.6);
    }
    this.geometry.setDrawRange(0, n);
    for (const name of ['position', 'color', 'size', 'alpha']) {
      (this.geometry.attributes[name] as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  get count(): number {
    return this.list.length;
  }

  clear(): void {
    this.list = [];
    this.geometry.setDrawRange(0, 0);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.sprite.dispose();
  }
}

const TRAIL_POINTS = 26;

/** A fading ribbon behind one ball. */
class Trail {
  readonly mesh: THREE.Mesh;
  private pts: THREE.Vector3[] = [];
  private positions = new Float32Array(TRAIL_POINTS * 2 * 3);
  private colors = new Float32Array(TRAIL_POINTS * 2 * 3);
  private geometry = new THREE.BufferGeometry();

  constructor(material: THREE.Material) {
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    const idx: number[] = [];
    for (let i = 0; i < TRAIL_POINTS - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geometry.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
  }

  push(p: THREE.Vector3): void {
    const last = this.pts[0];
    if (last && last.distanceToSquared(p) < 1e-7) return;
    this.pts.unshift(p.clone());
    if (this.pts.length > TRAIL_POINTS) this.pts.pop();
  }

  decay(): void {
    if (this.pts.length > 0) this.pts.pop();
  }

  build(colorAt: (t: number) => THREE.Color, width: number, jitter: number): void {
    const n = this.pts.length;
    for (let i = 0; i < TRAIL_POINTS; i++) {
      const p = this.pts[Math.min(i, n - 1)];
      if (!p || n < 2) {
        this.positions.fill(0, i * 6, i * 6 + 6);
        this.colors.fill(0, i * 6, i * 6 + 6);
        continue;
      }
      const q = this.pts[Math.min(i + 1, n - 1)] ?? p;
      const r = this.pts[Math.min(Math.max(i - 1, 0), n - 1)] ?? p;
      let dx = r.x - q.x;
      let dz = r.z - q.z;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      const t = i / (TRAIL_POINTS - 1);
      const w = width * (1 - t) ** 1.2;
      const j = jitter ? (Math.random() - 0.5) * jitter * (1 - t) : 0;
      const y = 0.003;
      this.positions.set([p.x - dz * w + j, y, p.z + dx * w + j, p.x + dz * w + j, y, p.z - dx * w + j], i * 6);
      const c = colorAt(t);
      const fade = i < n ? (1 - t) ** 1.4 : 0;
      this.colors.set([c.r * fade, c.g * fade, c.b * fade, c.r * fade, c.g * fade, c.b * fade], i * 6);
    }
    (this.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }

  reset(): void {
    this.pts = [];
  }

  dispose(): void {
    this.geometry.dispose();
  }
}

/** Everything a shot's effects need, for one style. */
export class Effects {
  readonly group = new THREE.Group();
  readonly particles = new Particles();
  private trails = new Map<number, Trail>();
  private trailMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  private style: FxStyle = { trail: 'none', color: '#ffffff', color2: '#ffffff' };
  private c1 = new THREE.Color();
  private c2 = new THREE.Color();
  private tmp = new THREE.Color();
  private time = 0;
  enabled = true;

  constructor() {
    this.group.add(this.particles.points);
  }

  setStyle(style: FxStyle): void {
    this.style = style;
    this.c1.set(style.color);
    this.c2.set(style.color2);
    if (style.trail === 'void') this.trailMat.blending = THREE.NormalBlending;
    else this.trailMat.blending = THREE.AdditiveBlending;
    this.trailMat.needsUpdate = true;
  }

  private trailFor(id: number): Trail {
    let t = this.trails.get(id);
    if (!t) {
      t = new Trail(this.trailMat);
      this.trails.set(id, t);
      this.group.add(t.mesh);
    }
    return t;
  }

  private colorAt = (t: number): THREE.Color => {
    const s = this.style.trail;
    if (s === 'party') return this.tmp.setHSL((this.time * 0.6 + t * 0.9) % 1, 0.9, 0.6);
    if (s === 'fire') return this.tmp.copy(this.c2).lerp(this.c1, Math.min(1, t * 2.2));
    if (s === 'void') return this.tmp.copy(this.c1).multiplyScalar(0.9 - t * 0.5);
    return this.tmp.copy(this.c2).lerp(this.c1, t);
  };

  /** Called every frame while balls move, with each moving ball's world position and speed. */
  track(id: number, pos: THREE.Vector3, speed: number, isCue: boolean): void {
    if (!this.enabled || this.style.trail === 'none') return;
    const trail = this.trailFor(id);
    // The cue ball always trails; object balls only when really moving.
    if (speed > (isCue ? 150 : 900)) trail.push(pos);
    else trail.decay();
    const s = this.style.trail;
    if (Math.random() < 0.5 && speed > 400) {
      if (s === 'fire') {
        this.particles.spawn({ x: pos.x, y: 0.01, z: pos.z, vx: (Math.random() - 0.5) * 0.1, vy: 0.08 + Math.random() * 0.1, vz: (Math.random() - 0.5) * 0.1, r: 1, g: 0.45 + Math.random() * 0.3, b: 0.1, size: R * 0.5, max: 0.5 });
      } else if (s === 'frost') {
        this.particles.spawn({ x: pos.x + (Math.random() - 0.5) * R, y: 0.004, z: pos.z + (Math.random() - 0.5) * R, r: 0.75, g: 0.92, b: 1, size: R * 0.28, max: 0.9, drag: 4 });
      } else if (s === 'comet' && Math.random() < 0.4) {
        this.particles.spawn({ x: pos.x, y: 0.006, z: pos.z, vx: (Math.random() - 0.5) * 0.06, vz: (Math.random() - 0.5) * 0.06, r: this.c2.r, g: this.c2.g, b: this.c2.b, size: R * 0.3, max: 0.6 });
      } else if (s === 'party' && Math.random() < 0.35) {
        const c = new THREE.Color().setHSL(Math.random(), 0.9, 0.6);
        this.particles.spawn({ x: pos.x, y: 0.01, z: pos.z, vx: (Math.random() - 0.5) * 0.2, vy: 0.2, vz: (Math.random() - 0.5) * 0.2, gravity: 1.2, r: c.r, g: c.g, b: c.b, size: R * 0.35, max: 0.8 });
      }
    }
  }

  /** Balls stopped: let the trails drain away. */
  settle(): void {
    for (const t of this.trails.values()) t.decay();
  }

  collision(pos: THREE.Vector3, impulse: number): void {
    if (!this.enabled) return;
    const s = this.style.trail;
    const strength = Math.min(1, impulse / 2500);
    if (strength < 0.18 || s === 'none') return;
    const n = Math.round(4 + strength * 10);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 0.2 + Math.random() * 0.6 * strength;
      const c = s === 'party' ? new THREE.Color().setHSL(Math.random(), 0.9, 0.6) : this.c2;
      this.particles.spawn({ x: pos.x, y: R, z: pos.z, vx: Math.cos(a) * v, vy: Math.random() * 0.2, vz: Math.sin(a) * v, r: c.r, g: c.g, b: c.b, size: R * (0.25 + strength * 0.3), max: 0.25 + strength * 0.25, drag: 5 });
    }
    if (s === 'bolt') {
      for (let i = 0; i < 6; i++) {
        this.particles.spawn({ x: pos.x + (Math.random() - 0.5) * R * 4, y: R, z: pos.z + (Math.random() - 0.5) * R * 4, r: 0.7, g: 0.8, b: 1, size: R * 0.6, max: 0.12 });
      }
    }
  }

  /** A ball went down: a burst at the pocket in the shooter's style. */
  pot(at: THREE.Vector3, ballColor: THREE.Color): void {
    if (!this.enabled) return;
    const s = this.style.trail;
    const base = s === 'none' ? 10 : 34;
    for (let i = 0; i < base; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 0.15 + Math.random() * (s === 'none' ? 0.2 : 0.6);
      let c = s === 'none' ? ballColor : this.c1;
      if (s === 'party') c = new THREE.Color().setHSL(Math.random(), 0.95, 0.6);
      else if (s !== 'none' && Math.random() < 0.4) c = this.c2;
      this.particles.spawn({
        x: at.x,
        y: 0.02,
        z: at.z,
        vx: Math.cos(a) * v,
        vy: 0.2 + Math.random() * 0.6,
        vz: Math.sin(a) * v,
        gravity: s === 'fire' ? -0.4 : s === 'party' ? 1.6 : 0.9,
        r: c.r,
        g: c.g,
        b: c.b,
        size: R * (s === 'none' ? 0.3 : 0.55),
        max: 0.5 + Math.random() * 0.5,
        drag: 2.2,
        pull: s === 'void' ? at.clone() : null,
      });
    }
    // A ring of light at the mouth.
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      this.particles.spawn({ x: at.x + Math.cos(a) * R * 1.2, y: 0.01, z: at.z + Math.sin(a) * R * 1.2, vx: Math.cos(a) * 0.35, vz: Math.sin(a) * 0.35, r: ballColor.r, g: ballColor.g, b: ballColor.b, size: R * 0.35, max: 0.35, drag: 6 });
    }
  }

  /** Power Pool's bomb. */
  blast(at: THREE.Vector3): void {
    for (let i = 0; i < 90; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 0.3 + Math.random() * 1.4;
      const hot = Math.random();
      this.particles.spawn({ x: at.x, y: R, z: at.z, vx: Math.cos(a) * v, vy: Math.random() * 0.8, vz: Math.sin(a) * v, gravity: 1, r: 1, g: 0.35 + hot * 0.5, b: 0.1 * hot, size: R * (0.4 + Math.random() * 0.8), max: 0.4 + Math.random() * 0.6, drag: 3 });
    }
  }

  /** A sparkle — for orbs being collected and power-ups arming. */
  sparkle(at: THREE.Vector3, color: THREE.Color, count = 24): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 0.1 + Math.random() * 0.35;
      this.particles.spawn({ x: at.x, y: R, z: at.z, vx: Math.cos(a) * v, vy: 0.2 + Math.random() * 0.3, vz: Math.sin(a) * v, gravity: 0.4, r: color.r, g: color.g, b: color.b, size: R * 0.45, max: 0.7 });
    }
  }

  update(dt: number): void {
    this.time += dt;
    this.particles.update(dt);
    const jitter = this.style.trail === 'bolt' ? R * 0.8 : 0;
    const width = this.style.trail === 'streak' ? R * 0.35 : this.style.trail === 'comet' ? R * 0.95 : this.style.trail === 'bolt' ? R * 0.3 : R * 0.8;
    for (const t of this.trails.values()) t.build(this.colorAt, width, jitter);
  }

  reset(): void {
    for (const t of this.trails.values()) t.reset();
    this.particles.clear();
  }

  dispose(): void {
    for (const t of this.trails.values()) t.dispose();
    this.trailMat.dispose();
    this.particles.dispose();
  }
}
