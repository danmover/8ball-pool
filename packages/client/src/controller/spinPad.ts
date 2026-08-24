export interface SpinPad {
  el: HTMLElement;
  getValue: () => { x: number; y: number };
  reset: () => void;
}

/**
 * The cue-tip picker: where on the cue ball you're striking. Horizontal is english,
 * vertical is draw (below centre) and follow (above centre).
 *
 * @param onChange fires whenever the tip moves, so callers can refresh the aim preview —
 *                 spin changes where the cue ball ends up, and the guide has to keep up.
 */
export function createSpinPad(onChange?: (value: { x: number; y: number }) => void): SpinPad {
  const el = document.createElement('div');
  el.className = 'spin-pad';
  const dot = document.createElement('div');
  dot.className = 'dot';
  el.appendChild(dot);

  let value = { x: 0, y: 0 };

  function setFromEvent(e: PointerEvent): void {
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const r = rect.width / 2;
    let dx = (e.clientX - cx) / r;
    let dy = (e.clientY - cy) / r;
    const mag = Math.hypot(dx, dy);
    if (mag > 1) {
      dx /= mag;
      dy /= mag;
    }
    value = { x: dx, y: dy };
    dot.style.left = `${50 + dx * 35}%`;
    dot.style.top = `${50 + dy * 35}%`;
    onChange?.(value);
  }

  let dragging = false;
  el.addEventListener('pointerdown', (e) => {
    dragging = true;
    el.setPointerCapture(e.pointerId);
    setFromEvent(e);
  });
  el.addEventListener('pointermove', (e) => {
    if (dragging) setFromEvent(e);
  });
  window.addEventListener('pointerup', () => {
    dragging = false;
  });

  return {
    el,
    getValue: () => value,
    reset: () => {
      value = { x: 0, y: 0 };
      dot.style.left = '50%';
      dot.style.top = '50%';
      onChange?.(value);
    },
  };
}
