import { DEFAULT_SETTINGS, type PlayerSettings, type Seat } from '@8ball/shared';

const SETTINGS_KEY = '8ball:settings';

/** Old saves stored a felt colour; map it onto the table theme that replaced it. */
const LEGACY_FELT_THEMES: Record<string, string> = {
  green: 'classic',
  blue: 'midnight',
  crimson: 'crimson',
  midnight: 'neon',
};

export function loadSettings(): PlayerSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<PlayerSettings> & { feltTheme?: string };
    const settings = { ...DEFAULT_SETTINGS, ...parsed };
    if (!parsed.tableTheme && parsed.feltTheme) {
      settings.tableTheme = LEGACY_FELT_THEMES[parsed.feltTheme] ?? DEFAULT_SETTINGS.tableTheme;
    }
    return settings;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: PlayerSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export interface StoredSession {
  token: string;
  seat?: Seat;
  /**
   * When this session was opened.
   *
   * Added because the resume strip needs to know which of several stored tables is the one you
   * were actually last at. Without it every party session looked equally recent and the strip
   * offered whichever the store happened to iterate first — in practice the oldest, and long
   * abandoned. Optional because sessions written before this existed have no timestamp.
   */
  at?: number;
}

function sessionKey(code: string, role: 'host' | 'player'): string {
  return `8ball:session:${role}:${code}`;
}

export function saveSession(code: string, role: 'host' | 'player', session: StoredSession): void {
  sessionStorage.setItem(sessionKey(code, role), JSON.stringify({ at: Date.now(), ...session }));
}

/**
 * Marks a session as still in use.
 *
 * The stamp orders tables — it decides which of several the resume strip offers — so it has to
 * mean "when you were last at this table", not "when the room was made". Play a frame, start a
 * second, come back and finish the first, and the first is the one you are at.
 *
 * It is only ever an ordering. It briefly doubled as an expiry, and doing that lost people
 * their games: whether a table still exists is the server's to answer, and it does.
 */
export function touchSession(code: string, role: 'host' | 'player'): void {
  const existing = loadSession(code, role);
  if (existing) saveSession(code, role, { token: existing.token, seat: existing.seat });
}

export function loadSession(code: string, role: 'host' | 'player'): StoredSession | null {
  const raw = sessionStorage.getItem(sessionKey(code, role));
  return raw ? (JSON.parse(raw) as StoredSession) : null;
}


/**
 * Seat tokens for online tables.
 *
 * localStorage rather than the sessionStorage the party sessions use. Closing a tab mid-frame
 * is a normal thing to do online — the phone rings, the laptop sleeps — and sessionStorage dies
 * with the tab, so coming back would hand your chair to a stranger. Party hosting is the
 * opposite case: that session genuinely belongs to the one window that opened it.
 */
const SEAT_KEY = (code: string): string => `8ball:seat:${code.toUpperCase()}`;

/** Seat tokens older than this are assumed to belong to a table that no longer exists. */
const SEAT_TTL_MS = 6 * 60 * 60 * 1000;

export function saveSeatToken(code: string, token: string): void {
  localStorage.setItem(SEAT_KEY(code), JSON.stringify({ token, at: Date.now() }));
}

export function loadSeatToken(code: string): string | null {
  const raw = localStorage.getItem(SEAT_KEY(code));
  if (!raw) return null;
  try {
    const { token, at } = JSON.parse(raw) as { token: string; at: number };
    if (Date.now() - at > SEAT_TTL_MS) {
      localStorage.removeItem(SEAT_KEY(code));
      return null;
    }
    return token;
  } catch {
    return null;
  }
}

export function clearSeatToken(code: string): void {
  localStorage.removeItem(SEAT_KEY(code));
}
