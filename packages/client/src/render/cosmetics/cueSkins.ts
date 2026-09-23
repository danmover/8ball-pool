import { DEFAULT_LOADOUT } from '@8ball/shared';

/**
 * Paint data for `TableRenderer.drawCueStick`. The stick's geometry is fixed; a skin only
 * says what colour each section is, plus optional flourishes for the top rarities.
 */
/**
 * How a cue is *built*, as opposed to what colour it is.
 *
 * Added because twenty-four cues drawn from colour alone are twenty-four of the same cue. The
 * things that actually distinguish one cue from another in a rack are structural: how many
 * splice points run up the forearm, whether the grip is bare wood or wrapped in linen, what is
 * inlaid along it, and how the butt is capped. Those are four cheap numbers and they do more
 * work than any amount of repainting.
 */
export interface CueBuild {
  /** Splice points running up the forearm — the single most recognisable cue feature. */
  points: 0 | 4 | 6;
  /** How the grip is finished. */
  wrap: 'none' | 'linen' | 'leather' | 'cord';
  /** Decoration along the forearm. */
  inlay: 'none' | 'dots' | 'diamonds' | 'chevrons' | 'runes';
  /** Butt cap treatment. */
  cap: 'flat' | 'ringed' | 'domed';
}

export interface CueSkin {
  tip: number;
  ferrule: number;
  shaft: number;
  collar: number;
  ring: number;
  forearm: number;
  wrap: number;
  butt: number;
  inlay: number;
  /** Extra glow around the whole stick, on top of the power glow. */
  aura?: number;
  /** Emit embers along the shaft while aiming. */
  embers?: boolean;
  /** Cycle the shaft hue over time. */
  shimmer?: boolean;
  /** Construction. Filled in by `cueSkinFor` from the table below. */
  build: CueBuild;
}

type SkinPaint = Omit<CueSkin, 'build'>;

const SKINS: Record<string, SkinPaint> = {
  'cue.house': {
    tip: 0x4aa8ff,
    ferrule: 0xeef2f8,
    shaft: 0xc99a63,
    collar: 0xffc94d,
    ring: 0x12151d,
    forearm: 0x7d5533,
    wrap: 0x1a1f2b,
    butt: 0xffc94d,
    inlay: 0xffd76b,
  },
  'cue.chalkline': {
    tip: 0x2f6fd0,
    ferrule: 0xeef2f8,
    shaft: 0xdcc49a,
    collar: 0x3f7fd8,
    ring: 0x0f1420,
    forearm: 0x2a4d84,
    wrap: 0x16203a,
    butt: 0x3f7fd8,
    inlay: 0x9fd0ff,
  },
  'cue.jetstream': {
    tip: 0x4aa8ff,
    ferrule: 0xf4f7fb,
    shaft: 0xe6ebf2,
    collar: 0xff4d4d,
    ring: 0x11141c,
    forearm: 0xd23a3a,
    wrap: 0x22262f,
    butt: 0xff4d4d,
    inlay: 0xffffff,
  },
  'cue.rosewood': {
    tip: 0x7a5c3a,
    ferrule: 0xf0e6d2,
    shaft: 0xb07a4a,
    collar: 0xd9a441,
    ring: 0x1a1208,
    forearm: 0x5c2b1c,
    wrap: 0x2a170e,
    butt: 0xd9a441,
    inlay: 0xf1cd7a,
  },
  'cue.neon': {
    tip: 0x34e2b0,
    ferrule: 0xdefff5,
    shaft: 0x18313c,
    collar: 0x34e2b0,
    ring: 0x081218,
    forearm: 0x123040,
    wrap: 0x0a1b24,
    butt: 0x34e2b0,
    inlay: 0x7dffdd,
    aura: 0x34e2b0,
  },
  'cue.obsidian': {
    tip: 0xffc94d,
    ferrule: 0xd8d2c4,
    shaft: 0x1b1b22,
    collar: 0xffc94d,
    ring: 0x000000,
    forearm: 0x101015,
    wrap: 0x08080b,
    butt: 0xffc94d,
    inlay: 0xffe8a8,
  },
  'cue.inferno': {
    tip: 0xffe27a,
    ferrule: 0xffd8a8,
    shaft: 0xff8a1f,
    collar: 0xffe27a,
    ring: 0x2a0d04,
    forearm: 0xc22a10,
    wrap: 0x3a1006,
    butt: 0xffe27a,
    inlay: 0xfff0b8,
    aura: 0xff6a1f,
    embers: true,
  },
  'cue.aurora': {
    tip: 0xdefff5,
    ferrule: 0xffffff,
    shaft: 0x7de0ff,
    collar: 0xc39bff,
    ring: 0x0d1030,
    forearm: 0x5b6bff,
    wrap: 0x161a44,
    butt: 0xc39bff,
    inlay: 0xffffff,
    aura: 0x8ad8ff,
    shimmer: true,
  },
  'cue.bamboo': {
    tip: 0x6fbf73,
    ferrule: 0xf0f5e6,
    shaft: 0xd8e0a8,
    collar: 0x8fbf4a,
    ring: 0x1d2612,
    forearm: 0x5f7a2e,
    wrap: 0x2c3a18,
    butt: 0x8fbf4a,
    inlay: 0xdff0a8,
  },
  'cue.candystick': {
    tip: 0xff8fa8,
    ferrule: 0xffffff,
    shaft: 0xffe6ee,
    collar: 0xff5c86,
    ring: 0x40121f,
    forearm: 0xff9ab5,
    wrap: 0x8f2a45,
    butt: 0xff5c86,
    inlay: 0xffffff,
  },
  'cue.copper': {
    tip: 0x7fd8c0,
    ferrule: 0xf2e6cf,
    shaft: 0xc98a4a,
    collar: 0x6fbfa0,
    ring: 0x241408,
    forearm: 0x8f5326,
    wrap: 0x3a2010,
    butt: 0x6fbfa0,
    inlay: 0xe8c48a,
  },
  'cue.snooker': {
    tip: 0x2f6fd0,
    ferrule: 0xf6f0e0,
    shaft: 0xe0cfa8,
    collar: 0x8a6a3a,
    ring: 0x1a1208,
    forearm: 0x4a2f18,
    wrap: 0x241408,
    butt: 0x8a6a3a,
    inlay: 0xf0dcae,
  },
  'cue.royal': {
    tip: 0xffd76b,
    ferrule: 0xf5eede,
    shaft: 0xb08fd8,
    collar: 0xffc94d,
    ring: 0x1a0f2e,
    forearm: 0x4a2a8f,
    wrap: 0x2a1550,
    butt: 0xffc94d,
    inlay: 0xffe8a8,
  },
  'cue.circuit': {
    tip: 0x34e2b0,
    ferrule: 0xdff5ec,
    shaft: 0x123a2c,
    collar: 0x34e2b0,
    ring: 0x04120c,
    forearm: 0x0d2a20,
    wrap: 0x061a12,
    butt: 0x34e2b0,
    inlay: 0x7dffdd,
    aura: 0x1fbf90,
  },
  'cue.bone': {
    tip: 0x8a8a92,
    ferrule: 0xf5f0e2,
    shaft: 0xece2c8,
    collar: 0x9a9aa2,
    ring: 0x14141a,
    forearm: 0x4a4a52,
    wrap: 0x22222a,
    butt: 0x9a9aa2,
    inlay: 0xf5f0e2,
  },
  'cue.tidal': {
    tip: 0xdefff5,
    ferrule: 0xeaf7ff,
    shaft: 0x3a9ad8,
    collar: 0x7fd8ff,
    ring: 0x061c2e,
    forearm: 0x14496e,
    wrap: 0x0a2a42,
    butt: 0x7fd8ff,
    inlay: 0xdefff5,
    aura: 0x4aa8ff,
  },
  'cue.midas': {
    tip: 0xfff0b8,
    ferrule: 0xfff6d8,
    shaft: 0xffc94d,
    collar: 0xfff0b8,
    ring: 0x4a3410,
    forearm: 0xd8a02e,
    wrap: 0x8a6314,
    butt: 0xfff0b8,
    inlay: 0xffffff,
    aura: 0xffd76b,
    shimmer: true,
  },
  'cue.eventhorizon': {
    tip: 0xffffff,
    ferrule: 0xc9b8ff,
    shaft: 0x0a0616,
    collar: 0xb98cff,
    ring: 0x000000,
    forearm: 0x140a2e,
    wrap: 0x05020c,
    butt: 0xb98cff,
    inlay: 0xffffff,
    aura: 0x7a4aff,
    shimmer: true,
    embers: true,
  },

  /*
   * These six are in the catalogue and had no skin at all, so `cueSkinFor` handed every one of
   * them the house cue — six separately-named, separately-priced items that were, on the table
   * and in the locker, literally the same object.
   */
  'cue.driftwood': {
    tip: 0x8a7f6a,
    ferrule: 0xe8e0cc,
    shaft: 0xc2b49a,
    collar: 0x9aa89a,
    ring: 0x2a2a22,
    forearm: 0x7d7460,
    wrap: 0x4a4638,
    butt: 0x9aa89a,
    inlay: 0xe8e0cc,
  },
  'cue.tartan': {
    tip: 0x2f6fd0,
    ferrule: 0xf0e6d2,
    shaft: 0xd8c49a,
    collar: 0x1f6b3a,
    ring: 0x11170f,
    forearm: 0x8a2230,
    wrap: 0x1f6b3a,
    butt: 0xd8b43d,
    inlay: 0xf6f2e6,
  },
  'cue.brassneck': {
    tip: 0x7a5c3a,
    ferrule: 0xffe9a8,
    shaft: 0xcdb07a,
    collar: 0xd1a23c,
    ring: 0x3a2a10,
    forearm: 0x8a6a2a,
    wrap: 0x2e2412,
    butt: 0xd1a23c,
    inlay: 0xffe9a8,
  },
  'cue.stormglass': {
    tip: 0x9fd8ff,
    ferrule: 0xdfeaf4,
    shaft: 0x6e7f92,
    collar: 0xaebecd,
    ring: 0x111820,
    forearm: 0x33465c,
    wrap: 0x1b2735,
    butt: 0xaebecd,
    inlay: 0xdff0ff,
    aura: 0x7fb0d8,
  },
  'cue.lantern': {
    tip: 0xffd08a,
    ferrule: 0xfff0cc,
    shaft: 0xb5763a,
    collar: 0xffb45c,
    ring: 0x2a1608,
    forearm: 0x6e3a14,
    wrap: 0x33200e,
    butt: 0xffb45c,
    inlay: 0xffe6bd,
    aura: 0xff9a3d,
    embers: true,
  },
  'cue.oathkeeper': {
    tip: 0xf0f4ff,
    ferrule: 0xffffff,
    shaft: 0xdfe6f2,
    collar: 0xd1a23c,
    ring: 0x1a1f2e,
    forearm: 0x2a3350,
    wrap: 0x151b2c,
    butt: 0xd1a23c,
    inlay: 0xffe9a8,
    aura: 0xbfd4ff,
    shimmer: true,
  },
};

const DEFAULT_BUILD: CueBuild = { points: 0, wrap: 'linen', inlay: 'none', cap: 'flat' };

/**
 * Construction per cue.
 *
 * Deliberately a separate table from the paint. Adding a build to each of the colour literals
 * above would have meant editing twenty-four objects to change one idea, and the two are read
 * at different times anyway — the renderer wants the colours every frame and the geometry only
 * when it rebuilds.
 */
const BUILDS: Record<string, CueBuild> = {
  // Plain working cues: no splice, nothing inlaid.
  'cue.house': { points: 0, wrap: 'none', inlay: 'none', cap: 'flat' },
  'cue.bamboo': { points: 0, wrap: 'cord', inlay: 'none', cap: 'flat' },
  'cue.driftwood': { points: 0, wrap: 'none', inlay: 'none', cap: 'flat' },
  'cue.chalkline': { points: 0, wrap: 'linen', inlay: 'dots', cap: 'ringed' },
  'cue.candystick': { points: 4, wrap: 'cord', inlay: 'dots', cap: 'flat' },
  'cue.tartan': { points: 0, wrap: 'leather', inlay: 'chevrons', cap: 'ringed' },

  // Rares start to show real cue-making.
  'cue.jetstream': { points: 4, wrap: 'none', inlay: 'chevrons', cap: 'domed' },
  'cue.rosewood': { points: 4, wrap: 'linen', inlay: 'diamonds', cap: 'ringed' },
  'cue.copper': { points: 4, wrap: 'leather', inlay: 'dots', cap: 'ringed' },
  'cue.snooker': { points: 0, wrap: 'none', inlay: 'none', cap: 'ringed' },
  'cue.royal': { points: 6, wrap: 'linen', inlay: 'diamonds', cap: 'domed' },
  'cue.brassneck': { points: 4, wrap: 'cord', inlay: 'dots', cap: 'ringed' },

  // Epics: six points, heavier decoration.
  'cue.neon': { points: 6, wrap: 'none', inlay: 'chevrons', cap: 'domed' },
  'cue.obsidian': { points: 6, wrap: 'leather', inlay: 'diamonds', cap: 'domed' },
  'cue.circuit': { points: 6, wrap: 'none', inlay: 'runes', cap: 'flat' },
  'cue.bone': { points: 4, wrap: 'none', inlay: 'runes', cap: 'domed' },
  'cue.tidal': { points: 6, wrap: 'cord', inlay: 'chevrons', cap: 'domed' },
  'cue.stormglass': { points: 6, wrap: 'leather', inlay: 'dots', cap: 'ringed' },
  'cue.lantern': { points: 4, wrap: 'leather', inlay: 'runes', cap: 'domed' },

  // Legendaries and above: everything, plus an aura from the paint table.
  'cue.inferno': { points: 6, wrap: 'leather', inlay: 'runes', cap: 'domed' },
  'cue.aurora': { points: 6, wrap: 'cord', inlay: 'diamonds', cap: 'domed' },
  'cue.midas': { points: 6, wrap: 'linen', inlay: 'diamonds', cap: 'domed' },
  'cue.oathkeeper': { points: 6, wrap: 'leather', inlay: 'runes', cap: 'domed' },
  'cue.eventhorizon': { points: 6, wrap: 'none', inlay: 'runes', cap: 'domed' },
};

export function cueSkinFor(id: string | undefined): CueSkin {
  const paint = SKINS[id ?? ''] ?? SKINS[DEFAULT_LOADOUT.cue];
  return { ...paint, build: BUILDS[id ?? ''] ?? DEFAULT_BUILD };
}
