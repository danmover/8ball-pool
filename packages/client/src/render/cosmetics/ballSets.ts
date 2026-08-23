import { DEFAULT_LOADOUT } from '@8ball/shared';
import type { BallStyle } from '../ballStyle';

/**
 * Ball sets re-skin all 16 balls at once. A set supplies the seven base colours (reused by
 * the matching stripe), the cue/eight colours, the stripe backing, and a `finish` that
 * `generateBallCanvas` reads to decide how the ball is shaded.
 */
export type BallFinish = 'glossy' | 'matte' | 'metallic' | 'neon';

/**
 * Surface treatment painted into the ball before shading. This is what actually tells the
 * sets apart — swapping the palette alone left every set reading as "the same balls, other
 * colours" at the size they're drawn on the table.
 */
export type BallPattern =
  | 'plain'
  | 'marble' // stone veining
  | 'wood' // turned timber grain rings
  | 'swirl' // candy spiral
  | 'starfield' // nebula and stars inside the ball
  | 'glass' // translucent with a bright inner core
  | 'engraved' // struck-metal facets and a milled edge
  | 'crackle' // aged, faintly crazed glaze
  | 'prism' // rainbow refraction sweep
  | 'circuit'; // etched neon traces

export interface BallSet {
  colors: [number, number, number, number, number, number, number]; // balls 1..7
  cue: number;
  eight: number;
  /** Backing colour behind a stripe, and the cue ball's "white". */
  backing: number;
  finish: BallFinish;
  pattern: BallPattern;
  outline: number;
  /** Stripe band as a fraction of the ball's height. Some sets wear a thinner band. */
  stripeWidth?: number;
}

const SETS: Record<string, BallSet> = {
  'balls.classic': {
    colors: [0xffcf2e, 0x2a6ee0, 0xf03a2e, 0x8b4bd8, 0xff8a1f, 0x17a85a, 0x9e3226],
    cue: 0xf6f2e6,
    eight: 0x111111,
    backing: 0xf6f2e6,
    finish: 'glossy',
    pattern: 'plain',
    outline: 0x0c0a14,
  },
  'balls.vintage': {
    colors: [0xe8c463, 0x4a6f9c, 0xc2564a, 0x8a6a9e, 0xd8894a, 0x5f8f68, 0x8a5a44],
    cue: 0xefe4cb,
    eight: 0x2a241d,
    backing: 0xefe4cb,
    finish: 'matte',
    pattern: 'crackle',
    outline: 0x2a2016,
  },
  'balls.candy': {
    colors: [0xffe066, 0x7ec8ff, 0xff8fa8, 0xc9a3ff, 0xffb27a, 0x8fe6b4, 0xd98f7a],
    cue: 0xfff6fb,
    eight: 0x4a2a55,
    backing: 0xfff6fb,
    finish: 'glossy',
    pattern: 'swirl',
    outline: 0x5a3a55,
  },
  'balls.midnight': {
    colors: [0xc9a227, 0x1d3f8f, 0x8f1d2a, 0x4a2a8f, 0xb35a12, 0x146b4a, 0x5f2418],
    cue: 0xd6dae6,
    eight: 0x05060a,
    backing: 0xd6dae6,
    finish: 'glossy',
    pattern: 'plain',
    outline: 0x04050a,
  },
  'balls.chrome': {
    colors: [0xd8c07a, 0x8fa6c4, 0xc48f8f, 0xa88fc4, 0xd0a37a, 0x8fc4a6, 0xa8887a],
    cue: 0xf2f4f8,
    eight: 0x1a1c22,
    backing: 0xe6eaf2,
    finish: 'metallic',
    pattern: 'engraved',
    outline: 0x2a2e38,
  },
  'balls.neon': {
    colors: [0xffee32, 0x2ee6ff, 0xff2e6a, 0xb44dff, 0xff9a2e, 0x39ff88, 0xff5e3a],
    cue: 0xf2fff8,
    eight: 0x0a0410,
    backing: 0x101426,
    finish: 'neon',
    pattern: 'circuit',
    outline: 0x05030c,
  },
  'balls.prism': {
    colors: [0xfff07a, 0x7ad4ff, 0xff7ab0, 0xb98cff, 0xffb27a, 0x8affc4, 0xff9a9a],
    cue: 0xffffff,
    eight: 0x1a1030,
    backing: 0xffffff,
    finish: 'metallic',
    pattern: 'prism',
    outline: 0x2a1a4a,
  },
  'balls.pastel': {
    colors: [0xf7e08a, 0xa8c8f0, 0xf2a8b8, 0xcbb2ea, 0xf5c49a, 0xa8dfc0, 0xd8a894],
    cue: 0xfffaf2,
    eight: 0x4a4458,
    backing: 0xfffaf2,
    finish: 'matte',
    pattern: 'plain',
    outline: 0x5a5266,
  },
  'balls.marble': {
    colors: [0xe8dfc8, 0xb8c6d8, 0xd8bcbc, 0xcabcd8, 0xe0cbb0, 0xb8d8c4, 0xc4b0a8],
    cue: 0xf8f4ec,
    eight: 0x2a2a30,
    backing: 0xf2ece0,
    finish: 'glossy',
    pattern: 'marble',
    outline: 0x3a3742,
  },
  'balls.wood': {
    colors: [0xd8a860, 0x8a6a48, 0xa8623c, 0x7a5a70, 0xc48a4a, 0x6f8a5c, 0x8a5a3c],
    cue: 0xe8d8b8,
    eight: 0x2e2118,
    backing: 0xe8d8b8,
    finish: 'matte',
    pattern: 'wood',
    outline: 0x33240f,
  },
  'balls.glass': {
    colors: [0xfff0a0, 0x9fe0ff, 0xffa8bc, 0xd8b0ff, 0xffc89a, 0xa8f0cc, 0xffb0a8],
    cue: 0xf4fcff,
    eight: 0x1a2030,
    backing: 0xf4fcff,
    finish: 'glossy',
    pattern: 'glass',
    outline: 0x2a3550,
  },
  'balls.gold': {
    colors: [0xffd76b, 0xd8b04a, 0xffc94d, 0xe8bf5a, 0xffe08a, 0xc9a23a, 0xd8ab42],
    cue: 0xfff6d8,
    eight: 0x4a3410,
    backing: 0xfff6d8,
    finish: 'metallic',
    pattern: 'engraved',
    outline: 0x4a3410,
  },
  'balls.cosmos': {
    colors: [0xffd76b, 0x4a8aff, 0xff4d8a, 0xb44dff, 0xff9a3a, 0x34e2b0, 0xff5c5c],
    cue: 0xe8e4ff,
    eight: 0x05020c,
    backing: 0x140a2e,
    finish: 'neon',
    pattern: 'starfield',
    outline: 0x05020c,
  },
};

export function ballSetFor(id: string | undefined): BallSet {
  return SETS[id ?? ''] ?? SETS[DEFAULT_LOADOUT.ballSet];
}

/** The per-ball style for a given set — the set-aware replacement for `styleForBall`. */
export function styleForBallInSet(id: number, set: BallSet): BallStyle {
  if (id === 0) return { base: set.cue, stripe: false, label: '' };
  if (id === 8) return { base: set.eight, stripe: false, label: '8' };
  if (id <= 7) return { base: set.colors[id - 1], stripe: false, label: String(id) };
  return { base: set.colors[id - 9], stripe: true, label: String(id) };
}
