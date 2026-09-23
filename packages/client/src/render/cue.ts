import * as THREE from 'three';
import type { CueStyle } from '@8ball/shared';
import { paintCue } from './textures';

/**
 * A cue, turned on a lathe: a real taper from a 13 mm tip to a 30 mm butt, painted with the
 * cue's livery along its length. The group's origin is the tip, so posing it is a matter of
 * putting the tip behind the cue ball and pointing the butt back up the line.
 */

export const CUE_LENGTH = 1.16;

const PROFILE: [number, number][] = [
  // [fraction along the cue from the tip, radius in world units]
  [0, 0.0001],
  [0.001, 0.0048],
  [0.006, 0.0051],
  [0.022, 0.0053],
  [0.25, 0.0059],
  [0.49, 0.0069],
  [0.492, 0.0077],
  [0.515, 0.0078],
  [0.52, 0.0074],
  [0.76, 0.0098],
  [0.762, 0.0103],
  [0.93, 0.0108],
  [0.932, 0.0113],
  [0.99, 0.0118],
  [0.995, 0.0112],
  [1, 0.0001],
];

export class Cue {
  readonly group = new THREE.Group();
  private mesh: THREE.Mesh;
  private material: THREE.MeshPhysicalMaterial;
  private textures: THREE.Texture[] = [];
  private styleKey = '';
  private up = new THREE.Vector3(0, 1, 0);
  private dir = new THREE.Vector3();

  constructor(style: CueStyle) {
    const points = PROFILE.map(([f, r]) => new THREE.Vector2(r, f * CUE_LENGTH));
    const geo = new THREE.LatheGeometry(points, 28);
    // LatheGeometry spaces v by point index; re-map it by length so the livery lands in place.
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) uv.setY(i, 1 - pos.getY(i) / CUE_LENGTH);
    geo.computeVertexNormals();
    this.material = new THREE.MeshPhysicalMaterial({ roughness: 0.3, clearcoat: 0.9, clearcoatRoughness: 0.12 });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.castShadow = true;
    this.group.add(this.mesh);
    this.group.visible = false;
    this.setStyle(style);
  }

  setStyle(style: CueStyle): void {
    const key = JSON.stringify(style);
    if (key === this.styleKey) return;
    this.styleKey = key;
    for (const t of this.textures) t.dispose();
    const { map, emissive } = paintCue(style);
    this.textures = [map, ...(emissive ? [emissive] : [])];
    this.material.map = map;
    this.material.emissiveMap = emissive;
    this.material.emissive = new THREE.Color(emissive ? '#ffffff' : '#000000');
    this.material.emissiveIntensity = emissive ? 1.4 : 0;
    this.material.metalness = style.metalness;
    this.material.roughness = style.metalness > 0.8 ? 0.22 : 0.32;
    this.material.needsUpdate = true;
  }

  /**
   * Poses the cue.
   * @param tip world position of the tip
   * @param angle aim direction in the table plane (radians, table frame)
   * @param tilt how far the butt is raised, radians
   */
  pose(tip: THREE.Vector3, angle: number, tilt: number): void {
    // The butt points back along the shot line and up.
    const c = Math.cos(tilt);
    this.dir.set(-Math.cos(angle) * c, Math.sin(tilt), -Math.sin(angle) * c).normalize();
    this.group.position.copy(tip);
    this.group.quaternion.setFromUnitVectors(this.up, this.dir);
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
  }
}
