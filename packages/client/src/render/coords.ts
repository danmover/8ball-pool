import { BALL_RADIUS, TABLE_LENGTH, TABLE_WIDTH } from '@8ball/shared';

/**
 * Table units to world units.
 *
 * The physics measures a 2000 × 1000 table; the scene is 2 × 1 metres-ish, centred on the
 * origin, with Y up. Table x runs along world X and table y along world Z.
 */
export const S = 1 / 1000;
export const R = BALL_RADIUS * S;
export const HALF_L = (TABLE_LENGTH * S) / 2;
export const HALF_W = (TABLE_WIDTH * S) / 2;

/** Cushion depth (nose to rail), rail width, heights. */
export const CUSHION_DEPTH = 0.042;
export const RAIL_WIDTH = 0.105;
export const CUSHION_HEIGHT = 0.036;
export const RAIL_HEIGHT = 0.038;

export function toWorldX(x: number): number {
  return x * S - HALF_L;
}

export function toWorldZ(y: number): number {
  return y * S - HALF_W;
}

export function toTableX(wx: number): number {
  return (wx + HALF_L) / S;
}

export function toTableY(wz: number): number {
  return (wz + HALF_W) / S;
}
