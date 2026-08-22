/**
 * Table themes. A theme is the whole table — cloth, rail wood, pocket leather, the diamond
 * sights, *and* the surround behind it — so switching one changes the entire screen rather
 * than just the green bit in the middle.
 *
 * These are a free choice rather than an unlockable: they're closer to a display preference
 * than a flex, and being able to pick a felt you can actually see matters more than gating it.
 */

export interface TableTheme {
  id: string;
  name: string;
  /** Cloth centre and edge. */
  light: string;
  dark: string;
  /** Rail wood, light and shadowed. */
  rail: string;
  railDark: string;
  /** Cushion face — usually a touch deeper than the cloth. */
  cushion: string;
  /** Pocket leather and the throat behind it. */
  pocket: string;
  pocketDark: string;
  /** Diamond sight colour on the rails. */
  diamond: string;
  /** CSS gradient for the room behind the table. */
  surround: string;
  /** Accent used by UI chrome while this theme is active. */
  accent: string;
  /** Cloth lines/spots visible? Neon looks wrong with them. */
  markings: boolean;
}

export const TABLE_THEMES: TableTheme[] = [
  {
    id: 'classic',
    name: 'Classic Green',
    light: '#5fd88a',
    dark: '#28a85c',
    rail: '#c99a63',
    railDark: '#7d5533',
    cushion: '#14713b',
    pocket: '#4a3524',
    pocketDark: '#140d07',
    diamond: '#fdf6e3',
    surround: 'radial-gradient(ellipse 90% 70% at 50% 40%, #2a3a2f 0%, #131a17 60%, #0a0d0c 100%)',
    accent: '#ffc94d',
    markings: true,
  },
  {
    id: 'midnight',
    name: 'Midnight Blue',
    light: '#4fa8e8',
    dark: '#1a5a94',
    rail: '#6b4a3a',
    railDark: '#3d2921',
    cushion: '#0e3559',
    pocket: '#2a1f18',
    pocketDark: '#0a0705',
    diamond: '#e8f2fb',
    surround: 'radial-gradient(ellipse 90% 70% at 50% 40%, #1d2b3d 0%, #0f1620 60%, #070a0e 100%)',
    accent: '#7ec8ff',
    markings: true,
  },
  {
    id: 'crimson',
    name: 'Crimson Club',
    light: '#e26070',
    dark: '#9e2436',
    rail: '#7a3b2a',
    railDark: '#422016',
    cushion: '#661624',
    pocket: '#2e1712',
    pocketDark: '#0d0605',
    diamond: '#fbe8e8',
    surround: 'radial-gradient(ellipse 90% 70% at 50% 40%, #3a2020 0%, #1c1010 60%, #0d0707 100%)',
    accent: '#ff9a7a',
    markings: true,
  },
  {
    id: 'sandstone',
    name: 'Sandstone',
    light: '#e8c98f',
    dark: '#c19a5c',
    rail: '#a8794a',
    railDark: '#63452a',
    cushion: '#8a6836',
    pocket: '#3d2b1c',
    pocketDark: '#120c06',
    diamond: '#fff8ea',
    surround: 'radial-gradient(ellipse 90% 70% at 50% 40%, #3a3025 0%, #1d1813 60%, #0c0a08 100%)',
    accent: '#ffd98a',
    markings: true,
  },
  {
    id: 'neon',
    name: 'Neon Arcade',
    light: '#3d2f7a',
    dark: '#1a1040',
    rail: '#241a3d',
    railDark: '#120c22',
    cushion: '#1d1442',
    pocket: '#0d0820',
    pocketDark: '#04020a',
    diamond: '#5ffbf1',
    surround: 'radial-gradient(ellipse 90% 70% at 50% 40%, #241a4a 0%, #100a24 60%, #06040f 100%)',
    accent: '#5ffbf1',
    markings: false,
  },
  {
    id: 'ice',
    name: 'Ice',
    light: '#cfe9f5',
    dark: '#8fc4dd',
    rail: '#d8cbb8',
    railDark: '#9a8874',
    cushion: '#5a97b5',
    pocket: '#3a4550',
    pocketDark: '#131a20',
    diamond: '#3d5566',
    surround: 'radial-gradient(ellipse 90% 70% at 50% 40%, #2d3d4a 0%, #16202a 60%, #0a1015 100%)',
    accent: '#9fe4ff',
    markings: true,
  },
  {
    id: 'vintage',
    name: 'Vintage',
    light: '#8a9c5e',
    dark: '#5c6b3a',
    rail: '#5c4326',
    railDark: '#33240f',
    cushion: '#3a4522',
    pocket: '#2b1d10',
    pocketDark: '#0b0704',
    diamond: '#f0e3c0',
    surround: 'radial-gradient(ellipse 90% 70% at 50% 40%, #2f2a20 0%, #191510 60%, #0b0907 100%)',
    accent: '#e0c47a',
    markings: true,
  },
];

const BY_ID = new Map(TABLE_THEMES.map((t) => [t.id, t]));

/**
 * Older saves stored one of four felt colours; those ids map onto the closest table theme so
 * nobody's preference resets when they update.
 */
const LEGACY_FELT: Record<string, string> = {
  green: 'classic',
  blue: 'midnight',
  crimson: 'crimson',
  midnight: 'neon',
};

export function tableThemeFor(id: string | undefined): TableTheme {
  if (!id) return TABLE_THEMES[0];
  return BY_ID.get(id) ?? BY_ID.get(LEGACY_FELT[id] ?? '') ?? TABLE_THEMES[0];
}

/** Paints the page behind the table to match the active theme. */
export function applyTableThemeToPage(theme: TableTheme): void {
  const root = document.documentElement;
  root.style.setProperty('--surround', theme.surround);
  root.style.setProperty('--theme-accent', theme.accent);
  root.style.setProperty('--theme-felt', theme.light);
  root.style.setProperty('--theme-felt-dark', theme.dark);
  root.style.setProperty('--theme-wood', theme.rail);
  root.style.setProperty('--theme-wood-dark', theme.railDark);
}
