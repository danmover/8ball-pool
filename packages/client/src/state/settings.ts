import { signal, effect } from '@preact/signals';
import { readJson, writeJson } from './storage';

export type Quality = 'low' | 'medium' | 'high';
export type GuidePref = 'full' | 'short' | 'off';

export interface Settings {
  sfxVolume: number;
  musicVolume: number;
  sfxOn: boolean;
  musicOn: boolean;
  haptics: boolean;
  quality: Quality;
  effects: boolean;
  reduceMotion: boolean;
  /** The aim guide you'd like; a table's own setting can only make it shorter. */
  guide: GuidePref;
  /** Swap the power bar and the ball return, for left-handed play. */
  leftHanded: boolean;
  /** Tilted "broadcast" camera instead of straight down. */
  tiltCamera: boolean;
  /** Relay server override, for self-hosting. Empty uses the site's own. */
  relayUrl: string;
}

const KEY = '8ball:v2:settings';

function detectQuality(): Quality {
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const small = Math.min(window.screen.width, window.screen.height) < 500;
  if (mem <= 2) return 'low';
  if (small || mem <= 4) return 'medium';
  return 'high';
}

export const DEFAULT_SETTINGS: Settings = {
  sfxVolume: 0.8,
  musicVolume: 0.35,
  sfxOn: true,
  musicOn: true,
  haptics: true,
  quality: 'high',
  effects: true,
  reduceMotion: false,
  guide: 'full',
  leftHanded: false,
  tiltCamera: false,
  relayUrl: '',
};

function load(): Settings {
  const saved = readJson<Partial<Settings>>(KEY);
  const base = { ...DEFAULT_SETTINGS, quality: detectQuality() };
  if (!saved) {
    base.reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    return base;
  }
  return { ...base, ...saved };
}

export const settings = signal<Settings>(load());

effect(() => {
  writeJson(KEY, settings.value);
  document.documentElement.classList.toggle('reduce-motion', settings.value.reduceMotion);
});

export function updateSettings(patch: Partial<Settings>): void {
  settings.value = { ...settings.value, ...patch };
}

export function haptic(pattern: number | number[] = 12): void {
  if (!settings.value.haptics) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* not supported */
  }
}
