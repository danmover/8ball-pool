import { challengeSets, type Challenge } from '@8ball/shared';
import { getSocket } from '../net/socket';
import { saveSession } from '../settings/settingsStore';
import { challengeStars, equippedLoadout, getProfile } from '../profile/profile';
import { icon } from '../render/icons';
import { navigate } from '../router';
import * as sfx from '../render/sfx';

/**
 * The trick-shot browser.
 *
 * Sets unlock in order — you need at least one star in the previous set before the next
 * opens, so the teaching sets can't be skipped past. Within a set everything is available,
 * because being stuck on one puzzle shouldn't block the rest.
 */
export function renderChallengesPage(root: HTMLElement): () => void {
  const sets = challengeSets();

  /** A set opens once the one before it has any stars at all. */
  function setUnlocked(index: number): boolean {
    if (index === 0) return true;
    return sets[index - 1].challenges.some((c) => challengeStars(c.id) > 0);
  }

  function starRow(earned: number): string {
    return `<span class="star-row">${[1, 2, 3]
      .map(
        (n) =>
          `<span class="star${n <= earned ? ' earned' : ''}">${icon('star', { size: 15 })}</span>`
      )
      .join('')}</span>`;
  }

  function card(challenge: Challenge, unlocked: boolean): string {
    const earned = challengeStars(challenge.id);
    return `
      <button class="challenge-card${unlocked ? '' : ' locked'}${earned ? ' cleared' : ''}"
              data-challenge="${challenge.id}" ${unlocked ? '' : 'disabled'}>
        <span class="challenge-top">
          <span class="challenge-name">${challenge.name}</span>
          ${starRow(earned)}
        </span>
        <span class="challenge-brief">${challenge.brief}</span>
        <span class="challenge-meta">
          <span>${icon('target', { size: 13 })} ${challenge.shotLimit} shots</span>
          <span>${icon('star', { size: 13 })} ${challenge.reward.xp} XP</span>
        </span>
        ${unlocked ? '' : `<span class="challenge-lock">${icon('lock', { size: 16 })}</span>`}
      </button>`;
  }

  function draw(): void {
    const total = sets.flatMap((s) => s.challenges).reduce((sum, c) => sum + challengeStars(c.id), 0);
    const possible = sets.flatMap((s) => s.challenges).length * 3;

    root.innerHTML = `
      <div class="profile-page challenges-page">
        <div class="profile-top">
          <button class="icon-btn" id="backBtn" title="Back">${icon('back', { size: 20 })}</button>
          <h1>Trick Shots</h1>
          <div class="wallet">
            <span class="wallet-chip">${icon('star', { size: 18 })} ${total} / ${possible}</span>
          </div>
        </div>

        <p class="challenges-intro">
          Hand-built puzzles built around cue ball control. Fewer shots means more stars.
        </p>

        ${sets
          .map(
            (set, i) => `
          <section class="challenge-set${setUnlocked(i) ? '' : ' locked'}">
            <h2>${set.name}${
              setUnlocked(i) ? '' : ` <span class="set-lock">Earn a star in the previous set</span>`
            }</h2>
            <div class="challenge-grid">
              ${set.challenges.map((c) => card(c, setUnlocked(i))).join('')}
            </div>
          </section>`
          )
          .join('')}
      </div>`;

    root.querySelector('#backBtn')!.addEventListener('click', () => navigate('/'));

    root.querySelectorAll<HTMLButtonElement>('[data-challenge]').forEach((btn) => {
      btn.addEventListener('click', () => start(btn.dataset.challenge!));
    });
  }

  /**
   * Challenges run in an ordinary room, so the whole server loop — physics, state broadcast,
   * ball-in-hand — works without a special case. The host claims seat one and the room is
   * switched into challenge mode in a single round trip.
   */
  function start(challengeId: string): void {
    sfx.unlockAudio();
    const socket = getSocket();
    socket.emit('hostCreateRoom', { hostName: getProfile().displayName || 'Player' }, (res) => {
      saveSession(res.code, 'host', { token: res.token });
      socket.emit('hostClaimSeat', {
        seat: 'p1',
        loadout: equippedLoadout(),
        name: getProfile().displayName,
      });
      socket.emit('hostStartChallenge', { challengeId });
      sessionStorage.setItem(`8ball:challenge:${res.code}`, challengeId);
      navigate(`/table/${res.code}`);
    });
  }

  draw();
  return () => {
    root.innerHTML = '';
  };
}
