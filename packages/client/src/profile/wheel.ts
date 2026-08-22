import {
  RARITY_LABELS,
  RARITY_WEIGHTS,
  SLOT_LABELS,
  chalkForDuplicate,
  type Rarity,
  type WheelResult,
} from '@8ball/shared';
import { getProfile, spendSpin } from './profile';
import { loadSettings } from '../settings/settingsStore';
import { cosmeticPreviewHtml } from './cosmeticPreview';
import * as sfx from '../render/sfx';

/**
 * The prize wheel. The result is decided up front by `spendSpin` and the animation is then
 * eased so the chosen rarity's slice lands under the pointer — never the other way round,
 * which is how a wheel ends up showing one thing and awarding another.
 *
 * Slices show rarities rather than individual items: with 34 unlockables a per-item wheel is
 * unreadable, and the specific prize is the reveal card's job.
 */

export const RARITY_COLORS: Record<Rarity, string> = {
  common: '#7d8aa0',
  rare: '#4aa8ff',
  epic: '#b46aff',
  legendary: '#ffc94d',
  mystic: '#c9a8ff',
};

const RARITY_TIER: Record<Rarity, number> = {
  common: 0,
  rare: 1,
  epic: 2,
  legendary: 3,
  mystic: 4,
};

/** Abbreviated so the text fits inside a 30° wedge. */
const SLICE_LABELS: Record<Rarity, string> = {
  common: 'COMMON',
  rare: 'RARE',
  epic: 'EPIC',
  legendary: 'LEGEND',
  mystic: 'MYSTIC',
};

/** Slice layout, repeated around the wheel so each rarity appears at its rough odds. */
const SLICES: Rarity[] = [
  'common', 'rare', 'common', 'epic', 'common', 'rare',
  'common', 'legendary', 'common', 'rare', 'mystic', 'epic',
];

const SPIN_MS = 4200;
const TURNS = 5;

function drawWheel(canvas: HTMLCanvasElement, rotation: number): void {
  const ctx = canvas.getContext('2d')!;
  const size = canvas.width;
  const r = size / 2;
  const step = (Math.PI * 2) / SLICES.length;

  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.translate(r, r);
  ctx.rotate(rotation);

  SLICES.forEach((rarity, i) => {
    const start = i * step - Math.PI / 2 - step / 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r - 10, start, start + step);
    ctx.closePath();

    const grad = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r);
    grad.addColorStop(0, RARITY_COLORS[rarity]);
    grad.addColorStop(1, shade(RARITY_COLORS[rarity], -0.35));
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(8,10,16,0.75)';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Slice label, reading outward along the slice's centre line. Kept short and small so
    // it fits inside a 30° wedge instead of spilling over the dividers.
    ctx.save();
    ctx.rotate(start + step / 2);
    ctx.translate(r * 0.66, 0);
    ctx.rotate(Math.PI / 2);
    ctx.fillStyle = '#0a0c11';
    ctx.font = '800 11px "Baloo 2", Nunito, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(SLICE_LABELS[rarity], 0, 0);
    ctx.restore();
  });

  // Hub.
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.18, 0, Math.PI * 2);
  ctx.fillStyle = '#12151d';
  ctx.fill();
  ctx.strokeStyle = '#ffc94d';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.restore();
}

function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) =>
    Math.max(0, Math.min(255, Math.round(c + c * amount)))
  );
  return `#${ch.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/** Angle (radians) that puts a slice of `rarity` under the pointer at the top. */
function targetAngleFor(rarity: Rarity, rng: () => number): number {
  const step = (Math.PI * 2) / SLICES.length;
  const matches = SLICES.map((r, i) => (r === rarity ? i : -1)).filter((i) => i >= 0);
  const index = matches[Math.floor(rng() * matches.length)];
  // Slice i is centred at i*step from the top when rotation is 0, so rotate it back.
  return -index * step;
}

export interface WheelOutcome {
  result: WheelResult;
}

/**
 * Opens the wheel overlay and resolves once the player dismisses the reveal.
 * Resolves with null if they had no spins to spend.
 */
export function openWheel(parent: HTMLElement): Promise<WheelOutcome | null> {
  const settings = loadSettings();
  const volume = settings.soundEnabled ? settings.soundVolume : 0;

  return new Promise((resolve) => {
    if (getProfile().spins <= 0) {
      resolve(null);
      return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'wheel-overlay';
    overlay.innerHTML = `
      <div class="wheel-card">
        <h2>Prize Wheel</h2>
        <p class="wheel-sub">${getProfile().spins} spin${getProfile().spins === 1 ? '' : 's'} available</p>
        <div class="wheel-stage">
          <div class="wheel-pointer"></div>
          <canvas class="wheel-canvas" width="320" height="320"></canvas>
        </div>
        <button id="wheelSpinBtn">SPIN</button>
        <button id="closeWheel" class="secondary">Close</button>
      </div>`;
    parent.appendChild(overlay);

    const canvas = overlay.querySelector<HTMLCanvasElement>('.wheel-canvas')!;
    const spinBtn = overlay.querySelector<HTMLButtonElement>('#wheelSpinBtn')!;
    const closeBtn = overlay.querySelector<HTMLButtonElement>('#closeWheel')!;
    let outcome: WheelOutcome | null = null;
    let spinning = false;

    drawWheel(canvas, 0);

    const finish = (): void => {
      overlay.remove();
      resolve(outcome);
    };
    closeBtn.addEventListener('click', () => {
      if (!spinning) finish();
    });

    spinBtn.addEventListener('click', () => {
      if (spinning) return;
      sfx.unlockAudio();

      const result = spendSpin();
      if (!result) {
        finish();
        return;
      }
      outcome = { result };
      spinning = true;
      spinBtn.disabled = true;
      closeBtn.disabled = true;

      const target = targetAngleFor(result.item.rarity, Math.random);
      const total = Math.PI * 2 * TURNS + target;
      const start = performance.now();
      let lastTick = 0;

      const step = (): void => {
        const t = Math.min(1, (performance.now() - start) / SPIN_MS);
        // Cubic ease-out: fast off the line, long settle into the prize.
        const eased = 1 - Math.pow(1 - t, 3);
        const rotation = total * eased;
        drawWheel(canvas, rotation);

        // Ratchet tick each time a slice boundary passes the pointer.
        const ticks = Math.floor((rotation / (Math.PI * 2)) * SLICES.length);
        if (ticks !== lastTick) {
          lastTick = ticks;
          sfx.playWheelTick(volume);
        }

        if (t < 1) {
          requestAnimationFrame(step);
          return;
        }
        sfx.playReveal(volume, RARITY_TIER[result.item.rarity]);
        showReveal(overlay, result, finish);
      };
      requestAnimationFrame(step);
    });
  });
}

function showReveal(overlay: HTMLElement, result: WheelResult, onDone: () => void): void {
  const { item, duplicate } = result;
  const card = overlay.querySelector<HTMLElement>('.wheel-card')!;
  card.innerHTML = `
    <div class="reveal rarity-${item.rarity}">
      <div class="reveal-burst"></div>
      <div class="reveal-preview">${cosmeticPreviewHtml(item, 110)}</div>
      <div class="reveal-rarity">${RARITY_LABELS[item.rarity]} · ${SLOT_LABELS[item.slot]}</div>
      <h2 class="reveal-name">${item.name}</h2>
      <p class="reveal-blurb">${item.blurb}</p>
      ${
        duplicate
          ? `<p class="reveal-dupe">Already owned — converted to <b>${chalkForDuplicate(
              item.rarity
            )} chalk</b></p>`
          : `<p class="reveal-new">UNLOCKED</p>`
      }
      <button id="revealOk">Nice</button>
    </div>`;
  card.querySelector('#revealOk')!.addEventListener('click', onDone);
}

/** Exposed for the profile page's odds readout. */
export function rarityOdds(): Array<{ rarity: Rarity; pct: number }> {
  const total = Object.values(RARITY_WEIGHTS).reduce((a, b) => a + b, 0);
  return (Object.keys(RARITY_WEIGHTS) as Rarity[]).map((rarity) => ({
    rarity,
    pct: Math.round((RARITY_WEIGHTS[rarity] / total) * 100),
  }));
}
