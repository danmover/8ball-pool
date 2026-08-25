import type { Ball, BallKind } from './types.js';

/**
 * One place where a ball is built.
 *
 * `Ball` is serialised over the wire, stored in challenge layouts and produced by three
 * different rack builders, so when its shape changed — from two ad-hoc spin scalars to a real
 * angular velocity — every one of those was a place to get it wrong. Now they all come here.
 */
export function createBall(id: number, kind: BallKind, x: number, y: number): Ball {
  return {
    id,
    kind,
    pos: { x, y },
    vel: { x: 0, y: 0 },
    angVel: { x: 0, y: 0, z: 0 },
    pocketed: false,
  };
}
