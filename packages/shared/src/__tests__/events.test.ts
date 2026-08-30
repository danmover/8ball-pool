import { describe, expect, it } from 'vitest';
import {
  RUNNING_WINDOW_MS,
  SCHEDULED_EVENTS,
  eventStatus,
  nextOccurrence,
  openForSignup,
  timeUntil,
  upcomingEvents,
} from '../events.js';

/**
 * The schedule is derived from the date rather than stored, so every client agrees on it
 * without asking and it survives a server restart. That only holds if the derivation is exactly
 * right, hence pinning it against fixed instants rather than "now".
 */

/** A Sunday. 2026-03-01 is a Sunday, which makes the weekday arithmetic checkable by eye. */
const sunday = (h: number, m = 0) => new Date(Date.UTC(2026, 2, 1, h, m, 0, 0));
const wednesday = (h: number, m = 0) => new Date(Date.UTC(2026, 2, 4, h, m, 0, 0));

const shootout = SCHEDULED_EVENTS.find((e) => e.id === 'event.sunday-shootout')!;
const midweek = SCHEDULED_EVENTS.find((e) => e.id === 'event.midweek-nine')!;

describe('the calendar itself', () => {
  it('gives every event a unique id', () => {
    const ids = SCHEDULED_EVENTS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('only schedules bracket sizes that are powers of two', () => {
    for (const e of SCHEDULED_EVENTS) {
      expect(Number.isInteger(Math.log2(e.entrants)), `${e.id} has ${e.entrants} entrants`).toBe(true);
    }
  });

  it('leaves enough time to sign up', () => {
    for (const e of SCHEDULED_EVENTS) expect(e.signupMinutes).toBeGreaterThanOrEqual(5);
  });

  it('uses real weekdays and hours', () => {
    for (const e of SCHEDULED_EVENTS) {
      expect(e.day).toBeGreaterThanOrEqual(0);
      expect(e.day).toBeLessThanOrEqual(6);
      expect(e.hour).toBeGreaterThanOrEqual(0);
      expect(e.hour).toBeLessThanOrEqual(23);
    }
  });
});

describe('when an event next runs', () => {
  it('lands on the right weekday and hour', () => {
    const next = nextOccurrence(shootout, wednesday(12));
    expect(next.getUTCDay()).toBe(shootout.day);
    expect(next.getUTCHours()).toBe(shootout.hour);
  });

  it('rolls to next week once this week has gone', () => {
    const justAfter = sunday(shootout.hour, 1);
    const next = nextOccurrence(shootout, justAfter);
    expect(next.getTime()).toBeGreaterThan(justAfter.getTime());
    expect(next.getUTCDate()).toBe(8); // the following Sunday
  });

  it('finds today when it is still to come', () => {
    const next = nextOccurrence(shootout, sunday(shootout.hour - 2));
    expect(next.getUTCDate()).toBe(1);
  });
});

describe('what phase it is in', () => {
  it('is scheduled well beforehand', () => {
    expect(eventStatus(shootout, wednesday(12)).phase).toBe('scheduled');
  });

  it('opens for sign-up at the hour', () => {
    const status = eventStatus(shootout, sunday(shootout.hour, 1));
    expect(status.phase).toBe('signup');
  });

  it('closes sign-ups when it starts', () => {
    const status = eventStatus(shootout, sunday(shootout.hour, shootout.signupMinutes + 1));
    expect(status.phase).toBe('running');
  });

  it('is back to scheduled once it is long over', () => {
    const after = new Date(
      sunday(shootout.hour).getTime() + RUNNING_WINDOW_MS + 60 * 60 * 1000
    );
    expect(eventStatus(shootout, after).phase).toBe('scheduled');
  });

  it('reads an event that opened minutes ago as open, not as one due next week', () => {
    // The trap in deriving from a date: looking only forward makes a live event look a week away.
    const status = eventStatus(shootout, sunday(shootout.hour, 5));
    expect(status.phase).toBe('signup');
    expect(status.startsAt).toBeGreaterThan(sunday(shootout.hour, 5).getTime());
  });
});

describe('the lobby view of it', () => {
  it('puts anything happening now at the top', () => {
    const list = upcomingEvents(sunday(shootout.hour, 1));
    expect(list[0].event.id).toBe(shootout.id);
    expect(list[0].phase).toBe('signup');
  });

  it('otherwise lists soonest first', () => {
    const list = upcomingEvents(wednesday(12));
    for (let i = 1; i < list.length; i++) {
      expect(list[i].opensAt).toBeGreaterThanOrEqual(list[i - 1].opensAt);
    }
    // Wednesday lunchtime, the midweek event is the next one up.
    expect(list[0].event.id).toBe(midweek.id);
  });

  it('offers exactly one event to enter at a time', () => {
    expect(openForSignup(sunday(shootout.hour, 1))?.event.id).toBe(shootout.id);
    expect(openForSignup(wednesday(12))).toBeNull();
  });
});

describe('the countdown', () => {
  it('reads in minutes, hours and days', () => {
    const now = Date.now();
    expect(timeUntil(now + 14 * 60_000, now)).toBe('in 14m');
    expect(timeUntil(now + 3 * 3_600_000 + 20 * 60_000, now)).toBe('in 3h 20m');
    expect(timeUntil(now + 2 * 86_400_000 + 4 * 3_600_000, now)).toBe('in 2d 4h');
  });

  it('says now rather than a negative', () => {
    const now = Date.now();
    expect(timeUntil(now, now)).toBe('now');
    expect(timeUntil(now - 5000, now)).toBe('now');
  });
});
