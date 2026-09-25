import type { JSX } from 'preact';

/**
 * A small hand-picked icon set, drawn as strokes on a 24-unit grid so every icon has the same
 * weight and corner style.
 */
const PATHS: Record<string, string> = {
  back: 'M15 18l-6-6 6-6',
  forward: 'M9 18l6-6-6-6',
  close: 'M18 6L6 18M6 6l12 12',
  settings:
    'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
  play: 'M7 4v16l13-8z',
  users: 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.9M16 3.1a4 4 0 010 7.8',
  trophy: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0V4zM17 5h3v2a3 3 0 01-3 3M7 5H4v2a3 3 0 003 3',
  target: 'M12 22a10 10 0 100-20 10 10 0 000 20zM12 18a6 6 0 100-12 6 6 0 000 12zM12 14a2 2 0 100-4 2 2 0 000 4z',
  locker: 'M3 7l9-4 9 4v10l-9 4-9-4V7zM3 7l9 4 9-4M12 11v10',
  chart: 'M3 3v18h18M7 15l4-4 3 3 5-6',
  star: 'M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  share: 'M4 12v8h16v-8M16 6l-4-4-4 4M12 2v13',
  qr: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM20 14v.01M14 20h.01M17 17h4v4h-4',
  crown: 'M2 18h20l-2-11-5 4-3-7-3 7-5-4z',
  bot: 'M12 8V4M8 4h8M5 8h14v11H5zM9 13h.01M15 13h.01M9 17h6',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  check: 'M20 6L9 17l-5-5',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 118 0v4',
  wifiOff: 'M1 1l22 22M16.7 11.1A11 11 0 0119 12.6M5 12.6a11 11 0 015.2-2.5M10.7 5.1A16 16 0 0122.6 9M1.4 9a16 16 0 014.3-2.8M8.5 16.1a6 6 0 017 0M12 20h.01',
  refresh: 'M21 12a9 9 0 11-3-6.7L21 8M21 3v5h-5',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-4',
  sound: 'M11 5L6 9H2v6h4l5 4zM15.5 8.5a5 5 0 010 7M19 5a10 10 0 010 14',
  mute: 'M11 5L6 9H2v6h4l5 4zM23 9l-6 6M17 9l6 6',
  menu: 'M3 6h18M3 12h18M3 18h18',
  chat: 'M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z',
  smile: 'M12 22a10 10 0 100-20 10 10 0 000 20zM8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01',
  flag: 'M4 22V4M4 4h13l-2 4 2 4H4',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12zM12 15a3 3 0 100-6 3 3 0 000 6z',
  bolt: 'M13 2L3 14h9l-1 8 10-12h-9z',
  clock: 'M12 22a10 10 0 100-20 10 10 0 000 20zM12 6v6l4 2',
  gift: 'M20 12v10H4V12M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z',
  sparkles: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16l.9 2.1L22 19l-2.1.9L19 22l-.9-2.1L16 19l2.1-.9z',
  home: 'M3 10l9-7 9 7v11h-6v-7H9v7H3z',
  tv: 'M3 5h18v12H3zM8 21h8M12 17v4',
  phone: 'M7 2h10v20H7zM11 18h2',
  link: 'M10 13a5 5 0 007.5.5l3-3a5 5 0 00-7-7l-1.7 1.7M14 11a5 5 0 00-7.5-.5l-3 3a5 5 0 007 7l1.7-1.7',
  exit: 'M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9',
  globe: 'M12 22a10 10 0 100-20 10 10 0 000 20zM2 12h20M12 2a15 15 0 010 20M12 2a15 15 0 000 20',
  cue: 'M3 21L19 5M17 3l4 4',
  ball: 'M12 22a10 10 0 100-20 10 10 0 000 20zM12 15a3 3 0 100-6 3 3 0 000 6z',
  hand: 'M18 11V6a2 2 0 00-4 0v5M14 10V4a2 2 0 00-4 0v6M10 10.5V6a2 2 0 00-4 0v8a8 8 0 0016 0v-4a2 2 0 00-4 0',
  camera: 'M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2zM12 17a4 4 0 100-8 4 4 0 000 8z',
  info: 'M12 22a10 10 0 100-20 10 10 0 000 20zM12 16v-4M12 8h.01',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z',
  swap: 'M16 3l4 4-4 4M20 7H4M8 21l-4-4 4-4M4 17h16',
  /** Shot types, drawn as the cue ball's path: level, curving round, and hopping over. */
  shotLevel: 'M2 15h13M19.5 15a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0zM2 19h20',
  shotSwerve: 'M3 16c5 0 6-9 12-9M19 7a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0zM2 20h20',
  shotJump: 'M3 18C6 6 13 5 16 11M19 14a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0zM2 20h20',
  chevronDown: 'M6 9l6 6 6-6',
};

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 20,
  stroke = 2,
  class: cls,
  fill,
}: {
  name: IconName | string;
  size?: number;
  stroke?: number;
  class?: string;
  fill?: boolean;
}): JSX.Element {
  return (
    <svg
      class={`icon ${cls ?? ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill ? 'currentColor' : 'none'}
      stroke="currentColor"
      stroke-width={stroke}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name] ?? ''} />
    </svg>
  );
}
