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
 */

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

/** Online seat tokens older than this are assumed to be for a table that has gone. */
const SEAT_TTL_MS = 6 * 60 * 60 * 1000;

/*
 * How long a party table is worth offering after you walked away from it.
 *
 * Deliberately short, and deliberately the server's own number: a room with nobody connected
 * is reaped after three minutes, so past that the table genuinely does not exist and an offer
 * to go back to it is a lie that ends in an error screen. An online seat is different — the
 * table lives on without you and your chair is held — which is why that one is measured in
 * hours.
 */
const PARTY_TTL_MS = 3 * 60 * 1000;

function pathFor(role: TableRole, code: string): string {
  if (role === 'host') return `/table/${code}`;
  if (role === 'online') return `/t/${code}`;
  return `/play/${code}`;
}

/**
 * Every table this device could walk back into, newest first.
 *
 * "Newest" has to mean something, which is why sessions carry a timestamp now. They did not,
 * so every party table sorted as equally recent and the strip offered whichever the store
 * iterated first — reliably the oldest one, abandoned several games ago. Playing two solo
 * frames and opening the locker offered you the first.
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
        at = (JSON.parse(raw) as { at?: number }).at ?? 0;
      } catch {
        continue;
      }
      // Sessions written before timestamps existed, and tables the server will have reaped.
      if (!at || now - at > PARTY_TTL_MS) {
        sessionStorage.removeItem(key!);
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
      if (!at || Date.now() - at > SEAT_TTL_MS) continue;
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
