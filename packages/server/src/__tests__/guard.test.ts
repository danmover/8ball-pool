import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIMIT,
  SocketGuard,
  inRange,
  isRoomCode,
  isSeatId,
  isValidAim,
  isValidPlacement,
  isValidShot,
} from '../guard.js';

/**
 * Payloads used to come from somebody's friend in the same room. Now any browser can send
 * anything, so the tests that matter are the ones about *bad* input — a NaN angle reaching
 * `applyCueStrike` puts the cue ball somewhere no rule anticipated.
 */

describe('the rate limit', () => {
  it('lets an ordinary amount of play through', () => {
    const guard = new SocketGuard();
    for (let i = 0; i < DEFAULT_LIMIT.events; i++) {
      expect(guard.allow('sock', 'takeShot', 1000)).toBe(true);
    }
  });

  it('stops a flood', () => {
    const guard = new SocketGuard();
    for (let i = 0; i < DEFAULT_LIMIT.events; i++) guard.allow('sock', 'takeShot', 1000);
    expect(guard.allow('sock', 'takeShot', 1000)).toBe(false);
  });

  it('forgives once the window rolls over', () => {
    const guard = new SocketGuard();
    for (let i = 0; i < DEFAULT_LIMIT.events + 10; i++) guard.allow('sock', 'takeShot', 1000);
    expect(guard.allow('sock', 'takeShot', 1000 + DEFAULT_LIMIT.windowMs)).toBe(true);
  });

  it('budgets each socket separately', () => {
    // One person hammering the server must not cut everybody else off.
    const guard = new SocketGuard();
    for (let i = 0; i < DEFAULT_LIMIT.events + 10; i++) guard.allow('flooder', 'takeShot', 1000);
    expect(guard.allow('somebody-else', 'takeShot', 1000)).toBe(true);
  });

  it('never throttles aim updates', () => {
    // Aiming is a firehose by design — it is how the other screens see the cue move — and
    // throttling it would break the one thing that has to feel continuous.
    const guard = new SocketGuard();
    for (let i = 0; i < DEFAULT_LIMIT.events * 5; i++) {
      expect(guard.allow('sock', 'updateAim', 1000)).toBe(true);
    }
  });

  it('forgets a socket that has gone', () => {
    const guard = new SocketGuard();
    guard.allow('sock', 'takeShot', 1000);
    expect(guard.tracked).toBe(1);
    guard.forget('sock');
    expect(guard.tracked).toBe(0);
  });
});

describe('shot payloads', () => {
  const good = { seat: 'p1', angle: 0.4, power: 0.6, spin: { x: 0, y: 0 } };

  it('accepts an ordinary shot', () => {
    expect(isValidShot(good)).toBe(true);
    expect(isValidShot({ ...good, elevation: 0.5 })).toBe(true);
  });

  it('rejects a NaN or infinite angle', () => {
    expect(isValidShot({ ...good, angle: NaN })).toBe(false);
    expect(isValidShot({ ...good, angle: Infinity })).toBe(false);
  });

  it('rejects power outside nought to one', () => {
    expect(isValidShot({ ...good, power: 1e9 })).toBe(false);
    expect(isValidShot({ ...good, power: -1 })).toBe(false);
    expect(isValidShot({ ...good, power: '1' })).toBe(false);
  });

  it('rejects spin off the tip', () => {
    expect(isValidShot({ ...good, spin: { x: 12, y: 0 } })).toBe(false);
    expect(isValidShot({ ...good, spin: { x: 0, y: NaN } })).toBe(false);
    expect(isValidShot({ ...good, spin: null })).toBe(false);
    expect(isValidShot({ ...good, spin: 'centre' })).toBe(false);
  });

  it('rejects an impossible cue elevation', () => {
    expect(isValidShot({ ...good, elevation: 99 })).toBe(false);
    expect(isValidShot({ ...good, elevation: -1 })).toBe(false);
  });

  it('rejects a made-up seat', () => {
    expect(isValidShot({ ...good, seat: 'p99' })).toBe(false);
    expect(isValidShot({ ...good, seat: '' })).toBe(false);
    expect(isValidShot({ ...good, seat: 42 })).toBe(false);
  });

  it('rejects nothing at all', () => {
    expect(isValidShot(null)).toBe(false);
    expect(isValidShot(undefined)).toBe(false);
    expect(isValidShot('shoot')).toBe(false);
    expect(isValidShot({})).toBe(false);
  });
});

describe('aim and placement payloads', () => {
  it('accepts an ordinary aim', () => {
    expect(isValidAim({ seat: 'p2', angle: 1.2 })).toBe(true);
  });

  it('rejects a broken aim', () => {
    expect(isValidAim({ seat: 'p2', angle: NaN })).toBe(false);
    expect(isValidAim({ seat: 'nope', angle: 1 })).toBe(false);
    expect(isValidAim(null)).toBe(false);
  });

  it('accepts a placement and rejects nonsense', () => {
    expect(isValidPlacement({ seat: 'p1', pos: { x: 400, y: 300 } })).toBe(true);
    expect(isValidPlacement({ seat: 'p1', pos: { x: NaN, y: 300 } })).toBe(false);
    expect(isValidPlacement({ seat: 'p1' })).toBe(false);
    expect(isValidPlacement({ seat: 'p1', pos: 'middle' })).toBe(false);
  });
});

describe('small checks', () => {
  it('knows a seat id', () => {
    expect(isSeatId('p1')).toBe(true);
    expect(isSeatId('p8')).toBe(true);
    expect(isSeatId('p9')).toBe(false);
    expect(isSeatId('p0')).toBe(false);
    expect(isSeatId('P1')).toBe(false);
  });

  it('knows a room code', () => {
    expect(isRoomCode('AB12')).toBe(true);
    expect(isRoomCode('ABC')).toBe(false);
    expect(isRoomCode('ABCDE')).toBe(false);
    expect(isRoomCode('AB 1')).toBe(false);
  });

  it('rejects NaN from a range rather than clamping it', () => {
    expect(inRange(NaN, 0, 1)).toBe(false);
    expect(inRange(Infinity, 0, 1)).toBe(false);
    expect(inRange(0.5, 0, 1)).toBe(true);
  });
});
