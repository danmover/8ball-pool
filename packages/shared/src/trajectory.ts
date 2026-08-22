import { Vec2 } from './vector.js';
import type { Ball, TrajectoryPreview, TrajectorySegment } from './types.js';
import { BALL_RADIUS, POCKETS, TABLE_LENGTH, TABLE_WIDTH } from './constants.js';

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
  mode: 'basic' | 'full'
): TrajectoryPreview {
  const cue = balls.find((b) => b.id === cueBallId);
  const path: TrajectorySegment[] = [];
  const result: TrajectoryPreview = {
    cueBallPath: path,
    ghostBallPos: null,
    firstContactBallId: null,
    objectBallPath: [],
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
