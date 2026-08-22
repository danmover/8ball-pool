import { DEFAULT_LOADOUT } from '@8ball/shared';

/**
 * What a ball-on-ball contact looks like. Feeds `TableRenderer.spawnSparks` /
 * `spawnImpactBurst`, the same way cue skins feed the cue and trail styles feed the trail.
 */
export type BurstShape =
  | 'spark' // radiating spikes (the original)
  | 'puff' // soft expanding cloud
  | 'pow' // jagged comic starburst with a thick ink outline
  | 'ring' // clean shockwave rings, few spikes
  | 'confetti' // scattered rectangles
  | 'bolt' // forked lightning
  | 'shard' // angular ice fragments
  | 'splat' // ink blobs
  | 'nova'; // bright core, long rays, halo

export interface HitEffect {
  shape: BurstShape;
  /** Core, mid and outer colours of the burst. */
  colors: [number, number, number];
  /** Spike/particle count multiplier. */
  density: number;
  /** Size multiplier on the whole burst. */
  scale: number;
  /** Draw the thick dark cartoon outline around the burst. */
  outlined: boolean;
  /** Extra expanding ring on top. */
  ring: boolean;
}

const EFFECTS: Record<string, HitEffect> = {
  'hit.spark': {
    shape: 'spark',
    colors: [0xffffff, 0xffe27a, 0xffb43d],
    density: 1,
    scale: 1,
    outlined: false,
    ring: true,
  },
  'hit.puff': {
    shape: 'puff',
    colors: [0xffffff, 0xdfe8f5, 0x9fc4e8],
    density: 0.9,
    scale: 1.05,
    outlined: false,
    ring: false,
  },
  'hit.pow': {
    shape: 'pow',
    colors: [0xfff3c4, 0xffc94d, 0xff6a1f],
    density: 1.1,
    scale: 1.25,
    outlined: true,
    ring: false,
  },
  'hit.shockwave': {
    shape: 'ring',
    colors: [0xffffff, 0x9fd8ff, 0x4aa8ff],
    density: 0.5,
    scale: 1.3,
    outlined: false,
    ring: true,
  },
  'hit.confetti': {
    shape: 'confetti',
    colors: [0xffe066, 0xff8fa8, 0x7ec8ff],
    density: 1.4,
    scale: 1,
    outlined: false,
    ring: false,
  },
  'hit.lightning': {
    shape: 'bolt',
    colors: [0xffffff, 0xc9e6ff, 0x4a8aff],
    density: 0.8,
    scale: 1.2,
    outlined: false,
    ring: true,
  },
  'hit.frost': {
    shape: 'shard',
    colors: [0xf2fbff, 0xa8dcf5, 0x4fa8e8],
    density: 1.1,
    scale: 1.1,
    outlined: true,
    ring: true,
  },
  'hit.ink': {
    shape: 'splat',
    colors: [0x2a2440, 0x14101f, 0x000000],
    density: 1.2,
    scale: 1.1,
    outlined: false,
    ring: false,
  },
  'hit.nova': {
    shape: 'nova',
    colors: [0xffffff, 0xffe9a8, 0xff7a2e],
    density: 1.5,
    scale: 1.5,
    outlined: true,
    ring: true,
  },
};

export function hitEffectFor(id: string | undefined): HitEffect {
  return EFFECTS[id ?? ''] ?? EFFECTS[DEFAULT_LOADOUT.hitEffect];
}
