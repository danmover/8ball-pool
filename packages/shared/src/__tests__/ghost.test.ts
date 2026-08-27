import { describe, expect, it } from 'vitest';
import { createInitialGameState, resolveShot } from '../rules.js';
import type { ShotOutcome } from '../rules.js';
import { CUE_BALL_ID } from '../constants.js';
import type { GameState } from '../types.js';

/**
 * Playing the ghost: one visit, one chance. The pressure comes from the format rather than
 * from an opponent, so the rules that end a rack are the whole mode and are what's tested.
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
    objectBallsToRail: 4,
    ...over,
  };
}

const game = (): GameState => createInitialGameState('ghost', ['Solo']);

/** Marks every ball down except the ones named, so a clearance can be set up. */
function leaveOnly(state: GameState, ids: number[]): void {
  for (const b of state.balls) {
    if (b.id !== CUE_BALL_ID) b.pocketed = !ids.includes(b.id);
  }
}

describe('ghost mode', () => {
  it('seats exactly one player', () => {
    const state = game();
    expect(state.seatOrder).toHaveLength(1);
  });

  it('forgives the break, which nobody can be expected to pot on', () => {
    const state = game();
    expect(state.phase).toBe('break');
    resolveShot(state, outcome({ potted: [] }), false);
    expect(state.phase).toBe('aiming');
  });

  it('keeps the visit alive while balls keep dropping', () => {
    const state = game();
    state.phase = 'aiming';
    resolveShot(state, outcome({ potted: [3], pottedIn: { 3: 0 } }), false);
    expect(state.phase).toBe('aiming');
    expect(state.players.p1.score).toBe(1);
  });

  it('loses the rack on a miss', () => {
    const state = game();
    state.phase = 'aiming';
    resolveShot(state, outcome({ potted: [] }), false);
    expect(state.phase).toBe('game_over');
    // Nobody wins: the ghost isn't a seat, and inventing a phantom player would ripple
    // through every scoreboard in the game.
    expect(state.winner).toBeNull();
    expect(state.lastFoulReason).toMatch(/Missed/);
  });

  it('loses the rack on a scratch even if something went down', () => {
    const state = game();
    state.phase = 'aiming';
    resolveShot(state, outcome({ potted: [3, 0], cueBallPocketed: true }), false);
    expect(state.phase).toBe('game_over');
    expect(state.lastFoulReason).toMatch(/Scratch/);
  });

  it('loses the rack when nothing is contacted', () => {
    const state = game();
    state.phase = 'aiming';
    resolveShot(state, outcome({ firstBallContacted: null }), false);
    expect(state.phase).toBe('game_over');
    expect(state.lastFoulReason).toMatch(/No contact/);
  });

  it('loses the rack when the clock runs out', () => {
    const state = game();
    state.phase = 'aiming';
    resolveShot(state, outcome(), false, null, true);
    expect(state.phase).toBe('game_over');
    expect(state.lastFoulReason).toMatch(/clock/);
  });

  it('beats the ghost when the last ball drops', () => {
    const state = game();
    state.phase = 'aiming';
    leaveOnly(state, [7]);
    // Potting the last one clears the table, which is the win.
    state.balls.find((b) => b.id === 7)!.pocketed = true;
    resolveShot(state, outcome({ potted: [7], pottedIn: { 7: 2 } }), false);
    expect(state.phase).toBe('game_over');
    expect(state.winner).toBe('p1');
    expect(state.lastFoulReason).toBeNull();
  });

  it('counts a clearance as a win even on the shot that would otherwise foul', () => {
    // Clearing the table takes priority: potting the last ball *and* scratching still counts,
    // because there is nothing left to punish you with.
    const state = game();
    state.phase = 'aiming';
    leaveOnly(state, []);
    resolveShot(state, outcome({ potted: [0], cueBallPocketed: true }), false);
    expect(state.winner).toBe('p1');
  });
});
