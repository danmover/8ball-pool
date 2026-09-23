import { describe, expect, it } from 'vitest';
import {
  generateCode,
  normalizeCode,
  isValidPeer,
  parseHostFrame,
  wrapClientFrame,
  RateLimiter,
  rankPublicRooms,
  cleanMeta,
  CODE_ALPHABET,
  type PublicRoom,
} from '../index.js';

describe('relay rules', () => {
  it('makes readable codes and normalises what people type', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateCode();
      expect(code).toHaveLength(4);
      for (const ch of code) expect(CODE_ALPHABET).toContain(ch);
    }
    expect(normalizeCode(' ab2c ')).toBe('AB2C');
    expect(normalizeCode('AB0C')).toBeNull();
    expect(normalizeCode('ABC')).toBeNull();
  });

  it('validates peer ids', () => {
    expect(isValidPeer('abcdEFGH1234')).toBe(true);
    expect(isValidPeer('short')).toBe(false);
    expect(isValidPeer('has spaces in it!!')).toBe(false);
  });

  it('parses host frames and rejects junk', () => {
    expect(parseHostFrame('{"to":"*","d":{"t":"pong","at":1}}')).toEqual({
      kind: 'send',
      to: '*',
      payload: '{"t":"pong","at":1}',
    });
    expect(parseHostFrame('{"sys":"kick","peer":"abcdEFGH1234"}')).toEqual({ kind: 'kick', peer: 'abcdEFGH1234' });
    expect(parseHostFrame('not json').kind).toBe('invalid');
    expect(parseHostFrame('{"to":"bad id","d":{}}').kind).toBe('invalid');
  });

  it('stamps client frames so nobody can speak as someone else', () => {
    const wrapped = wrapClientFrame('realPeer123', '{"t":"shoot","from":"victim123"}');
    expect(JSON.parse(wrapped!)).toEqual({ from: 'realPeer123', d: { t: 'shoot', from: 'victim123' } });
    expect(wrapClientFrame('realPeer123', '{}, "from":"victim"')).toBeNull();
  });

  it('rate-limits a flood', () => {
    const limiter = new RateLimiter(5, 0);
    const allowed = Array.from({ length: 20 }, () => limiter.take(0)).filter(Boolean).length;
    expect(allowed).toBe(5);
    expect(limiter.take(1000)).toBe(true);
  });

  it('lists open public rooms first and drops stale ones', () => {
    const now = 1_000_000;
    const rooms: PublicRoom[] = [
      { code: 'AAAA', host: 'A', mode: 'eightball', players: 2, seats: 2, playing: true, public: true, updatedAt: now },
      { code: 'BBBB', host: 'B', mode: 'killer', players: 1, seats: 4, playing: false, public: true, updatedAt: now - 1000 },
      { code: 'CCCC', host: 'C', mode: 'eightball', players: 1, seats: 2, playing: false, public: true, updatedAt: now - 200_000 },
      { code: 'DDDD', host: 'D', mode: 'eightball', players: 1, seats: 2, playing: false, public: false, updatedAt: now },
    ];
    expect(rankPublicRooms(rooms, now).map((r) => r.code)).toEqual(['BBBB', 'AAAA']);
  });

  it('cleans room metadata from a host', () => {
    expect(cleanMeta({ mode: 'eightball', players: 99, seats: 2, host: 'x'.repeat(50), public: true }, 'ABCD')).toEqual({
      code: 'ABCD',
      host: 'x'.repeat(16),
      mode: 'eightball',
      players: 8,
      seats: 2,
      playing: false,
      public: true,
    });
    expect(cleanMeta({ mode: 'practice' }, 'ABCD')).toBeNull();
  });
});
