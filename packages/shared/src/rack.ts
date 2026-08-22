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

function newBall(id: number, x: number, y: number): Ball {
  return { id, kind: kindOf(id), pos: { x, y }, vel: { x: 0, y: 0 }, spin: 0, pocketed: false };
}

function cueBall(): Ball {
  return newBall(CUE_BALL_ID, TABLE_LENGTH * 0.22, TABLE_WIDTH / 2);
}

/**
 * Nine-ball diamond: 1 at the apex, 9 dead centre, the rest arranged around them. Balls
 * 10-15 simply aren't racked, so they read as pocketed everywhere else in the engine.
 */
export function rackNineBall(): Ball[] {
  const apexX = TABLE_LENGTH * 0.72;
  const apexY = TABLE_WIDTH / 2;
  // Diamond rows: 1 / 2 / 3 (centre is the 9) / 2 / 1.
  const rows: number[][] = [[1], [2, 3], [4, 9, 5], [6, 7], [8]];

  const balls: Ball[] = [];
  rows.forEach((row, r) => {
    row.forEach((id, k) => {
      balls.push(
        newBall(id, apexX + r * ROW_SPACING, apexY + (k - (row.length - 1) / 2) * BALL_DIAMETER)
      );
    });
  });
  balls.push(cueBall());
  return balls;
}

/**
 * Balls spread across the table instead of racked. Killer is played on an open table — from
 * a tight triangle nobody can pot on their first few visits, and with lives on the line the
 * frame is over before the balls ever break up.
 *
 * Deterministic jitter from a seeded generator so a frame is reproducible in tests.
 */
export function rackScattered(seed = 1): Ball[] {
  let s = seed >>> 0;
  const rand = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };

  const balls: Ball[] = [];
  const margin = BALL_DIAMETER * 1.6;
  const ids = Array.from({ length: 15 }, (_, i) => i + 1);

  for (const id of ids) {
    // Rejection-sample until the ball isn't touching one already placed.
    let pos = { x: 0, y: 0 };
    for (let attempt = 0; attempt < 200; attempt++) {
      pos = {
        x: margin + rand() * (TABLE_LENGTH - margin * 2),
        y: margin + rand() * (TABLE_WIDTH - margin * 2),
      };
      const clash = balls.some(
        (b) => Math.hypot(b.pos.x - pos.x, b.pos.y - pos.y) < BALL_DIAMETER * 1.9
      );
      if (!clash) break;
    }
    balls.push(newBall(id, pos.x, pos.y));
  }

  balls.push(cueBall());
  return balls;
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
