import * as THREE from 'three';
import type { TrajectoryPreview, TrajectorySegment, Vec2 } from '@8ball/shared';
import { R, S, toWorldX, toWorldZ } from './coords';

/**
 * The aim guide, drawn as flat ribbons lying on the cloth.
 *
 * Ribbons rather than GL lines because line width isn't portable — on most phones it is locked
 * to one pixel, which is the difference between a guide you can read and one you can't.
 */

const Y = 0.0014;

function dashTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 4;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 36, 4);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/** Builds a ribbon along table-space segments. */
function ribbon(segments: TrajectorySegment[], width: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  let run = 0;
  for (const seg of segments) {
    const ax = toWorldX(seg.from.x);
    const az = toWorldZ(seg.from.y);
    const bx = toWorldX(seg.to.x);
    const bz = toWorldZ(seg.to.y);
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 1e-5) continue;
    const nx = (-dz / len) * (width / 2);
    const nz = (dx / len) * (width / 2);
    const y = seg.airborne ? Y + R * 0.8 : Y;
    const base = positions.length / 3;
    positions.push(ax + nx, y, az + nz, ax - nx, y, az - nz, bx + nx, y, bz + nz, bx - nx, y, bz - nz);
    uvs.push(run * 40, 0, run * 40, 1, (run + len) * 40, 0, (run + len) * 40, 1);
    // Counter-clockwise seen from above, so the faces point up at the camera and aren't culled.
    index.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    run += len;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(index);
  return g;
}

function truncate(segments: TrajectorySegment[], maxLen: number): TrajectorySegment[] {
  const out: TrajectorySegment[] = [];
  let left = maxLen;
  for (const s of segments) {
    const dx = s.to.x - s.from.x;
    const dy = s.to.y - s.from.y;
    const len = Math.hypot(dx, dy);
    if (len <= left) {
      out.push(s);
      left -= len;
      continue;
    }
    const f = left / len;
    out.push({ ...s, to: { x: s.from.x + dx * f, y: s.from.y + dy * f } });
    break;
  }
  return out;
}

export type GuideLength = 'full' | 'short';

export class Guide {
  readonly group = new THREE.Group();
  private solid = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.88, depthWrite: false });
  private objectMat: THREE.MeshBasicMaterial;
  private afterMat: THREE.MeshBasicMaterial;
  private aimMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.22, depthWrite: false });
  private ghostRing: THREE.Mesh;
  private ghostFill: THREE.Mesh;
  private rest: THREE.Mesh;
  private landing: THREE.Mesh;
  private meshes: THREE.Mesh[] = [];
  private dash = dashTexture();

  constructor() {
    this.objectMat = new THREE.MeshBasicMaterial({ color: '#ffe08a', transparent: true, opacity: 0.9, depthWrite: false, alphaMap: this.dash });
    this.afterMat = new THREE.MeshBasicMaterial({ color: '#bfe6ff', transparent: true, opacity: 0.55, depthWrite: false, alphaMap: this.dash });
    const ringGeo = new THREE.RingGeometry(R * 0.9, R * 1.02, 48).rotateX(-Math.PI / 2);
    this.ghostRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false }));
    this.ghostFill = new THREE.Mesh(
      new THREE.CircleGeometry(R * 0.9, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.12, depthWrite: false })
    );
    this.rest = new THREE.Mesh(
      new THREE.RingGeometry(R * 0.7, R * 0.82, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#bfe6ff', transparent: true, opacity: 0.55, depthWrite: false })
    );
    this.landing = new THREE.Mesh(
      new THREE.RingGeometry(R * 0.55, R * 1.1, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#ffcf66', transparent: true, opacity: 0.8, depthWrite: false })
    );
    for (const m of [this.ghostRing, this.ghostFill, this.rest, this.landing]) {
      m.visible = false;
      m.renderOrder = 3;
      this.group.add(m);
    }
  }

  private clearLines(): void {
    for (const m of this.meshes) {
      m.geometry.dispose();
      this.group.remove(m);
    }
    this.meshes = [];
  }

  private add(segments: TrajectorySegment[], width: number, mat: THREE.Material): void {
    if (segments.length === 0) return;
    const mesh = new THREE.Mesh(ribbon(segments, width), mat);
    mesh.renderOrder = 2;
    this.meshes.push(mesh);
    this.group.add(mesh);
  }

  update(preview: TrajectoryPreview | null, length: GuideLength, tint = '#ffffff'): void {
    this.clearLines();
    const show = preview !== null;
    this.ghostRing.visible = show && preview!.ghostBallPos !== null;
    this.ghostFill.visible = this.ghostRing.visible;
    this.rest.visible = false;
    this.landing.visible = false;
    if (!preview) return;
    this.solid.color.set(tint);

    const short = length === 'short';
    const cuePath = short ? truncate(preview.cueBallPath, 700) : preview.cueBallPath;
    this.add(cuePath, 0.0034, this.solid);
    if (preview.aimLine && !short) this.add([preview.aimLine], 0.0022, this.aimMat);

    if (preview.ghostBallPos) {
      const g = preview.ghostBallPos;
      const place = (m: THREE.Mesh, p: Vec2) => m.position.set(toWorldX(p.x), Y + 0.0002, toWorldZ(p.y));
      place(this.ghostRing, g);
      place(this.ghostFill, g);
      const objectPath = short ? truncate(preview.objectBallPath, 140) : preview.objectBallPath;
      this.add(objectPath, 0.0034, this.objectMat);
      if (!short) {
        this.add(preview.cueAfterPath, 0.0026, this.afterMat);
        if (preview.cueRestPos) {
          place(this.rest, preview.cueRestPos);
          this.rest.visible = true;
        }
      }
    }
    if (preview.landingPos && !short) {
      this.landing.position.set(toWorldX(preview.landingPos.x), Y, toWorldZ(preview.landingPos.y));
      this.landing.visible = true;
    }
    void S;
  }

  hide(): void {
    this.update(null, 'full');
  }

  dispose(): void {
    this.clearLines();
    this.dash.dispose();
    for (const m of [this.solid, this.objectMat, this.afterMat, this.aimMat]) m.dispose();
    for (const m of [this.ghostRing, this.ghostFill, this.rest, this.landing]) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  }
}
