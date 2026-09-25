import * as THREE from 'three';
import type { BallSetStyle, Vec3 } from '@8ball/shared';
import { R } from './coords';
import { paintBall, paintShadow, type BallTextures } from './textures';

/**
 * The sixteen balls: meshes, materials for each finish, rolling rotation and contact shadows.
 *
 * Rotation is integrated from the physics' own angular velocity, so a ball struck with draw is
 * visibly spinning backwards as it slides, and english shows as a ball turning on the spot.
 *
 * As a ball rolls to a stop it eases into its show pose: a number disc turned to the camera with
 * the digit upright, so the table stays readable from the full view. A ball that appears at rest
 * (the rack, a respot) starts in that pose.
 */

const IDS = Array.from({ length: 16 }, (_, i) => i);
/** Below this spin rate (rad/s, a slow roll) a ball starts easing into its show pose. */
const SETTLE_RATE = 6;
/** How quickly it gets there once stopped, per second. */
const SETTLE_SPEED = 5;

function material(set: BallSetStyle, tex: BallTextures): THREE.MeshPhysicalMaterial {
  const base = { map: tex.map };
  switch (set.finish) {
    case 'satin':
      return new THREE.MeshPhysicalMaterial({ ...base, roughness: 0.34, clearcoat: 0.45, clearcoatRoughness: 0.28, envMapIntensity: 0.9 });
    case 'marble':
      return new THREE.MeshPhysicalMaterial({ ...base, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.2 });
    case 'neon':
      return new THREE.MeshPhysicalMaterial({
        ...base,
        emissiveMap: tex.emissive,
        emissive: new THREE.Color('#ffffff'),
        emissiveIntensity: 1.7,
        roughness: 0.18,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
        envMapIntensity: 0.8,
      });
    case 'chrome':
      // Not fully metallic: a fifth of the painted colour shows through, or the set reads as black.
      // The number discs are enamel, not steel, so they stay light enough to read.
      return new THREE.MeshPhysicalMaterial({ ...base, metalnessMap: tex.metal, metalness: 0.8, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.9 });
    case 'planet':
      return new THREE.MeshPhysicalMaterial({ ...base, roughness: 0.55, clearcoat: 0.35, clearcoatRoughness: 0.2, envMapIntensity: 0.8 });
    case 'gold':
      return new THREE.MeshPhysicalMaterial({
        ...base,
        metalnessMap: tex.metal,
        metalness: 1,
        roughness: 0.18,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
        envMapIntensity: 1.35,
      });
    default:
      return new THREE.MeshPhysicalMaterial({ ...base, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.1 });
  }
}

export class BallMeshes {
  readonly group = new THREE.Group();
  private meshes = new Map<number, THREE.Mesh>();
  private shadows = new Map<number, THREE.Mesh>();
  private geometry: THREE.SphereGeometry;
  private shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private shadowMat: THREE.MeshBasicMaterial;
  private textures: BallTextures[] = [];
  private materials: THREE.Material[] = [];
  private tmpAxis = new THREE.Vector3();
  private tmpQuat = new THREE.Quaternion();
  /** Spin rate each ball was given this frame; a ball missing from it is at rest. */
  private rates = new Map<number, number>();
  /** Balls already in their show pose, and balls that should snap into it rather than turn. */
  private posed = new Set<number>();
  private fresh = new Set<number>(IDS);
  private poseA = new THREE.Quaternion();
  private poseB = new THREE.Quaternion();
  private basis = new THREE.Matrix4();
  private toEye = new THREE.Vector3();
  private upward = new THREE.Vector3();
  private side = new THREE.Vector3();

  constructor(
    set: BallSetStyle,
    private quality: 'low' | 'medium' | 'high',
    private camera: THREE.Camera
  ) {
    const segs = quality === 'low' ? 24 : quality === 'medium' ? 36 : 48;
    this.geometry = new THREE.SphereGeometry(R, segs, Math.round(segs * 0.66));
    const shadowTex = paintShadow();
    this.shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.9 });
    for (const id of IDS) {
      const mesh = new THREE.Mesh(this.geometry);
      mesh.castShadow = quality !== 'low';
      // A random resting orientation so the rack doesn't show fifteen identical faces.
      mesh.quaternion.setFromEuler(new THREE.Euler(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28));
      this.meshes.set(id, mesh);
      this.group.add(mesh);
      const shadow = new THREE.Mesh(this.shadowGeo, this.shadowMat);
      shadow.scale.setScalar(R * 2.6);
      shadow.renderOrder = 1;
      this.shadows.set(id, shadow);
      this.group.add(shadow);
    }
    this.setStyle(set);
  }

  setStyle(set: BallSetStyle): void {
    for (const t of this.textures) {
      t.map.dispose();
      t.emissive?.dispose();
      t.metal?.dispose();
    }
    for (const m of this.materials) m.dispose();
    this.textures = [];
    this.materials = [];
    const size = this.quality === 'high' ? 1024 : this.quality === 'medium' ? 512 : 256;
    for (const id of IDS) {
      const tex = paintBall(set, id, size);
      const mat = material(set, tex);
      this.textures.push(tex);
      this.materials.push(mat);
      this.meshes.get(id)!.material = mat;
    }
  }

  mesh(id: number): THREE.Mesh | undefined {
    return this.meshes.get(id);
  }

  /** Puts a ball at a world position; `lift` is its height off the cloth, world units. */
  place(id: number, x: number, z: number, lift: number, visible: boolean): void {
    const mesh = this.meshes.get(id);
    const shadow = this.shadows.get(id);
    if (!mesh || !shadow) return;
    if (visible && !mesh.visible) this.fresh.add(id);
    mesh.visible = visible;
    shadow.visible = visible && lift > -R;
    if (!visible) return;
    mesh.position.set(x, R + lift, z);
    // The contact shadow spreads and fades as the ball leaves the cloth.
    const air = Math.max(0, lift);
    shadow.position.set(x + air * 0.25, 0.0008, z + air * 0.35);
    shadow.scale.setScalar(R * (2.6 + air * 60));
    (shadow.material as THREE.MeshBasicMaterial).opacity = 0.9;
    shadow.visible = lift > -R * 0.5;
  }

  /** Scales a ball (for the drop into a pocket) without touching its orientation. */
  setScale(id: number, s: number): void {
    this.meshes.get(id)?.scale.setScalar(s);
  }

  /**
   * Turns a ball by its angular velocity for `dt` seconds.
   *
   * The physics frame is x right, y down the screen, z *into* the table; the world is x right,
   * y up, z toward the viewer. So physics (x, y, z) maps to world (x, -z, y).
   */
  spin(id: number, w: Vec3, dt: number): void {
    const mesh = this.meshes.get(id);
    if (!mesh) return;
    this.tmpAxis.set(w.x, -w.z, w.y);
    const rate = this.tmpAxis.length();
    this.rates.set(id, rate);
    if (rate < 1e-4) return;
    this.fresh.delete(id);
    this.posed.delete(id);
    this.tmpAxis.divideScalar(rate);
    this.tmpQuat.setFromAxisAngle(this.tmpAxis, rate * dt);
    mesh.quaternion.premultiply(this.tmpQuat);
  }

  /**
   * Eases every slow or stopped ball toward its show pose. Call once a frame, after the frame's
   * spin() calls: the pull grows as a ball slows, so most of the turn hides in its last roll.
   */
  settle(dt: number): void {
    for (const id of IDS) {
      const mesh = this.meshes.get(id)!;
      const rate = this.rates.get(id) ?? 0;
      if (id === 0 || !mesh.visible || this.posed.has(id) || rate >= SETTLE_RATE) continue;
      const target = this.showPose(id, mesh);
      if (this.fresh.has(id)) {
        mesh.quaternion.copy(target);
        this.fresh.delete(id);
        this.posed.add(id);
        continue;
      }
      const pull = 1 - Math.exp(-dt * SETTLE_SPEED * (1 - rate / SETTLE_RATE));
      mesh.quaternion.slerp(target, pull);
      if (rate < 1e-4 && mesh.quaternion.angleTo(target) < 0.01) this.posed.add(id);
    }
    this.rates.clear();
  }

  /**
   * The orientation that faces a ball's nearer number disc (local +z or -z) to the camera with
   * the digit upright on screen, knocked a few degrees off square so the rack looks placed by
   * hand, not stamped.
   */
  private showPose(id: number, mesh: THREE.Mesh): THREE.Quaternion {
    this.toEye.set(0, 0, 1).applyQuaternion(this.camera.quaternion);
    this.upward.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const lean = Math.sin(id * 12.9898) * 0.22;
    const tip = Math.cos(id * 78.233) * 0.14;
    this.side.crossVectors(this.upward, this.toEye);
    this.toEye.applyAxisAngle(this.side, tip);
    this.upward.applyAxisAngle(this.toEye, lean).projectOnPlane(this.toEye).normalize();
    // Disc +z to the eye: local (x, y, z) = (y × eye, up, eye).
    this.side.crossVectors(this.upward, this.toEye);
    this.poseA.setFromRotationMatrix(this.basis.makeBasis(this.side, this.upward, this.toEye));
    // Disc -z to the eye: the digit there is painted mirrored, so x flips with z.
    this.side.negate();
    this.toEye.negate();
    this.poseB.setFromRotationMatrix(this.basis.makeBasis(this.side, this.upward, this.toEye));
    const q = mesh.quaternion;
    return Math.abs(q.dot(this.poseA)) >= Math.abs(q.dot(this.poseB)) ? this.poseA : this.poseB;
  }

  dispose(): void {
    for (const t of this.textures) {
      t.map.dispose();
      t.emissive?.dispose();
      t.metal?.dispose();
    }
    for (const m of this.materials) m.dispose();
    this.geometry.dispose();
    this.shadowGeo.dispose();
    this.shadowMat.map?.dispose();
    this.shadowMat.dispose();
  }
}
