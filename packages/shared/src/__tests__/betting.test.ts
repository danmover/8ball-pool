import { describe, expect, it } from 'vitest';
import {
  STAKES,
  newRound,
  oddsFor,
  placeBet,
  poolFor,
  settle,
  totalPool,
  type BettingRound,
} from '../betting.js';

/**
 * A tote pays out exactly what was staked and not a chalk more. Every test here is ultimately
 * about that conservation property — a book that can print money is a bug you only notice
 * after someone has spent it.
 */

const round = (bets: [string, string, number][]): BettingRound => {
  const r = newRound();
  for (const [who, on, amount] of bets) {
    placeBet(r, { bettorId: who, name: who, on, amount });
  }
  return r;
};

describe('taking bets', () => {
  it('accepts a stake from the list', () => {
    const r = newRound();
    expect(placeBet(r, { bettorId: 'a', name: 'A', on: 'p1', amount: STAKES[0] })).toBe(true);
    expect(totalPool(r)).toBe(STAKES[0]);
  });

  it('refuses an amount that is not one of the offered stakes', () => {
    // The list is what stops "bet 999999" from being a text field anyone can type into.
    const r = newRound();
    expect(placeBet(r, { bettorId: 'a', name: 'A', on: 'p1', amount: 37 })).toBe(false);
    expect(placeBet(r, { bettorId: 'a', name: 'A', on: 'p1', amount: -50 })).toBe(false);
    expect(totalPool(r)).toBe(0);
  });

  it('replaces rather than stacks, so nobody backs both players', () => {
    const r = round([
      ['a', 'p1', 50],
      ['a', 'p2', 25],
    ]);
    expect(r.bets).toHaveLength(1);
    expect(r.bets[0].on).toBe('p2');
    expect(totalPool(r)).toBe(25);
  });

  it('refuses everything once the book is closed', () => {
    const r = round([['a', 'p1', 50]]);
    r.open = false;
    expect(placeBet(r, { bettorId: 'b', name: 'B', on: 'p2', amount: 50 })).toBe(false);
    // Including a change of mind from someone already in.
    expect(placeBet(r, { bettorId: 'a', name: 'A', on: 'p2', amount: 50 })).toBe(false);
    expect(r.bets[0].on).toBe('p1');
  });
});

describe('odds', () => {
  it('reports nothing on a seat nobody backed', () => {
    expect(oddsFor(round([['a', 'p1', 50]]), 'p2')).toBe(0);
  });

  it('is 1× when everyone is on the same side', () => {
    // Reporting 2× here and then handing back the stake would be the sort of lie a player
    // never forgives.
    const r = round([
      ['a', 'p1', 50],
      ['b', 'p1', 50],
    ]);
    expect(oddsFor(r, 'p1')).toBe(1);
  });

  it('lengthens as the room piles onto the other side', () => {
    const even = round([
      ['a', 'p1', 50],
      ['b', 'p2', 50],
    ]);
    expect(oddsFor(even, 'p1')).toBe(2);

    const lopsided = round([
      ['a', 'p1', 25],
      ['b', 'p2', 100],
      ['c', 'p2', 100],
    ]);
    expect(oddsFor(lopsided, 'p1')).toBeCloseTo(9, 5);
    expect(oddsFor(lopsided, 'p2')).toBeCloseTo(225 / 200, 5);
  });
});

describe('settling', () => {
  it('pays the winners the losers money, in proportion', () => {
    const r = round([
      ['a', 'p1', 50],
      ['b', 'p1', 50],
      ['c', 'p2', 100],
    ]);
    const payouts = settle(r, 'p1');
    expect(payouts.find((p) => p.bettorId === 'a')!.returned).toBe(100);
    expect(payouts.find((p) => p.bettorId === 'b')!.returned).toBe(100);
    expect(payouts.find((p) => p.bettorId === 'c')!.returned).toBe(0);
  });

  it('never pays out more than was staked', () => {
    // The property that matters. Awkward splits round down, and the remainder simply is not
    // paid — a book that creates chalk is a bug you only find after it has been spent.
    for (const bets of [
      [['a', 'p1', 10], ['b', 'p2', 25], ['c', 'p2', 100]],
      [['a', 'p1', 25], ['b', 'p1', 10], ['c', 'p2', 50], ['d', 'p2', 10]],
      [['a', 'p1', 10], ['b', 'p1', 10], ['c', 'p1', 10], ['d', 'p2', 25]],
    ] as [string, string, number][][]) {
      const r = round(bets);
      const staked = totalPool(r);
      for (const winner of ['p1', 'p2']) {
        const out = settle(r, winner).reduce((sum, p) => sum + p.returned, 0);
        expect(out, `paid ${out} against ${staked} staked`).toBeLessThanOrEqual(staked);
      }
    }
  });

  it('hands everything back when nobody backed the winner', () => {
    const r = round([
      ['a', 'p1', 50],
      ['b', 'p1', 25],
    ]);
    const payouts = settle(r, 'p2');
    expect(payouts.map((p) => p.returned)).toEqual([50, 25]);
  });

  it('hands everything back when the frame had no winner at all', () => {
    // Playing the ghost, or a frame abandoned. Nobody lost a bet on a frame nobody won.
    const r = round([
      ['a', 'p1', 50],
      ['b', 'p2', 100],
    ]);
    expect(settle(r, null).map((p) => p.returned)).toEqual([50, 100]);
  });

  it('tells the losers too', () => {
    // A silent loss reads as a bug, and the client has to move the chalk either way.
    const r = round([
      ['a', 'p1', 50],
      ['b', 'p2', 50],
    ]);
    const payouts = settle(r, 'p1');
    expect(payouts).toHaveLength(2);
    expect(payouts.find((p) => p.bettorId === 'b')).toEqual({
      bettorId: 'b',
      name: 'b',
      staked: 50,
      returned: 0,
    });
  });

  it('returns a lone bettor their own stake rather than nothing', () => {
    const r = round([['a', 'p1', 50]]);
    expect(settle(r, 'p1')[0].returned).toBe(50);
  });

  it('settles an empty book without inventing anyone', () => {
    expect(settle(newRound(), 'p1')).toEqual([]);
  });
});

describe('reading the book', () => {
  it('totals each side separately', () => {
    const r = round([
      ['a', 'p1', 50],
      ['b', 'p2', 25],
      ['c', 'p2', 10],
    ]);
    expect(poolFor(r, 'p1')).toBe(50);
    expect(poolFor(r, 'p2')).toBe(35);
    expect(totalPool(r)).toBe(85);
  });
});
