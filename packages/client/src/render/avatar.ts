/**
 * Deterministic per-seat avatars, drawn as inline SVG so there are no external assets.
 * Each seat gets a distinct pool-ball-styled disc with a cue-chalk accent and the
 * player's initials, so players are told apart at a glance rather than by name alone.
 */

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

/**
 * @param seatIndex which seat this is, picking a stable colour
 * @param name      used for initials; falls back to a question mark when empty
 * @param striped   draw the stripe band, matching the player's assigned group
 */
export function avatarSvg(seatIndex: number, name: string, striped = false): string {
  const { base, ink } = PALETTE[seatIndex % PALETTE.length];
  const text = initialsFor(name);
  const stripe = striped
    ? `<rect x="0" y="30" width="100" height="40" fill="${base}"/>`
    : `<circle cx="50" cy="50" r="50" fill="${base}"/>`;
  const backdrop = striped ? `<circle cx="50" cy="50" r="50" fill="#f6f2e6"/>` : '';

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
      ${backdrop}${stripe}
      <circle cx="50" cy="50" r="30" fill="#fbf8ef"/>
      <text x="50" y="51" font-family="Baloo 2, Nunito, Segoe UI, sans-serif" font-size="30" font-weight="800"
            text-anchor="middle" dominant-baseline="central" fill="${striped ? '#14141a' : ink === '#ffffff' ? '#14141a' : ink}">${text}</text>
      <circle cx="50" cy="50" r="50" fill="url(#g)"/>
      <ellipse cx="33" cy="27" rx="15" ry="10" fill="#fff" opacity="0.75" transform="rotate(-28 33 27)"/>
    </g>
    <circle cx="50" cy="50" r="48" fill="none" stroke="rgba(10,10,18,0.55)" stroke-width="4"/>
  </svg>`;

  // Single-quoted so the result can sit inside a double-quoted inline style attribute.
  // encodeURIComponent leaves no raw single quotes behind, so this can't break out.
  return `url('data:image/svg+xml,${encodeURIComponent(svg)}')`;
}
