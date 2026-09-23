import { icon } from '../render/icons';

/**
 * What you get, drawn the same way everywhere.
 *
 * Rewards were written out as plain text — `+250 XP · 120 chalk` — in four different places,
 * and on the achievement cards they were only printed *after* you had earned the thing. So the
 * one question a progression screen exists to answer, "what do I get for this", was answered
 * either in grey six-point type or not at all.
 *
 * A chip per currency, with its own colour and mark, in one module so a reward looks identical
 * on the home screen, the mission list, the achievement grid and the season track. That
 * consistency is most of what makes them read as *rewards* rather than as annotations.
 */

export interface Reward {
  xp?: number;
  chalk?: number;
  /** Case keys. */
  spins?: number;
  /** A cosmetic, named. */
  item?: string;
}

function n(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k` : String(value);
}

/**
 * @param muted draws them dimmed, for something not yet earned — still legible, plainly not
 *              yours yet. Greying them out entirely was the old behaviour and it is why nobody
 *              could tell what an unearned achievement was worth.
 */
export function rewardChips(reward: Reward, muted = false): string {
  const chips: string[] = [];
  if (reward.xp) {
    chips.push(`<span class="rw rw-xp">${icon('star', { size: 11 })}${n(reward.xp)} XP</span>`);
  }
  if (reward.chalk) {
    chips.push(`<span class="rw rw-chalk">${icon('chalk', { size: 11 })}${n(reward.chalk)}</span>`);
  }
  if (reward.spins) {
    chips.push(
      `<span class="rw rw-key">${icon('wheel', { size: 11 })}${reward.spins} ${
        reward.spins === 1 ? 'key' : 'keys'
      }</span>`
    );
  }
  if (reward.item) {
    chips.push(`<span class="rw rw-item">${icon('locker', { size: 11 })}${reward.item}</span>`);
  }
  if (chips.length === 0) return '';
  return `<div class="rw-row${muted ? ' muted' : ''}">${chips.join('')}</div>`;
}

/**
 * The moment of collection.
 *
 * Claiming used to be a button going from "Claim" to "Claimed" and a number changing somewhere
 * off screen. The reward is the *point* of a mission, so it gets a beat of its own: the chips
 * lift off the card and fade, which is small, cheap, and the difference between being given
 * something and having a flag flipped.
 *
 * Respects reduce-motion by simply not running — the claim itself has already happened, so
 * nothing is lost by skipping the flourish.
 */
export function flyReward(anchor: HTMLElement, reward: Reward): void {
  if (document.body.classList.contains('reduce-motion')) return;
  const chips = rewardChips(reward);
  if (!chips) return;

  const rect = anchor.getBoundingClientRect();
  const layer = document.createElement('div');
  layer.className = 'rw-fly';
  layer.style.left = `${rect.left + rect.width / 2}px`;
  layer.style.top = `${rect.top + rect.height / 2}px`;
  layer.innerHTML = chips;
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 1100);
}
