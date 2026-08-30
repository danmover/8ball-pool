/**
 * The ranked rating.
 *
 * Deliberately separate from `progression.ts`'s Elo, which the client keeps for solo play
 * against bots. That one is a private "am I improving" number and nothing depends on it. This
 * one decides who you are matched against, so it is computed and stored by the server, from
 * frames the server refereed, and the client is never asked what it thinks its rating is.
 *
 * Plain Elo, because a rating system nobody can predict is a rating system nobody trusts, and
 * every player already has an intuition for how Elo behaves.
 */

/** Where everybody starts. */
export const BASE_RATING = 1000;

/** Frames before a rating is treated as settled. */
export const PLACEMENT_FRAMES = 5;

/**
 * How far one frame can move you.
 *
 * High while you are being placed, so five frames get a new player roughly where they belong
 * instead of leaving them grinding upward from the middle for a fortnight. Lower afterwards, so
 * a settled rating does not swing wildly on one unlucky evening.
 */
export const K_PLACEMENT = 64;
export const K_SETTLED = 24;

/** Never let a rating run away below the point where it stops meaning anything. */
export const MIN_RATING = 100;

export interface RatingRecord {
  rating: number;
  /** Ranked frames played. Drives the placement K-factor and the provisional flag. */
  frames: number;
  wins: number;
  losses: number;
}

export function newRatingRecord(): RatingRecord {
  return { rating: BASE_RATING, frames: 0, wins: 0, losses: 0 };
}

/** Still being placed — shown as provisional rather than as a real number. */
export function isProvisional(record: RatingRecord): boolean {
  return record.frames < PLACEMENT_FRAMES;
}

export function kFactor(record: RatingRecord): number {
  return isProvisional(record) ? K_PLACEMENT : K_SETTLED;
}

/** Standard logistic expectation: the share of the frame `rating` is expected to take. */
export function expectedScore(rating: number, against: number): number {
  return 1 / (1 + Math.pow(10, (against - rating) / 400));
}

/**
 * One frame's result, for both players at once.
 *
 * Returned rather than mutated, and computed from both records together, because the two moves
 * have to be worked out from the *same* pair of starting ratings. Applying one and then reading
 * the other back is the classic way to make a ladder leak points.
 */
export function applyResult(
  winner: RatingRecord,
  loser: RatingRecord
): { winner: RatingRecord; loser: RatingRecord } {
  const expectedWin = expectedScore(winner.rating, loser.rating);
  const expectedLose = expectedScore(loser.rating, winner.rating);

  return {
    winner: {
      rating: Math.max(MIN_RATING, Math.round(winner.rating + kFactor(winner) * (1 - expectedWin))),
      frames: winner.frames + 1,
      wins: winner.wins + 1,
      losses: winner.losses,
    },
    loser: {
      rating: Math.max(MIN_RATING, Math.round(loser.rating + kFactor(loser) * (0 - expectedLose))),
      frames: loser.frames + 1,
      wins: loser.wins,
      losses: loser.losses + 1,
    },
  };
}

/** Named bands, because "1247" means nothing to somebody who has not played chess. */
export const RATING_TIERS = [
  { name: 'Beginner', from: 0 },
  { name: 'Amateur', from: 900 },
  { name: 'Club', from: 1100 },
  { name: 'Sharp', from: 1300 },
  { name: 'Hustler', from: 1500 },
  { name: 'Master', from: 1700 },
] as const;

export function tierFor(rating: number): string {
  let name: string = RATING_TIERS[0].name;
  for (const tier of RATING_TIERS) {
    if (rating >= tier.from) name = tier.name;
  }
  return name;
}

/**
 * How wide the matchmaking net is after waiting `waitedMs`.
 *
 * Starts tight and widens, because the alternative is a strict band and an empty queue. Past
 * `MATCH_GIVE_UP_MS` it stops caring entirely — a game against somebody a bit better than you
 * is a far better outcome than no game at all, which is the failure mode every small ladder
 * actually dies of.
 */
export const MATCH_START_BAND = 100;
export const MATCH_WIDEN_PER_SEC = 40;
export const MATCH_GIVE_UP_MS = 30_000;

export function matchBand(waitedMs: number): number {
  if (waitedMs >= MATCH_GIVE_UP_MS) return Infinity;
  return MATCH_START_BAND + (waitedMs / 1000) * MATCH_WIDEN_PER_SEC;
}

/** Would these two accept each other, given how long each has been waiting? */
export function ratingsCompatible(a: number, b: number, waitedMs: number): boolean {
  return Math.abs(a - b) <= matchBand(waitedMs);
}
