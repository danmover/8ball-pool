import { DEFAULT_LOADOUT } from '@8ball/shared';

/**
 * Banners and their effects are DOM, not canvas — the scoreboard panels are already HTML,
 * and CSS keyframes on a handful of elements are far cheaper than standing up a second
 * renderer over the table. Each cosmetic id maps to a class defined in `styles/cosmetics.css`.
 */

const BANNER_CLASSES: Record<string, string> = {
  'banner.oak': 'bn-oak',
  'banner.felt': 'bn-felt',
  'banner.neon': 'bn-neon',
  'banner.carbon': 'bn-carbon',
  'banner.gold': 'bn-gold',
  'banner.champion': 'bn-champion',
  'banner.chalkboard': 'bn-chalkboard',
  'banner.copper': 'bn-copper',
  'banner.marble': 'bn-marble',
  'banner.circuit': 'bn-circuit',
  'banner.royal': 'bn-royal',
  'banner.oracle': 'bn-oracle',
};

const EFFECT_CLASSES: Record<string, string> = {
  'fx.none': '',
  'fx.embers': 'fx-embers',
  'fx.flames': 'fx-flames',
  'fx.shimmer': 'fx-shimmer',
  'fx.electric': 'fx-electric',
  'fx.confetti': 'fx-confetti',
  'fx.galaxy': 'fx-galaxy',
  'fx.bubbles': 'fx-bubbles',
  'fx.snow': 'fx-snow',
  'fx.scanline': 'fx-scanline',
  'fx.aurora': 'fx-aurora',
  'fx.thirdeye': 'fx-thirdeye',
};

/** Effects that need extra child nodes (flame tongues, stars) rather than pure CSS layers. */
const EFFECT_PARTICLES: Record<string, number> = {
  'fx-embers': 6,
  'fx-flames': 7,
  'fx-confetti': 8,
  'fx-galaxy': 10,
  'fx-bubbles': 7,
  'fx-snow': 9,
};

export function bannerClassFor(id: string | undefined): string {
  return BANNER_CLASSES[id ?? ''] ?? BANNER_CLASSES[DEFAULT_LOADOUT.banner];
}

export function bannerEffectClassFor(id: string | undefined): string {
  return EFFECT_CLASSES[id ?? ''] ?? EFFECT_CLASSES[DEFAULT_LOADOUT.bannerEffect];
}

/**
 * Markup for the effect layer of a banner. Returns '' when the effect is purely CSS or
 * switched off, so callers can inline it unconditionally.
 */
export function bannerEffectHtml(effectClass: string): string {
  if (!effectClass) return '';
  const count = EFFECT_PARTICLES[effectClass] ?? 0;
  const bits = Array.from(
    { length: count },
    (_, i) => `<i style="--i:${i}; --n:${count}"></i>`
  ).join('');
  return `<span class="bn-fx ${effectClass}">${bits}</span>`;
}
