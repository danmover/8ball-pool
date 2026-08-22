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
