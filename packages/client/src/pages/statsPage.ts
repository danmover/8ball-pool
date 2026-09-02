import { modeDescriptor, topRivals, framesAgainst, type GameMode } from '@8ball/shared';
import { getProfile } from '../profile/profile';
import { icon } from '../render/icons';
import { goBack, navigate } from '../router';
import { mountResumeStrip } from './pageShell';

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

    const rivalRows = topRivals(rivals)
      .map((r) => {
        const played = framesAgainst(r);
        const ahead = r.wins > r.losses ? 'ahead' : r.wins < r.losses ? 'behind' : 'level';
        return `
          <tr class="rival-${ahead}">
            <td class="who">${r.name}</td>
            <td><b>${r.wins}</b>–<b>${r.losses}</b></td>
            <td>${pct(r.wins, played)}</td>
            <td class="muted">${r.lastPlayed}</td>
          </tr>`;
      })
      .join('');

    root.innerHTML = `
      <div class="page stats-page">
        <header class="page-head">
          <button class="mini secondary" id="backBtn">${icon('home', { size: 14 })} Back</button>
          <h1>Your numbers</h1>
        </header>

        <div class="stat-grid">
          ${cards
            .map(
              (c) => `
            <div class="stat-card">
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
              ? `<table class="rivals-table">
                   <thead><tr><th>Who</th><th>Record</th><th>Win rate</th><th>Last played</th></tr></thead>
                   <tbody>${rivalRows}</tbody>
                 </table>`
              : `<p class="muted">Nobody yet. Play someone more than once and they'll show up here.</p>`
          }
        </section>
      </div>`;

    root.querySelector('#backBtn')?.addEventListener('click', () => goBack());
    mountResumeStrip(root);
  }

  draw();
  return () => {
    root.innerHTML = '';
  };
}
