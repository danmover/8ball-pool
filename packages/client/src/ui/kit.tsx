import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { ballColor, ballSetStyle, type Avatar as AvatarData, type Rarity } from '@8ball/shared';
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

/**
 * A pool ball as SVG, in any set's colours. Used everywhere a ball appears in the interface —
 * the ball return, player cards, the lobby — so they all match the balls on the table.
 */
export function BallIcon({ id, size = 22, set = 'balls.classic', dim }: { id: number; size?: number; set?: string; dim?: boolean }): JSX.Element {
  const style = ballSetStyle(set);
  const color = ballColor(style, id);
  const stripe = id >= 9;
  const base = id === 0 ? style.cue : stripe ? style.base : color;
  const gid = `bg${id}`;
  return (
    <svg class={`ball-icon ${dim ? 'is-dim' : ''}`} width={size} height={size} viewBox="0 0 40 40" aria-label={id === 0 ? 'cue ball' : `${id} ball`}>
      <defs>
        <radialGradient id={`${gid}s`} cx="36%" cy="30%" r="70%">
          <stop offset="0" stop-color="#fff" stop-opacity="0.85" />
          <stop offset="0.25" stop-color="#fff" stop-opacity="0.12" />
          <stop offset="0.7" stop-color="#000" stop-opacity="0" />
          <stop offset="1" stop-color="#000" stop-opacity="0.45" />
        </radialGradient>
        <clipPath id={`${gid}c`}>
          <circle cx="20" cy="20" r="19" />
        </clipPath>
      </defs>
      <g clip-path={`url(#${gid}c)`}>
        <rect width="40" height="40" fill={base} />
        {stripe && <rect y="11" width="40" height="18" fill={color} />}
        {id !== 0 && <circle cx="20" cy="20" r="8.2" fill={style.finish === 'neon' ? '#f4f4f4' : style.base} />}
        {id !== 0 && (
          <text x="20" y="24.3" text-anchor="middle" font-size={id > 9 ? 10 : 11.5} font-weight="800" fill={style.finish === 'neon' ? '#111' : style.ink} font-family="Outfit Variable, sans-serif">
            {id}
          </text>
        )}
        <circle cx="20" cy="20" r="19" fill={`url(#${gid}s)`} />
      </g>
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
