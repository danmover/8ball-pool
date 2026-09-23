import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import {
  AVATAR_COLORS,
  AVATAR_ICONS,
  CUPS,
  botById,
  cupUnlocked,
  levelProgress,
  missionText,
  modeDescriptor,
  TIER_LABELS,
} from '@8ball/shared';
import { AttractTable } from '../ui/AttractTable';
import { Avatar, Button, Coins, IconButton, Modal, ProgressBar, toast } from '../ui/kit';
import { Icon } from '../ui/Icon';
import { ModeArt } from '../ui/ModeArt';
import { navigate } from '../app/router';
import {
  claimDaily,
  dailyAvailable,
  level,
  missionProgress,
  nextStreakDay,
  profile,
  setAvatar,
  setName,
  todaysMissions,
  totalTrickStars,
} from '../state/profile';
import { active, savedHost } from '../net/session';
import { playBots, resumeHosted, joinRoom } from '../game/launch';
import { settingsOpen } from '../app/shell';
import { coins as coinSound, uiConfirm } from '../audio/sfx';
import { DAILY_STREAK_COINS } from '@8ball/shared';

const dailyShown = signal(false);

export function Home(): JSX.Element {
  const p = profile.value;
  const prog = levelProgress(p.xp);
  const missions = todaysMissions();
  const done = missions.filter((m) => missionProgress(m) >= m.target && !p.missions.claimed.includes(m.id)).length;
  const last = p.lastPlay;
  const bot = botById(last.botId) ?? botById('bot.pete')!;
  const nextCup = CUPS.find((c) => !p.cupsWon.includes(c.id) && cupUnlocked(c, p.cupsWon)) ?? CUPS[CUPS.length - 1];
  const saved = savedHost();
  const table = active.value;
  const [code, setCode] = useState('');
  const [welcome, setWelcome] = useState(!p.name.trim());
  const [daily, setDaily] = useState(false);

  useEffect(() => {
    if (!welcome && !dailyShown.value && dailyAvailable()) {
      dailyShown.value = true;
      setTimeout(() => setDaily(true), 600);
    }
  }, [welcome]);

  const quick = () =>
    playBots({ mode: last.mode === 'killer' || last.mode === 'power' ? 'eightball' : last.mode, botIds: [bot.id], raceTo: last.raceTo, ruleSet: last.ruleSet, tier: bot.tier });

  return (
    <div class="screen home">
      <AttractTable />
      <div class="home-shade" />
      <header class="home-top">
        <div class="brand">
          <span class="brand-ball">8</span>
          <span class="brand-word">
            8-Ball <b>Pool</b>
          </span>
        </div>
        <div class="home-top-right">
          <button class="chip coins-chip" onClick={() => navigate('/locker')} title="Coins — spend them in the Locker">
            <Coins amount={p.coins} />
          </button>
          <button class="chip profile-chip" onClick={() => navigate('/progress')}>
            <Avatar avatar={p.avatar} size={34} />
            <span class="pc-text">
              <span class="pc-name">{p.name || 'Player'}</span>
              <span class="pc-level">
                Level {prog.level}
                <span class="pc-bar">
                  <span style={{ width: `${prog.ratio * 100}%` }} />
                </span>
              </span>
            </span>
          </button>
          <IconButton icon="settings" label="Settings" onClick={() => (settingsOpen.value = true)} />
        </div>
      </header>

      <main class="home-main scroll">
        <section class="home-hero">
          <h1 class="hero-title">
            Rack 'em up<span class="gold">.</span>
          </h1>
          <p class="hero-sub">Pool with your friends on any network, or take on twelve bots — online or off.</p>

          {(table || saved) && (
            <button
              class="resume-banner"
              onClick={() => {
                if (table) navigate(table.code() ? `/room/${table.code()}` : '/local');
                else resumeHosted();
              }}
            >
              <span class="rb-dot" />
              <span>
                <b>Game in progress.</b> {table?.kind === 'guest' ? `Table ${table.code()}` : saved?.code ? `Your table ${saved.code}` : 'Your table'} — jump back in
              </span>
              <Icon name="forward" size={18} />
            </button>
          )}

          <button class="quick-card" onClick={quick}>
            <div class="qc-art">
              <ModeArt mode={last.mode === 'killer' || last.mode === 'power' ? 'eightball' : last.mode} size={72} />
            </div>
            <div class="qc-text">
              <span class="qc-kicker">Quick match</span>
              <span class="qc-title">Play {bot.name}</span>
              <span class="qc-sub">
                {modeDescriptor(last.mode).name} · {TIER_LABELS[bot.tier]} · {last.raceTo === 1 ? 'one frame' : `race to ${last.raceTo}`}
              </span>
            </div>
            <span class="qc-go">
              <Icon name="play" size={26} fill />
            </span>
          </button>

          <div class="home-grid">
            <button class="home-tile tile-friends" onClick={() => navigate('/friends')}>
              <Icon name="users" size={28} />
              <span class="ht-title">Play friends</span>
              <span class="ht-sub">Host or join a table — any network</span>
            </button>
            <button class="home-tile tile-bots" onClick={() => navigate('/play')}>
              <Icon name="bot" size={28} />
              <span class="ht-title">Vs bots</span>
              <span class="ht-sub">12 opponents, 4 game modes</span>
            </button>
            <button class="home-tile tile-cups" onClick={() => navigate('/cups')}>
              <Icon name="trophy" size={28} />
              <span class="ht-title">Cups</span>
              <span class="ht-sub">
                {p.cupsWon.length}/{CUPS.length} won · next: {nextCup.name}
              </span>
            </button>
            <button class="home-tile tile-solo" onClick={() => navigate('/solo')}>
              <Icon name="target" size={28} />
              <span class="ht-title">Solo</span>
              <span class="ht-sub">Practice · Time attack · {totalTrickStars.value}★ trick shots</span>
            </button>
          </div>

          <form
            class="join-inline"
            onSubmit={(e) => {
              e.preventDefault();
              if (code.trim().length === 4) joinRoom(code.trim());
            }}
          >
            <Icon name="link" size={18} />
            <input
              class="join-input"
              placeholder="Have a code? Join a table"
              maxLength={4}
              value={code}
              autocapitalize="characters"
              autocomplete="off"
              spellcheck={false}
              onInput={(e) => setCode((e.target as HTMLInputElement).value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            />
            <Button kind="primary" size="sm" type="submit" disabled={code.length !== 4}>
              Join
            </Button>
          </form>
        </section>

        <aside class="home-side">
          <div class="panel side-card">
            <div class="section-title">
              <h3>Today</h3>
              <button class="link" onClick={() => navigate('/progress')}>
                All progress
              </button>
            </div>
            <ul class="mission-mini">
              {missions.map((m) => {
                const v = missionProgress(m);
                const claimed = p.missions.claimed.includes(m.id);
                return (
                  <li class={claimed ? 'is-claimed' : v >= m.target ? 'is-done' : ''}>
                    <span class="mm-text">{missionText(m)}</span>
                    <ProgressBar value={v / m.target} tone={v >= m.target ? 'mint' : 'gold'} />
                    <span class="mm-count tabular">{claimed ? '✓' : `${v}/${m.target}`}</span>
                  </li>
                );
              })}
            </ul>
            {done > 0 && (
              <Button kind="mint" size="sm" block icon="gift" onClick={() => navigate('/progress')}>
                {done} reward{done > 1 ? 's' : ''} to claim
              </Button>
            )}
          </div>
          <button class="panel side-card locker-card" onClick={() => navigate('/locker')}>
            <div class="section-title">
              <h3>Locker</h3>
              <Icon name="forward" size={16} />
            </div>
            <div class="lc-body">
              <Icon name="locker" size={30} />
              <span>
                <b>{p.owned.length} of 32</b> items · level {level.value}
              </span>
            </div>
          </button>
        </aside>
      </main>

      <nav class="bottom-nav">
        <button class="is-on" onClick={() => navigate('/')}>
          <Icon name="home" size={22} />
          <span>Home</span>
        </button>
        <button onClick={() => navigate('/locker')}>
          <Icon name="locker" size={22} />
          <span>Locker</span>
        </button>
        <button onClick={() => navigate('/progress')}>
          <Icon name="chart" size={22} />
          <span>Progress</span>
          {done > 0 && <span class="badge">{done}</span>}
        </button>
        <button onClick={() => (settingsOpen.value = true)}>
          <Icon name="settings" size={22} />
          <span>Settings</span>
        </button>
      </nav>

      {welcome && <WelcomeModal onDone={() => setWelcome(false)} />}
      {daily && <DailyModal onClose={() => setDaily(false)} />}
    </div>
  );
}

function WelcomeModal({ onDone }: { onDone: () => void }): JSX.Element {
  const p = profile.value;
  const [name, setLocal] = useState(p.name);
  return (
    <Modal open onClose={onDone} title="Welcome to the hall">
      <p class="muted">Pick a name and a look. Your friends will see them at the table.</p>
      <div class="welcome-preview">
        <Avatar avatar={p.avatar} size={72} />
        <input class="input" placeholder="Your name" maxLength={16} value={name} onInput={(e) => setLocal((e.target as HTMLInputElement).value)} />
      </div>
      <div class="avatar-grid">
        {AVATAR_ICONS.map((icon) => (
          <button class={p.avatar.icon === icon ? 'is-on' : ''} onClick={() => setAvatar({ icon })}>
            {icon}
          </button>
        ))}
      </div>
      <div class="color-row">
        {AVATAR_COLORS.map((color) => (
          <button class={`swatch ${p.avatar.color === color ? 'is-on' : ''}`} style={{ background: color }} onClick={() => setAvatar({ color })} aria-label={color} />
        ))}
      </div>
      <Button
        kind="primary"
        size="lg"
        block
        sound="confirm"
        onClick={() => {
          setName(name.trim() || 'Player');
          onDone();
        }}
      >
        Let's play
      </Button>
      {p.veteran && <p class="muted small center">Welcome back — your level and stats came with you, plus coins for the new locker.</p>}
    </Modal>
  );
}

function DailyModal({ onClose }: { onClose: () => void }): JSX.Element {
  const day = nextStreakDay();
  return (
    <Modal open onClose={onClose} title="Daily reward">
      <div class="daily-row">
        {DAILY_STREAK_COINS.map((c, i) => (
          <div class={`daily-day ${i + 1 < day ? 'is-past' : i + 1 === Math.min(day, 7) ? 'is-today' : ''}`}>
            <span class="dd-label">Day {i + 1}</span>
            <Coins amount={c} size="sm" />
          </div>
        ))}
      </div>
      <Button
        kind="primary"
        size="lg"
        block
        icon="gift"
        onClick={() => {
          const r = claimDaily();
          if (r) {
            coinSound(10);
            uiConfirm();
            toast(`+${r.coins} coins — day ${r.day} streak`, 'gold');
          }
          onClose();
        }}
      >
        Claim
      </Button>
      <p class="muted small center">Come back tomorrow to keep your streak going.</p>
    </Modal>
  );
}
