import { describe, expect, it } from 'vitest';
import { stepSimulation } from '../physics.js';
import { CUSHIONS, JAWS, POCKETS, inPocketApproach } from '../table.js';
import { BALL_RADIUS, TABLE_LENGTH, TABLE_WIDTH } from '../constants.js';
import { Vec2 } from '../vector.js';
import type { Ball } from '../types.js';

/**
 * Pockets used to reject balls that visibly went in: the cushions ran unbroken across every
 * mouth, and capture was a small circle around a point that the drawn mouth was far wider than.
 * These tests pin the geometry down from the player's point of view — "if it looks like it goes
 * in, it goes in" — so it can't silently drift back.
 */

function ball(id: number, x: number, y: number, vx = 0, vy = 0): Ball {
  return {
    id,
    kind: id === 0 ? 'cue' : 'solid',
    pos: { x, y },
    vel: { x: vx, y: vy },
    angVel: { x: 0, y: 0, z: 0 },
    z: 0,
    vz: 0,
    pocketed: false,
  };
}

/** Runs a shot to a standstill, returning every event it produced. */
function settle(balls: Ball[], maxFrames = 600) {
  const events = [];
  for (let i = 0; i < maxFrames; i++) {
    const step = stepSimulation(balls, 1 / 60);
    events.push(...step.events);
    if (step.settled) break;
  }
  return events;
}

/** Fires a ball from `from` toward `to` at `speed`. */
function shootAt(from: Vec2, to: Vec2, speed: number): Ball {
  const dir = Vec2.normalize(Vec2.sub(to, from));
  return ball(1, from.x, from.y, dir.x * speed, dir.y * speed);
}

describe('pocket geometry', () => {
  it('drops a ball rolled into the middle of every mouth', () => {
    for (const pocket of POCKETS) {
      // Start a long way back on the pocket's own centre line, so the ball arrives square.
      const start = Vec2.add(pocket.mid, Vec2.scale(pocket.out, -600));
      const b = shootAt(start, pocket.capture, 900);
      const events = settle([b]);

      expect(b.pocketed, `pocket ${pocket.index} (${pocket.kind}) should accept a square shot`).toBe(
        true
      );
      expect(events.some((e) => e.type === 'pot' && e.pocketIndex === pocket.index)).toBe(true);
    }
  });

  it('drops a ball rolling down the rail into a corner', () => {
    // The classic "it hits a wall" case: along the top cushion into the top-left corner.
    const b = ball(1, 900, BALL_RADIUS, -1400, 0);
    settle([b]);
    expect(b.pocketed).toBe(true);
  });

  it('reports which pocket took the ball', () => {
    const b = ball(1, 900, BALL_RADIUS, -1400, 0);
    const events = settle([b]);
    const pot = events.find((e) => e.type === 'pot');
    expect(pot).toBeDefined();
    // Top-left corner is index 0 in POCKETS.
    expect(pot!.type === 'pot' && pot!.pocketIndex).toBe(0);
  });

  it('rattles a ball off a jaw instead of letting it through', () => {
    // Aimed at a jaw rather than the opening: it must come back onto the table, not vanish
    // through the gap and not tunnel out of the world.
    const jaw = JAWS[0];
    const start = { x: jaw.pos.x + 400, y: jaw.pos.y + 400 };
    const b = shootAt(start, jaw.pos, 1200);
    const events = settle([b]);
    expect(events.some((e) => e.type === 'cushion')).toBe(true);
  });

  it('never lets a ball off the table', () => {
    // Sprayed shots from all over, at every angle: every ball ends up either potted or on the
    // cloth. A gap in the cushion runs would show up here as a ball out in open space.
    for (let seed = 0; seed < 120; seed++) {
      const angle = (seed / 120) * Math.PI * 2;
      const b = ball(
        1,
        200 + ((seed * 137) % 1600),
        120 + ((seed * 71) % 760),
        Math.cos(angle) * 3800,
        Math.sin(angle) * 3800
      );
      settle([b]);

      if (b.pocketed) continue;
      expect(b.pos.x, `escaped in x from seed ${seed}`).toBeGreaterThan(-1);
      expect(b.pos.x, `escaped in x from seed ${seed}`).toBeLessThan(TABLE_LENGTH + 1);
      expect(b.pos.y, `escaped in y from seed ${seed}`).toBeGreaterThan(-1);
      expect(b.pos.y, `escaped in y from seed ${seed}`).toBeLessThan(TABLE_WIDTH + 1);
    }
  });

  it('rolls a ball along the rail past a side pocket without dropping it', () => {
    // A ball hugging the cushion is only *tangent* to the side pocket's mouth, so it should
    // sail past. Given just enough pace to stop well beyond it and short of the corner.
    const b = ball(1, 400, BALL_RADIUS, 1000, 0);
    settle([b]);
    expect(b.pocketed).toBe(false);
    expect(b.pos.x).toBeGreaterThan(TABLE_LENGTH / 2);
  });

  it('puts the cushion runs and the mouths in agreement', () => {
    // Every point along a rail is backed by exactly one of the two: a cushion run, or a pocket
    // mouth. Never both, never neither. "Neither" is precisely the bug this work fixed — the
    // mouths were drawn wide while the cushions ran unbroken behind them.
    for (let x = 0; x <= TABLE_LENGTH; x += 3) {
      for (const y of [0, TABLE_WIDTH]) {
        const covered = CUSHIONS.some(
          (c) => c.axis === 'h' && c.base === y && x >= c.from && x <= c.to
        );
        const inMouth = inPocketApproach({ x, y }, 1);
        // Skip the seams, where a point is legitimately on both boundaries at once.
        const nearSeam = CUSHIONS.some(
          (c) => c.axis === 'h' && c.base === y && (Math.abs(x - c.from) <= 2 || Math.abs(x - c.to) <= 2)
        );
        if (nearSeam) continue;
        expect(covered, `rail y=${y} at x=${x} is backed by neither cushion nor mouth`).toBe(
          !inMouth
        );
      }
    }
  });
});
