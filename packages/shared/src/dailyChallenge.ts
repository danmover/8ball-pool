/**
 * The daily challenge is derived from the date, so every device agrees on today's objective
 * with no server state and no clock sync — the same trick the wheel uses for determinism.
 */

export type ChallengeKind =
  | 'multiPot' // pot N balls on a single shot
  | 'cleanFrame' // win a frame without fouling
  | 'potCount' // pot N balls across the day
  | 'winSolo' // beat the computer
  | 'comboStreak'; // score on N consecutive visits

export interface DailyChallenge {
  id: string;
  kind: ChallengeKind;
  text: string;
  /** How many of the thing are needed. */
  target: number;
  xp: number;
}

const POOL: Array<Omit<DailyChallenge, 'id'>> = [
  { kind: 'multiPot', target: 2, text: 'Pot two balls on a single shot', xp: 120 },
  { kind: 'multiPot', target: 3, text: 'Pot three balls on a single shot', xp: 220 },
  { kind: 'potCount', target: 10, text: 'Pot 10 balls today', xp: 120 },
  { kind: 'potCount', target: 20, text: 'Pot 20 balls today', xp: 200 },
  { kind: 'cleanFrame', target: 1, text: 'Win a frame without fouling once', xp: 200 },
  { kind: 'winSolo', target: 1, text: 'Beat the computer', xp: 150 },
  { kind: 'winSolo', target: 2, text: 'Beat the computer twice', xp: 260 },
  { kind: 'comboStreak', target: 3, text: 'Score on three visits in a row', xp: 180 },
];

/** YYYY-MM-DD in UTC — the challenge's identity and the key progress is stored under. */
export function challengeDateKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function hashDate(key: string): number {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function challengeForDate(date = new Date()): DailyChallenge {
  const key = challengeDateKey(date);
  const entry = POOL[hashDate(key) % POOL.length];
  return { id: key, ...entry };
}
