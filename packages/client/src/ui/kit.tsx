import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { ballColor, ballSetStyle, type Avatar as AvatarData, type BallSetStyle, type Rarity } from '@8ball/shared';
import { Icon, type IconName } from './Icon';
import { uiBack, uiConfirm, uiTap, unlockAudio } from '../audio/sfx';
import { haptic } from '../state/settings';

// ------------------------------------------------------------------ buttons

type ButtonKind = 'primary' | 'secondary' | 'ghost' | 'danger' | 'mint';

export function Button({
  kind = 'secondary',
  size = 'md',
  icon,
  iconRight,
  children,
  onClick,
  disabled,
  class: cls,
  block,
  sound = 'tap',
  title,
  type,
}: {
  kind?: ButtonKind;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  icon?: IconName;
  iconRight?: IconName;
  children?: ComponentChildren;
  onClick?: (e: MouseEvent) => void;
  disabled?: boolean;
  class?: string;
  block?: boolean;
  sound?: 'tap' | 'back' | 'confirm' | 'none';
  title?: string;
  type?: 'button' | 'submit';
}): JSX.Element {
  return (
    <button
      type={type ?? 'button'}
      title={title}
      class={`btn btn-${kind} btn-${size} ${block ? 'btn-block' : ''} ${cls ?? ''}`}
      disabled={disabled}
      onClick={(e) => {
        unlockAudio();
        if (sound === 'tap') uiTap();
        else if (sound === 'back') uiBack();
        else if (sound === 'confirm') uiConfirm();
        haptic(8);
        onClick?.(e);
      }}
    >
      {icon && <Icon name={icon} size={size === 'sm' ? 16 : size === 'xl' ? 24 : 19} />}
      {children && <span class="btn-label">{children}</span>}
      {iconRight && <Icon name={iconRight} size={size === 'sm' ? 16 : 19} />}
    </button>
  );
}

export function IconButton({
  icon,
  onClick,
  label,
  class: cls,
  badge,
  sound = 'tap',
  active,
}: {
  icon: IconName;
  onClick?: (e: MouseEvent) => void;
  label: string;
  class?: string;
  badge?: number | string | null;
  sound?: 'tap' | 'back';
  active?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      class={`icon-btn ${active ? 'is-active' : ''} ${cls ?? ''}`}
      aria-label={label}
      title={label}
      onClick={(e) => {
        unlockAudio();
        if (sound === 'back') uiBack();
        else uiTap();
        haptic(8);
        onClick?.(e);
      }}
    >
      <Icon name={icon} size={20} />
      {badge !== undefined && badge !== null && badge !== 0 && <span class="badge">{badge}</span>}
    </button>
  );
}

// ------------------------------------------------------------------ panels & text

export function Panel({ children, class: cls, style }: { children: ComponentChildren; class?: string; style?: JSX.CSSProperties }): JSX.Element {
  return (
    <div class={`panel ${cls ?? ''}`} style={style}>
      {children}
    </div>
  );
}

export function SectionTitle({ children, right }: { children: ComponentChildren; right?: ComponentChildren }): JSX.Element {
  return (
    <div class="section-title">
      <h3>{children}</h3>
      {right}
    </div>
  );
}

export function Pill({ children, tone = 'default', icon }: { children: ComponentChildren; tone?: 'default' | 'gold' | 'mint' | 'coral' | 'sky' | 'violet'; icon?: IconName }): JSX.Element {
  return (
    <span class={`pill pill-${tone}`}>
      {icon && <Icon name={icon} size={13} stroke={2.4} />}
      {children}
    </span>
  );
}

export function RarityTag({ rarity }: { rarity: Rarity }): JSX.Element {
  return <span class={`rarity rarity-${rarity}`}>{rarity}</span>;
}

export function ProgressBar({ value, tone = 'gold', label }: { value: number; tone?: 'gold' | 'mint' | 'sky'; label?: string }): JSX.Element {
  return (
    <div class={`progress progress-${tone}`} role="progressbar" aria-valuenow={Math.round(value * 100)} aria-label={label}>
      <div class="progress-fill" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}

export function CoinIcon({ size = 18 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" class="coin-icon" aria-hidden="true">
      <defs>
        <radialGradient id="cg" cx="35%" cy="30%" r="75%">
          <stop offset="0" stop-color="#fff3b8" />
          <stop offset="0.45" stop-color="#ffc83d" />
          <stop offset="1" stop-color="#c77a0a" />
        </radialGradient>
      </defs>
      <circle cx="12" cy="12" r="10.5" fill="url(#cg)" stroke="#8a5200" stroke-width="1" />
      <circle cx="12" cy="12" r="7" fill="none" stroke="#a86300" stroke-opacity="0.55" stroke-width="1.2" />
      <text x="12" y="16.2" text-anchor="middle" font-size="10.5" font-weight="900" fill="#8a5200" font-family="Outfit Variable, sans-serif">
        8
      </text>
    </svg>
  );
}

export function Coins({ amount, size = 'md' }: { amount: number; size?: 'sm' | 'md' | 'lg' }): JSX.Element {
  return (
    <span class={`coins coins-${size}`}>
      <CoinIcon size={size === 'lg' ? 24 : size === 'sm' ? 15 : 18} />
      <span class="tabular">{amount.toLocaleString()}</span>
    </span>
  );
}

// ------------------------------------------------------------------ avatar & balls

export function Avatar({
  avatar,
  size = 44,
  ring,
  ringProgress,
  bot,
  dim,
}: {
  avatar: AvatarData;
  size?: number;
  ring?: string;
  /** 0..1 of a countdown ring, drawn over the edge. */
  ringProgress?: number | null;
  bot?: boolean;
  dim?: boolean;
}): JSX.Element {
  const r = size / 2;
  const circ = 2 * Math.PI * (r - 2);
  return (
    <span class={`avatar ${dim ? 'is-dim' : ''}`} style={{ width: `${size}px`, height: `${size}px`, '--av': avatar.color, '--ring': ring ?? 'transparent' }}>
      <span class="avatar-face" style={{ fontSize: `${size * 0.52}px` }}>
        {avatar.icon}
      </span>
      {ringProgress !== undefined && ringProgress !== null && (
        <svg class="avatar-clock" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle cx={r} cy={r} r={r - 2} fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="3" />
          <circle
            cx={r}
            cy={r}
            r={r - 2}
            fill="none"
            stroke={ringProgress < 0.25 ? 'var(--coral)' : 'var(--gold)'}
            stroke-width="3"
            stroke-linecap="round"
            stroke-dasharray={`${circ}`}
            stroke-dashoffset={`${circ * (1 - ringProgress)}`}
            transform={`rotate(-90 ${r} ${r})`}
          />
        </svg>
      )}
      {bot && (
        <span class="avatar-bot" title="Computer player">
          <Icon name="bot" size={Math.max(10, size * 0.28)} stroke={2.4} />
        </span>
      )}
    </span>
  );
}

function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** `a` blended toward `b` by `t`, as a CSS colour. */
function mixHex(a: string, b: string, t: number): string {
  const x = hexRgb(a);
  const y = hexRgb(b);
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',')})`;
}

/** Stable 0..1 values per ball, so a marble's veins or a planet's craters never reshuffle. */
function ballRand(id: number, k: number): number {
  const s = Math.sin(id * 12.9898 + k * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * A belt around the ball seen from a little above: both edges sag toward the viewer, which is
 * most of what makes a flat circle read as a sphere. `h` is the half-height in icon units.
 */
function beltPath(h: number): string {
  const y = 21.4;
  return `M-1 ${y - h - 1.6}Q20 ${y - h + 1.6} 41 ${y - h - 1.6}L41 ${y + h - 1.6}Q20 ${y + h + 1.6} -1 ${y + h - 1.6}Z`;
}

/** The finish-specific surface of one ball, painted inside the body group. */
function BallSurface({ style, id, uid }: { style: BallSetStyle; id: number; uid: string }): JSX.Element {
  const finish = style.finish;
  const color = ballColor(style, id);
  const cue = id === 0;
  const stripe = id >= 9;
  // Where the ball's own colour lives: a stripe's belt, a glow or gold ball's band, or everywhere.
  const belt = cue ? 0 : stripe ? 9.6 : finish === 'neon' ? 4.6 : finish === 'gold' && id !== 8 ? 6.2 : 0;
  const shell = cue ? style.cue : belt ? style.base : color;
  const metal = (c: string) => (finish === 'chrome' ? `url(#${uid}m${c === color ? 'c' : 'b'})` : finish === 'gold' && c !== style.base && !cue ? `url(#${uid}au)` : c);
  const veins = [0, 1, 2].map((k) => {
    const x0 = ballRand(id, k) * 40;
    const x1 = ballRand(id, k + 3) * 40;
    return `M${x0} -2C${x0 + 14 - ballRand(id, k + 6) * 28} 12 ${x1 - 10 + ballRand(id, k + 9) * 20} 28 ${x1} 42`;
  });
  return (
    <>
      {finish === 'chrome' && (
        <defs>
          {[
            ['c', color],
            ['b', cue ? style.cue : style.base],
          ].map(([k, c]) => (
            <linearGradient id={`${uid}m${k}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color={mixHex(c, '#ffffff', 0.85)} />
              <stop offset="0.4" stop-color={mixHex(c, '#ffffff', 0.18)} />
              <stop offset="0.5" stop-color={mixHex(c, '#000000', 0.6)} />
              <stop offset="0.58" stop-color={mixHex(c, '#000000', 0.25)} />
              <stop offset="1" stop-color={mixHex(c, '#ffffff', 0.6)} />
            </linearGradient>
          ))}
        </defs>
      )}
      {finish === 'gold' && (
        <defs>
          <linearGradient id={`${uid}au`} x1="0" y1="0" x2="0.3" y2="1">
            <stop offset="0" stop-color="#fff4c8" />
            <stop offset="0.32" stop-color={color} />
            <stop offset="0.55" stop-color="#8f6118" />
            <stop offset="0.72" stop-color={color} />
            <stop offset="1" stop-color="#fff0b0" />
          </linearGradient>
        </defs>
      )}
      <rect x="-1" y="-1" width="42" height="42" fill={metal(shell)} />
      {belt > 0 && <path d={beltPath(belt)} fill={metal(color)} />}
      {finish === 'marble' && !cue && (
        <g fill="none" stroke-linecap="round">
          <ellipse cx={8 + ballRand(id, 12) * 24} cy={10 + ballRand(id, 13) * 20} rx="9" ry="5" fill="#000" opacity="0.14" />
          {veins.map((d, k) => (
            <path d={d} stroke={id === 8 ? '#9a9aa4' : '#fffdf6'} stroke-width={k === 0 ? 1.3 : 0.7} opacity={k === 0 ? 0.55 : 0.35} />
          ))}
        </g>
      )}
      {finish === 'planet' && stripe && (
        <clipPath id={`${uid}belt`}>
          <path d={beltPath(belt)} />
        </clipPath>
      )}
      {finish === 'planet' && !cue && (
        <g clip-path={stripe ? `url(#${uid}belt)` : undefined}>
          {[
            [6.5, 1.8, 0.3],
            [13.5, 2.6, -0.3],
            [28.5, 2.3, 0.35],
            [34.5, 1.6, -0.25],
          ].map(([y, h, t]) => (
            <path d={`M-1 ${y - h - 1.2}Q20 ${y - h + 1.2} 41 ${y - h - 1.2}L41 ${y + h - 1.2}Q20 ${y + h + 1.2} -1 ${y + h - 1.2}Z`} fill={t > 0 ? mixHex(color, '#fff6e0', t) : mixHex(color, '#000000', -t)} />
          ))}
        </g>
      )}
      {finish === 'planet' && cue && (
        <g>
          {[
            [13, 26, 3.4],
            [27, 13, 2.6],
            [28, 28, 1.9],
            [11, 12, 1.4],
          ].map(([x, y, r]) => (
            <>
              <circle cx={x} cy={y} r={r} fill="#000" opacity="0.14" />
              <path d={`M${x - r} ${y}a${r} ${r} 0 0 0 ${r * 2} 0`} fill="none" stroke="#fff" stroke-width="0.7" opacity="0.5" />
            </>
          ))}
        </g>
      )}
      {cue && style.cueDots && (
        <g fill={style.cueDots}>
          <circle cx="20" cy="21.6" r="2.4" />
          <ellipse cx="20" cy="3.4" rx="2.2" ry="0.9" />
        </g>
      )}
      {!cue && (
        <>
          <circle cx="20" cy="21.4" r="8.6" fill={finish === 'neon' ? '#f4f4f4' : finish === 'gold' ? '#fff1c4' : style.base} />
          <circle cx="20" cy="21.4" r="8.6" fill="none" stroke="#000" stroke-opacity="0.14" stroke-width="0.8" />
          <text
            x="20"
            y={id > 9 ? 25.2 : 25.8}
            text-anchor="middle"
            font-size={id > 9 ? 10.6 : 12.4}
            font-weight="800"
            letter-spacing={id > 9 ? -0.6 : 0}
            fill={finish === 'neon' ? '#111' : style.ink}
            font-family="Outfit Variable, Outfit, sans-serif"
          >
            {id}
          </text>
        </>
      )}
    </>
  );
}

/**
 * A pool ball as SVG, in any set's colours and finish. Used wherever a ball appears in the
 * interface — the ball return, the player cards, the dock — so they all match the table.
 *
 * The painted surface sits in its own `.ball-body` group under a fixed layer of shading and
 * highlights, so a ball can be rolled (rotate the body) while the lamp stays where it is.
 */
export function BallIcon({ id, size = 22, set = 'balls.classic', dim }: { id: number; size?: number; set?: string; dim?: boolean }): JSX.Element {
  const style = ballSetStyle(set);
  const finish = style.finish;
  const uid = `bi${useId().replace(/\W/g, '')}`;
  const soft = finish === 'satin' || finish === 'planet';
  const glow = finish === 'neon' && id !== 0 ? ballColor(style, id) : null;
  return (
    <svg
      class={`ball-icon ${dim ? 'is-dim' : ''}`}
      width={size}
      height={size}
      viewBox="0 0 40 40"
      aria-label={id === 0 ? 'cue ball' : `${id} ball`}
      style={glow ? { filter: `drop-shadow(0 0 ${Math.max(1.5, size * 0.1)}px ${glow}) drop-shadow(0 1px 1.5px rgba(0,0,0,0.45))` } : undefined}
    >
      <defs>
        <clipPath id={`${uid}c`}>
          <circle cx="20" cy="20" r="19" />
        </clipPath>
        <radialGradient id={`${uid}s`} cx="38%" cy="32%" r="68%">
          <stop offset="0.55" stop-color="#000" stop-opacity="0" />
          <stop offset="0.86" stop-color="#000" stop-opacity={soft ? 0.16 : 0.24} />
          <stop offset="1" stop-color="#000" stop-opacity={soft ? 0.42 : 0.55} />
        </radialGradient>
        <radialGradient id={`${uid}g`} cx="33%" cy="27%" r="34%">
          <stop offset="0" stop-color="#fff" stop-opacity={soft ? 0.5 : 0.42} />
          <stop offset="1" stop-color="#fff" stop-opacity="0" />
        </radialGradient>
        <linearGradient id={`${uid}r`} x1="0" y1="1" x2="0.75" y2="0.25">
          <stop offset="0" stop-color="#fff" stop-opacity="0.6" />
          <stop offset="0.45" stop-color="#fff" stop-opacity="0" />
        </linearGradient>
      </defs>
      <g clip-path={`url(#${uid}c)`}>
        <g class="ball-body">
          <BallSurface style={style} id={id} uid={uid} />
        </g>
        <circle cx="20" cy="20" r="19" fill={`url(#${uid}s)`} />
        <circle cx="20" cy="20" r="19" fill={`url(#${uid}g)`} />
        <circle cx="20" cy="20" r="18.2" fill="none" stroke={`url(#${uid}r)`} stroke-width="1.5" />
        {!soft && <ellipse cx="13.4" cy="11.2" rx="5.2" ry="2.9" transform="rotate(-38 13.4 11.2)" fill="#fff" opacity="0.92" />}
        <ellipse cx="28" cy="30.4" rx="2.4" ry="1.1" transform="rotate(-38 28 30.4)" fill="#fff" opacity={soft ? 0.22 : 0.4} />
      </g>
      <circle cx="20" cy="20" r="19.1" fill="none" stroke="#000" stroke-opacity="0.5" stroke-width="0.9" />
    </svg>
  );
}

// ------------------------------------------------------------------ controls

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  disabled,
  size = 'md',
}: {
  value: T;
  options: { value: T; label: ComponentChildren; hint?: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
}): JSX.Element {
  return (
    <div class={`segmented segmented-${size} ${disabled ? 'is-disabled' : ''}`} role="radiogroup">
      {options.map((o) => (
        <button
          type="button"
          role="radio"
          aria-checked={o.value === value}
          title={o.hint}
          class={o.value === value ? 'is-on' : ''}
          disabled={disabled}
          onClick={() => {
            uiTap();
            onChange(o.value);
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stepper({
  value,
  min,
  max,
  onChange,
  format,
  disabled,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  disabled?: boolean;
}): JSX.Element {
  return (
    <div class={`stepper ${disabled ? 'is-disabled' : ''}`}>
      <button type="button" disabled={disabled || value <= min} onClick={() => { uiTap(); onChange(value - 1); }} aria-label="Less">
        <Icon name="minus" size={16} />
      </button>
      <span class="stepper-value tabular">{format ? format(value) : value}</span>
      <button type="button" disabled={disabled || value >= max} onClick={() => { uiTap(); onChange(value + 1); }} aria-label="More">
        <Icon name="plus" size={16} />
      </button>
    </div>
  );
}

export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      class={`toggle ${on ? 'is-on' : ''}`}
      disabled={disabled}
      onClick={() => {
        uiTap();
        onChange(!on);
      }}
    >
      <span class="toggle-knob" />
    </button>
  );
}

export function Slider({ value, onChange, label, min = 0, max = 1, step = 0.05 }: { value: number; onChange: (v: number) => void; label: string; min?: number; max?: number; step?: number }): JSX.Element {
  return (
    <input
      class="slider"
      type="range"
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={value}
      style={{ '--fill': `${((value - min) / (max - min)) * 100}%` }}
      onInput={(e) => onChange(Number((e.target as HTMLInputElement).value))}
    />
  );
}

export function Row({ label, hint, children }: { label: ComponentChildren; hint?: ComponentChildren; children: ComponentChildren }): JSX.Element {
  return (
    <div class="row">
      <div class="row-text">
        <div class="row-label">{label}</div>
        {hint && <div class="row-hint">{hint}</div>}
      </div>
      <div class="row-control">{children}</div>
    </div>
  );
}

// ------------------------------------------------------------------ overlays

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'good' | 'bad' | 'gold';
  icon?: IconName;
}

export const toasts = signal<Toast[]>([]);
let toastId = 0;

export function toast(text: string, tone: Toast['tone'] = 'info', icon?: IconName): void {
  const t = { id: ++toastId, text, tone, icon };
  toasts.value = [...toasts.value.slice(-3), t];
  setTimeout(() => {
    toasts.value = toasts.value.filter((x) => x.id !== t.id);
  }, 3200);
}

export function Toasts(): JSX.Element {
  return (
    <div class="toasts" aria-live="polite">
      {toasts.value.map((t) => (
        <div key={t.id} class={`toast toast-${t.tone}`}>
          {t.icon && <Icon name={t.icon} size={18} />}
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
  footer,
  class: cls,
}: {
  open: boolean;
  onClose: () => void;
  title?: ComponentChildren;
  children: ComponentChildren;
  wide?: boolean;
  footer?: ComponentChildren;
  class?: string;
}): JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('button, input, [tabindex]')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (!open) return null;
  return (
    <div class="modal-scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} class={`modal ${wide ? 'modal-wide' : ''} ${cls ?? ''}`} role="dialog" aria-modal="true">
        {title !== undefined && (
          <div class="modal-head">
            <h2>{title}</h2>
            <IconButton icon="close" label="Close" onClick={onClose} sound="back" />
          </div>
        )}
        <div class="modal-body scroll">{children}</div>
        {footer && <div class="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** A number that counts up to its value — for rewards landing. */
export function CountUp({ to, duration = 900, prefix = '' }: { to: number; duration?: number; prefix?: string }): JSX.Element {
  const [v, setV] = useState(0);
  useEffect(() => {
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setV(Math.round(to * (1 - (1 - t) ** 3)));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to]);
  return (
    <span class="tabular">
      {prefix}
      {v.toLocaleString()}
    </span>
  );
}

export function Spinner({ size = 22 }: { size?: number }): JSX.Element {
  return <span class="spinner" style={{ width: `${size}px`, height: `${size}px` }} />;
}
