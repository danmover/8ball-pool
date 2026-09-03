/**
 * The table you are still sitting at.
 *
 * The game already stored everything needed to walk back into a frame — a host session per
 * code, a seat token per online table — and nothing ever looked for them. So leaving a table
 * meant the only way back was remembering four characters, and there was no sign anywhere that
 * a game was still going on.
 *
 * This finds it. It reads the same two stores the pages write, and nothing else: no new state
 * to keep in step, and no way for the strip to claim a table the pages could not actually
 * rejoin.
 *
 * What it deliberately does *not* do is decide whether a table is still alive. That is the
 * server's to know, and guessing at it cost somebody their game — see `confirmAlive`.
 */

import { getSocket } from './socket';

export type TableRole = 'host' | 'player' | 'online';

export interface ActiveTable {
  code: string;
  role: TableRole;
  /** Where to go to be back at it. */
  path: string;
  /** When this was last written, for picking the newest when there is more than one. */
  at: number;
}

/** Sessions live in sessionStorage; a party host's table belongs to the window that opened it. */
const SESSION_RE = /^8ball:session:(host|player):([A-Za-z0-9]{4})$/;
/** Seat tokens live in localStorage, so an online seat survives a closed tab. */
const SEAT_RE = /^8ball:seat:([A-Za-z0-9]{4})$/;

/**
 * Online seat tokens older than this are not offered.
 *
 * A bound on how far back localStorage is worth trawling, not a liveness test — `confirmAlive`
 * does that. Party sessions need no equivalent: sessionStorage already dies with the tab.
 */
const SEAT_TTL_MS = 6 * 60 * 60 * 1000;

function pathFor(role: TableRole, code: string): string {
  if (role === 'host') return `/table/${code}`;
  if (role === 'online') return `/t/${code}`;
  return `/play/${code}`;
}

/**
 * Every table this device could walk back into, newest first.
 *
 * Read-only, and that matters. This used to drop sessions it judged too old, which is how a
 * helper that exists to draw one strip came to delete the token the table page needs — so a
 * table it had merely decided not to *offer* became one you could not reach at all, even by
 * typing the code. Forgetting a table is now done in one place, when the server has actually
 * said it is gone.
 *
 * "Newest" has to mean something, which is why sessions carry a timestamp. They did not, so
 * every party table sorted as equally recent and the strip offered whichever the store
 * iterated first — reliably the oldest one, abandoned several games ago.
 */
export function activeTables(): ActiveTable[] {
  const found: ActiveTable[] = [];
  const now = Date.now();

  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      const m = key?.match(SESSION_RE);
      if (!m) continue;
      const role = m[1] as 'host' | 'player';
      const code = m[2].toUpperCase();
      const raw = sessionStorage.getItem(key!);
      if (!raw) continue;
      let at = 0;
      try {
        // Sessions written before timestamps existed have none. They sort last rather than
        // being thrown away: an unstamped session is still a way back into a live frame.
        at = (JSON.parse(raw) as { at?: number }).at ?? 0;
      } catch {
        continue;
      }
      found.push({ code, role, path: pathFor(role, code), at });
    }
  } catch {
    // Storage can be unavailable in a locked-down browser. A missing resume strip is a far
    // smaller problem than a menu that will not render.
  }

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const m = key?.match(SEAT_RE);
      if (!m) continue;
      const code = m[1].toUpperCase();
      const raw = localStorage.getItem(key!);
      if (!raw) continue;
      const { at } = JSON.parse(raw) as { token: string; at: number };
      if (!at || now - at > SEAT_TTL_MS) continue;
      // A code can appear in both stores — a host who is also seated. The session wins,
      // because that is the window actually running the table.
      if (found.some((f) => f.code === code)) continue;
      found.push({ code, role: 'online', path: pathFor('online', code), at });
    }
  } catch {
    // As above.
  }

  return found.sort((a, b) => b.at - a.at);
}

/** The one worth offering, or nothing. */
export function activeTable(): ActiveTable | null {
  return activeTables()[0] ?? null;
}

/** How long to wait for the server to say which tables are still there. */
const ALIVE_TIMEOUT_MS = 2000;

/**
 * Asks the server whether these tables still exist.
 *
 * Resolves to the codes that do, or `null` when the server did not answer in time.
 *
 * The distinction is the whole point. This replaces a client-side guess that compared a stored
 * timestamp against a hardcoded copy of the server's empty-room window — a window that only
 * starts running when the socket drops. Walking from the table to the locker does not drop the
 * socket, so the room stayed alive while the client quietly decided it had not, and coming back
 * a few minutes later was met with "this table wasn't created from this device".
 */
export function confirmAlive(codes: string[]): Promise<string[] | null> {
  if (codes.length === 0) return Promise.resolve([]);
  return new Promise((resolve) => {
    let settled = false;
    const done = (value: string[] | null): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const timer = window.setTimeout(() => done(null), ALIVE_TIMEOUT_MS);
    try {
      getSocket().emit('tablesAlive', { codes }, (alive) => {
        window.clearTimeout(timer);
        done(Array.isArray(alive) ? alive.map((c) => c.toUpperCase()) : null);
      });
    } catch {
      window.clearTimeout(timer);
      done(null);
    }
  });
}

/**
 * Whether one table is worth offering.
 *
 * Fails *open*: no answer means yes. The two mistakes are not the same size — offering a dead
 * table costs one click and a clear "this table has ended", while hiding a live one loses the
 * game you were in the middle of, with nothing on screen to suggest it ever existed.
 */
export async function isTableAlive(code: string): Promise<boolean> {
  const alive = await confirmAlive([code.toUpperCase()]);
  return alive === null || alive.includes(code.toUpperCase());
}

/** Called when a table is genuinely done with, so the strip stops offering it. */
export function forgetTable(code: string): void {
  const upper = code.toUpperCase();
  try {
    sessionStorage.removeItem(`8ball:session:host:${upper}`);
    sessionStorage.removeItem(`8ball:session:player:${upper}`);
    localStorage.removeItem(`8ball:seat:${upper}`);
  } catch {
    // Nothing to do — the strip will simply keep offering a table that has gone, and the
    // table page turns that into a plain "this table has ended".
  }
}
