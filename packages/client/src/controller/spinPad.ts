import { MAX_TIP_OFFSET, MISCUE_MAX_CHANCE, MISCUE_TIP_OFFSET } from '@8ball/shared';
import { capturePointer } from './capture';

export interface SpinPad {
  el: HTMLElement;
  getValue: () => { x: number; y: number };
  setValue: (v: { x: number; y: number }) => void;
  /** Shifts the tip by a small step — used by the host's keyboard shortcuts. */
  nudge: (dx: number, dy: number) => void;
  reset: () => void;
}

/**
 * The cue-tip picker: where on the cue ball you're striking.
 *
 * Horizontal is english; vertical is draw (below centre) and follow (above centre). Since the
 * physics behind it is now the real thing, the control's whole job is to make what you did
 * legible — a big cue ball you can see the tip on, the axes named, a plain-English readout, and
 * one-tap presets so the three shots you actually want don't need a steady hand at all.
 *
 * @param onChange fires whenever the tip moves, so callers can refresh the aim preview —
 *                 spin changes where the cue ball ends up, and the guide has to keep up.
 */
export function createSpinPad(onChange?: (value: { x: number; y: number }) => void): SpinPad {
  const el = document.createElement('div');
  el.className = 'spin-control';

  const pad = document.createElement('div');
  pad.className = 'spin-pad';
  pad.innerHTML = `
    <span class="spin-safe" style="inset:${(1 - MAX_TIP_OFFSET / MISCUE_TIP_OFFSET) * 50}%"></span>
    <span class="spin-axis top">FOLLOW</span>
    <span class="spin-axis bottom">DRAW</span>
    <span class="spin-axis left">◀</span>
    <span class="spin-axis right">▶</span>
  `;
  const dot = document.createElement('div');
  dot.className = 'dot';
  pad.appendChild(dot);

  const readout = document.createElement('div');
  readout.className = 'spin-readout';

  const presets = document.createElement('div');
  presets.className = 'spin-presets';

  el.append(pad, readout, presets);

  let value = { x: 0, y: 0 };

  /**
   * Plain English for where the tip is, because "0.8, -0.4" teaches nobody anything.
   *
   * Percentages are of the tip's *safe grip*, not of the pad's full reach — so the one-tap DRAW
   * preset reads "Draw 100%" rather than a baffling 76%. Past 100% you are into the band where
   * the tip can slip, and the miscue warning appended by the caller says so.
   */
  function describe(v: { x: number; y: number }): string {
    const parts: string[] = [];
    const safe = MAX_TIP_OFFSET / MISCUE_TIP_OFFSET;
    const pct = (n: number): string => `${Math.round((Math.abs(n) / safe) * 100)}%`;
    if (Math.abs(v.y) > 0.05) parts.push(`${v.y > 0 ? 'Draw' : 'Follow'} ${pct(v.y)}`);
    if (Math.abs(v.x) > 0.05) parts.push(`${v.x > 0 ? 'Right' : 'Left'} ${pct(v.x)}`);
    return parts.length ? parts.join(' · ') : 'Centre ball';
  }

  /**
   * How likely the tip is to slip at this offset — mirrors `applyCueStrike`'s miscue roll.
   *
   * The pad now reaches past the tip's safe grip, which is what stops maximum english being a
   * free option. That trade only works if the risk is visible before you take it, so the ring
   * turns red and the readout says so.
   */
  function miscueRisk(v: { x: number; y: number }): number {
    const offset = Math.min(1, Math.hypot(v.x, v.y)) * MISCUE_TIP_OFFSET;
    if (offset <= MAX_TIP_OFFSET) return 0;
    return ((offset - MAX_TIP_OFFSET) / (MISCUE_TIP_OFFSET - MAX_TIP_OFFSET)) * MISCUE_MAX_CHANCE;
  }

  function apply(next: { x: number; y: number }, notify = true): void {
    let { x, y } = next;

    // Snap to a pure axis near it. Without this almost every draw shot picks up a little
    // unintended english, which then throws the object ball off line for no reason the player
    // can see — the classic "I aimed it right and it still missed".
    if (Math.abs(x) < 0.16) x = 0;
    if (Math.abs(y) < 0.16) y = 0;

    const mag = Math.hypot(x, y);
    if (mag > 1) {
      x /= mag;
      y /= mag;
    }
    value = { x, y };
    dot.style.left = `${50 + x * 40}%`;
    dot.style.top = `${50 + y * 40}%`;

    const risk = miscueRisk(value);
    readout.textContent = risk > 0
      ? `${describe(value)} — ${Math.round(risk * 100)}% miscue`
      : describe(value);
    el.classList.toggle('spun', mag > 0.05);
    el.classList.toggle('risky', risk > 0);
    for (const button of presets.querySelectorAll('button')) {
      button.classList.toggle('active', button.dataset.spin === `${value.x},${value.y}`);
    }
    if (notify) onChange?.(value);
  }

  /*
   * The three shots that matter, one tap each. Fine dragging is for everything else.
   *
   * Each carries a picture of itself: a cue ball with the tip marked where that shot strikes
   * it, and an arrow for what the ball does afterwards. As three words alone — DRAW, STUN,
   * FOLLOW — they are jargon, and a player who does not already know the terms learns nothing
   * from pressing them.
   *
   * They stop exactly at the edge of the tip's safe grip rather than at the edge of the pad:
   * a one-tap preset carrying a 75% chance of miscuing would be a trap, not a shortcut.
   */
  const SAFE = MAX_TIP_OFFSET / MISCUE_TIP_OFFSET;
  for (const [label, x, y, after] of [
    ['Draw', 0, SAFE, 'comes back'],
    ['Stun', 0, 0, 'stops dead'],
    ['Follow', 0, -SAFE, 'runs on'],
  ] as const) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'spin-preset';
    button.dataset.spin = `${x},${y}`;
    button.title = `${label} — the cue ball ${after}`;
    button.innerHTML = `
      <span class="preset-ball"><i style="top:${50 + y * 30}%"></i></span>
      <span class="preset-name">${label}</span>
      <span class="preset-after">${after}</span>`;
    button.addEventListener('pointerdown', (e) => {
      // Stop the press reaching the aim surface behind it, which captures the pointer.
      e.stopPropagation();
      e.preventDefault();
      apply({ x, y });
    });
    presets.appendChild(button);
  }

  function setFromEvent(e: PointerEvent): void {
    const rect = pad.getBoundingClientRect();
    const r = rect.width / 2;
    apply({
      x: (e.clientX - (rect.left + r)) / r,
      y: (e.clientY - (rect.top + r)) / r,
    });
  }

  let dragging = false;
  pad.addEventListener('pointerdown', (e) => {
    dragging = true;
    capturePointer(pad, e.pointerId);
    setFromEvent(e);
  });
  pad.addEventListener('pointermove', (e) => {
    if (dragging) setFromEvent(e);
  });
  window.addEventListener('pointerup', () => {
    dragging = false;
  });

  apply({ x: 0, y: 0 }, false);

  return {
    el,
    getValue: () => value,
    setValue: (v) => apply(v),
    nudge: (dx, dy) => apply({ x: value.x + dx, y: value.y + dy }),
    reset: () => apply({ x: 0, y: 0 }),
  };
}
