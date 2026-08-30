import { createRequire } from 'node:module';
import { applyResult, newRatingRecord, type RatingRecord } from '@8ball/shared';

/**
 * What the **server** knows about a player, as opposed to what their browser claims.
 *
 * A deliberate counterpart to `profiles/`, which stores an opaque blob the client authors and
 * makes no claims about. Everything here is written only by the server, from frames it
 * refereed, because it decides who you get matched against — and a number the client can set is
 * no basis for that.
 *
 * Keyed by the same profile token, so there is one identity rather than two.
 */

export interface PlayerRecord extends RatingRecord {
  /** Last name they played under, for leaderboards and rivalry lines. */
  name: string;
  updatedAt: number;
}

export interface PlayerRepository {
  get(token: string): PlayerRecord;
  /** Records a ranked frame between two players, returning both updated records. */
  recordFrame(
    winnerToken: string,
    loserToken: string,
    names: { winner: string; loser: string }
  ): { winner: PlayerRecord; loser: PlayerRecord };
  /** Highest rated first. Provisional players are excluded — see the note in the SQL. */
  leaderboard(limit?: number): PlayerRecord[];
  close(): void;
}

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

export class SqlitePlayerRepository implements PlayerRepository {
  private db: InstanceType<typeof DatabaseSync>;

  constructor(path = process.env.PLAYER_DB_PATH ?? 'players.db') {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS players (
        token TEXT PRIMARY KEY,
        name TEXT NOT NULL DEFAULT 'Player',
        rating INTEGER NOT NULL,
        frames INTEGER NOT NULL DEFAULT 0,
        wins INTEGER NOT NULL DEFAULT 0,
        losses INTEGER NOT NULL DEFAULT 0,
        updatedAt INTEGER NOT NULL
      )
    `);
  }

  get(token: string): PlayerRecord {
    const row = this.db
      .prepare('SELECT token, name, rating, frames, wins, losses, updatedAt FROM players WHERE token = ?')
      .get(token) as unknown as PlayerRecord | undefined;
    if (row) return row;
    return { ...newRatingRecord(), name: 'Player', updatedAt: Date.now() };
  }

  private put(token: string, record: PlayerRecord): void {
    this.db
      .prepare(
        `INSERT INTO players (token, name, rating, frames, wins, losses, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(token) DO UPDATE SET
           name = excluded.name,
           rating = excluded.rating,
           frames = excluded.frames,
           wins = excluded.wins,
           losses = excluded.losses,
           updatedAt = excluded.updatedAt`
      )
      .run(token, record.name, record.rating, record.frames, record.wins, record.losses, record.updatedAt);
  }

  recordFrame(
    winnerToken: string,
    loserToken: string,
    names: { winner: string; loser: string }
  ): { winner: PlayerRecord; loser: PlayerRecord } {
    // Both moves are computed from the same pair of starting ratings — applying one and reading
    // the other back is the classic way to make a ladder leak points.
    const before = { winner: this.get(winnerToken), loser: this.get(loserToken) };
    const after = applyResult(before.winner, before.loser);

    const now = Date.now();
    const winner: PlayerRecord = { ...after.winner, name: names.winner, updatedAt: now };
    const loser: PlayerRecord = { ...after.loser, name: names.loser, updatedAt: now };
    this.put(winnerToken, winner);
    this.put(loserToken, loser);
    return { winner, loser };
  }

  leaderboard(limit = 50): PlayerRecord[] {
    // Provisional players are left off. A board topped by somebody who won their first frame
    // and stopped is worse than a shorter board.
    return this.db
      .prepare(
        `SELECT token, name, rating, frames, wins, losses, updatedAt
         FROM players WHERE frames >= 5 ORDER BY rating DESC LIMIT ?`
      )
      .all(limit) as unknown as PlayerRecord[];
  }

  close(): void {
    this.db.close();
  }
}

/** An in-memory implementation, for tests and for running without a database. */
export class MemoryPlayerRepository implements PlayerRepository {
  private rows = new Map<string, PlayerRecord>();

  get(token: string): PlayerRecord {
    return this.rows.get(token) ?? { ...newRatingRecord(), name: 'Player', updatedAt: Date.now() };
  }

  recordFrame(
    winnerToken: string,
    loserToken: string,
    names: { winner: string; loser: string }
  ): { winner: PlayerRecord; loser: PlayerRecord } {
    const after = applyResult(this.get(winnerToken), this.get(loserToken));
    const now = Date.now();
    const winner: PlayerRecord = { ...after.winner, name: names.winner, updatedAt: now };
    const loser: PlayerRecord = { ...after.loser, name: names.loser, updatedAt: now };
    this.rows.set(winnerToken, winner);
    this.rows.set(loserToken, loser);
    return { winner, loser };
  }

  leaderboard(limit = 50): PlayerRecord[] {
    return [...this.rows.values()]
      .filter((r) => r.frames >= 5)
      .sort((a, b) => b.rating - a.rating)
      .slice(0, limit);
  }

  close(): void {
    this.rows.clear();
  }
}
