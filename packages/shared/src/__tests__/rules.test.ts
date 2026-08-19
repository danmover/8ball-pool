import { describe, expect, it } from 'vitest';
import { createInitialGameState, legalTargetBallIds, resolveShot, summarizeShot } from '../rules.js';
import type { ShotOutcome } from '../rules.js';
import type { SimEvent } from '../types.js';

function outcome(over: Partial<ShotOutcome> = {}): ShotOutcome {
  return {
    potted: [],
    cueBallPocketed: false,
    eightBallPocketed: false,
    firstBallContacted: 1,
    anyCushionAfterContact: true,
    ...over,
  };
}

describe('summarizeShot', () => {
  it('extracts first contact, pots, and rail contact after that contact', () => {
    const pos = { x: 0, y: 0 };
    const events: SimEvent[] = [
      { type: 'ballCollision', a: 0, b: 3, pos, impulse: 400 },
      { type: 'cushion', ballId: 3, pos, speed: 200 },
      { type: 'pot', ballId: 3, pos },
    ];
    const result = summarizeShot(events);
    expect(result.firstBallContacted).toBe(3);
    expect(result.anyCushionAfterContact).toBe(true);
    expect(result.potted).toEqual([3]);
  });
});

describe('resolveShot - classic', () => {
  const newGame = () => createInitialGameState('classic', ['Alice', 'Bob']);

  it('flags a scratch on the break as a foul and hands over ball-in-hand', () => {
    const state = newGame();
    resolveShot(state, outcome({ potted: [0], cueBallPocketed: true }), false);
    expect(state.phase).toBe('ball_in_hand');
    expect(state.currentShooter).toBe('p2');
  });

  it('assigns groups on the first legal post-break pot', () => {
    const state = newGame();
    state.phase = 'aiming';
    resolveShot(state, outcome({ potted: [3], firstBallContacted: 3 }), false);
    expect(state.players.p1.group).toBe('solid');
    expect(state.players.p2.group).toBe('stripe');
    expect(state.currentShooter).toBe('p1'); // potted own ball, keeps turn
  });

  it('awards the win for a legal 8-ball pot once the group is cleared', () => {
    const state = newGame();
    state.phase = 'aiming';
    state.players.p1.group = 'solid';
    state.players.p2.group = 'stripe';
    resolveShot(state, outcome({ potted: [8], eightBallPocketed: true, firstBallContacted: 8 }), true);
    expect(state.phase).toBe('game_over');
    expect(state.winner).toBe('p1');
  });

  it('awards the opponent the win for an early 8-ball pot', () => {
    const state = newGame();
    state.phase = 'aiming';
    state.players.p1.group = 'solid';
    state.players.p2.group = 'stripe';
    resolveShot(state, outcome({ potted: [8], eightBallPocketed: true, firstBallContacted: 8 }), false);
    expect(state.phase).toBe('game_over');
    expect(state.winner).toBe('p2');
  });
});

describe('resolveShot - teams', () => {
  it('alternates teams around the table and shares a group across teammates', () => {
    const state = createInitialGameState('teams', ['A1', 'B1', 'A2', 'B2']);
    expect(state.players.p1.team).toBe('a');
    expect(state.players.p2.team).toBe('b');
    expect(state.players.p3.team).toBe('a');
    expect(state.players.p4.team).toBe('b');

    state.phase = 'aiming';
    resolveShot(state, outcome({ potted: [3], firstBallContacted: 3 }), false);
    // p1 potted a solid, so both team A seats get solids and both team B seats stripes.
    expect(state.players.p1.group).toBe('solid');
    expect(state.players.p3.group).toBe('solid');
    expect(state.players.p2.group).toBe('stripe');
    expect(state.players.p4.group).toBe('stripe');
  });

  it('passes the turn to the next seat in order, not just the other team', () => {
    const state = createInitialGameState('teams', ['A1', 'B1', 'A2', 'B2']);
    state.phase = 'aiming';
    resolveShot(state, outcome({ firstBallContacted: 3 }), false); // legal miss
    expect(state.currentShooter).toBe('p2');
  });
});

describe('resolveShot - rotation', () => {
  const newGame = () => {
    const state = createInitialGameState('rotation', ['A', 'B', 'C']);
    state.phase = 'aiming';
    return state;
  };

  it('only lets you target the lowest ball on the table', () => {
    const state = newGame();
    expect(legalTargetBallIds(state)).toEqual([1]);
    state.balls.find((b) => b.id === 1)!.pocketed = true;
    expect(legalTargetBallIds(state)).toEqual([2]);
  });

  it('scores potted balls at face value and keeps the turn', () => {
    const state = newGame();
    state.balls.find((b) => b.id === 5)!.pocketed = true;
    resolveShot(state, outcome({ potted: [5], firstBallContacted: 1 }), false, 1);
    expect(state.players.p1.score).toBe(5);
    expect(state.currentShooter).toBe('p1');
  });

  it('fouls and passes turn when the lowest ball is not struck first', () => {
    const state = newGame();
    resolveShot(state, outcome({ firstBallContacted: 7 }), false, 1);
    expect(state.phase).toBe('ball_in_hand');
    expect(state.currentShooter).toBe('p2');
    expect(state.lastFoulReason).toMatch(/1 ball first/);
  });

  it('rotates through all seats in order', () => {
    const state = newGame();
    resolveShot(state, outcome({ firstBallContacted: 1 }), false, 1);
    expect(state.currentShooter).toBe('p2');
    resolveShot(state, outcome({ firstBallContacted: 1 }), false, 1);
    expect(state.currentShooter).toBe('p3');
    resolveShot(state, outcome({ firstBallContacted: 1 }), false, 1);
    expect(state.currentShooter).toBe('p1');
  });

  it('ends the game with the highest scorer once the table clears', () => {
    const state = newGame();
    for (const b of state.balls) if (b.id !== 0) b.pocketed = true;
    state.players.p2.score = 50;
    resolveShot(state, outcome({ potted: [1], firstBallContacted: 1 }), false, 1);
    expect(state.phase).toBe('game_over');
    expect(state.winner).toBe('p2');
  });
});
