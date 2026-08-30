/**
 * The icon set. One consistent hand-drawn look — 2px rounded strokes on a 24-unit grid with
 * the same dark ink outline the balls and cue carry — so the chrome reads as part of the
 * same cartoon world instead of borrowing whatever emoji the platform happens to ship.
 *
 * Same pattern as `modeArt.ts` and `cosmeticPreview.ts`: inline SVG strings, no assets.
 */

export type IconName =
  | 'settings'
  | 'leave'
  | 'back'
  | 'locker'
  | 'wheel'
  | 'target'
  | 'trophy'
  | 'chart'
  | 'globe'
  | 'heart'
  | 'bot'
  | 'phone'
  | 'screen'
  | 'eye'
  | 'chalk'
  | 'clock'
  | 'volume'
  | 'star'
  | 'lock'
  | 'check'
  | 'plus'
  | 'minus'
  | 'cue'
  | 'ball'
  | 'flame'
  | 'sparkle'
  | 'edit'
  | 'play'
  | 'close'
  | 'replay'
  | 'home';

/** Path data drawn on a 24×24 grid, stroked unless noted. */
const PATHS: Record<IconName, string> = {
  settings: `
    <circle cx="12" cy="12" r="3.4"/>
    <path d="M12 2.6v2.2M12 19.2v2.2M4.4 4.4l1.6 1.6M18 18l1.6 1.6M2.6 12h2.2M19.2 12h2.2M4.4 19.6l1.6-1.6M18 6l1.6-1.6"/>`,
  leave: `
    <path d="M14 4.5H6.5A1.5 1.5 0 0 0 5 6v12a1.5 1.5 0 0 0 1.5 1.5H14"/>
    <path d="M17.5 8.5 21 12l-3.5 3.5"/>
    <path d="M21 12h-9.5"/>`,
  back: `<path d="M14.5 5.5 8 12l6.5 6.5"/>`,
  locker: `
    <path d="M3.5 9h17v10.5a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z"/>
    <path d="M2.5 5.5h19V9h-19z"/>
    <path d="M12 5.5v15"/>
    <path d="M12 5.5c-1.6-2.4-5.4-2.6-5.4-.3 0 1.4 2.4 1.8 5.4 1.8s5.4-.4 5.4-1.8c0-2.3-3.8-2.1-5.4.3z"/>`,
  wheel: `
    <circle cx="12" cy="12" r="8.5"/>
    <path d="M12 3.5v17M3.5 12h17M6 6l12 12M18 6 6 18"/>
    <circle cx="12" cy="12" r="2"/>`,
  target: `
    <circle cx="12" cy="12" r="8.5"/>
    <circle cx="12" cy="12" r="4.5"/>
    <circle cx="12" cy="12" r="1.2" fill="currentColor"/>`,
  trophy: `
    <path d="M7.5 4h9v5a4.5 4.5 0 0 1-9 0z"/>
    <path d="M7.5 5.5H5A2.5 2.5 0 0 0 7.5 10M16.5 5.5H19A2.5 2.5 0 0 1 16.5 10"/>
    <path d="M12 13.5V17M8.5 20h7M9.5 17h5"/>`,
  heart: `<path d="M12 20s-7-4.4-7-9.2A3.8 3.8 0 0 1 12 8.4 3.8 3.8 0 0 1 19 10.8c0 4.8-7 9.2-7 9.2z"/>`,
  /* Stats used to borrow the trophy, which meant Career and Stats were the same picture. */
  chart: `<path d="M4 20V10.5M10 20V4.5M16 20v-6.5M21.5 20h-19"/>`,
  globe: `<circle cx="12" cy="12" r="8.6"/><path d="M3.6 12h16.8M12 3.4a13 13 0 0 1 0 17.2 13 13 0 0 1 0-17.2Z"/>`,
  bot: `
    <rect x="4.5" y="8" width="15" height="11" rx="2.5"/>
    <path d="M12 4.5V8M9 13h.01M15 13h.01"/>
    <circle cx="12" cy="3.6" r="1.2"/>
    <path d="M9.5 16h5"/>`,
  phone: `
    <rect x="7" y="2.8" width="10" height="18.4" rx="2.2"/>
    <path d="M10.5 18.4h3"/>`,
  screen: `
    <rect x="2.8" y="4.5" width="18.4" height="12" rx="2"/>
    <path d="M8.5 20h7M12 16.5V20"/>`,
  eye: `
    <path d="M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12z"/>
    <circle cx="12" cy="12" r="2.8"/>`,
  chalk: `
    <rect x="5" y="5" width="14" height="14" rx="2"/>
    <path d="M5 9h14"/>`,
  clock: `
    <circle cx="12" cy="12" r="8.5"/>
    <path d="M12 7.2V12l3.2 2"/>`,
  volume: `
    <path d="M4.5 9.5h3l4-3.4v11.8l-4-3.4h-3z"/>
    <path d="M15.5 9.2a4 4 0 0 1 0 5.6M18 6.8a7.4 7.4 0 0 1 0 10.4"/>`,
  star: `<path d="m12 3.6 2.6 5.4 5.9.8-4.3 4.1 1.1 5.9-5.3-2.9-5.3 2.9 1.1-5.9L3.5 9.8l5.9-.8z"/>`,
  lock: `
    <rect x="5" y="10.5" width="14" height="9.5" rx="2"/>
    <path d="M8.2 10.5V7.8a3.8 3.8 0 0 1 7.6 0v2.7"/>`,
  check: `<path d="m5 12.5 4.5 4.5L19 7"/>`,
  plus: `<path d="M12 5.5v13M5.5 12h13"/>`,
  minus: `<path d="M5.5 12h13"/>`,
  cue: `
    <path d="M3.6 20.4 20.4 3.6"/>
    <path d="M5.2 18.8 8 16"/>`,
  ball: `
    <circle cx="12" cy="12" r="8.5"/>
    <circle cx="12" cy="12" r="3.4"/>`,
  flame: `
    <path d="M12 20.5c3.3 0 5.5-2.2 5.5-5.2 0-4.4-4.4-5.6-3.4-11.3-2.6 1-4.7 3.7-4.7 6.3 0 1.3.5 2 .5 2.7 0 .9-.7 1.4-1.4 1.4-1 0-1.6-.9-1.6-2.2-1.3 1.3-1.4 2.6-1.4 3.6 0 3 2.2 4.7 6.5 4.7z"/>`,
  sparkle: `
    <path d="m12 3.5 1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z"/>
    <path d="M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>`,
  edit: `
    <path d="m4.5 19.5 1-4 10-10 3 3-10 10z"/>
    <path d="m14 6.5 3 3"/>`,
  play: `<path d="M8 5.4 18.5 12 8 18.6z"/>`,
  close: `<path d="m6.5 6.5 11 11M17.5 6.5l-11 11"/>`,
  replay: `
    <path d="M20 12a8 8 0 1 1-2.6-5.9"/>
    <path d="M20 4v4.5h-4.5"/>`,
  home: `
    <path d="M4 11.2 12 4.5l8 6.7"/>
    <path d="M6.2 10v9.5h11.6V10"/>
    <path d="M10 19.5v-5h4v5"/>`,
};

/** Icons that read better filled than stroked. */
const FILLED: IconName[] = ['heart', 'star', 'play', 'flame', 'sparkle'];

export interface IconOpts {
  size?: number;
  /** Extra classes on the svg, e.g. for colour. */
  className?: string;
  /** Draw the dark cartoon outline behind the shape, like the ball art. */
  outlined?: boolean;
}

export function icon(name: IconName, opts: IconOpts = {}): string {
  const { size = 22, className = '', outlined = false } = opts;
  const filled = FILLED.includes(name);
  const body = PATHS[name];

  // The outline pass is the same geometry drawn fatter in ink underneath, which is exactly
  // how the balls and cue get their cartoon edge.
  const outline = outlined
    ? `<g fill="none" stroke="var(--ink)" stroke-width="5.5" stroke-linecap="round"
          stroke-linejoin="round" opacity="0.9">${body}</g>`
    : '';

  return `<svg class="icon ${className}" viewBox="0 0 24 24" width="${size}" height="${size}"
     fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"
     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${outline}${body}</svg>`;
}
