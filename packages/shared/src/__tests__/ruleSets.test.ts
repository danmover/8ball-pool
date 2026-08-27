import { describe, expect, it } from 'vitest';
import { createInitialGameState, resolveShot, summarizeShot } from '../rules.js';
import type { ShotOutcome } from '../rules.js';
import { BREAK_BALLS_TO_RAIL, FOUL_LIMIT, RULE_SETS, ruleOptions } from '../ruleSets.js';
import type { SimEvent } from '../types.js';

/**
 * The 8-ball rules were a simplification: no call shot, no requirement on the break, no
 * kitchen, no three-foul. Each is now a switch, grouped into presets so a party game doesn't
 * become pedantic by default — which is exactly what these tests pin down.
 */

function outcome(over: Partial<ShotOutcome> = {}): ShotOutcome {
  return {
    potted: [],
    pottedIn: {},
    cueBallPocketed: false,
    eightBallPocketed: false,
    firstBallContacted: 1,
    anyCushionAfterContact: true,
    cushionsBeforeContact: 0,
    objectBallsToRail: BREAK_BALLS_TO_RAIL,
    ...over,
  };
}

const pos = { x: 0, y: 0 };

describe('rule presets', () => {
  it('leaves casual play completely unrefereed', () => {
    const casual = ruleOptions('casual');
    expect(Object.values(casual).every((v) => v === false)).toBe(true);
  });

  it('turns everything on for tournament', () => {
    const tournament = ruleOptions('tournament');
    expect(Object.values(tournament).every((v) => v === true)).toBe(true);
  });

  it('has pub sitting between the two', () => {
    const pub = RULE_SETS.pub.options;
    expect(pub.breakRequirement).toBe(true);
    expect(pub.kitchenAfterBreakScratch).toBe(true);
    // Flukes still count down the pub — that's the whole character of the preset.
    expect(pub.callShot).toBe(false);
    expect(pub.threeFoul).toBe(false);
  });
});

describe('summarizeShot', () => {
  it('counts distinct object balls reaching a rail, not rail hits', () => {
    // One ball rattling round a corner would otherwise satisfy the break requirement alone.
    const events: SimEvent[] = [
      { type: 'ballCollision', a: 0, b: 1, pos, impulse: 400 },
      { type: 'cushion', ballId: 1, pos, speed: 300 },
      { type: 'cushion', ballId: 1, pos, speed: 200 },
      { type: 'cushion', ballId: 1, pos, speed: 120 },
      { type: 'cushion', ballId: 2, pos, speed: 200 },
    ];
    expect(summarizeShot(events).objectBallsToRail).toBe(2);
  });

  it('ignores the cue ball when counting balls to a rail', () => {
    const events: SimEvent[] = [
      { type: 'ballCollision', a: 0, b: 1, pos, impulse: 400 },
      { type: 'cushion', ballId: 0, pos, speed: 300 },
    ];
    expect(summarizeShot(events).objectBallsToRail).toBe(0);
  });

  it('records which pocket each ball went into', () => {
    const events: SimEvent[] = [
      { type: 'ballCollision', a: 0, b: 3, pos, impulse: 400 },
      { type: 'pot', ballId: 3, pos, pocketIndex: 4 },
    ];
    expect(summarizeShot(events).pottedIn[3]).toBe(4);
  });
});

describe('break requirement', () => {
  const breakGame = (ruleSet: 'casual' | 'pub') =>
    createInitialGameState('classic', ['A', 'B'], 0, ruleSet);

  it('fouls a break that does nothing', () => {
    const state = breakGame('pub');
    resolveShot(state, outcome({ objectBallsToRail: 1 }), false);
    expect(state.lastFoulReason).toMatch(/Illegal break/);
    expect(state.currentShooter).toBe('p2');
  });

  it('accepts a break that pots instead of driving balls to a rail', () => {
    const state = breakGame('pub');
    resolveShot(state, outcome({ objectBallsToRail: 0, potted: [3], pottedIn: { 3: 0 } }), false);
    expect(state.lastFoulReason).toBeNull();
  });

  it('does not apply in casual play', () => {
    const state = breakGame('casual');
    resolveShot(state, outcome({ objectBallsToRail: 0 }), false);
    expect(state.lastFoulReason).toBeNull();
  });
});

describe('the kitchen', () => {
  it('restricts the incoming player after a scratch on the break', () => {
    const state = createInitialGameState('classic', ['A', 'B'], 0, 'pub');
    resolveShot(state, outcome({ potted: [0], cueBallPocketed: true }), false);
    expect(state.phase).toBe('ball_in_hand');
    expect(state.ballInHandBehindLine).toBe(true);
  });

  it('does not restrict them after an ordinary mid-frame scratch', () => {
    const state = createInitialGameState('classic', ['A', 'B'], 0, 'pub');
    state.phase = 'aiming';
    resolveShot(state, outcome({ potted: [0], cueBallPocketed: true }), false);
    expect(state.phase).toBe('ball_in_hand');
    expect(state.ballInHandBehindLine).toBe(false);
  });

  it('is off in casual play', () => {
    const state = createInitialGameState('classic', ['A', 'B'], 0, 'casual');
    resolveShot(state, outcome({ potted: [0], cueBallPocketed: true }), false);
    expect(state.ballInHandBehindLine).toBe(false);
  });
});

describe('call shot', () => {
  const game = () => {
    const state = createInitialGameState('classic', ['A', 'B'], 0, 'tournament');
    state.phase = 'aiming';
    state.players.p1.group = 'solid';
    state.players.p2.group = 'stripe';
    return state;
  };

  it('keeps the table when the called ball drops in the called pocket', () => {
    const state = game();
    resolveShot(state, outcome({ potted: [3], pottedIn: { 3: 2 }, firstBallContacted: 3 }), false, null, false, {
      ballId: 3,
      pocketIndex: 2,
    });
    expect(state.currentShooter).toBe('p1');
  });

  it('ends the visit when the ball drops in a different pocket', () => {
    // The whole point of call shot: a fluke keeps the ball down but not the table.
    const state = game();
    resolveShot(state, outcome({ potted: [3], pottedIn: { 3: 5 }, firstBallContacted: 3 }), false, null, false, {
      ballId: 3,
      pocketIndex: 2,
    });
    expect(state.currentShooter).toBe('p2');
  });

  it('still lets a fluke keep the table in casual play', () => {
    const state = createInitialGameState('classic', ['A', 'B'], 0, 'casual');
    state.phase = 'aiming';
    state.players.p1.group = 'solid';
    state.players.p2.group = 'stripe';
    resolveShot(state, outcome({ potted: [3], pottedIn: { 3: 5 }, firstBallContacted: 3 }), false);
    expect(state.currentShooter).toBe('p1');
  });

  it('loses the frame for the 8-ball in an uncalled pocket', () => {
    const state = game();
    resolveShot(
      state,
      outcome({ potted: [8], pottedIn: { 8: 5 }, eightBallPocketed: true, firstBallContacted: 8 }),
      true,
      null,
      false,
      { ballId: 8, pocketIndex: 0 }
    );
    expect(state.phase).toBe('game_over');
    expect(state.winner).toBe('p2');
    expect(state.lastFoulReason).toMatch(/wrong pocket/);
  });
});

describe('three-foul rule', () => {
  const foul = (state: ReturnType<typeof createInitialGameState>): void => {
    // Wrong ball first, from whoever is up — a plain foul in every rule set.
    state.phase = 'aiming';
    resolveShot(state, outcome({ firstBallContacted: 9 }), false);
  };

  it('loses the frame on the third consecutive foul', () => {
    const state = createInitialGameState('classic', ['A', 'B'], 0, 'tournament');
    state.players.p1.group = 'solid';
    state.players.p2.group = 'stripe';

    // p1 fouls, then p2, then p1... so drive one seat's count up by putting it back on them.
    for (let i = 0; i < FOUL_LIMIT; i++) {
      state.currentShooter = 'p1';
      foul(state);
    }
    expect(state.phase).toBe('game_over');
    expect(state.winner).toBe('p2');
    expect(state.lastFoulReason).toMatch(/fouls in a row/);
  });

  it('resets the count on any legal shot', () => {
    const state = createInitialGameState('classic', ['A', 'B'], 0, 'tournament');
    state.players.p1.group = 'solid';
    state.players.p2.group = 'stripe';

    state.currentShooter = 'p1';
    foul(state);
    state.currentShooter = 'p1';
    foul(state);
    expect(state.consecutiveFouls.p1).toBe(2);

    state.currentShooter = 'p1';
    state.phase = 'aiming';
    resolveShot(state, outcome({ potted: [3], pottedIn: { 3: 0 }, firstBallContacted: 3 }), false, null, false, {
      ballId: 3,
      pocketIndex: 0,
    });
    expect(state.consecutiveFouls.p1).toBe(0);
    expect(state.phase).not.toBe('game_over');
  });

  it('is off outside tournament rules', () => {
    const state = createInitialGameState('classic', ['A', 'B'], 0, 'pub');
    state.players.p1.group = 'solid';
    state.players.p2.group = 'stripe';
    for (let i = 0; i < FOUL_LIMIT + 2; i++) {
      state.currentShooter = 'p1';
      foul(state);
    }
    expect(state.phase).not.toBe('game_over');
  });
});
