import {
  CAREER,
  careerNext,
  careerProgress,
  careerUnlocked,
  cosmeticById,
  type CareerOpponent,
} from '@8ball/shared';
import { getProfile } from '../profile/profile';
import { getSocket } from '../net/socket';
import { navigate } from '../router';
import { icon } from '../render/icons';
import { cosmeticPreviewHtml } from '../profile/cosmeticPreview';
import { loadSettings, saveSession, saveSettings } from '../settings/settingsStore';

/**
 * The career ladder.
 *
 * Reuses the solo-play path exactly as it stands: this hosts a room, seats the player and a bot
 * of the right tier, and hands the table over. The only new idea is `?career=<id>` on the URL,
 * which is how the table knows a win here counts toward the ladder — a query parameter rather
 * than a new socket concept, because the server has no reason to know what a career is.
 */
export function renderCareerPage(root: HTMLElement): () => void {
  const socket = getSocket();
  const settings = loadSettings();
  let launching = false;

  function draw(): void {
    const profile = getProfile();
    const beaten = new Set(profile.careerBeaten ?? []);
    const unlocked = new Set(careerUnlocked(profile.careerBeaten ?? []));
    const progress = careerProgress(profile.careerBeaten ?? []);
    const next = careerNext(profile.careerBeaten ?? []);

    root.innerHTML = `
      <div class="career-page">
        <header class="career-head">
          <button class="icon-btn" id="backBtn" title="Back">${icon('back')}</button>
          <div>
            <h1>Career</h1>
            <p class="tagline">${
              next
                ? `Next up: ${next.name} at the ${next.venue} table`
                : 'You have beaten everyone. There is nobody left.'
            }</p>
          </div>
          <div class="career-progress">
            <b>${progress.beaten}</b><span>/ ${progress.total}</span>
          </div>
        </header>

        ${CAREER.map((chapter) => {
          const cleared = chapter.opponents.every((o) => beaten.has(o.id));
          const reachable = chapter.opponents.some((o) => unlocked.has(o.id));
          return `
          <section class="career-chapter${cleared ? ' cleared' : ''}${reachable ? '' : ' locked'}">
            <div class="chapter-head">
              <h2>${chapter.name}${cleared ? ` ${icon('check', { size: 16 })}` : ''}</h2>
              <p>${reachable ? chapter.blurb : 'Beat the chapter before this one.'}</p>
            </div>
            <div class="opponent-row">
              ${chapter.opponents.map((o) => opponentCard(o, beaten, unlocked)).join('')}
            </div>
          </section>`;
        }).join('')}
      </div>`;

    root.querySelector('#backBtn')!.addEventListener('click', () => navigate('/'));
    root.querySelectorAll<HTMLButtonElement>('[data-opponent]').forEach((btn) => {
      btn.addEventListener('click', () => play(btn.dataset.opponent!));
    });
  }

  function opponentCard(o: CareerOpponent, beaten: Set<string>, unlocked: Set<string>): string {
    const done = beaten.has(o.id);
    const open = unlocked.has(o.id);
    const reward = cosmeticById(o.reward);

    return `
      <button class="opponent-card${done ? ' beaten' : ''}${open ? '' : ' locked'}"
              data-opponent="${o.id}" ${open ? '' : 'disabled'}>
        <div class="opponent-top">
          <span class="opponent-name">${o.name}</span>
          ${done ? `<span class="opponent-done">${icon('trophy', { size: 15 })}</span>` : ''}
        </div>
        ${open ? `<p class="opponent-taunt">“${o.taunt}”</p>` : '<p class="opponent-taunt">Locked</p>'}
        <div class="opponent-meta">
          <span>${o.mode === 'classic' ? '8-Ball' : o.mode === 'nineball' ? '9-Ball' : 'Rotation'}</span>
          <span>${o.target === 1 ? 'One frame' : `First to ${o.target}`}</span>
          <span class="rules-chip">${o.ruleSet}</span>
        </div>
        <div class="opponent-reward">
          <span class="reward-art">${
            open && reward ? cosmeticPreviewHtml(reward, 44) : ''
          }</span>
          <span class="reward-name">${done ? 'Won' : (reward?.name ?? o.reward)}</span>
        </div>
      </button>`;
  }

  /**
   * Hosts a table set up for this opponent and goes to it.
   *
   * Deliberately the *same* path solo play already uses — create the room, configure the
   * lobby, drop an autostart note in sessionStorage and navigate. Writing a second seat-claim
   * flow here would be a second thing to keep in step with the server.
   *
   * The only new idea is `?career=<id>` on the URL, which is how the table knows a win counts
   * toward the ladder. A query parameter rather than a socket concept, because the server has
   * no reason to know what a career is.
   */
  function play(opponentId: string): void {
    if (launching) return;
    const opponent = CAREER.flatMap((c) => c.opponents).find((o) => o.id === opponentId);
    if (!opponent) return;
    launching = true;

    socket.emit('hostCreateRoom', { hostName: getProfile().displayName || 'Player' }, (res) => {
      saveSession(res.code, 'host', { token: res.token });
      socket.emit('hostUpdateLobby', {
        mode: opponent.mode,
        ruleSet: opponent.ruleSet,
        maxPlayers: 2,
        seriesTarget: opponent.target,
      });
      // You play the opponent at *their* table — the venues exist and nothing ever sent you
      // to one before.
      settings.tableTheme = opponent.venue;
      saveSettings(settings);

      sessionStorage.setItem(
        `8ball:autostart:${res.code}`,
        JSON.stringify({ solo: true, botDifficulty: opponent.difficulty })
      );
      navigate(`/table/${res.code}?career=${opponent.id}`);
    });
  }

  draw();
  return () => {};
}
