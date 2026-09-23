import { RARITY_WEIGHTS, wheelPool } from './progression.js';
import { rarityRank, type CosmeticItem, type Rarity } from './cosmetics.js';

/**
 * The strip of items a case-opening reel scrolls past.
 *
 * The prize is decided first, by `rollWheel`, exactly as it was for the wheel — this only
 * decides what you *see* on the way there. Keeping those two apart is what stops the reel
 * ending up as the thing that picks the prize, which is how an opening animation quietly
 * becomes the odds.
 *
 * Everything before the winner is filler. The filler is not random: it is drawn at the real
 * rarity weights so the strip looks like the distribution it came from, and one slot is
 * deliberately loaded — see `NEAR_MISS_INDEX`.
 */

/** How many cells the strip holds. Long enough to blur, short enough to build in one go. */
export const REEL_LENGTH = 56;

/**
 * Where the winning item sits. Near the end, with a few cells after it so the strip does not
 * visibly run out — a reel that stops because it has nothing left to show feels broken rather
 * than decided.
 */
export const REEL_WINNER_INDEX = REEL_LENGTH - 6;

/**
 * The cell immediately before the winner.
 *
 * This is the near-miss slot: the thing you watch slide past just before it stops. Loading it
 * with something *better* than the prize is the single cheapest way to make a common feel like
 * a story rather than a shrug — and it is honest, because it changes nothing about what you
 * actually get.
 */
export const NEAR_MISS_INDEX = REEL_WINNER_INDEX - 1;

export interface ReelCell {
  item: CosmeticItem;
  /** True for the one you actually won. */
  winner: boolean;
  /** True for the deliberately-better item that slides past just before it. */
  nearMiss: boolean;
}

function pickWeighted(pool: CosmeticItem[], rng: () => number): CosmeticItem {
  const total = pool.reduce((sum, item) => sum + RARITY_WEIGHTS[item.rarity], 0);
  let roll = rng() * total;
  for (const item of pool) {
    roll -= RARITY_WEIGHTS[item.rarity];
    if (roll <= 0) return item;
  }
  return pool[pool.length - 1];
}

/**
 * Builds the strip for a given prize.
 *
 * `rng` is injected so the layout can be pinned in a test; the prize itself is already decided
 * by the time this is called and is never chosen here.
 */
export function buildReel(
  prize: CosmeticItem,
  rng: () => number = Math.random,
  pool: CosmeticItem[] = wheelPool()
): ReelCell[] {
  const cells: ReelCell[] = [];
  const usable = pool.length > 0 ? pool : [prize];

  for (let i = 0; i < REEL_LENGTH; i++) {
    if (i === REEL_WINNER_INDEX) {
      cells.push({ item: prize, winner: true, nearMiss: false });
      continue;
    }
    if (i === NEAR_MISS_INDEX) {
      const tease = pickNearMiss(prize, usable, rng);
      // Flagged on rank, not on "different rarity". Winning the best thing there is leaves
      // nothing to tease with, and calling the ordinary fallback a near-miss would be the
      // animation claiming a let-down that never happened.
      const teases = rarityRank(tease.rarity) > rarityRank(prize.rarity);
      cells.push({ item: tease, winner: false, nearMiss: teases });
      continue;
    }

    // Filler. Avoid repeating the prize elsewhere on the strip: seeing the item you are about
    // to win slide past three times beforehand gives the ending away.
    let filler = pickWeighted(usable, rng);
    for (let attempt = 0; filler.id === prize.id && attempt < 8; attempt++) {
      filler = pickWeighted(usable, rng);
    }
    cells.push({ item: filler, winner: false, nearMiss: false });
  }
  return cells;
}

/**
 * The item that slides past just before the prize.
 *
 * Prefers something rarer than what you won — that is the whole trick. When you have won the
 * best thing there is, there is nothing to tease with, so it falls back to an ordinary pick
 * rather than inventing a fake let-down.
 */
function pickNearMiss(prize: CosmeticItem, pool: CosmeticItem[], rng: () => number): CosmeticItem {
  const better = pool.filter(
    (i) => rarityRank(i.rarity) > rarityRank(prize.rarity) && i.id !== prize.id
  );
  if (better.length === 0) return pickWeighted(pool, rng);
  return better[Math.floor(rng() * better.length)];
}

/**
 * How long the reel should run, and how hard it should be sold.
 *
 * Rarer prizes get a longer settle. It is a small thing and it is doing real work: the length
 * of the pause before the reveal is the game telling you something is coming, and if a common
 * and a mystic take exactly as long then nothing is being told.
 */
export function reelTiming(rarity: Rarity): { durationMs: number; settleMs: number } {
  const rank = rarityRank(rarity);
  return {
    durationMs: 4200 + rank * 700,
    // The final crawl, where it moves less than a cell and takes its time about it.
    settleMs: 700 + rank * 320,
  };
}

/**
 * Eased position along the strip, 0..1.
 *
 * One curve, and its speed only ever falls. This used to be two curves stitched together, a
 * run and then a crawl, and the stitch was the bug everybody saw: the run decelerated to a
 * near-stop exactly at the seam, and the crawl then started from a standing position at
 * several cells a second. On a 54-cell strip the crawl covered the last two cells, so every
 * single case slowed to a halt, lurched forward two items, and stopped again.
 *
 * A power ease-out is fast, then slow, then agonising without any seam to lurch at: velocity
 * is `p(1-t)^(p-1)`, which falls continuously to zero at the prize. `settleFraction` sets the
 * power, so a rarer prize (longer settle) spends proportionally longer on its last cell.
 */
export function reelEase(t: number, settleFraction: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - clamped, reelPower(settleFraction));
}

/**
 * The ease's exponent. About 3.2 for a common and 3.5 for a mystic: at 3.2 the last cell of a
 * 54-cell strip takes the final ~29% of the run, which is the tension, and the final half
 * second still visibly moves rather than sitting dead before the reveal.
 */
function reelPower(settleFraction: number): number {
  const settle = Math.max(0.05, Math.min(0.9, settleFraction));
  return 2.8 + settle * 2.4;
}
