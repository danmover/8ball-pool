import * as THREE from 'three';
import type { CueStyle } from '@8ball/shared';
import { CUE_LENGTH, CUE_PROFILE, GLOW_BINS, paintCue } from './paint/cue';
import { HALF_L, HALF_W } from './coords';

export { CUE_LENGTH } from './paint/cue';

/**
 * A cue, turned on a lathe from the painter's profile and dressed in its four layers: colour,
 * surface (clearcoat, roughness, metalness), bump and glow. The group's origin is the tip, so
 * posing it is a matter of putting the tip behind the cue ball and pointing the butt back up the
 * line; it is also rolled so the livery's face (u = 0.5) always looks up at the camera.
 *
 * Cues that glow spill their light on the cloth beneath them.
 */

type Quality = 'low' | 'medium' | 'high';

/** How far the glow spreads either side of the cue, world units. */
const SPILL_WIDTH = 0.24;
/** The tilt the spill is painted for; steeper cues sit higher and light less of the cloth. */
const SPILL_TILT = 0.085;
/** Thin lines of light average out dim along the cue; this brings their spill back up. */
const SPILL_GAIN = 2.5;
/** The spill lies at cloth height, so past the cushions it would float over the floor. */
const CLOTH_EDGES = [
  new THREE.Plane(new THREE.Vector3(-1, 0, 0), HALF_L),
  new THREE.Plane(new THREE.Vector3(1, 0, 0), HALF_L),
  new THREE.Plane(new THREE.Vector3(0, 0, -1), HALF_W),
  new THREE.Plane(new THREE.Vector3(0, 0, 1), HALF_W),
];

/**
 * Turns the profile into a lathe. Points flagged `true` are rounded over; every other point is a
 * crease, so each part meets the next with a crisp bevel that catches the light.
 */
function turn(segments: number): THREE.BufferGeometry {
  const pts = CUE_PROFILE.map(([f, r, smooth]) => ({ r, y: f * CUE_LENGTH, smooth: !!smooth }));
  // Each segment's outward normal in the profile plane, [radial, axial]; null where it has no length.
  const segN = pts.slice(0, -1).map((p, i) => {
    const q = pts[i + 1];
    const dr = q.r - p.r;
    const dy = q.y - p.y;
    const len = Math.hypot(dr, dy);
    return len < 1e-9 ? null : ([dy / len, -dr / len] as [number, number]);
  });
  const near = (i: number, step: number): [number, number] | null => {
    for (let j = i; j >= 0 && j < segN.length; j += step) if (segN[j]) return segN[j];
    return null;
  };
  const normalAt = (i: number, own: [number, number], other: [number, number] | null): [number, number] => {
    if (pts[i].r === 0) return [0, i === 0 ? -1 : 1];
    if (!pts[i].smooth || !other) return own;
    const r = own[0] + other[0];
    const a = own[1] + other[1];
    const len = Math.hypot(r, a) || 1;
    return [r / len, a / len];
  };

  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const ring = (p: { r: number; y: number }, n: [number, number]) => {
    for (let s = 0; s <= segments; s++) {
      const u = s / segments;
      const sin = Math.sin(u * Math.PI * 2);
      const cos = Math.cos(u * Math.PI * 2);
      pos.push(sin * p.r, p.y, cos * p.r);
      nrm.push(sin * n[0], n[1], cos * n[0]);
      uv.push(u, 1 - p.y / CUE_LENGTH);
    }
  };
  for (let i = 0; i < segN.length; i++) {
    const n = segN[i];
    if (!n) continue;
    const base = pos.length / 3;
    ring(pts[i], normalAt(i, n, near(i - 1, -1)));
    ring(pts[i + 1], normalAt(i + 1, n, near(i + 1, 1)));
    const w = segments + 1;
    for (let s = 0; s < segments; s++) {
      const a = base + s;
      const b = a + 1;
      const d = a + w;
      const c = d + 1;
      idx.push(a, b, d, c, d, b);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return geo;
}

/**
 * Paints the pool of light a glowing cue throws on the cloth: bright under the tip end, where the
 * cue sits lowest, and softer and wider towards the butt as it rises. Row 0 is the butt.
 */
function paintSpill(glow: Float32Array, color: string): THREE.Texture {
  const w = 32;
  const h = 128;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const img = g.createImageData(w, h);
  const col = new THREE.Color(color);
  const tip = 0.035;
  for (let y = 0; y < h; y++) {
    const f = 1 - (y + 0.5) / h;
    const lift = tip + f * CUE_LENGTH * Math.sin(SPILL_TILT);
    const k = SPILL_GAIN * glow[Math.min(GLOW_BINS - 1, Math.floor(f * GLOW_BINS))] * (tip / lift) ** 2;
    // Kept under a fifth of the plane's width so the falloff reaches nothing before its edge.
    const spread = Math.min(SPILL_WIDTH / 5, lift * 1.4);
    for (let x = 0; x < w; x++) {
      const across = ((x + 0.5) / w - 0.5) * SPILL_WIDTH;
      const a = k * Math.exp(-((across / spread) ** 2)) * Math.min(1, f * 60);
      const i = (y * w + x) * 4;
      img.data[i] = col.r * 255;
      img.data[i + 1] = col.g * 255;
      img.data[i + 2] = col.b * 255;
      img.data[i + 3] = Math.min(255, a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Cue {
  readonly group = new THREE.Group();
  private body = new THREE.Group();
  private mesh: THREE.Mesh;
  private material: THREE.MeshPhysicalMaterial;
  private spill: THREE.Mesh;
  private spillMaterial: THREE.MeshBasicMaterial;
  private textures: THREE.Texture[] = [];
  private styleKey = '';
  private dir = new THREE.Vector3();
  private top = new THREE.Vector3();
  private side = new THREE.Vector3();
  private back = new THREE.Vector3();
  private basis = new THREE.Matrix4();

  constructor(style: CueStyle, private quality: Quality = 'medium') {
    this.material = new THREE.MeshPhysicalMaterial({ clearcoatRoughness: 0.06, bumpScale: 1.2 });
    this.mesh = new THREE.Mesh(turn(quality === 'low' ? 20 : 36), this.material);
    this.mesh.castShadow = true;
    this.body.add(this.mesh);

    const plane = new THREE.PlaneGeometry(SPILL_WIDTH, CUE_LENGTH);
    plane.translate(0, CUE_LENGTH / 2, 0);
    plane.rotateX(-Math.PI / 2);
    this.spillMaterial = new THREE.MeshBasicMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      clippingPlanes: CLOTH_EDGES,
    });
    this.spill = new THREE.Mesh(plane, this.spillMaterial);
    this.spill.renderOrder = 1;

    this.group.add(this.body, this.spill);
    this.group.visible = false;
    this.setStyle(style);
  }

  setStyle(style: CueStyle): void {
    const key = JSON.stringify(style);
    if (key === this.styleKey) return;
    this.styleKey = key;
    for (const t of this.textures) t.dispose();
    const tex = paintCue(style, this.quality);
    const m = this.material;
    m.map = tex.map;
    // The surface layer packs clearcoat in R, roughness in G and metalness in B, the channels
    // three.js reads each map from, so the scalars stay at 1 and the texture has the say.
    m.clearcoatMap = tex.surface;
    m.roughnessMap = tex.surface;
    m.metalnessMap = tex.surface;
    m.clearcoat = 1;
    m.roughness = 1;
    m.metalness = 1;
    m.bumpMap = tex.bump;
    m.emissiveMap = tex.emissive;
    m.emissive.set(tex.emissive ? '#ffffff' : '#000000');
    m.emissiveIntensity = tex.emissive ? 1.6 : 0;
    m.needsUpdate = true;
    this.textures = [tex.map, tex.surface, ...(tex.bump ? [tex.bump] : []), ...(tex.emissive ? [tex.emissive] : [])];

    const glowing = !!tex.glow && tex.glow.some((v) => v > 0.02);
    this.spill.visible = glowing;
    this.spillMaterial.map = glowing ? paintSpill(tex.glow!, style.glow ?? style.accent) : null;
    if (this.spillMaterial.map) this.textures.push(this.spillMaterial.map);
    this.spillMaterial.needsUpdate = true;
  }

  /**
   * Poses the cue.
   * @param tip world position of the tip
   * @param angle aim direction in the table plane (radians, table frame)
   * @param tilt how far the butt is raised, radians
   */
  pose(tip: THREE.Vector3, angle: number, tilt: number): void {
    // The butt points back along the shot line and up; the livery's face is the side nearest the sky.
    const c = Math.cos(tilt);
    this.dir.set(-Math.cos(angle) * c, Math.sin(tilt), -Math.sin(angle) * c).normalize();
    this.top.set(0, 1, 0).addScaledVector(this.dir, -this.dir.y).normalize();
    // The lathe puts u = 0.5 on local -z, so local z points down and x completes the frame.
    this.back.copy(this.top).negate();
    this.side.crossVectors(this.dir, this.back);
    this.basis.makeBasis(this.side, this.dir, this.back);
    this.body.position.copy(tip);
    this.body.quaternion.setFromRotationMatrix(this.basis);

    // The spill lies on the cloth under the cue, foreshortened to its shadow's length.
    this.spill.position.set(tip.x, 0.0004, tip.z);
    this.spill.rotation.set(0, Math.PI / 2 - angle, 0);
    this.spill.scale.set(1, 1, c);
    this.spillMaterial.opacity = Math.min(1, SPILL_TILT / tilt) ** 2;
  }

  set visible(v: boolean) {
    this.group.visible = v;
  }

  get visible(): boolean {
    return this.group.visible;
  }

  dispose(): void {
    for (const t of this.textures) t.dispose();
    this.material.dispose();
    this.mesh.geometry.dispose();
    this.spillMaterial.dispose();
    this.spill.geometry.dispose();
  }
}
