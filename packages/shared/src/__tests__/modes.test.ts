import { describe, expect, it } from 'vitest';
import {
  MODE_ORDER,
  STARTING_LIVES,
  allModes,
  clampPlayerCount,
  createInitialGameState,
  legalTargetBallIds,
  modeDescriptor,
  resolveShot,
} from '../index.js';
import type { GameMode, GameState } from '../types.js';
import type { ShotOutcome } from '../rules.js';

function outcome(over: Partial<ShotOutcome> = {}): ShotOutcome {
  return {
    potted: [],
    cueBallPocketed: false,
    eightBallPocketed: false,
    firstBallContacted: 1,
    anyCushionAfterContact: true,
    cushionsBeforeContact: 0,
    ...over,
  };
}

/** Marks a ball down without going through the physics. */
function sink(state: GameState, ...ids: number[]): void {
  for (const id of ids) {
    const ball = state.balls.find((b) => b.id === id);
    if (ball) ball.pocketed = true;
  }
}

describe('mode registry', () => {
  it('lists every mode exactly once in menu order', () => {
    expect(new Set(MODE_ORDER).size).toBe(MODE_ORDER.length);
    expect(allModes().map((m) => m.id)).toEqual(MODE_ORDER);
  });

  it('gives every mode a name, blurb and at least one rule line', () => {
    for (const mode of allModes()) {
      expect(mode.name.length).toBeGreaterThan(0);
      expect(mode.blurb.length).toBeGreaterThan(0);
      expect(mode.rulesSummary.length).toBeGreaterThan(0);
      expect(mode.minPlayers).toBeLessThanOrEqual(mode.maxPlayers);
    }
  });

  it('clamps lobby size to what the mode can seat', () => {
    expect(clampPlayerCount('classic', 8)).toBe(2);
    expect(clampPlayerCount('cutthroat', 8)).toBe(5);
    expect(clampPlayerCount('killer', 1)).toBe(2);
  });

  it('racks a legal table for every mode', () => {
    for (const id of MODE_ORDER) {
      const balls = modeDescriptor(id as GameMode).rack(2);
      expect(balls.some((b) => b.id === 0)).toBe(true); // always a cue ball
      expect(balls.every((b) => !b.pocketed)).toBe(true);
      // No two balls may start on top of each other.
      for (let i = 0; i < balls.length; i++) {
        for (let j = i + 1; j < balls.length; j++) {
          const d = Math.hypot(balls[i].pos.x - balls[j].pos.x, balls[i].pos.y - balls[j].pos.y);
          expect(d).toBeGreaterThan(1);
        }
      }
    }
  });
});

describe('9-ball', () => {
  const newGame = (): GameState => {
    const state = createInitialGameState('nineball', ['A', 'B']);
    state.phase = 'aiming';
    return state;
  };

  it('racks only balls 1-9', () => {
    const ids = newGame().balls.map((b) => b.id).sort((a, b) => a - b);
    expect(ids).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('requires the lowest ball first', () => {
    const state = newGame();
    expect(legalTargetBallIds(state)).toEqual([1]);
    sink(state, 1);
    expect(legalTargetBallIds(state)).toEqual([2]);
  });

  it('wins the frame for a legal 9, including off a combination', () => {
    const state = newGame();
    // Struck the 1, but the 9 went in off it — that's a win.
    resolveShot(state, outcome({ potted: [9], firstBallContacted: 1 }), false, 1);
    expect(state.phase).toBe('game_over');
    expect(state.winner).toBe('p1');
  });

  it('spots the 9 back up when it is fouled in', () => {
    const state = newGame();
    resolveShot(state, outcome({ potted: [9], cueBallPocketed: true, firstBallContacted: 1 }), false, 1);
    expect(state.phase).toBe('ball_in_hand');
    expect(state.balls.find((b) => b.id === 9)!.pocketed).toBe(false);
    expect(state.currentShooter).toBe('p2');
  });

  it('keeps the shooter at the table after any legal pot', () => {
    const state = newGame();
    resolveShot(state, outcome({ potted: [1], firstBallContacted: 1 }), false, 1);
    expect(state.currentShooter).toBe('p1');
    resolveShot(state, outcome({ firstBallContacted: 2 }), false, 2);
    expect(state.currentShooter).toBe('p2');
  });
});

describe('cutthroat', () => {
  const newGame = (): GameState => {
    const state = createInitialGameState('cutthroat', ['A', 'B', 'C']);
    state.phase = 'aiming';
    return state;
  };

  it('deals the object balls out evenly', () => {
    const state = newGame();
    expect(state.players.p1.ownedBalls).toEqual([1, 2, 3, 4, 5]);
    expect(state.players.p2.ownedBalls).toEqual([6, 7, 8, 9, 10]);
    expect(state.players.p3.ownedBalls).toEqual([11, 12, 13, 14, 15]);
  });

  it('leaves no ball unowned when the count does not divide evenly', () => {
    for (const seats of [2, 4, 5]) {
      const state = createInitialGameState('cutthroat', Array(seats).fill('P'));
      const owned = state.seatOrder.flatMap((s) => state.players[s].ownedBalls).sort((a, b) => a - b);
      expect(owned).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    }
  });

  it('never offers your own balls as legal targets', () => {
    const state = newGame();
    const targets = legalTargetBallIds(state);
    expect(targets).not.toContain(1);
    expect(targets).toContain(6);
  });

  it('fouls when you strike one of your own first', () => {
    const state = newGame();
    resolveShot(state, outcome({ firstBallContacted: 2 }), false);
    expect(state.phase).toBe('ball_in_hand');
    expect(state.lastFoulReason).toMatch(/own balls/);
  });

  it('keeps the turn when you pot an opponent ball', () => {
    const state = newGame();
    sink(state, 7);
    resolveShot(state, outcome({ potted: [7], firstBallContacted: 7 }), false);
    expect(state.currentShooter).toBe('p1');
  });

  it('eliminates a player whose last ball goes down, and ends on the survivor', () => {
    const state = newGame();
    sink(state, 6, 7, 8, 9, 10); // p2 wiped out
    resolveShot(state, outcome({ potted: [10], firstBallContacted: 6 }), false);
    expect(state.players.p2.eliminated).toBe(true);
    expect(state.phase).not.toBe('game_over'); // p1 and p3 are still in

    sink(state, 11, 12, 13, 14, 15); // p3 wiped out too
    resolveShot(state, outcome({ potted: [15], firstBallContacted: 11 }), false);
    expect(state.phase).toBe('game_over');
    expect(state.winner).toBe('p1');
  });

  it('skips eliminated players in turn order', () => {
    const state = newGame();
    state.players.p2.eliminated = true;
    resolveShot(state, outcome({ firstBallContacted: 11 }), false); // legal miss
    expect(state.currentShooter).toBe('p3');
  });
});

describe('killer', () => {
  const newGame = (): GameState => {
    const state = createInitialGameState('killer', ['A', 'B']);
    state.phase = 'aiming';
    return state;
  };

  it('starts everyone on the same number of lives', () => {
    const state = newGame();
    expect(state.players.p1.lives).toBe(STARTING_LIVES);
    expect(state.players.p2.lives).toBe(STARTING_LIVES);
  });

  it('costs a life for failing to pot', () => {
    const state = newGame();
    resolveShot(state, outcome({ firstBallContacted: 3 }), false);
    expect(state.players.p1.lives).toBe(STARTING_LIVES - 1);
    expect(state.currentShooter).toBe('p2');
  });

  it('costs nothing when you pot something', () => {
    const state = newGame();
    sink(state, 3);
    resolveShot(state, outcome({ potted: [3], firstBallContacted: 3 }), false);
    expect(state.players.p1.lives).toBe(STARTING_LIVES);
    // The table still passes on — that's what makes every visit count.
    expect(state.currentShooter).toBe('p2');
  });

  it('eliminates at zero lives and ends the frame on the survivor', () => {
    const state = newGame();
    state.players.p1.lives = 1;
    resolveShot(state, outcome({ firstBallContacted: 3 }), false);
    expect(state.players.p1.eliminated).toBe(true);
    expect(state.phase).toBe('game_over');
    expect(state.winner).toBe('p2');
  });

  it('re-racks rather than running out of balls', () => {
    const state = newGame();
    sink(state, ...state.balls.filter((b) => b.id !== 0).map((b) => b.id));
    resolveShot(state, outcome({ potted: [15], firstBallContacted: 15 }), false);
    expect(state.balls.filter((b) => !b.pocketed && b.id !== 0).length).toBe(15);
  });
});

describe('sandbox', () => {
  it('never changes shooter, fouls, or ends', () => {
    const state = createInitialGameState('sandbox', ['Solo']);
    state.phase = 'aiming';
    resolveShot(state, outcome({ cueBallPocketed: true, firstBallContacted: null }), false);
    expect(state.phase).toBe('ball_in_hand'); // cue ball handed back
    expect(state.winner).toBeNull();
    expect(state.lastFoulReason).toBeNull();
    expect(state.currentShooter).toBe('p1');
  });
});

describe('shot clock', () => {
  it('is a foul in every mode that supports it', () => {
    for (const mode of allModes().filter((m) => m.supportsShotClock)) {
      const state = createInitialGameState(mode.id, ['A', 'B', 'C']);
      state.phase = 'aiming';
      const before = state.currentShooter;
      const after = resolveShot(state, outcome({ firstBallContacted: null }), false, 1, true);
      // Timing out always costs you something: the table, the frame, or a life.
      const punished =
        after.currentShooter !== before ||
        after.phase === 'game_over' ||
        after.players[before].lives !== null;
      expect(punished).toBe(true);
    }
  });
});
