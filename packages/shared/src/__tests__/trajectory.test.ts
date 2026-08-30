import { describe, expect, it } from 'vitest';
import {
  BALL_RADIUS,
  applyCueStrike,
  computeTrajectoryPreview,
  pathIsClear,
  stepSimulation,
  CURVE_ELEVATION,
  CURVE_MIN_SIDE,
  JUMP_ELEVATION,
} from '../index.js';
import type { Ball } from '../types.js';

/** Forces `applyCueStrike` never to miscue, so these tests measure mechanics, not dice. */
const NO_MISCUE = (): number => 1;

function ball(id: number, x: number, y: number): Ball {
  return { id, kind: 'solid', pos: { x, y }, vel: { x: 0, y: 0 }, angVel: { x: 0, y: 0, z: 0 }, z: 0, vz: 0, pocketed: false };
}

describe('pathIsClear', () => {
  it('sees an empty line as clear', () => {
    expect(pathIsClear([ball(1, 500, 900)], { x: 100, y: 100 }, { x: 900, y: 100 })).toBe(true);
  });

  it('reports a ball sitting on the line as blocking', () => {
    expect(pathIsClear([ball(1, 500, 100)], { x: 100, y: 100 }, { x: 900, y: 100 })).toBe(false);
  });

  it('counts a near miss inside one diameter as blocking', () => {
    const grazing = ball(1, 500, 100 + BALL_RADIUS * 1.5);
    expect(pathIsClear([grazing], { x: 100, y: 100 }, { x: 900, y: 100 })).toBe(false);
  });

  it('ignores balls at the ends of the line', () => {
    const target = ball(7, 900, 100);
    expect(pathIsClear([target], { x: 100, y: 100 }, { x: 900, y: 100 }, [7])).toBe(true);
  });

  it('ignores balls behind the start or past the end', () => {
    const behind = ball(1, 0, 100);
    const beyond = ball(2, 1400, 100);
    expect(pathIsClear([behind, beyond], { x: 100, y: 100 }, { x: 900, y: 100 })).toBe(true);
  });

  it('ignores pocketed balls', () => {
    const down = { ...ball(1, 500, 100), pocketed: true };
    expect(pathIsClear([down], { x: 100, y: 100 }, { x: 900, y: 100 })).toBe(true);
  });
});

describe('cue ball preview', () => {
  function cueBall(x: number, y: number): Ball {
    return { id: 0, kind: 'cue', pos: { x, y }, vel: { x: 0, y: 0 }, angVel: { x: 0, y: 0, z: 0 }, z: 0, vz: 0, pocketed: false };
  }
  function objectBall(x: number, y: number): Ball {
    return { id: 1, kind: 'solid', pos: { x, y }, vel: { x: 0, y: 0 }, angVel: { x: 0, y: 0, z: 0 }, z: 0, vz: 0, pocketed: false };
  }

  it('predicts the cue ball moving backwards with draw and forwards with follow', () => {
    const balls = [cueBall(400, 500), objectBall(800, 500)];
    const draw = computeTrajectoryPreview(balls, 0, 0, 'full', { x: 0, y: 1 }, 0.5);
    const follow = computeTrajectoryPreview(balls, 0, 0, 'full', { x: 0, y: -1 }, 0.5);

    expect(draw.cueRestPos!.x).toBeLessThan(draw.ghostBallPos!.x);
    expect(follow.cueRestPos!.x).toBeGreaterThan(follow.ghostBallPos!.x);
  });

  it('agrees with the simulation about where a draw shot leaves the cue ball', () => {
    // The guide has to be honest or it teaches the wrong thing. Same shot through both.
    const power = 0.35;
    const spin = { x: 0, y: 1 };
    const preview = computeTrajectoryPreview(
      [cueBall(400, 500), objectBall(900, 500)],
      0,
      0,
      'full',
      spin,
      power
    );

    const cue = cueBall(400, 500);
    applyCueStrike(cue, 0, power, spin, NO_MISCUE);
    const balls = [cue, objectBall(900, 500)];
    for (let i = 0; i < 900 && !stepSimulation(balls, 1 / 60).settled; i++);

    // The guide plays the shot out with the real engine now, so these should agree to within
    // the little the preview's time cap can miss — not to within "the same half of the table",
    // which is all the old approximation could promise.
    expect(Math.abs(cue.pos.x - preview.cueRestPos!.x)).toBeLessThan(BALL_RADIUS);
  });

  it('sends the cue ball off sideways on a thin cut even with no spin', () => {
    // Object ball offset from the shot line, so the contact is a cut rather than full-ball.
    const balls = [cueBall(400, 500), objectBall(800, 500 + BALL_RADIUS * 1.6)];
    const preview = computeTrajectoryPreview(balls, 0, 0, 'full', { x: 0, y: 0 }, 0.6);
    expect(preview.cueRestPos).not.toBeNull();
    expect(Math.abs(preview.cueRestPos!.y - 500)).toBeGreaterThan(10);
  });

  it('leaves no cue-ball prediction when the shot never contacts a ball', () => {
    const preview = computeTrajectoryPreview([cueBall(400, 500)], 0, 0, 'full', { x: 0, y: 1 }, 0.5);
    expect(preview.cueRestPos).toBeNull();
    expect(preview.firstContactBallId).toBeNull();
  });
});

/**
 * An elevated cue is the one case where the old guide was confidently wrong: it ray-cast a
 * straight line, so it drew a jump shot stopping dead at the ball it was about to fly over,
 * and a swerve as a line that does not swerve. These pin the fix — the guide simulates the
 * shot rather than approximating it, so what it draws is what happens.
 */
describe('the guide for a raised cue', () => {
  const CUE = 0;
  /** Cue ball on the left, a blocker directly in front of it, a target further on. */
  function snookered(): Ball[] {
    return [
      { ...ball(CUE, 300, 400), kind: 'cue' },
      ball(1, 300 + BALL_RADIUS * 4, 400),
      ball(2, 900, 400),
    ];
  }

  it('stops at the blocker when the cue is level', () => {
    const preview = computeTrajectoryPreview(snookered(), CUE, 0, 'full', { x: 0, y: 0 }, 0.8, 0);
    expect(preview.firstContactBallId).toBe(1);
    expect(preview.cueBallPath.some((s) => s.airborne)).toBe(false);
    expect(preview.landingPos ?? null).toBeNull();
  });

  it('leaves the cloth for a jump, and says where it lands', () => {
    const preview = computeTrajectoryPreview(
      snookered(), CUE, 0, 'full', { x: 0, y: 0 }, 0.9, JUMP_ELEVATION
    );
    expect(preview.cueBallPath.some((s) => s.airborne)).toBe(true);
    expect(preview.landingPos).not.toBeNull();
    // The whole point: it comes down past the ball it was blocked by, not on it.
    expect(preview.landingPos!.x).toBeGreaterThan(300 + BALL_RADIUS * 4);
  });

  it('carries the line past the blocker rather than ending at it', () => {
    const jumped = computeTrajectoryPreview(
      snookered(), CUE, 0, 'full', { x: 0, y: 0 }, 0.9, JUMP_ELEVATION
    );
    const furthest = Math.max(...jumped.cueBallPath.map((s) => s.to.x));
    expect(furthest).toBeGreaterThan(300 + BALL_RADIUS * 6);
  });

  it('bends a swerve off the line it was aimed along', () => {
    // Side spin plus elevation is what a curve *is*; with a centred tip there is nothing to bend.
    const balls: Ball[] = [{ ...ball(CUE, 200, 400), kind: 'cue' }];
    const curved = computeTrajectoryPreview(
      balls, CUE, 0, 'full', { x: CURVE_MIN_SIDE, y: 0 }, 0.7, CURVE_ELEVATION
    );
    const drift = Math.max(...curved.cueBallPath.map((s) => Math.abs(s.to.y - 400)));
    expect(drift).toBeGreaterThan(BALL_RADIUS);
  });

  it('leaves a nearly level cue on the fast ray-cast path', () => {
    const preview = computeTrajectoryPreview(snookered(), CUE, 0, 'full', { x: 0, y: 0 }, 0.8, 0.05);
    expect(preview.firstContactBallId).toBe(1);
    expect(preview.cueBallPath.some((s) => s.airborne)).toBe(false);
  });
});
