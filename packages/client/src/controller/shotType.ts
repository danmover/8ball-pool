import {
  CURVE_ELEVATION,
  CURVE_MIN_SIDE,
  JUMP_ELEVATION,
  JUMP_MIN_POWER,
  MAX_ELEVATION,
} from '@8ball/shared';
import type { SpinPad } from './spinPad';

export type ShotKind = 'level' | 'curve' | 'jump';

export interface ShotTypeControl {
  el: HTMLElement;
  /** Cue elevation in radians, for the shot payload and the aim preview. */
  getValue: () => number;
  getKind: () => ShotKind;
  /** The least power this shot type can be played at. Zero for a level cue. */
  getMinPower: () => number;
  setValue: (radians: number) => void;
  reset: () => void;
  /**
   * Tells the control the current aim is blocked by a ball you are not allowed to hit, so it
   * can offer the two shots that get you out of it.
   */
  setSnookered: (snookered: boolean) => void;
}

interface Preset {
  kind: ShotKind;
  label: string;
  elevation: number;
  /** One line of plain English about what this actually does to the ball. */
  hint: string;
}

/*
 * One short line each, in the second person and about the ball rather than the cue.
 *
 * The hints used to run to two lines apiece and explain the mechanism — "needs side spin, the
 * pad moves with it" — which is the sort of thing you write when you are proud of the
 * implementation. What a player needs is what the shot does and what it costs.
 */
const PRESETS: Preset[] = [
  { kind: 'level', label: 'Level', elevation: 0, hint: 'The normal shot.' },
  {
    kind: 'curve',
    label: 'Curve',
    elevation: CURVE_ELEVATION,
    hint: 'Bend around a blocker.',
  },
  {
    kind: 'jump',
    label: 'Jump',
    elevation: JUMP_ELEVATION,
    hint: 'Hop over a blocker. Costs power.',
  },
];

/**
 * How the cue is held: flat, raised to bend the ball, or steep to hop it.
 *
 * This replaces a dial that asked for an angle in degrees, which was the wrong question in
 * three separate ways.
 *
 * It asked for a *number* when the decision is an intent — nobody wants 37°, they want round
 * that ball or over it. It let you choose settings that silently do nothing: a curve needs side
 * spin, so choosing one with the tip dead centre curved not at all, and a jump needs pace, so
 * choosing one and then hitting it softly just squirted the ball along the cloth. Both cases
 * read as the game ignoring you rather than as your mistake. And it sat off to one side as an
 * abstract gauge, disconnected from the table it was describing.
 *
 * So: three named shots, each of which arrives already working. Picking Curve moves the tip out
 * far enough to actually swerve. Picking Jump raises the power floor so the shot has the pace it
 * needs. The angle is still there to fine-tune, but only once you have chosen a shot that uses
 * it — and it is stated in what it does, not only in degrees.
 *
 * The other half of the fix is in the guide, which now simulates an elevated shot rather than
 * ray-casting it, so a curve is drawn curving and a jump is drawn going over.
 *
 * @param spin  the tip pad, so choosing a curve can put side on the ball rather than asking you
 *              to know that it needs it.
 * @param onChange fires whenever the shot changes, so the preview and the power floor keep up.
 */
export function createShotTypeControl(
  spin: SpinPad | null,
  onChange?: (radians: number) => void
): ShotTypeControl {
  const el = document.createElement('div');
  el.className = 'shot-type';

  const row = document.createElement('div');
  row.className = 'shot-type-row';

  const readout = document.createElement('div');
  readout.className = 'shot-type-hint';

  // The fine-tune only appears once a shot that uses it is chosen. A slider that does nothing
  // in the default state is just clutter with a tooltip.
  const fine = document.createElement('div');
  fine.className = 'shot-fine';
  const fineLabel = document.createElement('span');
  fineLabel.className = 'shot-fine-label';
  fineLabel.textContent = 'Cue angle';
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = String(Math.round((MAX_ELEVATION * 180) / Math.PI));
  slider.step = '1';
  slider.className = 'shot-fine-range';
  slider.setAttribute('aria-label', 'Cue angle in degrees');
  const degrees = document.createElement('span');
  degrees.className = 'shot-fine-deg';
  fine.append(fineLabel, slider, degrees);

  el.append(row, readout, fine);

  let value = 0;
  let kind: ShotKind = 'level';
  const buttons = new Map<ShotKind, HTMLButtonElement>();

  function kindFor(radians: number): ShotKind {
    if (radians < 0.12) return 'level';
    // The boundary sits where the cloth starts throwing the ball back rather than at the
    // midpoint, so the label always matches what the ball will do.
    return radians >= (CURVE_ELEVATION + JUMP_ELEVATION) / 2 ? 'jump' : 'curve';
  }

  function apply(radians: number, notify = true): void {
    value = Math.max(0, Math.min(MAX_ELEVATION, radians));
    kind = kindFor(value);

    for (const [k, button] of buttons) button.classList.toggle('active', k === kind);
    el.classList.toggle('raised', kind !== 'level');
    el.dataset.kind = kind;

    const preset = PRESETS.find((p) => p.kind === kind)!;
    readout.textContent = preset.hint;

    const deg = Math.round((value * 180) / Math.PI);
    slider.value = String(deg);
    degrees.textContent = `${deg}°`;

    if (notify) onChange?.(value);
  }

  /** Choosing a shot sets everything that shot needs, not just its angle. */
  function choose(preset: Preset): void {
    if (preset.kind === 'curve' && spin) {
      // A curve is elevation acting on side spin. Without side there is nothing to act on, so
      // the preset puts some on — keeping whichever way you were already leaning.
      const tip = spin.getValue();
      if (Math.abs(tip.x) < CURVE_MIN_SIDE) {
        const side = tip.x < 0 ? -CURVE_MIN_SIDE : CURVE_MIN_SIDE;
        spin.setValue({ x: side, y: tip.y });
      }
    }
    apply(preset.elevation);
  }

  for (const preset of PRESETS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'shot-type-btn';
    button.dataset.kind = preset.kind;
    button.innerHTML = `${shotIcon(preset.kind)}<span>${preset.label}</span>`;
    button.addEventListener('pointerdown', (e) => {
      // Stop the press reaching the aim surface behind it, which captures the pointer.
      e.stopPropagation();
      e.preventDefault();
      choose(preset);
    });
    row.appendChild(button);
    buttons.set(preset.kind, button);
  }

  slider.addEventListener('pointerdown', (e) => e.stopPropagation());
  slider.addEventListener('input', () => {
    apply((Number(slider.value) * Math.PI) / 180);
  });

  apply(0, false);

  return {
    el,
    getValue: () => value,
    getKind: () => kind,
    getMinPower: () => (kind === 'jump' ? JUMP_MIN_POWER : 0),
    setValue: (radians) => apply(radians),
    reset: () => apply(0),
    setSnookered: (snookered) => {
      // The game noticing you are stuck and pointing at the way out is the difference between
      // a mechanic people use and one they never find.
      el.classList.toggle('offered', snookered && kind === 'level');
    },
  };
}

/** Drawn from the side — the one view in a top-down game where cue angle is legible. */
function shotIcon(kind: ShotKind): string {
  const cue = (deg: number): string =>
    `<line x1="4" y1="19" x2="${4 + 18 * Math.cos((deg * Math.PI) / 180)}" y2="${19 - 18 * Math.sin((deg * Math.PI) / 180)}" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>`;
  const cloth = `<line x1="2" y1="21" x2="26" y2="21" stroke="currentColor" stroke-width="1.6" opacity="0.4" stroke-linecap="round"/>`;
  const ball = (cx: number, cy: number): string =>
    `<circle cx="${cx}" cy="${cy}" r="3.4" fill="currentColor"/>`;

  if (kind === 'level') {
    return `<svg viewBox="0 0 28 24" width="26" height="22" aria-hidden="true">${cloth}${cue(0)}${ball(20, 17.6)}</svg>`;
  }
  if (kind === 'curve') {
    // The bend is the point, so the icon shows the path rather than only the cue.
    return `<svg viewBox="0 0 28 24" width="26" height="22" aria-hidden="true">${cloth}${cue(34)}<path d="M14 17.6q6 0 5-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-dasharray="2.5 2.5" opacity="0.75"/>${ball(14, 17.6)}</svg>`;
  }
  return `<svg viewBox="0 0 28 24" width="26" height="22" aria-hidden="true">${cloth}${cue(56)}<path d="M12 17.6q6 -11 12 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-dasharray="2.5 2.5" opacity="0.75"/>${ball(12, 17.6)}</svg>`;
}
