import { Vec2 } from './vector.js';
import type { Ball, TrajectoryPreview, TrajectorySegment } from './types.js';
import {
  BALL_RADIUS,
  FRICTION_DECEL,
  MAX_SHOT_SPEED,
  MIN_SHOT_SPEED,
  POCKETS,
  SPIN_V_DECAY_PER_UNIT,
  SPIN_V_TRANSFER,
  TABLE_LENGTH,
  TABLE_WIDTH,
} from './constants.js';

const MAX_BOUNCES_FULL = 2;
const MAX_PREVIEW_LENGTH = 3000;
const OBJECT_BALL_PREVIEW_LENGTH = 500;

interface RayHit {
  t: number;
  point: Vec2;
  kind: 'ball' | 'wall';
  ball?: Ball;
  wallNormal?: Vec2;
}

function raycastWalls(origin: Vec2, dir: Vec2, maxT: number): RayHit | null {
  const r = BALL_RADIUS;
  let best: RayHit | null = null;
  const consider = (t: number, normal: Vec2) => {
    if (t > 1e-6 && t <= maxT && (!best || t < best.t)) {
      best = { t, point: Vec2.add(origin, Vec2.scale(dir, t)), kind: 'wall', wallNormal: normal };
    }
  };
  if (dir.x < 0) consider((r - origin.x) / dir.x, { x: 1, y: 0 });
  if (dir.x > 0) consider((TABLE_LENGTH - r - origin.x) / dir.x, { x: -1, y: 0 });
  if (dir.y < 0) consider((r - origin.y) / dir.y, { x: 0, y: 1 });
  if (dir.y > 0) consider((TABLE_WIDTH - r - origin.y) / dir.y, { x: 0, y: -1 });
  return best;
}

function raycastBalls(
  origin: Vec2,
  dir: Vec2,
  balls: Ball[],
  maxT: number,
  excludeId: number
): RayHit | null {
  let best: RayHit | null = null;
  const R = BALL_RADIUS * 2;
  for (const ball of balls) {
    if (ball.pocketed || ball.id === excludeId) continue;
    const oc = Vec2.sub(origin, ball.pos);
    const b = 2 * Vec2.dot(oc, dir);
    const c = Vec2.dot(oc, oc) - R * R;
    const disc = b * b - 4 * c;
    if (disc < 0) continue;
    const t = (-b - Math.sqrt(disc)) / 2;
    if (t > 1e-6 && t <= maxT && (!best || t < best.t)) {
      best = { t, point: Vec2.add(origin, Vec2.scale(dir, t)), kind: 'ball', ball };
    }
  }
  return best;
}

/**
 * Is the straight line from `from` to `to` free of other balls? Used by the aim guide's
 * cousin — the bot's shot evaluation — so both agree on what "blocked" means.
 *
 * `ignore` lists ball ids that sit at the ends of the line (the cue ball and the target).
 */
export function pathIsClear(
  balls: Ball[],
  from: Vec2,
  to: Vec2,
  ignore: number[] = []
): boolean {
  const delta = Vec2.sub(to, from);
  const distance = Vec2.length(delta);
  if (distance < 1e-6) return true;
  const dir = Vec2.scale(delta, 1 / distance);

  for (const ball of balls) {
    if (ball.pocketed || ignore.includes(ball.id)) continue;
    const oc = Vec2.sub(ball.pos, from);
    const along = Vec2.dot(oc, dir);
    if (along <= 0 || along >= distance) continue; // behind the start or past the end
    const perp = Math.abs(oc.x * dir.y - oc.y * dir.x);
    // Two balls collide when their centres pass within one diameter of each other.
    if (perp < BALL_RADIUS * 2) return false;
  }
  return true;
}

/**
 * The cue ball's path after it strikes an object ball, as a single offset vector.
 *
 * Mirrors what `resolveBallCollision` actually does rather than guessing: the cue ball keeps
 * the component of its motion perpendicular to the contact line (the tangent slide), and the
 * spin left on it after the trip is added along the original direction. Both use the same
 * decay constant as the simulation, so the guide and the shot agree.
 */
function cueBallAfterContact(
  dir: Vec2,
  objDir: Vec2,
  spin: { x: number; y: number },
  travelled: number,
  power: number
): Vec2 | null {
  // Screen-down is positive y on the pad, so below-centre (positive) is backspin.
  const spinV = -Math.max(-1, Math.min(1, spin.y));
  const remaining = spinV * Math.exp(-SPIN_V_DECAY_PER_UNIT * travelled);

  // Speed at contact, from the same launch speed and friction the simulation uses. Without
  // this the guide would draw the same line for a tap and a smash.
  const launch = MIN_SHOT_SPEED + Math.max(0, Math.min(1, power)) * (MAX_SHOT_SPEED - MIN_SHOT_SPEED);
  const contactSpeed = Math.sqrt(Math.max(0, launch * launch - 2 * FRICTION_DECEL * travelled));

  /** How far a ball travels from a given speed before friction stops it. */
  const rollOut = (speed: number): number => (speed * speed) / (2 * FRICTION_DECEL);

  // Spin becomes velocity along the shot line at contact — the same transfer the collision
  // applies — so the guide predicts the real distance rather than a made-up one.
  const spinPush = Math.sign(remaining) * rollOut(Math.abs(remaining) * SPIN_V_TRANSFER);

  // Tangent component: whatever isn't transferred along the contact normal carries on, which
  // is why a thin cut sends the cue ball sideways even with no spin at all.
  const along = Vec2.dot(dir, objDir);
  const tangent = Vec2.sub(dir, Vec2.scale(objDir, along));
  const tangentLen = Vec2.length(tangent);
  const slide = rollOut(tangentLen * contactSpeed);

  if (Math.abs(spinPush) < 4 && slide < 4) return null;

  return Vec2.add(
    Vec2.scale(dir, spinPush),
    tangentLen > 1e-6 ? Vec2.scale(Vec2.normalize(tangent), slide) : Vec2.zero()
  );
}

function nearPocket(point: Vec2): boolean {
  return POCKETS.some((p) => Vec2.distance(point, p) <= p.radius * 1.3);
}

/**
 * Traces the cue ball's straight-line path (with optional cushion bounces) to build
 * the aim-guide preview. Uses exact ray/circle and ray/wall intersection so the line
 * matches what stepSimulation will actually do for a shot fired along this angle.
 */
export function computeTrajectoryPreview(
  balls: Ball[],
  cueBallId: number,
  angle: number,
  mode: 'basic' | 'full',
  /** Cue tip offset: x is english, y is draw (positive) / follow (negative), as sent by the pad. */
  spin: { x: number; y: number } = { x: 0, y: 0 },
  /** Shot power 0..1, so the post-contact line scales with how hard you're about to hit it. */
  power = 0.5
): TrajectoryPreview {
  const cue = balls.find((b) => b.id === cueBallId);
  const path: TrajectorySegment[] = [];
  const result: TrajectoryPreview = {
    cueBallPath: path,
    ghostBallPos: null,
    firstContactBallId: null,
    objectBallPath: [],
    cueAfterPath: [],
    cueRestPos: null,
  };
  if (!cue || cue.pocketed) return result;

  let origin: Vec2 = { ...cue.pos };
  let dir = Vec2.fromAngle(angle);
  let remaining = MAX_PREVIEW_LENGTH;
  const maxBounces = mode === 'full' ? MAX_BOUNCES_FULL : 0;
  let bounces = 0;

  while (remaining > 0) {
    const wallHit = raycastWalls(origin, dir, remaining);
    const ballHit = raycastBalls(origin, dir, balls, remaining, cueBallId);

    const hit: RayHit | null =
      wallHit && ballHit ? (wallHit.t < ballHit.t ? wallHit : ballHit) : wallHit ?? ballHit;

    if (!hit) {
      path.push({ from: origin, to: Vec2.add(origin, Vec2.scale(dir, remaining)) });
      break;
    }

    path.push({ from: origin, to: hit.point });

    if (hit.kind === 'ball' && hit.ball) {
      result.ghostBallPos = hit.point;
      result.firstContactBallId = hit.ball.id;
      if (mode === 'full') {
        const objDir = Vec2.normalize(Vec2.sub(hit.ball.pos, hit.point));
        result.objectBallPath.push({
          from: hit.ball.pos,
          to: Vec2.add(hit.ball.pos, Vec2.scale(objDir, OBJECT_BALL_PREVIEW_LENGTH)),
        });

        // Where the cue ball goes after contact. On a full-ball hit it's driven purely by the
        // spin; on a cut it also slides off along the tangent, which is the "natural" path a
        // stun shot takes.
        const travelled = Vec2.distance(cue.pos, hit.point);
        const after = cueBallAfterContact(dir, objDir, spin, travelled, power);
        if (after) {
          result.cueAfterPath.push({ from: hit.point, to: Vec2.add(hit.point, after) });
          result.cueRestPos = Vec2.add(hit.point, after);
        }
      }
      break;
    }

    if (nearPocket(hit.point) || bounces >= maxBounces) break;

    remaining -= hit.t;
    origin = hit.point;
    dir = Vec2.reflect(dir, hit.wallNormal!);
    bounces++;
  }

  return result;
}
