import type { Ball, Vec2 } from './index.js';
import { createBall } from './ball.js';
import { BALL_RADIUS, TABLE_LENGTH, TABLE_WIDTH } from './constants.js';

/**
 * Hand-built trick-shot layouts.
 *
 * These exist mostly to teach cue ball control: the early sets walk through stun, follow and
 * draw in turn, and the later ones only go in if you can place the cue ball afterwards. Each
 * is a fixed table, an objective, and a shot budget you're rated against.
 */

export type ChallengeGoal =
  /** Pot `count` balls on a single shot. */
  | { kind: 'potInOne'; count: number }
  /** Pot the named ball after the cue ball has hit at least `cushions` rails. */
  | { kind: 'bankShot'; ballId: number; cushions: number }
  /** Clear every object ball. */
  | { kind: 'clearTable' }
  /** Pot the listed balls in exactly this order. */
  | { kind: 'potOrder'; order: number[] }
  /** Pot the named ball without the cue ball touching any other ball first. */
  | { kind: 'cleanPot'; ballId: number };

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
  reward: { xp: number; chalk: number };
}

const MID_Y = TABLE_WIDTH / 2;

/** Shorthand so the layouts below stay readable. */
function at(id: number, x: number, y: number): { id: number; pos: Vec2 } {
  return { id, pos: { x, y } };
}

export const CHALLENGES: Challenge[] = [
  // ---- Set 1: the basics of contact ----
  {
    id: 'ch.straight',
    set: 'First Principles',
    name: 'Dead Straight',
    brief: 'Pot the 1 in the far corner.',
    hint: 'Centre ball. Line the cue ball, the object ball and the pocket up as one.',
    goal: { kind: 'cleanPot', ballId: 1 },
    shotLimit: 3,
    stars: { three: 1, two: 2 },
    balls: [at(1, TABLE_LENGTH * 0.7, MID_Y)],
    cue: { x: TABLE_LENGTH * 0.25, y: MID_Y },
    reward: { xp: 60, chalk: 25 },
  },
  {
    id: 'ch.cut',
    set: 'First Principles',
    name: 'Thin Cut',
    brief: 'Pot the 3 into the side pocket off a cut.',
    hint: 'Aim at the ghost ball — where the cue ball must be at contact, not at the ball itself.',
    goal: { kind: 'cleanPot', ballId: 3 },
    shotLimit: 4,
    stars: { three: 1, two: 2 },
    balls: [at(3, TABLE_LENGTH * 0.5, MID_Y - 190)],
    cue: { x: TABLE_LENGTH * 0.22, y: MID_Y - 60 },
    reward: { xp: 70, chalk: 30 },
  },
  {
    id: 'ch.stun',
    set: 'First Principles',
    name: 'Dead Stop',
    brief: 'Pot the 2 and leave the cue ball where it struck.',
    hint: 'Strike dead centre. All the pace goes into the object ball and the cue ball stops.',
    goal: { kind: 'cleanPot', ballId: 2 },
    shotLimit: 3,
    stars: { three: 1, two: 2 },
    balls: [at(2, TABLE_LENGTH * 0.62, MID_Y)],
    cue: { x: TABLE_LENGTH * 0.3, y: MID_Y },
    reward: { xp: 70, chalk: 30 },
  },

  // ---- Set 2: cue ball control ----
  {
    id: 'ch.follow',
    set: 'Cue Ball Control',
    name: 'Follow Through',
    brief: 'Pot the 4, then the 5 behind it.',
    hint: 'Strike above centre so the cue ball follows on toward the second ball.',
    goal: { kind: 'potOrder', order: [4, 5] },
    shotLimit: 4,
    stars: { three: 2, two: 3 },
    balls: [at(4, TABLE_LENGTH * 0.55, MID_Y), at(5, TABLE_LENGTH * 0.82, MID_Y - 40)],
    cue: { x: TABLE_LENGTH * 0.22, y: MID_Y },
    reward: { xp: 110, chalk: 45 },
  },
  {
    id: 'ch.draw',
    set: 'Cue Ball Control',
    name: 'Screw Back',
    brief: 'Pot the 6, then come back for the 7.',
    hint: 'Strike below centre. The cue ball will drag back down the line it came in on.',
    goal: { kind: 'potOrder', order: [6, 7] },
    shotLimit: 4,
    stars: { three: 2, two: 3 },
    balls: [at(6, TABLE_LENGTH * 0.62, MID_Y), at(7, TABLE_LENGTH * 0.2, MID_Y + 150)],
    cue: { x: TABLE_LENGTH * 0.42, y: MID_Y },
    reward: { xp: 130, chalk: 55 },
  },
  {
    id: 'ch.threading',
    set: 'Cue Ball Control',
    name: 'Threading the Needle',
    brief: 'Pot the 9 through the gap.',
    hint: 'There is only one line through. Take your time over the angle.',
    goal: { kind: 'cleanPot', ballId: 9 },
    shotLimit: 5,
    stars: { three: 1, two: 3 },
    balls: [
      at(9, TABLE_LENGTH * 0.78, MID_Y),
      at(11, TABLE_LENGTH * 0.5, MID_Y - BALL_RADIUS * 3.4),
      at(12, TABLE_LENGTH * 0.5, MID_Y + BALL_RADIUS * 3.4),
    ],
    cue: { x: TABLE_LENGTH * 0.2, y: MID_Y },
    reward: { xp: 140, chalk: 60 },
  },

  // ---- Set 3: off the rails ----
  {
    id: 'ch.bank1',
    set: 'Off the Rails',
    name: 'One Cushion',
    brief: 'Pot the 10 after coming off at least one rail.',
    hint: 'Angle in and out are equal. Aim at the mirror image of the ball beyond the cushion.',
    goal: { kind: 'bankShot', ballId: 10, cushions: 1 },
    shotLimit: 6,
    stars: { three: 2, two: 4 },
    balls: [at(10, TABLE_LENGTH * 0.7, MID_Y + 240)],
    cue: { x: TABLE_LENGTH * 0.3, y: MID_Y + 200 },
    reward: { xp: 150, chalk: 65 },
  },
  {
    id: 'ch.bank2',
    set: 'Off the Rails',
    name: 'Two Cushions',
    brief: 'Pot the 13 after two rails.',
    hint: 'Side spin changes the angle you come off the cushion. Use it.',
    goal: { kind: 'bankShot', ballId: 13, cushions: 2 },
    shotLimit: 8,
    stars: { three: 3, two: 5 },
    balls: [at(13, TABLE_LENGTH * 0.28, MID_Y - 220)],
    cue: { x: TABLE_LENGTH * 0.62, y: MID_Y + 150 },
    reward: { xp: 200, chalk: 90 },
  },

  // ---- Set 4: the showpieces ----
  {
    id: 'ch.double',
    set: 'Showpieces',
    name: 'Two at Once',
    brief: 'Pot two balls on a single shot.',
    hint: 'Both are already lined up on pockets. Find the contact that sends both on.',
    goal: { kind: 'potInOne', count: 2 },
    shotLimit: 5,
    stars: { three: 1, two: 3 },
    balls: [
      at(1, TABLE_LENGTH * 0.74, MID_Y - 120),
      at(2, TABLE_LENGTH * 0.74, MID_Y - 120 - BALL_RADIUS * 2.05),
    ],
    cue: { x: TABLE_LENGTH * 0.3, y: MID_Y + 60 },
    reward: { xp: 220, chalk: 100 },
  },
  {
    id: 'ch.triple',
    set: 'Showpieces',
    name: 'Three at Once',
    brief: 'Pot three balls on a single shot.',
    hint: 'A tight cluster hanging over the pockets. One firm strike into the middle of it.',
    goal: { kind: 'potInOne', count: 3 },
    shotLimit: 6,
    stars: { three: 1, two: 3 },
    balls: [
      at(1, TABLE_LENGTH - 120, 120),
      at(2, TABLE_LENGTH - 170, 150),
      at(3, TABLE_LENGTH - 150, 210),
    ],
    cue: { x: TABLE_LENGTH * 0.4, y: MID_Y },
    reward: { xp: 300, chalk: 140 },
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
    reward: { xp: 400, chalk: 200 },
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
