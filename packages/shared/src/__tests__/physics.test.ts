import { describe, expect, it } from 'vitest';
import { stepSimulation } from '../physics.js';
import { rackBalls } from '../rack.js';
import { BALL_RADIUS, CUE_BALL_ID, TABLE_LENGTH, TABLE_WIDTH } from '../constants.js';
import type { Ball } from '../types.js';

function ball(id: number, x: number, y: number, vx = 0, vy = 0): Ball {
  return { id, kind: id === 0 ? 'cue' : 'solid', pos: { x, y }, vel: { x: vx, y: vy }, spin: 0, pocketed: false };
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

  it('pockets a ball that reaches a pocket zone', () => {
    const balls = [ball(1, 5, 5, 0, 0)];
    const { events } = stepSimulation(balls, 1 / 60);
    expect(events.some((e) => e.type === 'pot' && e.ballId === 1)).toBe(true);
    expect(balls[0].pocketed).toBe(true);
  });
});
