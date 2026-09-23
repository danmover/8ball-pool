/**
 * Table themes. A theme is the whole table — cloth, rail wood, pocket leather, the fittings,
 * the diamond sights, the light hanging over it *and* the surround behind it — so switching one
 * changes the entire screen rather than just the green bit in the middle.
 *
 * These are a free choice rather than an unlockable: they're closer to a display preference
 * than a flex, and being able to pick a felt you can actually see matters more than gating it.
 *
 * A theme is now assembled from `materials.ts` rather than authored as a bag of hex codes. That
 * change is what lets the Theme Studio exist at all: a player's table is built by the same
 * `themeFromSpec` the eleven presets go through, so a custom table is a first-class table and
 * not a lesser one drawn by a different code path.
 */

import {
  clothFor,
  lampFor,
  leatherFor,
  metalFor,
  woodFor,
  type Lamp,
  type Metal,
} from './materials';

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

  // --- Material properties. These are what make a theme a *table* rather than a palette. ---

  /** Plating on the sights, pocket bezels and corner caps. */
  metal: Metal;
  /** What is hanging over the table — drives both the floor pool and the cloth specular. */
  lamp: Lamp;
  /** Thread pitch of the cloth in texture pixels: small is tight worsted, large is coarse. */
  weave: number;
  /** How strongly the nap bands read across the bed. */
  nap: number;
  /** Grain figure of the rail stock, 0 plain .. 1 heavily figured. */
  grain: number;
  /** Open-pore speckle in the rail stock. */
  pore: number;
  /** Varnish on the rails, 0 oiled matte .. 1 mirror gloss. */
  gloss: number;
  /** Built in the Theme Studio rather than shipped. */
  custom?: boolean;
}

/**
 * The five choices a table is made of, plus its name.
 *
 * This is what gets *saved* — for a custom table it is about eighty bytes, where the resolved
 * theme is a couple of hundred and would go stale the moment a material is retuned.
 */
export interface TableSpec {
  cloth: string;
  wood: string;
  metal: string;
  leather: string;
  lamp: string;
  markings: boolean;
}

/** '#rrggbb' → {r,g,b}. */
function rgb(hex: string): { r: number; g: number; b: number } {
  const n = parseInt(hex.replace('#', ''), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function mix(a: string, b: string, t: number): string {
  const x = rgb(a);
  const y = rgb(b);
  const c = (p: number, q: number) => Math.round(p + (q - p) * t);
  return `#${((1 << 24) | (c(x.r, y.r) << 16) | (c(x.g, y.g) << 8) | c(x.b, y.b)).toString(16).slice(1)}`;
}

/**
 * The room gradient, derived rather than authored.
 *
 * A hand-written surround per theme was fine for seven of them and impossible for a studio that
 * can build thousands. It is the cloth pushed a long way toward the lamp's colour and then
 * darkened in three steps — which is, roughly, what a room lit by that lamp with that table in
 * it actually looks like.
 */
function surroundFor(clothDark: string, lamp: Lamp): string {
  const tinted = mix(clothDark, lamp.color, 0.22);
  const near = mix(tinted, '#000000', 0.58);
  const mid = mix(tinted, '#000000', 0.8);
  const far = mix(tinted, '#000000', 0.92);
  const spread = 70 + lamp.focus * 26;
  return `radial-gradient(ellipse 90% ${spread}% at 50% 40%, ${near} 0%, ${mid} 60%, ${far} 100%)`;
}

/** Assembles a full theme from a recipe. Every preset and every custom table goes through here. */
export function themeFromSpec(id: string, name: string, spec: TableSpec): TableTheme {
  const cloth = clothFor(spec.cloth);
  const wood = woodFor(spec.wood);
  const metal = metalFor(spec.metal);
  const leather = leatherFor(spec.leather);
  const lamp = lampFor(spec.lamp);

  return {
    id,
    name,
    light: cloth.light,
    dark: cloth.dark,
    cushion: cloth.cushion,
    rail: wood.rail,
    railDark: wood.railDark,
    pocket: leather.pocket,
    pocketDark: leather.pocketDark,
    // The sights are the metal's highlight — they are the brightest thing on the rail.
    diamond: metal.light,
    surround: surroundFor(cloth.dark, lamp),
    // UI chrome picks up the lamp warmed toward the metal, which keeps menus tied to the table
    // without ever landing on the cloth colour itself (that reads as a second felt).
    accent: mix(lamp.color, metal.mid, 0.35),
    markings: spec.markings,
    metal,
    lamp,
    weave: cloth.weave,
    nap: cloth.nap,
    grain: wood.grain,
    pore: wood.pore,
    gloss: wood.gloss,
  };
}

interface Preset extends TableSpec {
  id: string;
  name: string;
}

/**
 * The shipped tables.
 *
 * The first seven are the originals, respecified rather than restyled — the same cloth and wood
 * colours they always had, now with the weave, grain and fittings they always implied. The last
 * four are new, and they are deliberately the expensive end of the range: the point of a room
 * full of tables is that some of them are nicer than others.
 */
const PRESETS: Preset[] = [
  {
    id: 'classic',
    name: 'Classic Green',
    cloth: 'tournament',
    wood: 'oak',
    metal: 'pearl',
    leather: 'tan',
    lamp: 'pendant',
    markings: true,
  },
  {
    id: 'midnight',
    name: 'Midnight Blue',
    cloth: 'championship',
    wood: 'walnut',
    metal: 'chrome',
    leather: 'black',
    lamp: 'spot',
    markings: true,
  },
  {
    id: 'crimson',
    name: 'Crimson Club',
    cloth: 'burgundy',
    wood: 'rosewood',
    metal: 'brass',
    leather: 'oxblood',
    lamp: 'ember',
    markings: true,
  },
  {
    id: 'sandstone',
    name: 'Sandstone',
    cloth: 'sand',
    wood: 'teak',
    metal: 'copper',
    leather: 'cognac',
    lamp: 'daylight',
    markings: true,
  },
  {
    id: 'neon',
    name: 'Neon Arcade',
    cloth: 'voidcloth',
    wood: 'lacquer',
    metal: 'neonchrome',
    leather: 'black',
    lamp: 'neon',
    markings: false,
  },
  {
    id: 'ice',
    name: 'Ice',
    cloth: 'glacier',
    wood: 'ash',
    metal: 'chrome',
    leather: 'slate',
    lamp: 'spot',
    markings: true,
  },
  {
    id: 'vintage',
    name: 'Vintage',
    cloth: 'moss',
    wood: 'oak',
    metal: 'brass',
    leather: 'cognac',
    lamp: 'candle',
    markings: true,
  },

  // --- The premium end. ---

  {
    id: 'royale',
    name: 'The Velvet Room',
    cloth: 'plum',
    wood: 'ebony',
    metal: 'brass',
    leather: 'oxblood',
    lamp: 'ultraviolet',
    markings: true,
  },
  {
    id: 'obsidian',
    name: 'Obsidian',
    cloth: 'charcoal',
    wood: 'carbon',
    metal: 'obsidian',
    leather: 'black',
    lamp: 'spot',
    markings: false,
  },
  {
    id: 'champagne',
    name: 'Champagne Room',
    cloth: 'champagne',
    wood: 'maple',
    metal: 'rosegold',
    leather: 'ivoryhide',
    lamp: 'pendant',
    markings: true,
  },
  {
    id: 'emerald',
    name: 'The Emerald Vault',
    cloth: 'emerald',
    wood: 'mahogany',
    metal: 'brass',
    leather: 'oxblood',
    lamp: 'pendant',
    markings: true,
  },
];

export const TABLE_THEMES: TableTheme[] = PRESETS.map((p) => themeFromSpec(p.id, p.name, p));

const BY_ID = new Map(TABLE_THEMES.map((t) => [t.id, t]));

// ---------------------------------------------------------------- custom tables

const CUSTOM_KEY = '8ball:customTables';
/** Ids are prefixed so nothing can collide with a preset — or with a future preset. */
export const CUSTOM_PREFIX = 'custom:';

export interface CustomTable {
  id: string;
  name: string;
  spec: TableSpec;
}

export function loadCustomTables(): CustomTable[] {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CustomTable[];
    return Array.isArray(parsed) ? parsed.filter((t) => t && t.id && t.spec) : [];
  } catch {
    return [];
  }
}

export function saveCustomTables(tables: CustomTable[]): void {
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(tables));
  } catch {
    // A full or blocked localStorage costs you the save, not the game.
  }
}

/** Adds or replaces a saved table and returns the id it ended up under. */
export function upsertCustomTable(table: CustomTable): string {
  const tables = loadCustomTables();
  const at = tables.findIndex((t) => t.id === table.id);
  if (at >= 0) tables[at] = table;
  else tables.push(table);
  saveCustomTables(tables);
  return table.id;
}

export function deleteCustomTable(id: string): void {
  saveCustomTables(loadCustomTables().filter((t) => t.id !== id));
}

export function newCustomId(): string {
  return `${CUSTOM_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Every table on offer, shipped then saved. */
export function allTableThemes(): TableTheme[] {
  return [
    ...TABLE_THEMES,
    ...loadCustomTables().map((t) => ({ ...themeFromSpec(t.id, t.name, t.spec), custom: true })),
  ];
}

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
  const preset = BY_ID.get(id);
  if (preset) return preset;

  if (id.startsWith(CUSTOM_PREFIX)) {
    const saved = loadCustomTables().find((t) => t.id === id);
    if (saved) return { ...themeFromSpec(saved.id, saved.name, saved.spec), custom: true };
  }

  return BY_ID.get(LEGACY_FELT[id] ?? '') ?? TABLE_THEMES[0];
}

/**
 * The room a theme borrows when it has no room of its own.
 *
 * Scenes, ambience and music are authored per preset, and a studio table has no preset to be.
 * Rather than leave custom tables in silence in an empty green hall, each one inherits from the
 * preset whose *lamp* it shares — lighting is what a room is, far more than cloth colour is.
 */
export function venueFor(theme: TableTheme): string {
  if (!theme.custom) return theme.id;
  const match = TABLE_THEMES.find((t) => t.lamp.id === theme.lamp.id);
  return match ? match.id : 'classic';
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
  root.style.setProperty('--theme-metal', theme.metal.mid);
  root.style.setProperty('--theme-metal-light', theme.metal.light);
  root.style.setProperty('--theme-lamp', theme.lamp.color);
}
