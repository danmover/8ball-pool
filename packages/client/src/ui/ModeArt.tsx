import type { JSX } from 'preact';
import type { GameMode } from '@8ball/shared';

/** A small illustrated badge for each mode: a coloured tile with the mode's signature. */

const TILES: Record<GameMode, [string, string]> = {
  eightball: ['#23a468', '#0b4a2e'],
  nineball: ['#3a86f0', '#10306e'],
  killer: ['#f0505a', '#5e0f1c'],
  power: ['#9c5cff', '#2f1076'],
  practice: ['#2ed3c3', '#0b5048'],
  timeattack: ['#ffb640', '#7a3d05'],
  trickshot: ['#ff5fa2', '#6b0e3c'],
};

function Ball({ x, y, r, color, stripe, n, ink = '#111' }: { x: number; y: number; r: number; color: string; stripe?: boolean; n?: number; ink?: string }): JSX.Element {
  const id = `ma${x}${y}${n}`;
  return (
    <g>
      <defs>
        <radialGradient id={`${id}g`} cx="35%" cy="30%" r="75%">
          <stop offset="0" stop-color="#fff" stop-opacity="0.8" />
          <stop offset="0.3" stop-color="#fff" stop-opacity="0.08" />
          <stop offset="1" stop-color="#000" stop-opacity="0.45" />
        </radialGradient>
        <clipPath id={`${id}c`}>
          <circle cx={x} cy={y} r={r} />
        </clipPath>
      </defs>
      <g clip-path={`url(#${id}c)`}>
        <rect x={x - r} y={y - r} width={r * 2} height={r * 2} fill={stripe ? '#f7f2e6' : color} />
        {stripe && <rect x={x - r} y={y - r * 0.45} width={r * 2} height={r * 0.9} fill={color} />}
        {n !== undefined && <circle cx={x} cy={y} r={r * 0.42} fill="#f7f2e6" />}
        {n !== undefined && (
          <text x={x} y={y + r * 0.2} text-anchor="middle" font-size={r * 0.6} font-weight="800" fill={ink} font-family="Outfit Variable, sans-serif">
            {n}
          </text>
        )}
        <circle cx={x} cy={y} r={r} fill={`url(#${id}g)`} />
      </g>
    </g>
  );
}

export function ModeArt({ mode, size = 56 }: { mode: GameMode; size?: number }): JSX.Element {
  const [a, b] = TILES[mode];
  const gid = `mt-${mode}`;
  return (
    <svg class="mode-art" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color={a} />
          <stop offset="1" stop-color={b} />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="62" height="62" rx="16" fill={`url(#${gid})`} />
      <rect x="1" y="1" width="62" height="62" rx="16" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="1.5" />
      {mode === 'eightball' && (
        <>
          <path d="M14 48 L32 17 L50 48 Z" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="2.5" stroke-linejoin="round" />
          <Ball x={32} y={38} r={12} color="#111" n={8} />
        </>
      )}
      {mode === 'nineball' && (
        <>
          <path d="M32 12 L50 32 L32 52 L14 32 Z" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="2.5" stroke-linejoin="round" />
          <Ball x={32} y={32} r={12} color="#f2c21b" stripe n={9} />
        </>
      )}
      {mode === 'killer' && (
        <>
          <Ball x={32} y={36} r={12} color="#d6262b" n={3} />
          {[18, 32, 46].map((x) => (
            <text x={x} y="20" text-anchor="middle" font-size="12" fill="#fff" opacity="0.9">
              ♥
            </text>
          ))}
        </>
      )}
      {mode === 'power' && (
        <>
          <circle cx="32" cy="32" r="18" fill="rgba(255,255,255,0.1)" stroke="rgba(255,255,255,0.5)" stroke-width="2" />
          <path d="M35 14 L22 35 H31 L28 50 L42 28 H33 Z" fill="#ffe27a" stroke="#fff4c2" stroke-width="1.2" stroke-linejoin="round" />
        </>
      )}
      {mode === 'practice' && (
        <>
          <circle cx="32" cy="32" r="18" fill="none" stroke="rgba(255,255,255,0.45)" stroke-width="2" />
          <circle cx="32" cy="32" r="9" fill="none" stroke="rgba(255,255,255,0.45)" stroke-width="2" />
          <Ball x={32} y={32} r={6} color="#f7f2e6" />
        </>
      )}
      {mode === 'timeattack' && (
        <>
          <circle cx="32" cy="35" r="16" fill="rgba(0,0,0,0.2)" stroke="#fff" stroke-width="2.5" />
          <path d="M32 35 L32 25 M32 35 L39 39" stroke="#fff" stroke-width="2.5" stroke-linecap="round" />
          <rect x="28" y="12" width="8" height="5" rx="1.5" fill="#fff" />
        </>
      )}
      {mode === 'trickshot' && (
        <>
          <path d="M14 46 C 20 18, 44 18, 48 40" fill="none" stroke="rgba(255,255,255,0.7)" stroke-width="2.5" stroke-dasharray="4 4" stroke-linecap="round" />
          <Ball x={16} y={46} r={6} color="#f7f2e6" />
          <Ball x={48} y={40} r={7} color="#5b2a86" n={4} />
        </>
      )}
    </svg>
  );
}
