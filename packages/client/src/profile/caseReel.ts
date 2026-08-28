import {
  RARITY_LABELS,
  RARITY_WEIGHTS,
  REEL_WINNER_INDEX,
  SLOT_LABELS,
  buildReel,
  chalkForDuplicate,
  rarityRank,
  reelEase,
  reelTiming,
  type Rarity,
  type ReelCell,
  type WheelResult,
} from '@8ball/shared';
import { getProfile, spendSpin } from './profile';
import { loadSettings } from '../settings/settingsStore';
import { cosmeticPreviewHtml } from './cosmeticPreview';
import * as sfx from '../render/sfx';

/**
 * Opening a case.
 *
 * Replaces the prize wheel. The wheel showed *rarity words* on twelve wedges, which meant the
 * only thing you could watch was a coloured slice going past — the actual prize was a surprise
 * that arrived after the animation had finished, so the animation carried no tension at all.
 *
 * A reel of real items fixes that on its own: you can see a legendary coming, you can see it
 * slide past, and by the time it stops you already know how you feel. The prize is still
 * decided up front by `spendSpin`, exactly as before — see `shared/src/reel.ts` for why that
 * separation is load-bearing.
 */

export const RARITY_COLORS: Record<Rarity, string> = {
  common: '#7d8aa0',
  rare: '#4aa8ff',
  epic: '#b46aff',
  legendary: '#ffc94d',
  mystic: '#c9a8ff',
};

/** Cell width including its gap, in pixels. Must match the CSS. */
const CELL = 104;

export interface WheelOutcome {
  result: WheelResult;
}

function cellHtml(cell: ReelCell, index: number): string {
  return `
    <div class="reel-cell rarity-${cell.item.rarity}" data-index="${index}">
      <div class="reel-art">${cosmeticPreviewHtml(cell.item, 62)}</div>
      <div class="reel-name">${cell.item.name}</div>
    </div>`;
}

/**
 * Opens the case overlay and resolves once the player dismisses the reveal.
 * Resolves with null if they had no spins to spend.
 */
export function openCase(parent: HTMLElement): Promise<WheelOutcome | null> {
  const settings = loadSettings();
  const volume = settings.soundEnabled ? settings.soundVolume : 0;
  const stillMotion = settings.reduceMotion;

  return new Promise((resolve) => {
    if (getProfile().spins <= 0) {
      resolve(null);
      return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'case-overlay';
    overlay.innerHTML = `
      <div class="case-card">
        <h2>Open a Case</h2>
        <p class="case-sub" id="caseSub"></p>
        <div class="reel-stage">
          <div class="reel-marker"></div>
          <div class="reel-track" id="reelTrack"></div>
          <div class="reel-fade left"></div>
          <div class="reel-fade right"></div>
        </div>
        <div class="case-actions">
          <button id="caseOpenBtn">OPEN</button>
          <button id="caseCloseBtn" class="secondary">Close</button>
        </div>
        <div class="case-odds" id="caseOdds"></div>
      </div>`;
    parent.appendChild(overlay);

    const card = overlay.querySelector<HTMLElement>('.case-card')!;
    const track = overlay.querySelector<HTMLElement>('#reelTrack')!;
    const stage = overlay.querySelector<HTMLElement>('.reel-stage')!;
    const openBtn = overlay.querySelector<HTMLButtonElement>('#caseOpenBtn')!;
    const closeBtn = overlay.querySelector<HTMLButtonElement>('#caseCloseBtn')!;
    const sub = overlay.querySelector<HTMLElement>('#caseSub')!;
    const odds = overlay.querySelector<HTMLElement>('#caseOdds')!;

    let last: WheelOutcome | null = null;
    let spinning = false;

    // The odds, stated plainly and permanently. A case that hides its own distribution is
    // doing something it does not want looked at.
    const totalWeight = Object.values(RARITY_WEIGHTS).reduce((a, b) => a + b, 0);
    odds.innerHTML = (Object.keys(RARITY_WEIGHTS) as Rarity[])
      .sort((a, b) => rarityRank(a) - rarityRank(b))
      .map(
        (r) =>
          `<span class="odds-chip" style="--c:${RARITY_COLORS[r]}">${RARITY_LABELS[r]} ${Math.round(
            (RARITY_WEIGHTS[r] / totalWeight) * 100
          )}%</span>`
      )
      .join('');

    const refresh = (): void => {
      const spins = getProfile().spins;
      sub.textContent = spins > 0 ? `${spins} spin${spins === 1 ? '' : 's'} left` : 'No spins left';
      openBtn.disabled = spins <= 0;
      openBtn.textContent = spins > 0 ? 'OPEN' : 'NO SPINS';
    };
    refresh();

    // Idle state: a still strip, so the stage isn't an empty box before the first open.
    const idle = buildReel(getProfile().spins > 0 ? seedItem() : seedItem());
    track.innerHTML = idle.map(cellHtml).join('');
    track.style.transform = `translateX(0px)`;

    const finish = (): void => {
      overlay.remove();
      resolve(last);
    };
    closeBtn.addEventListener('click', () => {
      if (!spinning) finish();
    });

    openBtn.addEventListener('click', () => {
      if (spinning) return;
      sfx.unlockAudio();

      const result = spendSpin();
      if (!result) {
        finish();
        return;
      }
      last = { result };
      spinning = true;
      openBtn.disabled = true;
      closeBtn.disabled = true;
      card.classList.remove('revealed');
      overlay.querySelector('.case-reveal')?.remove();

      const cells = buildReel(result.item);
      track.innerHTML = cells.map(cellHtml).join('');

      const timing = reelTiming(result.item.rarity);
      const settleFraction = timing.settleMs / timing.durationMs;
      // Land the winning cell under the marker, with a small random offset inside the cell so
      // it never stops at exactly the same pixel twice.
      const jitter = (Math.random() - 0.5) * CELL * 0.4;
      const distance = REEL_WINNER_INDEX * CELL + jitter;

      if (stillMotion) {
        // Reduce motion: no scroll at all, straight to the answer.
        track.style.transform = `translateX(${-distance}px)`;
        landed(cells, result);
        return;
      }

      const start = performance.now();
      let lastCell = -1;
      const step = (): void => {
        const t = Math.min(1, (performance.now() - start) / timing.durationMs);
        const eased = reelEase(t, settleFraction);
        const x = distance * eased;
        track.style.transform = `translateX(${-x}px)`;

        // A tick per cell crossing the marker. The gaps widen on their own as it slows, which
        // is the sound of the thing decelerating rather than a separate effect.
        const cellIndex = Math.floor(x / CELL);
        if (cellIndex !== lastCell) {
          lastCell = cellIndex;
          sfx.playWheelTick(volume);
          // Light the near-miss as it goes past, so the tease is seen and not just present.
          const passing = cells[cellIndex];
          if (passing?.nearMiss) stage.classList.add('teasing');
          else stage.classList.remove('teasing');
        }

        if (t < 1) {
          requestAnimationFrame(step);
          return;
        }
        stage.classList.remove('teasing');
        landed(cells, result);
      };
      requestAnimationFrame(step);
    });

    function landed(cells: ReelCell[], result: WheelResult): void {
      spinning = false;
      closeBtn.disabled = false;
      refresh();

      const rank = rarityRank(result.item.rarity);
      sfx.playReveal(volume, rank);

      // Rarity-scaled celebration. A common gets a nudge; a mystic takes over the screen.
      stage.classList.add('landed', `landed-${result.item.rarity}`);
      if (!stillMotion && rank >= 2) burst(overlay, result.item.rarity, rank);

      const winnerEl = track.querySelector<HTMLElement>(`[data-index="${REEL_WINNER_INDEX}"]`);
      winnerEl?.classList.add('is-winner');
      void cells;

      showReveal(overlay, result, () => {
        stage.classList.remove('landed', `landed-${result.item.rarity}`);
        winnerEl?.classList.remove('is-winner');
        // Straight back to the reel with a spin still in hand — five spins should not mean
        // opening and closing this dialog five times.
        if (getProfile().spins > 0) {
          overlay.querySelector('.case-reveal')?.remove();
          card.classList.remove('revealed');
          refresh();
        } else {
          finish();
        }
      }, finish);
    }
  });
}

/** Something to put on the idle strip before the first open. */
function seedItem(): Parameters<typeof buildReel>[0] {
  // Any item will do — it is never won, it is only there so the stage is not an empty box.
  return {
    id: 'cue.house',
    slot: 'cue',
    name: 'House Cue',
    rarity: 'common',
    blurb: '',
  };
}

/** Confetti, scaled by how good the prize was. */
function burst(overlay: HTMLElement, rarity: Rarity, rank: number): void {
  const layer = document.createElement('div');
  layer.className = `case-burst burst-${rarity}`;
  const count = 18 + rank * 14;
  for (let i = 0; i < count; i++) {
    const bit = document.createElement('i');
    bit.style.setProperty('--x', `${(Math.random() - 0.5) * 620}px`);
    bit.style.setProperty('--y', `${-140 - Math.random() * 320}px`);
    bit.style.setProperty('--r', `${Math.random() * 720 - 360}deg`);
    bit.style.setProperty('--d', `${420 + Math.random() * 700}ms`);
    bit.style.setProperty('--c', RARITY_COLORS[rarity]);
    layer.appendChild(bit);
  }
  overlay.appendChild(layer);
  setTimeout(() => layer.remove(), 1800);
}

function showReveal(
  overlay: HTMLElement,
  result: WheelResult,
  onAgain: () => void,
  onDone: () => void
): void {
  const { item, duplicate } = result;
  const card = overlay.querySelector<HTMLElement>('.case-card')!;
  card.classList.add('revealed');

  const panel = document.createElement('div');
  panel.className = `case-reveal rarity-${item.rarity}`;
  panel.innerHTML = `
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
    <div class="reveal-actions">
      <button id="revealAgain">${getProfile().spins > 0 ? 'OPEN ANOTHER' : 'Nice'}</button>
      ${getProfile().spins > 0 ? '<button class="secondary" id="revealDone">Done</button>' : ''}
    </div>`;
  card.appendChild(panel);

  panel.querySelector('#revealAgain')!.addEventListener('click', onAgain);
  panel.querySelector('#revealDone')?.addEventListener('click', onDone);
}

/** Exposed for the profile page's odds readout. */
export function rarityOdds(): Array<{ rarity: Rarity; pct: number }> {
  const total = Object.values(RARITY_WEIGHTS).reduce((a, b) => a + b, 0);
  return (Object.keys(RARITY_WEIGHTS) as Rarity[]).map((rarity) => ({
    rarity,
    pct: Math.round((RARITY_WEIGHTS[rarity] / total) * 100),
  }));
}
