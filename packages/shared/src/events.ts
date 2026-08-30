import type { GameMode } from './types.js';
import type { RuleSetId } from './ruleSets.js';

/**
 * Scheduled tournaments the game runs itself.
 *
 * Derived from the date rather than stored anywhere, exactly the way `dailyChallenge.ts` and
 * `season.ts` already derive theirs. That is not a shortcut — it means every client agrees on
 * the schedule without asking, the calendar survives a server restart, and there is nothing to
 * migrate when the server moves. The only thing that needs persisting is a tournament actually
 * in progress.
 *
 * The point of a fixed weekly slot is that people can *plan* to be there. A tournament that
 * starts when eight strangers happen to want one is a tournament that never starts.
 */

export interface ScheduledEvent {
  id: string;
  name: string;
  blurb: string;
  mode: GameMode;
  ruleSet: RuleSetId;
  /** Entrants the bracket is built for. */
  entrants: number;
  /** Frames to take a match. */
  target: number;
  /** Day of the week, 0 = Sunday, matching `Date.getUTCDay`. */
  day: number;
  /** Hour it opens, UTC. */
  hour: number;
  /** How long the doors stay open before it starts. */
  signupMinutes: number;
}

/**
 * The weekly calendar.
 *
 * Times are UTC and stated as such everywhere they are shown. A "7pm" that means something
 * different depending on where you are reading it is the single most common way an online
 * schedule loses people.
 */
export const SCHEDULED_EVENTS: ScheduledEvent[] = [
  {
    id: 'event.sunday-shootout',
    name: 'Sunday Shootout',
    blurb: 'Eight players, straight knockout, pub rules. The week ends here.',
    mode: 'classic',
    ruleSet: 'pub',
    entrants: 8,
    target: 1,
    day: 0,
    hour: 19,
    signupMinutes: 15,
  },
  {
    id: 'event.midweek-nine',
    name: 'Midweek Nine',
    blurb: 'Nine-ball, four entrants, best of three. Short and sharp.',
    mode: 'nineball',
    ruleSet: 'tournament',
    entrants: 4,
    target: 3,
    day: 3,
    hour: 20,
    signupMinutes: 10,
  },
  {
    id: 'event.friday-frenzy',
    name: 'Friday Frenzy',
    blurb: 'Power-up pool, eight entrants, nothing taken seriously.',
    mode: 'powerup',
    ruleSet: 'casual',
    entrants: 8,
    target: 1,
    day: 5,
    hour: 21,
    signupMinutes: 15,
  },
];

/** When this event next opens its doors, at or after `from`. */
export function nextOccurrence(event: ScheduledEvent, from = new Date()): Date {
  const next = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), event.hour, 0, 0, 0)
  );
  // Wind forward to the right weekday, then a week further if that moment has already gone.
  const daysAhead = (event.day - next.getUTCDay() + 7) % 7;
  next.setUTCDate(next.getUTCDate() + daysAhead);
  if (next.getTime() <= from.getTime()) next.setUTCDate(next.getUTCDate() + 7);
  return next;
}

export type EventPhase = 'scheduled' | 'signup' | 'running';

export interface EventStatus {
  event: ScheduledEvent;
  phase: EventPhase;
  /** When sign-ups open. */
  opensAt: number;
  /** When the bracket is drawn and it begins. */
  startsAt: number;
}

/**
 * Where each event stands right now.
 *
 * `signup` is the window between the doors opening and the bracket being drawn — the only time
 * anyone can enter. `running` is a best guess at the couple of hours afterwards, used only to
 * decide what the lobby says; the authority on whether a tournament is actually still going is
 * the tournament itself.
 */
export function eventStatus(event: ScheduledEvent, now = new Date()): EventStatus {
  const signupMs = event.signupMinutes * 60_000;
  // Look back at this week's slot as well as forward, so an event that opened ten minutes ago
  // reads as open rather than as one due in seven days.
  const upcoming = nextOccurrence(event, now);
  const previous = new Date(upcoming.getTime() - 7 * 24 * 60 * 60 * 1000);

  const candidate = now.getTime() < previous.getTime() + signupMs + RUNNING_WINDOW_MS
    ? previous
    : upcoming;

  const opensAt = candidate.getTime();
  const startsAt = opensAt + signupMs;

  let phase: EventPhase = 'scheduled';
  if (now.getTime() >= opensAt && now.getTime() < startsAt) phase = 'signup';
  else if (now.getTime() >= startsAt && now.getTime() < startsAt + RUNNING_WINDOW_MS) phase = 'running';

  return { event, phase, opensAt, startsAt };
}

/** Roughly how long an event is assumed to take, for the lobby's benefit only. */
export const RUNNING_WINDOW_MS = 2 * 60 * 60 * 1000;

/** Every event, soonest first. */
export function upcomingEvents(now = new Date()): EventStatus[] {
  return SCHEDULED_EVENTS.map((e) => eventStatus(e, now)).sort((a, b) => {
    // Anything happening now goes to the top; otherwise soonest first.
    const rank = (s: EventStatus): number => (s.phase === 'signup' ? 0 : s.phase === 'running' ? 1 : 2);
    const byPhase = rank(a) - rank(b);
    return byPhase !== 0 ? byPhase : a.opensAt - b.opensAt;
  });
}

/** The one you can enter right now, if any. */
export function openForSignup(now = new Date()): EventStatus | null {
  return upcomingEvents(now).find((s) => s.phase === 'signup') ?? null;
}

/** "in 2d 4h", "in 14m", "now" — a countdown people can act on. */
export function timeUntil(ms: number, now = Date.now()): string {
  const delta = ms - now;
  if (delta <= 0) return 'now';
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `in ${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `in ${days}d ${hours % 24}h`;
}
