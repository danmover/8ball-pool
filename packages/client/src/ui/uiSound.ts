/**
 * The sound a control makes when you press it.
 *
 * The menus were silent — 120 buttons across ten screens and nothing to hear from any of them.
 * In a game styled like an arcade cabinet that reads as the press not having registered.
 *
 * Wired as a single delegated listener rather than a handler per button, for the same reason
 * the hover lift lives on `button` rather than on ninety class names: a rule you have to
 * remember to apply to each new control is a rule that will be missing from some of them.
 *
 * The decision of *which* sound is a pure function so it can be tested without a speaker.
 */

export type UiSound = 'hero' | 'back' | 'click' | null;

/** Starting a game — the presses worth more than a tick. */
const HERO = ['.btn-play', '.btn-start', '.btn-join', '.play-btn', '.btn-hot', '.format-card'];

/** Going back, closing, declining. */
const BACK = [
  '.back-btn',
  '.icon-btn.danger',
  '[data-act="cancel"]',
  '#closeSettings',
  '#errorBack',
  '.table-menu-item.danger',
];

/**
 * What to play for a press on `target`, or null for silence.
 *
 * Silence is the answer for anything that is not a control, anything disabled, and anything
 * that already makes its own noise — the prize wheel ratchets as it spins and the shot deck's
 * controls belong to the table's own soundscape, and doubling either sounds like a fault.
 */
export function soundFor(target: Element | null): UiSound {
  const el = target?.closest('button, [role="button"]');
  if (!el) return null;
  if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') return null;

  // Controls that speak for themselves.
  if (el.closest('.shot-deck, .wheel-card, .case-overlay, .emote-bar, .control-area')) return null;

  if (HERO.some((sel) => el.matches(sel))) return 'hero';
  if (BACK.some((sel) => el.matches(sel))) return 'back';
  return 'click';
}
