import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  EMOTES,
  MAX_LIVES,
  POWER_INFO,
  QUICK_CHAT,
  TIER_LABELS,
  botById,
  callRequirement,
  formatRunTime,
  lowestBallId,
  modeDescriptor,
  roundName,
  seatIndex,
  activeChallenge,
  type GameState,
  type PowerId,
  type RoomView,
  type SeatView,
} from '@8ball/shared';
import { Avatar, BallIcon, IconButton } from '../../ui/kit';
import { Icon } from '../../ui/Icon';
import { SAFE_SPIN, type AimControls, type ShotType } from '../../game/controls';
import type { GameClient } from '../../net/client';
import { haptic } from '../../state/settings';
import { uiTap, arm as armSound } from '../../audio/sfx';

export const SEAT_COLORS = ['var(--p1)', 'var(--p2)', 'var(--p3)', 'var(--p4)', 'var(--p5)', 'var(--p6)', 'var(--p7)', 'var(--p8)'];

/** Ticks a component on animation frames, at most `fps` times a second. */
export function useTicker(active: boolean, fps = 12): number {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let last = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < 1000 / fps) return;
      last = now;
      setT(now);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active, fps]);
  return t;
}

const SOLIDS = [1, 2, 3, 4, 5, 6, 7];
const STRIPES = [9, 10, 11, 12, 13, 14, 15];

// ================================================================ player cards

function GroupBalls({ game, seat, set }: { game: GameState; seat: string; set: string }): JSX.Element {
  const p = game.players[seat];
  if (!p.group) return <span class="card-sub muted">{game.phase === 'break' && game.currentShooter === seat ? 'To break' : 'Open table'}</span>;
  const ids = p.group === 'solid' ? SOLIDS : STRIPES;
  const potted = (id: number) => game.balls.find((b) => b.id === id)?.pocketed ?? true;
  const cleared = ids.every(potted);
  return (
    <span class="card-balls">
      {cleared ? (
        <>
          <BallIcon id={8} size={17} set={set} />
          <span class="card-sub gold">On the 8</span>
        </>
      ) : (
        ids.map((id) => <BallIcon key={id} id={id} size={15} set={set} dim={potted(id)} />)
      )}
    </span>
  );
}

function Lives({ lives }: { lives: number }): JSX.Element {
  return (
    <span class="card-lives" aria-label={`${lives} lives`}>
      {Array.from({ length: Math.max(3, Math.min(MAX_LIVES, lives)) }, (_, i) => (
        <span class={i < lives ? 'heart is-on' : 'heart'}>♥</span>
      ))}
    </span>
  );
}

function Powers({ held, armed, active }: { held: PowerId[]; armed: PowerId | null; active: boolean }): JSX.Element | null {
  if (held.length === 0) return null;
  return (
    <span class="card-powers">
      {held.map((p) => (
        <span class={`card-power ${active && armed === p ? 'is-armed' : ''}`} style={{ '--pc': POWER_INFO[p].color }} title={POWER_INFO[p].name}>
          {POWER_INFO[p].glyph}
        </span>
      ))}
    </span>
  );
}

export function PlayerCard({
  seat,
  view,
  game,
  room,
  turn,
  clock,
  mine,
  compact,
  side,
}: {
  seat: string;
  view: SeatView | null;
  game: GameState;
  room: RoomView;
  turn: boolean;
  clock: number | null;
  mine: boolean;
  compact: boolean;
  side: 'left' | 'right';
}): JSX.Element {
  const i = seatIndex(seat);
  const p = game.players[seat];
  const color = SEAT_COLORS[i % SEAT_COLORS.length];
  const bot = view?.kind === 'bot' || view?.covering;
  const tier = view?.botId ? botById(view.botId)?.tier : null;
  const wins = room.match?.wins[i] ?? 0;
  const race = room.match?.raceTo ?? 1;
  const team = p?.team;
  return (
    <div
      class={`pcard pcard-${side} ${turn ? 'is-turn' : ''} ${compact ? 'is-compact' : ''} ${p?.eliminated ? 'is-out' : ''} ${mine ? 'is-mine' : ''}`}
      style={{ '--seat': team ? (team === 'a' ? 'var(--p1)' : 'var(--p2)') : color }}
    >
      <Avatar avatar={view?.avatar ?? { icon: '🎱', color: '#666' }} size={compact ? 38 : 50} ring={turn ? 'var(--seat)' : undefined} ringProgress={turn ? clock : null} bot={bot} dim={p?.eliminated || (view !== null && !view.connected)} />
      <div class="pcard-text">
        <div class="pcard-name">
          <span class="name">{p?.name ?? view?.name}</span>
          {!compact && <span class="lvl">{tier ? TIER_LABELS[tier] : `Lv ${view?.level ?? 1}`}</span>}
          {view && !view.connected && !bot && <Icon name="wifiOff" size={14} class="warn" />}
        </div>
        {!compact && (
          <div class="pcard-detail">
            {game.mode === 'eightball' && <GroupBalls game={game} seat={seat} set={room.balls} />}
            {game.mode === 'killer' && <Lives lives={p?.lives ?? 0} />}
            {game.mode === 'power' && (
              <>
                <span class="card-score tabular">{p?.score ?? 0}</span>
                <Powers held={game.power?.held[seat] ?? []} armed={game.power?.armed ?? null} active={turn} />
              </>
            )}
            {game.mode === 'nineball' && <span class="card-sub muted">{turn ? 'At the table' : ''}</span>}
          </div>
        )}
        {compact && game.mode === 'killer' && <Lives lives={p?.lives ?? 0} />}
        {compact && game.mode === 'power' && <span class="card-score tabular">{p?.score ?? 0}</span>}
      </div>
      {race > 1 && !compact && (
        <div class="pcard-wins" aria-label={`${wins} frames`}>
          {Array.from({ length: race }, (_, k) => (
            <span class={k < wins ? 'pip is-on' : 'pip'} />
          ))}
        </div>
      )}
    </div>
  );
}

export function MatchStatus({ room, game }: { room: RoomView; game: GameState }): JSX.Element {
  const desc = modeDescriptor(game.mode);
  const t = room.tournament;
  const tie = t?.current ? t.bracket.matches.find((m) => m.id === t.current) : null;
  const lowest = game.mode === 'nineball' ? lowestBallId(game) : null;
  const k = room.king;
  let detail: string | null = null;
  if (tie && t) detail = roundName(t.bracket, tie.round);
  else if (k) detail = `Streak ${k.streak}/${k.target}`;
  else if ((room.match?.raceTo ?? 1) > 1) detail = `Frame ${room.match!.frame} · Race to ${room.match!.raceTo}`;
  return (
    <div class="match-status">
      <span class="ms-mode">{desc.name}</span>
      {detail && <span class="ms-detail">{detail}</span>}
      {lowest !== null && (
        <span class="ms-lowest">
          Next <BallIcon id={lowest} size={18} set={room.balls} />
        </span>
      )}
      {room.settings.ruleSet === 'pro' && desc.usesRuleSet && <span class="ms-rule">Pro rules</span>}
    </div>
  );
}

// ================================================================ solo HUD

export function SoloStatus({ game, stateAt }: { game: GameState; stateAt: number }): JSX.Element | null {
  const ta = game.timeAttack;
  const trick = game.trick;
  const running = !!ta && ta.finalMs === null && game.phase !== 'game_over' && (ta.elapsedMs > 0 || game.turnNumber > 0);
  useTicker(running, 15);
  if (ta) {
    const live = ta.finalMs ?? ta.elapsedMs + (running ? performance.now() - stateAt : 0);
    const left = game.balls.filter((b) => b.id !== 0 && !b.pocketed).length;
    return (
      <div class="solo-status">
        <span class="ms-mode">Time Attack</span>
        <span class="solo-time tabular">{formatRunTime(live + ta.penaltyMs)}</span>
        <span class="ms-detail">
          {left} left{ta.penaltyMs ? ` · +${ta.penaltyMs / 1000}s` : ''}
        </span>
      </div>
    );
  }
  if (trick) {
    const c = activeChallenge(game);
    return (
      <div class="solo-status">
        <span class="ms-mode">{c?.name ?? 'Trick Shot'}</span>
        <span class="ms-detail">{c?.brief}</span>
        <span class="solo-shots tabular">
          Shot {Math.min(trick.shotsUsed + 1, c?.shotLimit ?? 1)}/{c?.shotLimit}
        </span>
      </div>
    );
  }
  if (game.mode === 'practice') {
    return (
      <div class="solo-status">
        <span class="ms-mode">Practice</span>
        <span class="ms-detail">Drag the cue ball to set up any shot</span>
      </div>
    );
  }
  return null;
}

// ================================================================ power bar

export function PowerBar({ controls, enabled, horizontal }: { controls: AimControls; enabled: boolean; horizontal: boolean }): JSX.Element {
  const track = useRef<HTMLDivElement>(null);
  const start = useRef(0);
  const power = controls.power.value;
  const charging = controls.charging.value;

  const setFrom = (e: PointerEvent) => {
    const r = track.current!.getBoundingClientRect();
    const span = horizontal ? r.width : r.height;
    const d = horizontal ? e.clientX - start.current : e.clientY - start.current;
    controls.setPower(Math.max(0, Math.min(1, d / (span * 0.85))));
  };

  return (
    <div class={`powerbar ${horizontal ? 'is-h' : ''} ${enabled ? '' : 'is-off'} ${charging ? 'is-charging' : ''}`}>
      <div
        ref={track}
        class="pb-track"
        onPointerDown={(e) => {
          if (!enabled) return;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          start.current = horizontal ? e.clientX : e.clientY;
          controls.beginCharge();
          haptic(6);
        }}
        onPointerMove={(e) => {
          // Read the signal, not the value captured at render: the first moves of a drag can
          // arrive before the re-render that follows beginCharge().
          if (!controls.charging.value) return;
          setFrom(e);
        }}
        onPointerUp={() => controls.endCharge()}
        onPointerCancel={() => controls.cancelCharge()}
      >
        <div class="pb-fill" style={{ [horizontal ? 'width' : 'height']: `${power * 100}%` }} />
        <div class="pb-cue" style={{ transform: horizontal ? `translateX(${power * 82}%)` : `translateY(${power * 82}%)` }}>
          <span class="pb-tip" />
        </div>
        <div class="pb-ticks">
          {[0.25, 0.5, 0.75].map((t) => (
            <span style={{ [horizontal ? 'left' : 'top']: `${t * 100}%` }} />
          ))}
        </div>
      </div>
      <div class="pb-label tabular">{charging ? `${Math.round(power * 100)}%` : enabled ? 'PULL' : ''}</div>
    </div>
  );
}

// ================================================================ ball return

export function BallReturn({ potted, set, horizontal }: { potted: number[]; set: string; horizontal: boolean }): JSX.Element {
  return (
    <div class={`ball-return ${horizontal ? 'is-h' : ''}`} aria-label="Potted balls">
      <div class="br-tube">
        {potted.map((id, i) => (
          <span class="br-ball" key={id} style={{ '--i': i }}>
            <BallIcon id={id} size={horizontal ? 24 : 30} set={set} />
          </span>
        ))}
      </div>
    </div>
  );
}

// ================================================================ dock

function CueBallFace({ spin, size = 40 }: { spin: { x: number; y: number }; size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" class="cueface">
      <defs>
        <radialGradient id="cuef" cx="38%" cy="32%" r="70%">
          <stop offset="0" stop-color="#ffffff" />
          <stop offset="0.7" stop-color="#e9e4d8" />
          <stop offset="1" stop-color="#9c978c" />
        </radialGradient>
      </defs>
      <circle cx="20" cy="20" r="18.5" fill="url(#cuef)" />
      <circle cx={20 + spin.x * 14} cy={20 + spin.y * 14} r="4.2" fill="#e8313b" stroke="#fff" stroke-width="1.4" />
    </svg>
  );
}

export function SpinPicker({ controls, onClose }: { controls: AimControls; onClose: () => void }): JSX.Element {
  const pad = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState(false);
  const s = controls.spin.value;
  const set = (e: PointerEvent) => {
    const r = pad.current!.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 2 - 1;
    const y = ((e.clientY - r.top) / r.height) * 2 - 1;
    controls.setSpin(x / 0.82, y / 0.82);
  };
  const danger = Math.hypot(s.x, s.y) > SAFE_SPIN;
  const types: { id: ShotType; label: string; hint: string }[] = [
    { id: 'normal', label: 'Normal', hint: 'Level cue' },
    { id: 'swerve', label: 'Swerve', hint: 'Raised cue + side spin curves the ball' },
    { id: 'jump', label: 'Jump', hint: 'Steep cue lifts the ball over others' },
  ];
  return (
    <div class="spin-picker panel" onPointerDown={(e) => e.stopPropagation()}>
      <div class="sp-head">
        <span>Spin & shot</span>
        <IconButton icon="close" label="Close" onClick={onClose} sound="back" />
      </div>
      <svg
        ref={pad}
        class="sp-pad"
        viewBox="-50 -50 100 100"
        onPointerDown={(e) => {
          (e.currentTarget as Element).setPointerCapture(e.pointerId);
          setDrag(true);
          set(e);
        }}
        onPointerMove={(e) => drag && set(e)}
        onPointerUp={() => setDrag(false)}
      >
        <defs>
          <radialGradient id="spball" cx="40%" cy="34%" r="72%">
            <stop offset="0" stop-color="#ffffff" />
            <stop offset="0.72" stop-color="#e8e3d6" />
            <stop offset="1" stop-color="#8f8a80" />
          </radialGradient>
        </defs>
        <circle r="41" fill="url(#spball)" />
        {/* The band past the tip's safe grip, where a miscue becomes possible. */}
        <circle
          r={(41 * 0.82 * (1 + SAFE_SPIN)) / 2}
          fill="none"
          stroke="rgba(255,80,60,0.45)"
          stroke-width={41 * 0.82 * (1 - SAFE_SPIN)}
        />
        <line x1="-41" y1="0" x2="41" y2="0" stroke="rgba(0,0,0,0.12)" />
        <line x1="0" y1="-41" x2="0" y2="41" stroke="rgba(0,0,0,0.12)" />
        <circle cx={s.x * 41 * 0.82} cy={s.y * 41 * 0.82} r="7.5" fill={danger ? '#ff5a3c' : '#e8313b'} stroke="#fff" stroke-width="2.2" />
      </svg>
      <div class="sp-labels">
        <span>{s.y < -0.15 ? 'Follow' : s.y > 0.15 ? 'Draw' : 'Stun'}</span>
        <span>{s.x < -0.15 ? 'Left english' : s.x > 0.15 ? 'Right english' : 'Centre'}</span>
        {danger && <span class="warn">Miscue risk</span>}
      </div>
      <div class="sp-presets">
        <button onClick={() => { uiTap(); controls.setSpin(0, -0.55); }}>Follow</button>
        <button onClick={() => { uiTap(); controls.setSpin(0, 0.6); }}>Draw</button>
        <button onClick={() => { uiTap(); controls.setSpin(0, 0); }}>Centre</button>
      </div>
      <div class="sp-types">
        {types.map((t) => (
          <button class={controls.shotType.value === t.id ? 'is-on' : ''} title={t.hint} onClick={() => { uiTap(); controls.setShotType(t.id); }}>
            <strong>{t.label}</strong>
            <small>{t.hint}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

function FineAim({ controls, enabled }: { controls: AimControls; enabled: boolean }): JSX.Element {
  const last = useRef<number | null>(null);
  const [offset, setOffset] = useState(0);
  return (
    <div
      class={`fine-aim ${enabled ? '' : 'is-off'}`}
      title="Drag for fine aim"
      onPointerDown={(e) => {
        if (!enabled) return;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        last.current = e.clientX;
      }}
      onPointerMove={(e) => {
        if (last.current === null) return;
        const dx = e.clientX - last.current;
        last.current = e.clientX;
        controls.nudge(dx * 0.0009);
        setOffset((o) => o + dx);
      }}
      onPointerUp={() => (last.current = null)}
      onPointerCancel={() => (last.current = null)}
    >
      <div class="fa-ridges" style={{ backgroundPositionX: `${offset}px` }} />
      <Icon name="swap" size={16} class="fa-icon" />
    </div>
  );
}

export function Dock({
  client,
  controls,
  game,
  room,
  onEmote,
  onSpin,
  spinOpen,
}: {
  client: GameClient;
  controls: AimControls;
  game: GameState;
  room: RoomView;
  onEmote: () => void;
  onSpin: () => void;
  spinOpen: boolean;
}): JSX.Element {
  const myTurn = client.myTurn.value;
  const mine = client.mySeats.value;
  const shooter = seatIndex(game.currentShooter);
  const shooterName = room.seats[shooter]?.name ?? 'Player';
  const need = myTurn ? callRequirement(game) : 'none';
  const held = game.power?.held[game.currentShooter] ?? [];
  const armed = game.power?.armed ?? null;
  const placing = myTurn && game.phase === 'ball_in_hand';
  const practice = game.mode === 'practice' && myTurn;
  const spectating = mine.length === 0;
  const frozen = myTurn && game.power?.frozen.includes(game.currentShooter);

  return (
    <div class="dock">
      {myTurn ? (
        <>
          <button class={`dock-spin ${spinOpen ? 'is-on' : ''}`} onClick={() => { uiTap(); onSpin(); }} aria-label="Spin and shot type">
            <CueBallFace spin={controls.spin.value} size={40} />
            <span class="dock-cap">{controls.shotType.value === 'normal' ? 'Spin' : controls.shotType.value === 'jump' ? 'Jump' : 'Swerve'}</span>
          </button>
          <FineAim controls={controls} enabled={!placing} />
          {game.mode === 'power' && held.length > 0 && (
            <div class="dock-powers">
              {held.map((p) => (
                <button
                  class={`dock-power ${armed === p ? 'is-armed' : ''}`}
                  style={{ '--pc': POWER_INFO[p].color }}
                  title={`${POWER_INFO[p].name} — ${POWER_INFO[p].blurb}`}
                  onClick={() => {
                    armSound();
                    haptic(12);
                    client.send({ t: 'arm', power: armed === p ? null : p });
                  }}
                >
                  <span class="dp-glyph">{POWER_INFO[p].glyph}</span>
                  <span class="dp-name">{POWER_INFO[p].name}</span>
                </button>
              ))}
            </div>
          )}
          {practice && (
            <div class="dock-tools">
              <IconButton icon="undo" label="Undo shot" onClick={() => client.send({ t: 'practice', action: 'undo' })} />
              <IconButton icon="refresh" label="Re-rack" onClick={() => client.send({ t: 'practice', action: 'rerack' })} />
            </div>
          )}
          <div class="dock-hint">
            {placing ? (
              <span>
                <Icon name="hand" size={15} /> Drag the cue ball — ball in hand{game.ballInHandBehindLine ? ' (behind the line)' : ''}
              </span>
            ) : game.phase === 'break' ? (
              <span>Break! Pull the power cue hard</span>
            ) : frozen ? (
              <span class="warn">🧊 Frozen — no aim guide this turn</span>
            ) : need !== 'none' ? (
              <span>
                <Icon name="target" size={15} /> Calling {controls.calledPocket.value !== null ? pocketName(controls.calledPocket.value) : '—'} · tap a pocket to change
              </span>
            ) : (
              <span>Drag to aim · pull the cue to shoot</span>
            )}
          </div>
        </>
      ) : (
        <div class="dock-wait">
          {spectating ? <Icon name="eye" size={16} /> : <span class="wait-dot" />}
          <span>
            {client.playing.value
              ? mine.includes(seatIndex(client.playing.value.seat))
                ? 'Rolling… tap the table to speed up'
                : `${room.seats[seatIndex(client.playing.value.seat)]?.name ?? 'Player'} shot · tap to speed up`
              : spectating
                ? `Watching · ${shooterName} to shoot`
                : `${shooterName} is lining up…`}
          </span>
        </div>
      )}
      <IconButton icon="smile" label="Emotes" onClick={onEmote} class="dock-emote" />
    </div>
  );
}

export function pocketName(i: number): string {
  return ['top-left corner', 'top side', 'top-right corner', 'bottom-left corner', 'bottom side', 'bottom-right corner'][i] ?? 'pocket';
}

// ================================================================ emotes

export function EmotePanel({ onPick, onClose }: { onPick: (id: string) => void; onClose: () => void }): JSX.Element {
  return (
    <div class="emote-panel panel" onPointerDown={(e) => e.stopPropagation()}>
      <div class="ep-emojis">
        {EMOTES.map((e, i) => (
          <button onClick={() => { onPick(`e:${i}`); onClose(); }}>{e}</button>
        ))}
      </div>
      <div class="ep-chat">
        {QUICK_CHAT.map((q, i) => (
          <button onClick={() => { onPick(`q:${i}`); onClose(); }}>{q}</button>
        ))}
      </div>
    </div>
  );
}
