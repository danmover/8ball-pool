import { challengeDateKey, challengeForDate, type DailyChallenge } from '@8ball/shared';
import { getProfile, grantSpin, grantXp, setDailyProgress } from './profile';

/**
 * Client-side tracking for the daily challenge. Progress is fed by the same shot summaries
 * `PotCelebrator` already produces, and is stored in the profile stamped with the day so it
 * resets itself at midnight UTC without any bookkeeping.
 */

export interface ChallengeProgress {
  /** The day this progress belongs to. */
  date: string;
  value: number;
  completed: boolean;
  /** Reward already banked, so it can't be claimed twice. */
  claimed: boolean;
}

export function challengeForToday(): DailyChallenge {
  return challengeForDate();
}

export function challengeProgress(): ChallengeProgress {
  const today = challengeDateKey();
  const stored = getProfile().daily;
  if (!stored || stored.date !== today) {
    return { date: today, value: 0, completed: false, claimed: false };
  }
  return stored;
}

/** Records progress and pays out the moment the objective is met. */
export function recordChallengeEvent(event: {
  potsThisShot?: number;
  frameWon?: boolean;
  frameClean?: boolean;
  vsBot?: boolean;
  scoringStreak?: number;
}): { justCompleted: boolean; challenge: DailyChallenge } {
  const challenge = challengeForToday();
  const progress = challengeProgress();

  if (progress.completed) return { justCompleted: false, challenge };

  switch (challenge.kind) {
    case 'multiPot':
      progress.value = Math.max(progress.value, event.potsThisShot ?? 0);
      break;
    case 'potCount':
      progress.value += event.potsThisShot ?? 0;
      break;
    case 'cleanFrame':
      if (event.frameWon && event.frameClean) progress.value += 1;
      break;
    case 'winSolo':
      if (event.frameWon && event.vsBot) progress.value += 1;
      break;
    case 'comboStreak':
      progress.value = Math.max(progress.value, event.scoringStreak ?? 0);
      break;
  }

  const justCompleted = progress.value >= challenge.target;
  progress.completed = justCompleted;

  if (justCompleted && !progress.claimed) {
    progress.claimed = true;
    setDailyProgress(progress);
    grantXp(challenge.xp);
    grantSpin(1);
  } else {
    setDailyProgress(progress);
  }

  return { justCompleted, challenge };
}
