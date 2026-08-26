import { MAX_ELEVATION } from '@8ball/shared';

export interface ElevationDial {
  el: HTMLElement;
  /** Cue elevation in radians. */
  getValue: () => number;
  setValue: (radians: number) => void;
  reset: () => void;
}

/** The three shots worth having a button for, as fractions of the maximum elevation. */
const PRESETS: [label: string, fraction: number][] = [
  ['LEVEL', 0],
  ['MASSÉ', 0.55],
  ['JUMP', 1],
];

/**
 * How far the butt of the cue is raised.
 *
 * Elevation is the difference between a blocked table being a dead end and being a decision.
 * Raise the cue and the strike gains a downward component: past roughly 45° the ball is driven
 * into the cloth hard enough to bounce off it and clear an obstruction, and any side spin
 * becomes a spin axis pointing along the shot, which makes the ball curve.
 *
 * Drawn from the side, because that is the one view where "how steep is the cue" is obvious —
 * everything else in this game is top-down, and a raised cue is invisible from above.
 *
 * @param onChange fires whenever the angle moves, so the aim preview can be recomputed — an
 *                 elevated cue curves the ball, and the guide has to keep up.
 */
export function createElevationDial(onChange?: (radians: number) => void): ElevationDial {
  const el = document.createElement('div');
  el.className = 'elev-control';

  const gauge = document.createElement('div');
  gauge.className = 'elev-gauge';
  gauge.innerHTML = `
    <span class="elev-cloth"></span>
    <span class="elev-ball"></span>
    <span class="elev-cue"></span>
  `;
  const cue = gauge.querySelector<HTMLElement>('.elev-cue')!;

  const readout = document.createElement('div');
  readout.className = 'elev-readout';

  const presets = document.createElement('div');
  presets.className = 'elev-presets';

  el.append(gauge, readout, presets);

  let value = 0;

  function describe(radians: number): string {
    const deg = Math.round((radians * 180) / Math.PI);
    if (deg <= 1) return 'Level cue';
    // Named so the effect is learnable from the control rather than from experiment.
    if (radians >= MAX_ELEVATION * 0.8) return `${deg}° — jump`;
    if (radians >= MAX_ELEVATION * 0.35) return `${deg}° — curves`;
    return `${deg}°`;
  }

  function apply(radians: number, notify = true): void {
    value = Math.max(0, Math.min(MAX_ELEVATION, radians));
    // The drawn cue pivots at the ball, so the gauge reads as a cue resting on the cloth.
    cue.style.transform = `rotate(${-(value * 180) / Math.PI}deg)`;
    readout.textContent = describe(value);
    el.classList.toggle('raised', value > 0.02);
    for (const button of presets.querySelectorAll('button')) {
      const target = Number(button.dataset.elev);
      button.classList.toggle('active', Math.abs(target - value) < 0.01);
    }
    if (notify) onChange?.(value);
  }

  for (const [label, fraction] of PRESETS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.dataset.elev = String(MAX_ELEVATION * fraction);
    button.addEventListener('pointerdown', (e) => {
      // Stop the press reaching the aim surface behind it, which captures the pointer.
      e.stopPropagation();
      e.preventDefault();
      apply(MAX_ELEVATION * fraction);
    });
    presets.appendChild(button);
  }

  /** Dragging up the gauge raises the cue; the gauge's height is the full range. */
  function setFromEvent(e: PointerEvent): void {
    const rect = gauge.getBoundingClientRect();
    const fromBottom = (rect.bottom - e.clientY) / rect.height;
    apply(Math.max(0, Math.min(1, fromBottom)) * MAX_ELEVATION);
  }

  let dragging = false;
  gauge.addEventListener('pointerdown', (e) => {
    dragging = true;
    gauge.setPointerCapture(e.pointerId);
    setFromEvent(e);
  });
  gauge.addEventListener('pointermove', (e) => {
    if (dragging) setFromEvent(e);
  });
  window.addEventListener('pointerup', () => {
    dragging = false;
  });

  apply(0, false);

  return {
    el,
    getValue: () => value,
    setValue: (radians) => apply(radians),
    reset: () => apply(0),
  };
}
