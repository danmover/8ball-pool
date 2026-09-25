import * as THREE from 'three';
import type { TrajectoryPreview, TrajectorySegment, Vec2 } from '@8ball/shared';
import { R, S, toWorldX, toWorldZ } from './coords';

/**
 * The aim guide and the markers drawn on the cloth, in the HUD's two inks: white for where the
 * cue ball goes, gold for the ball you are playing.
 *
 * Lines are flat ribbons rather than GL lines, because line width isn't portable — on most
 * phones it is locked to one pixel. Ribbons and rings are both drawn by small shaders that
 * anti-alias their own edges and lay a soft dark halo under the ink, so a line is equally
 * crisp on black slate, ice-blue or terracotta cloth, and stays the same width in pixels at
 * any zoom.
 */

const Y = 0.0014;

/** The HUD's gold (`--gold`) and its light variant. */
export const GOLD = '#ffc444';
export const GOLD_HI = '#ffe08a';

const LINE_VERT = /* glsl */ `
  attribute vec2 aLine;
  varying vec2 vLine;
  void main() {
    vLine = aLine;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const LINE_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uCore;
  uniform float uHalo;
  uniform float uDash;
  uniform float uLength;
  uniform float uFade;
  varying vec2 vLine;
  void main() {
    float across = abs(vLine.y);
    float aa = fwidth(vLine.y);
    float ink = 1.0 - smoothstep(uCore - aa, uCore + aa, across);
    float halo = (1.0 - smoothstep(uCore, 1.0, across)) * uHalo;
    float mask = 1.0;
    if (uDash > 0.0) {
      float d = vLine.x / uDash;
      float f = fract(d);
      float w = fwidth(d);
      mask = smoothstep(0.0, w, f) * (1.0 - smoothstep(0.55 - w, 0.55, f));
    }
    // The far end thins away rather than stopping dead.
    if (uFade > 0.0) mask *= clamp((uLength - vLine.x) / uFade, 0.0, 1.0);
    ink *= mask * uOpacity;
    halo *= mask;
    float alpha = ink + halo * (1.0 - ink);
    gl_FragColor = vec4(uColor * ink / max(alpha, 1e-4), alpha);
    #include <colorspace_fragment>
  }
`;

interface LineLook {
  color: string;
  opacity: number;
  /** Width in CSS pixels, before the halo. */
  px: number;
  /** Dash period in world units; 0 for a solid line. */
  dash?: number;
  /** Length over which the far end fades out, world units. */
  fade?: number;
  halo?: number;
}

/** One polyline as a ribbon, its buffers grown as needed and rewritten in place on each update. */
class Ribbon {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private geometry = new THREE.BufferGeometry();
  private capacity = 0;
  private positions = new Float32Array(0);
  private lines = new Float32Array(0);

  constructor(readonly look: LineLook) {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(look.color) },
        uOpacity: { value: look.opacity },
        uCore: { value: 0.5 },
        uHalo: { value: look.halo ?? 0.3 },
        uDash: { value: look.dash ?? 0 },
        uLength: { value: 0 },
        uFade: { value: look.fade ?? 0 },
      },
      vertexShader: LINE_VERT,
      fragmentShader: LINE_FRAG,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
  }

  private grow(segments: number): void {
    // Always build once, so an empty first path still has buffers to flag for upload.
    if (this.capacity && segments <= this.capacity) return;
    this.capacity = Math.max(segments, this.capacity * 2, 8);
    this.positions = new Float32Array(this.capacity * 12);
    this.lines = new Float32Array(this.capacity * 8);
    const index = new Uint32Array(this.capacity * 6);
    for (let i = 0; i < this.capacity; i++) {
      const b = i * 4;
      // Counter-clockwise seen from above, so the faces point up at the camera.
      index.set([b, b + 2, b + 1, b + 1, b + 2, b + 3], i * 6);
    }
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('aLine', new THREE.BufferAttribute(this.lines, 2));
    this.geometry.setIndex(new THREE.BufferAttribute(index, 1));
  }

  /**
   * Lays the ribbon along table-space segments, stopping after `maxLen` world units.
   * @param pixel world units per CSS pixel at the cloth
   */
  set(segments: TrajectorySegment[], pixel: number, maxLen = Infinity): void {
    this.grow(segments.length);
    const core = this.look.px * pixel * 0.5;
    const half = core + pixel * 2.2;
    let n = 0;
    let run = 0;
    for (const seg of segments) {
      if (run >= maxLen) break;
      const ax = toWorldX(seg.from.x);
      const az = toWorldZ(seg.from.y);
      let bx = toWorldX(seg.to.x);
      let bz = toWorldZ(seg.to.y);
      let len = Math.hypot(bx - ax, bz - az);
      if (len < 1e-5) continue;
      if (run + len > maxLen) {
        const f = (maxLen - run) / len;
        bx = ax + (bx - ax) * f;
        bz = az + (bz - az) * f;
        len = maxLen - run;
      }
      const nx = (-(bz - az) / len) * half;
      const nz = ((bx - ax) / len) * half;
      const y = seg.airborne ? Y + R * 0.8 : Y;
      const p = this.positions;
      const o = n * 12;
      p[o] = ax + nx;
      p[o + 1] = y;
      p[o + 2] = az + nz;
      p[o + 3] = ax - nx;
      p[o + 4] = y;
      p[o + 5] = az - nz;
      p[o + 6] = bx + nx;
      p[o + 7] = y;
      p[o + 8] = bz + nz;
      p[o + 9] = bx - nx;
      p[o + 10] = y;
      p[o + 11] = bz - nz;
      const l = this.lines;
      const k = n * 8;
      l[k] = l[k + 2] = run;
      l[k + 4] = l[k + 6] = run + len;
      l[k + 1] = l[k + 5] = 1;
      l[k + 3] = l[k + 7] = -1;
      run += len;
      n++;
    }
    const u = this.mesh.material.uniforms;
    u.uCore.value = core / half;
    u.uLength.value = run;
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aLine.needsUpdate = true;
    this.geometry.setDrawRange(0, n * 6);
    this.mesh.visible = n > 0;
  }

  dispose(): void {
    this.geometry.dispose();
    this.mesh.material.dispose();
  }
}

// ------------------------------------------------------------------ rings

const RING_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const RING_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uHaloColor;
  uniform float uOpacity;
  uniform float uExtent;
  uniform float uInner;
  uniform float uFill;
  uniform float uHalo;
  uniform float uHaloWidth;
  varying vec2 vUv;
  void main() {
    // r is in units of the marker's radius: the ink runs from uInner out to 1.
    float r = length(vUv - 0.5) * 2.0 * uExtent;
    float aa = fwidth(r);
    float ring = smoothstep(uInner - aa, uInner + aa, r) * (1.0 - smoothstep(1.0 - aa, 1.0 + aa, r));
    float fill = (1.0 - smoothstep(uInner - aa, uInner + aa, r)) * uFill;
    float ink = max(ring, fill) * uOpacity;
    float gap = max(0.0, max(r - 1.0, uInner - r));
    float halo = uHalo * uOpacity * exp(-gap / max(uHaloWidth, 1e-4)) * (1.0 - smoothstep(uExtent * 0.8, uExtent, r));
    float alpha = ink + halo * (1.0 - ink);
    gl_FragColor = vec4((uColor * ink + uHaloColor * halo * (1.0 - ink)) / max(alpha, 1e-4), alpha);
    #include <colorspace_fragment>
  }
`;

export interface RingLook {
  color: string;
  /** Stroke width in CSS pixels; 0 draws no ring, only fill and halo. */
  px: number;
  fill?: number;
  opacity?: number;
  /** Halo strength and colour: dark for contrast, or the ink's own colour for a glow. */
  halo?: number;
  haloColor?: string;
  /** How far the halo reaches, in marker radii (1/e distance). */
  haloWidth?: number;
}

/**
 * A flat round marker lying on the table: a crisp ring of constant pixel width, an optional
 * translucent fill and a halo. Lies in the x/z plane; position it and it is ready.
 */
export class Ring {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private px: number;

  constructor(
    readonly radius: number,
    look: RingLook
  ) {
    const extent = 1 + Math.max(0.3, (look.haloWidth ?? 0.15) * 4);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(look.color) },
        uHaloColor: { value: new THREE.Color(look.haloColor ?? '#000000') },
        uOpacity: { value: look.opacity ?? 1 },
        uExtent: { value: extent },
        uInner: { value: 0.9 },
        uFill: { value: look.fill ?? 0 },
        uHalo: { value: look.halo ?? 0.35 },
        uHaloWidth: { value: look.haloWidth ?? 0.15 },
      },
      vertexShader: RING_VERT,
      fragmentShader: RING_FRAG,
      transparent: true,
      depthWrite: false,
    });
    const size = radius * extent * 2;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2), material);
    this.mesh.renderOrder = 3;
    this.px = look.px;
  }

  get uniforms(): Record<string, THREE.IUniform> {
    return this.mesh.material.uniforms;
  }

  /** Keeps the stroke `px` CSS pixels wide, given world units per pixel. */
  setPixel(pixel: number): void {
    this.uniforms.uInner.value = this.px > 0 ? Math.max(0, 1 - (this.px * pixel) / this.radius) : 1;
  }

  setColor(color: string): void {
    this.uniforms.uColor.value.set(color);
  }

  set opacity(v: number) {
    this.uniforms.uOpacity.value = v;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

// ------------------------------------------------------------------ the guide

export type GuideLength = 'full' | 'short';

export class Guide {
  readonly group = new THREE.Group();
  /** The cue ball's path up to contact: the line you are aiming. */
  private cuePath = new Ribbon({ color: '#ffffff', opacity: 0.95, px: 2.4, halo: 0.32 });
  /** Where you pointed, when spin has pulled the real path off it. */
  private aimLine = new Ribbon({ color: '#ffffff', opacity: 0.3, px: 1.4, halo: 0.12, fade: 0.25 });
  /** The object ball's path. */
  private objectPath = new Ribbon({ color: GOLD, opacity: 1, px: 2.6, halo: 0.34, fade: 0.05 });
  /** Where the cue ball goes afterwards. */
  private afterPath = new Ribbon({ color: '#e6f3ff', opacity: 0.7, px: 1.8, halo: 0.22, dash: 0.022, fade: 0.08 });
  private ghost = new Ring(R, { color: '#ffffff', px: 2, fill: 0.14, halo: 0.34 });
  private rest = new Ring(R * 0.62, { color: '#e6f3ff', px: 1.6, opacity: 0.75, halo: 0.25 });
  private landing = new Ring(R * 0.9, { color: GOLD, px: 2.4, fill: 0.18, halo: 0.3 });
  private ribbons = [this.cuePath, this.aimLine, this.objectPath, this.afterPath];
  private rings = [this.ghost, this.rest, this.landing];
  private pixel = 0.002;
  private preview: TrajectoryPreview | null = null;
  private length: GuideLength = 'full';
  private tint = '#ffffff';

  constructor() {
    for (const r of this.ribbons) this.group.add(r.mesh);
    for (const m of this.rings) {
      m.mesh.visible = false;
      m.mesh.renderOrder = 4;
      m.setPixel(this.pixel);
      this.group.add(m.mesh);
    }
  }

  /** World units per CSS pixel at the cloth; the view calls this whenever the camera moves. */
  setPixel(pixel: number): void {
    if (Math.abs(pixel - this.pixel) < 1e-7) return;
    this.pixel = pixel;
    for (const m of this.rings) m.setPixel(pixel);
    this.update(this.preview, this.length, this.tint);
  }

  update(preview: TrajectoryPreview | null, length: GuideLength, tint = '#ffffff'): void {
    this.preview = preview;
    this.length = length;
    this.tint = tint;
    for (const r of this.ribbons) r.mesh.visible = false;
    for (const m of this.rings) m.mesh.visible = false;
    if (!preview) return;
    this.cuePath.mesh.material.uniforms.uColor.value.set(tint);
    const px = this.pixel;
    const short = length === 'short';
    const place = (m: Ring, p: Vec2, lift = 0) => {
      m.mesh.position.set(toWorldX(p.x), Y + 0.0002 + lift, toWorldZ(p.y));
      m.mesh.visible = true;
    };

    this.cuePath.set(preview.cueBallPath, px, short ? 700 * S : Infinity);
    if (preview.aimLine && !short) this.aimLine.set([preview.aimLine], px);

    if (preview.ghostBallPos) {
      place(this.ghost, preview.ghostBallPos);
      this.objectPath.set(preview.objectBallPath, px, short ? 140 * S : Infinity);
      if (!short) {
        this.afterPath.set(preview.cueAfterPath, px);
        if (preview.cueRestPos) place(this.rest, preview.cueRestPos);
      }
    }
    if (preview.landingPos && !short) place(this.landing, preview.landingPos, -0.0002);
  }

  hide(): void {
    this.update(null, 'full');
  }

  dispose(): void {
    for (const r of this.ribbons) r.dispose();
    for (const m of this.rings) m.dispose();
  }
}
