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
