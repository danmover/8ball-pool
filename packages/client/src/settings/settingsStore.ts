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
}

function sessionKey(code: string, role: 'host' | 'player'): string {
  return `8ball:session:${role}:${code}`;
}

export function saveSession(code: string, role: 'host' | 'player', session: StoredSession): void {
  sessionStorage.setItem(sessionKey(code, role), JSON.stringify(session));
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
