/**
 * The cosmetic catalog. Lives in `shared` so the server, the host table and the phone
 * controller all agree on item ids — a loadout is only ever a set of ids on the wire, and
 * each client resolves those to its own rendering data.
 */

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

export type CosmeticSlot = 'cue' | 'ballSet' | 'trail' | 'banner' | 'bannerEffect' | 'avatar';

export interface CosmeticItem {
  id: string;
  slot: CosmeticSlot;
  name: string;
  rarity: Rarity;
  /** One-line flavour shown on the item card and the wheel reveal. */
  blurb: string;
}

/** Slot -> item id. Missing slots fall back to the starter item for that slot. */
export type Loadout = Partial<Record<CosmeticSlot, string>>;

export const SLOT_ORDER: CosmeticSlot[] = [
  'cue',
  'ballSet',
  'trail',
  'banner',
  'bannerEffect',
  'avatar',
];

export const SLOT_LABELS: Record<CosmeticSlot, string> = {
  cue: 'Cues',
  ballSet: 'Ball Sets',
  trail: 'Trails',
  banner: 'Banners',
  bannerEffect: 'Banner FX',
  avatar: 'Avatars',
};

export const RARITY_ORDER: Rarity[] = ['common', 'rare', 'epic', 'legendary'];

export const RARITY_LABELS: Record<Rarity, string> = {
  common: 'Common',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary',
};

export const CATALOG: CosmeticItem[] = [
  // ---- Cues ----
  { id: 'cue.house', slot: 'cue', name: 'House Cue', rarity: 'common', blurb: 'Maple and honest work.' },
  { id: 'cue.chalkline', slot: 'cue', name: 'Chalkline', rarity: 'common', blurb: 'Blue tip, blue collar.' },
  { id: 'cue.jetstream', slot: 'cue', name: 'Jetstream', rarity: 'rare', blurb: 'Racing stripes down the shaft.' },
  { id: 'cue.rosewood', slot: 'cue', name: 'Rosewood', rarity: 'rare', blurb: 'Deep grain, brass rings.' },
  { id: 'cue.neon', slot: 'cue', name: 'Neon Runner', rarity: 'epic', blurb: 'Glows in the dark of the hall.' },
  { id: 'cue.obsidian', slot: 'cue', name: 'Obsidian', rarity: 'epic', blurb: 'Black glass with a gold seam.' },
  { id: 'cue.inferno', slot: 'cue', name: 'Inferno', rarity: 'legendary', blurb: 'Embers trail off the shaft.' },
  { id: 'cue.aurora', slot: 'cue', name: 'Aurora', rarity: 'legendary', blurb: 'Shifts colour as you aim.' },

  // ---- Ball sets ----
  { id: 'balls.classic', slot: 'ballSet', name: 'Classic', rarity: 'common', blurb: 'The set you grew up on.' },
  { id: 'balls.vintage', slot: 'ballSet', name: 'Vintage Ivory', rarity: 'common', blurb: 'Warm, aged, matte.' },
  { id: 'balls.candy', slot: 'ballSet', name: 'Candy Shop', rarity: 'rare', blurb: 'Sugar-bright pastels.' },
  { id: 'balls.midnight', slot: 'ballSet', name: 'Midnight', rarity: 'rare', blurb: 'Deep hues, cold highlights.' },
  { id: 'balls.chrome', slot: 'ballSet', name: 'Chrome', rarity: 'epic', blurb: 'Polished metal, hard glare.' },
  { id: 'balls.neon', slot: 'ballSet', name: 'Neon Arcade', rarity: 'epic', blurb: 'Backlit and buzzing.' },
  { id: 'balls.prism', slot: 'ballSet', name: 'Prism', rarity: 'legendary', blurb: 'Every ball a little rainbow.' },

  // ---- Trails ----
  { id: 'trail.classic', slot: 'trail', name: 'Heat Trail', rarity: 'common', blurb: 'White to red with speed.' },
  { id: 'trail.ice', slot: 'trail', name: 'Cold Snap', rarity: 'common', blurb: 'Frost blue, thin and clean.' },
  { id: 'trail.comet', slot: 'trail', name: 'Comet', rarity: 'rare', blurb: 'A tapering tail of light.' },
  { id: 'trail.sparkle', slot: 'trail', name: 'Stardust', rarity: 'rare', blurb: 'Scatters glitter as it rolls.' },
  { id: 'trail.toxic', slot: 'trail', name: 'Toxic', rarity: 'epic', blurb: 'Acid green, faintly wrong.' },
  { id: 'trail.fire', slot: 'trail', name: 'Wildfire', rarity: 'legendary', blurb: 'Leaves the cloth smouldering.' },
  { id: 'trail.void', slot: 'trail', name: 'Void', rarity: 'legendary', blurb: 'A tear where the ball was.' },

  // ---- Banners ----
  { id: 'banner.oak', slot: 'banner', name: 'Oak Plate', rarity: 'common', blurb: 'Standard issue nameplate.' },
  { id: 'banner.felt', slot: 'banner', name: 'Felt & Brass', rarity: 'common', blurb: 'Cloth backing, brass corners.' },
  { id: 'banner.neon', slot: 'banner', name: 'Neon Sign', rarity: 'rare', blurb: 'Buzzing tube lettering.' },
  { id: 'banner.carbon', slot: 'banner', name: 'Carbon', rarity: 'rare', blurb: 'Woven black, red stitch.' },
  { id: 'banner.gold', slot: 'banner', name: 'Gold Leaf', rarity: 'epic', blurb: 'For people who win a lot.' },
  { id: 'banner.champion', slot: 'banner', name: 'Champion', rarity: 'legendary', blurb: 'Laurels included.' },

  // ---- Banner effects ----
  { id: 'fx.none', slot: 'bannerEffect', name: 'No Effect', rarity: 'common', blurb: 'Let the banner speak.' },
  { id: 'fx.embers', slot: 'bannerEffect', name: 'Embers', rarity: 'common', blurb: 'Slow drifting sparks.' },
  { id: 'fx.flames', slot: 'bannerEffect', name: 'Flames', rarity: 'rare', blurb: 'Your name, on fire.' },
  { id: 'fx.shimmer', slot: 'bannerEffect', name: 'Holo Shimmer', rarity: 'rare', blurb: 'Trading-card sheen.' },
  { id: 'fx.electric', slot: 'bannerEffect', name: 'Overcharge', rarity: 'epic', blurb: 'Arcs across the plate.' },
  { id: 'fx.confetti', slot: 'bannerEffect', name: 'Ticker Tape', rarity: 'epic', blurb: 'Permanent parade.' },
  { id: 'fx.galaxy', slot: 'bannerEffect', name: 'Deep Field', rarity: 'legendary', blurb: 'Stars drift behind you.' },

  // ---- Avatars ----
  { id: 'avatar.ball', slot: 'avatar', name: 'Pool Ball', rarity: 'common', blurb: 'Initials on a numbered ball.' },
  { id: 'avatar.chalk', slot: 'avatar', name: 'Chalk Cube', rarity: 'common', blurb: 'Well used, well loved.' },
  { id: 'avatar.eight', slot: 'avatar', name: 'Black Ball', rarity: 'rare', blurb: 'Straight to the point.' },
  { id: 'avatar.crown', slot: 'avatar', name: 'Crowned', rarity: 'epic', blurb: 'Worn with confidence.' },
  { id: 'avatar.skull', slot: 'avatar', name: 'Hustler', rarity: 'legendary', blurb: 'Never plays the first frame straight.' },
];

/** Everyone starts with these, and they can never be rolled or bought. */
export const DEFAULT_LOADOUT: Required<Loadout> = {
  cue: 'cue.house',
  ballSet: 'balls.classic',
  trail: 'trail.classic',
  banner: 'banner.oak',
  bannerEffect: 'fx.none',
  avatar: 'avatar.ball',
};

export const STARTER_IDS: string[] = Object.values(DEFAULT_LOADOUT);

const BY_ID = new Map(CATALOG.map((item) => [item.id, item]));

export function cosmeticById(id: string): CosmeticItem | undefined {
  return BY_ID.get(id);
}

export function itemsForSlot(slot: CosmeticSlot): CosmeticItem[] {
  return CATALOG.filter((item) => item.slot === slot);
}

/** Resolves a (possibly partial or stale) loadout to a complete one with valid ids. */
export function resolveLoadout(loadout: Loadout | undefined): Required<Loadout> {
  const out = { ...DEFAULT_LOADOUT };
  if (!loadout) return out;
  for (const slot of SLOT_ORDER) {
    const id = loadout[slot];
    if (id && cosmeticById(id)?.slot === slot) out[slot] = id;
  }
  return out;
}
