/**
 * The cosmetic catalog. Lives in `shared` so the server, the host table and the phone
 * controller all agree on item ids — a loadout is only ever a set of ids on the wire, and
 * each client resolves those to its own rendering data.
 */

/** `mystic` sits above legendary — one per slot, and deliberately absurd. */
export type Rarity = 'common' | 'rare' | 'epic' | 'legendary' | 'mystic';

export type CosmeticSlot =
  | 'cue'
  | 'ballSet'
  | 'trail'
  | 'hitEffect'
  | 'banner'
  | 'bannerEffect'
  | 'avatar';

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
  'hitEffect',
  'banner',
  'bannerEffect',
  'avatar',
];

export const SLOT_LABELS: Record<CosmeticSlot, string> = {
  cue: 'Cues',
  ballSet: 'Ball Sets',
  trail: 'Trails',
  hitEffect: 'Hit FX',
  banner: 'Banners',
  bannerEffect: 'Banner FX',
  avatar: 'Avatars',
};

export const RARITY_ORDER: Rarity[] = ['common', 'rare', 'epic', 'legendary', 'mystic'];

export const RARITY_LABELS: Record<Rarity, string> = {
  common: 'Common',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary',
  mystic: 'Mystic',
};

/** Sort key so grids always run common → mystic regardless of catalog order. */
export function rarityRank(rarity: Rarity): number {
  return RARITY_ORDER.indexOf(rarity);
}

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
  { id: 'cue.bamboo', slot: 'cue', name: 'Bamboo', rarity: 'common', blurb: 'Light, green and forgiving.' },
  { id: 'cue.candystick', slot: 'cue', name: 'Candy Stick', rarity: 'common', blurb: 'Peppermint spiral.' },
  { id: 'cue.copper', slot: 'cue', name: 'Copperhead', rarity: 'rare', blurb: 'Hammered metal, green patina.' },
  { id: 'cue.snooker', slot: 'cue', name: 'Snooker Ash', rarity: 'rare', blurb: 'Straight-grained and serious.' },
  { id: 'cue.royal', slot: 'cue', name: 'Royal Velvet', rarity: 'rare', blurb: 'Purple wrap, gold rings.' },
  { id: 'cue.circuit', slot: 'cue', name: 'Circuit', rarity: 'epic', blurb: 'Traces glow along the shaft.' },
  { id: 'cue.bone', slot: 'cue', name: 'Bonecrusher', rarity: 'epic', blurb: 'Ivory and iron.' },
  { id: 'cue.tidal', slot: 'cue', name: 'Tidal', rarity: 'epic', blurb: 'Deep blues, curling foam.' },
  { id: 'cue.midas', slot: 'cue', name: 'Midas', rarity: 'legendary', blurb: 'Solid gold. Heavier than it looks.' },

  // ---- Ball sets ----
  { id: 'balls.classic', slot: 'ballSet', name: 'Classic', rarity: 'common', blurb: 'The set you grew up on.' },
  { id: 'balls.vintage', slot: 'ballSet', name: 'Vintage Ivory', rarity: 'common', blurb: 'Warm, aged, matte.' },
  { id: 'balls.candy', slot: 'ballSet', name: 'Candy Shop', rarity: 'rare', blurb: 'Sugar-bright pastels.' },
  { id: 'balls.midnight', slot: 'ballSet', name: 'Midnight', rarity: 'rare', blurb: 'Deep hues, cold highlights.' },
  { id: 'balls.chrome', slot: 'ballSet', name: 'Chrome', rarity: 'epic', blurb: 'Polished metal, hard glare.' },
  { id: 'balls.neon', slot: 'ballSet', name: 'Neon Arcade', rarity: 'epic', blurb: 'Backlit and buzzing.' },
  { id: 'balls.prism', slot: 'ballSet', name: 'Prism', rarity: 'legendary', blurb: 'Every ball a little rainbow.' },
  { id: 'balls.pastel', slot: 'ballSet', name: 'Pastel', rarity: 'common', blurb: 'Soft, chalky, easy on the eye.' },
  { id: 'balls.marble', slot: 'ballSet', name: 'Marble', rarity: 'rare', blurb: 'Veined stone, cool to the touch.' },
  { id: 'balls.wood', slot: 'ballSet', name: 'Woodgrain', rarity: 'rare', blurb: 'Turned from solid timber.' },
  { id: 'balls.glass', slot: 'ballSet', name: 'Glassworks', rarity: 'epic', blurb: 'Blown glass with a bright core.' },
  { id: 'balls.gold', slot: 'ballSet', name: 'Bullion', rarity: 'legendary', blurb: 'Fifteen tiny fortunes.' },

  // ---- Trails ----
  { id: 'trail.classic', slot: 'trail', name: 'Heat Trail', rarity: 'common', blurb: 'White to red with speed.' },
  { id: 'trail.ice', slot: 'trail', name: 'Cold Snap', rarity: 'common', blurb: 'Frost blue, thin and clean.' },
  { id: 'trail.comet', slot: 'trail', name: 'Comet', rarity: 'rare', blurb: 'A tapering tail of light.' },
  { id: 'trail.sparkle', slot: 'trail', name: 'Stardust', rarity: 'rare', blurb: 'Scatters glitter as it rolls.' },
  { id: 'trail.toxic', slot: 'trail', name: 'Toxic', rarity: 'epic', blurb: 'Acid green, faintly wrong.' },
  { id: 'trail.fire', slot: 'trail', name: 'Wildfire', rarity: 'legendary', blurb: 'Leaves the cloth smouldering.' },
  { id: 'trail.void', slot: 'trail', name: 'Void', rarity: 'legendary', blurb: 'A tear where the ball was.' },
  { id: 'trail.smoke', slot: 'trail', name: 'Smoke', rarity: 'common', blurb: 'A grey wisp that hangs about.' },
  { id: 'trail.bubble', slot: 'trail', name: 'Bubbles', rarity: 'rare', blurb: 'Fizzes along behind you.' },
  { id: 'trail.rainbow', slot: 'trail', name: 'Rainbow Road', rarity: 'epic', blurb: 'The full spectrum, at speed.' },
  { id: 'trail.electric', slot: 'trail', name: 'Live Wire', rarity: 'epic', blurb: 'Crackles white-blue.' },
  { id: 'trail.gold', slot: 'trail', name: 'Gold Dust', rarity: 'legendary', blurb: 'Leaves a fortune on the cloth.' },

  // ---- Hit effects ----
  { id: 'hit.spark', slot: 'hitEffect', name: 'Classic Spark', rarity: 'common', blurb: 'A clean shower of sparks.' },
  { id: 'hit.puff', slot: 'hitEffect', name: 'Chalk Puff', rarity: 'common', blurb: 'A soft cloud on contact.' },
  { id: 'hit.pow', slot: 'hitEffect', name: 'Comic POW', rarity: 'rare', blurb: 'A drawn starburst, straight off the page.' },
  { id: 'hit.shockwave', slot: 'hitEffect', name: 'Shockwave', rarity: 'rare', blurb: 'A ring that punches outward.' },
  { id: 'hit.confetti', slot: 'hitEffect', name: 'Party Popper', rarity: 'rare', blurb: 'Confetti on every contact.' },
  { id: 'hit.lightning', slot: 'hitEffect', name: 'Lightning', rarity: 'epic', blurb: 'Forked bolts off the impact.' },
  { id: 'hit.frost', slot: 'hitEffect', name: 'Ice Shatter', rarity: 'epic', blurb: 'Shards and a cold snap.' },
  { id: 'hit.ink', slot: 'hitEffect', name: 'Ink Splat', rarity: 'epic', blurb: 'Splatters across the cloth.' },
  { id: 'hit.nova', slot: 'hitEffect', name: 'Nova', rarity: 'legendary', blurb: 'A small star, briefly.' },

  // ---- Banners ----
  { id: 'banner.oak', slot: 'banner', name: 'Oak Plate', rarity: 'common', blurb: 'Standard issue nameplate.' },
  { id: 'banner.felt', slot: 'banner', name: 'Felt & Brass', rarity: 'common', blurb: 'Cloth backing, brass corners.' },
  { id: 'banner.neon', slot: 'banner', name: 'Neon Sign', rarity: 'rare', blurb: 'Buzzing tube lettering.' },
  { id: 'banner.carbon', slot: 'banner', name: 'Carbon', rarity: 'rare', blurb: 'Woven black, red stitch.' },
  { id: 'banner.gold', slot: 'banner', name: 'Gold Leaf', rarity: 'epic', blurb: 'For people who win a lot.' },
  { id: 'banner.champion', slot: 'banner', name: 'Champion', rarity: 'legendary', blurb: 'Laurels included.' },
  { id: 'banner.chalkboard', slot: 'banner', name: 'Chalkboard', rarity: 'common', blurb: 'Your name in chalk.' },
  { id: 'banner.copper', slot: 'banner', name: 'Copper Plate', rarity: 'rare', blurb: 'Riveted and slightly aged.' },
  { id: 'banner.marble', slot: 'banner', name: 'Marble Slab', rarity: 'rare', blurb: 'Cold, pale, expensive.' },
  { id: 'banner.circuit', slot: 'banner', name: 'Circuit Board', rarity: 'epic', blurb: 'Etched traces and solder.' },
  { id: 'banner.royal', slot: 'banner', name: 'Royal Box', rarity: 'legendary', blurb: 'Velvet rope not included.' },

  // ---- Banner effects ----
  { id: 'fx.none', slot: 'bannerEffect', name: 'No Effect', rarity: 'common', blurb: 'Let the banner speak.' },
  { id: 'fx.embers', slot: 'bannerEffect', name: 'Embers', rarity: 'common', blurb: 'Slow drifting sparks.' },
  { id: 'fx.flames', slot: 'bannerEffect', name: 'Flames', rarity: 'rare', blurb: 'Your name, on fire.' },
  { id: 'fx.shimmer', slot: 'bannerEffect', name: 'Holo Shimmer', rarity: 'rare', blurb: 'Trading-card sheen.' },
  { id: 'fx.electric', slot: 'bannerEffect', name: 'Overcharge', rarity: 'epic', blurb: 'Arcs across the plate.' },
  { id: 'fx.confetti', slot: 'bannerEffect', name: 'Ticker Tape', rarity: 'epic', blurb: 'Permanent parade.' },
  { id: 'fx.galaxy', slot: 'bannerEffect', name: 'Deep Field', rarity: 'legendary', blurb: 'Stars drift behind you.' },
  { id: 'fx.bubbles', slot: 'bannerEffect', name: 'Bubbles', rarity: 'common', blurb: 'Gently rising, gently popping.' },
  { id: 'fx.snow', slot: 'bannerEffect', name: 'Snowfall', rarity: 'rare', blurb: 'Quiet flurries across the plate.' },
  { id: 'fx.scanline', slot: 'bannerEffect', name: 'Scanlines', rarity: 'rare', blurb: 'Old monitor flicker.' },
  { id: 'fx.aurora', slot: 'bannerEffect', name: 'Aurora', rarity: 'legendary', blurb: 'Curtains of green light.' },

  // ---- Avatars ----
  { id: 'avatar.ball', slot: 'avatar', name: 'Pool Ball', rarity: 'common', blurb: 'Initials on a numbered ball.' },
  { id: 'avatar.chalk', slot: 'avatar', name: 'Chalk Cube', rarity: 'common', blurb: 'Well used, well loved.' },
  { id: 'avatar.eight', slot: 'avatar', name: 'Black Ball', rarity: 'rare', blurb: 'Straight to the point.' },
  { id: 'avatar.crown', slot: 'avatar', name: 'Crowned', rarity: 'epic', blurb: 'Worn with confidence.' },
  { id: 'avatar.skull', slot: 'avatar', name: 'Hustler', rarity: 'legendary', blurb: 'Never plays the first frame straight.' },
  { id: 'avatar.cue', slot: 'avatar', name: 'Crossed Cues', rarity: 'common', blurb: 'The classic crest.' },
  { id: 'avatar.triangle', slot: 'avatar', name: 'The Rack', rarity: 'rare', blurb: 'Fifteen balls, one triangle.' },
  { id: 'avatar.shark', slot: 'avatar', name: 'Shark', rarity: 'epic', blurb: 'Circling the table.' },
  { id: 'avatar.flame', slot: 'avatar', name: 'Firebrand', rarity: 'legendary', blurb: 'Permanently on fire.' },

  // ---- Mystic: one per slot, and each one is meant to be ridiculous ----
  {
    id: 'cue.eventhorizon',
    slot: 'cue',
    name: 'Event Horizon',
    rarity: 'mystic',
    blurb: 'Light bends around the shaft. The tip is somewhere else entirely.',
  },
  {
    id: 'balls.cosmos',
    slot: 'ballSet',
    name: 'Pocket Cosmos',
    rarity: 'mystic',
    blurb: 'Fifteen tiny galaxies and a moon to break with.',
  },
  {
    id: 'trail.timerift',
    slot: 'trail',
    name: 'Time Rift',
    rarity: 'mystic',
    blurb: 'Leaves a seam in the afternoon that slowly heals over.',
  },
  {
    id: 'hit.bigbang',
    slot: 'hitEffect',
    name: 'Big Bang',
    rarity: 'mystic',
    blurb: 'Briefly creates, and then thinks better of, a universe.',
  },
  {
    id: 'banner.oracle',
    slot: 'banner',
    name: "Oracle's Slate",
    rarity: 'mystic',
    blurb: 'Your name written in a script nobody agreed on.',
  },
  {
    id: 'fx.thirdeye',
    slot: 'bannerEffect',
    name: 'Third Eye',
    rarity: 'mystic',
    blurb: 'It blinks. Sometimes at people who are not you.',
  },
  {
    id: 'avatar.oracle',
    slot: 'avatar',
    name: 'The Oracle',
    rarity: 'mystic',
    blurb: 'Has already seen how this frame ends. Rude about it.',
  },
];

/** Everyone starts with these, and they can never be rolled or bought. */
export const DEFAULT_LOADOUT: Required<Loadout> = {
  cue: 'cue.house',
  ballSet: 'balls.classic',
  trail: 'trail.classic',
  hitEffect: 'hit.spark',
  banner: 'banner.oak',
  bannerEffect: 'fx.none',
  avatar: 'avatar.ball',
};

export const STARTER_IDS: string[] = Object.values(DEFAULT_LOADOUT);

const BY_ID = new Map(CATALOG.map((item) => [item.id, item]));

export function cosmeticById(id: string): CosmeticItem | undefined {
  return BY_ID.get(id);
}

/** Items for a slot, ordered common → mystic so the grid reads as a progression. */
export function itemsForSlot(slot: CosmeticSlot): CosmeticItem[] {
  return CATALOG.filter((item) => item.slot === slot).sort(
    (a, b) => rarityRank(a.rarity) - rarityRank(b.rarity)
  );
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
