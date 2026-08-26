import { Vec2 } from './vector.js';
import type { Ball, SimEvent, Vec3 } from './types.js';
import { CUSHIONS, JAWS, POCKETS, mouthDepth, pocketContaining } from './table.js';
import {
  BALL_RADIUS,
  MAX_SHOT_SPEED,
  CUSHION_NOSE_RISE,
  CUSHION_RESTITUTION_FAST,
  CUSHION_RESTITUTION_SLOW,
  MAX_TIP_OFFSET,
  MIN_SHOT_SPEED,
  MISCUE_MAX_CHANCE,
  MISCUE_TIP_OFFSET,
  MU_BALL,
  MU_CUSHION,
  REST_EPSILON,
  RESTITUTION_BALL,
  ROLL_DECEL,
  SIM_HZ,
  SLIDE_DECEL,
  SPIN_DECEL,
} from './constants.js';

/**
 * Ball dynamics.
 *
 * Every ball carries a real angular velocity, and the cloth is the only thing that converts it
 * into motion. That one decision is what makes draw, follow, stun, throw, swerve and cushion
 * english behave like pool instead of like six separate tuned hacks:
 *
 *   - **Draw** is not a special case in the collision. The cue ball hands its forward momentum
 *     to the object ball and stops, still spinning backwards; the cloth then drives it back.
 *   - **Follow** is the same story with the spin the other way.
 *   - **Stun** is what happens when there is no spin left to act on.
 *   - **Losing bite over distance** is just sliding friction rubbing the spin off into natural
 *     roll on the way there, so a long screw is hard for the reason it is hard in life.
 *
 * The frame is right-handed with x right, y **down** the screen (matching screen coordinates)
 * and z **into** the table. So the cloth contact sits at `(0, 0, R)` from the centre, and a ball
 * rolling naturally along +x has angular velocity `(0, -|v|/R, 0)`.
 */

const SUBSTEP_DT = 1 / SIM_HZ;

/** Contact-patch speed below which the ball is treated as rolling rather than skidding. */
const ROLL_EPSILON = 1;

export function isAtRest(ball: Ball): boolean {
  return Vec2.length(ball.vel) < REST_EPSILON;
}

export function allBallsAtRest(balls: Ball[]): boolean {
  return balls.every((b) => b.pocketed || isAtRest(b));
}

/**
 * Velocity of the point of the ball touching the cloth: `u = v + ω × r`, with `r = (0, 0, R)`.
 *
 * This single quantity is the whole model. When it is zero the ball is rolling and friction has
 * almost nothing to push against; when it is not, sliding friction acts along `-û` and changes
 * the spin two and a half times faster than it changes the velocity — which is precisely why a
 * ball struck below centre ends up travelling backwards.
 */
export function contactVelocity(ball: Ball): Vec2 {
  return {
    x: ball.vel.x + ball.angVel.y * BALL_RADIUS,
    y: ball.vel.y - ball.angVel.x * BALL_RADIUS,
  };
}

/** The angular velocity a ball would have if it were rolling at its current speed. */
function rollingSpin(vel: Vec2): { x: number; y: number } {
  return { x: vel.y / BALL_RADIUS, y: -vel.x / BALL_RADIUS };
}

function stop(ball: Ball): void {
  ball.vel = Vec2.zero();
  ball.angVel = { x: 0, y: 0, z: 0 };
}

/**
 * One substep of cloth friction: skid, then roll.
 *
 * The 5/2 in the sliding branch is `mR²/I` for a uniform sphere. It is the reason spin dies so
 * much faster than speed does, and therefore the reason draw has a range.
 */
function applyClothFriction(ball: Ball, dt: number): void {
  const speed = Vec2.length(ball.vel);
  const u = contactVelocity(ball);
  const skid = Vec2.length(u);

  if (skid > ROLL_EPSILON) {
    // Sliding. Friction acts on the contact patch along -û, on both the linear and the
    // angular state, and stops the moment the patch stops skidding.
    const dir = Vec2.scale(u, 1 / skid);
    // The patch decelerates at (1 + 5/2) times the linear rate, so cap the step by that.
    const dv = Math.min(SLIDE_DECEL * dt, skid / 3.5);
    ball.vel = Vec2.sub(ball.vel, Vec2.scale(dir, dv));

    // dω/dt = (r × F)/I with r = (0,0,R) gives (5/2R)·(-Fy, Fx) — a quarter turn from the
    // friction direction, which is what tips a skidding ball into natural roll.
    const dw = ((5 / 2) * dv) / BALL_RADIUS;
    ball.angVel.x += dir.y * dw;
    ball.angVel.y -= dir.x * dw;
  } else if (speed > 0) {
    // Rolling. Much gentler, and the spin stays locked to the speed.
    const dir = Vec2.scale(ball.vel, 1 / speed);
    const dv = Math.min(speed, ROLL_DECEL * dt);
    ball.vel = Vec2.sub(ball.vel, Vec2.scale(dir, dv));
    const roll = rollingSpin(ball.vel);
    ball.angVel.x = roll.x;
    ball.angVel.y = roll.y;
  }

  // English is untouched by either branch above — it spins about the vertical axis, so the
  // contact patch is twisting rather than sliding and `u` never sees it. It needs its own drag
  // or it would last forever.
  if (ball.angVel.z !== 0) {
    const decay = SPIN_DECEL * dt;
    const mag = Math.abs(ball.angVel.z);
    ball.angVel.z = mag <= decay ? 0 : ball.angVel.z - Math.sign(ball.angVel.z) * decay;
  }

  if (Vec2.length(ball.vel) <= REST_EPSILON && Vec2.length(contactVelocity(ball)) <= ROLL_EPSILON) {
    stop(ball);
  }
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
/**
 * How lively the cushion is at a given impact speed.
 *
 * A single constant was wrong in both directions: real rubber returns most of a gentle roll
 * and swallows a lot of a hard smash, because the harder you compress it the more energy goes
 * into deforming it rather than into the ball. Getting this right is what makes soft safety
 * play off a rail behave differently from a power break.
 */
function cushionRestitution(speed: number): number {
  const t = Math.min(1, speed / MAX_SHOT_SPEED);
  return CUSHION_RESTITUTION_SLOW + (CUSHION_RESTITUTION_FAST - CUSHION_RESTITUTION_SLOW) * t;
}

function resolveCushions(ball: Ball, events: SimEvent[]): void {
  const r = BALL_RADIUS;
  let bounced = false;
  const speedBefore = Vec2.length(ball.vel);

  /**
   * Rebound off a cushion whose inward normal is `n`.
   *
   * English shows up here on its own: the ball's surface is moving sideways across the rubber
   * at `v·t + ω_z·R`, so friction drags the rebound along the cushion — running english widens
   * the angle, reverse english narrows it — and spends some spin doing it.
   */
  const rebound = (n: Vec2): void => {
    const vn = Vec2.dot(ball.vel, n);
    if (vn >= 0) return;
    const t = { x: n.y, y: -n.x };
    const surface = Vec2.dot(ball.vel, t) + ball.angVel.z * r;

    const jn = -vn * (1 + cushionRestitution(-vn));
    // A tangential impulse `jt` changes the surface slide by 3.5·jt (jt of velocity plus
    // 5·jt/2R of spin acting through R), so killing it takes -2s/7. Coulomb caps it, and what
    // the cap leaves behind is exactly the residual english that widens or narrows the angle.
    const jt = Math.max(-MU_CUSHION * jn, Math.min(MU_CUSHION * jn, (-surface * 2) / 7));

    ball.vel = Vec2.add(ball.vel, Vec2.add(Vec2.scale(n, jn), Vec2.scale(t, jt)));
    ball.angVel.z += ((5 / 2) * jt) / r;

    // The cushion nose sits *above* the ball's centre, so the normal impulse doesn't act
    // through it — it also applies a torque. That is why a ball picks up forward roll off a
    // rail and runs on, instead of rebounding and then sitting there. It never touches the
    // vertical axis, so english is unaffected.
    //
    // Δω = (r × J)/I with I = (2/5)mR², so the divisor is R **squared** — the lever arm here
    // is the nose rise, not the radius, unlike every other contact in this file where the two
    // happen to be the same and one R cancels.
    const rise = (5 * CUSHION_NOSE_RISE * jn) / (2 * r * r);
    ball.angVel.x += rise * n.y;
    ball.angVel.y -= rise * n.x;

    bounced = true;
  };

  for (const c of CUSHIONS) {
    const along = c.axis === 'h' ? ball.pos.x : ball.pos.y;
    if (along < c.from || along > c.to) continue; // this run doesn't reach here

    const across = c.axis === 'h' ? ball.pos.y : ball.pos.x;
    // `side` is -1 for the top/left runs (play lies at larger values) and +1 for bottom/right.
    if (c.side < 0 ? across - r >= c.base : across + r <= c.base) continue;

    if (c.axis === 'h') ball.pos.y = c.base - c.side * r;
    else ball.pos.x = c.base - c.side * r;
    rebound(c.axis === 'h' ? { x: 0, y: -c.side } : { x: -c.side, y: 0 });
  }

  for (const jaw of JAWS) {
    const delta = Vec2.sub(ball.pos, jaw.pos);
    const dist = Vec2.length(delta);
    const min = r + jaw.radius;
    if (dist >= min || dist < 1e-6) continue;

    const normal = Vec2.scale(delta, 1 / dist);
    ball.pos = Vec2.add(jaw.pos, Vec2.scale(normal, min));
    rebound(normal);
  }

  if (bounced) {
    events.push({ type: 'cushion', ballId: ball.id, pos: { ...ball.pos }, speed: speedBefore });
  }
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
  stop(ball);
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
    ball.vel = Vec2.add(ball.vel, Vec2.scale(pull, ROLL_DECEL * 6 * bite * dt));
    return;
  }
}

/**
 * Ball-on-ball contact: a normal impulse, plus a little friction across the contact.
 *
 * Note what is *not* here. There is no code that makes the cue ball come back on a draw shot —
 * the collision leaves its spin completely alone, exactly as a near-instantaneous impact does,
 * and the cloth takes over from there. The old model had to special-case that, and had to guess
 * how much spin "survived" the hit.
 *
 * The friction term is throw: the two surfaces are moving across each other at the contact, so
 * they grip, and the object ball leaves fractionally off the true line.
 */
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

  const jn = -(1 + RESTITUTION_BALL) * velAlongNormal * 0.5;
  a.vel = Vec2.sub(a.vel, Vec2.scale(normal, jn));
  b.vel = Vec2.add(b.vel, Vec2.scale(normal, jn));

  // Throw. The two surfaces are sliding across each other at the contact, and english
  // dominates that sliding — which is why a ball struck with side spin doesn't quite go where
  // the ghost-ball line says it should.
  //
  // With `t` the tangent, A's surface slides against B's at
  //   s = (v_A - v_B)·t + (ω_Az + ω_Bz)·R
  // and a tangential impulse `jt` on A (and -jt on B) changes that by 7·jt, since each ball
  // picks up 5·jt/2R of spin as well as jt of velocity. So killing the slide takes -s/7,
  // and Coulomb caps how much of that the surfaces can actually deliver.
  const tangent = { x: -normal.y, y: normal.x };
  const surface =
    Vec2.dot(Vec2.sub(a.vel, b.vel), tangent) + (a.angVel.z + b.angVel.z) * BALL_RADIUS;
  if (surface !== 0) {
    const limit = MU_BALL * jn;
    const jt = Math.max(-limit, Math.min(limit, -surface / 7));
    a.vel = Vec2.add(a.vel, Vec2.scale(tangent, jt));
    b.vel = Vec2.sub(b.vel, Vec2.scale(tangent, jt));
    // Both balls take spin the same way round, so english is partly handed on.
    const dw = ((5 / 2) * jt) / BALL_RADIUS;
    a.angVel.z += dw;
    b.angVel.z += dw;
  }

  const contactPoint = Vec2.add(a.pos, Vec2.scale(normal, BALL_RADIUS));
  events.push({ type: 'ballCollision', a: a.id, b: b.id, pos: contactPoint, impulse: Math.abs(jn) });
}

/**
 * Strikes the cue ball: the one place a shot turns into motion.
 *
 * `tip` is where the cue contacts the ball, in radii from its centre, exactly as the spin pad
 * reports it — `x` across, `y` down the screen, so **below centre (positive y) is draw**.
 *
 * The two textbook relations for an impulse `J` applied at offset `r`: `Δv = J/m` and
 * `Δω = (r × J)/I`. With `I = (2/5)mR²` those give a spin of `5·offset·speed / 2R`, which is
 * why striking 2/5 of a radius above centre puts the ball into natural roll immediately — a
 * result that falls out of the algebra rather than being dialled in.
 */
export function applyCueStrike(
  cue: Ball,
  angle: number,
  power: number,
  tip: { x: number; y: number } = { x: 0, y: 0 },
  rng: () => number = Math.random
): StrikeResult {
  let speed = MIN_SHOT_SPEED + Math.max(0, Math.min(1, power)) * (MAX_SHOT_SPEED - MIN_SHOT_SPEED);
  const dir = Vec2.fromAngle(angle);

  let tx = tip.x;
  let ty = tip.y;
  const mag = Math.hypot(tx, ty);
  if (mag > 1) {
    tx /= mag;
    ty /= mag;
  }

  // The pad's full travel reaches past the tip's safe grip, so the outer band is a gamble
  // rather than a free upgrade. Beyond MAX_TIP_OFFSET the chance of slipping climbs steeply,
  // which is exactly why real players respect extreme english instead of always using it.
  const offset = Math.min(1, mag) * MISCUE_TIP_OFFSET;
  let miscued = false;
  if (offset > MAX_TIP_OFFSET) {
    const over = (offset - MAX_TIP_OFFSET) / (MISCUE_TIP_OFFSET - MAX_TIP_OFFSET);
    miscued = rng() < over * MISCUE_MAX_CHANCE;
  }

  let offsetX = tx * MISCUE_TIP_OFFSET;
  let offsetY = ty * MISCUE_TIP_OFFSET;

  if (miscued) {
    // A miscue is the tip skidding off the side of the ball: most of the power is lost, the
    // spin that survives is nothing like what was asked for, and the ball wanders off line.
    speed *= 0.22 + rng() * 0.16;
    const scatter = (rng() - 0.5) * 0.16;
    const off = Vec2.fromAngle(angle + scatter);
    dir.x = off.x;
    dir.y = off.y;
    offsetX = (rng() - 0.5) * MAX_TIP_OFFSET;
    offsetY = (rng() - 0.5) * MAX_TIP_OFFSET;
  }

  cue.vel = Vec2.scale(dir, speed);

  // Vertical offset spins the ball about the axis across the shot line. Below centre (positive
  // screen y) has to come out as backspin, so the ball's contact patch races ahead of it.
  const k = (5 * speed) / (2 * BALL_RADIUS);
  const along = offsetY * k; // + is draw
  cue.angVel = {
    x: -along * dir.y,
    y: along * dir.x,
    // English: offset across the line spins the ball about the vertical axis.
    z: offsetX * k,
  };

  return { miscued };
}

export interface StrikeResult {
  /** The tip slipped off the ball — the shot went nowhere near what was asked for. */
  miscued: boolean;
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
      applyClothFriction(ball, h);
    }
  }

  const settled = allBallsAtRest(balls);
  if (settled) events.push({ type: 'shotSettled' });
  return { events, settled };
}

/** Re-exported so callers can zero a ball without knowing the shape of its angular state. */
export function restBall(ball: Ball): void {
  stop(ball);
}

export type { Vec3 };
