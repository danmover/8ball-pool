/**
 * Daily missions: three a day, chosen from a pool by the date, so everyone playing on the same
 * day gets the same three and a new set arrives at midnight.
 *
 * Progress is counted from `MissionEvents` — plain tallies the table reports at the end of each
 * frame — so a mission is just a metric, a target and a reward.
 */

export type MissionMetric =
  | 'games'
  | 'wins'
  | 'pots'
  | 'nineballWins'
  | 'killerWins'
  | 'powerWins'
  | 'multiPots'
  | 'runs4'
  | 'kickPots'
  | 'cleanWins'
  | 'jumpPots'
  | 'proWins'
  | 'orbs'
  | 'trickStars'
  | 'timeAttackClears'
  | 'friendGames';

/** What one finished frame (or solo run) contributes to each metric. */
export type MissionEvents = Partial<Record<MissionMetric, number>>;

export interface MissionDef {
  id: string;
  metric: MissionMetric;
  target: number;
  /** `{n}` is replaced with the target. */
  text: string;
  coins: number;
  xp: number;
}

export const MISSION_POOL: MissionDef[] = [
  { id: 'm.games3', metric: 'games', target: 3, text: 'Play {n} games', coins: 100, xp: 80 },
  { id: 'm.wins2', metric: 'wins', target: 2, text: 'Win {n} games', coins: 150, xp: 120 },
  { id: 'm.pots25', metric: 'pots', target: 25, text: 'Pot {n} balls', coins: 120, xp: 100 },
  { id: 'm.pots40', metric: 'pots', target: 40, text: 'Pot {n} balls', coins: 180, xp: 140 },
  { id: 'm.nine1', metric: 'nineballWins', target: 1, text: 'Win a game of 9-Ball', coins: 150, xp: 120 },
  { id: 'm.killer1', metric: 'killerWins', target: 1, text: 'Win a game of Killer', coins: 150, xp: 120 },
  { id: 'm.power1', metric: 'powerWins', target: 1, text: 'Win a game of Power Pool', coins: 150, xp: 120 },
  { id: 'm.multi3', metric: 'multiPots', target: 3, text: 'Pot 2+ balls in one shot {n} times', coins: 140, xp: 110 },
  { id: 'm.run4', metric: 'runs4', target: 1, text: 'Pot 4 balls in a single visit', coins: 150, xp: 120 },
  { id: 'm.kick2', metric: 'kickPots', target: 2, text: 'Pot {n} balls off a cushion kick', coins: 160, xp: 130 },
  { id: 'm.clean1', metric: 'cleanWins', target: 1, text: 'Win a game without a foul', coins: 160, xp: 130 },
  { id: 'm.jump1', metric: 'jumpPots', target: 1, text: 'Pot a ball with a jump shot', coins: 180, xp: 140 },
  { id: 'm.pro1', metric: 'proWins', target: 1, text: 'Beat a Pro or Master bot', coins: 200, xp: 160 },
  { id: 'm.orbs4', metric: 'orbs', target: 4, text: 'Collect {n} power orbs', coins: 120, xp: 100 },
  { id: 'm.stars3', metric: 'trickStars', target: 3, text: 'Earn {n} trick-shot stars', coins: 140, xp: 110 },
  { id: 'm.time1', metric: 'timeAttackClears', target: 1, text: 'Clear a Time Attack run', coins: 150, xp: 120 },
  { id: 'm.friends1', metric: 'friendGames', target: 1, text: 'Play a game with friends', coins: 150, xp: 120 },
];

/** Bonus for finishing all three of the day's missions. */
export const ALL_MISSIONS_BONUS = { coins: 250, xp: 200 };

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The three missions for a given day. Never two on the same metric. */
export function dailyMissions(day: string): MissionDef[] {
  const out: MissionDef[] = [];
  const used = new Set<MissionMetric>();
  let seed = hash(day);
  for (let tries = 0; out.length < 3 && tries < 200; tries++) {
    seed = Math.imul(seed ^ (seed >>> 15), 2246822507) >>> 0;
    const pick = MISSION_POOL[seed % MISSION_POOL.length];
    if (used.has(pick.metric)) continue;
    used.add(pick.metric);
    out.push(pick);
  }
  return out;
}

export function missionText(def: MissionDef): string {
  return def.text.replace('{n}', String(def.target));
}
