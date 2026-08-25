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

  /** Plain English for where the tip is, because "0.8, -0.4" teaches nobody anything. */
  function describe(v: { x: number; y: number }): string {
    const parts: string[] = [];
    const pct = (n: number): string => `${Math.round(Math.abs(n) * 100)}%`;
    if (Math.abs(v.y) > 0.05) parts.push(`${v.y > 0 ? 'Draw' : 'Follow'} ${pct(v.y)}`);
    if (Math.abs(v.x) > 0.05) parts.push(`${v.x > 0 ? 'Right' : 'Left'} ${pct(v.x)}`);
    return parts.length ? parts.join(' · ') : 'Centre ball';
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
    dot.style.left = `${50 + x * 33}%`;
    dot.style.top = `${50 + y * 33}%`;
    readout.textContent = describe(value);
    el.classList.toggle('spun', mag > 0.05);
    for (const button of presets.querySelectorAll('button')) {
      button.classList.toggle('active', button.dataset.spin === `${value.x},${value.y}`);
    }
    if (notify) onChange?.(value);
  }

  // The three shots that matter, one tap each. Fine dragging is for everything else.
  for (const [label, x, y] of [
    ['DRAW', 0, 1],
    ['STUN', 0, 0],
    ['FOLLOW', 0, -1],
  ] as const) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.dataset.spin = `${x},${y}`;
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
    pad.setPointerCapture(e.pointerId);
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
