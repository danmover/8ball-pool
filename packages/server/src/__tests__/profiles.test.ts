import { describe, expect, it } from 'vitest';
import { SqliteProfileRepository } from '../profiles/sqliteRepository.js';

/**
 * Profiles moved off the browser, which introduced exactly one thing that can go badly wrong:
 * a device that has been away coming back and flattening newer progress. The revision check is
 * what stops that, so most of what follows is about it.
 */

const repo = (): SqliteProfileRepository => new SqliteProfileRepository(':memory:');

describe('profile repository', () => {
  it('round-trips a profile', () => {
    const db = repo();
    const { token, stored } = db.create({ xp: 120, unlocked: ['cue.house'] });
    expect(stored.revision).toBe(1);

    const back = db.get(token);
    expect(back?.data).toEqual({ xp: 120, unlocked: ['cue.house'] });
    db.close();
  });

  it('hands out different tokens to different players', () => {
    const db = repo();
    const a = db.create({ xp: 1 });
    const b = db.create({ xp: 2 });
    expect(a.token).not.toBe(b.token);
    expect(db.get(a.token)?.data).toEqual({ xp: 1 });
    db.close();
  });

  it('knows nothing about a token it never issued', () => {
    const db = repo();
    expect(db.get('made-up')).toBeNull();
    db.close();
  });

  it('bumps the revision on every save', () => {
    const db = repo();
    const { token } = db.create({ xp: 0 });
    expect(db.save(token, { xp: 10 }, 1)?.revision).toBe(2);
    expect(db.save(token, { xp: 20 }, 2)?.revision).toBe(3);
    expect(db.get(token)?.data).toEqual({ xp: 20 });
    db.close();
  });

  it('refuses a save built on a stale revision', () => {
    // The case this whole mechanism exists for: a phone that has been offline for a week must
    // not overwrite a week of play on the desktop.
    const db = repo();
    const { token } = db.create({ xp: 0 });
    db.save(token, { xp: 500 }, 1); // desktop, now at revision 2

    expect(db.save(token, { xp: 5 }, 1)).toBeNull(); // phone, still thinks it's revision 1
    expect(db.get(token)?.data).toEqual({ xp: 500 });
    db.close();
  });

  it('lets the stale writer succeed once it has caught up', () => {
    const db = repo();
    const { token } = db.create({ xp: 0 });
    db.save(token, { xp: 500 }, 1);

    const current = db.get(token)!;
    expect(db.save(token, { xp: 600 }, current.revision)?.revision).toBe(3);
    db.close();
  });

  it('will not save against an unknown token', () => {
    const db = repo();
    expect(db.save('made-up', { xp: 1 }, 1)).toBeNull();
    db.close();
  });
});

describe('transfer codes', () => {
  it('moves a profile to another device', () => {
    const db = repo();
    const { token } = db.create({ xp: 999 });
    const issued = db.createTransferCode(token)!;

    expect(db.redeemTransferCode(issued.code)).toBe(token);
    db.close();
  });

  it('only works once', () => {
    // A code read aloud across a room shouldn't keep working for whoever overheard it.
    const db = repo();
    const { token } = db.create({ xp: 1 });
    const issued = db.createTransferCode(token)!;

    expect(db.redeemTransferCode(issued.code)).toBe(token);
    expect(db.redeemTransferCode(issued.code)).toBeNull();
    db.close();
  });

  it('is case-insensitive, since people type these by hand', () => {
    const db = repo();
    const { token } = db.create({ xp: 1 });
    const issued = db.createTransferCode(token)!;
    expect(db.redeemTransferCode(issued.code.toLowerCase())).toBe(token);
    db.close();
  });

  it('rejects a code nobody issued', () => {
    const db = repo();
    expect(db.redeemTransferCode('ZZZZZZ')).toBeNull();
    db.close();
  });

  it('will not issue a code for a profile that does not exist', () => {
    const db = repo();
    expect(db.createTransferCode('made-up')).toBeNull();
    db.close();
  });

  it('avoids characters that are misread when spoken or typed', () => {
    // 0/O and 1/I are the classic transcription failures, and these get read across a room.
    const db = repo();
    const { token } = db.create({ xp: 1 });
    for (let i = 0; i < 200; i++) {
      const { code } = db.createTransferCode(token)!;
      expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    }
    db.close();
  });
});
