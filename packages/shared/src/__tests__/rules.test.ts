import { describe, expect, it } from 'vitest';
import { createInitialGameState, resolveShot, summarizeShot } from '../rules.js';
import type { SimEvent } from '../types.js';

describe('summarizeShot', () => {
  it('extracts first contact, pots, and rail contact after that contact', () => {
    const events: SimEvent[] = [
      { type: 'ballCollision', a: 0, b: 3 },
      { type: 'cushion', ballId: 3 },
      { type: 'pot', ballId: 3 },
    ];
    const outcome = summarizeShot(events);
    expect(outcome.firstBallContacted).toBe(3);
    expect(outcome.anyCushionAfterContact).toBe(true);
    expect(outcome.potted).toEqual([3]);
  });
});

describe('resolveShot', () => {
  it('flags a scratch on the break as a foul and hands over ball-in-hand', () => {
    const state = createInitialGameState('Alice', 'Bob');
    const outcome = { potted: [0], cueBallPocketed: true, eightBallPocketed: false, firstBallContacted: 1, anyCushionAfterContact: true };
    resolveShot(state, outcome, false);
    expect(state.phase).toBe('ball_in_hand');
    expect(state.currentShooter).toBe('p2');
  });

  it('assigns groups on the first legal post-break pot', () => {
    const state = createInitialGameState('Alice', 'Bob');
    state.phase = 'aiming';
    const outcome = { potted: [3], cueBallPocketed: false, eightBallPocketed: false, firstBallContacted: 3, anyCushionAfterContact: true };
    resolveShot(state, outcome, false);
    expect(state.players.p1.group).toBe('solid');
    expect(state.players.p2.group).toBe('stripe');
    expect(state.currentShooter).toBe('p1'); // potted own ball, keeps turn
  });

  it('awards the win for a legal 8-ball pot once the group is cleared', () => {
    const state = createInitialGameState('Alice', 'Bob');
    state.phase = 'aiming';
    state.players.p1.group = 'solid';
    state.players.p2.group = 'stripe';
    const outcome = { potted: [8], cueBallPocketed: false, eightBallPocketed: true, firstBallContacted: 8, anyCushionAfterContact: true };
    resolveShot(state, outcome, true);
    expect(state.phase).toBe('game_over');
    expect(state.winner).toBe('p1');
  });

  it('awards the opponent the win for an early 8-ball pot', () => {
    const state = createInitialGameState('Alice', 'Bob');
    state.phase = 'aiming';
    state.players.p1.group = 'solid';
    state.players.p2.group = 'stripe';
    const outcome = { potted: [8], cueBallPocketed: false, eightBallPocketed: true, firstBallContacted: 8, anyCushionAfterContact: true };
    resolveShot(state, outcome, false); // group not actually cleared yet
    expect(state.phase).toBe('game_over');
    expect(state.winner).toBe('p2');
  });
});
