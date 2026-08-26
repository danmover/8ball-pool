import { describe, expect, it } from 'vitest';
import { identity, integrate, project, randomOrientation } from '../orientation.js';

/**
 * The renderer used to roll a ball's markings by how far it had *travelled*, which is only ever
 * right for a ball in natural roll. These tests pin down the three cases that were wrong:
 * backspin turns the ball the other way, english turns it without moving the marking, and a
 * ball that has stopped stops turning.
 *
 * Frame: x right, y down the screen, z into the table. The camera looks along +z, so the
 * visible face of a ball is the one with negative z, and the front-pole marking is (0, 0, -1).
 */

const FRONT: [number, number, number] = [0, 0, -1];
const UP: [number, number, number] = [0, -1, 0];

describe('ball orientation', () => {
  it('puts an unrotated front marking dead centre, facing the camera', () => {
    const p = project(identity(), FRONT, UP);
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y).toBeCloseTo(0, 6);
    expect(p.depth).toBeCloseTo(1, 6);
  });

  it('rolls the marking forwards along the direction of travel', () => {
    // Natural roll along +x is angular velocity (0, -v/R, 0). We are looking down at the *top*
    // of the ball, and the top of a rolling wheel moves the way the wheel is going — twice as
    // fast as its centre, while the contact point underneath is momentarily still. So a
    // marking on the visible face travels forwards, not backwards.
    const rolling = { x: 0, y: -1, z: 0 };
    const p = project(integrate(identity(), rolling, 0.2), FRONT, UP);
    expect(p.x).toBeGreaterThan(0);
    expect(Math.abs(p.y)).toBeLessThan(1e-6);
  });

  it('turns the opposite way under backspin', () => {
    const follow = project(integrate(identity(), { x: 0, y: -1, z: 0 }, 0.2), FRONT, UP);
    const draw = project(integrate(identity(), { x: 0, y: 1, z: 0 }, 0.2), FRONT, UP);
    // The exact case the old displacement-driven code could never show: a ball travelling
    // forwards while spinning backwards drew itself rolling forwards.
    expect(Math.sign(draw.x)).toBe(-Math.sign(follow.x));
  });

  it('twists a front marking in place under english, without moving it', () => {
    // Spin about the vertical axis leaves the ball's top point exactly where it was — so if
    // the marking's *position* were the only thing drawn, english would be invisible.
    const spun = integrate(identity(), { x: 0, y: 0, z: 4 }, 0.25);
    const p = project(spun, FRONT, UP);
    expect(Math.hypot(p.x, p.y)).toBeLessThan(1e-6);
    expect(p.depth).toBeCloseTo(1, 6);

    const before = project(identity(), FRONT, UP).twist;
    expect(Math.abs(p.twist - before)).toBeGreaterThan(0.5);
  });

  it('hides a marking once it goes round the back', () => {
    // Half a turn about y puts the front pole on the far side.
    const p = project(integrate(identity(), { x: 0, y: 1, z: 0 }, Math.PI), FRONT, UP);
    expect(p.depth).toBeLessThan(0);
  });

  it('does not turn at all when the ball is at rest', () => {
    const still = integrate(identity(), { x: 0, y: 0, z: 0 }, 1);
    expect(still).toEqual(identity());
  });

  it('stays a rotation matrix over thousands of steps', () => {
    // Float error accumulates fast at 60 fps; a drifting matrix shears the markings instead of
    // turning them, which looks like broken art rather than broken maths.
    let m = randomOrientation();
    for (let i = 0; i < 5000; i++) {
      m = integrate(m, { x: 3.1, y: -7.7, z: 2.3 }, 1 / 60);
    }
    for (let row = 0; row < 3; row++) {
      const len = Math.hypot(m[row * 3], m[row * 3 + 1], m[row * 3 + 2]);
      expect(len).toBeCloseTo(1, 6);
    }
    const dot = m[0] * m[3] + m[1] * m[4] + m[2] * m[5];
    expect(Math.abs(dot)).toBeLessThan(1e-6);
  });

  it('starts balls facing the camera so a fresh rack is readable', () => {
    // Uniformly random orientations hide over half the numbers, which reads as a bug.
    let rand = 0;
    const next = (): number => {
      rand = (rand * 9301 + 49297) % 233280;
      return rand / 233280;
    };
    for (let i = 0; i < 200; i++) {
      expect(project(randomOrientation(next), FRONT, UP).depth).toBeGreaterThan(0.75);
    }
  });
});
