import { describe, expect, it } from 'vitest';
import { bestCallout, calloutsFor, factsFromEvents, type ShotFacts } from '../callouts.js';
import { CUE_BALL_ID, TABLE_LENGTH } from '../constants.js';
import type { SimEvent } from '../types.js';

/**
 * The property that matters most here is *restraint*. Praise that fires on everything stops
 * being praise, and the first time a player sees a tap-in called a long pot they stop
 * believing any of it — so the tests below are mostly about what does **not** get said.
 */

const facts = (over: Partial<ShotFacts> = {}): ShotFacts => ({
  pots: 1,
  potDistance: 100,
  railsBeforeContact: 0,
  railsAfterContact: 0,
  wonFrame: false,
  ballsRemaining: 5,
  visitRun: 1,
  jumped: false,
  massed: false,
  fouled: false,
  ...over,
});

describe('saying nothing', () => {
  it('has nothing to say about an ordinary pot', () => {
    expect(bestCallout(facts())).toBeNull();
  });

  it('has nothing to say about an ordinary miss', () => {
    expect(bestCallout(facts({ pots: 0 }))).toBeNull();
  });

  it('does not call a tap-in a long pot', () => {
    expect(bestCallout(facts({ potDistance: TABLE_LENGTH * 0.2 }))).toBeNull();
  });

  it('does not credit rails the cue ball hit on its way *out*', () => {
    // Rails after contact are consequences, not skill. Only what happened before the strike
    // counts as a bank.
    expect(bestCallout(facts({ railsAfterContact: 4 }))).toBeNull();
  });
});

describe('fouls', () => {
  it('never congratulates a foul, however spectacular the route', () => {
    const called = calloutsFor(facts({ fouled: true, railsBeforeContact: 4, pots: 2 }));
    expect(called.every((c) => c.tone === 'wry')).toBe(true);
    expect(called.some((c) => /RAILS|TWO IN ONE/.test(c.text))).toBe(false);
  });

  it('is wry about a scenic foul rather than silent', () => {
    expect(bestCallout(facts({ fouled: true, railsBeforeContact: 3 }))!.text).toBe('SCENIC ROUTE');
  });

  it('says nothing at all about a plain foul', () => {
    expect(bestCallout(facts({ fouled: true }))).toBeNull();
  });
});

describe('what earns a word', () => {
  it('calls a genuine long pot', () => {
    expect(bestCallout(facts({ potDistance: TABLE_LENGTH * 0.7 }))!.text).toBe('LONG POT');
  });

  it('counts rails before contact', () => {
    expect(bestCallout(facts({ railsBeforeContact: 1 }))!.text).toBe('OFF THE RAIL');
    expect(bestCallout(facts({ railsBeforeContact: 2 }))!.text).toBe('DOUBLE BANK');
    expect(bestCallout(facts({ railsBeforeContact: 3 }))!.text).toBe('THREE RAILS');
  });

  it('notices a multi-pot', () => {
    expect(bestCallout(facts({ pots: 2 }))!.text).toBe('TWO IN ONE');
    expect(bestCallout(facts({ pots: 3 }))!.text).toBe('THREE AT ONCE');
  });

  it('notices a run across a visit', () => {
    expect(bestCallout(facts({ visitRun: 4 }))!.text).toBe('FOUR ON THE TROT');
    expect(bestCallout(facts({ visitRun: 6 }))!.text).toBe('6 IN A ROW');
  });

  it('credits a jump and a massé only when they actually potted something', () => {
    expect(bestCallout(facts({ pots: 1, jumped: true }))!.text).toBe('JUMP SHOT!');
    expect(bestCallout(facts({ pots: 0, jumped: true }))).toBeNull();
    expect(bestCallout(facts({ pots: 1, massed: true }))!.text).toBe('MASSÉ!');
  });

  it('notices a safety that sent a ball the length of the table', () => {
    expect(bestCallout(facts({ pots: 0, railsAfterContact: 3 }))!.text).toBe('GOOD SAFETY');
  });
});

describe('picking one', () => {
  it('lets the frame-winning shot outrank everything', () => {
    expect(bestCallout(facts({ wonFrame: true, pots: 3, railsBeforeContact: 3 }))!.text).toBe(
      'THAT WINS IT'
    );
  });

  it('prefers the rarer feat when two apply', () => {
    // A three-rail pot is a better story than the fact it was also long.
    expect(
      bestCallout(facts({ railsBeforeContact: 3, potDistance: TABLE_LENGTH * 0.8 }))!.text
    ).toBe('THREE RAILS');
  });

  it('returns everything that applied, best first', () => {
    const all = calloutsFor(facts({ pots: 2, railsBeforeContact: 2, potDistance: TABLE_LENGTH }));
    expect(all.length).toBeGreaterThan(2);
    for (let i = 1; i < all.length; i++) {
      expect(all[i - 1].weight).toBeGreaterThanOrEqual(all[i].weight);
    }
  });
});

describe('reading the events', () => {
  const rest = {
    wonFrame: false,
    ballsRemaining: 5,
    visitRun: 1,
    jumped: false,
    massed: false,
    fouled: false,
  };

  it('splits rails at the moment of contact', () => {
    const events: SimEvent[] = [
      { type: 'cushion', ballId: CUE_BALL_ID, pos: { x: 0, y: 0 }, speed: 100, normal: { x: 0, y: -1 } },
      { type: 'cushion', ballId: CUE_BALL_ID, pos: { x: 0, y: 0 }, speed: 100, normal: { x: 0, y: -1 } },
      { type: 'ballCollision', a: CUE_BALL_ID, b: 3, pos: { x: 0, y: 0 }, impulse: 500 },
      { type: 'cushion', ballId: 3, pos: { x: 0, y: 0 }, speed: 100, normal: { x: 0, y: -1 } },
    ];
    const f = factsFromEvents(events, rest, new Map());
    expect(f.railsBeforeContact).toBe(2);
    expect(f.railsAfterContact).toBe(1);
  });

  it('measures how far the potted ball actually travelled', () => {
    const events: SimEvent[] = [
      { type: 'pot', ballId: 3, pos: { x: 1000, y: 100 }, pocketIndex: 0 },
    ];
    const f = factsFromEvents(events, rest, new Map([[3, { x: 200, y: 100 }]]));
    expect(f.potDistance).toBe(800);
    expect(f.pots).toBe(1);
  });

  it('does not count the cue ball dropping as a pot', () => {
    const events: SimEvent[] = [
      { type: 'pot', ballId: CUE_BALL_ID, pos: { x: 35, y: 35 }, pocketIndex: 0 },
    ];
    expect(factsFromEvents(events, rest, new Map()).pots).toBe(0);
  });

  it('takes the longest pot when several dropped', () => {
    const events: SimEvent[] = [
      { type: 'pot', ballId: 3, pos: { x: 300, y: 100 }, pocketIndex: 0 },
      { type: 'pot', ballId: 4, pos: { x: 1200, y: 100 }, pocketIndex: 2 },
    ];
    const starts = new Map([
      [3, { x: 200, y: 100 }],
      [4, { x: 200, y: 100 }],
    ]);
    expect(factsFromEvents(events, rest, starts).potDistance).toBe(1000);
  });
});
