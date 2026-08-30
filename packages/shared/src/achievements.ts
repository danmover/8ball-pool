/**
 * Named feats, awarded for things the game already knows you did.
 *
 * Deliberately evaluated from a plain snapshot of counters rather than by sprinkling award
 * calls through the codebase. Every achievement is a pure predicate over `AchievementStats`,
 * so adding one is adding a row to a table — and, more usefully, so the whole set can be
 * re-evaluated from scratch after a change without anyone having to replay anything.
 */

export type AchievementCategory = 'potting' | 'skill' | 'career' | 'collection' | 'grind';

export interface AchievementStats {
  /** Lifetime totals. */
  pots: number;
  wins: number;
  games: number;
  bestCombo: number;
  /** Best clearance: most balls potted in a single visit. */
  bestRun: number;
  /** Frames won without a single foul. */
  cleanFrames: number;
  /** Longest run of frames won in a row. */
  bestWinStreak: number;
  /** Bot tiers beaten at least once. */
  beatenTiers: readonly string[];
  /** Career opponents beaten. */
  careerBeaten: readonly string[];
  /** Career chapters fully cleared. */
  chaptersCleared: number;
  /** Cosmetics owned, and how many of the very rarest. */
  unlocked: number;
  mysticsOwned: number;
  /** Trick-shot stars earned. */
  challengeStars: number;
  /** Shots that used a raised cue for real: jumped a ball, or curved one. */
  jumpPots: number;
  massePots: number;
  /** Balls potted after being called, under tournament rules. */
  calledPots: number;
  /** Times the tip slipped. Some feats are for surviving your own mistakes. */
  miscues: number;
}

export interface Achievement {
  id: string;
  name: string;
  blurb: string;
  category: AchievementCategory;
  xp: number;
  chalk: number;
  /** Progress toward it, 0..1, for a bar on the card. */
  progress: (s: AchievementStats) => number;
}

/** A tiered achievement — the same feat at rising thresholds. */
function tiers(
  base: string,
  category: AchievementCategory,
  names: string[],
  thresholds: number[],
  blurb: (n: number) => string,
  value: (s: AchievementStats) => number
): Achievement[] {
  return thresholds.map((threshold, i) => ({
    id: `${base}.${i + 1}`,
    name: names[i],
    blurb: blurb(threshold),
    category,
    // Later tiers are worth more, but not linearly — the first one should still feel like
    // something, and the last shouldn't dwarf everything else in the game.
    xp: 120 + i * 180,
    chalk: 40 + i * 70,
    progress: (s) => Math.min(1, value(s) / threshold),
  }));
}

const single = (
  id: string,
  name: string,
  blurb: string,
  category: AchievementCategory,
  xp: number,
  chalk: number,
  done: (s: AchievementStats) => boolean
): Achievement => ({
  id,
  name,
  blurb,
  category,
  xp,
  chalk,
  progress: (s) => (done(s) ? 1 : 0),
});

export const ACHIEVEMENTS: Achievement[] = [
  // ---- Potting ----
  ...tiers(
    'pots',
    'potting',
    ['First Blood', 'Regular', 'Cloth Merchant', 'Table Fixture', 'Legend of the Baize'],
    [1, 100, 500, 2000, 10000],
    (n) => `Pot ${n.toLocaleString()} ball${n === 1 ? '' : 's'}`,
    (s) => s.pots
  ),
  ...tiers(
    'combo',
    'potting',
    ['Double Up', 'Hat-Trick', 'Four at Once', 'Absurd'],
    [2, 3, 4, 5],
    (n) => `Pot ${n} balls on a single shot`,
    (s) => s.bestCombo
  ),
  ...tiers(
    'run',
    'potting',
    ['On a Roll', 'Half the Table', 'Clearance', 'Total Clearance'],
    [3, 5, 7, 8],
    (n) => `Pot ${n} balls in one visit`,
    (s) => s.bestRun
  ),

  // ---- Skill ----
  ...tiers(
    'jump',
    'skill',
    ['Airborne', 'Leapfrog', 'Flight School'],
    [1, 10, 50],
    (n) => `Pot ${n} ball${n === 1 ? '' : 's'} with a jump shot`,
    (s) => s.jumpPots
  ),
  ...tiers(
    'masse',
    'skill',
    ['Bending It', 'Curveball', 'Massé Artist'],
    [1, 10, 50],
    (n) => `Pot ${n} ball${n === 1 ? '' : 's'} with a curved shot`,
    (s) => s.massePots
  ),
  ...tiers(
    'called',
    'skill',
    ['As Called', 'Nothing Lucky', 'Nominated'],
    [10, 100, 500],
    (n) => `Pot ${n} called balls under tournament rules`,
    (s) => s.calledPots
  ),
  ...tiers(
    'clean',
    'skill',
    ['Spotless', 'Immaculate', 'Untouchable'],
    [1, 10, 50],
    (n) => `Win ${n} frame${n === 1 ? '' : 's'} without a single foul`,
    (s) => s.cleanFrames
  ),
  single(
    'miscue.first',
    'That Went Badly',
    'Slip off the ball for the first time',
    'skill',
    60,
    20,
    (s) => s.miscues >= 1
  ),
  single(
    'miscue.survivor',
    'Ugly but Effective',
    'Miscue 25 times and keep playing',
    'skill',
    200,
    90,
    (s) => s.miscues >= 25
  ),

  // ---- Winning ----
  ...tiers(
    'wins',
    'grind',
    ['Winner', 'Habit Forming', 'Table Boss', 'Unbeatable'],
    [1, 25, 100, 500],
    (n) => `Win ${n} frame${n === 1 ? '' : 's'}`,
    (s) => s.wins
  ),
  ...tiers(
    'streak',
    'grind',
    ['Two in a Row', 'On Fire', 'Nobody Else Is Playing'],
    [2, 5, 10],
    (n) => `Win ${n} frames in a row`,
    (s) => s.bestWinStreak
  ),
  ...tiers(
    'games',
    'grind',
    ['Getting Started', 'Committed', 'Lifer'],
    [10, 200, 1000],
    (n) => `Play ${n} frames`,
    (s) => s.games
  ),

  // ---- Career ----
  ...(['rookie', 'club', 'shark', 'legend'] as const).map((tier, i) =>
    single(
      `tier.${tier}`,
      { rookie: 'Beat a Rookie', club: 'Beat the Club', shark: 'Beat the Shark', legend: 'Beat the Legend' }[tier],
      `Win a frame against a ${tier} opponent`,
      'career',
      150 + i * 250,
      50 + i * 100,
      (s) => s.beatenTiers.includes(tier)
    )
  ),
  ...tiers(
    'career',
    'career',
    ['On the Ladder', 'Climbing', 'Contender', 'Champion'],
    [1, 5, 9, 12],
    (n) => `Beat ${n} career opponent${n === 1 ? '' : 's'}`,
    (s) => s.careerBeaten.length
  ),
  ...tiers(
    'chapters',
    'career',
    ['Chapter Closed', 'Halfway Up', 'The Whole Story'],
    [1, 3, 5],
    (n) => `Clear ${n} career chapter${n === 1 ? '' : 's'}`,
    (s) => s.chaptersCleared
  ),
  ...tiers(
    'stars',
    'career',
    ['Trick Shot Novice', 'Trick Shot Artist', 'Every Last Star'],
    [10, 22, 33],
    (n) => `Earn ${n} trick-shot stars`,
    (s) => s.challengeStars
  ),

  // ---- Collection ----
  ...tiers(
    'collect',
    'collection',
    ['Kitted Out', 'Collector', 'Completionist'],
    [10, 40, 80],
    (n) => `Own ${n} cosmetic items`,
    (s) => s.unlocked
  ),
  single(
    'mystic.first',
    'One of a Kind',
    'Own a Mystic item',
    'collection',
    600,
    250,
    (s) => s.mysticsOwned >= 1
  ),
  single(
    'mystic.three',
    'Mystic Hoarder',
    'Own three Mystic items',
    'collection',
    1200,
    500,
    (s) => s.mysticsOwned >= 3
  ),
];

export function achievementById(id: string): Achievement | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}

export interface AchievementUnlock {
  achievement: Achievement;
}

/**
 * Everything now earned that wasn't before.
 *
 * Takes the already-unlocked list rather than mutating anything, so the caller decides what to
 * do with the result — and so this can be run over a restored profile to backfill achievements
 * added after somebody had already earned them.
 */
export function newlyEarned(
  stats: AchievementStats,
  alreadyUnlocked: readonly string[]
): Achievement[] {
  const have = new Set(alreadyUnlocked);
  return ACHIEVEMENTS.filter((a) => !have.has(a.id) && a.progress(stats) >= 1);
}

function achievementProgress(
  stats: AchievementStats,
  unlocked: readonly string[]
): { earned: number; total: number } {
  const have = new Set(unlocked);
  return { earned: ACHIEVEMENTS.filter((a) => have.has(a.id)).length, total: ACHIEVEMENTS.length };
}
