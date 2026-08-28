import type { Seat } from './types.js';

/**
 * Spectators backing a player with chalk.
 *
 * **What this is and isn't.** The server escrows every stake for the duration of the frame and
 * settles it against the frame it refereed, so within a room nobody can claim a payout they
 * didn't win, and nobody can back both sides or change their pick once the balls are moving.
 *
 * It does *not* make the economy tamper-proof, and the plan this came from was wrong to say
 * otherwise. The profile store keeps a client-authored JSON blob (see
 * `server/profiles/repository.ts`, which says the same thing), so a determined person can edit
 * their own chalk balance offline and stake it. Making that impossible means the server owning
 * how chalk is earned and spent, which is a much larger piece of work than a party game needs.
 * The stake sizes below are fixed and small precisely because the stakes should not matter
 * enough to be worth cheating for.
 */

/** The amounts you may stake. A short list keeps it a decision rather than a text field. */
export const STAKES = [10, 25, 50, 100] as const;
export type Stake = (typeof STAKES)[number];

export interface Bet {
  /** Whoever placed it — a socket id, since spectators have no seat. */
  bettorId: string;
  name: string;
  on: Seat;
  amount: number;
}

export interface BettingRound {
  /** Open until the first shot of the frame; after that the book is closed. */
  open: boolean;
  bets: Bet[];
}

export interface Payout {
  bettorId: string;
  name: string;
  /** What they staked. */
  staked: number;
  /** What comes back — zero for a losing bet, stake plus winnings for a winning one. */
  returned: number;
}

/** Total staked on a seat. */
export function poolFor(round: BettingRound, seat: Seat): number {
  return round.bets.filter((b) => b.on === seat).reduce((sum, b) => sum + b.amount, 0);
}

/** Total staked across every seat. */
export function totalPool(round: BettingRound): number {
  return round.bets.reduce((sum, b) => sum + b.amount, 0);
}

/**
 * What a stake on `seat` would return per chalk, as things stand.
 *
 * Parimutuel — the winners share the losers' money in proportion to what they staked, exactly
 * like a tote. No bookmaker sets a price, so nothing has to model how good either player is,
 * and the odds move on their own as the room takes sides. That self-correction is the reason
 * to prefer it here: a fixed-odds book on a game with no ratings would either be free money or
 * a trap, depending on which way the room leaned.
 */
export function oddsFor(round: BettingRound, seat: Seat): number {
  const on = poolFor(round, seat);
  const total = totalPool(round);
  if (on <= 0) return 0;
  // Everyone on the same side: stakes come back, nobody profits. Reporting 2× here and then
  // returning the stake would be the sort of lie that loses a player's trust permanently.
  if (on === total) return 1;
  return total / on;
}

/**
 * Settles the round against the seat that actually won.
 *
 * Every bettor appears in the result, including the losers — the client needs to tell someone
 * they lost as much as it needs to pay someone out, and a silent loss reads as a bug.
 */
export function settle(round: BettingRound, winner: Seat | null): Payout[] {
  const total = totalPool(round);
  const winningPool = winner ? poolFor(round, winner) : 0;

  return round.bets.map((bet) => {
    // Nobody backed the winner — or there was no winner at all. Everything is handed back
    // rather than kept: a frame that ends in no result is not a frame anyone lost a bet on.
    if (winningPool <= 0) {
      return { bettorId: bet.bettorId, name: bet.name, staked: bet.amount, returned: bet.amount };
    }
    if (bet.on !== winner) {
      return { bettorId: bet.bettorId, name: bet.name, staked: bet.amount, returned: 0 };
    }
    // Rounded down, so the house can never pay out more than was staked.
    const returned = Math.floor((bet.amount / winningPool) * total);
    return { bettorId: bet.bettorId, name: bet.name, staked: bet.amount, returned };
  });
}

/**
 * Adds or replaces a bettor's stake.
 *
 * One bet each, replaceable while the book is open. Backing both players is not a bet, it is
 * an accounting exercise, and letting someone change their pick after the balls are moving
 * would make the whole thing pointless.
 */
export function placeBet(round: BettingRound, bet: Bet): boolean {
  if (!round.open) return false;
  if (!STAKES.includes(bet.amount as Stake)) return false;

  const existing = round.bets.findIndex((b) => b.bettorId === bet.bettorId);
  if (existing >= 0) round.bets[existing] = bet;
  else round.bets.push(bet);
  return true;
}

export function newRound(): BettingRound {
  return { open: true, bets: [] };
}
