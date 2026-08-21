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
  // Balls resting in contact (e.g. still touching in the rack) have ~0 closing speed;
  // only a real approach should count as a collision, or every still-touching pair would
  // fire a "hit" event on every substep for as long as anything else on the table moves.
  if (velAlongNormal > -REST_EPSILON) return;

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

/** Never let a ball advance more than this per substep, so overlaps stay shallow. */
const MAX_TRAVEL_PER_STEP = BALL_RADIUS * 0.2;
/** Floor on substep size, purely as a runaway guard. */
const MIN_SUBSTEP_DT = 1 / 20000;

/**
 * Advances the whole table by `dt` seconds.
 *
 * Substeps are sized by the fastest ball rather than fixed: positions are integrated
 * before collisions are resolved, so a ball moving 4200 u/s under a fixed 1/240 step
 * would jump 17.5 units — nearly 40% of a ball diameter — and could bury itself deep
 * inside another before the contact pass ran. Resolving from that overlapped state
 * skews the contact normal, which is what made hard shots visibly miss the line the
 * aim guide predicted. Capping travel per substep keeps contacts shallow and accurate.
 */
export function stepSimulation(balls: Ball[], dt: number): StepResult {
  const events: SimEvent[] = [];
  let remaining = dt;

  while (remaining > 1e-9) {
    let maxSpeed = 0;
    for (const ball of balls) {
      if (ball.pocketed) continue;
      const speed = Vec2.length(ball.vel);
      if (speed > maxSpeed) maxSpeed = speed;
    }
    const travelLimited = maxSpeed > 1e-6 ? MAX_TRAVEL_PER_STEP / maxSpeed : SUBSTEP_DT;
    const h = Math.max(MIN_SUBSTEP_DT, Math.min(SUBSTEP_DT, travelLimited, remaining));
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
