import { AimGesture, type AimAction } from './aimGesture';
import { capturePointer } from './capture';

export interface AimControllerCallbacks {
  /** Fired continuously while dragging; power is 0..1 for cue pull-back visuals only. */
  onAimChange: (angle: number, power: number) => void;
  /** Fired on release when the drag exceeded the minimum shoot power. */
  onShoot: (angle: number, power: number) => void;
  maxPullPx?: number;
  minShootPower?: number;
}

/**
 * A "slingshot" drag gesture: press anywhere in the surface, drag away from the press point to
 * aim (the shot fires opposite your drag, like pulling back a cue), release to shoot. Works the
 * same whether or not a cue ball sprite sits under the pointer, so it is shared by the phone
 * controller's touch pad and the host's direct on-canvas play.
 *
 * The rules live in `AimGesture`; this is the part that talks to the DOM. The split exists
 * because the interesting bug in here was a rule — that only the pointer which started an aim
 * may end it — hiding inside event plumbing.
 */
export class AimController {
  private el: HTMLElement;
  private cb: AimControllerCallbacks;
  private gesture: AimGesture;

  constructor(el: HTMLElement, cb: AimControllerCallbacks) {
    this.el = el;
    this.cb = cb;
    this.gesture = new AimGesture({ maxPullPx: cb.maxPullPx, minShootPower: cb.minShootPower });
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    window.addEventListener('keydown', this.onKey);
    // A right-click puts the cue down instead of raising a menu over the table.
    el.addEventListener('contextmenu', this.onContextMenu);
  }

  setEnabled(enabled: boolean): void {
    this.gesture.setEnabled(enabled);
  }

  /** Fine-aim toggle — held shift on desktop, a button on the phone. */
  setPrecise(precise: boolean): void {
    this.gesture.setPrecise(precise);
  }

  /** Turns the aim by a fixed amount, for keyboard nudging. */
  nudge(radians: number): void {
    this.apply(this.gesture.nudge(radians));
  }

  /** Put the cue down without playing the shot. */
  cancel(): void {
    this.apply(this.gesture.cancel());
  }

  /** The current aim, so callers can keep their own copy in step after a nudge. */
  get angle(): number {
    return this.gesture.angle;
  }

  /** True while a pull-back is in progress. */
  get aiming(): boolean {
    return this.gesture.active;
  }

  private apply(action: AimAction): void {
    if (action.type === 'aim') this.cb.onAimChange(action.angle, action.power);
    else if (action.type === 'shoot') this.cb.onShoot(action.angle, action.power);
  }

  private onDown = (e: PointerEvent): void => {
    // Only the primary button aims. A right- or middle-click on the cloth used to start a
    // drag that nothing ever ended.
    if (e.button !== 0) return;
    const before = this.gesture.active;
    this.apply(this.gesture.begin({ pointerId: e.pointerId, x: e.clientX, y: e.clientY }));
    // Capture only for the pointer that actually took the aim, so a second finger is still
    // free to work the controls at the bottom of the screen while this one holds the cue.
    if (!before && this.gesture.active) capturePointer(this.el, e.pointerId);
  };

  private onMove = (e: PointerEvent): void => {
    this.apply(this.gesture.move({ pointerId: e.pointerId, x: e.clientX, y: e.clientY }));
  };

  private onUp = (e: PointerEvent): void => {
    this.apply(this.gesture.end(e.pointerId));
  };

  private onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || !this.gesture.active) return;
    this.cancel();
    e.preventDefault();
  };

  private onContextMenu = (e: MouseEvent): void => {
    if (!this.gesture.active) return;
    this.cancel();
    e.preventDefault();
  };

  destroy(): void {
    this.el.removeEventListener('pointerdown', this.onDown);
    this.el.removeEventListener('pointermove', this.onMove);
    this.el.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    window.removeEventListener('keydown', this.onKey);
  }
}
