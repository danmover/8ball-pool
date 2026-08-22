import { DEFAULT_LOADOUT } from '@8ball/shared';

/**
 * Paint data for `TableRenderer.drawCueStick`. The stick's geometry is fixed; a skin only
 * says what colour each section is, plus optional flourishes for the top rarities.
 */
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
}

const SKINS: Record<string, CueSkin> = {
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
};

export function cueSkinFor(id: string | undefined): CueSkin {
  return SKINS[id ?? ''] ?? SKINS[DEFAULT_LOADOUT.cue];
}
