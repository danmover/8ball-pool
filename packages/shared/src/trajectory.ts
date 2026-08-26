import { Vec2 } from './vector.js';
import type { Ball, TrajectoryPreview, TrajectorySegment } from './types.js';
import { CUSHIONS, JAWS, inPocketApproach } from './table.js';
import { applyCueStrike, stepSimulation } from './physics.js';
import { BALL_RADIUS } from './constants.js';

const MAX_BOUNCES_FULL = 2;
const MAX_PREVIEW_LENGTH = 3000;

interface RayHit {
  t: number;
  point: Vec2;
  kind: 'ball' | 'wall';
  ball?: Ball;
  wallNormal?: Vec2;
}

/**
 * Where the ball would first meet a cushion or a pocket jaw.
 *
 * Built on the same `CUSHIONS` runs and `JAWS` circles the simulation uses, so the guide can no
 * longer promise a rebound at a pocket mouth — there is no cushion there to rebound off, and
 * drawing one was half of why shots "looked like they should go in".
 */
function raycastWalls(origin: Vec2, dir: Vec2, maxT: number): RayHit | null {
  const r = BALL_RADIUS;
  let best: RayHit | null = null;
  const consider = (t: number, normal: Vec2) => {
    if (t > 1e-6 && t <= maxT && (!best || t < best.t)) {
      best = { t, point: Vec2.add(origin, Vec2.scale(dir, t)), kind: 'wall', wallNormal: normal };
    }
  };

  for (const c of CUSHIONS) {
    // The ball's centre travels along a line offset one radius in from the nose.
    const line = c.base - c.side * r;
    const comp = c.axis === 'h' ? dir.y : dir.x;
    if (c.side < 0 ? comp >= 0 : comp <= 0) continue; // travelling away from this run
    const t = (line - (c.axis === 'h' ? origin.y : origin.x)) / comp;
    if (t <= 1e-6 || t > maxT) continue;
    const hit = Vec2.add(origin, Vec2.scale(dir, t));
    const along = c.axis === 'h' ? hit.x : hit.y;
    if (along < c.from || along > c.to) continue; // past the end of the run — that's a pocket
    const n = c.axis === 'h' ? { x: 0, y: -c.side } : { x: -c.side, y: 0 };
    consider(t, n);
  }

  for (const jaw of JAWS) {
    const R = r + jaw.radius;
    const oc = Vec2.sub(origin, jaw.pos);
    const b = 2 * Vec2.dot(oc, dir);
    const cc = Vec2.dot(oc, oc) - R * R;
    const disc = b * b - 4 * cc;
    if (disc < 0) continue;
    const t = (-b - Math.sqrt(disc)) / 2;
    if (t <= 1e-6 || t > maxT) continue;
    const point = Vec2.add(origin, Vec2.scale(dir, t));
    consider(t, Vec2.normalize(Vec2.sub(point, jaw.pos)));
  }

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

/** How long a shot the preview is willing to play out, in simulated seconds. */
const PREVIEW_SECONDS = 2.4;
/** Sampling interval for the previewed paths. Fine enough to draw a smooth curve. */
const PREVIEW_SAMPLE_DT = 1 / 60;
/** Don't bother drawing a post-contact line shorter than this. */
const MIN_PREVIEW_TRAVEL = 4;

interface SimulatedPaths {
  cueAfter: Vec2[];
  objectBall: Vec2[];
  cueRest: Vec2 | null;
}

/**
 * Plays the shot out with the real engine and reports where the balls actually go.
 *
 * The guide used to *approximate* the collision with its own formula, which meant there were
 * two models of the same event and they could disagree — and they did, most visibly on draw
 * shots. Running the genuine simulation on a throwaway copy of the table makes that class of
 * bug impossible: whatever the guide draws is, by construction, what the shot will do.
 *
 * It is affordable because previews are recomputed when the aim changes, not every frame, and
 * because the run is capped at a couple of simulated seconds — by which point the interesting
 * part of any shot is long over.
 */
function simulatePaths(
  balls: Ball[],
  cueBallId: number,
  angle: number,
  power: number,
  tip: { x: number; y: number }
): SimulatedPaths {
  const clone: Ball[] = balls.map((b) => ({
    ...b,
    pos: { ...b.pos },
    vel: { ...b.vel },
    angVel: { ...b.angVel },
  }));
  const cue = clone.find((b) => b.id === cueBallId);
  const out: SimulatedPaths = { cueAfter: [], objectBall: [], cueRest: null };
  if (!cue) return out;

  // Never miscue in the preview: the guide's job is to show what the shot does *if it comes
  // off*, and a line that changed on every redraw would be worse than no line. The risk is
  // communicated by the pad's danger band instead.
  applyCueStrike(cue, angle, power, tip, () => 1);

  let struck: Ball | null = null;
  let elapsed = 0;

  while (elapsed < PREVIEW_SECONDS) {
    const { events, settled } = stepSimulation(clone, PREVIEW_SAMPLE_DT);
    elapsed += PREVIEW_SAMPLE_DT;

    if (!struck) {
      // The first thing the cue ball touches is the shot; everything after is consequences.
      const first = events.find((e) => e.type === 'ballCollision' && (e.a === cueBallId || e.b === cueBallId));
      if (first && first.type === 'ballCollision') {
        const otherId = first.a === cueBallId ? first.b : first.a;
        struck = clone.find((b) => b.id === otherId) ?? null;
      }
    }

    if (struck) {
      if (!cue.pocketed) out.cueAfter.push({ ...cue.pos });
      if (!struck.pocketed) out.objectBall.push({ ...struck.pos });
    }
    if (settled) break;
  }

  out.cueRest = cue.pocketed ? null : { ...cue.pos };
  return out;
}

/** Turns sampled positions into drawable segments, dropping runs too short to be worth it. */
function toSegments(points: Vec2[], from: Vec2): TrajectorySegment[] {
  const segments: TrajectorySegment[] = [];
  let prev = from;
  for (const p of points) {
    if (Vec2.distance(prev, p) < 2) continue; // skip near-duplicates while the ball crawls
    segments.push({ from: prev, to: p });
    prev = p;
  }
  return segments.length && Vec2.distance(from, prev) >= MIN_PREVIEW_TRAVEL ? segments : [];
}

function nearPocket(point: Vec2): boolean {
  return inPocketApproach(point);
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
        // Both onward paths come from actually playing the shot, cushions, spin and all.
        const paths = simulatePaths(balls, cueBallId, angle, power, spin);
        result.objectBallPath = toSegments(paths.objectBall, hit.ball.pos);
        result.cueAfterPath = toSegments(paths.cueAfter, hit.point);
        result.cueRestPos = paths.cueRest;
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
