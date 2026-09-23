import type { IconName } from '../render/icons';

/**
 * The places off the menu, and what each one looks like wherever it turns up.
 *
 * The hub's dock gave every destination its own colour — a gold locker, an orange career, a
 * pink trick-shot target — and then every page it led to threw that away: the locker opened
 * onto a green crosshatch, the career onto violet stripes, the stats onto the same stripes at
 * a different width. Pressing a gold button and landing somewhere that was not gold is the
 * thing that made the menus feel like six apps.
 *
 * One table, read by the dock and by the page header, so the colour you pressed is the colour
 * of the room you arrive in.
 */
export type Section = 'locker' | 'career' | 'challenges' | 'progress' | 'stats' | 'online' | 'settings';

export interface SectionIdentity {
  label: string;
  icon: IconName;
  accent: string;
}

export const SECTIONS: Record<Section, SectionIdentity> = {
  locker: { label: 'Locker', icon: 'locker', accent: '#ffc531' },
  career: { label: 'Career', icon: 'trophy', accent: '#ff8a1f' },
  challenges: { label: 'Trick Shots', icon: 'target', accent: '#ff3d8b' },
  progress: { label: 'Progress', icon: 'star', accent: '#a855f7' },
  stats: { label: 'Stats', icon: 'chart', accent: '#34e2b0' },
  online: { label: 'Online', icon: 'globe', accent: '#22d3ee' },
  settings: { label: 'Settings', icon: 'settings', accent: '#9ba7d8' },
};

/** The inline custom property a page root or a dock token wears. */
export function sectionStyle(section: Section): string {
  return `--page-accent: ${SECTIONS[section].accent}`;
}
