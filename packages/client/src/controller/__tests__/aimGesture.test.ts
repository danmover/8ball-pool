import { describe, expect, it } from 'vitest';
import { AimGesture } from '../aimGesture';

/**
 * The bug these exist for: the release handler took no arguments and was bound to the window,
 * so *any* pointer going up ended the drag. On a touchscreen — put a second finger on the spin
 * pad while the first is pulling back, then lift it — the aim was fired early or silently
 * cancelled, and after a cancel your real release did nothing and the ball never moved.
 *
 * It needed two pointers to reproduce, which is why it looked random and why a mouse could
 * never show it.
 */

const at = (pointerId: number, x: number, y: number) => ({ pointerId, x, y });

/** Pulls back far enough to be a real shot. */
function pullBack(g: AimGesture, id = 1): void {
  g.begin(at(id, 500, 500));
  g.move(at(id, 300, 500));
}

describe('who owns the aim', () => {
  it('lets the pointer that started it move and finish it', () => {
    const g = new AimGesture();
    pullBack(g);
    expect(g.end(1).type).toBe('shoot');
  });

  it('ignores a different pointer releasing mid-pull', () => {
    const g = new AimGesture();
    pullBack(g, 1);
    // A second finger touches a control and lifts off.
    expect(g.end(2)).toEqual({ type: 'ignored' });
    // The aim is untouched, and the real release still plays the shot.
    expect(g.active).toBe(true);
    expect(g.end(1).type).toBe('shoot');
  });

  it('ignores a different pointer moving', () => {
    const g = new AimGesture();
    pullBack(g, 1);
    const power = g.power;
    expect(g.move(at(2, 900, 900))).toEqual({ type: 'ignored' });
    expect(g.power).toBe(power);
  });

  /*
   * A lost pointerup would otherwise wedge the table: with the id still held, every later
   * press is ignored and there is no way back until the turn changes. The same pointer
   * pressing again means its release never arrived, so it restarts.
   */
  it('lets the same pointer restart after a release that never arrived', () => {
    const g = new AimGesture();
    pullBack(g, 1);
    // No end() — the release was lost. The same finger presses again.
    expect(g.begin(at(1, 700, 700)).type).toBe('aim');
    expect(g.active).toBe(true);
    g.move(at(1, 500, 700));
    expect(g.end(1).type).toBe('shoot');
  });

  it('and the restart aims from the new press, not the old one', () => {
    const g = new AimGesture({ maxPullPx: 200 });
    g.begin(at(1, 500, 500));
    g.move(at(1, 300, 500)); // full pull, never released
    g.begin(at(1, 500, 500)); // pressed again
    const action = g.move(at(1, 450, 500));
    if (action.type === 'aim') expect(action.power).toBeCloseTo(0.25, 2);
  });

  it('does not let a second pointer take over the aim', () => {
    const g = new AimGesture();
    pullBack(g, 1);
    expect(g.begin(at(2, 100, 100))).toEqual({ type: 'ignored' });
    // Still the first pointer's shot to play.
    expect(g.end(2)).toEqual({ type: 'ignored' });
    expect(g.end(1).type).toBe('shoot');
  });
});

describe('taking the shot', () => {
  it('shoots at the power it was pulled to', () => {
    const g = new AimGesture({ maxPullPx: 200 });
    g.begin(at(1, 500, 500));
    g.move(at(1, 400, 500)); // half the pull
    const action = g.end(1);
    expect(action.type).toBe('shoot');
    if (action.type === 'shoot') expect(action.power).toBeCloseTo(0.5, 2);
  });

  it('fires opposite the drag, the way a cue pulls back', () => {
    const g = new AimGesture();
    g.begin(at(1, 500, 500));
    g.move(at(1, 300, 500)); // dragged left
    const action = g.end(1);
    // Angle 0 is to the right: drag left, shoot right.
    if (action.type === 'shoot') expect(Math.abs(action.angle)).toBeLessThan(0.01);
  });

  it('treats a barely-there pull as putting the cue down', () => {
    const g = new AimGesture({ minShootPower: 0.08 });
    g.begin(at(1, 500, 500));
    g.move(at(1, 498, 500));
    expect(g.end(1)).toEqual({ type: 'aim', angle: 0, power: 0 });
  });

  /*
   * A tap must never fire the last drag's shot. `lastPower` used to survive a release that
   * was ignored, so a press with no movement could go off at whatever the previous pull had
   * reached.
   */
  it('never fires a tap at the power of the previous shot', () => {
    const g = new AimGesture();
    pullBack(g, 1);
    expect(g.end(1).type).toBe('shoot');
    g.begin(at(1, 500, 500));
    expect(g.end(1)).toEqual({ type: 'aim', angle: g.angle, power: 0 });
  });
});

describe('putting the cue down', () => {
  it('cancels a pull-back without playing it', () => {
    const g = new AimGesture();
    pullBack(g);
    expect(g.cancel()).toEqual({ type: 'aim', angle: g.angle, power: 0 });
    expect(g.active).toBe(false);
  });

  it('and the release afterwards does nothing', () => {
    const g = new AimGesture();
    pullBack(g);
    g.cancel();
    expect(g.end(1)).toEqual({ type: 'ignored' });
  });

  it('does nothing when there is no aim to cancel', () => {
    expect(new AimGesture().cancel()).toEqual({ type: 'ignored' });
  });

  it('keeps the aim angle so the cue does not jump', () => {
    const g = new AimGesture();
    g.begin(at(1, 500, 500));
    g.move(at(1, 500, 300)); // aiming downward
    const angle = g.angle;
    g.cancel();
    expect(g.angle).toBe(angle);
  });
});

describe('when it is not your turn', () => {
  it('refuses to start', () => {
    const g = new AimGesture();
    g.setEnabled(false);
    expect(g.begin(at(1, 500, 500))).toEqual({ type: 'ignored' });
    expect(g.active).toBe(false);
  });

  it('drops a pull-back that was already in progress', () => {
    const g = new AimGesture();
    pullBack(g);
    g.setEnabled(false);
    expect(g.active).toBe(false);
    expect(g.end(1)).toEqual({ type: 'ignored' });
  });
});
