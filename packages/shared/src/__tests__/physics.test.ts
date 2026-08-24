import { describe, expect, it } from 'vitest';
import { stepSimulation } from '../physics.js';
import { rackBalls } from '../rack.js';
import { BALL_RADIUS, CUE_BALL_ID, TABLE_LENGTH, TABLE_WIDTH } from '../constants.js';
import type { Ball } from '../types.js';

function ball(id: number, x: number, y: number, vx = 0, vy = 0): Ball {
  return { id, kind: id === 0 ? 'cue' : 'solid', pos: { x, y }, vel: { x: vx, y: vy }, spin: 0, spinV: 0, pocketed: false };
}

describe('rackBalls', () => {
  it('produces 16 unique balls, all inside the table', () => {
    const balls = rackBalls();
    expect(balls).toHaveLength(16);
    expect(new Set(balls.map((b) => b.id)).size).toBe(16);
    for (const b of balls) {
      expect(b.pos.x).toBeGreaterThanOrEqual(BALL_RADIUS);
      expect(b.pos.x).toBeLessThanOrEqual(TABLE_LENGTH - BALL_RADIUS);
      expect(b.pos.y).toBeGreaterThanOrEqual(BALL_RADIUS);
      expect(b.pos.y).toBeLessThanOrEqual(TABLE_WIDTH - BALL_RADIUS);
    }
  });
});

describe('stepSimulation', () => {
  it('decelerates a rolling ball to rest via friction', () => {
    const balls = [ball(CUE_BALL_ID, 200, 200, 500, 0)];
    let settled = false;
    for (let i = 0; i < 600 && !settled; i++) {
      settled = stepSimulation(balls, 1 / 60).settled;
    }
    expect(settled).toBe(true);
    expect(Math.hypot(balls[0].vel.x, balls[0].vel.y)).toBeLessThan(5);
  });

  it('reflects a ball off the left cushion', () => {
    const balls = [ball(1, BALL_RADIUS + 2, 300, -600, 0)];
    const { events } = stepSimulation(balls, 1 / 20);
    expect(events.some((e) => e.type === 'cushion')).toBe(true);
    expect(balls[0].vel.x).toBeGreaterThan(0);
    expect(balls[0].pos.x).toBeGreaterThanOrEqual(BALL_RADIUS);
  });

  it('exchanges velocity between two head-on equal balls', () => {
    const a = ball(0, 300, 300, 400, 0);
    const b = ball(1, 300 + BALL_RADIUS * 2 + 10, 300, 0, 0);
    const { events } = stepSimulation([a, b], 1 / 10);
    expect(events.some((e) => e.type === 'ballCollision')).toBe(true);
    expect(b.vel.x).toBeGreaterThan(0);
    expect(a.vel.x).toBeLessThan(b.vel.x);
  });

  it('sends a dead-straight full-power shot straight down the table', () => {
    // Regression: with a fixed substep the cue ball buried itself in the object ball
    // before contact resolved, skewing the normal and throwing hard shots off-line.
    const cue = ball(0, 300, 500, 4200, 0);
    const target = ball(1, 1200, 500, 0, 0);
    const balls = [cue, target];
    for (let i = 0; i < 400 && !stepSimulation(balls, 1 / 60).settled; i++);

    // A straight centre-ball hit must not impart sideways drift to either ball.
    expect(Math.abs(target.pos.y - 500)).toBeLessThan(1);
    expect(Math.abs(cue.pos.y - 500)).toBeLessThan(1);
    expect(target.pos.x).toBeGreaterThan(1200); // driven forward
  });

  it('keeps a hard cut shot on the geometric cut angle', () => {
    // Cue aimed straight along +x at a ball offset in y: the object ball should leave
    // along the line from the contact point through its centre.
    const cue = ball(0, 300, 500, 3600, 0);
    const target = ball(1, 1200, 500 + BALL_RADIUS, 0, 0);
    const balls = [cue, target];
    for (let i = 0; i < 400 && !stepSimulation(balls, 1 / 60).settled; i++);

    // Contact centres are 2R apart with dy = R, so the cut is 30 degrees off the
    // cue's line of travel; the object ball must move down-and-right, not backwards.
    const dx = target.pos.x - 1200;
    const dy = target.pos.y - (500 + BALL_RADIUS);
    expect(dx).toBeGreaterThan(0);
    expect(dy).toBeGreaterThan(0);
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    expect(angle).toBeGreaterThan(20);
    expect(angle).toBeLessThan(40);
  });

  it('pockets a ball that reaches a pocket zone', () => {
    const balls = [ball(1, 5, 5, 0, 0)];
    const { events } = stepSimulation(balls, 1 / 60);
    expect(events.some((e) => e.type === 'pot' && e.ballId === 1)).toBe(true);
    expect(balls[0].pocketed).toBe(true);
  });
});

describe('cue ball control (spin)', () => {
  /**
   * Fires the cue ball straight down the table into a stationary object ball.
   *
   * Speeds and distances here are chosen so the object ball comes to rest *before* the far
   * cushion. An earlier version of these tests used a firm shot, the object ball rebounded off
   * the end rail and struck the cue ball a second time, and every assertion about where the cue
   * ball finished was really measuring that second collision.
   */
  function shot(opts: {
    spinV?: number;
    spin?: number;
    cueX?: number;
    targetX?: number;
    speed?: number;
  }): { cue: Ball; target: Ball; contactX: number } {
    const cueX = opts.cueX ?? 400;
    const targetX = opts.targetX ?? 800;
    const cue = ball(CUE_BALL_ID, cueX, 500, opts.speed ?? 700, 0);
    cue.spinV = opts.spinV ?? 0;
    cue.spin = opts.spin ?? 0;
    const target = ball(1, targetX, 500);
    const balls = [cue, target];
    for (let i = 0; i < 900 && !stepSimulation(balls, 1 / 60).settled; i++);
    return { cue, target, contactX: targetX - BALL_RADIUS * 2 };
  }

  it('keeps every shot clear of the far cushion, so nothing rebounds into the cue ball', () => {
    for (const spinV of [-1, 0, 1]) {
      const { target } = shot({ spinV });
      expect(target.pos.x).toBeLessThan(TABLE_LENGTH - BALL_RADIUS * 2);
    }
  });

  it('sends the object ball on regardless of the spin used', () => {
    for (const spinV of [-1, 0, 1]) {
      const { target } = shot({ spinV });
      expect(target.pos.x).toBeGreaterThan(800);
      expect(Math.abs(target.pos.y - 500)).toBeLessThan(2);
    }
  });

  it('draws the cue ball back behind the contact point with backspin', () => {
    const { cue, contactX } = shot({ spinV: -1 });
    expect(cue.pos.x).toBeLessThan(contactX - 40);
  });

  it('leaves the cue ball near the contact point on a stun shot', () => {
    const { cue, contactX } = shot({ spinV: 0 });
    expect(Math.abs(cue.pos.x - contactX)).toBeLessThan(40);
  });

  it('orders draw, stun and follow correctly along the shot line', () => {
    const draw = shot({ spinV: -1 }).cue.pos.x;
    const stun = shot({ spinV: 0 }).cue.pos.x;
    const follow = shot({ spinV: 1 }).cue.pos.x;
    expect(draw).toBeLessThan(stun);
    expect(stun).toBeLessThan(follow);
  });

  it('loses its bite over distance, so a long screw draws back less', () => {
    // Both shots arrive at the object ball at the same speed; only the distance travelled to
    // get there differs, which isolates the decay from everything else.
    const near = shot({ spinV: -1, cueX: 790, targetX: 1100, speed: 865 });
    const far = shot({ spinV: -1, cueX: 150, targetX: 1100, speed: 1100 });
    const nearDraw = near.contactX - near.cue.pos.x;
    const farDraw = far.contactX - far.cue.pos.x;
    expect(nearDraw).toBeGreaterThan(farDraw);
  });

  it('curves the cue ball sideways with english on a firm shot', () => {
    const cue = ball(CUE_BALL_ID, 200, 500, 3200, 0);
    cue.spin = 1;
    const balls = [cue];
    for (let i = 0; i < 900 && !stepSimulation(balls, 1 / 60).settled; i++);
    // Struck dead straight down the table, so any drift off the line is swerve.
    expect(Math.abs(cue.pos.y - 500)).toBeGreaterThan(5);
  });

  it('throws the object ball off the true line when english is applied', () => {
    const clean = shot({ spin: 0 }).target.pos.y;
    const thrown = shot({ spin: 1 }).target.pos.y;
    expect(Math.abs(thrown - 500)).toBeGreaterThan(Math.abs(clean - 500));
  });

  it('clears all spin once a ball comes to rest', () => {
    const { cue, target } = shot({ spinV: -1, spin: 1 });
    expect(cue.spin).toBe(0);
    expect(cue.spinV).toBe(0);
    expect(target.spin).toBe(0);
  });

  it('still sends a dead-straight centre-ball shot straight, as before', () => {
    const { cue, target } = shot({ spinV: 0, spin: 0 });
    expect(Math.abs(target.pos.y - 500)).toBeLessThan(1);
    expect(Math.abs(cue.pos.y - 500)).toBeLessThan(1);
  });
});
