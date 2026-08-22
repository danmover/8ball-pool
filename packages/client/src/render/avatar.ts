/**
 * Deterministic per-seat avatars, drawn as inline SVG so there are no external assets.
 * The base is a pool-ball-styled disc carrying the player's initials; the equipped
 * avatar cosmetic swaps the disc's treatment (chalk cube, black ball, crown, hustler).
 */

import { DEFAULT_LOADOUT } from '@8ball/shared';

const PALETTE = [
  { base: '#ffcf2e', ink: '#4a3400' },
  { base: '#2a6ee0', ink: '#ffffff' },
  { base: '#f03a2e', ink: '#ffffff' },
  { base: '#8b4bd8', ink: '#ffffff' },
  { base: '#ff8a1f', ink: '#4a2600' },
  { base: '#17a85a', ink: '#ffffff' },
  { base: '#9e3226', ink: '#ffffff' },
  { base: '#18b5c8', ink: '#04343a' },
];

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

const FONT = 'Baloo 2, Nunito, Segoe UI, sans-serif';

/** Gloss + rim, shared by every round avatar style. */
const GLOSS = `
  <circle cx="50" cy="50" r="50" fill="url(#g)"/>
  <ellipse cx="33" cy="27" rx="15" ry="10" fill="#fff" opacity="0.75" transform="rotate(-28 33 27)"/>`;

interface AvatarOpts {
  seatIndex: number;
  name: string;
  striped?: boolean;
  /** Equipped `avatar` cosmetic id. */
  style?: string;
}

function body(opts: AvatarOpts, text: string): string {
  const { base, ink } = PALETTE[opts.seatIndex % PALETTE.length];
  const style = opts.style ?? DEFAULT_LOADOUT.avatar;

  if (style === 'avatar.chalk') {
    // A cube of table chalk, worn at the corners.
    return `
      <rect x="6" y="6" width="88" height="88" rx="10" fill="#2f6fd0"/>
      <rect x="6" y="6" width="88" height="16" rx="8" fill="#4a8ae8"/>
      <rect x="18" y="30" width="64" height="52" rx="6" fill="#1e4f9c" opacity="0.5"/>
      <text x="50" y="58" font-family="${FONT}" font-size="30" font-weight="800"
            text-anchor="middle" dominant-baseline="central" fill="#eaf3ff">${text}</text>
      <rect x="6" y="6" width="88" height="88" rx="10" fill="none" stroke="rgba(10,10,18,0.55)" stroke-width="4"/>`;
  }

  if (style === 'avatar.eight') {
    return `
      <circle cx="50" cy="50" r="50" fill="#111111"/>
      <circle cx="50" cy="50" r="30" fill="#fbf8ef"/>
      <text x="50" y="51" font-family="${FONT}" font-size="30" font-weight="800"
            text-anchor="middle" dominant-baseline="central" fill="#14141a">${text}</text>
      ${GLOSS}`;
  }

  if (style === 'avatar.crown') {
    return `
      <circle cx="50" cy="50" r="50" fill="${base}"/>
      <circle cx="50" cy="56" r="28" fill="#fbf8ef"/>
      <text x="50" y="58" font-family="${FONT}" font-size="27" font-weight="800"
            text-anchor="middle" dominant-baseline="central" fill="${ink === '#ffffff' ? '#14141a' : ink}">${text}</text>
      <path d="M24 26 L34 12 L44 24 L50 8 L56 24 L66 12 L76 26 Z" fill="#ffc94d" stroke="#a8761c" stroke-width="3"/>
      ${GLOSS}`;
  }

  if (style === 'avatar.skull') {
    return `
      <circle cx="50" cy="50" r="50" fill="#15151c"/>
      <path d="M50 16c-19 0-31 13-31 30 0 11 5 17 11 21v11a4 4 0 0 0 4 4h32a4 4 0 0 0 4-4V67c6-4 11-10 11-21 0-17-12-30-31-30z" fill="#ece7db"/>
      <ellipse cx="37" cy="47" rx="9" ry="10" fill="#15151c"/>
      <ellipse cx="63" cy="47" rx="9" ry="10" fill="#15151c"/>
      <path d="M50 58 L45 68 h10 z" fill="#15151c"/>
      <text x="50" y="83" font-family="${FONT}" font-size="16" font-weight="800"
            text-anchor="middle" dominant-baseline="central" fill="#15151c">${text}</text>
      ${GLOSS}`;
  }

  if (style === 'avatar.cue') {
    return `
      <circle cx="50" cy="50" r="50" fill="${base}"/>
      <g stroke="#f0dcae" stroke-width="9" stroke-linecap="round">
        <path d="M20 80 L80 20"/><path d="M80 80 L20 20"/>
      </g>
      <g stroke="#7d5533" stroke-width="4" stroke-linecap="round">
        <path d="M20 80 L38 62"/><path d="M80 80 L62 62"/>
      </g>
      <circle cx="50" cy="50" r="17" fill="#fbf8ef"/>
      <text x="50" y="51" font-family="${FONT}" font-size="16" font-weight="800"
            text-anchor="middle" dominant-baseline="central" fill="#14141a">${text}</text>
      ${GLOSS}`;
  }

  if (style === 'avatar.triangle') {
    return `
      <circle cx="50" cy="50" r="50" fill="${base}"/>
      <path d="M50 18 L82 74 H18 Z" fill="none" stroke="#c99a63" stroke-width="7" stroke-linejoin="round"/>
      <g stroke="rgba(10,10,18,0.5)" stroke-width="1.5">
        <circle cx="50" cy="34" r="7" fill="#ffcf2e"/>
        <circle cx="42" cy="48" r="7" fill="#2a6ee0"/>
        <circle cx="58" cy="48" r="7" fill="#f03a2e"/>
        <circle cx="34" cy="62" r="7" fill="#8b4bd8"/>
        <circle cx="50" cy="62" r="7" fill="#111"/>
        <circle cx="66" cy="62" r="7" fill="#17a85a"/>
      </g>
      ${GLOSS}`;
  }

  if (style === 'avatar.shark') {
    return `
      <circle cx="50" cy="50" r="50" fill="#2a6ee0"/>
      <path d="M12 66c14-4 22-2 30 2 10-14 24-22 44-24-4 10-4 18-2 24-8 10-22 18-38 18-14 0-26-8-34-20z" fill="#9fc4e8"/>
      <path d="M52 30 L60 8 L70 30z" fill="#7fa8d8"/>
      <circle cx="66" cy="52" r="4" fill="#14141a"/>
      <path d="M40 62 l6-5 6 5 6-5 6 5" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
      <text x="30" y="84" font-family="${FONT}" font-size="16" font-weight="800"
            text-anchor="middle" dominant-baseline="central" fill="#fff">${text}</text>
      ${GLOSS}`;
  }

  if (style === 'avatar.flame') {
    return `
      <circle cx="50" cy="50" r="50" fill="#3a1608"/>
      <path d="M50 88c18 0 30-12 30-28 0-24-24-30-18-60-14 5-26 20-26 34 0 7 3 11 3 15 0 5-4 7-8 7-5 0-8-5-8-12-7 7-8 14-8 20 0 16 12 24 35 24z"
            fill="#ff8a1f"/>
      <path d="M50 82c10 0 17-7 17-16 0-13-13-17-10-33-8 3-15 11-15 19 0 4 2 6 2 8 0 3-2 4-4 4-3 0-5-3-5-7-4 4-4 8-4 11 0 9 7 14 19 14z"
            fill="#ffe27a"/>
      <text x="50" y="62" font-family="${FONT}" font-size="20" font-weight="900"
            text-anchor="middle" dominant-baseline="central" fill="#7a2c06">${text}</text>
      ${GLOSS}`;
  }

  if (style === 'avatar.oracle') {
    return `
      <circle cx="50" cy="50" r="50" fill="#140a2e"/>
      <g fill="#b98cff" opacity="0.8">
        <circle cx="18" cy="22" r="2"/><circle cx="82" cy="30" r="1.6"/>
        <circle cx="30" cy="78" r="1.8"/><circle cx="74" cy="76" r="2.2"/>
        <circle cx="52" cy="14" r="1.4"/>
      </g>
      <path d="M8 50s16-22 42-22 42 22 42 22-16 22-42 22S8 50 8 50z" fill="#2a1560" stroke="#b98cff" stroke-width="3"/>
      <circle cx="50" cy="50" r="15" fill="#e8d8ff"/>
      <circle cx="50" cy="50" r="9" fill="#7a4aff"/>
      <circle cx="50" cy="50" r="4" fill="#0a0616"/>
      <circle cx="46" cy="46" r="2.6" fill="#fff"/>
      <text x="50" y="86" font-family="${FONT}" font-size="13" font-weight="800"
            text-anchor="middle" dominant-baseline="central" fill="#e8d8ff">${text}</text>
      ${GLOSS}`;
  }

  // avatar.ball — the original numbered-ball disc, striped when the group is stripes.
  const stripe = opts.striped
    ? `<circle cx="50" cy="50" r="50" fill="#f6f2e6"/><rect x="0" y="30" width="100" height="40" fill="${base}"/>`
    : `<circle cx="50" cy="50" r="50" fill="${base}"/>`;
  return `
    ${stripe}
    <circle cx="50" cy="50" r="30" fill="#fbf8ef"/>
    <text x="50" y="51" font-family="${FONT}" font-size="30" font-weight="800"
          text-anchor="middle" dominant-baseline="central"
          fill="${opts.striped ? '#14141a' : ink === '#ffffff' ? '#14141a' : ink}">${text}</text>
    ${GLOSS}`;
}

/**
 * @param seatIndex which seat this is, picking a stable colour
 * @param name      used for initials; falls back to a question mark when empty
 * @param striped   draw the stripe band, matching the player's assigned group
 * @param style     equipped avatar cosmetic id
 */
export function avatarSvg(seatIndex: number, name: string, striped = false, style?: string): string {
  const text = initialsFor(name);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <defs>
      <clipPath id="c"><circle cx="50" cy="50" r="50"/></clipPath>
      <radialGradient id="g" cx="34%" cy="28%" r="72%">
        <stop offset="0%" stop-color="#fff" stop-opacity="0.85"/>
        <stop offset="42%" stop-color="#fff" stop-opacity="0.10"/>
        <stop offset="100%" stop-color="#000" stop-opacity="0.32"/>
      </radialGradient>
    </defs>
    <g clip-path="url(#c)">
      ${body({ seatIndex, name, striped, style }, text)}
    </g>
    <circle cx="50" cy="50" r="48" fill="none" stroke="rgba(10,10,18,0.55)" stroke-width="4"/>
  </svg>`;

  // Single-quoted so the result can sit inside a double-quoted inline style attribute.
  // encodeURIComponent leaves no raw single quotes behind, so this can't break out.
  return `url('data:image/svg+xml,${encodeURIComponent(svg)}')`;
}
