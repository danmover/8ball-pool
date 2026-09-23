import type { Ball, Vec2 } from './index.js';
import { createBall } from './ball.js';
import { BALL_RADIUS, TABLE_LENGTH, TABLE_WIDTH } from './constants.js';
import { POCKETS } from './table.js';

/**
 * Hand-built trick-shot layouts.
 *
 * These exist mostly to teach cue ball control: the early sets walk through stun, follow and
 * draw in turn, and the later ones only go in if you can place the cue ball afterwards. Each
 * is a fixed table, an objective, and a shot budget you're rated against.
 */

/** A circle on the cloth the cue ball has to finish inside. */
export interface Zone {
  x: number;
  y: number;
  r: number;
}

export type ChallengeGoal =
  /** Pot `count` balls on a single shot. */
  | { kind: 'potInOne'; count: number }
  /** Pot the named ball, hitting it first. */
  | { kind: 'cleanPot'; ballId: number }
  /** Pot the named ball and leave the cue ball inside `zone`. */
  | { kind: 'position'; ballId: number; zone: Zone }
  /** Pot the named ball after the cue ball has come off at least `cushions` rails. */
  | { kind: 'kick'; ballId: number; cushions: number }
  /** Pot the named ball off a rail. */
  | { kind: 'bank'; ballId: number }
  /** Pot `ballId` by hitting `via` into it. */
  | { kind: 'combo'; ballId: number; via: number }
  /** Pot the named ball with the cue ball in the air on the way. */
  | { kind: 'jump'; ballId: number }
  /** Pot the listed balls in exactly this order. */
  | { kind: 'potOrder'; order: number[] }
  /** Clear every object ball. */
  | { kind: 'clearTable' };

export interface Challenge {
  id: string;
  set: string;
  name: string;
  brief: string;
  /** A nudge toward the technique the layout is built around. */
  hint: string;
  goal: ChallengeGoal;
  /** Shots allowed before it's a fail. */
  shotLimit: number;
  /** Shots used at or under these counts earn 3 and 2 stars; anything else that meets the goal earns 1. */
  stars: { three: number; two: number };
  /** Object ball positions, in table units. The cue ball is placed separately. */
  balls: { id: number; pos: Vec2 }[];
  cue: Vec2;
  reward: { xp: number; coins: number };
}

const MID_Y = TABLE_WIDTH / 2;
const D = BALL_RADIUS * 2;

/** Shorthand so the layouts below stay readable. */
function at(id: number, x: number, y: number): { id: number; pos: Vec2 } {
  return { id, pos: { x, y } };
}

/**
 * The point `dist` behind (x, y) on the line from a pocket through it — where the cue ball sits
 * for a dead-straight pot. `sqrt` rather than `hypot` so every engine agrees to the last bit.
 */
function behind(x: number, y: number, pocket: number, dist: number): Vec2 {
  const m = POCKETS[pocket].mid;
  const dx = x - m.x;
  const dy = y - m.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  return { x: x + (dx / len) * dist, y: y + (dy / len) * dist };
}

/** A ball `t` of the way from `a` to `b`, pushed `side` units off that line to the left. */
function along(id: number, a: Vec2, b: Vec2, t: number, side = 0): { id: number; pos: Vec2 } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  return at(id, a.x + dx * t + (dy / len) * side, a.y + dy * t - (dx / len) * side);
}

// Pockets, for reading the layouts: 0 top-left, 1 top side, 2 top-right, 3 bottom-left,
// 4 bottom side, 5 bottom-right. "Top" is y = 0.

const STRAIGHT_1 = { x: 1480, y: 690 };
const STOP_2 = { x: 1560, y: 330 };
const DRAW_6 = { x: 1450, y: 300 };
const JUMP_7 = { x: 1560, y: 700 };
const JUMP_CUE = behind(JUMP_7.x, JUMP_7.y, 5, 620);
const WALL_9 = { x: 1640, y: 330 };
const WALL_CUE = behind(WALL_9.x, WALL_9.y, 2, 700);
const PLANT_6 = { x: 1790, y: 190 };
const PLANT_5 = behind(PLANT_6.x, PLANT_6.y, 2, D + 4);

export const CHALLENGES: Challenge[] = [
  // ---- Set 1: aim ----
  {
    id: 'ch.straight',
    set: 'First Principles',
    name: 'Dead Straight',
    brief: 'Pot the 1 in the bottom-right corner.',
    hint: 'Centre ball, smooth stroke. Cue ball, object ball and pocket are already in line.',
    goal: { kind: 'cleanPot', ballId: 1 },
    shotLimit: 3,
    stars: { three: 1, two: 2 },
    balls: [at(1, STRAIGHT_1.x, STRAIGHT_1.y)],
    cue: behind(STRAIGHT_1.x, STRAIGHT_1.y, 5, 560),
    reward: { xp: 60, coins: 25 },
  },
  {
    id: 'ch.cut',
    set: 'First Principles',
    name: 'Half-Ball Cut',
    brief: 'Cut the 3 into the bottom side pocket.',
    hint: 'Aim at the ghost ball — where the cue ball has to be at contact, not at the 3 itself.',
    goal: { kind: 'cleanPot', ballId: 3 },
    shotLimit: 4,
    stars: { three: 1, two: 2 },
    balls: [at(3, 1160, 830)],
    cue: { x: 1620, y: 700 },
    reward: { xp: 70, coins: 30 },
  },
  {
    id: 'ch.stop',
    set: 'First Principles',
    name: 'Stop Shot',
    brief: 'Pot the 2 and stop the cue ball in the ring.',
    hint: 'Hit firmly, dead centre or a touch below. The cue ball hands all its pace to the 2 and stops dead.',
    goal: { kind: 'position', ballId: 2, zone: { ...behind(STOP_2.x, STOP_2.y, 2, D), r: 60 } },
    shotLimit: 4,
    stars: { three: 1, two: 2 },
    balls: [at(2, STOP_2.x, STOP_2.y)],
    cue: behind(STOP_2.x, STOP_2.y, 2, 440),
    reward: { xp: 80, coins: 35 },
  },

  // ---- Set 2: cue ball control ----
  {
    id: 'ch.follow',
    set: 'Cue Ball Control',
    name: 'Follow Through',
    brief: 'Pot the 4 and roll through into the ring.',
    hint: 'Strike above centre. Top spin keeps the cue ball driving forward after contact.',
    goal: { kind: 'position', ballId: 4, zone: { x: 1640, y: 560, r: 90 } },
    shotLimit: 4,
    stars: { three: 1, two: 2 },
    balls: [at(4, 1480, 740)],
    cue: { x: 1000, y: 380 },
    reward: { xp: 100, coins: 40 },
  },
  {
    id: 'ch.draw',
    set: 'Cue Ball Control',
    name: 'Screw Back',
    brief: 'Pot the 6 and draw the cue ball back into the ring.',
    hint: 'Strike low. Backspin grabs the cloth after contact and pulls the cue ball back the way it came.',
    goal: { kind: 'position', ballId: 6, zone: { ...behind(DRAW_6.x, DRAW_6.y, 2, 380), r: 90 } },
    shotLimit: 4,
    stars: { three: 1, two: 2 },
    balls: [at(6, DRAW_6.x, DRAW_6.y)],
    cue: behind(DRAW_6.x, DRAW_6.y, 2, 300),
    reward: { xp: 120, coins: 50 },
  },
  {
    id: 'ch.twoRail',
    set: 'Cue Ball Control',
    name: 'Two Rails Home',
    brief: 'Pot the 7 in the side and bring the cue ball round into the ring.',
    hint: 'Cut it, then let the cue ball travel. Side spin widens or narrows the angle off each rail.',
    goal: { kind: 'position', ballId: 7, zone: { x: 400, y: 700, r: 110 } },
    shotLimit: 5,
    stars: { three: 1, two: 3 },
    balls: [at(7, 880, 150)],
    cue: { x: 1300, y: 520 },
    reward: { xp: 140, coins: 60 },
  },

  // ---- Set 3: rails ----
  {
    id: 'ch.kick',
    set: 'Off the Rails',
    name: 'One-Rail Kick',
    brief: 'The 10 is hidden. Kick off a rail to pot it.',
    hint: 'Angle in equals angle out. Aim at the 10’s mirror image beyond the cushion.',
    goal: { kind: 'kick', ballId: 10, cushions: 1 },
    shotLimit: 5,
    stars: { three: 1, two: 3 },
    balls: [at(10, 1860, 880), at(11, 1500, 720), at(12, 1500, 720 + D + 2)],
    cue: { x: 1100, y: 560 },
    reward: { xp: 150, coins: 65 },
  },
  {
    id: 'ch.bank',
    set: 'Off the Rails',
    name: 'Cross-Side Bank',
    brief: 'Bank the 12 off the top rail into the bottom side pocket.',
    hint: 'Send the 12 at the mirror image of the pocket — as far beyond the rail as the pocket is in front of it.',
    goal: { kind: 'bank', ballId: 12 },
    shotLimit: 6,
    stars: { three: 1, two: 3 },
    balls: [at(12, 930, 190)],
    cue: { x: 760, y: 560 },
    reward: { xp: 170, coins: 75 },
  },
  {
    id: 'ch.kick2',
    set: 'Off the Rails',
    name: 'Two-Rail Kick',
    brief: 'Pot the 13 off two rails first.',
    hint: 'Pick the corner and trace the path back. Two rails turn you almost straight round.',
    goal: { kind: 'kick', ballId: 13, cushions: 2 },
    shotLimit: 8,
    stars: { three: 2, two: 4 },
    balls: [at(13, 110, 95), at(14, 700, 320), at(15, 700, 320 + D + 2)],
    cue: { x: 1200, y: 560 },
    reward: { xp: 200, coins: 90 },
  },

  // ---- Set 4: more than one ball ----
  {
    id: 'ch.plant',
    set: 'Combinations',
    name: 'The Plant',
    brief: 'Hit the 5 into the 6 and pot the 6.',
    hint: 'The 6 is already lined up. Pot the 5 into it as if the 6 were a pocket.',
    goal: { kind: 'combo', ballId: 6, via: 5 },
    shotLimit: 4,
    stars: { three: 1, two: 2 },
    balls: [at(6, PLANT_6.x, PLANT_6.y), at(5, PLANT_5.x, PLANT_5.y)],
    cue: { x: 1150, y: 560 },
    reward: { xp: 180, coins: 80 },
  },
  {
    id: 'ch.double',
    set: 'Combinations',
    name: 'Two at Once',
    brief: 'Pot two balls with one shot.',
    hint: 'Pot the 1 in the side and keep the cue ball rolling down the rail into the 2.',
    goal: { kind: 'potInOne', count: 2 },
    shotLimit: 5,
    stars: { three: 1, two: 3 },
    balls: [at(1, 1000, 70), at(2, 1900, 80)],
    cue: { x: 700, y: 420 },
    reward: { xp: 220, coins: 100 },
  },
  {
    id: 'ch.triple',
    set: 'Combinations',
    name: 'Three at Once',
    brief: 'Pot three balls with one shot.',
    hint: 'A tight cluster hanging over the pockets. One firm strike into the middle of it.',
    goal: { kind: 'potInOne', count: 3 },
    shotLimit: 6,
    stars: { three: 1, two: 3 },
    balls: [at(1, TABLE_LENGTH - 120, 120), at(2, TABLE_LENGTH - 170, 150), at(3, TABLE_LENGTH - 150, 210)],
    cue: { x: TABLE_LENGTH * 0.4, y: MID_Y },
    reward: { xp: 260, coins: 120 },
  },

  // ---- Set 5: in the air and round the corner ----
  {
    id: 'ch.jump',
    set: 'Air and Swerve',
    name: 'Hop Over',
    brief: 'Jump the 15 and pot the 7.',
    hint: 'Switch to a jump shot and hit it firmly — a soft jump never leaves the cloth.',
    goal: { kind: 'jump', ballId: 7 },
    shotLimit: 5,
    stars: { three: 1, two: 3 },
    balls: [at(7, JUMP_7.x, JUMP_7.y), along(15, JUMP_CUE, JUMP_7, 0.3)],
    cue: JUMP_CUE,
    reward: { xp: 220, coins: 100 },
  },
  {
    id: 'ch.swerve',
    set: 'Air and Swerve',
    name: 'Bend It',
    brief: 'Curve the cue ball round the 14 and pot the 8.',
    hint: 'Switch to a swerve and add side spin: the cue ball starts straight, then bends toward the side you hit.',
    goal: { kind: 'cleanPot', ballId: 8 },
    shotLimit: 6,
    stars: { three: 1, two: 3 },
    balls: [at(8, 1700, 260), at(14, 1250, 420)],
    cue: { x: 850, y: 560 },
    reward: { xp: 260, coins: 120 },
  },
  {
    id: 'ch.wall',
    set: 'Air and Swerve',
    name: 'Over the Wall',
    brief: 'Three balls stand in the way. Get over them and pot the 9.',
    hint: 'Jump from close to the wall — the ball is at its highest just after it leaves the cloth.',
    goal: { kind: 'jump', ballId: 9 },
    shotLimit: 6,
    stars: { three: 1, two: 3 },
    balls: [
      at(9, WALL_9.x, WALL_9.y),
      along(10, WALL_CUE, WALL_9, 0.24),
      along(11, WALL_CUE, WALL_9, 0.24, D + 1),
      along(12, WALL_CUE, WALL_9, 0.24, -(D + 1)),
    ],
    cue: WALL_CUE,
    reward: { xp: 300, coins: 140 },
  },

  // ---- Set 6: whole tables ----
  {
    id: 'ch.order',
    set: 'Showpieces',
    name: 'In Order',
    brief: 'Pot the 1, the 2 and the 3, in that order.',
    hint: 'Every pot is also a position shot for the next one. Plan where the cue ball stops.',
    goal: { kind: 'potOrder', order: [1, 2, 3] },
    shotLimit: 6,
    stars: { three: 3, two: 4 },
    balls: [at(1, 700, 300), at(2, 1300, 720), at(3, 1650, 280)],
    cue: { x: 400, y: 560 },
    reward: { xp: 300, coins: 140 },
  },
  {
    id: 'ch.runout',
    set: 'Showpieces',
    name: 'The Run Out',
    brief: 'Clear all five balls.',
    hint: 'Think one ball ahead. Where the cue ball stops matters more than the pot itself.',
    goal: { kind: 'clearTable' },
    shotLimit: 8,
    stars: { three: 5, two: 6 },
    balls: [
      at(1, TABLE_LENGTH * 0.3, MID_Y - 200),
      at(2, TABLE_LENGTH * 0.5, MID_Y + 180),
      at(3, TABLE_LENGTH * 0.68, MID_Y - 160),
      at(4, TABLE_LENGTH * 0.82, MID_Y + 120),
      at(5, TABLE_LENGTH * 0.9, MID_Y - 60),
    ],
    cue: { x: TABLE_LENGTH * 0.18, y: MID_Y },
    reward: { xp: 400, coins: 200 },
  },
  {
    id: 'ch.finale',
    set: 'Showpieces',
    name: 'Grand Finale',
    brief: 'Seven balls and a cluster to split. Clear the lot.',
    hint: 'Take the easy ones first, and use one of them to cannon into the cluster.',
    goal: { kind: 'clearTable' },
    shotLimit: 11,
    stars: { three: 7, two: 9 },
    balls: [
      at(1, 520, 250),
      at(2, 820, 760),
      at(3, 1180, 300),
      at(4, 1560, 640),
      at(5, 1560, 640 + D + 1),
      at(6, 1560 + D * 0.87 + 1, 640 + D / 2),
      at(7, 1800, 180),
    ],
    cue: { x: 300, y: 560 },
    reward: { xp: 500, coins: 260 },
  },
];

const BY_ID = new Map(CHALLENGES.map((c) => [c.id, c]));

export function challengeById(id: string): Challenge | undefined {
  return BY_ID.get(id);
}

/** Challenge sets in play order, each with its challenges. */
export function challengeSets(): { name: string; challenges: Challenge[] }[] {
  const order: string[] = [];
  const grouped = new Map<string, Challenge[]>();
  for (const c of CHALLENGES) {
    if (!grouped.has(c.set)) {
      grouped.set(c.set, []);
      order.push(c.set);
    }
    grouped.get(c.set)!.push(c);
  }
  return order.map((name) => ({ name, challenges: grouped.get(name)! }));
}

/** Builds the ball list for a challenge, cue ball included. */
export function challengeBalls(challenge: Challenge): Ball[] {
  const balls: Ball[] = challenge.balls.map((b) =>
    createBall(b.id, b.id === 8 ? 'eight' : b.id < 8 ? 'solid' : 'stripe', b.pos.x, b.pos.y)
  );
  balls.push(createBall(0, 'cue', challenge.cue.x, challenge.cue.y));
  return balls;
}

/** Stars earned for completing a challenge in `shots` shots. Zero means not completed. */
export function starsFor(challenge: Challenge, shots: number): number {
  if (shots <= challenge.stars.three) return 3;
  if (shots <= challenge.stars.two) return 2;
  return 1;
}
