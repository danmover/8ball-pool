import { describe, expect, it } from 'vitest';
import { applyCueStrike, contactVelocity, stepSimulation } from '../physics.js';
import { Vec2 } from '../vector.js';
import { rackBalls } from '../rack.js';
import {
  BALL_RADIUS,
  CUE_BALL_ID,
  MAX_TIP_OFFSET,
  MISCUE_TIP_OFFSET,
  TABLE_LENGTH,
  TABLE_WIDTH,
} from '../constants.js';
import { POCKETS } from '../table.js';
import type { Ball } from '../types.js';

/** Forces `applyCueStrike` never to miscue, so these tests measure mechanics, not dice. */
const NO_MISCUE = (): number => 1;

function ball(id: number, x: number, y: number, vx = 0, vy = 0): Ball {
  return { id, kind: id === 0 ? 'cue' : 'solid', pos: { x, y }, vel: { x: vx, y: vy }, angVel: { x: 0, y: 0, z: 0 }, z: 0, vz: 0, pocketed: false };
}

describe('rackBalls', () => {
  it('produces 16 unique balls, all inside the table', () => {
    const balls = rackBalls();
    expect(balls).toHaveLength(16);
    expect(new Set(balls.map((b) => b.id)).size).toBe(16);
    for (const b of balls) {
      expect(b.pos.x).toBeGreaterThanOrEqual(BALL_RADIUS);
      expect(b.pos.x).toBeLessThanOrEqual(TABLE_LENGTH - BALL_RADIUS);
      expect(b.pos.y).toBeGreaterThanOrEqual(BALL_RADIUS);
      expect(b.pos.y).toBeLessThanOrEqual(TABLE_WIDTH - BALL_RADIUS);
    }
  });
});

describe('stepSimulation', () => {
  it('decelerates a rolling ball to rest via friction', () => {
    const balls = [ball(CUE_BALL_ID, 200, 200, 500, 0)];
    let settled = false;
    for (let i = 0; i < 600 && !settled; i++) {
      settled = stepSimulation(balls, 1 / 60).settled;
    }
    expect(settled).toBe(true);
    expect(Math.hypot(balls[0].vel.x, balls[0].vel.y)).toBeLessThan(5);
  });

  it('reflects a ball off the left cushion', () => {
    const balls = [ball(1, BALL_RADIUS + 2, 300, -600, 0)];
    const { events } = stepSimulation(balls, 1 / 20);
    expect(events.some((e) => e.type === 'cushion')).toBe(true);
    expect(balls[0].vel.x).toBeGreaterThan(0);
    expect(balls[0].pos.x).toBeGreaterThanOrEqual(BALL_RADIUS);
  });

  it('exchanges velocity between two head-on equal balls', () => {
    const a = ball(0, 300, 300, 400, 0);
    const b = ball(1, 300 + BALL_RADIUS * 2 + 10, 300, 0, 0);
    const { events } = stepSimulation([a, b], 1 / 10);
    expect(events.some((e) => e.type === 'ballCollision')).toBe(true);
    expect(b.vel.x).toBeGreaterThan(0);
    expect(a.vel.x).toBeLessThan(b.vel.x);
  });

  it('sends a dead-straight full-power shot straight down the table', () => {
    // Regression: with a fixed substep the cue ball buried itself in the object ball
    // before contact resolved, skewing the normal and throwing hard shots off-line.
    const cue = ball(0, 300, 500, 4200, 0);
    const target = ball(1, 1200, 500, 0, 0);
    const balls = [cue, target];
    for (let i = 0; i < 400 && !stepSimulation(balls, 1 / 60).settled; i++);

    // A straight centre-ball hit must not impart sideways drift to either ball.
    expect(Math.abs(target.pos.y - 500)).toBeLessThan(1);
    expect(Math.abs(cue.pos.y - 500)).toBeLessThan(1);
    expect(target.pos.x).toBeGreaterThan(1200); // driven forward
  });

  it('keeps a hard cut shot on the geometric cut angle', () => {
    // Cue aimed straight along +x at a ball offset in y: the object ball should leave
    // along the line from the contact point through its centre.
    const cue = ball(0, 300, 500, 3600, 0);
    const target = ball(1, 1200, 500 + BALL_RADIUS, 0, 0);
    const balls = [cue, target];

    // Measured at the moment of contact, not from where the ball ends up. A cut this firm
    // carries the object ball into a cushion and back, so its resting place says nothing
    // about the cut angle — which is the thing this test is actually about.
    let departure: { x: number; y: number } | null = null;
    for (let i = 0; i < 400; i++) {
      const { events, settled } = stepSimulation(balls, 1 / 60);
      if (!departure && events.some((e) => e.type === 'ballCollision')) {
        departure = { ...target.vel };
      }
      if (settled) break;
    }

    // Contact centres are 2R apart with dy = R, so the cut is 30 degrees off the
    // cue's line of travel; the object ball must move down-and-right, not backwards.
    expect(departure).not.toBeNull();
    expect(departure!.x).toBeGreaterThan(0);
    expect(departure!.y).toBeGreaterThan(0);
    const angle = (Math.atan2(departure!.y, departure!.x) * 180) / Math.PI;
    expect(angle).toBeGreaterThan(20);
    expect(angle).toBeLessThan(40);
  });
});

describe('cue ball control (spin)', () => {
  /**
   * Fires the cue ball straight down the table into a stationary object ball.
   *
   * `tip` is where the cue strikes, exactly as the spin pad reports it: positive y is *below*
   * centre, which is draw.
   *
   * Speeds and distances here are chosen so the object ball comes to rest *before* the far
   * cushion. An earlier version of these tests used a firm shot, the object ball rebounded off
   * the end rail and struck the cue ball a second time, and every assertion about where the cue
   * ball finished was really measuring that second collision.
   */
  function shot(opts: {
    tip?: { x: number; y: number };
    cueX?: number;
    targetX?: number;
    power?: number;
  }): { cue: Ball; target: Ball; contactX: number } {
    // Short and soft on purpose. The pad's reach grew when the miscue band was added, so a
    // firm follow shot now genuinely catches the object ball a second time off the far rail —
    // correct physics, but it would contaminate every reading below.
    const cueX = opts.cueX ?? 400;
    const targetX = opts.targetX ?? 700;
    const cue = ball(CUE_BALL_ID, cueX, 500);
    applyCueStrike(cue, 0, opts.power ?? 0.35, opts.tip ?? { x: 0, y: 0 }, NO_MISCUE);
    const target = ball(1, targetX, 500);
    const balls = [cue, target];

    // Run until the cue ball has been still for a while, rather than until it is *first* slow.
    // A draw shot passes through zero velocity as it reverses, so an instantaneous rest test
    // stops the clock at the moment of contact and reports no draw whatsoever.
    let stillFor = 0;
    for (let i = 0; i < 4000; i++) {
      stepSimulation(balls, 1 / 240);
      stillFor = Vec2.length(cue.vel) < 3 ? stillFor + 1 / 240 : 0;
      if (stillFor > 0.3) break;
    }
    return { cue, target, contactX: targetX - BALL_RADIUS * 2 };
  }

  const DRAW = { x: 0, y: 1 };
  const FOLLOW = { x: 0, y: -1 };
  const CENTRE = { x: 0, y: 0 };

  it('strikes the object ball exactly once, so nothing rebounds back into the readings', () => {
    // The guarantee every measurement below depends on. An earlier version of these tests let
    // the object ball rebound off the end rail and hit the cue ball a second time, and every
    // assertion about where the cue ball finished was really measuring that second collision.
    for (const tip of [DRAW, CENTRE, FOLLOW]) {
      const cue = ball(CUE_BALL_ID, 400, 500);
      applyCueStrike(cue, 0, 0.35, tip, NO_MISCUE);
      const target = ball(1, 700, 500);
      const balls = [cue, target];
      let contacts = 0;
      let stillFor = 0;
      for (let i = 0; i < 4000; i++) {
        const { events } = stepSimulation(balls, 1 / 240);
        contacts += events.filter((e) => e.type === 'ballCollision').length;
        stillFor = Vec2.length(cue.vel) < 3 ? stillFor + 1 / 240 : 0;
        if (stillFor > 0.3) break;
      }
      expect(contacts).toBe(1);
    }
  });

  it('sends the object ball on regardless of the spin used', () => {
    for (const tip of [DRAW, CENTRE, FOLLOW]) {
      const { target } = shot({ tip });
      expect(target.pos.x).toBeGreaterThan(700);
      expect(Math.abs(target.pos.y - 500)).toBeLessThan(2);
    }
  });

  it('draws the cue ball back behind the contact point with backspin', () => {
    const { cue, contactX } = shot({ tip: DRAW });
    expect(cue.pos.x).toBeLessThan(contactX - 40);
  });

  it('leaves the cue ball near the contact point on a stun shot', () => {
    // Struck at the height that makes the ball roll naturally straight away is *not* a stun —
    // a stun is centre ball over a short distance, before the cloth has turned skid into roll.
    const { cue, contactX } = shot({ tip: CENTRE, cueX: 780, targetX: 900, power: 0.16 });
    expect(Math.abs(cue.pos.x - contactX)).toBeLessThan(60);
  });

  it('orders draw, stun and follow correctly along the shot line', () => {
    const draw = shot({ tip: DRAW }).cue.pos.x;
    const stun = shot({ tip: CENTRE }).cue.pos.x;
    const follow = shot({ tip: FOLLOW }).cue.pos.x;
    expect(draw).toBeLessThan(stun);
    expect(stun).toBeLessThan(follow);
  });

  it('loses its bite over distance, so a long screw draws back less', () => {
    // Same strike, same object ball; only the distance the cue ball covers on the way there
    // differs. Sliding friction rubs the backspin off into natural roll as it travels, so the
    // long one arrives with less to give — no decay constant required, it just happens.
    const near = shot({ tip: DRAW, cueX: 800, targetX: 1000, power: 0.3 });
    const far = shot({ tip: DRAW, cueX: 120, targetX: 1000, power: 0.3 });
    const nearDraw = near.contactX - near.cue.pos.x;
    const farDraw = far.contactX - far.cue.pos.x;
    expect(nearDraw).toBeGreaterThan(farDraw);
  });

  it('sends a ball struck 2/5 of a radius above centre into natural roll immediately', () => {
    // The textbook result, and a good check that the strike model is doing real mechanics:
    // at that exact height there is no skid at all, so the contact patch starts still.
    const cue = ball(CUE_BALL_ID, 400, 500);
    // 2/5 R above centre, expressed against the pad's full reach.
    applyCueStrike(cue, 0, 0.5, { x: 0, y: -0.4 / MISCUE_TIP_OFFSET }, NO_MISCUE);
    expect(Vec2.length(contactVelocity(cue))).toBeLessThan(1);
  });

  it('skids before it grabs when struck through the centre', () => {
    const cue = ball(CUE_BALL_ID, 400, 500);
    applyCueStrike(cue, 0, 0.5, CENTRE, NO_MISCUE);
    // A centre-ball hit starts with no spin at all, so the whole ball is sliding.
    expect(Vec2.length(contactVelocity(cue))).toBeCloseTo(Vec2.length(cue.vel), 5);
  });

  it('changes the angle off a cushion with english', () => {
    const angleOff = (tipX: number): number => {
      // Aimed at the top rail around x = 700 — comfortably between the corner mouth and the
      // side pocket, so the ball meets cushion rather than falling in a hole.
      const from = { x: 400, y: 800 };
      const cue = ball(CUE_BALL_ID, from.x, from.y);
      const angle = Math.atan2(BALL_RADIUS - from.y, 700 - from.x);
      applyCueStrike(cue, angle, 0.5, { x: tipX, y: 0 }, NO_MISCUE);
      for (let i = 0; i < 2000; i++) {
        stepSimulation([cue], 1 / 240);
        if (cue.vel.y > 0) break; // rebounded, now heading back down the table
      }
      expect(cue.pocketed).toBe(false);
      return Math.atan2(cue.vel.y, cue.vel.x);
    };
    // Running and reverse english must send it off at genuinely different angles.
    expect(Math.abs(angleOff(1) - angleOff(-1))).toBeGreaterThan(0.05);
  });

  it('throws the object ball off the true line when english is applied', () => {
    const clean = shot({ tip: CENTRE }).target.pos.y;
    const thrown = shot({ tip: { x: 1, y: 0 } }).target.pos.y;
    expect(Math.abs(thrown - 500)).toBeGreaterThan(Math.abs(clean - 500));
  });

  it('clears all spin once a ball comes to rest', () => {
    // Settles everything, not just the cue ball, since this is about the resting state.
    const cue = ball(CUE_BALL_ID, 400, 500);
    applyCueStrike(cue, 0, 0.4, { x: 1, y: 1 }, NO_MISCUE);
    const target = ball(1, 800, 500);
    const balls = [cue, target];
    for (let i = 0; i < 4000 && !stepSimulation(balls, 1 / 240).settled; i++);

    for (const b of balls) {
      expect(Vec2.length(b.vel)).toBe(0);
      expect(b.angVel.x).toBe(0);
      expect(b.angVel.y).toBe(0);
      expect(b.angVel.z).toBe(0);
    }
  });

  it('never miscues inside the tip\'s safe grip, however hard the shot', () => {
    // `() => 0` makes every miscue roll succeed, so anything that *can* slip, will. Nothing
    // inside the safe band may — otherwise centre-ball play would be a gamble.
    const alwaysSlip = (): number => 0;
    const safe = MAX_TIP_OFFSET / MISCUE_TIP_OFFSET;
    for (const tip of [CENTRE, { x: 0, y: safe }, { x: safe, y: 0 }, { x: 0, y: -safe }]) {
      const cue = ball(CUE_BALL_ID, 400, 500);
      expect(applyCueStrike(cue, 0, 1, tip, alwaysSlip).miscued).toBe(false);
    }
  });

  it('can miscue out past it, and wastes the shot when it does', () => {
    const cue = ball(CUE_BALL_ID, 400, 500);
    const clean = ball(CUE_BALL_ID, 400, 500);
    const edge = { x: 0.72, y: 0.72 }; // magnitude 1: the very edge of the pad

    expect(applyCueStrike(cue, 0, 1, edge, () => 0).miscued).toBe(true);
    expect(applyCueStrike(clean, 0, 1, edge, () => 1).miscued).toBe(false);

    // A slipped tip has to actually cost something, or the risk is decorative.
    expect(Vec2.length(cue.vel)).toBeLessThan(Vec2.length(clean.vel) * 0.5);
  });

  it('scales the miscue chance with how far past the grip you strike', () => {
    // Exactly at the safe edge nothing slips; at the pad's edge most attempts do.
    const chance = (mag: number): number => {
      let slips = 0;
      for (let i = 0; i < 400; i++) {
        const cue = ball(CUE_BALL_ID, 400, 500);
        if (applyCueStrike(cue, 0, 0.5, { x: 0, y: mag }).miscued) slips++;
      }
      return slips / 400;
    };
    const safe = MAX_TIP_OFFSET / MISCUE_TIP_OFFSET;
    expect(chance(safe)).toBe(0);
    expect(chance((safe + 1) / 2)).toBeGreaterThan(0.1);
    expect(chance(1)).toBeGreaterThan(chance((safe + 1) / 2));
  });

  it('picks up forward roll off a cushion, the way a real rail sends a ball on', () => {
    // The cushion nose meets the ball above its centre, so the rebound impulse applies a torque
    // as well as a push. Without it a ball comes off a rail carrying its old roll — which is
    // now backspin relative to the new direction — and just sits down.
    const cue = ball(CUE_BALL_ID, 500, 300, 0, -900);
    let before = 0;
    for (let i = 0; i < 400; i++) {
      before = cue.angVel.x;
      stepSimulation([cue], 1 / 240);
      if (cue.vel.y > 0) break; // rebounded off the top rail, now heading back down
    }
    // Rolling into the rail along -y means angVel.x was negative; the nose torque must swing
    // it forwards. It won't reach full natural roll immediately — the cloth finishes the job,
    // which is exactly why a ball skids briefly coming off a cushion.
    expect(before).toBeLessThan(0);
    expect(cue.angVel.x).toBeGreaterThan(before);
    expect(cue.angVel.x).toBeGreaterThan(0);
  });

  it('returns more of a slow ball off the cushion than a fast one', () => {
    /**
     * Speed retained *across the cushion*, measured against the velocity in the instant before
     * impact rather than the launch speed. Measuring end-to-end reports approach friction
     * instead of restitution, and a slow ball skidding to the rail loses most of its speed on
     * the way — which made the gentle bounce look like the deader one.
     */
    const bounce = (speed: number): number => {
      const b = ball(1, 500, BALL_RADIUS + 60, 0, -speed);
      let incoming = speed;
      for (let i = 0; i < 900; i++) {
        const before = b.vel.y;
        stepSimulation([b], 1 / 240);
        if (b.vel.y > 0) return b.vel.y / Math.abs(incoming);
        incoming = before;
      }
      return 0;
    };
    // Real rubber swallows more of a hard hit — one flat restitution got both ends wrong.
    const slow = bounce(400);
    const fast = bounce(3800);
    expect(slow).toBeGreaterThan(0);
    expect(slow).toBeGreaterThan(fast);
  });

  it('leaves the cloth when the cue is steep enough, and only then', () => {
    const peak = (elevation: number): number => {
      const cue = ball(CUE_BALL_ID, 400, 500);
      applyCueStrike(cue, 0, 0.8, CENTRE, NO_MISCUE, elevation);
      let highest = 0;
      for (let i = 0; i < 900; i++) {
        stepSimulation([cue], 1 / 240);
        highest = Math.max(highest, cue.z);
      }
      return highest;
    };
    // A level cue can't lift the ball, however hard it's hit — the jump comes from driving the
    // ball *into* the cloth and the cloth throwing it back, not from the cue lifting anything.
    expect(peak(0)).toBe(0);
    expect(peak(Math.PI / 9)).toBeLessThan(peak(Math.PI / 4));
    // Steep and firm has to clear a ball, or the shot is pointless.
    expect(peak(Math.PI / 3)).toBeGreaterThan(BALL_RADIUS * 2);
  });

  it('jumps clean over a blocking ball and reaches the one behind it', () => {
    const cue = ball(CUE_BALL_ID, 400, 500);
    applyCueStrike(cue, 0, 0.85, CENTRE, NO_MISCUE, Math.PI / 3);
    const blocker = ball(1, 620, 500);
    const target = ball(2, 1000, 500);
    const balls = [cue, blocker, target];

    const events = [];
    for (let i = 0; i < 2000; i++) {
      const step = stepSimulation(balls, 1 / 240);
      events.push(...step.events);
      if (step.settled) break;
    }

    const hits = events.filter((e) => e.type === 'ballCollision');
    expect(hits.length).toBeGreaterThan(0);
    // The first thing it touches must be the far ball. Clearing the blocker is the whole shot.
    const first = hits[0];
    expect(first.type === 'ballCollision' && (first.a === 2 || first.b === 2)).toBe(true);
    expect(events.some((e) => e.type === 'land')).toBe(true);
  });

  it('cannot be potted while it is still in the air', () => {
    // Hanging directly over a pocket, on the way up. Real balls fly over pockets; a ball that
    // dropped in mid-flight would make every jump across the table a lottery.
    const pocket = POCKETS[0];
    const b = ball(CUE_BALL_ID, pocket.capture.x, pocket.capture.y);
    b.z = BALL_RADIUS * 2;
    b.vz = 260;

    let steps = 0;
    while (b.z > 0 && steps < 2000) {
      stepSimulation([b], 1 / 240);
      steps++;
      // Checked after the step, so a ball that landed during it is no longer "in the air".
      if (b.z > 0) expect(b.pocketed).toBe(false);
    }

    // And once it does land on top of the pocket, it goes in like anything else.
    stepSimulation([b], 1 / 240);
    expect(b.pocketed).toBe(true);
  });

  it('never lets a jumped ball leave the table', () => {
    // Cushions stay solid at every height on purpose — see the note in stepSimulation.
    for (let i = 0; i < 24; i++) {
      const angle = (i / 24) * Math.PI * 2;
      const b = ball(CUE_BALL_ID, 300, 300);
      applyCueStrike(b, angle, 1, { x: 0.7, y: -0.7 }, NO_MISCUE, Math.PI / 3);
      for (let s = 0; s < 2000 && !stepSimulation([b], 1 / 240).settled; s++);
      if (b.pocketed) continue;
      expect(b.pos.x).toBeGreaterThan(-1);
      expect(b.pos.x).toBeLessThan(TABLE_LENGTH + 1);
      expect(b.pos.y).toBeGreaterThan(-1);
      expect(b.pos.y).toBeLessThan(TABLE_WIDTH + 1);
      expect(b.z).toBe(0);
    }
  });

  it('curves the ball with side spin off a raised cue — and not off a level one', () => {
    /**
     * How far the ball strays from its launch line, measured only up to the first cushion.
     *
     * Squirt is already in the launch direction, so it doesn't count as curve. A rail does
     * though: english changes the rebound angle, and letting the ball reach one reported
     * hundreds of units of "curve" on a level-cue shot that had travelled dead straight.
     */
    const curve = (elevation: number): number => {
      const start = { x: 300, y: 500 };
      const b = ball(CUE_BALL_ID, start.x, start.y);
      applyCueStrike(b, 0, 0.5, { x: 1, y: 0 }, NO_MISCUE, elevation);
      const launch = Vec2.normalize(b.vel);
      let worst = 0;
      for (let i = 0; i < 3000; i++) {
        const { events } = stepSimulation([b], 1 / 240);
        if (events.some((e) => e.type === 'cushion')) break;
        const off = Vec2.sub(b.pos, start);
        worst = Math.max(worst, Math.abs(off.x * launch.y - off.y * launch.x));
        if (Vec2.length(b.vel) < 3 && b.z === 0) break;
      }
      return worst;
    };

    // Level-cue english genuinely cannot curve a ball: its spin is about the vertical axis, so
    // the contact patch only twists. Elevation tilts that axis along the direction of travel,
    // the patch starts dragging sideways, and the cloth pushes the ball off its line — massé.
    expect(curve(0)).toBeLessThan(2);
    expect(curve(Math.PI / 4)).toBeGreaterThan(20);
  });

  it('deflects the cue ball away from the english — squirt', () => {
    const launchAngle = (tipX: number, elevation = 0): number => {
      const b = ball(CUE_BALL_ID, 400, 500);
      applyCueStrike(b, 0, 0.6, { x: tipX, y: 0 }, NO_MISCUE, elevation);
      return Math.atan2(b.vel.y, b.vel.x);
    };

    // Right-hand english pushes the ball off the aim line, and left-hand the other way.
    expect(launchAngle(0)).toBeCloseTo(0, 6);
    expect(launchAngle(0.7)).toBeGreaterThan(0);
    expect(launchAngle(-0.7)).toBeLessThan(0);
    // Proportional to how far off centre you strike...
    expect(Math.abs(launchAngle(0.7))).toBeGreaterThan(Math.abs(launchAngle(0.35)));
    // ...and reduced by elevation, where squirt and the swerve it induces partly cancel.
    expect(Math.abs(launchAngle(0.7, Math.PI / 3))).toBeLessThan(Math.abs(launchAngle(0.7)));
  });

  it('still sends a dead-straight centre-ball shot straight, as before', () => {
    const { cue, target } = shot({ tip: CENTRE });
    expect(Math.abs(target.pos.y - 500)).toBeLessThan(1);
    expect(Math.abs(cue.pos.y - 500)).toBeLessThan(1);
  });
});
