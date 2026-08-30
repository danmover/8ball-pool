import { MATCH_GIVE_UP_MS, ratingsCompatible, type GameMode, type RuleSetId } from '@8ball/shared';

/**
 * The ranked queue.
 *
 * Not a room. People waiting for a ranked game are not sitting at a table yet — pairing them
 * first and *then* making a table is what lets the rating band decide who meets, rather than
 * whoever happened to click at the same moment.
 *
 * Deliberately a plain data structure with no sockets in it, so the pairing rule can be tested
 * without a server. The rule is the whole feature; the plumbing around it is not.
 */

export interface QueueEntry {
  /** Socket id — how the pairing gets told about itself. */
  id: string;
  /** Profile token, so the pair can be checked against each other's records. */
  token: string;
  name: string;
  rating: number;
  mode: GameMode;
  ruleSet: RuleSetId;
  joinedAt: number;
}

export interface Pairing {
  a: QueueEntry;
  b: QueueEntry;
}

export class MatchQueue {
  private waiting: QueueEntry[] = [];

  add(entry: QueueEntry): void {
    this.remove(entry.id);
    this.waiting.push(entry);
  }

  remove(id: string): void {
    this.waiting = this.waiting.filter((e) => e.id !== id);
  }

  has(id: string): boolean {
    return this.waiting.some((e) => e.id === id);
  }

  get size(): number {
    return this.waiting.length;
  }

  /** How long this entry has been waiting, for the "searching…" readout. */
  waitedMs(id: string, now = Date.now()): number {
    const entry = this.waiting.find((e) => e.id === id);
    return entry ? now - entry.joinedAt : 0;
  }

  /**
   * Everyone who can be paired right now, in pairs.
   *
   * Longest-waiting first, and each person is only paired once per sweep. Sorting by wait
   * rather than by rating is what stops somebody with an awkward rating being skipped over for
   * ever while easier pairs keep forming around them.
   *
   * Two people are compatible when their ratings are inside the band earned by the one who has
   * waited *longer* — being generous to whoever has suffered most is the fair way round, and it
   * means one patient player can rescue an otherwise unmatchable queue.
   */
  drainPairs(now = Date.now()): Pairing[] {
    const byWait = [...this.waiting].sort((a, b) => a.joinedAt - b.joinedAt);
    const paired = new Set<string>();
    const out: Pairing[] = [];

    for (const a of byWait) {
      if (paired.has(a.id)) continue;
      const partner = byWait.find(
        (b) =>
          b.id !== a.id &&
          !paired.has(b.id) &&
          b.mode === a.mode &&
          b.ruleSet === a.ruleSet &&
          // Never pair somebody with themselves on a second device or tab.
          b.token !== a.token &&
          ratingsCompatible(
            a.rating,
            b.rating,
            Math.max(now - a.joinedAt, now - b.joinedAt)
          )
      );
      if (!partner) continue;
      paired.add(a.id);
      paired.add(partner.id);
      out.push({ a, b: partner });
    }

    for (const id of paired) this.remove(id);
    return out;
  }

  /** Everyone currently waiting, for the per-socket progress updates. */
  entries(): readonly QueueEntry[] {
    return this.waiting;
  }

  /** Entries that have been waiting long enough to be told the band has opened right up. */
  desperate(now = Date.now()): QueueEntry[] {
    return this.waiting.filter((e) => now - e.joinedAt >= MATCH_GIVE_UP_MS);
  }

  clear(): void {
    this.waiting = [];
  }
}
