import { describe, expect, it } from 'vitest';
import {
  BASE_RATING,
  K_PLACEMENT,
  K_SETTLED,
  MATCH_GIVE_UP_MS,
  MIN_RATING,
  PLACEMENT_FRAMES,
  applyResult,
  expectedScore,
  isProvisional,
  kFactor,
  matchBand,
  newRatingRecord,
  ratingsCompatible,
  tierFor,
} from '../rating.js';

/**
 * A ladder that leaks points is a ladder people stop believing in, so the property tested
 * hardest here is conservation: what one player gains, the other loses.
 */

const at = (rating: number, frames = 20) => ({ ...newRatingRecord(), rating, frames });

describe('expectation', () => {
  it('is even between equals', () => {
    expect(expectedScore(1200, 1200)).toBeCloseTo(0.5, 6);
  });

  it('favours the higher rating', () => {
    expect(expectedScore(1400, 1000)).toBeGreaterThan(0.5);
    expect(expectedScore(1000, 1400)).toBeLessThan(0.5);
  });

  it('is symmetric — the two shares add to one', () => {
    expect(expectedScore(1337, 980) + expectedScore(980, 1337)).toBeCloseTo(1, 6);
  });
});

describe('a frame', () => {
  it('moves the winner up and the loser down', () => {
    const { winner, loser } = applyResult(at(1200), at(1200));
    expect(winner.rating).toBeGreaterThan(1200);
    expect(loser.rating).toBeLessThan(1200);
  });

  it('neither creates nor destroys points between equals', () => {
    const { winner, loser } = applyResult(at(1200), at(1200));
    expect(winner.rating - 1200).toBe(1200 - loser.rating);
  });

  it('pays little for beating somebody far below you', () => {
    const easy = applyResult(at(1600), at(1000));
    const even = applyResult(at(1200), at(1200));
    expect(easy.winner.rating - 1600).toBeLessThan(even.winner.rating - 1200);
  });

  it('pays well for beating somebody far above you', () => {
    const upset = applyResult(at(1000), at(1600));
    expect(upset.winner.rating - 1000).toBeGreaterThan(K_SETTLED / 2);
  });

  it('counts the frame for both', () => {
    const { winner, loser } = applyResult(at(1200), at(1200));
    expect(winner.frames).toBe(21);
    expect(loser.frames).toBe(21);
    expect(winner.wins).toBe(1);
    expect(loser.losses).toBe(1);
  });

  it('computes both moves from the same starting pair', () => {
    // Applying one and reading the other back is the classic way to make a ladder leak.
    const a = at(1500);
    const b = at(1100);
    const { winner, loser } = applyResult(a, b);
    expect(a.rating).toBe(1500);
    expect(b.rating).toBe(1100);
    expect(winner.rating - 1500).toBe(1100 - loser.rating);
  });

  it('never falls below the floor', () => {
    let record = at(MIN_RATING);
    for (let i = 0; i < 40; i++) record = applyResult(at(2400), record).loser;
    expect(record.rating).toBeGreaterThanOrEqual(MIN_RATING);
  });
});

describe('placement', () => {
  it('treats a new player as provisional', () => {
    expect(isProvisional(newRatingRecord())).toBe(true);
    expect(kFactor(newRatingRecord())).toBe(K_PLACEMENT);
  });

  it('settles after the placement frames', () => {
    const settled = { ...newRatingRecord(), frames: PLACEMENT_FRAMES };
    expect(isProvisional(settled)).toBe(false);
    expect(kFactor(settled)).toBe(K_SETTLED);
  });

  it('moves a new player further per frame than a settled one', () => {
    // Five frames should get somebody roughly where they belong, not leave them grinding up
    // from the middle for a fortnight.
    const newbie = applyResult(newRatingRecord(), at(BASE_RATING));
    const veteran = applyResult(at(BASE_RATING), at(BASE_RATING));
    expect(newbie.winner.rating - BASE_RATING).toBeGreaterThan(veteran.winner.rating - BASE_RATING);
  });
});

describe('tiers', () => {
  it('names each band', () => {
    expect(tierFor(0)).toBe('Beginner');
    expect(tierFor(BASE_RATING)).toBe('Amateur');
    expect(tierFor(1200)).toBe('Club');
    expect(tierFor(1400)).toBe('Sharp');
    expect(tierFor(1600)).toBe('Hustler');
    expect(tierFor(2000)).toBe('Master');
  });

  it('never falls off the bottom', () => {
    expect(tierFor(-500)).toBe('Beginner');
  });
});

describe('matchmaking', () => {
  it('starts tight', () => {
    expect(ratingsCompatible(1200, 1250, 0)).toBe(true);
    expect(ratingsCompatible(1200, 1600, 0)).toBe(false);
  });

  it('widens the longer you wait', () => {
    expect(matchBand(10_000)).toBeGreaterThan(matchBand(0));
    expect(ratingsCompatible(1200, 1450, 0)).toBe(false);
    expect(ratingsCompatible(1200, 1450, 8000)).toBe(true);
  });

  it('stops caring rather than leaving somebody waiting for ever', () => {
    // An empty queue is the failure mode small ladders actually die of — a game against
    // somebody a bit better is a far better outcome than no game.
    expect(matchBand(MATCH_GIVE_UP_MS)).toBe(Infinity);
    expect(ratingsCompatible(600, 2400, MATCH_GIVE_UP_MS)).toBe(true);
  });

  it('is symmetric', () => {
    expect(ratingsCompatible(1100, 1300, 3000)).toBe(ratingsCompatible(1300, 1100, 3000));
  });
});
