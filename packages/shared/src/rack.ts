import type { Ball, BallKind } from './types.js';
import { BALL_DIAMETER, CUE_BALL_ID, TABLE_LENGTH, TABLE_WIDTH } from './constants.js';

const ROW_SPACING = BALL_DIAMETER * 0.866; // sqrt(3)/2, tight triangular packing

// Apex = ball 1, dead-center of the 3rd row = the 8-ball, and the two back-row
// corners are one solid + one stripe, matching standard rack rules.
const RACK_ROWS: number[][] = [
  [1],
  [10, 3],
  [4, 8, 11],
  [12, 5, 13, 6],
  [2, 14, 15, 7, 9],
];

function kindOf(id: number): BallKind {
  if (id === 0) return 'cue';
  if (id === 8) return 'eight';
  return id < 8 ? 'solid' : 'stripe';
}

export function rackBalls(): Ball[] {
  const balls: Ball[] = [];
  const apexX = TABLE_LENGTH * 0.72;
  const apexY = TABLE_WIDTH / 2;

  RACK_ROWS.forEach((row, r) => {
    row.forEach((id, k) => {
      balls.push({
        id,
        kind: kindOf(id),
        pos: {
          x: apexX + r * ROW_SPACING,
          y: apexY + (k - r / 2) * BALL_DIAMETER,
        },
        vel: { x: 0, y: 0 },
        spin: 0,
        pocketed: false,
      });
    });
  });

  balls.push({
    id: CUE_BALL_ID,
    kind: 'cue',
    pos: { x: TABLE_LENGTH * 0.22, y: TABLE_WIDTH / 2 },
    vel: { x: 0, y: 0 },
    spin: 0,
    pocketed: false,
  });

  return balls;
}
