import {
  CURVE_ELEVATION,
  CURVE_MIN_SIDE,
  JUMP_ELEVATION,
  JUMP_MIN_POWER,
  MAX_ELEVATION,
} from '@8ball/shared';
import type { SpinPad } from './spinPad';
import { capturePointer } from './capture';

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

/** Where each named shot begins, as a fraction of the dial. */
const CURVE_FROM = 0.12; // rad — below this the cue is flat enough to be a normal shot
const JUMP_FROM = (CURVE_ELEVATION + JUMP_ELEVATION) / 2;

interface Zone {
  kind: ShotKind;
  label: string;
  /** One short line about the ball, not about the cue. */
  hint: string;
  from: number;
  to: number;
  /** The angle a tap on this zone snaps to. */
  preset: number;
  colour: string;
}

const ZONES: Zone[] = [
  { kind: 'level', label: 'Level', hint: 'The normal shot.', from: 0, to: CURVE_FROM, preset: 0, colour: '#9ba7d8' },
  {
    kind: 'curve',
    label: 'Curve',
    hint: 'Bend around a blocker.',
    from: CURVE_FROM,
    to: JUMP_FROM,
    preset: CURVE_ELEVATION,
    colour: '#22d3ee',
  },
  {
    kind: 'jump',
    label: 'Jump',
    hint: 'Hop over a blocker. Costs power.',
    from: JUMP_FROM,
    to: MAX_ELEVATION,
    preset: JUMP_ELEVATION,
    colour: '#ffc531',
  },
];

/** Dial geometry, in the SVG's own units. The cue pivots at the ball. */
const BOX = 132;
const PIVOT_X = 22;
const PIVOT_Y = 104;
const RADIUS = 92;

const pointOnArc = (radians: number, r = RADIUS): [number, number] => [
  PIVOT_X + Math.cos(radians) * r,
  PIVOT_Y - Math.sin(radians) * r,
];

/** An SVG arc between two elevations, at a given radius. */
function arcPath(from: number, to: number, r: number): string {
  const [x1, y1] = pointOnArc(from, r);
  const [x2, y2] = pointOnArc(to, r);
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

/**
 * How the cue is held: raised by dragging the cue itself.
 *
 * This replaced three buttons and a slider, which replaced a bare angle dial. The buttons were
 * an improvement on the number — Level, Curve and Jump are the decision people actually make —
 * but they were still three small targets, a paragraph of hint and a separate slider for the
 * angle, four objects for one property.
 *
 * A cue you lift is the one control that is all of them at once. It shows the angle by *being*
 * at the angle, which is the thing a number never managed; the three names are marked on the
 * arc so they remain one tap each; and there is no separate fine-tune, because the whole dial
 * is the fine-tune.
 *
 * The property that made the buttons worth having survives and gets better: a shot arrives
 * already working. Reaching the curve band puts side spin on the ball, however you got there —
 * dragged, tapped or nudged with the keyboard — because a swerve with a centred tip is a shot
 * that quietly does nothing. Reaching the jump band raises the power floor for the same reason.
 *
 * @param spin the tip pad, so entering the curve band can put side on the ball.
 * @param onChange fires whenever the angle moves, so the guide and the power floor keep up.
 */
export function createShotTypeControl(
  spin: SpinPad | null,
  onChange?: (radians: number) => void
): ShotTypeControl {
  const el = document.createElement('div');
  el.className = 'shot-type';

  const dial = document.createElement('div');
  dial.className = 'cue-dial';
  dial.innerHTML = `
    <svg viewBox="0 0 ${BOX} ${BOX}" class="dial-svg" aria-hidden="true">
      <path class="dial-track" d="${arcPath(0, MAX_ELEVATION, RADIUS)}"/>
      ${ZONES.map(
        (z) =>
          `<path class="dial-zone" data-kind="${z.kind}" style="--zone: ${z.colour}"
                 d="${arcPath(z.from + 0.012, z.to - 0.012, RADIUS)}"/>`
      ).join('')}
      ${ZONES.map((z) => {
        const [tx, ty] = pointOnArc(z.to, RADIUS);
        const [ix, iy] = pointOnArc(z.to, RADIUS - 11);
        return z.to < MAX_ELEVATION - 0.01
          ? `<line class="dial-tick" x1="${ix.toFixed(2)}" y1="${iy.toFixed(2)}"
                   x2="${tx.toFixed(2)}" y2="${ty.toFixed(2)}"/>`
          : '';
      }).join('')}
      <path class="dial-fill" d="${arcPath(0, 0.001, RADIUS)}"/>
    </svg>
    <span class="dial-cue"></span>
    <span class="dial-ball"></span>
    <span class="dial-knob"></span>
    <span class="dial-cloth"></span>
  `;

  const cue = dial.querySelector<HTMLElement>('.dial-cue')!;
  const knob = dial.querySelector<HTMLElement>('.dial-knob')!;
  const fill = dial.querySelector<SVGPathElement>('.dial-fill')!;

  const name = document.createElement('div');
  name.className = 'cue-name';

  const hint = document.createElement('div');
  hint.className = 'shot-type-hint';

  el.append(dial, name, hint);

  let value = 0;
  let kind: ShotKind = 'level';

  function zoneFor(radians: number): Zone {
    return ZONES.find((z) => radians < z.to) ?? ZONES[ZONES.length - 1];
  }

  function apply(radians: number, notify = true): void {
    const next = Math.max(0, Math.min(MAX_ELEVATION, radians));
    const zone = zoneFor(next);
    const entering = zone.kind !== kind;
    value = next;
    kind = zone.kind;

    /*
     * Entering the curve band puts side on the ball — but only on entry, never on every move.
     * Re-applying it continuously would fight a player who had deliberately centred the tip
     * while still in the band, which is a legitimate (if pointless) thing to want.
     */
    if (entering && kind === 'curve' && spin) {
      const tip = spin.getValue();
      if (Math.abs(tip.x) < CURVE_MIN_SIDE) {
        spin.setValue({ x: tip.x < 0 ? -CURVE_MIN_SIDE : CURVE_MIN_SIDE, y: tip.y });
      }
    }

    const deg = Math.round((value * 180) / Math.PI);
    cue.style.setProperty('--lift', `${deg}deg`);
    const [kx, ky] = pointOnArc(value);
    knob.style.left = `${(kx / BOX) * 100}%`;
    knob.style.top = `${(ky / BOX) * 100}%`;
    knob.style.setProperty('--zone', zone.colour);
    fill.setAttribute('d', arcPath(0, Math.max(value, 0.001), RADIUS));
    fill.style.setProperty('--zone', zone.colour);

    name.innerHTML = `${zone.label}<span class="cue-deg">${deg}°</span>`;
    name.style.setProperty('--zone', zone.colour);
    hint.textContent = zone.hint;

    el.classList.toggle('raised', kind !== 'level');
    el.dataset.kind = kind;
    dial.setAttribute('aria-valuenow', String(deg));
    dial.setAttribute('aria-valuetext', `${zone.label}, ${deg} degrees`);

    if (notify) onChange?.(value);
  }

  // ---- Dragging the cue ----

  /** The elevation the pointer is asking for, measured from the pivot. */
  function fromEvent(e: PointerEvent): number {
    const rect = dial.getBoundingClientRect();
    const px = rect.left + (PIVOT_X / BOX) * rect.width;
    const py = rect.top + (PIVOT_Y / BOX) * rect.height;
    const angle = Math.atan2(py - e.clientY, e.clientX - px);
    return Math.max(0, Math.min(MAX_ELEVATION, angle));
  }

  let dragging = false;
  let moved = 0;
  let downAt = 0;

  dial.addEventListener('pointerdown', (e) => {
    // The aim surface behind captures the pointer, so this must not reach it.
    e.stopPropagation();
    e.preventDefault();
    dragging = true;
    moved = 0;
    downAt = fromEvent(e);
    capturePointer(dial, e.pointerId);
    dial.classList.add('dragging');
    apply(downAt);
  });

  dial.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const next = fromEvent(e);
    moved = Math.max(moved, Math.abs(next - downAt));
    apply(next);
  });

  const endDrag = (): void => {
    if (!dragging) return;
    dragging = false;
    dial.classList.remove('dragging');
    /*
     * A tap rather than a drag snaps to the middle of the band you tapped. Landing on 41° when
     * you meant "curve" is the sort of near-miss that makes a dial feel fussy, and the three
     * named shots are still the common case.
     */
    if (moved < 0.05) apply(zoneFor(downAt).preset);
  };
  dial.addEventListener('pointerup', endDrag);
  dial.addEventListener('pointercancel', endDrag);

  dial.tabIndex = 0;
  dial.setAttribute('role', 'slider');
  dial.setAttribute('aria-label', 'Cue elevation');
  dial.setAttribute('aria-valuemin', '0');
  dial.setAttribute('aria-valuemax', String(Math.round((MAX_ELEVATION * 180) / Math.PI)));
  dial.addEventListener('keydown', (e) => {
    const step = (e.shiftKey ? 1 : 5) * (Math.PI / 180);
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') apply(value + step);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') apply(value - step);
    else if (e.key === 'Home') apply(0);
    else return;
    e.preventDefault();
    e.stopPropagation();
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
