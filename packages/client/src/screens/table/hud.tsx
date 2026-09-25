import type { JSX } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import {
  EMOTES,
  MAX_LIVES,
  POWER_INFO,
  QUICK_CHAT,
  TIER_LABELS,
  ballSetStyle,
  botById,
  callRequirement,
  formatRunTime,
  lowestBallId,
  modeDescriptor,
  roundName,
  seatIndex,
  activeChallenge,
  type CueStyle,
  type GameState,
  type PowerId,
  type RoomView,
  type SeatView,
} from '@8ball/shared';
import { Avatar, BallIcon, IconButton } from '../../ui/kit';
import { Icon, type IconName } from '../../ui/Icon';
import { SAFE_SPIN, type AimControls, type ShotType } from '../../game/controls';
import type { GameClient } from '../../net/client';
import { haptic } from '../../state/settings';
import { uiTap, arm as armSound } from '../../audio/sfx';

export const SEAT_COLORS = ['var(--p1)', 'var(--p2)', 'var(--p3)', 'var(--p4)', 'var(--p5)', 'var(--p6)', 'var(--p7)', 'var(--p8)'];

/** How much room the HUD has: a wide screen, a short landscape phone, or a tall portrait one. */
export type HudLayout = 'wide' | 'short' | 'tall';

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

/** An id that is safe inside `url(#…)`, unique per component instance. */
function useSvgId(prefix: string): string {
  return prefix + useId().replace(/\W/g, '');
}

const SOLIDS = [1, 2, 3, 4, 5, 6, 7];
const STRIPES = [9, 10, 11, 12, 13, 14, 15];

// ================================================================ player cards

/** The avatar with the shot clock run round it as a ring, lit in the seat colour on its turn. */
function ClockAvatar({ view, size, turn, clock, bot, dim }: { view: SeatView | null; size: number; turn: boolean; clock: number | null; bot: boolean; dim: boolean }): JSX.Element {
  const box = size + 10;
  const c = box / 2;
  const r = size / 2 + 3;
  const circ = 2 * Math.PI * r;
  const low = turn && clock !== null && clock < 0.25;
  return (
    <span class={`clock-av ${turn ? 'is-turn' : ''} ${low ? 'is-low' : ''}`} style={{ width: `${box}px`, height: `${box}px` }}>
      <svg class="clock-ring" viewBox={`0 0 ${box} ${box}`} aria-hidden="true">
        <circle class="cr-track" cx={c} cy={c} r={r} />
        {turn && (
          <circle
            class="cr-fill"
            cx={c}
            cy={c}
            r={r}
            stroke-dasharray={`${circ}`}
            stroke-dashoffset={`${clock === null ? 0 : circ * (1 - clock)}`}
            transform={`rotate(-90 ${c} ${c})`}
          />
        )}
      </svg>
      <Avatar avatar={view?.avatar ?? { icon: '🎱', color: '#666' }} size={size} bot={bot} dim={dim} />
    </span>
  );
}

/** Balls potted in an unbroken visit, as a flame and a count. */
function Streak({ n }: { n: number }): JSX.Element {
  const id = useSvgId('fl');
  return (
    <span class="streak" title={`${n} in a row`}>
      <svg class="streak-flame" viewBox="0 0 16 20" aria-hidden="true">
        <defs>
          <linearGradient id={id} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stop-color="#ff3d1f" />
            <stop offset="0.55" stop-color="#ff9a1a" />
            <stop offset="1" stop-color="#ffe066" />
          </linearGradient>
        </defs>
        <path d="M8 1c1 4 5 6 5 11a5 5 0 01-10 0c0-2.5 1.5-4 2.5-5 0 2 1 3 2 3C8 7 6.5 4.5 8 1z" fill={`url(#${id})`} />
        <path d="M8 11c1 1.3 2.2 2 2.2 3.6a2.2 2.2 0 01-4.4 0c0-1.2.9-2 2.2-3.6z" fill="#fff3b0" />
      </svg>
      <b class="tabular">{n}</b>
    </span>
  );
}

/** The seat's group as a rack of mini balls; potted ones leave an empty socket. */
function GroupBalls({ game, seat, set, size }: { game: GameState; seat: string; set: string; size: number }): JSX.Element {
  const p = game.players[seat];
  if (!p.group) {
    const breaking = game.phase === 'break' && game.currentShooter === seat;
    return <span class={`card-sub ${breaking ? 'gold' : ''}`}>{breaking ? 'To break' : 'Open table'}</span>;
  }
  const ids = p.group === 'solid' ? SOLIDS : STRIPES;
  const potted = (id: number) => game.balls.find((b) => b.id === id)?.pocketed ?? true;
  if (ids.every(potted)) {
    return (
      <span class="card-balls is-eight">
        <BallIcon id={8} size={size + 2} set={set} />
        <span class="card-sub gold">On the 8</span>
      </span>
    );
  }
  return (
    <span class="card-balls" aria-label={`${ids.filter((id) => !potted(id)).length} ${p.group}s left`}>
      {ids.map((id) => (potted(id) ? <span key={id} class="chip-socket" style={{ width: `${size}px`, height: `${size}px` }} /> : <BallIcon key={id} id={id} size={size} set={set} />))}
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
  layout,
}: {
  seat: string;
  view: SeatView | null;
  game: GameState;
  room: RoomView;
  turn: boolean;
  clock: number | null;
  mine: boolean;
  /** One of three or more seats: name and score only. */
  compact: boolean;
  side: 'left' | 'right';
  layout: HudLayout;
}): JSX.Element {
  const i = seatIndex(seat);
  const p = game.players[seat];
  const color = SEAT_COLORS[i % SEAT_COLORS.length];
  const bot = !!(view?.kind === 'bot' || view?.covering);
  const tier = view?.botId ? botById(view.botId)?.tier : null;
  const team = p?.team;
  const wins = room.match?.wins[i] ?? 0;
  const small = compact || layout !== 'wide';
  const streak = turn && game.visitRun >= 2 ? game.visitRun : 0;
  const chip = layout === 'wide' ? 17 : layout === 'short' ? 13 : 12;
  return (
    <div
      class={`pcard pcard-${side} ${turn ? 'is-turn' : ''} ${compact ? 'is-compact' : ''} ${p?.eliminated ? 'is-out' : ''} ${mine ? 'is-mine' : ''}`}
      style={{ '--seat': team ? (team === 'a' ? 'var(--p1)' : 'var(--p2)') : color }}
    >
      <ClockAvatar view={view} size={small ? (layout === 'wide' ? 38 : 32) : 46} turn={turn} clock={clock} bot={bot} dim={!!p?.eliminated || (view !== null && !view.connected)} />
      <div class="pcard-text">
        <div class="pcard-name">
          <span class="name">{p?.name ?? view?.name}</span>
          {!compact && layout !== 'tall' && <span class="lvl">{tier ? TIER_LABELS[tier] : `Lv ${view?.level ?? 1}`}</span>}
          {streak > 0 && <Streak n={streak} />}
          {view && !view.connected && !bot && <Icon name="wifiOff" size={14} class="warn" />}
        </div>
        {!compact && (
          <div class="pcard-detail">
            {game.mode === 'eightball' && <GroupBalls game={game} seat={seat} set={room.balls} size={chip} />}
            {game.mode === 'killer' && <Lives lives={p?.lives ?? 0} />}
            {game.mode === 'power' && (
              <>
                <span class="card-score tabular">{p?.score ?? 0}</span>
                <Powers held={game.power?.held[seat] ?? []} armed={game.power?.armed ?? null} active={turn} />
              </>
            )}
            {game.mode === 'nineball' && <span class={`card-sub ${turn ? 'gold' : ''}`}>{turn ? (mine ? 'Your shot' : 'At the table') : 'Waiting'}</span>}
          </div>
        )}
        {compact && game.mode === 'killer' && <Lives lives={p?.lives ?? 0} />}
        {compact && game.mode === 'power' && <span class="card-score tabular">{p?.score ?? 0}</span>}
      </div>
      {compact && (room.match?.raceTo ?? 1) > 1 && <span class="pcard-wins tabular">{wins}</span>}
    </div>
  );
}

/** Frames won by each side of a duel, in their seat colours. */
export interface DuelScore {
  wins: [number, number];
  colors: [string, string];
}

export function MatchStatus({ room, game, score }: { room: RoomView; game: GameState; score?: DuelScore | null }): JSX.Element {
  const desc = modeDescriptor(game.mode);
  const t = room.tournament;
  const tie = t?.current ? t.bracket.matches.find((m) => m.id === t.current) : null;
  const lowest = game.mode === 'nineball' ? lowestBallId(game) : null;
  const k = room.king;
  const race = room.match?.raceTo ?? 1;
  let detail: string | null = null;
  if (tie && t) detail = roundName(t.bracket, tie.round);
  else if (k) detail = `Streak ${k.streak}/${k.target}`;
  else if (race > 1) detail = `Frame ${room.match!.frame} · Race to ${race}`;
  return (
    <div class="match-status">
      <span class="ms-mode">{desc.name}</span>
      {score && race > 1 && (
        <span class="ms-score tabular" aria-label={`${score.wins[0]} frames to ${score.wins[1]}`}>
          <b style={{ color: score.colors[0] }}>{score.wins[0]}</b>
          <i />
          <b style={{ color: score.colors[1] }}>{score.wins[1]}</b>
        </span>
      )}
      {detail && <span class="ms-detail">{detail}</span>}
      {lowest !== null && (
        <span class="ms-lowest">
          Next <BallIcon id={lowest} size={20} set={room.balls} />
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
      <div class="solo-status is-timed">
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
        <span class="ms-detail ms-brief">{c?.brief}</span>
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
        <span class="ms-detail ms-brief">Drag the cue ball to set up any shot</span>
      </div>
    );
  }
  return null;
}

// ================================================================ the cue

/** Cue length and width in art units; the tip is at 0. */
const CUE_L = 400;
const CUE_W = 24;

/**
 * Half-widths down a stylised cue, tip to bumper. The proportions are a real cue's with the tip,
 * ferrule and joint exaggerated so they still read at the size of a power meter.
 */
const CUE_PROFILE: [number, number][] = [
  [0, 3],
  [3, 4.1],
  [9, 4.3],
  [20, 4.4],
  [188, 5.9],
  [188, 6.5],
  [200, 6.5],
  [200, 6.1],
  [296, 8.2],
  [360, 8.8],
  [360, 9.2],
  [394, 9.6],
  [397, 9.2],
  [400, 8],
];

const cueEdge = (k: number) => CUE_PROFILE.map(([y, r]) => `${(CUE_W / 2 + r * k).toFixed(2)} ${y}`).join('L');
const CUE_OUTLINE = `M${cueEdge(-1)}L${[...CUE_PROFILE].reverse().map(([y, r]) => `${(CUE_W / 2 + r).toFixed(2)} ${y}`).join('L')}Z`;
const CUE_SHINE = `M${cueEdge(-0.42)}`;
const CUE_SHADE = `M${cueEdge(0.62)}`;

/** Whether text or lines over a colour should be dark. */
function isLight(hex: string): boolean {
  const n = parseInt(hex.replace('#', ''), 16);
  return ((n >> 16) & 255) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11 > 150;
}

/** The forearm's livery for each cue pattern, between the joint (y 200) and the wrap (y 296). */
function CueLivery({ style, id }: { style: CueStyle; id: string }): JSX.Element | null {
  const { accent, shaft, butt } = style;
  switch (style.pattern) {
    case 'plain':
      return (
        <g fill="none" stroke="#000" stroke-opacity="0.22" stroke-width="0.6">
          <path d="M8 200c1 30-1 60 1 96M13 200c-1 34 2 62 0 96M16.5 204c1 28-1 58 1 92" />
          <rect x="0" y="286" width={CUE_W} height="2.4" fill={accent} stroke="none" />
        </g>
      );
    case 'carbon':
      return (
        <>
          <rect x="0" y="200" width={CUE_W} height="96" fill={`url(#${id}weave)`} />
          <rect x="0" y="290" width={CUE_W} height="3" fill={accent} />
        </>
      );
    case 'points':
      return (
        <g>
          <path d="M5 296L12 212L19 296Z" fill={accent} />
          <path d="M8.2 296L12 234L15.8 296Z" fill={shaft} />
          <path d="M0 296H3.4L0 244Z" fill={accent} />
          <path d={`M${CUE_W} 296H${CUE_W - 3.4}L${CUE_W} 244Z`} fill={accent} />
          <rect x="0" y="288" width={CUE_W} height="1.6" fill={accent} />
        </g>
      );
    case 'rings':
      return (
        <g fill={accent}>
          {[0, 1, 2, 3, 4, 5].map((k) => (
            <rect x="0" y={210 + k * 14} width={CUE_W} height="3" />
          ))}
          <g filter={`url(#${id}blur)`} opacity="0.8">
            {[0, 1, 2, 3, 4, 5].map((k) => (
              <rect x="0" y={209 + k * 14} width={CUE_W} height="5" />
            ))}
          </g>
        </g>
      );
    case 'flame':
      return (
        <g>
          <path d="M4.5 296C5 272 9 262 8 240C11 252 12 234 12 212C14 234 17 246 16 232C18.5 254 19.5 272 19.5 296Z" fill={`url(#${id}fire)`} />
          <path d="M-1 296C0 280 2.5 272 1.5 256C4 268 5.5 280 6 296Z" fill={`url(#${id}fire)`} />
          <path d={`M${CUE_W + 1} 296C${CUE_W} 282 ${CUE_W - 2.5} 274 ${CUE_W - 1.5} 260C${CUE_W - 4} 270 ${CUE_W - 5.5} 282 ${CUE_W - 6} 296Z`} fill={`url(#${id}fire)`} />
          <path d="M8.5 296C9 282 11 276 12 262C13 276 15 282 15.5 296Z" fill="#ffe27a" opacity="0.85" />
        </g>
      );
    case 'ice':
      return (
        <g>
          <rect x="0" y="200" width={CUE_W} height="96" fill={`url(#${id}ice)`} />
          <path d="M7 208l3 14-2 10 3 12M15 232l-2 12 3 9-1 14M10 262l2 10-3 12M17 206l-2 11" fill="none" stroke="#fff" stroke-width="0.8" stroke-opacity="0.9" />
        </g>
      );
    case 'nebula':
      return (
        <g>
          <ellipse cx="8" cy="226" rx="8" ry="18" fill={`url(#${id}neb)`} />
          <ellipse cx="16" cy="266" rx="9" ry="22" fill={`url(#${id}neb)`} />
          <ellipse cx="11" cy="376" rx="7" ry="12" fill={`url(#${id}neb)`} />
          <g fill="#fff">
            {[
              [6, 212],
              [15, 222],
              [10, 244],
              [18, 252],
              [7, 270],
              [13, 286],
              [17, 368],
              [8, 384],
            ].map(([x, y], k) => (
              <circle cx={x} cy={y} r={k % 3 === 0 ? 0.8 : 0.5} />
            ))}
          </g>
        </g>
      );
    case 'gold':
      return (
        <g fill={accent}>
          <rect x="0" y="232" width={CUE_W} height="1.6" />
          <rect x="0" y="262" width={CUE_W} height="1.6" />
          <path d="M12 238l4 11-4 11-4-11z" opacity="0.8" />
          <rect x="0" y="380" width={CUE_W} height="1.4" fill={butt} />
        </g>
      );
    default:
      return null;
  }
}

/**
 * The shooter's own cue, drawn from its catalogue livery: tip, ferrule, shaft, joint, the
 * pattern on the forearm, wrap and butt, shaded as a turned cylinder under the lamp. A cue with a
 * glow lights up its shaft from the tip down as it is drawn back (`charge`).
 */
export function CueArt({ style, horizontal = false, reverse = false, charge = 0 }: { style: CueStyle; horizontal?: boolean; reverse?: boolean; charge?: number }): JSX.Element {
  const id = useSvgId('cue');
  const gold = style.pattern === 'gold';
  const wrapInk = isLight(style.wrap) ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.08)';
  const place = !horizontal ? undefined : reverse ? `translate(${CUE_L} 0) rotate(90)` : `translate(0 ${CUE_W}) rotate(-90)`;
  return (
    <svg
      class="cue-art"
      viewBox={horizontal ? `0 0 ${CUE_L} ${CUE_W}` : `0 0 ${CUE_W} ${CUE_L}`}
      preserveAspectRatio={horizontal ? (reverse ? 'xMaxYMid meet' : 'xMinYMid meet') : 'xMidYMin meet'}
      aria-hidden="true"
      style={style.glow ? { '--cue-glow': style.glow } : undefined}
    >
      <defs>
        <clipPath id={`${id}clip`}>
          <path d={CUE_OUTLINE} />
        </clipPath>
        <linearGradient id={`${id}shaft`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color={gold ? '#fff0b8' : style.shaft} />
          <stop offset="1" stop-color={gold ? style.shaft : style.shaft} stop-opacity={gold ? 1 : 0.86} />
        </linearGradient>
        <linearGradient id={`${id}metal`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#7a5410" />
          <stop offset="0.35" stop-color="#ffe9a6" />
          <stop offset="0.6" stop-color={style.butt} />
          <stop offset="1" stop-color="#5c3d0a" />
        </linearGradient>
        <linearGradient id={`${id}fire`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stop-color="#ffd23a" />
          <stop offset="0.4" stop-color="#ff7a1a" />
          <stop offset="0.8" stop-color="#b31a0a" />
          <stop offset="1" stop-color="#b31a0a" stop-opacity="0" />
        </linearGradient>
        <linearGradient id={`${id}ice`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#f1fbff" />
          <stop offset="1" stop-color={style.butt} />
        </linearGradient>
        <radialGradient id={`${id}neb`}>
          <stop offset="0" stop-color={style.accent} stop-opacity="0.9" />
          <stop offset="0.5" stop-color={style.glow ?? style.accent} stop-opacity="0.45" />
          <stop offset="1" stop-color={style.glow ?? style.accent} stop-opacity="0" />
        </radialGradient>
        <pattern id={`${id}weave`} width="3" height="3" patternUnits="userSpaceOnUse">
          <rect width="3" height="3" fill="#16181c" />
          <rect width="1.5" height="1.5" fill="#30343b" />
          <rect x="1.5" y="1.5" width="1.5" height="1.5" fill="#30343b" />
        </pattern>
        <pattern id={`${id}wrap`} width="3.2" height="3.2" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
          <rect width="3.2" height="1.1" fill={wrapInk} />
        </pattern>
        <filter id={`${id}blur`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.6" />
        </filter>
      </defs>
      <g transform={place}>
        <g clip-path={`url(#${id}clip)`}>
          <rect x="0" y="0" width={CUE_W} height="9" fill="#3f78e0" />
          <rect x="0" y="9" width={CUE_W} height="11" fill="#f3efe4" />
          <rect x="0" y="20" width={CUE_W} height="168" fill={`url(#${id}shaft)`} />
          {style.pattern === 'nebula' && <rect x="0" y="20" width={CUE_W} height="168" fill={`url(#${id}neb)`} opacity="0.35" />}
          <rect x="0" y="188" width={CUE_W} height="12" fill={gold ? `url(#${id}metal)` : style.accent} />
          <rect x="0" y="192.5" width={CUE_W} height="2.8" fill="#111" />
          <rect x="0" y="200" width={CUE_W} height="96" fill={gold ? `url(#${id}metal)` : style.butt} />
          <CueLivery style={style} id={id} />
          <rect x="0" y="296" width={CUE_W} height="64" fill={style.wrap} />
          <rect x="0" y="296" width={CUE_W} height="64" fill={`url(#${id}wrap)`} />
          <rect x="0" y="296" width={CUE_W} height="2.4" fill={style.accent} />
          <rect x="0" y="357.6" width={CUE_W} height="2.4" fill={style.accent} />
          <rect x="0" y="360" width={CUE_W} height="34" fill={gold ? `url(#${id}metal)` : style.pattern === 'carbon' ? `url(#${id}weave)` : style.butt} />
          <rect x="0" y="372" width={CUE_W} height="2.4" fill={style.accent} />
          <rect x="0" y="394" width={CUE_W} height="6" fill="#0b0b0b" />
          {style.glow && charge > 0 && (
            <g fill={style.glow}>
              <rect x={CUE_W / 2 - 1.1} y="20" width="2.2" height={168 * charge} />
              <rect x={CUE_W / 2 - 3} y="20" width="6" height={168 * charge} filter={`url(#${id}blur)`} opacity="0.9" />
            </g>
          )}
          {/* Turned-cylinder shading: dark edges, a shadowed far side and a lamp highlight. */}
          <path d={CUE_OUTLINE} fill="none" stroke="#000" stroke-opacity={style.metalness > 0.5 ? 0.5 : 0.38} stroke-width="3" />
          <path d={CUE_SHADE} fill="none" stroke="#000" stroke-opacity="0.26" stroke-width="3.2" />
          <path d={CUE_SHINE} fill="none" stroke="#fff" stroke-opacity="0.16" stroke-width="3.4" />
          <path d={CUE_SHINE} fill="none" stroke="#fff" stroke-opacity={style.metalness > 0.5 ? 0.85 : 0.6} stroke-width="1.1" />
        </g>
        <path d={CUE_OUTLINE} fill="none" stroke="#000" stroke-opacity="0.55" stroke-width="0.7" />
      </g>
    </svg>
  );
}

// ================================================================ power bar

/**
 * The pull-back power cue. Drag it back (down, or along in portrait) to load the shot: the cue
 * slides out of its slot and the charge fills behind the tip; let go to shoot.
 */
export function PowerBar({
  controls,
  enabled,
  horizontal,
  reverse = false,
  cue,
}: {
  controls: AimControls;
  enabled: boolean;
  horizontal: boolean;
  /** Pull toward the left instead (left-handed, portrait). */
  reverse?: boolean;
  cue: CueStyle;
}): JSX.Element {
  const track = useRef<HTMLDivElement>(null);
  const start = useRef(0);
  const power = controls.power.value;
  const charging = controls.charging.value;

  const setFrom = (e: PointerEvent) => {
    const r = track.current!.getBoundingClientRect();
    const span = horizontal ? r.width : r.height;
    const d = horizontal ? (e.clientX - start.current) * (reverse ? -1 : 1) : e.clientY - start.current;
    controls.setPower(Math.max(0, Math.min(1, d / (span * 0.85))));
  };

  return (
    <div
      class={`powerbar ${horizontal ? 'is-h' : ''} ${reverse ? 'is-rev' : ''} ${enabled ? '' : 'is-off'} ${charging ? 'is-charging' : ''} ${power > 0.85 ? 'is-hot' : ''}`}
      style={{ '--p': power, '--cue-glow': cue.glow ?? 'var(--gold)' }}
    >
      <div
        ref={track}
        class="pb-track"
        role="slider"
        aria-label="Shot power: drag back and release to shoot"
        aria-valuenow={Math.round(power * 100)}
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
        <div class="pb-well">
          <div class="pb-fill" />
          <div class="pb-ticks">
            {[0.25, 0.5, 0.75].map((t) => (
              <span style={{ '--t': t }} />
            ))}
          </div>
          <div class="pb-cue">
            <CueArt style={cue} horizontal={horizontal} reverse={reverse} charge={charging ? power : 0} />
          </div>
        </div>
      </div>
      <div class="pb-label tabular">
        {charging ? (
          `${Math.round(power * 100)}%`
        ) : enabled ? (
          <>
            Pull <Icon name={horizontal ? (reverse ? 'back' : 'forward') : 'chevronDown'} size={14} stroke={2.6} />
          </>
        ) : null}
      </div>
    </div>
  );
}

// ================================================================ ball return

/**
 * The glass ball return. Potted balls drop in at the mouth and roll down to rest on the ones
 * already there, first potted at the far end.
 */
export function BallReturn({ potted, set, horizontal }: { potted: number[]; set: string; horizontal: boolean }): JSX.Element {
  return (
    <div class={`ball-return ${horizontal ? 'is-h' : ''} ${potted.length ? '' : 'is-empty'}`} aria-label={potted.length ? `Potted: ${potted.join(', ')}` : 'Ball return, empty'}>
      <div class="br-tube">
        <span class="br-mouth" />
        <div class="br-stack">
          {potted.map((id, i) => (
            <span class="br-ball" key={id} style={{ '--i': i }}>
              <BallIcon id={id} size={28} set={set} />
            </span>
          ))}
        </div>
        <span class="br-glass" />
      </div>
    </div>
  );
}

// ================================================================ dock

/**
 * The cue ball face on, with the tip's contact point where the spin is set. `reach` is how far
 * (of the ball's 20-unit radius) full spin sits from centre; `zones` shades the miscue band.
 */
function CueBallFace({ spin, size, set, danger, reach = 15.6, zones }: { spin: { x: number; y: number }; size: number; set: string; danger?: boolean; reach?: number; zones?: boolean }): JSX.Element {
  const id = useSvgId('cf');
  const style = ballSetStyle(set);
  const safe = reach * SAFE_SPIN;
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" class="cueface" aria-hidden="true">
      <defs>
        <radialGradient id={`${id}s`} cx="38%" cy="32%" r="68%">
          <stop offset="0.5" stop-color="#000" stop-opacity="0" />
          <stop offset="0.86" stop-color="#000" stop-opacity="0.2" />
          <stop offset="1" stop-color="#000" stop-opacity="0.5" />
        </radialGradient>
        <radialGradient id={`${id}g`} cx="33%" cy="27%" r="36%">
          <stop offset="0" stop-color="#fff" stop-opacity="0.7" />
          <stop offset="1" stop-color="#fff" stop-opacity="0" />
        </radialGradient>
      </defs>
      <circle cx="20" cy="20" r="19" fill={style.cue} />
      <circle cx="20" cy="20" r="19" fill={`url(#${id}s)`} />
      <circle cx="20" cy="20" r="19" fill={`url(#${id}g)`} />
      {zones && <circle cx="20" cy="20" r={(safe + reach) / 2} fill="none" stroke="#ff503c" stroke-opacity="0.3" stroke-width={reach - safe} />}
      <path d="M20 4.5v31M4.5 20h31" stroke="#000" stroke-opacity="0.13" stroke-width="0.8" />
      <circle cx="20" cy="20" r={safe} fill="none" stroke="#000" stroke-opacity="0.12" stroke-width="0.6" stroke-dasharray="1.6 1.6" />
      <ellipse cx="13.4" cy="11.2" rx="4.6" ry="2.6" transform="rotate(-38 13.4 11.2)" fill="#fff" opacity="0.9" />
      <circle cx={20 + spin.x * reach} cy={20 + spin.y * reach} r="4.4" fill={danger ? '#ff5a3c' : '#e8313b'} stroke="#fff" stroke-width="1.4" />
      <circle cx={19 + spin.x * reach} cy={19 + spin.y * reach} r="1.2" fill="#fff" opacity="0.7" />
      <circle cx="20" cy="20" r="19.1" fill="none" stroke="#000" stroke-opacity="0.45" stroke-width="0.9" />
    </svg>
  );
}

const SHOT_TYPES: { id: ShotType; label: string; hint: string; icon: IconName }[] = [
  { id: 'normal', label: 'Normal', hint: 'Level cue', icon: 'shotLevel' },
  { id: 'swerve', label: 'Swerve', hint: 'Raised cue + side spin curves the ball', icon: 'shotSwerve' },
  { id: 'jump', label: 'Jump', hint: 'Steep cue lifts the ball over others', icon: 'shotJump' },
];

export function SpinPicker({ controls, set, onClose }: { controls: AimControls; set: string; onClose: () => void }): JSX.Element {
  const pad = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(false);
  const s = controls.spin.value;
  const put = (e: PointerEvent) => {
    const r = pad.current!.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 2 - 1;
    const y = ((e.clientY - r.top) / r.height) * 2 - 1;
    controls.setSpin(x / 0.82, y / 0.82);
  };
  const danger = Math.hypot(s.x, s.y) > SAFE_SPIN;
  return (
    <div class="spin-picker panel" onPointerDown={(e) => e.stopPropagation()}>
      <div class="sp-head">
        <span>Spin & shot</span>
        <IconButton icon="close" label="Close" onClick={onClose} sound="back" />
      </div>
      <div class="sp-main">
        <div
          ref={pad}
          class={`sp-pad ${danger ? 'is-danger' : ''}`}
          onPointerDown={(e) => {
            (e.currentTarget as Element).setPointerCapture(e.pointerId);
            setDrag(true);
            put(e);
          }}
          onPointerMove={(e) => drag && put(e)}
          onPointerUp={() => setDrag(false)}
        >
          <CueBallFace spin={s} size={200} set={set} danger={danger} reach={20 * 0.82} zones />
        </div>
        <div class="sp-side">
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
        </div>
      </div>
      <div class="sp-types">
        {SHOT_TYPES.map((t) => (
          <button class={controls.shotType.value === t.id ? 'is-on' : ''} title={t.hint} onClick={() => { uiTap(); controls.setShotType(t.id); }}>
            <Icon name={t.icon} size={22} />
            <strong>{t.label}</strong>
            <small>{t.hint}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

/** A knurled wheel: drag it sideways (or up and down, stood on end) to turn the aim a hair. */
function FineAim({ controls, enabled, vertical }: { controls: AimControls; enabled: boolean; vertical: boolean }): JSX.Element {
  const last = useRef<number | null>(null);
  const [offset, setOffset] = useState(0);
  return (
    <div
      class={`fine-aim ${enabled ? '' : 'is-off'} ${vertical ? 'is-v' : ''}`}
      title="Drag for fine aim"
      role="slider"
      aria-label="Fine aim"
      onPointerDown={(e) => {
        if (!enabled) return;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        last.current = vertical ? e.clientY : e.clientX;
      }}
      onPointerMove={(e) => {
        if (last.current === null) return;
        const at = vertical ? e.clientY : e.clientX;
        const d = at - last.current;
        last.current = at;
        controls.nudge(d * 0.0009);
        setOffset((o) => o + d);
      }}
      onPointerUp={() => (last.current = null)}
      onPointerCancel={() => (last.current = null)}
    >
      <div class="fa-ridges" style={{ [vertical ? 'backgroundPositionY' : 'backgroundPositionX']: `${offset}px` }} />
      <span class="fa-notch" />
    </div>
  );
}

export function Dock({
  client,
  controls,
  game,
  room,
  layout,
  onEmote,
  onSpin,
  spinOpen,
}: {
  client: GameClient;
  controls: AimControls;
  game: GameState;
  room: RoomView;
  layout: HudLayout;
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
  const type = SHOT_TYPES.find((t) => t.id === controls.shotType.value) ?? SHOT_TYPES[0];
  const nextType = SHOT_TYPES[(SHOT_TYPES.indexOf(type) + 1) % SHOT_TYPES.length];
  const vertical = layout === 'short';

  return (
    <div class={`dock ${vertical ? 'is-v' : ''} ${myTurn ? '' : 'is-waiting'}`}>
      {myTurn ? (
        <>
          <button class={`dock-spin ${spinOpen ? 'is-on' : ''}`} onClick={() => { uiTap(); onSpin(); }} aria-label="Spin and shot type" title="Spin (S)">
            <CueBallFace spin={controls.spin.value} size={vertical ? 38 : 40} set={room.balls} />
            <span class="dock-cap">Spin</span>
          </button>
          <button
            class={`dock-type ${type.id !== 'normal' ? 'is-on' : ''}`}
            onClick={() => {
              uiTap();
              controls.setShotType(nextType.id);
            }}
            aria-label={`Shot type: ${type.label}. Tap for ${nextType.label}`}
            title={`${type.label} — ${type.hint} (1 2 3)`}
          >
            <Icon name={type.icon} size={22} />
            <span class="dock-cap">{type.label}</span>
          </button>
          <FineAim controls={controls} enabled={!placing} vertical={vertical} />
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
              <span class="gold">Break! Pull the power cue hard</span>
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
          <span class="wait-text">
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
