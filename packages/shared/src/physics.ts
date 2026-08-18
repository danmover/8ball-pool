import { Vec2 } from './vector.js';
import type { Ball, SimEvent } from './types.js';
import {
  BALL_RADIUS,
  FRICTION_DECEL,
  POCKETS,
  REST_EPSILON,
  RESTITUTION_BALL,
  RESTITUTION_CUSHION,
  SIM_HZ,
  SPIN_DAMPING,
  TABLE_LENGTH,
  TABLE_WIDTH,
} from './constants.js';

const SUBSTEP_DT = 1 / SIM_HZ;

export function isAtRest(ball: Ball): boolean {
  return Vec2.length(ball.vel) < REST_EPSILON;
}

export function allBallsAtRest(balls: Ball[]): boolean {
  return balls.every((b) => b.pocketed || isAtRest(b));
}

function applyFriction(ball: Ball, dt: number): void {
  const speed = Vec2.length(ball.vel);
  if (speed <= REST_EPSILON) {
    ball.vel = Vec2.zero();
  } else {
    const decel = Math.min(speed, FRICTION_DECEL * dt);
    const dir = Vec2.normalize(ball.vel);
    ball.vel = Vec2.sub(ball.vel, Vec2.scale(dir, decel));
  }
  ball.spin *= Math.pow(SPIN_DAMPING, dt);
}

function resolveCushions(ball: Ball, events: SimEvent[]): void {
  const r = BALL_RADIUS;
  let bounced = false;
  const speedBefore = Vec2.length(ball.vel);

  if (ball.pos.x - r < 0 && ball.vel.x < 0) {
    ball.pos.x = r;
    ball.vel.x = -ball.vel.x * RESTITUTION_CUSHION;
    ball.vel.y += ball.spin * 60; // sidespin deflection off a vertical cushion
    bounced = true;
  } else if (ball.pos.x + r > TABLE_LENGTH && ball.vel.x > 0) {
    ball.pos.x = TABLE_LENGTH - r;
    ball.vel.x = -ball.vel.x * RESTITUTION_CUSHION;
    ball.vel.y += ball.spin * 60;
    bounced = true;
  }

  if (ball.pos.y - r < 0 && ball.vel.y < 0) {
    ball.pos.y = r;
    ball.vel.y = -ball.vel.y * RESTITUTION_CUSHION;
    ball.vel.x += ball.spin * 60;
    bounced = true;
  } else if (ball.pos.y + r > TABLE_WIDTH && ball.vel.y > 0) {
    ball.pos.y = TABLE_WIDTH - r;
    ball.vel.y = -ball.vel.y * RESTITUTION_CUSHION;
    ball.vel.x += ball.spin * 60;
    bounced = true;
  }

  if (bounced) events.push({ type: 'cushion', ballId: ball.id, pos: { ...ball.pos }, speed: speedBefore });
}

function resolvePocket(ball: Ball, events: SimEvent[]): boolean {
  for (const pocket of POCKETS) {
    if (Vec2.distance(ball.pos, pocket) <= pocket.radius) {
      const pos = { ...ball.pos };
      ball.pocketed = true;
      ball.vel = Vec2.zero();
      events.push({ type: 'pot', ballId: ball.id, pos });
      return true;
    }
  }
  return false;
}

function resolveBallCollision(a: Ball, b: Ball, events: SimEvent[]): void {
  const delta = Vec2.sub(b.pos, a.pos);
  const dist = Vec2.length(delta);
  const minDist = BALL_RADIUS * 2;
  if (dist >= minDist || dist < 1e-6) return;

  const normal = Vec2.scale(delta, 1 / dist);
  const overlap = minDist - dist;
  const correction = Vec2.scale(normal, overlap / 2);
  a.pos = Vec2.sub(a.pos, correction);
  b.pos = Vec2.add(b.pos, correction);

  const relVel = Vec2.sub(b.vel, a.vel);
  const velAlongNormal = Vec2.dot(relVel, normal);
  if (velAlongNormal > 0) return; // already separating

  const impulse = -(1 + RESTITUTION_BALL) * velAlongNormal * 0.5;
  const impulseVec = Vec2.scale(normal, impulse);
  a.vel = Vec2.sub(a.vel, impulseVec);
  b.vel = Vec2.add(b.vel, impulseVec);

  const contactPoint = Vec2.add(a.pos, Vec2.scale(normal, BALL_RADIUS));
  events.push({ type: 'ballCollision', a: a.id, b: b.id, pos: contactPoint, impulse: Math.abs(impulse) });
}

export interface StepResult {
  events: SimEvent[];
  settled: boolean;
}

/** Advances the whole table by `dt` seconds using fixed substeps. */
export function stepSimulation(balls: Ball[], dt: number): StepResult {
  const events: SimEvent[] = [];
  let remaining = dt;

  while (remaining > 1e-9) {
    const h = Math.min(SUBSTEP_DT, remaining);
    remaining -= h;

    const active = balls.filter((b) => !b.pocketed);

    for (const ball of active) {
      ball.pos = Vec2.add(ball.pos, Vec2.scale(ball.vel, h));
    }

    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        resolveBallCollision(active[i], active[j], events);
      }
    }

    for (const ball of active) {
      if (resolvePocket(ball, events)) continue;
      resolveCushions(ball, events);
      applyFriction(ball, h);
    }
  }

  const settled = allBallsAtRest(balls);
  if (settled) events.push({ type: 'shotSettled' });
  return { events, settled };
}
