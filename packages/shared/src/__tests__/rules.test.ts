import { describe, expect, it } from 'vitest';
import {
  createInitialGameState,
  resolveShot,
  preShotFacts,
  callRequirement,
  legalTargetBallIds,
  armPower,
  spendArmed,
  STARTING_LIVES,
  MAX_LIVES,
  TIME_ATTACK_PENALTY_MS,
  challengeBalls,
  challengeById,
  type GameState,
  type ShotOutcome,
  type ResolveInput,
} from '../index.js';

function outcome(partial: Partial<ShotOutcome> = {}): ShotOutcome {
  const potted = partial.potted ?? [];
  return {
    potted,
    pottedIn: partial.pottedIn ?? Object.fromEntries(potted.map((id) => [id, 0])),
    cueBallPocketed: partial.cueBallPocketed ?? potted.includes(0),
    eightBallPocketed: partial.eightBallPocketed ?? potted.includes(8),
    firstBallContacted: partial.firstBallContacted === undefined ? 1 : partial.firstBallContacted,
    anyCushionAfterContact: partial.anyCushionAfterContact ?? true,
    cushionsBeforeContact: partial.cushionsBeforeContact ?? 0,
    objectBallsToRail: partial.objectBallsToRail ?? 4,
    collected: partial.collected ?? [],
    jumped: partial.jumped ?? false,
  };
}

/** Marks balls as potted before the shot, to set up a table. */
function pocket(state: GameState, ids: number[]): void {
  for (const b of state.balls) if (ids.includes(b.id)) b.pocketed = true;
}

/** Resolves a shot the way the session does: facts captured before, balls updated after. */
function play(state: GameState, o: ShotOutcome, extra: Partial<ResolveInput> = {}): GameState {
  const facts = preShotFacts(state);
  pocket(state, o.potted.filter((id) => id !== 0));
  return resolveShot(state, o, { ...facts, now: 0, rand: () => 0.5, ...extra });
}

function eightBall(opts: { players?: number; ruleSet?: 'standard' | 'pro' } = {}): GameState {
  const names = Array.from({ length: opts.players ?? 2 }, (_, i) => `P${i + 1}`);
  const state = createInitialGameState('eightball', names, { ruleSet: opts.ruleSet ?? 'standard', rand: () => 0.3 });
  state.phase = 'aiming';
  return state;
}

describe('8-ball', () => {
  it('breaks, keeps the table on a pot, and leaves the table open', () => {
    const s = createInitialGameState('eightball', ['A', 'B']);
    expect(s.phase).toBe('break');
    play(s, outcome({ potted: [3] }));
    expect(s.currentShooter).toBe('p1');
    expect(s.players.p1.group).toBeNull();
  });

  it('assigns groups on the first pot after the break', () => {
    const s = eightBall();
    play(s, outcome({ potted: [11], firstBallContacted: 11 }));
    expect(s.players.p1.group).toBe('stripe');
    expect(s.players.p2.group).toBe('solid');
    expect(s.currentShooter).toBe('p1');
  });

  it('passes the table on a miss and gives ball in hand on a foul', () => {
    const s = eightBall();
    play(s, outcome({ potted: [] }));
    expect(s.currentShooter).toBe('p2');
    expect(s.phase).toBe('aiming');
    play(s, outcome({ potted: [0] }));
    expect(s.currentShooter).toBe('p1');
    expect(s.phase).toBe('ball_in_hand');
    expect(s.lastShot?.foul).toMatch(/Scratch/);
  });

  it('fouls hitting the wrong group first', () => {
    const s = eightBall();
    s.players.p1.group = 'solid';
    s.players.p2.group = 'stripe';
    play(s, outcome({ firstBallContacted: 12, potted: [] }));
    expect(s.lastShot?.foul).toMatch(/wrong group/);
    expect(s.phase).toBe('ball_in_hand');
  });

  it('loses the frame for potting the 8 early', () => {
    const s = eightBall();
    s.players.p1.group = 'solid';
    s.players.p2.group = 'stripe';
    play(s, outcome({ firstBallContacted: 1, potted: [8], pottedIn: { 8: 2 } }));
    expect(s.phase).toBe('game_over');
    expect(s.winner).toBe('p2');
  });

  it('wins on the 8 in the called pocket and loses in the wrong one', () => {
    const win = eightBall();
    win.players.p1.group = 'solid';
    win.players.p2.group = 'stripe';
    pocket(win, [1, 2, 3, 4, 5, 6, 7]);
    expect(callRequirement(win)).toBe('pocket');
    expect(legalTargetBallIds(win)).toEqual([8]);
    play(win, outcome({ firstBallContacted: 8, potted: [8], pottedIn: { 8: 5 } }), { call: { ballId: 8, pocketIndex: 5 } });
    expect(win.winner).toBe('p1');
    expect(win.lastShot?.wonFrame).toBe(true);

    const lose = eightBall();
    lose.players.p1.group = 'solid';
    lose.players.p2.group = 'stripe';
    pocket(lose, [1, 2, 3, 4, 5, 6, 7]);
    play(lose, outcome({ firstBallContacted: 8, potted: [8], pottedIn: { 8: 5 } }), { call: { ballId: 8, pocketIndex: 0 } });
    expect(lose.winner).toBe('p2');
    expect(lose.lastFoulReason).toMatch(/wrong pocket/);
  });

  it('respots the 8 when it goes down on the break', () => {
    const s = createInitialGameState('eightball', ['A', 'B']);
    play(s, outcome({ potted: [8], pottedIn: { 8: 1 } }));
    expect(s.phase).not.toBe('game_over');
    expect(s.balls.find((b) => b.id === 8)!.pocketed).toBe(false);
  });

  it('plays doubles with a shared group', () => {
    const s = eightBall({ players: 4 });
    expect(s.players.p1.team).toBe('a');
    expect(s.players.p2.team).toBe('b');
    expect(s.players.p3.team).toBe('a');
    play(s, outcome({ potted: [2], firstBallContacted: 2 }));
    expect(s.players.p1.group).toBe('solid');
    expect(s.players.p3.group).toBe('solid');
    expect(s.players.p2.group).toBe('stripe');
    expect(s.players.p4.group).toBe('stripe');
  });

  it('ends the frame after three fouls in a row under pro rules', () => {
    const s = eightBall({ ruleSet: 'pro' });
    for (let i = 0; i < 3; i++) {
      s.currentShooter = 'p1';
      s.phase = 'aiming';
      play(s, outcome({ firstBallContacted: null, potted: [] }));
    }
    expect(s.phase).toBe('game_over');
    expect(s.winner).toBe('p2');
  });

  it('requires the called ball under pro rules to keep the visit', () => {
    const s = eightBall({ ruleSet: 'pro' });
    s.players.p1.group = 'solid';
    s.players.p2.group = 'stripe';
    expect(callRequirement(s)).toBe('ballAndPocket');
    play(s, outcome({ firstBallContacted: 1, potted: [2], pottedIn: { 2: 3 } }), { call: { ballId: 1, pocketIndex: 0 } });
    expect(s.currentShooter).toBe('p2');
  });

  it('tracks the visit run and frame stats', () => {
    const s = eightBall();
    play(s, outcome({ potted: [1] }));
    play(s, outcome({ potted: [2, 3] }));
    expect(s.visitRun).toBe(3);
    expect(s.players.p1.frame.pots).toBe(3);
    expect(s.players.p1.frame.bestShot).toBe(2);
    play(s, outcome({ potted: [] }));
    expect(s.visitRun).toBe(0);
    expect(s.players.p1.frame.bestRun).toBe(3);
  });
});

describe('9-ball', () => {
  it('fouls for not hitting the lowest ball first', () => {
    const s = createInitialGameState('nineball', ['A', 'B']);
    s.phase = 'aiming';
    play(s, outcome({ firstBallContacted: 3, potted: [] }));
    expect(s.lastShot?.foul).toMatch(/hit the 1/);
    expect(s.phase).toBe('ball_in_hand');
  });

  it('wins on the 9 off a legal combination', () => {
    const s = createInitialGameState('nineball', ['A', 'B']);
    s.phase = 'aiming';
    play(s, outcome({ firstBallContacted: 1, potted: [9] }));
    expect(s.winner).toBe('p1');
  });

  it('brings the 9 back up after a foul', () => {
    const s = createInitialGameState('nineball', ['A', 'B']);
    s.phase = 'aiming';
    play(s, outcome({ firstBallContacted: 4, potted: [9] }));
    expect(s.phase).toBe('ball_in_hand');
    expect(s.balls.find((b) => b.id === 9)!.pocketed).toBe(false);
  });
});

describe('Killer', () => {
  it('starts everyone on three lives and costs a life for a miss', () => {
    const s = createInitialGameState('killer', ['A', 'B', 'C'], { rand: () => 0.4 });
    expect(s.players.p1.lives).toBe(STARTING_LIVES);
    play(s, outcome({ potted: [] }));
    expect(s.players.p1.lives).toBe(STARTING_LIVES - 1);
    expect(s.currentShooter).toBe('p2');
  });

  it('passes on even after a pot, and the black gives a life back', () => {
    const s = createInitialGameState('killer', ['A', 'B'], { rand: () => 0.4 });
    s.players.p1.lives = 2;
    play(s, outcome({ potted: [8] }));
    expect(s.players.p1.lives).toBe(3);
    expect(s.currentShooter).toBe('p2');
    s.players.p2.lives = MAX_LIVES;
    play(s, outcome({ potted: [8] }));
    expect(s.players.p2.lives).toBe(MAX_LIVES);
  });

  it('eliminates at zero and crowns the last one standing', () => {
    const s = createInitialGameState('killer', ['A', 'B'], { rand: () => 0.4 });
    s.players.p1.lives = 1;
    play(s, outcome({ potted: [] }));
    expect(s.players.p1.eliminated).toBe(true);
    expect(s.phase).toBe('game_over');
    expect(s.winner).toBe('p2');
  });
});

describe('Power Pool', () => {
  it('scores points, the 8 is worth three, and fouls cost one', () => {
    const s = createInitialGameState('power', ['A', 'B'], { rand: () => 0.37 });
    expect(s.power?.orbs.length).toBeGreaterThan(0);
    s.phase = 'aiming';
    play(s, outcome({ potted: [1, 8] }));
    expect(s.players.p1.score).toBe(4);
    expect(s.currentShooter).toBe('p1');
    play(s, outcome({ potted: [0] }));
    expect(s.players.p1.score).toBe(3);
    expect(s.currentShooter).toBe('p2');
  });

  it('banks collected powers and spends the armed one', () => {
    const s = createInitialGameState('power', ['A', 'B'], { rand: () => 0.37 });
    s.phase = 'aiming';
    play(s, outcome({ potted: [2], collected: ['double', 'extra'] }));
    expect(s.power!.held.p1).toEqual(['double', 'extra']);
    expect(armPower(s, 'p1', 'double')).toBe(true);
    expect(armPower(s, 'p2', 'double')).toBe(false);
    const armed = spendArmed(s);
    expect(armed).toBe('double');
    play(s, outcome({ potted: [3, 4] }), { armed });
    expect(s.players.p1.score).toBe(1 + 4);
    expect(s.power!.held.p1).toEqual(['extra']);
  });

  it('keeps the table with Extra Shot and freezes the next player', () => {
    const s = createInitialGameState('power', ['A', 'B'], { rand: () => 0.37 });
    s.phase = 'aiming';
    play(s, outcome({ potted: [] }), { armed: 'extra' });
    expect(s.currentShooter).toBe('p1');
    play(s, outcome({ potted: [] }), { armed: 'freeze' });
    expect(s.currentShooter).toBe('p2');
    expect(s.power!.frozen).toEqual(['p2']);
    play(s, outcome({ potted: [] }));
    expect(s.power!.frozen).toEqual([]);
  });

  it('ends as soon as nobody can catch the leader', () => {
    const s = createInitialGameState('power', ['A', 'B'], { rand: () => 0.37 });
    s.phase = 'aiming';
    // Leave only balls 14 and 15 (2 points) and give p1 a big lead.
    pocket(s, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    s.players.p1.score = 10;
    play(s, outcome({ potted: [13] }));
    expect(s.phase).toBe('game_over');
    expect(s.winner).toBe('p1');
  });
});

describe('solo modes', () => {
  it('Time Attack adds penalties and finishes with stars', () => {
    const s = createInitialGameState('timeattack', ['Solo']);
    play(s, outcome({ potted: [0] }));
    expect(s.timeAttack!.penaltyMs).toBe(TIME_ATTACK_PENALTY_MS);
    expect(s.phase).toBe('ball_in_hand');
    s.phase = 'aiming';
    s.timeAttack!.elapsedMs = 60_000;
    play(s, outcome({ potted: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] }));
    expect(s.phase).toBe('game_over');
    expect(s.timeAttack!.finalMs).toBe(70_000);
    expect(s.timeAttack!.stars).toBe(3);
  });

  it('Trick shots judge the objective and the shot budget', () => {
    const challenge = challengeById('ch.straight')!;
    const s = createInitialGameState('trickshot', ['Solo']);
    s.balls = challengeBalls(challenge);
    s.trick = { challengeId: challenge.id, shotsUsed: 0, pottedOrder: [], stars: 0, failed: false };
    play(s, outcome({ firstBallContacted: 1, potted: [1] }));
    expect(s.phase).toBe('game_over');
    expect(s.trick.stars).toBe(3);
  });

  it('Practice never ends and hands the cue ball back on a scratch', () => {
    const s = createInitialGameState('practice', ['Solo']);
    play(s, outcome({ potted: [0] }));
    expect(s.phase).toBe('ball_in_hand');
    expect(s.currentShooter).toBe('p1');
  });
});
