import { signal, computed, batch } from '@preact/signals';
import {
  BALL_DIAMETER,
  BALL_RADIUS,
  CUE_BALL_ID,
  CURVE_ELEVATION,
  CURVE_MIN_SIDE,
  HEAD_STRING_X,
  JUMP_ELEVATION,
  JUMP_MIN_POWER,
  MAX_TIP_OFFSET,
  MISCUE_TIP_OFFSET,
  TABLE_LENGTH,
  TABLE_WIDTH,
  Vec2,
  callRequirement,
  computeTrajectoryPreview,
  legalTargetBallIds,
  physicsModsFor,
  predictedPocket,
  seatIndex,
  type AimState,
  type Ball,
  type GameState,
  type TrajectoryPreview,
} from '@8ball/shared';
import type { GameClient } from '../net/client';

/**
 * Everything about lining up a shot on this device: where the cue points, how hard, where the
 * tip meets the ball, which pocket is called, and the cue ball in hand. Screen-agnostic — the
 * table screen feeds it pointer positions in table units and reads its signals.
 */

export type ShotType = 'normal' | 'swerve' | 'jump';

/** The pad's edge maps to past the safe grip; this is where the miscue band starts, 0..1. */
export const SAFE_SPIN = MAX_TIP_OFFSET / MISCUE_TIP_OFFSET;

export class AimControls {
  readonly angle = signal(0);
  readonly spin = signal({ x: 0, y: 0 });
  readonly shotType = signal<ShotType>('normal');
  readonly power = signal(0);
  readonly charging = signal(false);
  readonly calledPocket = signal<number | null>(null);
  /** The player picked the pocket themselves, so stop predicting it. */
  readonly pocketLocked = signal(false);
  readonly placing = signal<{ x: number; y: number } | null>(null);
  readonly placeValid = signal(true);
  readonly preview = signal<TrajectoryPreview | null>(null);
  /** Balls this device is showing, at rest. */
  readonly balls = signal<Ball[]>([]);
  readonly awaitingShot = signal(false);

  readonly elevation = computed(() => (this.shotType.value === 'jump' ? JUMP_ELEVATION : this.shotType.value === 'swerve' ? CURVE_ELEVATION : 0));

  private lastSentAt = 0;
  private pendingSend: ReturnType<typeof setTimeout> | null = null;
  private previewTimer: ReturnType<typeof setTimeout> | null = null;
  private dragMode: 'aim' | 'pull' | 'place' | null = null;
  private pullStart: { x: number; y: number } | null = null;
  private keyCharge: number | null = null;

  constructor(private client: GameClient) {}

  // ---------------------------------------------------------------- state

  game(): GameState | null {
    return this.client.game.value;
  }

  cue(): Ball | undefined {
    return this.game()?.balls.find((b) => b.id === CUE_BALL_ID && !b.pocketed);
  }

  /** Whether placement is allowed right now (ball in hand, kitchen on the break, practice). */
  canPlace(): boolean {
    const g = this.game();
    if (!g || !this.client.myTurn.value) return false;
    return g.phase === 'ball_in_hand' || g.phase === 'break' || g.mode === 'practice';
  }

  /** Must the cue ball be placed before a shot can be taken? */
  mustPlace(): boolean {
    const g = this.game();
    return !!g && this.client.myTurn.value && g.phase === 'ball_in_hand';
  }

  /** Called when a new turn becomes ours: point at something sensible. */
  resetForTurn(): void {
    const g = this.game();
    const cue = this.cue();
    if (!g || !cue) return;
    const targets = legalTargetBallIds(g);
    const target = targets
      .map((id) => g.balls.find((b) => b.id === id && !b.pocketed))
      .filter((b): b is Ball => !!b)
      .sort((a, b) => Vec2.distance(a.pos, cue.pos) - Vec2.distance(b.pos, cue.pos))[0];
    batch(() => {
      if (target) this.angle.value = Math.atan2(target.pos.y - cue.pos.y, target.pos.x - cue.pos.x);
      this.power.value = 0;
      this.charging.value = false;
      this.calledPocket.value = null;
      this.pocketLocked.value = false;
      this.placing.value = null;
      this.awaitingShot.value = false;
      if (this.shotType.value !== 'normal') this.shotType.value = 'normal';
    });
    this.refreshPreview(true);
  }

  // ---------------------------------------------------------------- aim

  setAngle(a: number): void {
    this.angle.value = a;
    this.changed();
  }

  nudge(delta: number): void {
    this.setAngle(this.angle.value + delta);
  }

  setSpin(x: number, y: number): void {
    const mag = Math.hypot(x, y);
    const s = mag > 1 ? { x: x / mag, y: y / mag } : { x, y };
    this.spin.value = s;
    // A swerve needs side on the ball, or it is just an awkward straight shot.
    if (this.shotType.value === 'swerve' && Math.abs(s.x) < 0.05) this.shotType.value = 'normal';
    this.changed();
  }

  setShotType(t: ShotType): void {
    this.shotType.value = t;
    if (t === 'swerve' && Math.abs(this.spin.value.x) < CURVE_MIN_SIDE) {
      this.spin.value = { x: CURVE_MIN_SIDE * (this.spin.value.x < 0 ? -1 : 1), y: this.spin.value.y };
    }
    this.changed();
  }

  setPower(p: number): void {
    this.power.value = Math.max(0, Math.min(1, p));
    this.changed(false);
  }

  choosePocket(index: number | null): void {
    this.calledPocket.value = index;
    this.pocketLocked.value = index !== null;
  }

  /** Something about the aim moved: tell the table and redraw the guide. */
  private changed(preview = true): void {
    this.sendAim();
    if (preview) this.refreshPreview();
  }

  private sendAim(): void {
    if (!this.client.myTurn.value) return;
    const now = performance.now();
    const wait = 60 - (now - this.lastSentAt);
    if (wait > 0) {
      if (!this.pendingSend) this.pendingSend = setTimeout(() => {
        this.pendingSend = null;
        this.sendAim();
      }, wait);
      return;
    }
    this.lastSentAt = now;
    this.client.send({ t: 'aim', aim: this.aimState() });
  }

  aimState(): AimState {
    return { angle: this.angle.value, spin: this.spin.value, elevation: this.elevation.value, power: this.power.value };
  }

  /** Recomputes the aim guide, throttled so dragging stays smooth on slow phones. */
  refreshPreview(now = false): void {
    if (this.previewTimer && !now) return;
    const run = () => {
      this.previewTimer = null;
      const g = this.game();
      const cue = this.cue();
      if (!g || !cue || this.placing.value) {
        this.preview.value = null;
        return;
      }
      const mods = physicsModsFor(g.power?.armed ?? null);
      const long = g.power?.armed === 'guide';
      const guidePower = this.charging.value ? Math.max(0.2, this.power.value) : 0.55;
      const p = computeTrajectoryPreview(
        g.balls,
        CUE_BALL_ID,
        this.angle.value,
        'full',
        this.spin.value,
        this.shotType.value === 'jump' ? Math.max(JUMP_MIN_POWER, guidePower) : guidePower,
        this.elevation.value,
        mods,
        long ? 3 : undefined
      );
      this.preview.value = p;
      if (!this.pocketLocked.value && callRequirement(g) !== 'none') {
        this.calledPocket.value = predictedPocket(p);
      }
    };
    if (now) run();
    else this.previewTimer = setTimeout(run, 33);
  }

  // ---------------------------------------------------------------- pointer

  /** Pointer went down on the table at `p` (table units). */
  pointerDown(p: { x: number; y: number }): void {
    if (!this.client.myTurn.value || this.awaitingShot.value) return;
    const cue = this.cue();
    const nearCue = cue ? Vec2.distance(cue.pos, p) < BALL_RADIUS * 3.2 : false;
    // Ball in hand: drag it anywhere. On the break (and in practice) grab the cue ball to move it.
    if (this.mustPlace() || (this.canPlace() && nearCue)) {
      this.dragMode = 'place';
      this.movePlacement(p);
      return;
    }
    if (nearCue) {
      this.dragMode = 'pull';
      this.pullStart = p;
      this.charging.value = true;
      this.power.value = 0;
      return;
    }
    this.dragMode = 'aim';
    this.aimAt(p);
  }

  pointerMove(p: { x: number; y: number }): void {
    if (!this.dragMode) return;
    if (this.dragMode === 'place') {
      this.movePlacement(p);
    } else if (this.dragMode === 'aim') {
      this.aimAt(p);
    } else if (this.dragMode === 'pull') {
      const cue = this.cue();
      if (!cue) return;
      // Slingshot: pull away from where you want to shoot.
      const back = Vec2.sub(cue.pos, p);
      const dist = Vec2.length(back);
      if (dist > BALL_RADIUS * 1.5) {
        this.angle.value = Math.atan2(back.y, back.x);
        this.power.value = Math.min(1, Math.max(0, (dist - BALL_RADIUS * 1.5) / 520));
        this.changed();
      }
    }
  }

  pointerUp(): void {
    const mode = this.dragMode;
    this.dragMode = null;
    if (mode === 'place') this.commitPlacement();
    else if (mode === 'pull') {
      this.charging.value = false;
      if (this.power.value > 0.03) this.shoot();
      else this.setPower(0);
    }
  }

  get dragging(): boolean {
    return this.dragMode !== null;
  }

  private aimAt(p: { x: number; y: number }): void {
    const cue = this.cue();
    if (!cue) return;
    const d = Vec2.sub(p, cue.pos);
    if (Vec2.length(d) < BALL_RADIUS) return;
    this.setAngle(Math.atan2(d.y, d.x));
  }

  // ---------------------------------------------------------------- placement

  private legal(pos: { x: number; y: number }): boolean {
    const g = this.game();
    if (!g) return false;
    const r = BALL_RADIUS;
    if (pos.x < r || pos.x > TABLE_LENGTH - r || pos.y < r || pos.y > TABLE_WIDTH - r) return false;
    if ((g.phase === 'break' || g.ballInHandBehindLine) && pos.x > HEAD_STRING_X) return false;
    return g.balls.every((b) => b.id === CUE_BALL_ID || b.pocketed || Vec2.distance(b.pos, pos) >= BALL_DIAMETER);
  }

  private movePlacement(raw: { x: number; y: number }): void {
    const g = this.game();
    if (!g) return;
    const r = BALL_RADIUS;
    const maxX = g.phase === 'break' || g.ballInHandBehindLine ? HEAD_STRING_X : TABLE_LENGTH - r;
    const pos = { x: Math.max(r, Math.min(maxX, raw.x)), y: Math.max(r, Math.min(TABLE_WIDTH - r, raw.y)) };
    this.placing.value = pos;
    this.placeValid.value = this.legal(pos);
    this.preview.value = null;
    const now = performance.now();
    if (now - this.lastSentAt > 60) {
      this.lastSentAt = now;
      this.client.send({ t: 'place', pos, commit: false });
    }
  }

  private commitPlacement(): void {
    const pos = this.placing.value;
    if (!pos) return;
    if (this.placeValid.value) {
      this.client.send({ t: 'place', pos, commit: true });
      // Show it where it was put; the host confirms with a state update.
      const g = this.game();
      if (g) {
        const cue = g.balls.find((b) => b.id === CUE_BALL_ID);
        if (cue) {
          cue.pos = { ...pos };
          cue.pocketed = false;
        }
      }
    }
    this.placing.value = null;
    this.refreshPreview(true);
  }

  // ---------------------------------------------------------------- power & shooting

  /** Starts charging from the power control. */
  beginCharge(): void {
    if (!this.client.myTurn.value || this.mustPlace() || this.awaitingShot.value) return;
    this.charging.value = true;
    this.setPower(0);
  }

  endCharge(): void {
    if (!this.charging.value) return;
    this.charging.value = false;
    if (this.power.value > 0.03) this.shoot();
    else this.setPower(0);
  }

  cancelCharge(): void {
    this.charging.value = false;
    this.setPower(0);
  }

  /** Keyboard: Space held builds power; released, it shoots. */
  keyChargeStart(): void {
    if (this.keyCharge !== null) return;
    this.beginCharge();
    if (!this.charging.value) return;
    const start = performance.now();
    const tick = () => {
      if (!this.charging.value) {
        this.keyCharge = null;
        return;
      }
      const t = (performance.now() - start) / 1500;
      this.setPower(Math.min(1, t * t * 0.4 + t * 0.6));
      this.keyCharge = requestAnimationFrame(tick);
    };
    this.keyCharge = requestAnimationFrame(tick);
  }

  keyChargeEnd(): void {
    if (this.keyCharge !== null) cancelAnimationFrame(this.keyCharge);
    this.keyCharge = null;
    this.endCharge();
  }

  shoot(): boolean {
    const g = this.game();
    if (!g || !this.client.myTurn.value || this.mustPlace()) return false;
    if (g.phase !== 'aiming' && g.phase !== 'break') return false;
    let power = this.power.value;
    if (this.shotType.value === 'jump') power = Math.max(JUMP_MIN_POWER, power);
    const need = callRequirement(g);
    let call: { ballId: number; pocketIndex: number } | null = null;
    if (need !== 'none') {
      const pocket = this.calledPocket.value ?? predictedPocket(this.preview.value ?? computeTrajectoryPreview(g.balls, CUE_BALL_ID, this.angle.value, 'full', this.spin.value, power, this.elevation.value));
      const ballId = need === 'pocket' ? 8 : (this.preview.value?.firstContactBallId ?? legalTargetBallIds(g)[0] ?? 8);
      if (pocket !== null) call = { ballId, pocketIndex: pocket };
    }
    this.client.send({
      t: 'shoot',
      shot: { angle: this.angle.value, power, spin: this.spin.value, elevation: this.elevation.value, call },
    });
    this.awaitingShot.value = true;
    this.power.value = power;
    // If the host refuses the shot, give control back rather than leaving the cue frozen.
    setTimeout(() => {
      if (this.awaitingShot.value && !this.client.playing.value) {
        this.awaitingShot.value = false;
        this.setPower(0);
      }
    }, 2500);
    return true;
  }

  /** Whose seat is at the table right now, as an index. */
  shooterIndex(): number {
    const g = this.game();
    return g ? seatIndex(g.currentShooter) : -1;
  }

  dispose(): void {
    if (this.pendingSend) clearTimeout(this.pendingSend);
    if (this.previewTimer) clearTimeout(this.previewTimer);
    if (this.keyCharge !== null) cancelAnimationFrame(this.keyCharge);
  }
}
