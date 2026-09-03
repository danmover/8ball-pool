import { modeDescriptor, topRivals, framesAgainst, type GameMode } from '@8ball/shared';
import { getProfile } from '../profile/profile';
import { navigate } from '../router';
import { bindPageShell, emptyStateHtml, pageShellHtml } from './pageShell';

/**
 * The numbers, honestly.
 *
 * Everything here is derived from what was actually recorded rather than from anything
 * flattering — a pot rate is pots over shots, and if that reads 31% then 31% is what it says.
 * The one rule this page follows is that a statistic with no data behind it is shown as "—"
 * rather than as zero: "0% pot rate" and "no shots recorded yet" mean very different things,
 * and only one of them is true for a new player.
 */

function pct(numerator: number, denominator: number): string {
  if (denominator <= 0) return '—';
  return `${Math.round((numerator / denominator) * 100)}%`;
}

function num(value: number | undefined, suffix = ''): string {
  return value && value > 0 ? `${value}${suffix}` : '—';
}

/** The mode played most, or null when nothing has been played. */
function favouriteMode(modeFrames: Record<string, number>): { mode: string; frames: number } | null {
  const entries = Object.entries(modeFrames);
  if (entries.length === 0) return null;
  const [mode, frames] = entries.sort((a, b) => b[1] - a[1])[0];
  return { mode, frames };
}

export function renderStatsPage(root: HTMLElement): () => void {
  function draw(): void {
    const profile = getProfile();
    const stats = profile.stats;
    const history = profile.history;
    const rivals = profile.rivals ?? {};

    const shots = history?.shots ?? 0;
    const fave = favouriteMode(history?.modeFrames ?? {});
    const deciders = (history?.decidersWon ?? 0) + (history?.decidersLost ?? 0);

    const cards: { label: string; value: string; note?: string; wide?: boolean }[] = [
      {
        label: 'Pot rate',
        value: pct(stats.pots, shots),
        note: shots > 0 ? `${stats.pots} potted in ${shots} shots` : 'no shots recorded yet',
      },
      {
        label: 'Frames won',
        value: pct(stats.wins, stats.games),
        note: stats.games > 0 ? `${stats.wins} of ${stats.games}` : 'no frames yet',
      },
      { label: 'Best combo', value: num(stats.bestCombo, '×'), note: 'balls in one shot' },
      {
        label: 'Longest clearance',
        value: num(history?.longestClearance),
        note: 'balls in one visit',
      },
      {
        label: 'Win streak',
        value: num(profile.feats?.bestWinStreak),
        note:
          profile.feats && profile.feats.winStreak > 0
            ? `${profile.feats.winStreak} running now`
            : 'best ever',
      },
      {
        // Everyone *starts* at 1000, so showing it before a single frame would be presenting
        // the baseline as a measurement. Same rule as every other card here.
        label: 'Rating',
        value: profile.rating && stats.games > 0 ? String(Math.round(profile.rating)) : '—',
        note: stats.games > 0 ? 'Elo against the bots' : 'play a frame to get one',
      },
      {
        label: 'Favourite mode',
        value: fave ? modeDescriptor(fave.mode as GameMode).name : '—',
        note: fave ? `${fave.frames} frames` : 'nothing played yet',
        // A mode name is words, not a number, and needs to be set smaller to fit its card.
        wide: true,
      },
      {
        label: 'Deciders',
        value: deciders > 0 ? `${history!.decidersWon}–${history!.decidersLost}` : '—',
        note: 'last frame of a match',
      },
    ];

    /*
     * A row per rival, marked up as a definition list rather than a table row.
     *
     * It was a `<table>`, which is honest about what it is but cannot reflow — below about
     * 600px the four columns squeezed into an unreadable stack of wrapped words. Each rival is
     * one record with four fields, and a row of labelled cells says that at any width.
     */
    const rivalRows = topRivals(rivals)
      .map((r) => {
        const played = framesAgainst(r);
        const ahead = r.wins > r.losses ? 'ahead' : r.wins < r.losses ? 'behind' : 'level';
        return `
          <li class="rival-row rival-${ahead}">
            <span class="rival-name">${r.name}</span>
            <span class="rival-cell rival-record"><i>Record</i><b>${r.wins}–${r.losses}</b></span>
            <span class="rival-cell"><i>Win rate</i><b>${pct(r.wins, played)}</b></span>
            <span class="rival-cell"><i>Last played</i><b>${r.lastPlayed}</b></span>
          </li>`;
      })
      .join('');

    // Says how much the numbers below are worth. "31 frames" and "no frames yet" are the
    // difference between a statistic and a placeholder, and the page already makes that
    // distinction card by card — the header should make it once, up front.
    const subtitle =
      stats.games > 0
        ? `${stats.games} ${stats.games === 1 ? 'frame' : 'frames'} played${shots > 0 ? ` · ${shots} shots taken` : ''}`
        : 'Nothing recorded yet — play a frame and this fills in';

    root.innerHTML = `
      <div class="page stats-page">
        ${pageShellHtml({ title: 'Your numbers', subtitle })}

        <div class="stat-grid">
          ${cards
            .map(
              (c, i) => `
            <div class="stat-card" style="--stagger:${i}">
              <span class="stat-value${c.wide ? ' text' : ''}">${c.value}</span>
              <span class="stat-label">${c.label}</span>
              ${c.note ? `<span class="stat-note">${c.note}</span>` : ''}
            </div>`
            )
            .join('')}
        </div>

        <section class="rivals-section">
          <h2>Rivals</h2>
          ${
            rivalRows
              ? `<ul class="rivals-list">${rivalRows}</ul>`
              : emptyStateHtml({
                  icon: 'target',
                  title: 'No rivals yet',
                  body: 'Play somebody more than once and they turn up here, with the score between you.',
                  action: { id: 'findGame', label: 'Find a game' },
                })
          }
        </section>
      </div>`;

    bindPageShell(root);
    root.querySelector('#findGame')?.addEventListener('click', () => navigate('/online'));
  }

  draw();
  return () => {
    root.innerHTML = '';
  };
}
