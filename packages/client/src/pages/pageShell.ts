import { icon } from '../render/icons';
import { backTarget, goBack, navigate } from '../router';
import { activeTable } from '../net/activeTable';

/**
 * The frame every menu screen sits in.
 *
 * Four pages each hand-rolled the same header — a back button, a title, sometimes a subtitle —
 * and all four hard-coded `navigate('/')`, which is what made "back" mean the home screen
 * wherever you had come from.
 *
 * It also carries the resume strip, because the place you most need to be told a game is still
 * running is the screen you wandered off to.
 */

export interface PageShellOptions {
  title: string;
  subtitle?: string;
  /** Markup for the right-hand end of the header — a wallet, a count, a filter. */
  actions?: string;
  /** Where back goes when this page was opened cold, with no history behind it. */
  backFallback?: string;
  /** Suppresses the resume strip on pages that are themselves about a table. */
  hideResume?: boolean;
}

/** A human name for a route, so "back" can say where it is going. */
export function routeName(path: string): string {
  if (path === '/') return 'Menu';
  if (path === '/online') return 'Online';
  if (path === '/profile') return 'Locker';
  if (path === '/career') return 'Career';
  if (path === '/progress') return 'Progress';
  if (path === '/stats') return 'Stats';
  if (path === '/challenges') return 'Trick Shots';
  if (/^\/(table|t|play)\//.test(path)) return 'the table';
  return 'Back';
}

export function pageShellHtml(opts: PageShellOptions): string {
  const back = routeName(backTarget(opts.backFallback ?? '/'));
  const table = opts.hideResume ? null : activeTable();

  return `
    ${table ? resumeStripHtml(table.code) : ''}
    <header class="page-head">
      <button class="icon-btn back-btn" id="shellBack" title="Back to ${back}">
        ${icon('back', { size: 20 })}
      </button>
      <div class="page-title">
        <h1>${opts.title}</h1>
        ${opts.subtitle ? `<p class="tagline">${opts.subtitle}</p>` : ''}
      </div>
      ${opts.actions ? `<div class="page-actions">${opts.actions}</div>` : ''}
    </header>`;
}

/**
 * "You are still in a frame."
 *
 * Deliberately a strip along the top rather than a toast: a toast is for something that just
 * happened, and this is a state you are in until you do something about it.
 */
function resumeStripHtml(code: string): string {
  return `
    <button class="resume-strip" id="shellResume">
      <span class="resume-dot"></span>
      <span class="resume-text">You are still at table <b>${code}</b></span>
      <span class="resume-go">Back to the table ${icon('back', { size: 14 })}</span>
    </button>`;
}

/**
 * Puts the resume strip on a page that has not been converted to the shell yet.
 *
 * The strip is the fix for the thing that actually loses people, and it should not wait on
 * every screen being re-laid-out first. Prepends rather than replacing anything, so a page
 * keeps whatever header it already has.
 */
export function mountResumeStrip(root: HTMLElement): void {
  const table = activeTable();
  if (!table) return;
  const host = root.firstElementChild ?? root;
  const el = document.createElement('div');
  el.innerHTML = resumeStripHtml(table.code);
  const strip = el.firstElementChild as HTMLElement | null;
  if (!strip) return;
  strip.addEventListener('click', () => navigate(table.path));
  host.prepend(strip);
}

/** Wires the shell's buttons. Call once, after the markup is in the DOM. */
export function bindPageShell(root: HTMLElement, opts: PageShellOptions = { title: '' }): void {
  root.querySelector('#shellBack')?.addEventListener('click', () => goBack(opts.backFallback ?? '/'));
  const resume = root.querySelector<HTMLElement>('#shellResume');
  if (resume) {
    const table = activeTable();
    resume.addEventListener('click', () => {
      if (table) navigate(table.path);
    });
  }
}
