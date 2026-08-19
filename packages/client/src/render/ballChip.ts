import { styleForBall } from './ballStyle';

function hexToCss(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

/** A small round "which balls have you potted" chip for the scoreboard, dimmed once potted. */
export function ballChipHtml(id: number, potted: boolean): string {
  const style = styleForBall(id);
  return `<div class="ball-chip${potted ? ' potted' : ''}" style="--ball-color:${hexToCss(style.base)}"><span>${style.label}</span></div>`;
}

export function placeholderChipHtml(): string {
  return `<div class="ball-chip placeholder"><span>?</span></div>`;
}
