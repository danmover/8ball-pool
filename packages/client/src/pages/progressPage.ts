import {
  ACHIEVEMENTS,
  cosmeticById,
  seasonKey,
  seasonTrack,
  weekKey,
  type Achievement,
} from '@8ball/shared';
import { getProfile } from '../profile/profile';
import {
  achievementStats,
  checkAchievements,
  claimMission,
  claimSeasonTier,
  seasonState,
  weeklyMissions,
} from '../profile/progression';
import { cosmeticPreviewHtml } from '../profile/cosmeticPreview';
import { icon } from '../render/icons';
import { goBack, navigate } from '../router';
import { mountResumeStrip } from './pageShell';

/**
 * Where progress is actually visible.
 *
 * Achievements, weekly missions and the season track were all running and awarding before this
 * screen existed, which meant XP and cosmetics were arriving with no explanation. A reward
 * system nobody can see is just a number going up.
 */
export function renderProgressPage(root: HTMLElement): () => void {
  type Tab = 'achievements' | 'missions' | 'season';
  let tab: Tab = 'achievements';

  // Catch anything earned since the last check — including feats done before an achievement
  // existed — so opening this page never shows a locked card you clearly already deserve.
  checkAchievements();

  function draw(): void {
    const profile = getProfile();
    const earned = new Set(profile.achievements ?? []);

    root.innerHTML = `
      <div class="progress-page">
        <header class="progress-head">
          <button class="icon-btn" id="backBtn" title="Back">${icon('back')}</button>
          <h1>Progress</h1>
          <div class="progress-rating" title="Elo against the computer opponents">
            <b>${profile.rating ?? 1000}</b><span>rating</span>
          </div>
        </header>

        <div class="settings-tabs">
          ${(
            [
              ['achievements', `Achievements ${earned.size}/${ACHIEVEMENTS.length}`],
              ['missions', 'This week'],
              ['season', 'Season'],
            ] as [Tab, string][]
          )
            .map(
              ([id, label]) =>
                `<button class="settings-tab${id === tab ? ' active' : ''}" data-tab="${id}">${label}</button>`
            )
            .join('')}
        </div>

        <div class="progress-body">${
          tab === 'achievements' ? achievementsPanel() : tab === 'missions' ? missionsPanel() : seasonPanel()
        }</div>
      </div>`;

    root.querySelector('#backBtn')!.addEventListener('click', () => goBack());
    mountResumeStrip(root);
    root.querySelectorAll<HTMLElement>('.settings-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        tab = btn.dataset.tab as Tab;
        draw();
      });
    });
    root.querySelectorAll<HTMLButtonElement>('[data-mission]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (claimMission(btn.dataset.mission!)) draw();
      });
    });
    root.querySelectorAll<HTMLButtonElement>('[data-tier]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (claimSeasonTier(Number(btn.dataset.tier))) draw();
      });
    });
  }

  function achievementsPanel(): string {
    const profile = getProfile();
    const earned = new Set(profile.achievements ?? []);
    const stats = achievementStats(profile);

    // Grouped by category, and within each the earned ones first — a wall of locked cards is
    // discouraging, and what you've done should be the thing you see.
    const groups: [string, Achievement[]][] = [
      ['Potting', ACHIEVEMENTS.filter((a) => a.category === 'potting')],
      ['Skill', ACHIEVEMENTS.filter((a) => a.category === 'skill')],
      ['Winning', ACHIEVEMENTS.filter((a) => a.category === 'grind')],
      ['Career', ACHIEVEMENTS.filter((a) => a.category === 'career')],
      ['Collection', ACHIEVEMENTS.filter((a) => a.category === 'collection')],
    ];

    return groups
      .map(
        ([name, list]) => `
      <section class="ach-group">
        <h2>${name}</h2>
        <div class="ach-grid">
          ${list
            .slice()
            .sort((a, b) => Number(earned.has(b.id)) - Number(earned.has(a.id)))
            .map((a) => {
              const done = earned.has(a.id);
              const pct = Math.round(a.progress(stats) * 100);
              return `
              <div class="ach-card${done ? ' earned' : ''}">
                <div class="ach-top">
                  <span class="ach-name">${a.name}</span>
                  ${done ? icon('check', { size: 15 }) : `<span class="ach-pct">${pct}%</span>`}
                </div>
                <p class="ach-blurb">${a.blurb}</p>
                ${
                  done
                    ? `<div class="ach-reward">+${a.xp} XP · ${a.chalk} chalk</div>`
                    : `<div class="ach-bar"><div style="width:${pct}%"></div></div>`
                }
              </div>`;
            })
            .join('')}
        </div>
      </section>`
      )
      .join('');
  }

  function missionsPanel(): string {
    const missions = weeklyMissions();
    return `
      <p class="panel-note">New missions every Monday. Week ${weekKey()}.</p>
      <div class="mission-list">
        ${missions
          .map(({ mission, progress, claimed }) => {
            const done = progress >= mission.target;
            return `
            <div class="mission-card${claimed ? ' claimed' : done ? ' ready' : ''}">
              <div class="mission-text">
                <b>${mission.text}</b>
                <small>+${mission.xp} XP · ${mission.chalk} chalk</small>
              </div>
              <div class="mission-bar">
                <div style="width:${Math.round((progress / mission.target) * 100)}%"></div>
                <span>${progress} / ${mission.target}</span>
              </div>
              <button data-mission="${mission.id}" ${done && !claimed ? '' : 'disabled'}>
                ${claimed ? 'Claimed' : done ? 'Claim' : 'In progress'}
              </button>
            </div>`;
          })
          .join('')}
      </div>`;
  }

  function seasonPanel(): string {
    const state = seasonState();
    const track = seasonTrack();
    const claimed = new Set(state.claimed);

    return `
      <p class="panel-note">
        Season ${seasonKey()} · ${state.xp.toLocaleString()} season XP · tier ${state.tier} of ${track.length}
      </p>
      <div class="season-track">
        ${track
          .map((t) => {
            const reached = state.tier >= t.tier;
            const taken = claimed.has(t.tier);
            const item = t.reward.kind === 'cosmetic' ? cosmeticById(t.reward.id) : null;
            const label =
              t.reward.kind === 'chalk'
                ? `${t.reward.amount} chalk`
                : t.reward.kind === 'spin'
                  ? 'A spin'
                  : (item?.name ?? 'Cosmetic');
            return `
            <div class="season-tier${reached ? ' reached' : ''}${taken ? ' taken' : ''}">
              <div class="tier-num">${t.tier}</div>
              <div class="tier-art">${
                item
                  ? cosmeticPreviewHtml(item, 46)
                  : icon(t.reward.kind === 'spin' ? 'wheel' : 'chalk', { size: 26 })
              }</div>
              <div class="tier-label">${label}</div>
              <div class="tier-xp">${t.xp.toLocaleString()} XP</div>
              <button data-tier="${t.tier}" ${reached && !taken ? '' : 'disabled'}>
                ${taken ? 'Taken' : reached ? 'Claim' : 'Locked'}
              </button>
            </div>`;
          })
          .join('')}
      </div>`;
  }

  draw();
  return () => {};
}
