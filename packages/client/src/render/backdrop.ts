import * as THREE from 'three';
import type { TableStyle } from '@8ball/shared';
import { CUSHION_DEPTH, HALF_L, HALF_W, RAIL_HEIGHT, RAIL_WIDTH } from './coords';
import { FLOOR_TILE, floorKind, paintRoomFloor } from './paint/room';

/**
 * The hall around the table: a floor in the spill of the lamp, the table's shadow on it, and a
 * little dust turning in the light — all fading out to the menus' blue-black at the screen edges.
 *
 * One big plane and one shader. Everything is worked out per pixel from where the table is, so
 * it fills any canvas — a tall phone, an ultra-wide monitor, the tilted camera — without a seam,
 * and it costs a texture read a pixel however much of the screen it covers.
 */

export const FLOOR_Y = -0.6;
/** The menus' background, `--bg-0`. The last thing the eye sees at the edge of the screen. */
const EDGE = '#04070c';
const OUTER_X = HALF_L + CUSHION_DEPTH + RAIL_WIDTH;
const OUTER_Z = HALF_W + CUSHION_DEPTH + RAIL_WIDTH;

const BOX_SDF = /* glsl */ `
  float box(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }
  /** The lamp's pool of light: an oval the table sits in, brightest right beside it. */
  float spillAt(vec2 p, vec2 extent) {
    return exp(-max(box(p, extent + vec2(0.05), 0.5), 0.0) * 1.6);
  }
`;

const FLOOR_VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const FLOOR_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uTile;
  uniform vec3 uEdge;
  uniform vec3 uRoom;
  uniform vec3 uLamp;
  uniform vec3 uNeon;
  uniform float uGlow;
  uniform vec2 uHalf;
  uniform vec2 uDown;
  uniform vec2 uResolution;
  uniform float uTopY;
  varying vec3 vWorld;
  ${BOX_SDF}
  void main() {
    vec2 pf = vWorld.xz;
    // The same point carried up the view ray to the rail tops, so distances from the table's
    // outline come out as they look on screen, however far away the camera is.
    vec3 ray = vWorld - cameraPosition;
    vec2 pt = cameraPosition.xz + ray.xz * ((uTopY - cameraPosition.y) / ray.y);
    float sil = box(pt - uDown * 0.008, uHalf, 0.04);
    float foot = box(pf - uDown * 0.1, uHalf, 0.1);

    float spill = spillAt(pf, uHalf);
    // The table's shadow: wide and soft on the floor, with a tight dark seam where it meets the
    // silhouette so the table lifts off the floor even seen from straight above.
    float shade = mix(0.1, 1.0, smoothstep(-0.1, 0.5, foot));
    float seam = 1.0 - 0.6 * (1.0 - smoothstep(0.0, 0.06, sil));

    vec3 albedo = texture2D(uMap, pf / uTile).rgb;
    vec3 col = uEdge + uRoom * (0.5 + 2.2 * spill * shade);
    col += albedo * (uLamp * spill * spill * shade + uGlow);
    col *= seam;
    col += uNeon * (exp(-max(sil, 0.0) * 18.0) * 0.45 + spill * shade * 0.18);

    // Out to the menus' colour: with distance from the table, and at the very edges of the screen.
    vec2 q = abs(gl_FragCoord.xy / uResolution * 2.0 - 1.0);
    float edge = pow(pow(q.x, 6.0) + pow(q.y, 6.0), 1.0 / 6.0);
    float fade = max(smoothstep(0.72, 1.04, edge) * 0.8, smoothstep(0.25, 1.3, sil));
    col = mix(col, uEdge, fade);

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
    // A whisper of noise, because dark gradients band on 8-bit screens.
    gl_FragColor.rgb += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
  }
`;

const MOTE_VERT = /* glsl */ `
  attribute vec4 aSeed;
  uniform float uTime;
  uniform float uScale;
  uniform vec2 uHalf;
  varying float vAlpha;
  ${BOX_SDF}
  void main() {
    float a = uTime * aSeed.y + aSeed.x;
    // The whole cloud turns slowly about the lamp, and each mote wanders on its own.
    float turn = uTime * 0.012;
    vec3 p = position;
    p.xz = mat2(cos(turn), -sin(turn), sin(turn), cos(turn)) * p.xz;
    p += vec3(sin(a) * 0.06, sin(a * 0.63 + 1.7) * 0.035, cos(a * 0.81) * 0.06);
    vAlpha = aSeed.w * spillAt(p.xz, uHalf) * (0.55 + 0.45 * sin(a * 2.7));
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = aSeed.z * uScale / -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const MOTE_FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    float a = (1.0 - smoothstep(0.15, 1.0, length(gl_PointCoord - 0.5) * 2.0)) * vAlpha;
    if (a < 0.004) discard;
    gl_FragColor = vec4(uColor, a);
    #include <colorspace_fragment>
  }
`;

type Quality = 'low' | 'medium' | 'high';

export class Backdrop {
  readonly group = new THREE.Group();
  private floor: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private map: THREE.Texture | null = null;
  private mapKey = '';
  private motes: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
  private moving = true;
  private time = 0;
  private uniforms = {
    uMap: { value: null as THREE.Texture | null },
    uTile: { value: 1 },
    uEdge: { value: new THREE.Color(EDGE) },
    uRoom: { value: new THREE.Color() },
    uLamp: { value: new THREE.Color() },
    uNeon: { value: new THREE.Color() },
    uGlow: { value: 0 },
    uHalf: { value: new THREE.Vector2(OUTER_X, OUTER_Z) },
    uDown: { value: new THREE.Vector2(0, 1) },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uTopY: { value: RAIL_HEIGHT },
  };

  constructor() {
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: FLOOR_VERT,
      fragmentShader: FLOOR_FRAG,
      depthWrite: false,
    });
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40).rotateX(-Math.PI / 2), material);
    this.floor.position.y = FLOOR_Y;
    // Drawn first, behind everything, and never in front of the table whatever the depth says.
    this.floor.renderOrder = -10;
    this.floor.frustumCulled = false;
    this.group.add(this.floor);
  }

  setStyle(style: TableStyle, quality: Quality): void {
    const size = quality === 'low' ? 256 : 512;
    const key = `${floorKind(style)}|${style.room}|${style.trim}|${style.sight}|${style.neon}|${style.railFinish}|${size}`;
    if (key !== this.mapKey) {
      this.map?.dispose();
      this.map = paintRoomFloor(style, size);
      this.mapKey = key;
    }
    const u = this.uniforms;
    u.uMap.value = this.map;
    u.uTile.value = FLOOR_TILE[floorKind(style)];
    u.uRoom.value.set(style.room);
    u.uLamp.value.set(style.lamp).multiplyScalar(0.55 * style.lampPower);
    u.uNeon.value.set(style.neon ?? '#000000');
    u.uGlow.value = floorKind(style) === 'arcade' ? 0.05 : 0;

    const wantMotes = quality !== 'low';
    if (wantMotes && !this.motes) this.motes = this.buildMotes(quality === 'high' ? 150 : 90);
    if (!wantMotes && this.motes) {
      this.group.remove(this.motes);
      this.motes.geometry.dispose();
      this.motes.material.dispose();
      this.motes = null;
    }
    if (this.motes) {
      this.motes.material.uniforms.uColor.value.set(style.lamp).multiplyScalar(0.9 * style.lampPower);
      this.motes.visible = this.moving;
    }
  }

  /**
   * Keeps the shader in step with the view.
   * @param down the direction that is "down" on screen, in world x/z — the shadow falls that way
   * @param pointScale pixels per world unit at unit distance, for sizing the motes
   */
  setView(width: number, height: number, down: THREE.Vector2, pointScale: number): void {
    this.uniforms.uResolution.value.set(width, height);
    this.uniforms.uDown.value.copy(down);
    if (this.motes) this.motes.material.uniforms.uScale.value = pointScale;
  }

  /** Dust only drifts when effects are on; with them off it is simply not there. */
  setMotion(on: boolean): void {
    this.moving = on;
    if (this.motes) this.motes.visible = on;
  }

  update(dt: number): void {
    if (!this.motes || !this.moving) return;
    this.time += dt;
    this.motes.material.uniforms.uTime.value = this.time;
  }

  private buildMotes(count: number): THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> {
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      let x = 0;
      let z = 0;
      // Anywhere around the table but not under it, where nobody would see them.
      do {
        x = (Math.random() * 2 - 1) * 2.4;
        z = (Math.random() * 2 - 1) * 1.9;
      } while (Math.abs(x) < OUTER_X && Math.abs(z) < OUTER_Z);
      pos.set([x, FLOOR_Y + 0.05 + Math.random() * 0.45, z], i * 3);
      seed.set([Math.random() * 100, 0.15 + Math.random() * 0.35, 0.004 + Math.random() * 0.006, 0.25 + Math.random() * 0.5], i * 4);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: this.time },
        uScale: { value: 800 },
        uHalf: { value: this.uniforms.uHalf.value },
        uColor: { value: new THREE.Color() },
      },
      vertexShader: MOTE_VERT,
      fragmentShader: MOTE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    points.renderOrder = -5;
    this.group.add(points);
    return points;
  }

  dispose(): void {
    this.map?.dispose();
    this.floor.geometry.dispose();
    this.floor.material.dispose();
    if (this.motes) {
      this.motes.geometry.dispose();
      this.motes.material.dispose();
    }
  }
}
