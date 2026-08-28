/**
 * Who you keep playing, and how it has gone.
 *
 * A rivalry is the thing that makes the fourth frame against the same person matter more than
 * the first. All it needs is a running score, but the *naming* is the hard part: a party game
 * has no accounts, so "the same opponent" can only mean "the same name typed in again".
 * That's imperfect and deliberately so — the alternative is asking people to sign in, which is
 * exactly what this game is built to avoid.
 */

export interface RivalRecord {
  /** The opponent's display name, as last seen. */
  name: string;
  wins: number;
  losses: number;
  /** ISO date of the most recent frame against them. */
  lastPlayed: string;
}

/** Frames against one person before it is worth calling a rivalry. */
export const RIVALRY_THRESHOLD = 4;

/**
 * The key a name is filed under.
 *
 * Case and surrounding space are ignored, so "Sam", "sam" and " Sam " are one person. Nothing
 * cleverer than that: stripping punctuation or collapsing inner spaces would start merging
 * people who genuinely chose different names.
 */
export function rivalKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Records one frame's result against an opponent, returning the updated table. */
export function recordRival(
  rivals: Record<string, RivalRecord>,
  opponentName: string,
  won: boolean,
  today = new Date().toISOString().slice(0, 10)
): Record<string, RivalRecord> {
  const key = rivalKey(opponentName);
  if (!key) return rivals;

  const prev = rivals[key] ?? { name: opponentName.trim(), wins: 0, losses: 0, lastPlayed: today };
  return {
    ...rivals,
    [key]: {
      // Keep the most recent spelling — people fix their own capitalisation.
      name: opponentName.trim() || prev.name,
      wins: prev.wins + (won ? 1 : 0),
      losses: prev.losses + (won ? 0 : 1),
      lastPlayed: today,
    },
  };
}

export function framesAgainst(record: RivalRecord): number {
  return record.wins + record.losses;
}

/** Is this opponent someone you have real history with? */
export function isRivalry(record: RivalRecord | undefined): boolean {
  return Boolean(record && framesAgainst(record) >= RIVALRY_THRESHOLD);
}

/**
 * The line to show above the table: "7–5 to Sam", or "4–4 — dead level".
 *
 * Written from the *reader's* point of view, so `record` is their record against the opponent.
 */
export function rivalryLine(record: RivalRecord, you: string): string | null {
  if (!isRivalry(record)) return null;
  if (record.wins === record.losses) return `${record.wins}–${record.losses} — dead level`;
  const leader = record.wins > record.losses ? you : record.name;
  const high = Math.max(record.wins, record.losses);
  const low = Math.min(record.wins, record.losses);
  return `${high}–${low} to ${leader}`;
}

/** Rivals worth listing, most-played first. */
export function topRivals(rivals: Record<string, RivalRecord>, limit = 8): RivalRecord[] {
  return Object.values(rivals)
    .sort((a, b) => {
      const byFrames = framesAgainst(b) - framesAgainst(a);
      // Ties broken by recency, so an old rivalry doesn't sit above one that's live.
      return byFrames !== 0 ? byFrames : b.lastPlayed.localeCompare(a.lastPlayed);
    })
    .slice(0, limit);
}
