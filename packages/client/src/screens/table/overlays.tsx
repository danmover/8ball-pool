import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import {
  challengeById,
  formatRunTime,
  levelProgress,
  modeDescriptor,
  roundName,
  type RoomView,
  type Tournament,
} from '@8ball/shared';
import { Avatar, BallIcon, Button, CoinIcon, CountUp, ProgressBar } from '../../ui/kit';
import { Icon } from '../../ui/Icon';
import type { Notice } from '../../game/feedback';
import type { RewardSummary } from '../../state/profile';
import { profile } from '../../state/profile';
import { SEAT_COLORS } from './hud';

// ================================================================ notices

export interface ShownNotice extends Notice {
  id: number;
}

export function Notices({ items }: { items: ShownNotice[] }): JSX.Element {
  return (
    <div class="notices" aria-live="polite">
      {items.map((n) => (
        <div key={n.id} class={`notice notice-${n.tone}`}>
          <div class="notice-text">{n.text}</div>
          {n.sub && <div class="notice-sub">{n.sub}</div>}
        </div>
      ))}
    </div>
  );
}

export interface Bubble {
  id: number;
  seat: number | null;
  name: string;
  text: string;
  emoji: boolean;
}

export function Bubbles({ items, room }: { items: Bubble[]; room: RoomView }): JSX.Element {
  return (
    <div class="bubbles">
      {items.map((b) => {
        const seat = b.seat !== null ? room.seats[b.seat] : null;
        return (
          <div key={b.id} class={`bubble ${b.emoji ? 'is-emoji' : ''}`} style={{ '--seat': b.seat !== null ? SEAT_COLORS[b.seat % 8] : 'var(--text-3)' }}>
            {seat && <Avatar avatar={seat.avatar} size={28} />}
            <span class="bubble-name">{b.name}</span>
            <span class="bubble-text">{b.text}</span>
          </div>
        );
      })}
    </div>
  );
}

// ================================================================ between frames

export function Intermission({ room }: { room: RoomView }): JSX.Element | null {
  const [left, setLeft] = useState(4);
  useEffect(() => {
    const t = setInterval(() => setLeft((l) => Math.max(0, l - 1)), 1000);
    return () => clearInterval(t);
  }, []);
  const m = room.match;
  if (!m) return null;
  const playing = room.tournament ? m.playing : m.playing;
  const top = [...playing].sort((a, b) => (m.wins[b] ?? 0) - (m.wins[a] ?? 0));
  const leader = room.seats[top[0]];
  const t = room.tournament;
  const tie = t?.current ? t.bracket.matches.find((x) => x.id === t.current) : null;
  return (
    <div class="intermission">
      <div class="im-card panel">
        <div class="im-kicker">{room.king ? 'Winner stays on' : tie && t ? roundName(t.bracket, tie.round) : `End of frame ${m.frame}`}</div>
        <div class="im-score">
          {playing.map((i, k) => (
            <>
              {k > 0 && <span class="im-dash">–</span>}
              <div class="im-side">
                <Avatar avatar={room.seats[i]?.avatar ?? { icon: '🎱', color: '#888' }} size={54} ring={SEAT_COLORS[i % 8]} />
                <span class="im-name">{room.seats[i]?.name}</span>
                <span class="im-wins tabular">{m.wins[i] ?? 0}</span>
              </div>
            </>
          ))}
        </div>
        {room.king ? (
          <div class="im-sub">
            {room.seats[room.king.holder]?.name} holds the table · {room.king.streak} in a row
          </div>
        ) : (
          <div class="im-sub">{leader ? `${leader.name} leads` : ''}</div>
        )}
        <div class="im-next">Next frame in {left}…</div>
      </div>
    </div>
  );
}

// ================================================================ bracket

export function Bracket({ t, room, compact }: { t: Tournament; room: RoomView; compact?: boolean }): JSX.Element {
  const rounds = Math.max(...t.matches.map((m) => m.round));
  const cols = Array.from({ length: rounds }, (_, r) => t.matches.filter((m) => m.round === r + 1).sort((a, b) => a.slot - b.slot));
  const seat = (s: string | null) => (s ? room.seats[Number(s.slice(1)) - 1] : null);
  return (
    <div class={`bracket ${compact ? 'is-compact' : ''}`}>
      {cols.map((col, r) => (
        <div class="br-col">
          <div class="br-round">{roundName(t, r + 1)}</div>
          <div class="br-matches">
            {col.map((m) => (
              <div class={`br-match ${m.winner ? 'is-done' : ''}`}>
                {[m.a, m.b].map((s) => {
                  const v = seat(s);
                  const won = m.winner && m.winner === s;
                  return (
                    <div class={`br-slot ${won ? 'is-won' : ''} ${m.winner && !won && s ? 'is-lost' : ''}`}>
                      {v ? <Avatar avatar={v.avatar} size={20} bot={v.kind === 'bot'} /> : <span class="br-empty" />}
                      <span class="br-name">{v?.name ?? (s ? '…' : 'Bye')}</span>
                      <span class="br-score tabular">{s ? (m.score[s] ?? 0) : ''}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      ))}
      {t.champion && (
        <div class="br-col br-champ">
          <div class="br-round">Champion</div>
          <div class="br-trophy">
            <span class="trophy">🏆</span>
            <span>{seat(t.champion)?.name}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ================================================================ results

function Stars({ n }: { n: number }): JSX.Element {
  return (
    <div class="stars">
      {[1, 2, 3].map((k) => (
        <span class={`star ${k <= n ? 'is-on' : ''}`} style={{ '--d': `${k * 0.18}s` }}>
          ★
        </span>
      ))}
    </div>
  );
}

function Confetti(): JSX.Element {
  const pieces = Array.from({ length: 60 }, (_, i) => i);
  const colors = ['#ffc444', '#2fe3a3', '#5bb6ff', '#ff5fa2', '#b28cff', '#ff7a59'];
  return (
    <div class="confetti" aria-hidden="true">
      {pieces.map((i) => (
        <span
          style={{
            left: `${(i * 37) % 100}%`,
            background: colors[i % colors.length],
            animationDelay: `${(i % 12) * 0.12}s`,
            animationDuration: `${2.4 + (i % 5) * 0.35}s`,
            transform: `rotate(${i * 29}deg)`,
          }}
        />
      ))}
    </div>
  );
}

export function Results({
  room,
  mine,
  isHost,
  rewards,
  onRematch,
  onLobby,
  onLeave,
  onNext,
}: {
  room: RoomView;
  mine: number[];
  isHost: boolean;
  rewards: RewardSummary | null;
  onRematch: () => void;
  onLobby: () => void;
  onLeave: () => void;
  onNext?: (() => void) | null;
}): JSX.Element | null {
  const r = room.result;
  if (!r) return null;
  const solo = r.solo;
  const iWon = r.winners.some((w) => mine.includes(w));
  const iPlayed = r.standings.some((s) => mine.includes(s.seat));
  const champ = r.champion !== null ? room.seats[r.champion] : null;
  const winner = r.winners.length ? room.seats[r.winners[0]] : null;
  const desc = modeDescriptor(room.settings.mode);

  let title = 'Game over';
  let tone = 'neutral';
  if (solo) {
    title = solo.failed ? 'So close!' : solo.timeMs !== null ? 'Table cleared!' : 'Challenge complete!';
    tone = solo.failed ? 'lose' : 'win';
  } else if (champ) {
    title = mine.includes(r.champion!) ? 'Champion!' : `${champ.name} wins the ${room.tournament ? 'tournament' : 'table'}`;
    tone = mine.includes(r.champion!) ? 'win' : 'lose';
  } else if (iPlayed) {
    title = iWon ? 'Victory!' : 'Defeat';
    tone = iWon ? 'win' : 'lose';
  } else if (winner) {
    title = `${winner.name} wins`;
  }

  const prog = levelProgress(profile.value.xp);
  const leveled = rewards && rewards.progression.levelAfter > rewards.progression.levelBefore;
  const votes = room.rematch.length;
  const humans = room.seats.filter((s) => s?.kind === 'human' && s.peer !== room.host).length;
  const challenge = solo?.challengeId ? challengeById(solo.challengeId) : null;

  return (
    <div class={`results results-${tone}`}>
      {tone === 'win' && <Confetti />}
      <div class="results-card panel">
        <div class="res-kicker">{solo ? desc.name : room.tournament ? 'Tournament' : room.king ? 'Winner stays on' : `${desc.name} · ${r.frames} frame${r.frames === 1 ? '' : 's'}`}</div>
        <h1 class="res-title">{title}</h1>

        {solo ? (
          <div class="res-solo">
            {challenge && <div class="res-challenge">{challenge.name}</div>}
            {!solo.failed && <Stars n={solo.stars} />}
            {solo.timeMs !== null && <div class="res-time tabular">{formatRunTime(solo.timeMs)}</div>}
            {solo.failed && <div class="res-sub">{challenge ? 'Out of shots — try a different line.' : ''}</div>}
          </div>
        ) : (
          <div class="res-standings">
            {r.standings.slice(0, 8).map((s, k) => {
              const v = room.seats[s.seat];
              const won = r.winners.includes(s.seat) || r.champion === s.seat;
              return (
                <div class={`res-row ${won ? 'is-won' : ''} ${mine.includes(s.seat) ? 'is-mine' : ''}`} style={{ '--seat': SEAT_COLORS[s.seat % 8] }}>
                  <span class="res-rank">{won ? '👑' : k + 1}</span>
                  <Avatar avatar={v?.avatar ?? { icon: '🎱', color: '#777' }} size={36} bot={v?.kind === 'bot'} />
                  <span class="res-name">{v?.name}</span>
                  {!room.tournament && (room.match?.raceTo ?? 1) > 1 && <span class="res-stat"><b class="tabular">{s.wins}</b> frames</span>}
                  <span class="res-stat"><b class="tabular">{s.stats.pots}</b> pots</span>
                  <span class="res-stat hide-sm"><b class="tabular">{s.stats.bestRun}</b> best run</span>
                  <span class="res-stat hide-sm"><b class="tabular">{s.stats.fouls}</b> fouls</span>
                </div>
              );
            })}
          </div>
        )}

        {room.tournament && <Bracket t={room.tournament.bracket} room={room} compact />}

        {rewards && (
          <div class="res-rewards">
            <div class="rw-top">
              <div class="rw-item">
                <span class="rw-label">XP</span>
                <span class="rw-value gold">
                  <CountUp to={rewards.progression.xp} prefix="+" />
                </span>
              </div>
              <div class="rw-item">
                <span class="rw-label">Coins</span>
                <span class="rw-value">
                  <CoinIcon size={20} />
                  <CountUp to={rewards.progression.coins + rewards.progression.levelCoins} prefix="+" />
                </span>
              </div>
              <div class="rw-level">
                <span class="rw-label">Level {prog.level}</span>
                <ProgressBar value={prog.ratio} />
              </div>
            </div>
            <div class="rw-lines">
              {rewards.lines.map((l) => (
                <span class="rw-line">
                  {l.label} <b>+{l.coins}</b>
                </span>
              ))}
            </div>
            {leveled && (
              <div class="rw-banner gold">
                <Icon name="star" size={16} fill /> Level up! You're now level {rewards.progression.levelAfter} · +{rewards.progression.levelCoins} coins
              </div>
            )}
            {rewards.cup && (
              <div class="rw-banner gold">
                🏆 {rewards.cup.name} won! +{rewards.cup.coins} coins{rewards.cup.item ? ` · unlocked ${rewards.cup.item.name}` : ''}
              </div>
            )}
            {rewards.progression.unlocked.map((u) => (
              <div class="rw-banner">
                <Icon name="gift" size={16} /> Unlocked {u.name}
              </div>
            ))}
            {rewards.missions.map((m) => (
              <div class="rw-banner mint">
                <Icon name="check" size={16} /> Mission complete — claim it in Progress
              </div>
            ))}
          </div>
        )}

        <div class="res-actions">
          {solo ? (
            <>
              <Button kind="primary" size="lg" icon="refresh" onClick={onRematch} sound="confirm">
                {solo.failed ? 'Try again' : 'Play again'}
              </Button>
              {onNext && (
                <Button kind="secondary" size="lg" iconRight="forward" onClick={onNext}>
                  Next
                </Button>
              )}
            </>
          ) : (
            <>
              {(isHost || mine.length > 0) && !room.tournament?.bracket.champion && !room.king && (
                <Button kind="primary" size="lg" icon="refresh" onClick={onRematch} sound="confirm">
                  {isHost ? 'Rematch' : `Rematch${humans > 1 ? ` (${votes}/${humans})` : ''}`}
                </Button>
              )}
              {(room.tournament?.bracket.champion || room.king) && isHost && (
                <Button kind="primary" size="lg" icon="refresh" onClick={onRematch} sound="confirm">
                  Play again
                </Button>
              )}
              {isHost && room.online && (
                <Button kind="secondary" size="lg" icon="users" onClick={onLobby}>
                  Lobby
                </Button>
              )}
            </>
          )}
          <Button kind="ghost" size="lg" icon="home" onClick={onLeave} sound="back">
            {room.online ? 'Leave' : 'Home'}
          </Button>
        </div>
        {!isHost && room.online && <div class="res-note">The host can change the settings for the next game.</div>}
      </div>
    </div>
  );
}

/** A small strip of the balls of one set, for decoration. */
export function BallStrip({ set, ids }: { set: string; ids: number[] }): JSX.Element {
  return (
    <div class="ball-strip">
      {ids.map((id) => (
        <BallIcon id={id} size={22} set={set} />
      ))}
    </div>
  );
}

