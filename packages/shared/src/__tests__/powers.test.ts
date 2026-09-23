import { describe, expect, it } from 'vitest';
import { cloneBalls, runShot, SHOT_STEP, stepSimulation } from '../physics.js';
import { BALL_DIAMETER, CUE_BALL_ID, TABLE_LENGTH, TABLE_WIDTH } from '../constants.js';
import { BOMB_RADIUS, emptyPowerState, orbsUnder, refillOrbs, type PhysicsMods } from '../powers.js';
import { POCKETS } from '../table.js';
import { rackBalls } from '../rack.js';
import type { Ball } from '../types.js';

function ball(id: number, x: number, y: number, vx = 0, vy = 0): Ball {
  return { id, kind: id === 0 ? 'cue' : 'solid', pos: { x, y }, vel: { x: vx, y: vy }, angVel: { x: 0, y: 0, z: 0 }, z: 0, vz: 0, pocketed: false };
}

const speed = (b: Ball): number => Math.sqrt(b.vel.x * b.vel.x + b.vel.y * b.vel.y);

/** A cue ball rolling into a small cluster in open cloth, well clear of every cushion. */
function cluster(): Ball[] {
  const cx = TABLE_LENGTH / 2;
  const cy = TABLE_WIDTH / 2;
  return [
    ball(CUE_BALL_ID, cx - 200, cy, 1500, 0),
    ball(1, cx, cy),
    ball(2, cx + BALL_DIAMETER * 1.5, cy - BALL_DIAMETER * 2),
    ball(3, cx + BALL_DIAMETER * 1.5, cy + BALL_DIAMETER * 2),
    // Far outside the blast: a bomb must leave this one alone.
    ball(4, cx + BOMB_RADIUS * 2, cy - BALL_DIAMETER * 5),
  ];
}

/** Steps a shot one tick at a time, recording the fastest each ball ever moved. */
function peakSpeeds(balls: Ball[], mods?: PhysicsMods): Map<number, number> {
  const peak = new Map<number, number>();
  for (let i = 0; i < 400; i++) {
    stepSimulation(balls, SHOT_STEP, { mods });
    for (const b of balls) peak.set(b.id, Math.max(peak.get(b.id) ?? 0, speed(b)));
  }
  return peak;
}

describe('bomb', () => {
  it('goes off once, on the cue ball’s first contact, and is spent', () => {
    const mods: PhysicsMods = { bigPockets: false, bomb: true };
    const { events } = runShot(cluster(), { mods });
    const bombs = events.filter((e) => e.type === 'bomb');
    expect(bombs).toHaveLength(1);
    const firstHit = events.findIndex((e) => e.type === 'ballCollision');
    expect(events.findIndex((e) => e.type === 'bomb')).toBeGreaterThan(firstHit);
    expect(mods.bomb).toBe(false);
  });

  it('throws nearby balls far harder than a plain hit, and leaves distant ones be', () => {
    const plain = peakSpeeds(cluster());
    const boom = peakSpeeds(cluster(), { bigPockets: false, bomb: true });
    // Balls 2 and 3 are never touched by a plain hit — only the blast can move them.
    expect(plain.get(2)).toBe(0);
    expect(boom.get(2)!).toBeGreaterThan(300);
    expect(boom.get(3)!).toBeGreaterThan(300);
    expect(boom.get(1)!).toBeGreaterThan(plain.get(1)!);
    expect(boom.get(4)).toBe(0);
  });

  it('does nothing without the mod', () => {
    const { events } = runShot(cluster(), { mods: { bigPockets: false, bomb: false } });
    expect(events.some((e) => e.type === 'bomb')).toBe(false);
  });

  it('replays identically', () => {
    const a = cluster();
    const b = cloneBalls(a);
    runShot(a, { mods: { bigPockets: false, bomb: true } });
    runShot(b, { mods: { bigPockets: false, bomb: true } });
    expect(b).toEqual(a);
  });
});

describe('big pockets', () => {
  it('draws in a ball that stops just short of the mouth', () => {
    // Roll a ball straight at a corner at a range of paces: some die just short of the jaws, and
    // the big pocket must take at least one of those — without ever refusing a normal pot.
    const corner = POCKETS[0];
    const dir = { x: -Math.SQRT1_2, y: -Math.SQRT1_2 };
    const start = (v: number) => [ball(1, corner.mid.x + 300 * Math.SQRT1_2, corner.mid.y + 300 * Math.SQRT1_2, dir.x * v, dir.y * v)];
    let rescued = 0;
    for (let v = 100; v <= 1500; v += 5) {
      const normal = start(v);
      runShot(normal, { mods: { bigPockets: false, bomb: false } });
      const big = start(v);
      runShot(big, { mods: { bigPockets: true, bomb: false } });
      if (normal[0].pocketed) expect(big[0].pocketed).toBe(true);
      else if (big[0].pocketed) rescued++;
    }
    expect(rescued).toBeGreaterThan(0);
  });
});

describe('orbs', () => {
  it('refills to three, clear of balls and pockets, deterministically', () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const balls = rackBalls();
    const s1 = emptyPowerState();
    refillOrbs(s1, balls, rand);
    expect(s1.orbs).toHaveLength(3);
    for (const o of s1.orbs) {
      for (const b of balls) expect(Math.hypot(b.pos.x - o.pos.x, b.pos.y - o.pos.y)).toBeGreaterThan(BALL_DIAMETER);
      for (const p of POCKETS) expect(Math.hypot(p.mid.x - o.pos.x, p.mid.y - o.pos.y)).toBeGreaterThan(BALL_DIAMETER * 3);
    }
    seed = 7;
    const s2 = emptyPowerState();
    refillOrbs(s2, balls, rand);
    expect(s2.orbs).toEqual(s1.orbs);
  });

  it('are collected by a cue ball resting on them', () => {
    const s = emptyPowerState();
    refillOrbs(s, [], () => 0.5);
    const o = s.orbs[0];
    expect(orbsUnder(s.orbs, o.pos).map((x) => x.id)).toContain(o.id);
    expect(orbsUnder(s.orbs, { x: o.pos.x + 200, y: o.pos.y })).not.toContainEqual(o);
  });
});
