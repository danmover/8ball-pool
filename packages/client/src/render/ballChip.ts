import { styleForBall } from './ballStyle';

function hexToCss(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

/**
 * A small round "which balls have you potted" chip for the scoreboard, dimmed once potted.
 * Stripes get a real white/colour/white band rather than a flat fill, so solids and
 * stripes are distinguishable at a glance.
 */
export function ballChipHtml(id: number, potted: boolean): string {
  const style = styleForBall(id);
  const color = hexToCss(style.base);
  const background = style.stripe
    ? `linear-gradient(180deg, #f6f2e6 0 26%, ${color} 26% 74%, #f6f2e6 74% 100%)`
    : color;
  return `<div class="ball-chip${style.stripe ? ' striped' : ''}${potted ? ' potted' : ''}" style="--ball-color:${color}; --ball-bg:${background}"><span>${style.label}</span></div>`;
}

export function placeholderChipHtml(): string {
  return `<div class="ball-chip placeholder"><span>?</span></div>`;
}
