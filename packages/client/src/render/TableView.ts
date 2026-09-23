import * as THREE from 'three';
import {
  CUE_BALL_ID,
  ORB_RADIUS,
  POWER_INFO,
  ballColor,
  type Ball,
  type BallSetStyle,
  type CueStyle,
  type FxStyle,
  type Orb,
  type SimEvent,
  type TableStyle,
  type TrajectoryPreview,
} from '@8ball/shared';
import { CUSHION_DEPTH, HALF_L, HALF_W, R, RAIL_HEIGHT, RAIL_WIDTH, S, toTableX, toTableY, toWorldX, toWorldZ } from './coords';
import { buildTable, POCKET_HOLES, type TableModel } from './tableModel';
import { BallMeshes } from './balls';
import { Cue } from './cue';
import { Guide, type GuideLength } from './guide';
import { Effects } from './fx';
import { buildEnvironment } from './env';
import { paintGlyph } from './textures';
import type { ShotPlayer } from '../game/shotPlayer';

export type Quality = 'low' | 'medium' | 'high';

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface AimPose {
  /** Cue ball position, table units. */
  from: { x: number; y: number };
  angle: number;
  /** 0..1 how far the cue is drawn back. */
  power: number;
  elevation: number;
}

interface Drop {
  id: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
}

const FOV = 26;

/**
 * The table on screen. It knows nothing about rules or turns — it draws balls where it is told,
 * replays shots it is handed, and reports what the pointer is over.
 */
export class TableView {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 30);
  private raycaster = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -R);
  private table: TableModel | null = null;
  private tableKey = '';
  private env: THREE.Texture | null = null;
  private balls: BallMeshes;
  private ballSetKey = '';
  private ballSet: BallSetStyle;
  private cue: Cue;
  private guide = new Guide();
  private fx = new Effects();
  private spot: THREE.SpotLight;
  private hemi: THREE.HemisphereLight;
  private fills: THREE.PointLight[] = [];
  private targets: THREE.Mesh[] = [];
  private targetMat: THREE.MeshBasicMaterial;
  private ghost: THREE.Group;
  private ghostMat: THREE.MeshBasicMaterial;
  private orbGroup = new THREE.Group();
  private orbSprites = new Map<string, THREE.Texture>();
  private pocketMarks: THREE.Mesh[] = [];
  private pocketMat: THREE.MeshBasicMaterial;
  private pocketChosenMat: THREE.MeshBasicMaterial;

  private rest: Ball[] = [];
  private player: ShotPlayer | null = null;
  private onShotEvent: ((ev: SimEvent) => void) | null = null;
  private onShotDone: (() => void) | null = null;
  private drops: Drop[] = [];
  private insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
  private portrait = false;
  private tilt = false;
  private raf = 0;
  private last = 0;
  private time = 0;
  private resize: ResizeObserver;
  private disposed = false;

  private aimTarget: AimPose | null = null;
  private aimShown: AimPose | null = null;
  private aimSmooth = false;
  private strikeT = -1;
  private strikeFrom = 0;
  private fadeCue = 0;
  private shake = 0;
  private focus: { x: number; z: number; zoom: number } | null = null;

  /** Hook for per-frame work the screen wants to do (e.g. clocks). */
  onFrame: ((dt: number) => void) | null = null;

  constructor(
    private host: HTMLElement,
    opts: { quality: Quality; table: TableStyle; balls: BallSetStyle; cue: CueStyle; fx: FxStyle; effects: boolean; tilt: boolean }
  ) {
    const quality = opts.quality;
    this.renderer = new THREE.WebGLRenderer({ antialias: quality !== 'low', powerPreference: 'high-performance', alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'high' ? 2 : quality === 'medium' ? 1.5 : 1));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = quality !== 'low';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'table-canvas';
    host.appendChild(this.canvas);
    this.tilt = opts.tilt;

    this.hemi = new THREE.HemisphereLight('#ffffff', '#101010', 0.28);
    this.scene.add(this.hemi);
    this.spot = new THREE.SpotLight('#ffffff', 20, 0, 0.72, 0.85, 2);
    this.spot.position.set(0, 2.1, 0);
    this.spot.target.position.set(0, 0, 0);
    this.spot.castShadow = quality !== 'low';
    this.spot.shadow.mapSize.setScalar(quality === 'high' ? 2048 : 1024);
    this.spot.shadow.bias = -0.0004;
    this.spot.shadow.normalBias = 0.002;
    this.spot.shadow.radius = 5;
    this.spot.shadow.camera.near = 1.2;
    this.spot.shadow.camera.far = 2.4;
    this.scene.add(this.spot, this.spot.target);
    for (const x of [-0.95, 0.95]) {
      const p = new THREE.PointLight('#ffffff', 1.4, 0, 2);
      p.position.set(x, 1.3, 0);
      this.fills.push(p);
      this.scene.add(p);
    }

    this.ballSet = opts.balls;
    this.balls = new BallMeshes(opts.balls, quality);
    this.ballSetKey = JSON.stringify(opts.balls);
    this.cue = new Cue(opts.cue);
    this.scene.add(this.balls.group, this.cue.group, this.guide.group, this.fx.group, this.orbGroup);
    this.fx.setStyle(opts.fx);
    this.fx.enabled = opts.effects;

    this.targetMat = new THREE.MeshBasicMaterial({ color: '#ffd35a', transparent: true, opacity: 0.6, depthWrite: false });
    const ringGeo = new THREE.RingGeometry(R * 1.22, R * 1.42, 40).rotateX(-Math.PI / 2);
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(ringGeo, this.targetMat);
      m.visible = false;
      m.renderOrder = 2;
      this.targets.push(m);
      this.scene.add(m);
    }

    this.ghostMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.45, depthWrite: false });
    this.ghost = new THREE.Group();
    this.ghost.add(new THREE.Mesh(new THREE.SphereGeometry(R, 24, 16), this.ghostMat));
    const ghostRing = new THREE.Mesh(new THREE.RingGeometry(R * 1.3, R * 1.5, 40).rotateX(-Math.PI / 2), this.ghostMat);
    ghostRing.position.y = -R + 0.001;
    this.ghost.add(ghostRing);
    this.ghost.visible = false;
    this.scene.add(this.ghost);

    this.pocketMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, depthWrite: false });
    this.pocketChosenMat = new THREE.MeshBasicMaterial({ color: '#ffd35a', transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false });
    for (const hole of POCKET_HOLES) {
      const m = new THREE.Mesh(new THREE.RingGeometry(hole.radius + 0.004, hole.radius + 0.016, 48).rotateX(-Math.PI / 2), this.pocketMat);
      m.position.set(hole.x, RAIL_HEIGHT + 0.012, hole.z);
      m.visible = false;
      m.renderOrder = 6;
      this.pocketMarks.push(m);
      this.scene.add(m);
    }

    this.setTable(opts.table, quality);

    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(host);
    this.fit();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  // ================================================================ styles

  setTable(style: TableStyle, quality: Quality = 'high'): void {
    const key = JSON.stringify(style);
    if (key === this.tableKey) return;
    this.tableKey = key;
    if (this.table) {
      this.scene.remove(this.table.group);
      this.table.dispose();
    }
    this.table = buildTable(style, quality);
    this.scene.add(this.table.group);
    this.env?.dispose();
    this.env = buildEnvironment(this.renderer, style.lamp, style.room);
    this.scene.environment = this.env;
    this.scene.background = new THREE.Color(style.room).multiplyScalar(0.35);
    const lamp = new THREE.Color(style.lamp);
    this.spot.color.copy(lamp);
    this.spot.intensity = 20 * style.lampPower;
    for (const f of this.fills) {
      f.color.copy(lamp);
      f.intensity = 1.4 * style.lampPower;
    }
    this.hemi.color.copy(lamp);
    this.hemi.groundColor.set(style.room);
  }

  setBallSet(style: BallSetStyle): void {
    const key = JSON.stringify(style);
    if (key === this.ballSetKey) return;
    this.ballSetKey = key;
    this.ballSet = style;
    this.balls.setStyle(style);
  }

  setCueStyle(style: CueStyle): void {
    this.cue.setStyle(style);
  }

  setFx(style: FxStyle): void {
    this.fx.setStyle(style);
  }

  setEffectsEnabled(on: boolean): void {
    this.fx.enabled = on;
  }

  setTilt(on: boolean): void {
    this.tilt = on;
    this.fit();
  }

  // ================================================================ camera

  setInsets(insets: Insets): void {
    this.insets = insets;
    this.fit();
  }

  isPortrait(): boolean {
    return this.portrait;
  }

  private fit(): void {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    const rect = {
      x: this.insets.left,
      y: this.insets.top,
      w: Math.max(50, w - this.insets.left - this.insets.right),
      h: Math.max(50, h - this.insets.top - this.insets.bottom),
    };
    this.portrait = rect.h > rect.w * 1.08;
    const ex = HALF_L + CUSHION_DEPTH + RAIL_WIDTH + 0.015;
    const ez = HALF_W + CUSHION_DEPTH + RAIL_WIDTH + 0.015;
    const spanX = this.portrait ? ez * 2 : ex * 2;
    const spanY = this.portrait ? ex * 2 : ez * 2;
    const ppu = Math.min(rect.w / spanX, rect.h / spanY);
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const dist = h / (2 * tanHalf * ppu);

    this.camera.aspect = w / h;
    this.camera.fov = FOV;
    if (this.tilt && !this.portrait) {
      const a = THREE.MathUtils.degToRad(32);
      const d = dist * 1.12;
      this.camera.position.set(0, d * Math.cos(a), d * Math.sin(a));
      this.camera.up.set(0, 1, 0);
    } else {
      this.camera.position.set(0, dist, 0);
      this.camera.up.set(this.portrait ? 1 : 0, 0, this.portrait ? 0 : -1);
    }
    this.camera.lookAt(0, this.tilt && !this.portrait ? -0.05 : 0, 0);
    if (this.focus) {
      const f = this.focus;
      this.camera.position.set(f.x, dist / f.zoom, f.z + (this.tilt ? dist * 0.3 / f.zoom : 0));
      this.camera.lookAt(f.x, 0, f.z);
    }
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    this.camera.setViewOffset(w, h, w / 2 - cx, h / 2 - cy, w, h);
    this.camera.updateProjectionMatrix();
    this.fx.particles.setScale((h * this.renderer.getPixelRatio()) / (2 * tanHalf));
  }

  /** Moves the camera in close over a table point (table units), or back out with null. */
  setFocus(point: { x: number; y: number } | null, zoom = 3): void {
    this.focus = point ? { x: toWorldX(point.x), z: toWorldZ(point.y), zoom } : null;
    this.fit();
  }

  /** Pixels per table unit, for sizing screen-space overlays. */
  pixelsPerUnit(): number {
    const h = this.host.clientHeight || 1;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    return (h / (2 * tanHalf * this.camera.position.length())) * S;
  }

  /** Where a table point appears on screen, in CSS pixels relative to the host. */
  project(x: number, y: number, lift = 0): { x: number; y: number } {
    const v = new THREE.Vector3(toWorldX(x), R + lift, toWorldZ(y)).project(this.camera);
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h };
  }

  /** The table point under a screen position, or null if the pointer is off the cloth plane. */
  pick(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.plane, hit)) return null;
    return { x: toTableX(hit.x), y: toTableY(hit.z) };
  }

  /** The pocket nearest a screen position, if it is close enough to mean it. */
  pocketAt(clientX: number, clientY: number): number | null {
    const p = this.pick(clientX, clientY);
    if (!p) return null;
    let best: number | null = null;
    let bestD = 140;
    for (const hole of POCKET_HOLES) {
      const d = Math.hypot(toTableX(hole.x) - p.x, toTableY(hole.z) - p.y);
      if (d < bestD) {
        bestD = d;
        best = hole.index;
      }
    }
    return best;
  }

  // ================================================================ balls

  /** Shows the table at rest. Ignored while a shot is replaying. */
  setBalls(balls: Ball[]): void {
    this.rest = balls;
    if (this.player) return;
    this.placeRest();
  }

  private placeRest(): void {
    for (const b of this.rest) {
      const dropping = this.drops.some((d) => d.id === b.id);
      if (dropping) continue;
      this.balls.setScale(b.id, 1);
      this.balls.place(b.id, toWorldX(b.pos.x), toWorldZ(b.pos.y), b.z * S, !b.pocketed);
    }
    const present = new Set(this.rest.map((b) => b.id));
    for (let id = 0; id < 16; id++) if (!present.has(id)) this.balls.place(id, 0, 0, 0, false);
  }

  /** Replays a shot. `onEvent` fires for every collision, cushion and pot as it happens. */
  play(player: ShotPlayer, onEvent: (ev: SimEvent) => void, onDone: () => void): void {
    this.finishPlayback();
    this.player = player;
    this.onShotEvent = onEvent;
    this.onShotDone = onDone;
    this.fx.reset();
  }

  /** Fast-forward the shot in flight. */
  hurry(): void {
    if (this.player) this.player.speed = 4;
  }

  private finishPlayback(): void {
    if (!this.player) return;
    const done = this.onShotDone;
    this.player = null;
    this.onShotEvent = null;
    this.onShotDone = null;
    done?.();
  }

  private stepPlayback(dt: number): void {
    const player = this.player!;
    const events = player.advance(dt);
    for (const ev of events) {
      if (ev.type === 'pot') this.startDrop(ev.ballId, ev.pocketIndex, player);
      else if (ev.type === 'ballCollision') this.fx.collision(new THREE.Vector3(toWorldX(ev.pos.x), R, toWorldZ(ev.pos.y)), ev.impulse);
      else if (ev.type === 'bomb') {
        const at = new THREE.Vector3(toWorldX(ev.pos.x), R, toWorldZ(ev.pos.y));
        this.fx.blast(at);
        this.shake = 0.5;
      } else if (ev.type === 'orb') {
        this.fx.sparkle(new THREE.Vector3(toWorldX(ev.pos.x), R, toWorldZ(ev.pos.y)), new THREE.Color(POWER_INFO[ev.power].color), 34);
      }
      this.onShotEvent?.(ev);
    }
    const tmp = new THREE.Vector3();
    for (const b of player.balls) {
      if (this.drops.some((d) => d.id === b.id)) continue;
      if (b.pocketed) {
        this.balls.place(b.id, 0, 0, 0, false);
        continue;
      }
      const p = player.position(b);
      const wx = toWorldX(p.x);
      const wz = toWorldZ(p.y);
      this.balls.place(b.id, wx, wz, p.z * S, true);
      this.balls.spin(b.id, b.angVel, dt * player.speed);
      const speed = Math.hypot(b.vel.x, b.vel.y);
      tmp.set(wx, R, wz);
      this.fx.track(b.id, tmp, speed, b.id === CUE_BALL_ID);
    }
    if (player.orbs) this.syncOrbs(player.orbs);
    if (player.done) {
      this.fx.settle();
      this.finishPlayback();
    }
  }

  private startDrop(id: number, pocketIndex: number, player: ShotPlayer): void {
    const ball = player.balls.find((b) => b.id === id);
    const hole = POCKET_HOLES[pocketIndex];
    if (!ball || !hole) return;
    const p = player.position(ball);
    this.drops.push({
      id,
      from: new THREE.Vector3(toWorldX(p.x), R, toWorldZ(p.y)),
      to: new THREE.Vector3(hole.x, -0.07, hole.z),
      t: 0,
    });
    this.fx.pot(new THREE.Vector3(hole.x, 0.01, hole.z), new THREE.Color(ballColor(this.ballSet, id)));
  }

  private stepDrops(dt: number): void {
    for (const d of this.drops) {
      d.t = Math.min(1, d.t + dt / 0.22);
      const e = d.t;
      const x = d.from.x + (d.to.x - d.from.x) * Math.min(1, e * 1.3);
      const z = d.from.z + (d.to.z - d.from.z) * Math.min(1, e * 1.3);
      const y = R + (d.to.y - R) * e * e;
      this.balls.place(d.id, x, z, y - R, true);
      this.balls.setScale(d.id, 1 - e * 0.15);
    }
    const finished = this.drops.filter((d) => d.t >= 1);
    this.drops = this.drops.filter((d) => d.t < 1);
    for (const d of finished) {
      this.balls.setScale(d.id, 1);
      this.balls.place(d.id, 0, 0, 0, false);
    }
  }

  get replaying(): boolean {
    return this.player !== null;
  }

  // ================================================================ aim & cue

  /**
   * Where the cue is. `smooth` eases toward it — for other people's aim, which arrives in
   * steps over the network and would otherwise jitter.
   */
  setAim(pose: AimPose | null, smooth = false): void {
    this.aimTarget = pose;
    this.aimSmooth = smooth;
    if (!pose) {
      this.aimShown = null;
      return;
    }
    if (!this.aimShown || !smooth) this.aimShown = { ...pose };
    this.fadeCue = 0;
  }

  /** Plays the strike: the cue drives through and then fades away. */
  strike(): void {
    if (!this.aimShown) return;
    this.strikeT = 0;
    this.strikeFrom = this.aimShown.power;
  }

  private stepCue(dt: number): void {
    const target = this.aimTarget;
    let shown = this.aimShown;
    if (this.strikeT >= 0 && shown) {
      this.strikeT += dt;
      const t = Math.min(1, this.strikeT / 0.07);
      shown = { ...shown, power: this.strikeFrom * (1 - t) - 0.02 * t };
      if (this.strikeT > 0.07) this.fadeCue += dt;
      if (this.fadeCue > 0.35) {
        this.strikeT = -1;
        this.aimShown = null;
        this.aimTarget = null;
        this.cue.visible = false;
        return;
      }
    } else if (target && shown && this.aimSmooth) {
      const k = 1 - Math.exp(-dt * 14);
      let da = target.angle - shown.angle;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      shown = {
        from: target.from,
        angle: shown.angle + da * k,
        power: shown.power + (target.power - shown.power) * k,
        elevation: shown.elevation + (target.elevation - shown.elevation) * k,
      };
      this.aimShown = shown;
    }
    if (!shown) {
      this.cue.visible = false;
      return;
    }
    const gap = 0.006 + Math.max(0, shown.power) * 0.17;
    const dir = { x: Math.cos(shown.angle), z: Math.sin(shown.angle) };
    const tilt = 0.085 + shown.elevation;
    const back = R + gap;
    const tip = new THREE.Vector3(
      toWorldX(shown.from.x) - dir.x * back * Math.cos(tilt),
      R + Math.sin(tilt) * back * 0.9 + shown.elevation * 0.01,
      toWorldZ(shown.from.y) - dir.z * back * Math.cos(tilt)
    );
    this.cue.pose(tip, shown.angle, tilt);
    this.cue.visible = true;
  }

  setGuide(preview: TrajectoryPreview | null, length: GuideLength = 'full'): void {
    this.guide.update(preview, length);
  }

  /** Rings under the balls that may legally be hit first. */
  setTargets(ids: number[], balls: Ball[]): void {
    let i = 0;
    for (const id of ids) {
      const b = balls.find((x) => x.id === id && !x.pocketed);
      if (!b || i >= this.targets.length) continue;
      const m = this.targets[i++];
      m.position.set(toWorldX(b.pos.x), 0.0011, toWorldZ(b.pos.y));
      m.visible = true;
    }
    for (; i < this.targets.length; i++) this.targets[i].visible = false;
  }

  /** The cue ball in hand, following the pointer. */
  setPlacement(pos: { x: number; y: number } | null, valid = true): void {
    this.ghost.visible = pos !== null;
    if (!pos) return;
    this.ghost.position.set(toWorldX(pos.x), R, toWorldZ(pos.y));
    this.ghostMat.color.set(valid ? '#ffffff' : '#ff5a4a');
  }

  /** Pocket selection for calling a shot: `selectable` lights them all, `chosen` picks one. */
  setPockets(selectable: boolean, chosen: number | null): void {
    this.pocketMarks.forEach((m, i) => {
      m.visible = selectable || chosen === i;
      m.material = chosen === i ? this.pocketChosenMat : this.pocketMat;
    });
  }

  // ================================================================ power pool orbs

  setOrbs(orbs: Orb[] | null): void {
    this.syncOrbs(orbs ?? []);
  }

  private syncOrbs(orbs: Orb[]): void {
    const live = new Set<number>();
    for (const orb of orbs) {
      live.add(orb.id);
      let g = this.orbGroup.getObjectByName(`orb${orb.id}`) as THREE.Group | undefined;
      if (!g) {
        g = new THREE.Group();
        g.name = `orb${orb.id}`;
        const info = POWER_INFO[orb.power];
        const color = new THREE.Color(info.color);
        const r = ORB_RADIUS * S;
        const disc = new THREE.Mesh(
          new THREE.CircleGeometry(r, 40).rotateX(-Math.PI / 2),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending })
        );
        disc.position.y = 0.0015;
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(r * 0.86, r, 48).rotateX(-Math.PI / 2),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false })
        );
        ring.position.y = 0.002;
        let tex = this.orbSprites.get(orb.power);
        if (!tex) {
          tex = paintGlyph(info.glyph);
          this.orbSprites.set(orb.power, tex);
        }
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
        sprite.scale.setScalar(r * 1.25);
        sprite.position.y = R * 1.4;
        sprite.name = 'glyph';
        g.add(disc, ring, sprite);
        g.position.set(toWorldX(orb.pos.x), 0, toWorldZ(orb.pos.y));
        this.orbGroup.add(g);
      }
      g.userData.taken = orb.taken;
    }
    for (const child of [...this.orbGroup.children]) {
      const id = Number(child.name.slice(3));
      if (!live.has(id)) {
        child.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            o.geometry.dispose();
            (o.material as THREE.Material).dispose();
          }
        });
        this.orbGroup.remove(child);
      }
    }
  }

  private stepOrbs(dt: number): void {
    for (const g of this.orbGroup.children) {
      const taken = g.userData.taken as boolean;
      const s = g.scale.x;
      const next = taken ? Math.max(0, s - dt * 4) : Math.min(1, s + dt * 3);
      g.scale.setScalar(next || 0.0001);
      g.visible = next > 0.01;
      const glyph = g.getObjectByName('glyph');
      if (glyph) glyph.position.y = R * 1.4 + Math.sin(this.time * 2.4 + g.id) * R * 0.25;
      g.rotation.y += dt * 0.6;
    }
  }

  // ================================================================ loop

  kick(amount = 0.25): void {
    this.shake = Math.max(this.shake, amount);
  }

  private loop = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.time += dt;

    if (this.player) this.stepPlayback(dt);
    if (this.drops.length) this.stepDrops(dt);
    this.stepCue(dt);
    this.stepOrbs(dt);
    this.fx.update(dt);
    this.targetMat.opacity = 0.35 + 0.35 * (0.5 + 0.5 * Math.sin(this.time * 4));
    this.pocketMat.opacity = 0.3 + 0.3 * (0.5 + 0.5 * Math.sin(this.time * 5));
    this.onFrame?.(dt);

    if (this.shake > 0) {
      const s = this.shake * 0.006;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.z += (Math.random() - 0.5) * s;
      this.shake = Math.max(0, this.shake - dt * 2.5);
      this.renderer.render(this.scene, this.camera);
      this.fit();
      return;
    }
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resize.disconnect();
    this.table?.dispose();
    this.balls.dispose();
    this.cue.dispose();
    this.guide.dispose();
    this.fx.dispose();
    this.env?.dispose();
    for (const t of this.orbSprites.values()) t.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
