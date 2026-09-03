import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * `activeTable` reaches for a socket at module load time by way of `confirmAlive`. These tests
 * are about what it reads out of storage, so the socket is stubbed out entirely — reaching the
 * network here would be the test asking a real question of a server that is not running.
 */
vi.mock('../socket', () => ({ getSocket: () => ({ emit: () => {} }) }));

import { activeTable, activeTables, forgetTable } from '../activeTable';

/** Enough of the Storage interface for the two loops in activeTables. */
class FakeStorage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
}

let session: FakeStorage;
let local: FakeStorage;

beforeEach(() => {
  session = new FakeStorage();
  local = new FakeStorage();
  vi.stubGlobal('sessionStorage', session);
  vi.stubGlobal('localStorage', local);
});

function hostedAt(code: string, at: number): void {
  session.setItem(`8ball:session:host:${code}`, JSON.stringify({ at, token: `tok-${code}` }));
}

describe('finding the table you are still at', () => {
  it('offers the one you were most recently at', () => {
    hostedAt('AAAA', 1000);
    hostedAt('BBBB', 5000);
    hostedAt('CCCC', 3000);
    expect(activeTables().map((t) => t.code)).toEqual(['BBBB', 'CCCC', 'AAAA']);
    expect(activeTable()?.path).toBe('/table/BBBB');
  });

  /*
   * The bug this whole file exists for.
   *
   * Reading the list used to delete any session older than three minutes, on the theory that
   * the server would have reaped the room by then. It would not have: the reaping clock starts
   * when the socket drops, and walking from the table to the locker keeps the socket. So
   * spending a few minutes looking at cue skins deleted the token for the frame you were in
   * the middle of, and going back — by the strip, by the back button, by typing the code —
   * got "this table wasn't created from this device".
   *
   * A function that reads a list has no business deleting the credential another page needs.
   */
  it('never deletes anything, however old', () => {
    hostedAt('OLDX', Date.now() - 6 * 60 * 60 * 1000);
    expect(activeTables().map((t) => t.code)).toEqual(['OLDX']);
    expect(session.getItem('8ball:session:host:OLDX')).not.toBeNull();
  });

  it('still offers a session written before stamps existed', () => {
    session.setItem('8ball:session:host:PLAI', JSON.stringify({ token: 'tok' }));
    expect(activeTable()?.code).toBe('PLAI');
    expect(session.getItem('8ball:session:host:PLAI')).not.toBeNull();
  });

  it('sorts an unstamped session below a stamped one, having nothing better to go on', () => {
    session.setItem('8ball:session:host:PLAI', JSON.stringify({ token: 'tok' }));
    hostedAt('STMP', 1000);
    expect(activeTables().map((t) => t.code)).toEqual(['STMP', 'PLAI']);
  });

  it('knows which page each kind of table lives on', () => {
    // Seat tokens live in localStorage and are only offered for six hours, so these have to be
    // stamped as recent to be about routing rather than about that bound.
    const now = Date.now();
    hostedAt('HOST', now);
    session.setItem('8ball:session:player:PLYR', JSON.stringify({ at: now - 1000, token: 't' }));
    local.setItem('8ball:seat:ONLN', JSON.stringify({ at: now - 2000, token: 't' }));
    expect(activeTables().map((t) => t.path)).toEqual(['/table/HOST', '/play/PLYR', '/t/ONLN']);
  });

  it('prefers the session over a seat token for the same table', () => {
    // A host who also took a seat. The session is the window actually running the table, and
    // it wins even though the seat token is the fresher of the two.
    const now = Date.now();
    hostedAt('SAME', now - 5000);
    local.setItem('8ball:seat:SAME', JSON.stringify({ at: now, token: 't' }));
    expect(activeTables()).toHaveLength(1);
    expect(activeTable()?.role).toBe('host');
  });

  it('leaves a seat token from six hours ago alone', () => {
    local.setItem('8ball:seat:GONE', JSON.stringify({ at: Date.now() - 7 * 60 * 60 * 1000, token: 't' }));
    expect(activeTables()).toEqual([]);
  });

  it('ignores keys that are not tables', () => {
    session.setItem('8ball:settings', '{"sound":true}');
    session.setItem('8ball:session:host:TOOLONG', '{"at":1,"token":"t"}');
    session.setItem('8ball:nav', '["/"]');
    expect(activeTables()).toEqual([]);
  });

  it('shrugs off a session that is not JSON', () => {
    session.setItem('8ball:session:host:BAAD', 'not json');
    hostedAt('GOOD', 1000);
    expect(activeTables().map((t) => t.code)).toEqual(['GOOD']);
  });

  it('gives up quietly when storage is walled off', () => {
    vi.stubGlobal('sessionStorage', {
      get length(): number {
        throw new Error('blocked');
      },
    });
    expect(activeTables()).toEqual([]);
  });

  it('forgets a table across both stores at once', () => {
    hostedAt('DONE', 1000);
    session.setItem('8ball:session:player:DONE', JSON.stringify({ at: 1000, token: 't' }));
    local.setItem('8ball:seat:DONE', JSON.stringify({ at: 1000, token: 't' }));
    forgetTable('done');
    expect(activeTables()).toEqual([]);
  });
});
