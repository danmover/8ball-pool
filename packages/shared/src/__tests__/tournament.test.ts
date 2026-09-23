import { describe, expect, it } from 'vitest';
import {
  bracketSize,
  createTournament,
  nextMatch,
  recordFrameWin,
  roundName,
  roundReached,
  seedOrder,
  type Tournament,
} from '../tournament.js';
import type { Seat } from '../types.js';

/**
 * Bracket bugs are the kind that only surface on the semi-final in front of six people, so the
 * whole thing is pure and tested exhaustively here rather than discovered live.
 */

const seats = (n: number): Seat[] => Array.from({ length: n }, (_, i) => `p${i + 1}`);

/** Plays the bracket out with a given winner rule, and returns the champion. */
function playOut(t: Tournament, pick: (a: Seat, b: Seat) => Seat): Seat | null {
  for (let guard = 0; guard < 200; guard++) {
    const match = nextMatch(t);
    if (!match) break;
    const winner = pick(match.a!, match.b!);
    // A match may be a best-of, so keep feeding frames until it resolves.
    for (let f = 0; f < t.target; f++) recordFrameWin(t, match.id, winner);
  }
  return t.champion;
}

describe('seeding', () => {
  it('keeps the top two seeds apart until the final', () => {
    // The naive "1 plays 2" order puts the best two in round one, which is exactly what a
    // seeded bracket exists to prevent.
    const order = seedOrder(8);
    const half = order.slice(0, order.length / 2);
    expect(half).toContain(0);
    expect(half).not.toContain(1);
  });

  it('pairs the strongest remaining against the weakest', () => {
    const order = seedOrder(8);
    for (let i = 0; i < order.length; i += 2) {
      expect(order[i] + order[i + 1]).toBe(order.length - 1);
    }
  });

  it('uses every seed exactly once', () => {
    for (const size of [2, 4, 8, 16]) {
      const order = seedOrder(size);
      expect(order).toHaveLength(size);
      expect(new Set(order).size).toBe(size);
    }
  });

  it('rounds odd entrant counts up to a full bracket', () => {
    expect(bracketSize(2)).toBe(2);
    expect(bracketSize(3)).toBe(4);
    expect(bracketSize(5)).toBe(8);
    expect(bracketSize(8)).toBe(8);
  });
});

describe('bracket structure', () => {
  it('builds the right number of matches', () => {
    // A knockout of n always has n-1 matches, because every match eliminates exactly one.
    for (const n of [2, 4, 8]) {
      const t = createTournament(seats(n));
      expect(t.matches).toHaveLength(n - 1);
    }
  });

  it('names rounds by how far they are from the final', () => {
    const t = createTournament(seats(8));
    expect(roundName(t, 3)).toBe('Final');
    expect(roundName(t, 2)).toBe('Semi-final');
    expect(roundName(t, 1)).toBe('Quarter-final');
  });

  it('starts with a playable match', () => {
    const t = createTournament(seats(4));
    const first = nextMatch(t);
    expect(first).not.toBeNull();
    expect(first!.a).not.toBeNull();
    expect(first!.b).not.toBeNull();
  });
});

describe('byes', () => {
  it('gives the spare slots to the top seeds', () => {
    // Three entrants in a bracket of four: the top seed shouldn't have to play an extra match.
    const t = createTournament(seats(3));
    const first = t.matches.find((m) => m.round === 1 && m.winner)!;
    expect(first.winner).toBe('p1');
  });

  it('never asks anyone to play an empty slot', () => {
    for (let n = 3; n <= 8; n++) {
      const t = createTournament(seats(n));
      for (let guard = 0; guard < 50; guard++) {
        const match = nextMatch(t);
        if (!match) break;
        expect(match.a, `bracket of ${n} offered a match with an empty side`).not.toBeNull();
        expect(match.b, `bracket of ${n} offered a match with an empty side`).not.toBeNull();
        recordFrameWin(t, match.id, match.a!);
      }
    }
  });

  it('still produces a champion from an awkward count', () => {
    for (let n = 2; n <= 8; n++) {
      const t = createTournament(seats(n));
      expect(playOut(t, (a) => a), `bracket of ${n} never finished`).not.toBeNull();
    }
  });
});

describe('playing it out', () => {
  it('crowns the player who wins every match', () => {
    const t = createTournament(seats(8));
    expect(playOut(t, (a, b) => (a === 'p1' || b === 'p1' ? 'p1' : a))).toBe('p1');
  });

  it('tracks the running score inside a best-of match', () => {
    const t = createTournament(seats(4), 3);
    const match = nextMatch(t)!;
    expect(recordFrameWin(t, match.id, match.a!)).toBeNull(); // 1-0, not decided
    expect(recordFrameWin(t, match.id, match.b!)).toBeNull(); // 1-1
    expect(recordFrameWin(t, match.id, match.a!)).toBeNull(); // 2-1
    expect(recordFrameWin(t, match.id, match.a!)).not.toBeNull(); // 3-1, done
    expect(match.score[match.a!]).toBe(3);
  });

  it('stays on the same match until it is actually won', () => {
    const t = createTournament(seats(4), 2);
    const match = nextMatch(t)!;
    recordFrameWin(t, match.id, match.a!);
    expect(nextMatch(t)!.id).toBe(match.id);
  });

  it('ignores frames recorded against a finished match', () => {
    const t = createTournament(seats(4), 1);
    const match = nextMatch(t)!;
    recordFrameWin(t, match.id, match.a!);
    expect(recordFrameWin(t, match.id, match.b!)).toBeNull();
    expect(match.winner).toBe(match.a);
  });

  it('feeds winners into the round above', () => {
    const t = createTournament(seats(4));
    const first = nextMatch(t)!;
    recordFrameWin(t, first.id, first.a!);
    const final = t.matches.find((m) => m.round === 2)!;
    expect([final.a, final.b]).toContain(first.a);
  });

  it('reports no next match once there is a champion', () => {
    const t = createTournament(seats(4));
    playOut(t, (a) => a);
    expect(nextMatch(t)).toBeNull();
    expect(t.champion).not.toBeNull();
  });

  it('lets a lower seed win the whole thing', () => {
    // Seeding decides the path, not the result.
    const t = createTournament(seats(8));
    expect(playOut(t, (a, b) => (a === 'p8' || b === 'p8' ? 'p8' : b))).toBe('p8');
  });
});

describe('standings', () => {
  it('ranks by the round reached, champion first', () => {
    const t = createTournament(seats(8));
    // The lower-numbered seat always wins.
    playOut(t, (a, b) => (Number(a.slice(1)) < Number(b.slice(1)) ? a : b));
    const reached = roundReached(t);
    expect(reached.get('p1')).toBe(4);
    expect(reached.get('p2')).toBe(3);
    expect([reached.get('p3'), reached.get('p4')]).toEqual([2, 2]);
    for (const s of ['p5', 'p6', 'p7', 'p8']) expect(reached.get(s)).toBe(1);
  });
});
