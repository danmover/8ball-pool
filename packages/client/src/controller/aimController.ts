export interface AimControllerCallbacks {
  /** Fired continuously while dragging; power is 0..1 for cue pull-back visuals only. */
  onAimChange: (angle: number, power: number) => void;
  /** Fired on release when the drag exceeded the minimum shoot power. */
  onShoot: (angle: number, power: number) => void;
  maxPullPx?: number;
  minShootPower?: number;
}

/**
 * A "slingshot" drag gesture: press anywhere in the surface, drag away from the
 * press point to aim (the shot fires opposite your drag, like pulling back a cue),
 * release to shoot. Works the same whether or not a cue ball sprite sits under the
 * pointer, so it's shared by both the phone controller's touch pad and the host's
 * direct on-canvas play mode.
 */
export class AimController {
  private el: HTMLElement;
  private cb: AimControllerCallbacks;
  private dragging = false;
  private anchor = { x: 0, y: 0 };
  private lastAngle = 0;
  private lastPower = 0;
  private enabled = true;

  constructor(el: HTMLElement, cb: AimControllerCallbacks) {
    this.el = el;
    this.cb = cb;
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.dragging = false;
  }

  private onDown = (e: PointerEvent): void => {
    if (!this.enabled) return;
    this.dragging = true;
    this.anchor = { x: e.clientX, y: e.clientY };
    this.el.setPointerCapture(e.pointerId);
  };

  private onMove = (e: PointerEvent): void => {
    if (!this.dragging) return;
    const dx = this.anchor.x - e.clientX;
    const dy = this.anchor.y - e.clientY;
    const dist = Math.hypot(dx, dy);
    const maxPull = this.cb.maxPullPx ?? 220;
    if (dist > 4) this.lastAngle = Math.atan2(dy, dx);
    this.lastPower = Math.max(0, Math.min(1, dist / maxPull));
    this.cb.onAimChange(this.lastAngle, this.lastPower);
  };

  private onUp = (): void => {
    if (!this.dragging) return;
    this.dragging = false;
    const minPower = this.cb.minShootPower ?? 0.08;
    if (this.lastPower >= minPower) {
      this.cb.onShoot(this.lastAngle, this.lastPower);
    } else {
      this.cb.onAimChange(this.lastAngle, 0);
    }
    this.lastPower = 0;
  };

  destroy(): void {
    this.el.removeEventListener('pointerdown', this.onDown);
    this.el.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
  }
}
