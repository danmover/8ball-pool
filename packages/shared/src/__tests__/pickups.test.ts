import { describe, expect, it } from 'vitest';
import {
  MAGNET_BONUS,
  NO_MODIFIERS,
  PICKUP_RADIUS,
  applyPickup,
  nearestPocketIndex,
  pickupsUnder,
  spawnPickups,
  splitModifiers,
  type Pickup,
} from '../pickups.js';
import { POCKETS, pocketContaining } from '../table.js';
import { BALL_RADIUS, CUE_BALL_ID, TABLE_LENGTH, TABLE_WIDTH } from '../constants.js';
import { createBall } from '../ball.js';
import { stepSimulation } from '../physics.js';
import { computeTrajectoryPreview } from '../trajectory.js';
import type { Ball } from '../types.js';

/**
 * The one property that matters more than any individual effect: passing no options must leave
 * the engine byte-for-byte the game it was. The aim guide and the bot's shot search both call
 * `stepSimulation` bare, so a party mode that leaked into the default path would silently
 * change every serious mode too.
 */

/** Runs a ball to rest and returns where it stopped. */
function settle(balls: Ball[], opts?: Parameters<typeof stepSimulation>[2]): number {
  for (let i = 0; i < 2000; i++) {
    const { settled } = stepSimulation(balls, 1 / 120, opts);
    if (settled) return i;
  }
  return -1;
}

const cueAt = (x: number, y: number, vx = 0, vy = 0): Ball => {
  const ball = createBall(CUE_BALL_ID, 'cue', x, y);
  ball.vel = { x: vx, y: vy };
  return ball;
};

describe('spawning', () => {
  it('places the requested number of discs', () => {
    expect(spawnPickups(4)).toHaveLength(4);
    expect(spawnPickups(2)).toHaveLength(2);
  });

  it('keeps every disc on the cloth and out of a pocket', () => {
    for (const pickup of spawnPickups(5)) {
      expect(pickup.pos.x).toBeGreaterThan(0);
      expect(pickup.pos.x).toBeLessThan(TABLE_LENGTH);
      expect(pickup.pos.y).toBeGreaterThan(0);
      expect(pickup.pos.y).toBeLessThan(TABLE_WIDTH);
      expect(pocketContaining(pickup.pos)).toBeNull();
    }
  });

  it('keeps them apart, so one roll cannot sweep the table', () => {
    const pickups = spawnPickups(5);
    for (let i = 0; i < pickups.length; i++) {
      for (let j = i + 1; j < pickups.length; j++) {
        const d = Math.hypot(
          pickups[i].pos.x - pickups[j].pos.x,
          pickups[i].pos.y - pickups[j].pos.y
        );
        expect(d).toBeGreaterThan(PICKUP_RADIUS * 4);
      }
    }
  });

  it('leaves the rack alone, so the break does not collect them all', () => {
    // The rack occupies the far quarter of the table.
    for (const pickup of spawnPickups(5)) {
      expect(pickup.pos.x).toBeLessThan(TABLE_LENGTH * 0.72);
    }
  });

  it('lays out the same table twice from the same source of randomness', () => {
    const seeded = (): (() => number) => {
      let n = 42;
      return () => ((n = (n * 1103515245 + 12345) % 2147483648) / 2147483648);
    };
    expect(spawnPickups(4, seeded())).toEqual(spawnPickups(4, seeded()));
  });
});

describe('collecting', () => {
  it('arms when the cue ball rolls over a disc', () => {
    const pickups: Pickup[] = [
      { id: 0, kind: 'magnet', pos: { x: 700, y: TABLE_WIDTH / 2 }, taken: false },
    ];
    const cue = cueAt(400, TABLE_WIDTH / 2, 1400, 0);
    const balls = [cue];
    let collected = 0;
    for (let i = 0; i < 2000; i++) {
      const { events, settled } = stepSimulation(balls, 1 / 120, { pickups });
      collected += events.filter((e) => e.type === 'pickup').length;
      if (settled) break;
    }
    expect(collected).toBe(1);
    expect(pickups[0].taken).toBe(true);
  });

  it('arms exactly once even if the ball lingers on it', () => {
    // A ball that stops dead on a disc would otherwise re-arm it every substep.
    const pickups: Pickup[] = [
      { id: 0, kind: 'ghost', pos: { x: 420, y: TABLE_WIDTH / 2 }, taken: false },
    ];
    const balls = [cueAt(400, TABLE_WIDTH / 2, 60, 0)];
    let collected = 0;
    for (let i = 0; i < 3000; i++) {
      const { events, settled } = stepSimulation(balls, 1 / 120, { pickups });
      collected += events.filter((e) => e.type === 'pickup').length;
      if (settled) break;
    }
    expect(collected).toBe(1);
  });

  it('ignores object balls — only the cue ball arms anything', () => {
    // Otherwise a disc on the way to a pocket would be collected by luck rather than by choice.
    const pickups: Pickup[] = [
      { id: 0, kind: 'magnet', pos: { x: 700, y: TABLE_WIDTH / 2 }, taken: false },
    ];
    const three = createBall(3, 'solid', 400, TABLE_WIDTH / 2);
    three.vel = { x: 1400, y: 0 };
    const balls = [three];
    let collected = 0;
    for (let i = 0; i < 2000; i++) {
      const { events, settled } = stepSimulation(balls, 1 / 120, { pickups });
      collected += events.filter((e) => e.type === 'pickup').length;
      if (settled) break;
    }
    expect(collected).toBe(0);
    expect(pickups[0].taken).toBe(false);
  });

  it('reports which discs a ball is sitting on', () => {
    const pickups: Pickup[] = [
      { id: 0, kind: 'magnet', pos: { x: 500, y: 300 }, taken: false },
      { id: 1, kind: 'freeze', pos: { x: 900, y: 300 }, taken: false },
    ];
    expect(pickupsUnder(pickups, { x: 500, y: 300 })).toHaveLength(1);
    expect(pickupsUnder(pickups, { x: 700, y: 300 })).toHaveLength(0);
    pickups[0].taken = true;
    expect(pickupsUnder(pickups, { x: 500, y: 300 })).toHaveLength(0);
  });
});

describe('the magnet', () => {
  it('takes a ball that would otherwise have rattled past', () => {
    const corner = POCKETS[0];
    // Aim across the mouth, offset enough to miss the real capture region.
    const start = {
      x: corner.mid.x + 380,
      y: corner.mid.y + 380,
    };
    const dir = {
      x: corner.mid.x - start.x,
      y: corner.mid.y - start.y,
    };
    const len = Math.hypot(dir.x, dir.y);
    // A deliberate miss: nudge the aim sideways by most of a ball.
    const off = { x: -dir.y / len, y: dir.x / len };
    const speed = 900;
    const aim = (extra: number): Ball[] => {
      const cue = cueAt(
        start.x + off.x * extra,
        start.y + off.y * extra,
        (dir.x / len) * speed,
        (dir.y / len) * speed
      );
      return [cue];
    };

    // Find an offset that misses without the magnet — the point of the test is the difference.
    let missOffset: number | null = null;
    for (let extra = BALL_RADIUS; extra <= BALL_RADIUS * 4; extra += BALL_RADIUS * 0.25) {
      const plain = aim(extra);
      settle(plain);
      if (!plain[0].pocketed) {
        missOffset = extra;
        break;
      }
    }
    expect(missOffset, 'expected some offset to miss the pocket').not.toBeNull();

    const magnetised = aim(missOffset!);
    settle(magnetised, { modifiers: { ...NO_MODIFIERS, magnetPocket: 0 } });
    expect(magnetised[0].pocketed).toBe(true);
  });

  it('widens the mouth by the advertised amount, not arbitrarily', () => {
    // Far outside the bonus, the magnet must make no difference at all.
    const corner = POCKETS[0];
    const far = {
      x: corner.mid.x + MAGNET_BONUS * 6,
      y: corner.mid.y + MAGNET_BONUS * 6,
    };
    const balls = [cueAt(far.x, far.y)];
    settle(balls, { modifiers: { ...NO_MODIFIERS, magnetPocket: 0 } });
    expect(balls[0].pocketed).toBe(false);
  });
});

describe('the blocker', () => {
  it('refuses a pot that would otherwise have dropped', () => {
    const corner = POCKETS[0];
    const start = { x: corner.mid.x + 400, y: corner.mid.y + 400 };
    const dir = { x: corner.mid.x - start.x, y: corner.mid.y - start.y };
    const len = Math.hypot(dir.x, dir.y);
    const shot = (): Ball[] => [
      cueAt(start.x, start.y, (dir.x / len) * 900, (dir.y / len) * 900),
    ];

    const plain = shot();
    settle(plain);
    expect(plain[0].pocketed, 'the control shot should pot').toBe(true);

    const blocked = shot();
    settle(blocked, { modifiers: { ...NO_MODIFIERS, blockedPocket: 0 } });
    expect(blocked[0].pocketed).toBe(false);
    // And it comes back out rather than being left sitting in the jaws.
    expect(blocked[0].pos.x).toBeGreaterThan(BALL_RADIUS);
    expect(blocked[0].pos.y).toBeGreaterThan(BALL_RADIUS);
  });

  it('blocks only the pocket it was placed on', () => {
    const corner = POCKETS[0];
    const start = { x: corner.mid.x + 400, y: corner.mid.y + 400 };
    const dir = { x: corner.mid.x - start.x, y: corner.mid.y - start.y };
    const len = Math.hypot(dir.x, dir.y);
    const balls = [cueAt(start.x, start.y, (dir.x / len) * 900, (dir.y / len) * 900)];
    settle(balls, { modifiers: { ...NO_MODIFIERS, blockedPocket: 3 } });
    expect(balls[0].pocketed).toBe(true);
  });
});

describe('not leaking into the ordinary game', () => {
  it('runs identically with no options and with empty ones', () => {
    const make = (): Ball[] => {
      const cue = cueAt(300, 300, 1500, 220);
      const nine = createBall(9, 'stripe', 900, 380);
      return [cue, nine];
    };
    const bare = make();
    const withOpts = make();
    settle(bare);
    settle(withOpts, { modifiers: { ...NO_MODIFIERS }, pickups: [] });
    for (let i = 0; i < bare.length; i++) {
      expect(withOpts[i].pos.x).toBeCloseTo(bare[i].pos.x, 6);
      expect(withOpts[i].pos.y).toBeCloseTo(bare[i].pos.y, 6);
      expect(withOpts[i].pocketed).toBe(bare[i].pocketed);
    }
  });
});

describe('the aim guide', () => {
  it('shows a blocked pocket as blocked, rather than promising a pot', () => {
    // The guide and the shot run the same engine on purpose. If the modifiers reached only one
    // of them the line would draw a ball dropping into a pocket the bumper is covering — and a
    // guide you cannot trust is worse than no guide at all.
    const corner = POCKETS[0];
    // Object ball a short way in front of the pocket, cue ball straight behind it.
    const toPocket = { x: corner.mid.x - 500, y: corner.mid.y - 500 };
    const dir = { x: corner.mid.x - toPocket.x, y: corner.mid.y - toPocket.y };
    const len = Math.hypot(dir.x, dir.y);
    const unit = { x: dir.x / len, y: dir.y / len };

    const object = createBall(3, 'solid', toPocket.x, toPocket.y);
    const cue = createBall(CUE_BALL_ID, 'cue', toPocket.x - unit.x * 260, toPocket.y - unit.y * 260);
    const balls = [cue, object];
    const angle = Math.atan2(unit.y, unit.x);

    const preview = (mods?: Parameters<typeof computeTrajectoryPreview>[7]) =>
      computeTrajectoryPreview(balls, CUE_BALL_ID, angle, 'full', { x: 0, y: 0 }, 0.5, 0, mods);

    const open = preview();
    const blocked = preview({ ...NO_MODIFIERS, blockedPocket: 0 });

    expect(open.firstContactBallId, 'the control shot should strike the object ball').toBe(3);
    expect(blocked.firstContactBallId).toBe(3);

    const endOf = (segments: typeof open.objectBallPath) =>
      segments.length > 0 ? segments[segments.length - 1].to : toPocket;
    const a = endOf(open.objectBallPath);
    const b = endOf(blocked.objectBallPath);
    // Open, the drawn object-ball line ends in the bag; blocked, it comes back out.
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(BALL_RADIUS);
  });
});

describe('effects', () => {
  it('acts on the pocket nearest where it was collected', () => {
    for (const pocket of POCKETS) {
      expect(nearestPocketIndex(pocket.mid)).toBe(pocket.index);
    }
  });

  it('folds a magnet onto a pocket and a freeze onto a flag', () => {
    const magnet = applyPickup({ ...NO_MODIFIERS }, 'magnet', POCKETS[2].mid);
    expect(magnet.magnetPocket).toBe(2);
    expect(applyPickup({ ...NO_MODIFIERS }, 'freeze', POCKETS[0].mid).freezeGuide).toBe(true);
    expect(applyPickup({ ...NO_MODIFIERS }, 'bonus', POCKETS[0].mid).bonusVisit).toBe(true);
  });

  it('splits into the half that follows you and the half you hand over', () => {
    let mods = { ...NO_MODIFIERS };
    mods = applyPickup(mods, 'magnet', POCKETS[1].mid);
    mods = applyPickup(mods, 'freeze', POCKETS[1].mid);
    const { mine, theirs } = splitModifiers(mods);

    expect(mine.magnetPocket).toBe(1);
    expect(mine.freezeGuide).toBe(false);
    expect(theirs.freezeGuide).toBe(true);
    expect(theirs.magnetPocket).toBeNull();
  });
});
