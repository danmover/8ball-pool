/**
 * The rules of the slingshot aim, with no DOM in them.
 *
 * This was inside `AimController`, tangled up with pointer events, and it hid a bug that only
 * showed on a touchscreen: the release handler took no arguments and was bound to the window,
 * so *any* pointer going up ended the drag. Put a second finger on the spin pad while the
 * first was pulling back, lift it, and the aim was either fired early or quietly cancelled —
 * after which your real release did nothing at all and the ball simply never moved.
 *
 * It only ever reproduced with two pointers, which is why it looked intermittent and why a
 * mouse could never show it. Pulled out here it is a state machine over (pointerId, x, y),
 * and the rule that fixes it — only the pointer that started the aim may move or end it — is
 * a line of code with a test on it rather than a subtlety of event routing.
 */

export interface AimPoint {
  pointerId: number;
  x: number;
  y: number;
}

export type AimAction =
  /** Nothing to do — usually a pointer that is not the one aiming. */
  | { type: 'ignored' }
  /** Redraw the aim. */
  | { type: 'aim'; angle: number; power: number }
  /** Let it go. */
  | { type: 'shoot'; angle: number; power: number };

const IGNORED: AimAction = { type: 'ignored' };

/** The signed shortest way round from `a` to `b`, so nudging never spins the long way. */
export function shortestTurn(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export interface AimGestureOptions {
  /** Drag distance, in pixels, that counts as full power. */
  maxPullPx?: number;
  /** Below this the release is treated as a cancel rather than a shot. */
  minShootPower?: number;
}

export class AimGesture {
  private opts: Required<AimGestureOptions>;
  private pointerId: number | null = null;
  private anchor = { x: 0, y: 0 };
  private lastAngle = 0;
  private lastPower = 0;
  private enabled = true;
  private precise = false;

  constructor(opts: AimGestureOptions = {}) {
    this.opts = { maxPullPx: opts.maxPullPx ?? 220, minShootPower: opts.minShootPower ?? 0.08 };
  }

  get active(): boolean {
    return this.pointerId !== null;
  }

  get angle(): number {
    return this.lastAngle;
  }

  get power(): number {
    return this.lastPower;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.reset();
  }

  setPrecise(precise: boolean): void {
    this.precise = precise;
  }

  begin(p: AimPoint): AimAction {
    if (!this.enabled) return IGNORED;
    /*
     * A second pointer must not take over an aim already in progress. Whoever started it
     * finishes it; everyone else is free to use the controls at the bottom of the screen.
     *
     * The *same* pointer pressing again is different: it means the release that should have
     * ended the last aim never arrived — a lost pointerup, a cancelled gesture, a tab that
     * lost focus mid-drag. Refusing that would wedge the table, with every press ignored and
     * no way back until the turn changed. It takes over instead, which is self-correcting and
     * indistinguishable from a fresh start.
     */
    if (this.pointerId !== null && this.pointerId !== p.pointerId) return IGNORED;
    this.pointerId = p.pointerId;
    this.anchor = { x: p.x, y: p.y };
    // Cleared on every press, so a tap can never fire a shot at the power of the last drag.
    this.lastPower = 0;
    return { type: 'aim', angle: this.lastAngle, power: 0 };
  }

  move(p: AimPoint): AimAction {
    if (p.pointerId !== this.pointerId) return IGNORED;
    const dx = this.anchor.x - p.x;
    const dy = this.anchor.y - p.y;
    const dist = Math.hypot(dx, dy);

    if (dist > 4) {
      const raw = Math.atan2(dy, dx);
      // Precision mode: move only a fraction of the way toward the pointer's angle, so the
      // same wrist movement covers a much smaller arc. Once side spin can deflect a shot by a
      // couple of degrees, "as fine as your mouse hand" stopped being fine enough.
      this.lastAngle = this.precise
        ? this.lastAngle + shortestTurn(this.lastAngle, raw) * 0.15
        : raw;
    }
    this.lastPower = Math.max(0, Math.min(1, dist / this.opts.maxPullPx));
    return { type: 'aim', angle: this.lastAngle, power: this.lastPower };
  }

  end(pointerId: number): AimAction {
    if (pointerId !== this.pointerId) return IGNORED;
    this.pointerId = null;
    const power = this.lastPower;
    this.lastPower = 0;
    return power >= this.opts.minShootPower
      ? { type: 'shoot', angle: this.lastAngle, power }
      : { type: 'aim', angle: this.lastAngle, power: 0 };
  }

  /** Put the cue down without playing the shot. */
  cancel(): AimAction {
    if (this.pointerId === null) return IGNORED;
    this.reset();
    return { type: 'aim', angle: this.lastAngle, power: 0 };
  }

  /** Turns the aim by a fixed amount, for keyboard nudging. */
  nudge(radians: number): AimAction {
    this.lastAngle += radians;
    return { type: 'aim', angle: this.lastAngle, power: this.lastPower };
  }

  private reset(): void {
    this.pointerId = null;
    this.lastPower = 0;
  }
}
