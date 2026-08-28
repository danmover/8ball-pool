import { describe, expect, it } from 'vitest';
import {
  RIVALRY_THRESHOLD,
  framesAgainst,
  isRivalry,
  recordRival,
  rivalKey,
  rivalryLine,
  topRivals,
  type RivalRecord,
} from '../rivals.js';

/**
 * With no accounts, "the same opponent" can only mean "the same name typed in again". The
 * tests below pin exactly how far that matching goes — far enough to survive capitalisation
 * and stray spaces, and no further, because merging two people who chose different names is a
 * much worse failure than failing to merge one person who typed theirs two ways.
 */

describe('naming', () => {
  it('treats case and surrounding space as the same person', () => {
    expect(rivalKey('Sam')).toBe(rivalKey('sam'));
    expect(rivalKey(' Sam ')).toBe(rivalKey('Sam'));
    expect(rivalKey('SAM')).toBe(rivalKey('sam'));
  });

  it('keeps genuinely different names apart', () => {
    expect(rivalKey('Sam')).not.toBe(rivalKey('Samantha'));
    expect(rivalKey('Sam T')).not.toBe(rivalKey('SamT'));
    expect(rivalKey('Sam')).not.toBe(rivalKey('Sam.'));
  });

  it('ignores an empty name rather than filing everyone under it', () => {
    expect(recordRival({}, '   ', true)).toEqual({});
  });
});

describe('keeping score', () => {
  it('counts wins and losses', () => {
    let r: Record<string, RivalRecord> = {};
    r = recordRival(r, 'Sam', true, '2026-01-01');
    r = recordRival(r, 'Sam', true, '2026-01-02');
    r = recordRival(r, 'Sam', false, '2026-01-03');
    expect(r.sam.wins).toBe(2);
    expect(r.sam.losses).toBe(1);
    expect(r.sam.lastPlayed).toBe('2026-01-03');
  });

  it('merges the same person typed differently', () => {
    let r: Record<string, RivalRecord> = {};
    r = recordRival(r, 'sam', true, '2026-01-01');
    r = recordRival(r, 'Sam', true, '2026-01-02');
    expect(Object.keys(r)).toHaveLength(1);
    expect(framesAgainst(r.sam)).toBe(2);
  });

  it('keeps the most recent spelling, since people fix their own capitals', () => {
    let r: Record<string, RivalRecord> = {};
    r = recordRival(r, 'sam', true, '2026-01-01');
    r = recordRival(r, 'Sam', true, '2026-01-02');
    expect(r.sam.name).toBe('Sam');
  });

  it('does not mutate what it was given', () => {
    const before: Record<string, RivalRecord> = {};
    const after = recordRival(before, 'Sam', true, '2026-01-01');
    expect(before).toEqual({});
    expect(after.sam).toBeDefined();
  });
});

describe('when it becomes a rivalry', () => {
  const rec = (wins: number, losses: number): RivalRecord => ({
    name: 'Sam',
    wins,
    losses,
    lastPlayed: '2026-01-01',
  });

  it('waits until there is real history', () => {
    expect(isRivalry(rec(1, 0))).toBe(false);
    expect(isRivalry(rec(2, 1))).toBe(false);
    expect(isRivalry(rec(2, 2))).toBe(true);
    expect(framesAgainst(rec(2, 2))).toBe(RIVALRY_THRESHOLD);
  });

  it('says nothing at all before then', () => {
    expect(rivalryLine(rec(2, 0), 'You')).toBeNull();
  });

  it('names whoever is ahead', () => {
    expect(rivalryLine(rec(5, 2), 'You')).toBe('5–2 to You');
    expect(rivalryLine(rec(2, 5), 'You')).toBe('5–2 to Sam');
  });

  it('calls a tie a tie rather than picking someone', () => {
    expect(rivalryLine(rec(4, 4), 'You')).toBe('4–4 — dead level');
  });

  it('handles a missing record without throwing', () => {
    expect(isRivalry(undefined)).toBe(false);
  });
});

describe('listing them', () => {
  it('puts the people you play most at the top', () => {
    const rivals: Record<string, RivalRecord> = {
      sam: { name: 'Sam', wins: 1, losses: 1, lastPlayed: '2026-01-01' },
      ali: { name: 'Ali', wins: 5, losses: 4, lastPlayed: '2026-01-01' },
      jo: { name: 'Jo', wins: 2, losses: 1, lastPlayed: '2026-01-01' },
    };
    expect(topRivals(rivals).map((r) => r.name)).toEqual(['Ali', 'Jo', 'Sam']);
  });

  it('breaks a tie on recency, so a live rivalry outranks an old one', () => {
    const rivals: Record<string, RivalRecord> = {
      old: { name: 'Old', wins: 2, losses: 2, lastPlayed: '2024-05-01' },
      live: { name: 'Live', wins: 2, losses: 2, lastPlayed: '2026-08-01' },
    };
    expect(topRivals(rivals)[0].name).toBe('Live');
  });

  it('respects the limit', () => {
    const rivals: Record<string, RivalRecord> = {};
    for (let i = 0; i < 20; i++) {
      rivals[`p${i}`] = { name: `P${i}`, wins: i, losses: 0, lastPlayed: '2026-01-01' };
    }
    expect(topRivals(rivals, 5)).toHaveLength(5);
  });
});
