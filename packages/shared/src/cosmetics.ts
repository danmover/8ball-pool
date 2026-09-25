/**
 * The locker.
 *
 * Four slots, eight items each. Every item carries the data the renderer draws it from, so the
 * catalogue is the single description of what a cue or a table *looks like* — the host, every
 * phone and the locker preview all read the same numbers. Nothing here changes how a shot plays.
 */

export type ItemSlot = 'cue' | 'balls' | 'table' | 'fx';

export const SLOTS: ItemSlot[] = ['cue', 'balls', 'table', 'fx'];

export const SLOT_LABELS: Record<ItemSlot, string> = {
  cue: 'Cues',
  balls: 'Ball Sets',
  table: 'Tables',
  fx: 'Shot FX',
};

export type Rarity = 'standard' | 'rare' | 'epic' | 'legendary';

export const RARITY_LABELS: Record<Rarity, string> = {
  standard: 'Standard',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary',
};

/** How an item is obtained. No random boxes: every item says exactly what it costs. */
export type Unlock =
  | { kind: 'starter' }
  | { kind: 'coins'; price: number }
  | { kind: 'level'; level: number }
  | { kind: 'cup'; cupId: string }
  | { kind: 'stars'; stars: number };

export type CuePattern = 'plain' | 'carbon' | 'points' | 'rings' | 'flame' | 'ice' | 'nebula' | 'gold';

export interface CueStyle {
  pattern: CuePattern;
  /** Shaft colour, near the tip. */
  shaft: string;
  /** Butt colour. */
  butt: string;
  /** Grip wrap. */
  wrap: string;
  /** Inlays, rings and points. */
  accent: string;
  /** 0 wood, 1 metal. */
  metalness: number;
  /** Glowing parts, or null. */
  glow: string | null;
  /** Joint collar and ferrule metal; defaults to `accent`. */
  collar?: string;
}

export type BallFinish = 'gloss' | 'satin' | 'marble' | 'neon' | 'chrome' | 'planet' | 'gold';

export interface BallSetStyle {
  finish: BallFinish;
  /** Colours for balls 1-7; stripes 9-15 reuse them in order. */
  colors: [string, string, string, string, string, string, string];
  eight: string;
  cue: string;
  /** The white base of a stripe and the number disc. */
  base: string;
  /** Number ink. */
  ink: string;
  /** Dots on the cue ball, as on a TV set, or null. */
  cueDots: string | null;
}

/** The mark printed in the middle of the cloth. */
export type TableEmblem = 'none' | 'roundel' | 'target' | 'diamond' | 'star' | 'bolt' | 'flake' | 'sun' | 'crown';

export interface TableStyle {
  cloth: string;
  /** Cushion rubber face — usually the cloth a shade darker. */
  cushion: string;
  /** Rail body. */
  rail: string;
  /** Grain streaks on the rail; equal to `rail` for a lacquered or metal finish. */
  grain: string;
  railFinish: 'wood' | 'lacquer' | 'metal';
  /** Corner caps, sights' bezels, pocket rims. */
  trim: string;
  /** Diamond sights. */
  sight: string;
  /** Colour of the light over the table. */
  lamp: string;
  /** How bright the lamp is, 0..1.5 around a typical 1. */
  lampPower: number;
  /** Backdrop tint behind the table. */
  room: string;
  /** Edge lighting under the rails, or null. */
  neon: string | null;
  /** Centre mark on the cloth; defaults to none. */
  emblem?: TableEmblem;
  /** Pocket liner leather. */
  liner?: string;
  /** Apron below the rail; defaults to `rail`. */
  apron?: string;
}

export type TrailKind = 'none' | 'streak' | 'comet' | 'fire' | 'frost' | 'bolt' | 'party' | 'void';

export interface FxStyle {
  trail: TrailKind;
  color: string;
  color2: string;
}

interface ItemBase {
  id: string;
  name: string;
  blurb: string;
  rarity: Rarity;
  unlock: Unlock;
}

export type CosmeticItem =
  | (ItemBase & { slot: 'cue'; style: CueStyle })
  | (ItemBase & { slot: 'balls'; style: BallSetStyle })
  | (ItemBase & { slot: 'table'; style: TableStyle })
  | (ItemBase & { slot: 'fx'; style: FxStyle });

export type Loadout = Record<ItemSlot, string>;

const CLASSIC_COLORS: BallSetStyle['colors'] = [
  '#f2c21b', // 1 yellow
  '#1d4fb8', // 2 blue
  '#d6262b', // 3 red
  '#5b2a86', // 4 purple
  '#f26b1d', // 5 orange
  '#138a4a', // 6 green
  '#7a1f1f', // 7 maroon
];

export const CATALOG: CosmeticItem[] = [
  // ------------------------------------------------------------------ cues
  {
    id: 'cue.oak',
    slot: 'cue',
    name: 'Oak House Cue',
    blurb: 'Honest maple with a leather wrap. Every legend started here.',
    rarity: 'standard',
    unlock: { kind: 'starter' },
    style: { pattern: 'plain', shaft: '#ecd3a0', butt: '#6b4226', wrap: '#1c1512', accent: '#c9a45c', metalness: 0, glow: null },
  },
  {
    id: 'cue.carbon',
    slot: 'cue',
    name: 'Carbon Pro',
    blurb: 'Low-deflection carbon weave with brushed steel collars.',
    rarity: 'rare',
    unlock: { kind: 'coins', price: 900 },
    style: { pattern: 'carbon', shaft: '#34373d', butt: '#1b1d21', wrap: '#0e0f11', accent: '#c7d0da', metalness: 0.35, glow: null },
  },
  {
    id: 'cue.ebony',
    slot: 'cue',
    name: 'Royal Ebony',
    blurb: 'Jet-black ebony with gold points. Looks expensive because it is.',
    rarity: 'rare',
    unlock: { kind: 'coins', price: 1300 },
    style: { pattern: 'points', shaft: '#f0dcae', butt: '#16100c', wrap: '#2a1e14', accent: '#e8b64a', metalness: 0.1, glow: null },
  },
  {
    id: 'cue.neon',
    slot: 'cue',
    name: 'Neon Pulse',
    blurb: 'Cyan light runs down the shaft as you draw it back.',
    rarity: 'epic',
    unlock: { kind: 'coins', price: 2400 },
    style: { pattern: 'rings', shaft: '#1b1f2e', butt: '#0c0e16', wrap: '#141827', accent: '#38f3ff', metalness: 0.2, glow: '#38f3ff' },
  },
  {
    id: 'cue.inferno',
    slot: 'cue',
    name: 'Inferno',
    blurb: 'Hand-painted flames that smoulder at the joint.',
    rarity: 'epic',
    unlock: { kind: 'coins', price: 2800 },
    style: { pattern: 'flame', shaft: '#2a1410', butt: '#140806', wrap: '#1d0c09', accent: '#ff7a1a', metalness: 0.1, glow: '#ff5a1a' },
  },
  {
    id: 'cue.frost',
    slot: 'cue',
    name: 'Frostbite',
    blurb: 'Ice-blue resin over a white core. Cold to the touch.',
    rarity: 'epic',
    unlock: { kind: 'level', level: 12 },
    style: { pattern: 'ice', shaft: '#d9f1ff', butt: '#6fb7e8', wrap: '#e8f7ff', accent: '#ffffff', metalness: 0.15, glow: '#9fe3ff' },
  },
  {
    id: 'cue.nebula',
    slot: 'cue',
    name: 'Nebula',
    blurb: 'A whole galaxy turned on a lathe.',
    rarity: 'legendary',
    unlock: { kind: 'coins', price: 5000 },
    style: { pattern: 'nebula', shaft: '#241640', butt: '#0d0820', wrap: '#140d2a', accent: '#d7a6ff', metalness: 0.2, glow: '#b57bff' },
  },
  {
    id: 'cue.midas',
    slot: 'cue',
    name: 'Midas',
    blurb: 'Solid gold. Awarded to Master Cup champions only.',
    rarity: 'legendary',
    unlock: { kind: 'cup', cupId: 'cup.master' },
    style: { pattern: 'gold', shaft: '#f4d27a', butt: '#b8862b', wrap: '#3a2a10', accent: '#fff1b8', metalness: 1, glow: null },
  },

  // ------------------------------------------------------------------ ball sets
  {
    id: 'balls.classic',
    slot: 'balls',
    name: 'Classic',
    blurb: 'The set in every pub you have ever played in.',
    rarity: 'standard',
    unlock: { kind: 'starter' },
    style: { finish: 'gloss', colors: CLASSIC_COLORS, eight: '#111111', cue: '#fbf7ee', base: '#fbf7ee', ink: '#111111', cueDots: null },
  },
  {
    id: 'balls.tv',
    slot: 'balls',
    name: 'TV Pro',
    blurb: 'Broadcast colours and a dotted cue ball so you can see the spin.',
    rarity: 'rare',
    unlock: { kind: 'coins', price: 900 },
    style: {
      finish: 'gloss',
      colors: ['#ffd400', '#0a58ff', '#ff1f2d', '#8a2bff', '#ff7a00', '#00a86b', '#b3122e'],
      eight: '#0b0b0b',
      cue: '#ffffff',
      base: '#ffffff',
      ink: '#0b0b0b',
      cueDots: '#e0142b',
    },
  },
  {
    id: 'balls.sorbet',
    slot: 'balls',
    name: 'Sorbet',
    blurb: 'Soft pastels in a satin finish. Easy on the eyes, hard to miss.',
    rarity: 'rare',
    unlock: { kind: 'coins', price: 1100 },
    style: {
      finish: 'satin',
      colors: ['#ffe28a', '#8fb8ff', '#ff9aa2', '#c7a4ff', '#ffc38a', '#8fe3b8', '#e09aa8'],
      eight: '#3b3350',
      cue: '#fffaf2',
      base: '#fffaf2',
      ink: '#3b3350',
      cueDots: null,
    },
  },
  {
    id: 'balls.marble',
    slot: 'balls',
    name: 'Marble',
    blurb: 'Every ball cut from veined stone and polished to a shine.',
    rarity: 'epic',
    unlock: { kind: 'coins', price: 2200 },
    style: {
      finish: 'marble',
      colors: ['#d9b24c', '#3c5f9e', '#a83a3a', '#6b4c8a', '#c9763a', '#3f7d5b', '#6b2e2e'],
      eight: '#1c1c1e',
      cue: '#f1efe9',
      base: '#f1efe9',
      ink: '#1c1c1e',
      cueDots: null,
    },
  },
  {
    id: 'balls.glow',
    slot: 'balls',
    name: 'Glow',
    blurb: 'Dark shells with bands that light up the cloth around them.',
    rarity: 'epic',
    unlock: { kind: 'coins', price: 2600 },
    style: {
      finish: 'neon',
      colors: ['#fff23a', '#3aa0ff', '#ff3a5c', '#c13aff', '#ff9a3a', '#3affb0', '#ff3ac8'],
      eight: '#ffffff',
      cue: '#e9fbff',
      base: '#141622',
      ink: '#ffffff',
      cueDots: null,
    },
  },
  {
    id: 'balls.chrome',
    slot: 'balls',
    name: 'Chrome',
    blurb: 'Mirror-polished steel with a tint of colour. Reflects the whole room.',
    rarity: 'epic',
    unlock: { kind: 'level', level: 15 },
    style: {
      finish: 'chrome',
      colors: ['#e8c040', '#4a7ad8', '#d84a5a', '#9a5ad8', '#e8904a', '#4ab87a', '#b84a4a'],
      eight: '#2a2a30',
      cue: '#eef2f6',
      base: '#dfe5ec',
      ink: '#111318',
      cueDots: null,
    },
  },
  {
    id: 'balls.planets',
    slot: 'balls',
    name: 'Planets',
    blurb: 'Fifteen little worlds and a moon to break them with.',
    rarity: 'legendary',
    unlock: { kind: 'coins', price: 5000 },
    style: {
      finish: 'planet',
      colors: ['#e3b25b', '#3b7bd4', '#d4553b', '#8a5bd4', '#d48a3b', '#3bb27b', '#9b3b3b'],
      eight: '#1a1030',
      cue: '#e8e4dc',
      base: '#f5f1e8',
      ink: '#141018',
      cueDots: null,
    },
  },
  {
    id: 'balls.blackgold',
    slot: 'balls',
    name: 'Black & Gold',
    blurb: 'Obsidian and gold leaf. Reach level 30 to earn it.',
    rarity: 'legendary',
    unlock: { kind: 'level', level: 30 },
    style: {
      finish: 'gold',
      colors: ['#e9c46a', '#d9b25a', '#c9a04a', '#e0bb62', '#d2aa55', '#c49848', '#b88d42'],
      eight: '#e9c46a',
      cue: '#fff7e0',
      base: '#121212',
      ink: '#121212',
      cueDots: null,
    },
  },

  // ------------------------------------------------------------------ tables
  {
    id: 'table.club',
    slot: 'table',
    name: 'Club Green',
    blurb: 'Green baize, walnut rails and a warm lamp. The classic.',
    rarity: 'standard',
    unlock: { kind: 'starter' },
    style: {
      cloth: '#1d7a4c', cushion: '#176a41', rail: '#5b3620', grain: '#3f2413', railFinish: 'wood',
      trim: '#c9a25a', sight: '#f3ead2', lamp: '#ffe2b0', lampPower: 1, room: '#0b1510', neon: null,
    },
  },
  {
    id: 'table.tour',
    slot: 'table',
    name: 'Tour Blue',
    blurb: 'Tournament cloth under bright TV lighting.',
    rarity: 'rare',
    unlock: { kind: 'coins', price: 1000 },
    style: {
      cloth: '#1d62b3', cushion: '#18539a', rail: '#17181c', grain: '#17181c', railFinish: 'lacquer',
      trim: '#c9ced6', sight: '#ffffff', lamp: '#f4f8ff', lampPower: 1.2, room: '#070b14', neon: null,
    },
  },
  {
    id: 'table.crimson',
    slot: 'table',
    name: 'Crimson Lounge',
    blurb: 'Red cloth and mahogany in a room full of smoke and jazz.',
    rarity: 'rare',
    unlock: { kind: 'coins', price: 1300 },
    style: {
      cloth: '#8c1d2c', cushion: '#761826', rail: '#4a1a12', grain: '#2d0e09', railFinish: 'wood',
      trim: '#d4a256', sight: '#f5e3c0', lamp: '#ffcf8a', lampPower: 0.9, room: '#140708', neon: null,
    },
  },
  {
    id: 'table.slate',
    slot: 'table',
    name: 'Midnight Slate',
    blurb: 'Charcoal cloth, ebony and chrome. Cool, quiet, serious.',
    rarity: 'epic',
    unlock: { kind: 'coins', price: 2400 },
    style: {
      cloth: '#2a3441', cushion: '#232c37', rail: '#121418', grain: '#1c1f25', railFinish: 'wood',
      trim: '#dfe6ee', sight: '#bfe6ff', lamp: '#dbe9ff', lampPower: 1.05, room: '#05070b', neon: null,
    },
  },
  {
    id: 'table.arcade',
    slot: 'table',
    name: 'Neon Arcade',
    blurb: 'Violet cloth and black lacquer, lit from underneath.',
    rarity: 'epic',
    unlock: { kind: 'coins', price: 2800 },
    style: {
      cloth: '#40207a', cushion: '#351a66', rail: '#0f0d16', grain: '#0f0d16', railFinish: 'lacquer',
      trim: '#ff4fd8', sight: '#5ff7ff', lamp: '#e8d8ff', lampPower: 1, room: '#0a0514', neon: '#ff3fd0',
    },
  },
  {
    id: 'table.glacier',
    slot: 'table',
    name: 'Glacier',
    blurb: 'Ice-blue cloth on brushed silver. Everything slides a little colder.',
    rarity: 'epic',
    unlock: { kind: 'level', level: 20 },
    style: {
      cloth: '#5fa8d3', cushion: '#4f93bd', rail: '#c7d3de', grain: '#aebdcb', railFinish: 'metal',
      trim: '#ffffff', sight: '#1d4f7a', lamp: '#eaf6ff', lampPower: 1.1, room: '#06101a', neon: '#8fe3ff',
    },
  },
  {
    id: 'table.desert',
    slot: 'table',
    name: 'Desert Rose',
    blurb: 'Terracotta cloth and sun-bleached oak at golden hour.',
    rarity: 'legendary',
    unlock: { kind: 'coins', price: 4500 },
    style: {
      cloth: '#b35536', cushion: '#9c4a2e', rail: '#c9a27a', grain: '#a5805a', railFinish: 'wood',
      trim: '#f0c9a0', sight: '#fff3e2', lamp: '#ffc98f', lampPower: 1, room: '#160a06', neon: null,
    },
  },
  {
    id: 'table.royale',
    slot: 'table',
    name: 'Royale',
    blurb: 'Emerald and gold for Pro Cup champions.',
    rarity: 'legendary',
    unlock: { kind: 'cup', cupId: 'cup.pro' },
    style: {
      cloth: '#0d6a4e', cushion: '#0b5a42', rail: '#0c0b0a', grain: '#0c0b0a', railFinish: 'lacquer',
      trim: '#e8c060', sight: '#e8c060', lamp: '#fff0cc', lampPower: 1.05, room: '#040a07', neon: null,
    },
  },

  // ------------------------------------------------------------------ shot fx
  {
    id: 'fx.clean',
    slot: 'fx',
    name: 'Clean',
    blurb: 'No effects. Just pool.',
    rarity: 'standard',
    unlock: { kind: 'starter' },
    style: { trail: 'none', color: '#ffffff', color2: '#ffffff' },
  },
  {
    id: 'fx.streak',
    slot: 'fx',
    name: 'Streak',
    blurb: 'A crisp white streak and a flash on every pot.',
    rarity: 'rare',
    unlock: { kind: 'coins', price: 700 },
    style: { trail: 'streak', color: '#ffffff', color2: '#ffe7a6' },
  },
  {
    id: 'fx.comet',
    slot: 'fx',
    name: 'Comet',
    blurb: 'A long blue tail and a shower of stars in the pocket.',
    rarity: 'rare',
    unlock: { kind: 'coins', price: 1000 },
    style: { trail: 'comet', color: '#5fc8ff', color2: '#b8f0ff' },
  },
  {
    id: 'fx.fire',
    slot: 'fx',
    name: 'Inferno',
    blurb: 'The cue ball burns across the cloth; pockets erupt.',
    rarity: 'epic',
    unlock: { kind: 'coins', price: 2200 },
    style: { trail: 'fire', color: '#ff7a1a', color2: '#ffd23a' },
  },
  {
    id: 'fx.frost',
    slot: 'fx',
    name: 'Frost',
    blurb: 'Ice crystals trail behind and shatter in the pocket.',
    rarity: 'epic',
    unlock: { kind: 'coins', price: 2200 },
    style: { trail: 'frost', color: '#9fe3ff', color2: '#ffffff' },
  },
  {
    id: 'fx.storm',
    slot: 'fx',
    name: 'Storm',
    blurb: 'Crackling arcs on every contact and a thunderclap in the pocket.',
    rarity: 'epic',
    unlock: { kind: 'coins', price: 2600 },
    style: { trail: 'bolt', color: '#8fb4ff', color2: '#ffffff' },
  },
  {
    id: 'fx.party',
    slot: 'fx',
    name: 'Party',
    blurb: 'Rainbow tails and confetti cannons. Subtle it is not.',
    rarity: 'legendary',
    unlock: { kind: 'coins', price: 4000 },
    style: { trail: 'party', color: '#ff4f9a', color2: '#4fd1ff' },
  },
  {
    id: 'fx.void',
    slot: 'fx',
    name: 'Void',
    blurb: 'Pockets become black holes. Earned with 30 trick-shot stars.',
    rarity: 'legendary',
    unlock: { kind: 'stars', stars: 30 },
    style: { trail: 'void', color: '#8a3bff', color2: '#1a0633' },
  },
];

export const DEFAULT_LOADOUT: Loadout = {
  cue: 'cue.oak',
  balls: 'balls.classic',
  table: 'table.club',
  fx: 'fx.clean',
};

export const STARTER_IDS: string[] = Object.values(DEFAULT_LOADOUT);

const BY_ID = new Map(CATALOG.map((item) => [item.id, item]));

export function itemById(id: string): CosmeticItem | undefined {
  return BY_ID.get(id);
}

export function itemsForSlot(slot: ItemSlot): CosmeticItem[] {
  return CATALOG.filter((item) => item.slot === slot);
}

/** Resolves a (possibly partial or stale) loadout to a complete one with valid ids. */
export function resolveLoadout(loadout: Partial<Loadout> | undefined | null): Loadout {
  const out = { ...DEFAULT_LOADOUT };
  if (!loadout) return out;
  for (const slot of SLOTS) {
    const id = loadout[slot];
    if (id && itemById(id)?.slot === slot) out[slot] = id;
  }
  return out;
}

export function cueStyle(id: string | undefined): CueStyle {
  const item = itemById(id ?? '');
  return (item?.slot === 'cue' ? item : (itemById(DEFAULT_LOADOUT.cue) as CosmeticItem & { slot: 'cue' })).style as CueStyle;
}

export function ballSetStyle(id: string | undefined): BallSetStyle {
  const item = itemById(id ?? '');
  return (item?.slot === 'balls' ? item.style : (itemById(DEFAULT_LOADOUT.balls)!.style)) as BallSetStyle;
}

export function tableStyle(id: string | undefined): TableStyle {
  const item = itemById(id ?? '');
  return (item?.slot === 'table' ? item.style : itemById(DEFAULT_LOADOUT.table)!.style) as TableStyle;
}

export function fxStyle(id: string | undefined): FxStyle {
  const item = itemById(id ?? '');
  return (item?.slot === 'fx' ? item.style : itemById(DEFAULT_LOADOUT.fx)!.style) as FxStyle;
}

/** The colour a numbered ball is drawn in for a given set. */
export function ballColor(set: BallSetStyle, id: number): string {
  if (id === 0) return set.cue;
  if (id === 8) return set.eight;
  const index = ((id > 8 ? id - 8 : id) - 1) % 7;
  return set.colors[index];
}

// ------------------------------------------------------------------ avatars

/** Avatars are free: an emoji and a colour, picked in the profile. */
export const AVATAR_ICONS = [
  '🎱', '🦈', '🐍', '🦊', '🐯', '🦁', '🐼', '🐸', '🐙', '🦄', '🐲', '🦅',
  '👑', '🔥', '⚡', '🌙', '⭐', '🍀', '🎯', '💎', '🚀', '👾', '🤖', '😎',
  '🐻', '🧙', '🤠', '👻', '🐺', '🦉',
] as const;

export const AVATAR_COLORS = [
  '#4f8cff', '#ff6b5a', '#39d98a', '#ffc542', '#b57bff',
  '#ff5fa2', '#2ed3d3', '#ff9444', '#8a94a6', '#e8e8f0',
] as const;

export interface Avatar {
  icon: string;
  color: string;
}

export const DEFAULT_AVATAR: Avatar = { icon: '🎱', color: '#4f8cff' };

export function cleanAvatar(a: Partial<Avatar> | null | undefined): Avatar {
  const icon = (AVATAR_ICONS as readonly string[]).includes(a?.icon ?? '') ? a!.icon! : DEFAULT_AVATAR.icon;
  const color = (AVATAR_COLORS as readonly string[]).includes(a?.color ?? '') ? a!.color! : DEFAULT_AVATAR.color;
  return { icon, color };
}
