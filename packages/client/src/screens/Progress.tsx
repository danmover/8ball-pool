import type { JSX } from 'preact';
import {
  ALL_MISSIONS_BONUS,
  CATALOG,
  DAILY_STREAK_COINS,
  SLOT_LABELS,
  levelProgress,
  missionText,
  modeDescriptor,
  MULTIPLAYER_MODES,
} from '@8ball/shared';
import { ScreenShell } from '../app/shell';
import { Avatar, Button, Coins, ProgressBar, toast } from '../ui/kit';
import { Icon } from '../ui/Icon';
import { navigate } from '../app/router';
import {
  canClaimBonus,
  claimBonus,
  claimDaily,
  claimMission,
  dailyAvailable,
  missionProgress,
  nextStreakDay,
  profile,
  todaysMissions,
  type Progression,
} from '../state/profile';
import { coins as coinSound, levelUp } from '../audio/sfx';

function celebrate(p: Progression | null): void {
  if (!p) return;
  coinSound(8);
  toast(`+${p.coins + p.levelCoins} coins · +${p.xp} XP`, 'gold', 'gift');
  if (p.levelAfter > p.levelBefore) {
    levelUp();
    toast(`Level ${p.levelAfter}!`, 'gold', 'star');
  }
  for (const u of p.unlocked) toast(`Unlocked ${u.name}`, 'good', 'sparkles');
}

export function Progress(): JSX.Element {
  const p = profile.value;
  const prog = levelProgress(p.xp);
  const missions = todaysMissions();
  const s = p.stats;
  const winRate = s.games ? Math.round((s.wins / s.games) * 100) : 0;
  const potRate = s.shots ? Math.round((s.pots / s.shots) * 100) : 0;
  const road = CATALOG.filter((i) => i.unlock.kind === 'level').sort((a, b) => (a.unlock as { level: number }).level - (b.unlock as { level: number }).level);
  const streakDay = nextStreakDay();

  return (
    <ScreenShell title="Progress" sub="Level up, finish missions, collect the locker" class="progress-screen">
      <div class="progress-layout">
        <section class="panel level-card">
          <Avatar avatar={p.avatar} size={76} />
          <div class="lc-text">
            <span class="lc-name">{p.name || 'Player'}</span>
            <span class="lc-level">Level {prog.level}</span>
            <ProgressBar value={prog.ratio} />
            <span class="muted small tabular">
              {prog.into.toLocaleString()} / {prog.span.toLocaleString()} XP to level {prog.level + 1}
            </span>
          </div>
          <Button size="sm" icon="edit" onClick={() => navigate('/locker?tab=profile')}>
            Edit
          </Button>
        </section>

        <section class="panel daily-card">
          <div class="section-title">
            <h3>Daily reward</h3>
            <span class="muted small">Day {Math.min(streakDay, 7)} streak</span>
          </div>
          <div class="daily-row">
            {DAILY_STREAK_COINS.map((c, i) => (
              <div class={`daily-day ${i + 1 < streakDay || (!dailyAvailable() && i + 1 === streakDay) ? 'is-past' : i + 1 === Math.min(streakDay, 7) && dailyAvailable() ? 'is-today' : ''}`}>
                <span class="dd-label">Day {i + 1}</span>
                <Coins amount={c} size="sm" />
              </div>
            ))}
          </div>
          <Button
            kind={dailyAvailable() ? 'primary' : 'secondary'}
            block
            icon={dailyAvailable() ? 'gift' : 'check'}
            disabled={!dailyAvailable()}
            onClick={() => {
              const r = claimDaily();
              if (r) {
                coinSound(10);
                toast(`+${r.coins} coins`, 'gold', 'gift');
              }
            }}
          >
            {dailyAvailable() ? 'Claim today' : 'Claimed — back tomorrow'}
          </Button>
        </section>

        <section class="panel missions-card">
          <div class="section-title">
            <h3>Daily missions</h3>
            <span class="muted small">New ones at midnight</span>
          </div>
          <ul class="missions">
            {missions.map((m) => {
              const v = missionProgress(m);
              const claimed = p.missions.claimed.includes(m.id);
              const ready = v >= m.target && !claimed;
              return (
                <li class={`mission ${claimed ? 'is-claimed' : ready ? 'is-ready' : ''}`}>
                  <div class="m-text">
                    <b>{missionText(m)}</b>
                    <ProgressBar value={v / m.target} tone={v >= m.target ? 'mint' : 'gold'} />
                  </div>
                  <span class="m-count tabular">
                    {Math.min(v, m.target)}/{m.target}
                  </span>
                  <div class="m-reward">
                    <Coins amount={m.coins} size="sm" />
                    <span class="muted small">+{m.xp} XP</span>
                  </div>
                  <Button size="sm" kind={ready ? 'mint' : 'secondary'} disabled={!ready} onClick={() => celebrate(claimMission(m.id))} icon={claimed ? 'check' : undefined}>
                    {claimed ? 'Done' : 'Claim'}
                  </Button>
                </li>
              );
            })}
          </ul>
          <div class={`mission-bonus ${canClaimBonus() ? 'is-ready' : ''}`}>
            <Icon name="gift" size={20} />
            <span>
              Finish all three: <Coins amount={ALL_MISSIONS_BONUS.coins} size="sm" /> +{ALL_MISSIONS_BONUS.xp} XP
            </span>
            <Button size="sm" kind="primary" disabled={!canClaimBonus()} onClick={() => celebrate(claimBonus())}>
              {p.missions.bonus ? 'Claimed' : 'Claim'}
            </Button>
          </div>
        </section>

        <section class="panel stats-card">
          <div class="section-title">
            <h3>Stats</h3>
          </div>
          <div class="stats-grid">
            <Stat label="Games" value={s.games} />
            <Stat label="Wins" value={s.wins} />
            <Stat label="Win rate" value={`${winRate}%`} />
            <Stat label="Balls potted" value={s.pots} />
            <Stat label="Pot rate" value={`${potRate}%`} />
            <Stat label="Best run" value={s.bestRun} />
            <Stat label="Best win streak" value={s.bestWinStreak} />
            <Stat label="Games with friends" value={s.friendGames} />
          </div>
          <div class="mode-stats">
            {MULTIPLAYER_MODES.map((m) => (
              <div class="mode-stat">
                <span>{modeDescriptor(m).name}</span>
                <span class="tabular">
                  {s.modeWins[m] ?? 0}W / {s.modeGames[m] ?? 0}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section class="panel road-card">
          <div class="section-title">
            <h3>Level rewards</h3>
          </div>
          <ul class="road">
            {road.map((item) => {
              const lvl = (item.unlock as { level: number }).level;
              const got = p.owned.includes(item.id);
              return (
                <li class={got ? 'is-got' : ''}>
                  <span class="road-level">Lv {lvl}</span>
                  <span class="road-name">
                    <b>{item.name}</b>
                    <span class="muted small">{SLOT_LABELS[item.slot]}</span>
                  </span>
                  {got ? <Icon name="check" size={18} class="mint" /> : <Icon name="lock" size={16} class="muted" />}
                </li>
              );
            })}
          </ul>
          <p class="muted small">Every level also pays out coins.</p>
        </section>
      </div>
    </ScreenShell>
  );
}

function Stat({ label, value }: { label: string; value: number | string }): JSX.Element {
  return (
    <div class="stat">
      <span class="stat-value tabular">{typeof value === 'number' ? value.toLocaleString() : value}</span>
      <span class="stat-label">{label}</span>
    </div>
  );
}
