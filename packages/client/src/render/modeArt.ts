import type { GameMode } from '@8ball/shared';

/**
 * A small procedural badge per game mode for the menu cards. Same approach as
 * `profile/cosmeticPreview.ts` — inline SVG, no assets, themed to the table art.
 */

const FELT = '#2c9d5c';
const FELT_DARK = '#17703d';
const RAIL = '#c99a63';
const INK = 'rgba(10,10,18,0.65)';

function frame(inner: string): string {
  return `<svg viewBox="0 0 120 80" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
    <defs>
      <linearGradient id="cloth" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${FELT}"/><stop offset="100%" stop-color="${FELT_DARK}"/>
      </linearGradient>
    </defs>
    <rect x="1" y="1" width="118" height="78" rx="9" fill="${RAIL}"/>
    <rect x="7" y="7" width="106" height="66" rx="5" fill="url(#cloth)"/>
    ${inner}
  </svg>`;
}

function ball(x: number, y: number, color: string, label = '', r = 8): string {
  return `<g>
    <circle cx="${x}" cy="${y}" r="${r}" fill="${color}" stroke="${INK}" stroke-width="1.6"/>
    <ellipse cx="${x - r * 0.3}" cy="${y - r * 0.35}" rx="${r * 0.3}" ry="${r * 0.2}" fill="#fff" opacity="0.7"/>
    ${
      label
        ? `<circle cx="${x}" cy="${y}" r="${r * 0.5}" fill="#fbf8ef"/>
           <text x="${x}" y="${y + 0.5}" font-family="Baloo 2, sans-serif" font-size="${r * 0.8}"
                 font-weight="800" text-anchor="middle" dominant-baseline="central" fill="#14141a">${label}</text>`
        : ''
    }
  </g>`;
}

function stripeBall(x: number, y: number, color: string, label: string, r = 8): string {
  // Clip ids must be unique — several of these badges sit on the menu at once.
  const clip = `sb${Math.round(x)}_${Math.round(y)}_${label}`;
  return `<g>
    <clipPath id="${clip}"><circle cx="${x}" cy="${y}" r="${r}"/></clipPath>
    <circle cx="${x}" cy="${y}" r="${r}" fill="#f6f2e6" stroke="${INK}" stroke-width="1.6"/>
    <rect x="${x - r}" y="${y - r * 0.42}" width="${r * 2}" height="${r * 0.84}" fill="${color}"
          clip-path="url(#${clip})"/>
    <circle cx="${x}" cy="${y}" r="${r * 0.5}" fill="#fbf8ef"/>
    <text x="${x}" y="${y + 0.5}" font-family="Baloo 2, sans-serif" font-size="${r * 0.8}"
          font-weight="800" text-anchor="middle" dominant-baseline="central" fill="#14141a">${label}</text>
    <circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${INK}" stroke-width="1.6"/>
  </g>`;
}

const ART: Record<GameMode, string> = {
  // Solids vs stripes facing off across the 8.
  classic: frame(`
    ${ball(28, 40, '#f03a2e', '3')}
    ${ball(46, 40, '#111111', '8')}
    ${stripeBall(64, 40, '#2a6ee0', '10')}
    ${stripeBall(82, 40, '#ffcf2e', '9')}`),

  // The 9-ball diamond.
  nineball: frame(`
    ${ball(45, 40, '#ffcf2e', '1', 7)}
    ${ball(58, 32, '#2a6ee0', '2', 7)}
    ${ball(58, 48, '#f03a2e', '3', 7)}
    ${stripeBall(71, 40, '#ffcf2e', '9', 7)}
    ${ball(84, 40, '#17a85a', '6', 7)}`),

  // Two pairs, one per team colour.
  teams: frame(`
    <rect x="7" y="7" width="53" height="66" fill="#000" opacity="0.14"/>
    ${ball(26, 30, '#f03a2e', '', 7)}${ball(40, 46, '#f03a2e', '', 7)}
    ${ball(80, 30, '#2a6ee0', '', 7)}${ball(94, 46, '#2a6ee0', '', 7)}
    <text x="60" y="42" font-family="Baloo 2, sans-serif" font-size="14" font-weight="900"
          text-anchor="middle" dominant-baseline="central" fill="#fff" opacity="0.85">VS</text>`),

  // Three owned blocks of balls.
  cutthroat: frame(`
    ${ball(26, 28, '#ffcf2e', '', 6)}${ball(40, 28, '#ffcf2e', '', 6)}
    ${ball(26, 52, '#8b4bd8', '', 6)}${ball(40, 52, '#8b4bd8', '', 6)}
    ${ball(80, 40, '#17a85a', '', 6)}${ball(94, 40, '#17a85a', '', 6)}
    <path d="M58 22 L70 40 L58 58" fill="none" stroke="#fff" stroke-width="3"
          stroke-linecap="round" stroke-linejoin="round" opacity="0.8"/>`),

  // Lives as hearts over a lone ball.
  killer: frame(`
    ${ball(60, 50, '#f03a2e', '', 10)}
    <g fill="#ff5c5c" stroke="${INK}" stroke-width="1.2">
      <path d="M34 22c-3-4-9-2-9 3 0 5 9 10 9 10s9-5 9-10c0-5-6-7-9-3z"/>
      <path d="M60 20c-3-4-9-2-9 3 0 5 9 10 9 10s9-5 9-10c0-5-6-7-9-3z"/>
      <path d="M86 22c-3-4-9-2-9 3 0 5 9 10 9 10s9-5 9-10c0-5-6-7-9-3z"/>
    </g>`),

  // A numbered run, lowest first.
  rotation: frame(`
    ${ball(28, 40, '#ffcf2e', '1', 7)}
    ${ball(48, 40, '#2a6ee0', '2', 7)}
    ${ball(68, 40, '#f03a2e', '3', 7)}
    ${ball(90, 40, '#8b4bd8', '4', 7)}
    <path d="M20 58 H100" stroke="#fff" stroke-width="2" opacity="0.35" stroke-dasharray="4 4"/>`),

  // Cue lined up on a lone ball with an aim line.
  sandbox: frame(`
    <path d="M18 62 L58 34" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>
    <path d="M18 62 L58 34" stroke="${RAIL}" stroke-width="4" stroke-linecap="round"/>
    ${ball(66, 30, '#f6f2e6', '', 8)}
    <path d="M74 26 H104" stroke="#fff" stroke-width="2" stroke-dasharray="5 4" opacity="0.7"/>
    ${ball(100, 52, '#17a85a', '', 7)}`),
};

export function modeArtSvg(mode: GameMode): string {
  return ART[mode] ?? ART.classic;
}
