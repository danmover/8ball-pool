import { Vec2 } from './vector.js';
import type { Ball, SimEvent } from './types.js';
import { CUSHIONS, JAWS, POCKETS, mouthDepth, pocketContaining } from './table.js';
import {
  BALL_RADIUS,
  FRICTION_DECEL,
  REST_EPSILON,
  RESTITUTION_BALL,
  RESTITUTION_CUSHION,
  SIM_HZ,
  SLIDE_SPEED,
  SPIN_DAMPING,
  SPIN_V_DECAY_PER_UNIT,
  SPIN_V_TRANSFER,
  SWERVE_ACCEL,
  THROW_MAX,
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
    // A stopped ball has nothing left to spin against the cloth.
    ball.spin = 0;
    ball.spinV = 0;
    return;
  }

  const dir = Vec2.normalize(ball.vel);

  // Swerve: while the ball is still sliding, english pushes it sideways off its line. Once
  // it settles into natural roll the curve stops, which is why swerve only shows on firm shots.
  if (ball.spin !== 0 && speed > SLIDE_SPEED) {
    const slide = Math.min(1, (speed - SLIDE_SPEED) / SLIDE_SPEED);
    const side = { x: -dir.y, y: dir.x };
    ball.vel = Vec2.add(ball.vel, Vec2.scale(side, ball.spin * SWERVE_ACCEL * slide * dt));
  }

  const decel = Math.min(speed, FRICTION_DECEL * dt);
  ball.vel = Vec2.sub(ball.vel, Vec2.scale(dir, decel));

  // Check again *after* decelerating: a ball that drops below the rest threshold on the final
  // substep would otherwise settle still carrying spin, because the early-out above only sees
  // the speed it came in with.
  if (Vec2.length(ball.vel) <= REST_EPSILON) {
    ball.vel = Vec2.zero();
    ball.spin = 0;
    ball.spinV = 0;
    return;
  }

  ball.spin *= Math.pow(SPIN_DAMPING, dt);
  // Vertical spin wears off over distance travelled, not time — see SPIN_V_DECAY_PER_UNIT.
  const travelled = speed * dt;
  ball.spinV *= Math.max(0, 1 - SPIN_V_DECAY_PER_UNIT * travelled);
}

/**
 * Cushions and pocket jaws.
 *
 * The rails are six discrete runs (`CUSHIONS`) rather than four unbroken walls, so there is
 * genuinely nothing between the jaw tips at a pocket mouth. A ball that enters a mouth carries
 * on into the bag instead of rebounding off a wall nobody drew.
 *
 * Each run ends in a jaw circle tangent to the nose line. Tangency is what lets a ball run down
 * the rail and straight into the pocket, while a ball arriving at an angle clips the inside of
 * a jaw and rattles — a real pocket, rather than a hole in a fence.
 */
function resolveCushions(ball: Ball, events: SimEvent[]): void {
  const r = BALL_RADIUS;
  let bounced = false;
  const speedBefore = Vec2.length(ball.vel);

  for (const c of CUSHIONS) {
    const along = c.axis === 'h' ? ball.pos.x : ball.pos.y;
    if (along < c.from || along > c.to) continue; // this run doesn't reach here

    const across = c.axis === 'h' ? ball.pos.y : ball.pos.x;
    const vel = c.axis === 'h' ? ball.vel.y : ball.vel.x;
    // `side` is -1 for the top/left runs (play lies at larger values) and +1 for bottom/right.
    const penetrating = c.side < 0 ? across - r < c.base && vel < 0 : across + r > c.base && vel > 0;
    if (!penetrating) continue;

    const clamped = c.base - c.side * r;
    const bounce = -vel * RESTITUTION_CUSHION;
    // English deflects the ball along the cushion as it grips.
    const slide = ball.spin * 60 * -c.side;
    if (c.axis === 'h') {
      ball.pos.y = clamped;
      ball.vel.y = bounce;
      ball.vel.x += slide;
    } else {
      ball.pos.x = clamped;
      ball.vel.x = bounce;
      ball.vel.y += slide;
    }
    bounced = true;
  }

  for (const jaw of JAWS) {
    const delta = Vec2.sub(ball.pos, jaw.pos);
    const dist = Vec2.length(delta);
    const min = r + jaw.radius;
    if (dist >= min || dist < 1e-6) continue;

    const normal = Vec2.scale(delta, 1 / dist);
    const closing = Vec2.dot(ball.vel, normal);
    ball.pos = Vec2.add(jaw.pos, Vec2.scale(normal, min));
    if (closing >= 0) continue; // already leaving; just don't let it sink in
    ball.vel = Vec2.sub(ball.vel, Vec2.scale(normal, closing * (1 + RESTITUTION_CUSHION)));
    bounced = true;
  }

  if (bounced) events.push({ type: 'cushion', ballId: ball.id, pos: { ...ball.pos }, speed: speedBefore });
}

/**
 * Has the ball gone in?
 *
 * The test is whether its centre has crossed the chord between a pocket's two jaw tips, heading
 * out of play — which is exactly the opening the table is drawn with. The old test was a small
 * circle around a point, so a ball passing through the visible middle of a mouth was ruled
 * still-in-play and then bounced off the phantom cushion behind it.
 */
function resolvePocket(ball: Ball, events: SimEvent[]): boolean {
  const pocket = pocketContaining(ball.pos);
  if (!pocket) return false;

  const pos = { ...ball.pos };
  ball.pocketed = true;
  ball.vel = Vec2.zero();
  ball.spin = 0;
  ball.spinV = 0;
  events.push({ type: 'pot', ballId: ball.id, pos, pocketIndex: pocket.index });
  return true;
}

/**
 * Once a ball is over the lip it is going in, so stop pretending otherwise.
 *
 * Without this a ball can creep into a mouth, run out of pace and sit balanced between the jaws
 * — the one place on the table where a stationary ball looks obviously wrong. Real balls that
 * far over the edge drop. `mouthDepth` is negative outside, so this only bites in the last
 * ball-radius of approach.
 */
function applyBagGravity(ball: Ball, dt: number): void {
  for (const p of POCKETS) {
    const depth = mouthDepth(p, ball.pos);
    if (depth < -BALL_RADIUS || depth >= 0) continue;
    const pull = Vec2.normalize(Vec2.sub(p.capture, ball.pos));
    // Scaled by how far over the lip it already is, so it eases in rather than snatching.
    const bite = 1 - -depth / BALL_RADIUS;
    ball.vel = Vec2.add(ball.vel, Vec2.scale(pull, FRICTION_DECEL * 1.6 * bite * dt));
    return;
  }
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

  // Direction of travel before the impulse — the spin acts along the line the striking ball
  // was already moving on, so it has to be captured first.
  const striker = Vec2.length(a.vel) >= Vec2.length(b.vel) ? a : b;
  const struck = striker === a ? b : a;
  const strikerDir = Vec2.length(striker.vel) > 1e-6 ? Vec2.normalize(striker.vel) : normal;

  const impulse = -(1 + RESTITUTION_BALL) * velAlongNormal * 0.5;
  const impulseVec = Vec2.scale(normal, impulse);
  a.vel = Vec2.sub(a.vel, impulseVec);
  b.vel = Vec2.add(b.vel, impulseVec);

  // ---- Cue ball control ----
  // Vertical spin survives the collision and expresses itself along the original line:
  // backspin drags the striker back off the object ball, topspin carries it through, and
  // nothing at all leaves it stunned dead. This is the whole of position play.
  if (striker.spinV !== 0) {
    striker.vel = Vec2.add(striker.vel, Vec2.scale(strikerDir, striker.spinV * SPIN_V_TRANSFER));
    // Most of it is spent in the hit; what's left keeps working on the roll afterwards.
    striker.spinV *= 0.25;
  }

  // Throw: english on the striker rubs against the object ball and pushes it fractionally
  // off the true contact line, in the direction the spin is turning.
  if (striker.spin !== 0) {
    const angle = striker.spin * THROW_MAX;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    struck.vel = {
      x: struck.vel.x * cos - struck.vel.y * sin,
      y: struck.vel.x * sin + struck.vel.y * cos,
    };
    // A little english transfers to the object ball as the surfaces grip.
    struck.spin += striker.spin * 0.12;
    striker.spin *= 0.7;
  }

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
      // After the cushions, so a ball nudged over the lip by a jaw still gets drawn in.
      applyBagGravity(ball, h);
      applyFriction(ball, h);
    }
  }

  const settled = allBallsAtRest(balls);
  if (settled) events.push({ type: 'shotSettled' });
  return { events, settled };
}
