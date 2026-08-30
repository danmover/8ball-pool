import type { BotDifficulty, GameMode } from './types.js';
import type { RuleSetId } from './ruleSets.js';

/**
 * The career ladder: a run of named opponents, each at their own table.
 *
 * This exists to give two things that were already built a reason to be used. The bot has four
 * tiers that nothing ever asked you to climb, and there are seven drawn rooms you could only
 * see by changing a setting. A ladder turns both into a journey — and, just as importantly,
 * gives the first reliable way to earn a *named* cosmetic instead of hoping at the wheel.
 *
 * Pure data and pure functions, like `challenges.ts` and `dailyChallenge.ts`, so the whole
 * thing is testable without a server or a browser.
 */

/**
 * The venues a career opponent can be sent to.
 *
 * The table themes themselves are client-side — they're colours and drawn rooms, which the
 * server has no use for. But the ladder names them, so the *ids* have to be agreed somewhere
 * both sides can see, or a typo here becomes a career match at a table that doesn't exist.
 * `tableThemes.ts` is checked against this list by a test on the client side.
 */
export const TABLE_THEME_IDS = [
  'classic',
  'midnight',
  'crimson',
  'sandstone',
  'neon',
  'ice',
  'vintage',
] as const;

export type VenueId = (typeof TABLE_THEME_IDS)[number];

export interface CareerOpponent {
  id: string;
  name: string;
  /** A line of character, shown on the ladder card. */
  taunt: string;
  difficulty: BotDifficulty;
  /** Their home table — one of the drawn rooms in `tableThemes.ts`. */
  venue: VenueId;
  mode: GameMode;
  ruleSet: RuleSetId;
  /** Frames needed to beat them. Later opponents want a real match, not one lucky frame. */
  target: number;
  /** Cosmetic handed over the first time you win. */
  reward: string;
  xp: number;
}

export interface CareerChapter {
  id: string;
  name: string;
  blurb: string;
  opponents: CareerOpponent[];
}

/**
 * Five chapters that walk from a pub table to a tournament.
 *
 * The progression is deliberate on three axes at once, so it never feels like the same match
 * with a bigger number attached: the opponent gets better, the *rules* get stricter, and the
 * match gets longer. Somebody who beats the last chapter has learned to call their shots and
 * to win over five frames, not just to pot well once.
 */
export const CAREER: CareerChapter[] = [
  {
    id: 'locals',
    name: 'The Locals',
    blurb: 'A wooden table, a warm pint and nobody taking it too seriously.',
    opponents: [
      {
        id: 'rita',
        name: 'Rookie Rita',
        taunt: "I've only been playing a fortnight, so go easy.",
        difficulty: 'rookie',
        venue: 'classic',
        mode: 'classic',
        ruleSet: 'casual',
        target: 1,
        reward: 'cue.bamboo',
        xp: 150,
      },
      {
        id: 'pete',
        name: 'Chalky Pete',
        taunt: 'Loser racks. That has always been the rule.',
        difficulty: 'rookie',
        venue: 'classic',
        mode: 'classic',
        ruleSet: 'casual',
        target: 2,
        reward: 'banner.chalkboard',
        xp: 220,
      },
      {
        id: 'sam',
        name: 'Sunday Sam',
        taunt: "One frame before lunch. I've time for one frame.",
        difficulty: 'club',
        venue: 'vintage',
        mode: 'classic',
        ruleSet: 'pub',
        target: 2,
        reward: 'trail.smoke',
        xp: 300,
      },
    ],
  },
  {
    id: 'circuit',
    name: 'The Circuit',
    blurb: 'Other rooms, other rules. People here keep score.',
    opponents: [
      {
        id: 'bex',
        name: 'Bar-Room Bex',
        taunt: 'Four to a rail or rack them again. House rules.',
        difficulty: 'club',
        venue: 'crimson',
        mode: 'classic',
        ruleSet: 'pub',
        target: 3,
        reward: 'balls.marble',
        xp: 400,
      },
      {
        id: 'nia',
        name: 'Nine-Ball Nia',
        taunt: 'Lowest ball first. Try to keep up.',
        difficulty: 'club',
        venue: 'midnight',
        mode: 'nineball',
        ruleSet: 'pub',
        target: 3,
        reward: 'cue.copper',
        xp: 480,
      },
      {
        id: 'marco',
        name: 'Two-Cushion Marco',
        taunt: 'I never take the shot that is there. I take the one after it.',
        difficulty: 'shark',
        venue: 'sandstone',
        mode: 'classic',
        ruleSet: 'pub',
        target: 3,
        reward: 'trail.bubble',
        xp: 600,
      },
    ],
  },
  {
    id: 'hustlers',
    name: 'The Hustlers',
    blurb: 'Everyone here is better than they let on. Call your shots.',
    opponents: [
      {
        id: 'kim',
        name: 'Cue-Ball Kim',
        taunt: 'Watch where the white finishes. That is the whole game.',
        difficulty: 'shark',
        venue: 'midnight',
        mode: 'classic',
        ruleSet: 'tournament',
        target: 3,
        reward: 'balls.glass',
        xp: 750,
      },
      {
        id: 'sid',
        name: 'Side-Pocket Sid',
        taunt: 'Middle bag. Always the middle bag.',
        difficulty: 'shark',
        venue: 'neon',
        mode: 'classic',
        ruleSet: 'tournament',
        target: 4,
        reward: 'hit.lightning',
        xp: 900,
      },
      {
        id: 'frost',
        name: 'The Frost',
        taunt: 'I will leave you nothing. Twice.',
        difficulty: 'shark',
        venue: 'ice',
        mode: 'classic',
        ruleSet: 'tournament',
        target: 4,
        reward: 'cue.tidal',
        xp: 1100,
      },
    ],
  },
  {
    id: 'invitational',
    name: 'The Invitational',
    blurb: 'You had to be asked. Five frames, tournament rules, no excuses.',
    opponents: [
      {
        id: 'rook',
        name: 'The Rook',
        taunt: 'Rotation. Every ball in order, every time.',
        difficulty: 'legend',
        venue: 'crimson',
        mode: 'rotation',
        ruleSet: 'tournament',
        target: 3,
        reward: 'banner.marble',
        xp: 1300,
      },
      {
        id: 'mr147',
        name: 'Mr 147',
        taunt: 'I have cleared tables you have not finished breaking.',
        difficulty: 'legend',
        venue: 'vintage',
        mode: 'classic',
        ruleSet: 'tournament',
        target: 5,
        reward: 'balls.gold',
        xp: 1600,
      },
    ],
  },
  {
    id: 'champion',
    name: 'The Champion',
    blurb: 'One table. One person left to beat.',
    opponents: [
      {
        id: 'legend',
        name: 'The Legend',
        taunt: 'Nobody remembers who came second.',
        difficulty: 'legend',
        venue: 'neon',
        mode: 'classic',
        ruleSet: 'tournament',
        target: 5,
        reward: 'banner.champion',
        xp: 2500,
      },
    ],
  },
];

/** Every opponent, flattened into ladder order. */
export function careerOpponents(): CareerOpponent[] {
  return CAREER.flatMap((chapter) => chapter.opponents);
}

export function careerOpponentById(id: string): CareerOpponent | undefined {
  return careerOpponents().find((o) => o.id === id);
}

function careerChapterOf(opponentId: string): CareerChapter | undefined {
  return CAREER.find((c) => c.opponents.some((o) => o.id === opponentId));
}

/**
 * Which opponents are playable, given who has already been beaten.
 *
 * Strictly one at a time: the ladder is only a ladder if you have to climb it in order. Beaten
 * opponents stay available so a favourite match can be replayed — just without the reward,
 * which is handled by the caller.
 */
export function careerUnlocked(beaten: readonly string[]): string[] {
  const done = new Set(beaten);
  const all = careerOpponents();
  const out: string[] = [];
  for (const opponent of all) {
    out.push(opponent.id);
    if (!done.has(opponent.id)) break; // the first unbeaten one is as far as you get
  }
  return out;
}

/** The next opponent to play, or null once the ladder is finished. */
export function careerNext(beaten: readonly string[]): CareerOpponent | null {
  const done = new Set(beaten);
  return careerOpponents().find((o) => !done.has(o.id)) ?? null;
}

export function careerProgress(beaten: readonly string[]): { beaten: number; total: number } {
  const done = new Set(beaten);
  const all = careerOpponents();
  return { beaten: all.filter((o) => done.has(o.id)).length, total: all.length };
}
