import { Vec2, hypot2 } from './vector.js';
import type { Ball, SimEvent, Vec3 } from './types.js';
import { CUSHIONS, JAWS, POCKETS, mouthDepth, pocketContaining } from './table.js';
import {
  BIG_POCKET_BONUS,
  BOMB_RADIUS,
  BOMB_SPEED,
  orbsUnder,
  type Orb,
  type PhysicsMods,
} from './powers.js';

/**
 * Optional extras for a single simulation run.
 *
 * Optional on purpose: the aim guide and the bot's shot search call `stepSimulation` without
 * them and get exactly the engine they always got. Only Power Pool passes anything.
 */
export interface SimOptions {
  /** Power orbs on the cloth. Mutated in place as the cue ball collects them. */
  orbs?: Orb[];
  /**
   * Physical effects in force for this shot. Mutated: a bomb is spent by its first contact,
   * which is why every device replaying a shot must start from its own copy.
   */
  mods?: PhysicsMods;
}
import {
  BALL_RADIUS,
  CUE_BALL_ID,
  MAX_SHOT_SPEED,
  CUSHION_NOSE_RISE,
  CUSHION_RESTITUTION_FAST,
  CUSHION_RESTITUTION_SLOW,
  CLOTH_REBOUND,
  GRAVITY,
  LANDING_RESTITUTION,
  MAX_ELEVATION,
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
  SQUIRT_MAX,
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

function isAtRest(ball: Ball): boolean {
  // A ball in mid-air has to count as moving even when its horizontal speed is nil, or a
  // straight-up jump would end the shot while the ball was still off the cloth.
  if (ball.z > 1e-4 || ball.vz !== 0) return false;
  return Vec2.length(ball.vel) < REST_EPSILON;
}

function allBallsAtRest(balls: Ball[]): boolean {
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
  ball.z = 0;
  ball.vz = 0;
}

/**
 * One substep of cloth friction: skid, then roll.
 *
 * The 5/2 in the sliding branch is `mR²/I` for a uniform sphere. It is the reason spin dies so
 * much faster than speed does, and therefore the reason draw has a range.
 */
/** A ball off the cloth — it can't be rubbed by it, potted, or struck by a ball beneath it. */
export function isAirborne(ball: Ball): boolean {
  return ball.z > 1e-4;
}

/**
 * Flight and landing.
 *
 * A ball in the air is only acted on by gravity, which is what lets a jump shot pass clean over
 * an obstruction. Landing keeps very little of the vertical speed — real balls thud and settle
 * rather than bouncing on down the table — and each landing leaves the ball skidding, because
 * it arrives with whatever spin it took off with and none of it matched to the cloth.
 */
function applyFlight(ball: Ball, dt: number): void {
  ball.vz -= GRAVITY * dt;
  ball.z += ball.vz * dt;
  if (ball.z > 0) return;

  ball.z = 0;
  if (ball.vz < 0) {
    ball.vz = -ball.vz * LANDING_RESTITUTION;
    // Below a token hop, settle rather than jittering along the cloth forever.
    if (ball.vz < GRAVITY * dt * 2) ball.vz = 0;
  }
}

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
  /* The hardest contact of this pass, and the cushion it was against. A ball tucked into a
     corner can meet two runs and a jaw in one step; what it *felt* is the biggest of them. */
  let impact = 0;
  let impactNormal: Vec2 = { x: 0, y: -1 };

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
    if (-vn > impact) {
      impact = -vn;
      impactNormal = { ...n };
    }
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
    events.push({
      type: 'cushion',
      ballId: ball.id,
      pos: { ...ball.pos },
      speed: impact,
      normal: impactNormal,
    });
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
function resolvePocket(ball: Ball, events: SimEvent[], mods?: PhysicsMods): boolean {
  let pocket = pocketContaining(ball.pos);

  // Big Pockets: every mouth reads wider than it is, so a ball passing close enough across one
  // gets drawn in. Tested only when the ball isn't already going down, so it can never *stop* a
  // pot.
  if (!pocket && mods?.bigPockets) {
    for (const p of POCKETS) {
      if (mouthDepth(p, ball.pos) <= -BIG_POCKET_BONUS) continue;
      const along = Vec2.sub(ball.pos, p.mid);
      const axis = Vec2.normalize(Vec2.sub(p.b, p.a));
      if (Math.abs(Vec2.dot(along, axis)) <= p.halfWidth + BALL_RADIUS) {
        pocket = p;
        break;
      }
    }
  }

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

  // Two spheres only touch if they're within a diameter in *three* dimensions. Checking the
  // height as well is the entire mechanic of a jump shot: a ball far enough off the cloth
  // passes clean over the one blocking it instead of crashing into it.
  const dz = a.z - b.z;
  if (dist * dist + dz * dz >= minDist * minDist) return;

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
/**
 * The direction the cue ball actually leaves on, which is not the direction you aimed.
 *
 * Squirt: the tip has mass, so striking off centre shoves the ball away from the english
 * instead of sending it straight along the cue. It eases off as the cue is raised, where the
 * swerve elevation induces pulls the other way.
 *
 * Exported because the aim guide has to trace the same line the shot will take. Working it out
 * in two places is how a guide starts quietly lying about where the ball is going.
 */
export function strikeAngle(angle: number, tip: { x: number; y: number }, elevation = 0): number {
  const mag = hypot2(tip.x, tip.y);
  const tx = mag > 1 ? tip.x / mag : tip.x;
  const lift = Math.max(0, Math.min(MAX_ELEVATION, elevation));
  return angle + SQUIRT_MAX * tx * Math.cos(lift);
}

export function applyCueStrike(
  cue: Ball,
  angle: number,
  power: number,
  tip: { x: number; y: number } = { x: 0, y: 0 },
  rng: () => number = Math.random,
  elevation = 0
): StrikeResult {
  let speed = MIN_SHOT_SPEED + Math.max(0, Math.min(1, power)) * (MAX_SHOT_SPEED - MIN_SHOT_SPEED);
  const lift = Math.max(0, Math.min(MAX_ELEVATION, elevation));

  let tx = tip.x;
  let ty = tip.y;
  const mag = hypot2(tx, ty);
  if (mag > 1) {
    tx /= mag;
    ty /= mag;
  }

  const dir = Vec2.fromAngle(strikeAngle(angle, { x: tx, y: ty }, lift));

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

  // The cue points forwards and *downwards*. Only the horizontal part drives the ball along
  // the cloth; the downward part is pressed into the table, and the cloth throwing it back is
  // what a jump shot actually is.
  const along = Math.cos(lift);
  const down = Math.sin(lift);
  cue.vel = Vec2.scale(dir, speed * along);
  cue.vz = speed * down * CLOTH_REBOUND;
  cue.z = 0;

  /**
   * Spin from an off-centre strike, with the cue raised.
   *
   * `Δω = (r × J)/I` as before, but now `r` lies in the plane perpendicular to the *cue*, not
   * to the table. Writing `s` for the side direction and `u = s × ĉ` for the cue-plane "down"
   * direction, `r × ĉ = a·u − b·s`, which expands to the three lines below.
   *
   * The `-a·sin(lift)` terms are the whole point: they put a component of the spin axis
   * *along the direction of travel*. A ball spinning about the way it is going drags its
   * contact patch sideways, so the cloth pushes it sideways — and it curves. That is a massé,
   * and it emerges from the same friction model as everything else rather than being drawn on
   * top. It is also why level-cue english cannot curve a ball, which is why the old hand-rolled
   * swerve constant had to go.
   */
  const k = (5 * speed) / (2 * BALL_RADIUS);
  cue.angVel = {
    x: k * (-offsetX * dir.x * down - offsetY * dir.y),
    y: k * (-offsetX * dir.y * down + offsetY * dir.x),
    z: k * offsetX * along,
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
export function stepSimulation(balls: Ball[], dt: number, opts?: SimOptions): StepResult {
  const events: SimEvent[] = [];
  const mods = opts?.mods;
  const orbs = opts?.orbs;
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

    // Orbs are collected when the *cue* ball rolls over them — an object ball clipping one on its
    // way to a pocket would be luck rather than a decision, and the whole appeal is choosing to
    // route the cue ball through one.
    if (orbs) {
      const cue = active.find((b) => b.id === CUE_BALL_ID);
      if (cue && !isAirborne(cue)) {
        for (const orb of orbsUnder(orbs, cue.pos)) {
          orb.taken = true;
          events.push({ type: 'orb', power: orb.power, orbId: orb.id, pos: { ...orb.pos } });
        }
      }
    }

    const before = events.length;
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        resolveBallCollision(active[i], active[j], events);
      }
    }

    // Bomb: the cue ball's first contact detonates, throwing every ball nearby outward. Spent on
    // the spot, so it can only ever go off once per shot.
    if (mods?.bomb) {
      for (let k = before; k < events.length; k++) {
        const ev = events[k];
        if (ev.type !== 'ballCollision' || (ev.a !== CUE_BALL_ID && ev.b !== CUE_BALL_ID)) continue;
        detonate(active, ev.pos);
        mods.bomb = false;
        events.push({ type: 'bomb', pos: { ...ev.pos } });
        break;
      }
    }

    for (const ball of active) {
      if (isAirborne(ball) || ball.vz !== 0) {
        applyFlight(ball, h);
        if (isAirborne(ball)) {
          // In the air it can't be potted and the cloth can't touch it. Cushions stay solid
          // at every height on purpose: a ball that could fly off the table would need rules
          // for where it lands and how it comes back, and the point of a jump shot — clearing
          // an obstructing *ball* — works perfectly well without opening that door.
          resolveCushions(ball, events);
          continue;
        }
        events.push({ type: 'land', ballId: ball.id, pos: { ...ball.pos } });
      }
      if (resolvePocket(ball, events, mods)) continue;
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

/**
 * Throws every object ball near `at` outward, harder the closer it is.
 *
 * Linear falloff and no randomness: the blast has to replay identically on every device, and a
 * predictable shape is also what lets a player aim a bomb at a cluster on purpose.
 */
function detonate(balls: Ball[], at: Vec2): void {
  for (const ball of balls) {
    if (ball.id === CUE_BALL_ID || ball.pocketed) continue;
    const delta = Vec2.sub(ball.pos, at);
    const dist = Vec2.length(delta);
    if (dist >= BOMB_RADIUS || dist < 1e-6) continue;
    const push = BOMB_SPEED * (1 - dist / BOMB_RADIUS);
    ball.vel = Vec2.add(ball.vel, Vec2.scale(delta, push / dist));
  }
}

/**
 * The fixed step every device replays a shot at.
 *
 * `stepSimulation` is only deterministic for an identical sequence of `dt`s, so the host and
 * every client step shots in exactly these increments, whatever their display is doing.
 */
export const SHOT_STEP = 1 / 120;

/** A shot still moving after this long is stopped where it is — a guard against runaways. */
export const MAX_SHOT_STEPS = 120 * 25;

/** Deep copy of a ball list, so a simulation can run without touching the original. */
export function cloneBalls(balls: readonly Ball[]): Ball[] {
  return balls.map((b) => ({
    ...b,
    pos: { ...b.pos },
    vel: { ...b.vel },
    angVel: { ...b.angVel },
  }));
}

export interface ShotRun {
  /** Every event the shot produced, in order. */
  events: SimEvent[];
  /** How many `SHOT_STEP`s it took to come to rest (or hit the cap). */
  steps: number;
}

/**
 * Plays a shot that has already been struck all the way to rest, mutating `balls`.
 *
 * This is the one routine both the host (to referee) and every client (to animate) run, which is
 * the whole contract that keeps a room in agreement: same balls in, same steps, same balls out.
 */
export function runShot(balls: Ball[], opts?: SimOptions, maxSteps = MAX_SHOT_STEPS): ShotRun {
  const events: SimEvent[] = [];
  let steps = 0;
  while (steps < maxSteps) {
    const res = stepSimulation(balls, SHOT_STEP, opts);
    steps++;
    for (const ev of res.events) events.push(ev);
    if (res.settled) return { events, steps };
  }
  // Out of time: freeze everything where it stands.
  for (const b of balls) if (!b.pocketed) stop(b);
  events.push({ type: 'shotSettled' });
  return { events, steps };
}

/** The cue ball's state straight after the strike — everything a replay needs to reproduce it. */
export interface StrikeState {
  vel: Vec2;
  angVel: Vec3;
  vz: number;
  miscued: boolean;
}

/** Reads the cue ball's post-strike state off the ball it was applied to. */
export function readStrike(cue: Ball, miscued: boolean): StrikeState {
  return { vel: { ...cue.vel }, angVel: { ...cue.angVel }, vz: cue.vz, miscued };
}

/** Puts a recorded strike back onto the cue ball, ready to replay. */
export function applyStrikeState(cue: Ball, strike: StrikeState): void {
  cue.vel = { ...strike.vel };
  cue.angVel = { ...strike.angVel };
  cue.vz = strike.vz;
  cue.z = 0;
}

/** Re-exported so callers can zero a ball without knowing the shape of its angular state. */
export function restBall(ball: Ball): void {
  stop(ball);
}

export type { Vec3 };
