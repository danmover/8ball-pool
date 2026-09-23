import * as THREE from 'three';
import type { BallSetStyle, Vec3 } from '@8ball/shared';
import { R } from './coords';
import { paintBall, paintShadow, type BallTextures } from './textures';

/**
 * The sixteen balls: meshes, materials for each finish, rolling rotation and contact shadows.
 *
 * Rotation is integrated from the physics' own angular velocity, so a ball struck with draw is
 * visibly spinning backwards as it slides, and english shows as a ball turning on the spot.
 */

const IDS = Array.from({ length: 16 }, (_, i) => i);

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
      return new THREE.MeshPhysicalMaterial({ ...base, metalness: 1, roughness: 0.06, envMapIntensity: 1.5 });
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

  constructor(
    set: BallSetStyle,
    private quality: 'low' | 'medium' | 'high'
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
    if (rate < 1e-4) return;
    this.tmpAxis.divideScalar(rate);
    this.tmpQuat.setFromAxisAngle(this.tmpAxis, rate * dt);
    mesh.quaternion.premultiply(this.tmpQuat);
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
