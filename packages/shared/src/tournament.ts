import type { Seat } from './types.js';

/**
 * A seeded knockout bracket.
 *
 * Pure data and pure functions — the `Room` owns *when* matches happen, this owns *who plays
 * whom next*. Keeping the two apart means the whole bracket can be tested without a server,
 * which matters because bracket bugs are the kind that only show up on the semi-final in front
 * of six people.
 */

export interface TournamentMatch {
  id: string;
  round: number;
  /** Position within the round, from the top of the bracket down. */
  slot: number;
  /** Null while waiting for a previous round to produce someone. */
  a: Seat | null;
  b: Seat | null;
  winner: Seat | null;
  /** Frames won by each side, for the running score. */
  score: Record<Seat, number>;
}

export interface Tournament {
  /** Seats in seeded order — index 0 is the top seed. */
  seeds: Seat[];
  /** Frames needed to take a match. */
  target: number;
  matches: TournamentMatch[];
  champion: Seat | null;
}

/**
 * The standard seeding order for a bracket of `size`.
 *
 * Built by repeatedly mirroring, which is what puts the top seed and the second seed in
 * opposite halves and makes every round pair the strongest remaining against the weakest. The
 * naive "1 plays 2, 3 plays 4" ordering puts the two best players in the first round, which is
 * exactly what a seeded bracket exists to avoid.
 */
export function seedOrder(size: number): number[] {
  let order = [0];
  while (order.length < size) {
    const round = order.length * 2;
    const mirrored: number[] = [];
    for (const seed of order) {
      mirrored.push(seed, round - 1 - seed);
    }
    order = mirrored;
  }
  return order;
}

/** Rounds it up to the next power of two, so the bracket is always complete. */
export function bracketSize(entrants: number): number {
  let size = 2;
  while (size < entrants) size *= 2;
  return size;
}

/**
 * Builds a bracket for these seats.
 *
 * Entrants who don't fill a power of two get **byes**: an empty slot whose opponent advances
 * without playing. Byes go to the top seeds, which is the whole point of seeding — the reward
 * for being ranked highest is the easiest path, not a harder one.
 */
export function createTournament(seeds: Seat[], target = 1): Tournament {
  const size = bracketSize(Math.max(2, seeds.length));
  const order = seedOrder(size);
  const matches: TournamentMatch[] = [];

  // Round 1, paired by the mirrored seeding.
  for (let slot = 0; slot < size / 2; slot++) {
    const a = seeds[order[slot * 2]] ?? null;
    const b = seeds[order[slot * 2 + 1]] ?? null;
    matches.push({
      id: `r1m${slot}`,
      round: 1,
      slot,
      a,
      b,
      // A slot with only one entrant is a bye — that player is already through.
      winner: a && !b ? a : !a && b ? b : null,
      score: {},
    });
  }

  // Later rounds, empty until their feeders resolve.
  let count = size / 2;
  let round = 2;
  while (count > 1) {
    count /= 2;
    for (let slot = 0; slot < count; slot++) {
      matches.push({ id: `r${round}m${slot}`, round, slot, a: null, b: null, winner: null, score: {} });
    }
    round++;
  }

  const tournament: Tournament = { seeds, target, matches, champion: null };
  // Byes have to cascade immediately, or the first real match would sit waiting for a player
  // who was never going to play.
  propagate(tournament);
  return tournament;
}

/** Feeds every resolved winner into the round above, repeatedly, until nothing more moves. */
export function propagate(t: Tournament): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const match of t.matches) {
      if (!match.winner) continue;
      const next = t.matches.find((m) => m.round === match.round + 1 && m.slot === Math.floor(match.slot / 2));
      if (!next) {
        if (t.champion !== match.winner) {
          t.champion = match.winner;
          changed = true;
        }
        continue;
      }
      const side = match.slot % 2 === 0 ? 'a' : 'b';
      if (next[side] !== match.winner) {
        next[side] = match.winner;
        changed = true;
      }
      // A player who reaches a round where the other side is a confirmed bye goes straight on.
      if (next.a && !next.b && isByeSlot(t, next, 'b')) {
        next.winner = next.a;
        changed = true;
      } else if (next.b && !next.a && isByeSlot(t, next, 'a')) {
        next.winner = next.b;
        changed = true;
      }
    }
  }
}

/** Is this side of a match permanently empty — i.e. every feeder beneath it is a bye? */
function isByeSlot(t: Tournament, match: TournamentMatch, side: 'a' | 'b'): boolean {
  if (match.round === 1) return true; // round one has no feeders
  const feederSlot = match.slot * 2 + (side === 'a' ? 0 : 1);
  const feeder = t.matches.find((m) => m.round === match.round - 1 && m.slot === feederSlot);
  if (!feeder) return true;
  return feeder.a === null && feeder.b === null;
}

/** The next match that can actually be played, or null when the bracket is finished. */
export function nextMatch(t: Tournament): TournamentMatch | null {
  return t.matches.find((m) => !m.winner && m.a !== null && m.b !== null) ?? null;
}

/**
 * Records a frame result. Returns the match, once it has been won outright.
 *
 * Frames rather than matches, because a bracket match can be a best-of — and the running score
 * is what the bracket screen shows between frames.
 */
export function recordFrameWin(t: Tournament, matchId: string, winner: Seat): TournamentMatch | null {
  const match = t.matches.find((m) => m.id === matchId);
  if (!match || match.winner) return null;

  match.score[winner] = (match.score[winner] ?? 0) + 1;
  if (match.score[winner] >= t.target) {
    match.winner = winner;
    propagate(t);
    return match;
  }
  return null;
}

/** Round names, counting back from the final so they're right at any bracket size. */
export function roundName(t: Tournament, round: number): string {
  const rounds = Math.max(...t.matches.map((m) => m.round));
  const fromEnd = rounds - round;
  if (fromEnd === 0) return 'Final';
  if (fromEnd === 1) return 'Semi-final';
  if (fromEnd === 2) return 'Quarter-final';
  return `Round ${round}`;
}
