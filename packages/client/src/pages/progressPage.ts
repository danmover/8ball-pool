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
import { icon, type IconName } from '../render/icons';
import { flyReward, rewardChips } from '../profile/rewards';
import * as sfx from '../render/sfx';
import { loadSettings } from '../settings/settingsStore';
import { navigate } from '../router';
import { bindPageShell, pageShellHtml } from './pageShell';
import { sectionStyle } from '../ui/sections';

/**
 * Where progress is actually visible.
 *
 * Achievements, weekly missions and the season track were all running and awarding before this
 * screen existed, which meant XP and cosmetics were arriving with no explanation. A reward
 * system nobody can see is just a number going up.
 */
/**
 * How hard an achievement is, derived from what it pays.
 *
 * The tiered achievements are generated with `xp: 120 + i * 180`, so the payout already encodes
 * the rung — no new field needed, and none that could drift out of step with the rewards. It
 * matters because "Pot 1 ball" and "Pot 10,000 balls" were rendered as the same grey card, and a
 * wall of fifty-six identical grey cards tells you nothing about where the mountain is.
 */
function tierOf(xp: number): 'bronze' | 'silver' | 'gold' | 'platinum' {
  if (xp < 220) return 'bronze';
  if (xp < 420) return 'silver';
  if (xp < 700) return 'gold';
  return 'platinum';
}

const CATEGORY_ICON: Record<Achievement['category'], IconName> = {
  potting: 'ball',
  skill: 'cue',
  grind: 'trophy',
  career: 'star',
  collection: 'locker',
};

const MISSION_ICON: Record<string, IconName> = {
  potCount: 'ball',
  winCount: 'trophy',
  multiPot: 'sparkle',
  cleanFrames: 'check',
  careerWins: 'star',
  challengeStars: 'target',
  jumpPots: 'flame',
  massePots: 'cue',
};

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
      <div class="progress-page menu-page" style="${sectionStyle('progress')}">
        ${pageShellHtml({
          section: 'progress',
          title: 'Progress',
          subtitle: `${earned.size} of ${ACHIEVEMENTS.length} achievements earned`,
          actions: `<div class="progress-rating" title="Elo against the computer opponents">
              <b>${profile.rating ?? 1000}</b><span>rating</span>
            </div>`,
        })}

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

    bindPageShell(root);
    root.querySelectorAll<HTMLElement>('.settings-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        tab = btn.dataset.tab as Tab;
        draw();
      });
    });
    /*
     * Claiming is a moment, not a state change.
     *
     * It used to be a button relabelling itself while a number moved somewhere off screen. The
     * reward is the whole point of a mission, so the chips lift off the card and a note plays —
     * then the page redraws, once the flourish has been seen rather than under it.
     */
    const volume = loadSettings().soundEnabled ? loadSettings().soundVolume : 0;
    root.querySelectorAll<HTMLButtonElement>('[data-mission]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const entry = weeklyMissions().find((m) => m.mission.id === btn.dataset.mission);
        if (!claimMission(btn.dataset.mission!)) return;
        sfx.playReveal(volume, 2);
        if (entry) flyReward(btn, { xp: entry.mission.xp, chalk: entry.mission.chalk });
        setTimeout(draw, 420);
      });
    });
    root.querySelectorAll<HTMLButtonElement>('[data-tier]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tier = seasonTrack().find((t) => t.tier === Number(btn.dataset.tier));
        if (!claimSeasonTier(Number(btn.dataset.tier))) return;
        sfx.playReveal(volume, 3);
        if (tier) {
          const item = tier.reward.kind === 'cosmetic' ? cosmeticById(tier.reward.id) : null;
          flyReward(btn, {
            chalk: tier.reward.kind === 'chalk' ? tier.reward.amount : undefined,
            spins: tier.reward.kind === 'spin' ? 1 : undefined,
            item: item?.name,
          });
        }
        setTimeout(draw, 420);
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
              const tier = tierOf(a.xp);
              return `
              <div class="ach-card tier-${tier}${done ? ' earned' : ''}">
                <span class="ach-medal">
                  ${icon(CATEGORY_ICON[a.category], { size: 18 })}
                  ${done ? `<i class="ach-tick">${icon('check', { size: 11 })}</i>` : ''}
                </span>
                <div class="ach-body">
                  <div class="ach-top">
                    <span class="ach-name">${a.name}</span>
                    <span class="ach-pct">${done ? 'Earned' : `${pct}%`}</span>
                  </div>
                  <p class="ach-blurb">${a.blurb}</p>
                  <div class="ach-bar"><div style="width:${done ? 100 : pct}%"></div></div>
                  ${rewardChips({ xp: a.xp, chalk: a.chalk }, !done)}
                </div>
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
            const pct = Math.round((progress / mission.target) * 100);
            return `
            <div class="mission-card${claimed ? ' claimed' : done ? ' ready' : ''}">
              <span class="mission-icon">${icon(MISSION_ICON[mission.kind] ?? 'target', { size: 20 })}</span>
              <div class="mission-text">
                <b>${mission.text}</b>
                ${rewardChips({ xp: mission.xp, chalk: mission.chalk }, !done)}
              </div>
              <div class="mission-bar">
                <div style="width:${pct}%"></div>
                <span>${progress} / ${mission.target}</span>
              </div>
              <button class="mini${done && !claimed ? ' claimable' : ''}" data-mission="${mission.id}"
                      ${done && !claimed ? '' : 'disabled'}>
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
                  ? '1 key'
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
              <button class="mini${reached && !taken ? ' claimable' : ''}" data-tier="${t.tier}"
                      ${reached && !taken ? '' : 'disabled'}>
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
