import type { BotTier, GameMode } from './types.js';
import { BOTS, type BotProfile } from './bots/roster.js';

/**
 * Cups: eight-player knockouts against the bots, played offline.
 *
 * Each cup is a field of seven named opponents drawn from the tiers it lists, a race length, and
 * a prize. Winning one unlocks the next. The later prizes are items you cannot buy.
 */

export interface CupDef {
  id: string;
  name: string;
  blurb: string;
  icon: string;
  accent: string;
  mode: GameMode;
  /** Frames to win each tie. */
  raceTo: number;
  /** How many of the seven opponents come from each tier. */
  field: Partial<Record<BotTier, number>>;
  reward: { coins: number; xp: number; item: string | null };
  /** Cup that must be won first. */
  requires: string | null;
}

export const CUPS: CupDef[] = [
  {
    id: 'cup.rookie',
    name: 'Rookie Cup',
    blurb: 'Your first bracket. Friendly faces, forgiving pockets.',
    icon: '🥉',
    accent: '#d08a4e',
    mode: 'eightball',
    raceTo: 1,
    field: { rookie: 3, amateur: 3, pro: 1 },
    reward: { coins: 350, xp: 300, item: null },
    requires: null,
  },
  {
    id: 'cup.club',
    name: 'Club Cup',
    blurb: 'The regulars take this one seriously.',
    icon: '🥈',
    accent: '#c3cad6',
    mode: 'eightball',
    raceTo: 1,
    field: { rookie: 1, amateur: 3, pro: 3 },
    reward: { coins: 700, xp: 500, item: null },
    requires: 'cup.rookie',
  },
  {
    id: 'cup.nine',
    name: '9-Ball Open',
    blurb: 'Lowest ball first, and every tie is a race to two.',
    icon: '9️⃣',
    accent: '#ffc542',
    mode: 'nineball',
    raceTo: 2,
    field: { amateur: 3, pro: 3, master: 1 },
    reward: { coins: 1000, xp: 700, item: null },
    requires: 'cup.club',
  },
  {
    id: 'cup.pro',
    name: 'Pro Cup',
    blurb: 'Racing to two against the best in the hall. Win the Royale table.',
    icon: '🥇',
    accent: '#ffcf4a',
    mode: 'eightball',
    raceTo: 2,
    field: { amateur: 2, pro: 3, master: 2 },
    reward: { coins: 1500, xp: 1000, item: 'table.royale' },
    requires: 'cup.club',
  },
  {
    id: 'cup.master',
    name: 'Master Cup',
    blurb: 'Every master in the building. The prize is solid gold.',
    icon: '🏆',
    accent: '#ff9f43',
    mode: 'eightball',
    raceTo: 2,
    field: { amateur: 1, pro: 3, master: 3 },
    reward: { coins: 3000, xp: 2000, item: 'cue.midas' },
    requires: 'cup.pro',
  },
];

export function cupById(id: string | null | undefined): CupDef | undefined {
  return CUPS.find((c) => c.id === id);
}

export function cupUnlocked(cup: CupDef, won: readonly string[]): boolean {
  return cup.requires === null || won.includes(cup.requires);
}

/** Seven distinct opponents for a cup. */
export function cupField(cup: CupDef, rand: () => number = Math.random): BotProfile[] {
  const out: BotProfile[] = [];
  for (const [tier, count] of Object.entries(cup.field) as [BotTier, number][]) {
    const pool = BOTS.filter((b) => b.tier === tier && !out.includes(b));
    for (let i = 0; i < count && pool.length > 0; i++) {
      const pick = pool.splice(Math.floor(rand() * pool.length), 1)[0];
      out.push(pick);
    }
  }
  // Top up from anyone left if a tier ran short.
  const rest = BOTS.filter((b) => !out.includes(b));
  while (out.length < 7 && rest.length > 0) out.push(rest.splice(Math.floor(rand() * rest.length), 1)[0]);
  return out;
}
