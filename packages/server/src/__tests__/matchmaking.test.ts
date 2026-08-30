import { describe, expect, it } from 'vitest';
import { MATCH_GIVE_UP_MS } from '@8ball/shared';
import { MatchQueue, type QueueEntry } from '../matchmaking.js';

/**
 * The failure mode a small ladder actually dies of is not bad matches — it is an empty queue
 * and somebody staring at "searching…" until they close the tab. Most of these are about the
 * queue eventually saying yes.
 */

let seq = 0;
const entry = (over: Partial<QueueEntry> = {}): QueueEntry => ({
  id: `sock-${seq++}`,
  token: `tok-${seq}`,
  name: 'Player',
  rating: 1000,
  mode: 'classic',
  ruleSet: 'casual',
  joinedAt: 0,
  ...over,
});

describe('joining and leaving', () => {
  it('holds people until they are paired', () => {
    const q = new MatchQueue();
    q.add(entry());
    expect(q.size).toBe(1);
    expect(q.drainPairs(0)).toEqual([]);
    expect(q.size).toBe(1);
  });

  it('lets somebody leave', () => {
    const q = new MatchQueue();
    const e = entry();
    q.add(e);
    q.remove(e.id);
    expect(q.size).toBe(0);
  });

  it('does not stack a double join from the same socket', () => {
    const q = new MatchQueue();
    q.add(entry({ id: 'same' }));
    q.add(entry({ id: 'same' }));
    expect(q.size).toBe(1);
  });
});

describe('pairing', () => {
  it('pairs two close ratings straight away', () => {
    const q = new MatchQueue();
    q.add(entry({ rating: 1200 }));
    q.add(entry({ rating: 1240 }));
    expect(q.drainPairs(0)).toHaveLength(1);
    expect(q.size).toBe(0);
  });

  it('holds two far-apart ratings back at first', () => {
    const q = new MatchQueue();
    q.add(entry({ rating: 900 }));
    q.add(entry({ rating: 1800 }));
    expect(q.drainPairs(0)).toEqual([]);
    expect(q.size).toBe(2);
  });

  it('pairs them once they have waited long enough', () => {
    // A game against somebody a bit better is a far better outcome than no game at all.
    const q = new MatchQueue();
    q.add(entry({ rating: 900 }));
    q.add(entry({ rating: 1800 }));
    expect(q.drainPairs(MATCH_GIVE_UP_MS)).toHaveLength(1);
  });

  it('is generous to whoever has waited longer', () => {
    // The band comes from the more patient of the two, so one long-suffering player can rescue
    // an otherwise unmatchable queue.
    const q = new MatchQueue();
    q.add(entry({ rating: 900, joinedAt: 0 }));
    q.add(entry({ rating: 1300, joinedAt: 9000 }));
    expect(q.drainPairs(10_000)).toHaveLength(1);
  });

  it('never pairs somebody with themselves on a second device', () => {
    const q = new MatchQueue();
    q.add(entry({ id: 'a', token: 'same-person' }));
    q.add(entry({ id: 'b', token: 'same-person' }));
    expect(q.drainPairs(MATCH_GIVE_UP_MS)).toEqual([]);
  });

  it('keeps different games apart', () => {
    const q = new MatchQueue();
    q.add(entry({ mode: 'classic' }));
    q.add(entry({ mode: 'nineball' }));
    expect(q.drainPairs(MATCH_GIVE_UP_MS)).toEqual([]);
  });

  it('keeps different rule sets apart', () => {
    const q = new MatchQueue();
    q.add(entry({ ruleSet: 'casual' }));
    q.add(entry({ ruleSet: 'tournament' }));
    expect(q.drainPairs(MATCH_GIVE_UP_MS)).toEqual([]);
  });

  it('pairs several at once and uses each person only once', () => {
    const q = new MatchQueue();
    for (let i = 0; i < 5; i++) q.add(entry({ rating: 1000 + i }));
    const pairs = q.drainPairs(0);
    expect(pairs).toHaveLength(2);

    const used = pairs.flatMap((p) => [p.a.id, p.b.id]);
    expect(new Set(used).size).toBe(4);
    // The odd one out stays in the queue rather than being dropped.
    expect(q.size).toBe(1);
  });

  it('serves the longest waiting first', () => {
    // Otherwise somebody with an awkward rating is skipped over for ever while easier pairs
    // keep forming around them.
    const q = new MatchQueue();
    const patient = entry({ id: 'patient', rating: 1000, joinedAt: 0 });
    q.add(entry({ id: 'fresh-a', rating: 1000, joinedAt: 9000 }));
    q.add(patient);
    q.add(entry({ id: 'fresh-b', rating: 1000, joinedAt: 9500 }));

    const [first] = q.drainPairs(10_000);
    expect([first.a.id, first.b.id]).toContain('patient');
  });
});

describe('reporting the wait', () => {
  it('says how long somebody has been waiting', () => {
    const q = new MatchQueue();
    const e = entry({ joinedAt: 1000 });
    q.add(e);
    expect(q.waitedMs(e.id, 4000)).toBe(3000);
    expect(q.waitedMs('nobody', 4000)).toBe(0);
  });

  it('lists everyone waiting, for the progress updates', () => {
    const q = new MatchQueue();
    q.add(entry());
    q.add(entry());
    expect(q.entries()).toHaveLength(2);
  });

  it('flags the ones who have given up caring about rating', () => {
    const q = new MatchQueue();
    q.add(entry({ joinedAt: 0 }));
    q.add(entry({ joinedAt: MATCH_GIVE_UP_MS }));
    expect(q.desperate(MATCH_GIVE_UP_MS)).toHaveLength(1);
  });
});
