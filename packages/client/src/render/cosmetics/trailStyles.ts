import { DEFAULT_LOADOUT } from '@8ball/shared';

/**
 * Trail styles feed `TableRenderer.updateTrail`. `ramp` is sampled by normalised speed, so
 * a style can go hot with pace (the classic heat trail) or stay one colour throughout.
 */
export type TrailShape = 'ribbon' | 'comet' | 'sparkle' | 'fire';

export interface TrailStyle {
  /** Colour stops sampled left-to-right as speed rises. At least two entries. */
  ramp: number[];
  shape: TrailShape;
  /** Multipliers on the base width / opacity. */
  width: number;
  alpha: number;
  /** Length multiplier on the number of retained trail points. */
  length: number;
  /** Additive glow pass under the trail. */
  glow?: boolean;
}

const STYLES: Record<string, TrailStyle> = {
  'trail.classic': {
    ramp: [0xfff6d8, 0xffb43d, 0xff2d1f],
    shape: 'ribbon',
    width: 1,
    alpha: 1,
    length: 1,
  },
  'trail.ice': {
    ramp: [0xf2fbff, 0x9fd8ff, 0x4aa8ff],
    shape: 'ribbon',
    width: 0.8,
    alpha: 0.95,
    length: 1.05,
  },
  'trail.comet': {
    ramp: [0xfff3c4, 0xffd166, 0xff8a1f],
    shape: 'comet',
    width: 1.15,
    alpha: 1,
    length: 1.5,
    glow: true,
  },
  'trail.sparkle': {
    ramp: [0xffffff, 0xd8c4ff, 0x9a7aff],
    shape: 'sparkle',
    width: 0.85,
    alpha: 0.9,
    length: 1.2,
    glow: true,
  },
  'trail.toxic': {
    ramp: [0xdfffa8, 0x8bff3a, 0x25c04a],
    shape: 'ribbon',
    width: 1.2,
    alpha: 1,
    length: 1.25,
    glow: true,
  },
  'trail.fire': {
    ramp: [0xfff0b8, 0xffa62e, 0xff2d0a],
    shape: 'fire',
    width: 1.35,
    alpha: 1,
    length: 1.6,
    glow: true,
  },
  'trail.void': {
    ramp: [0x6a5aff, 0x2a1a6a, 0x08040f],
    shape: 'comet',
    width: 1.3,
    alpha: 1,
    length: 1.45,
    glow: true,
  },
  'trail.smoke': {
    ramp: [0xe8e8ea, 0xa8a8b0, 0x6a6a74],
    shape: 'ribbon',
    width: 1.15,
    alpha: 0.7,
    length: 1.3,
  },
  'trail.bubble': {
    ramp: [0xffffff, 0xc4ecff, 0x7fc4e8],
    shape: 'sparkle',
    width: 0.9,
    alpha: 0.85,
    length: 1.15,
    glow: true,
  },
  'trail.rainbow': {
    ramp: [0xff4d4d, 0xffc94d, 0x39ff88, 0x4aa8ff, 0xb44dff],
    shape: 'ribbon',
    width: 1.25,
    alpha: 1,
    length: 1.5,
    glow: true,
  },
  'trail.electric': {
    ramp: [0xffffff, 0xc9e6ff, 0x4a8aff],
    shape: 'sparkle',
    width: 1.1,
    alpha: 1,
    length: 1.3,
    glow: true,
  },
  'trail.gold': {
    ramp: [0xfff6d8, 0xffd76b, 0xc9a23a],
    shape: 'comet',
    width: 1.2,
    alpha: 1,
    length: 1.45,
    glow: true,
  },
  'trail.timerift': {
    ramp: [0xffffff, 0xb98cff, 0x2a0a5a, 0x000000],
    shape: 'comet',
    width: 1.5,
    alpha: 1,
    length: 1.8,
    glow: true,
  },
};

export function trailStyleFor(id: string | undefined): TrailStyle {
  return STYLES[id ?? ''] ?? STYLES[DEFAULT_LOADOUT.trail];
}

/** Samples a style's ramp at `t` (0..1) with linear interpolation between stops. */
export function sampleRamp(ramp: number[], t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  const span = ramp.length - 1;
  const scaled = clamped * span;
  const i = Math.min(span - 1, Math.floor(scaled));
  const f = scaled - i;
  const a = ramp[i];
  const b = ramp[i + 1];
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  return (
    ((ar + (br - ar) * f) << 16) | ((ag + (bg - ag) * f) << 8) | (ab + (bb - ab) * f)
  );
}
