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
  type CosmeticItem,
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
 * The prize is decided up front by `spendSpin`, exactly as it always was — see
 * `shared/src/reel.ts` for why that separation is load-bearing. Everything here is about the
 * ninety seconds either side of that decision.
 *
 * The previous version was a reel and nothing else: a strip of items scrolled past a gold line
 * inside a violet dialog, and when it stopped a flat panel dropped over the top with the answer
 * on it. Two things were wrong with that, and they are the whole redesign.
 *
 * **There was no case.** The dialog said "Open a Case" and there was no case anywhere on it —
 * you pressed a button and a list moved. An unopened box that sits there, breathing light
 * through its seams, is the thing the whole feature is named after and the only thing that
 * makes the button press feel like an event.
 *
 * **The reveal did not arrive, it replaced.** The reel vanished and a panel appeared; nothing
 * connected the item you watched land to the item you were being shown. Now the prize rises out
 * of the reel at the marker, the light comes up behind it, and the frame it lands in is built
 * from its own rarity.
 *
 * The sequence is four beats — `crate`, `bursting`, `spinning`, `revealed` — and each one is a
 * class on the root so the CSS owns the choreography and this file owns the timing.
 */

export const RARITY_COLORS: Record<Rarity, string> = {
  common: '#7d8aa0',
  rare: '#4aa8ff',
  epic: '#b46aff',
  legendary: '#ffc94d',
  mystic: '#c9a8ff',
};

/** Cell width including its gap, in pixels: 136 + 12. Must match `.reel-cell` and `.reel-track`. */
const CELL = 148;

/**
 * How many cells sit to the left of the marker when the reel starts.
 *
 * The old strip began with cell 0 *under* the marker, so the left half of the stage was an
 * empty black rectangle until the thing started moving — the idle state looked broken. Starting
 * a few cells in costs nothing and means the strip is a strip from the first frame.
 */
const LEAD_CELLS = 4;

/** Beat lengths for the crate, in ms. The reel's own timing comes from `reelTiming`. */
const SHAKE_MS = 620;
const BURST_MS = 380;

export interface WheelOutcome {
  result: WheelResult;
}

function cellHtml(cell: ReelCell, index: number): string {
  return `
    <div class="reel-cell rarity-${cell.item.rarity}" data-index="${index}">
      <div class="reel-art">${cosmeticPreviewHtml(cell.item, 72)}</div>
      <div class="reel-name">${cell.item.name}</div>
    </div>`;
}

/**
 * The case itself, before it is opened.
 *
 * Drawn rather than photographed, in the same flat-with-an-ink-outline language as the balls
 * and the cue, so it belongs to this game rather than to a generic loot-box. The lid is its own
 * group because it has to hinge open, and the seam is its own element because it has to glow
 * before anything else happens — that pulse is the case telling you there is something in it.
 */
function crateSvg(): string {
  return `
  <svg class="crate-svg" viewBox="0 0 220 176" aria-hidden="true">
    <defs>
      <linearGradient id="crateBody" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#3b2a52"/>
        <stop offset="1" stop-color="#1d1330"/>
      </linearGradient>
      <linearGradient id="crateLid" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#4a3566"/>
        <stop offset="1" stop-color="#2e2046"/>
      </linearGradient>
      <linearGradient id="crateBrass" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ffe9a8"/>
        <stop offset="0.5" stop-color="#d1a23c"/>
        <stop offset="1" stop-color="#7a5610"/>
      </linearGradient>
    </defs>

    <ellipse class="crate-shadow" cx="110" cy="164" rx="66" ry="10"/>

    <!-- Body -->
    <g class="crate-body">
      <rect x="26" y="78" width="168" height="78" rx="10" fill="url(#crateBody)" stroke="#120a1a" stroke-width="5"/>
      <rect x="38" y="90" width="144" height="54" rx="6" fill="#160e26" opacity="0.55"/>
      <!-- Corner braces -->
      <path d="M26 96V88a10 10 0 0 1 10-10h10" fill="none" stroke="url(#crateBrass)" stroke-width="6" stroke-linecap="round"/>
      <path d="M194 96V88a10 10 0 0 0-10-10h-10" fill="none" stroke="url(#crateBrass)" stroke-width="6" stroke-linecap="round"/>
      <path d="M26 138v8a10 10 0 0 0 10 10h10" fill="none" stroke="url(#crateBrass)" stroke-width="6" stroke-linecap="round"/>
      <path d="M194 138v8a10 10 0 0 1-10 10h-10" fill="none" stroke="url(#crateBrass)" stroke-width="6" stroke-linecap="round"/>
      <!-- The 8-ball emblem, so the case is unmistakably this game's -->
      <circle cx="110" cy="117" r="21" fill="#0f0f14" stroke="#120a1a" stroke-width="4"/>
      <circle cx="110" cy="117" r="11" fill="#fbf8ef"/>
      <text x="110" y="118" font-family="Fredoka, Nunito, sans-serif" font-size="15" font-weight="900"
            text-anchor="middle" dominant-baseline="central" fill="#14141a">8</text>
      <ellipse cx="102" cy="108" rx="6" ry="4" fill="#fff" opacity="0.45" transform="rotate(-28 102 108)"/>
    </g>

    <!--
      What is inside, seen through the seam.

      Sits just *below* the lid's bottom edge rather than behind the lid: at y=66 the whole
      thing was hidden under the lid panel drawn after it, so the one element that is supposed
      to be moving while the case waits was invisible.
    -->
    <rect class="crate-glow" x="40" y="76" width="140" height="14" rx="7"/>

    <!-- Lid -->
    <g class="crate-lid">
      <rect x="20" y="42" width="180" height="38" rx="10" fill="url(#crateLid)" stroke="#120a1a" stroke-width="5"/>
      <rect x="20" y="42" width="180" height="12" rx="6" fill="#ffffff" opacity="0.09"/>
      <path d="M20 62h180" stroke="#120a1a" stroke-width="3" opacity="0.5"/>
      <rect x="96" y="62" width="28" height="22" rx="5" fill="url(#crateBrass)" stroke="#120a1a" stroke-width="4"/>
      <circle cx="110" cy="73" r="3.4" fill="#120a1a"/>
    </g>
  </svg>`;
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
    overlay.className = 'case-overlay phase-crate';
    overlay.innerHTML = `
      <div class="case-shell" role="dialog" aria-modal="true" aria-label="Open a case">
        <header class="case-head">
          <div class="case-title">
            <span class="case-kicker">Locker</span>
            <h2>Case</h2>
          </div>
          <span class="case-spins" id="caseSpins"></span>
          <button class="icon-btn case-x" id="caseCloseBtn" title="Close" aria-label="Close">&#215;</button>
        </header>

        <div class="case-stage" id="caseStage">
          <div class="crate" id="crate">${crateSvg()}</div>

          <div class="reel-stage" id="reelStage">
            <div class="reel-track" id="reelTrack"></div>
            <div class="reel-fade left"></div>
            <div class="reel-fade right"></div>
            <div class="reel-marker" aria-hidden="true"><i></i><i></i></div>
          </div>

          <div class="case-reveal" id="caseReveal" aria-live="polite"></div>
        </div>

        <footer class="case-foot">
          <button class="case-open" id="caseOpenBtn"><span>Open case</span></button>
          <div class="case-odds" id="caseOdds"></div>
        </footer>
      </div>`;
    parent.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));

    const shell = overlay.querySelector<HTMLElement>('.case-shell')!;
    const track = overlay.querySelector<HTMLElement>('#reelTrack')!;
    const stage = overlay.querySelector<HTMLElement>('#reelStage')!;
    const crate = overlay.querySelector<HTMLElement>('#crate')!;
    const revealEl = overlay.querySelector<HTMLElement>('#caseReveal')!;
    const openBtn = overlay.querySelector<HTMLButtonElement>('#caseOpenBtn')!;
    const closeBtn = overlay.querySelector<HTMLButtonElement>('#caseCloseBtn')!;
    const spinsEl = overlay.querySelector<HTMLElement>('#caseSpins')!;
    const odds = overlay.querySelector<HTMLElement>('#caseOdds')!;

    let last: WheelOutcome | null = null;
    let busy = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const after = (ms: number, fn: () => void): void => {
      timers.push(setTimeout(fn, ms));
    };

    /*
     * The odds, stated plainly and permanently, as a bar rather than a row of chips.
     *
     * A case that hides its own distribution is doing something it does not want looked at —
     * that was true of the chips too. The bar says the same thing and also *shows* it: the
     * common band is half the width because commons are half the outcomes, which is a fact you
     * can take in without reading five percentages.
     */
    const totalWeight = Object.values(RARITY_WEIGHTS).reduce((a, b) => a + b, 0);
    const tiers = (Object.keys(RARITY_WEIGHTS) as Rarity[]).sort(
      (a, b) => rarityRank(a) - rarityRank(b)
    );
    odds.innerHTML = `
      <div class="odds-bar">
        ${tiers
          .map(
            (r) =>
              `<span class="odds-seg" style="--c:${RARITY_COLORS[r]};flex:${RARITY_WEIGHTS[r]}"
                     title="${RARITY_LABELS[r]} ${Math.round((RARITY_WEIGHTS[r] / totalWeight) * 100)}%"></span>`
          )
          .join('')}
      </div>
      <div class="odds-keys">
        ${tiers
          .map(
            (r) =>
              `<span class="odds-key" style="--c:${RARITY_COLORS[r]}">${RARITY_LABELS[r]}
                 <b>${Math.round((RARITY_WEIGHTS[r] / totalWeight) * 100)}%</b></span>`
          )
          .join('')}
      </div>`;

    const refresh = (): void => {
      const spins = getProfile().spins;
      spinsEl.textContent = `${spins} ${spins === 1 ? 'key' : 'keys'}`;
      spinsEl.classList.toggle('empty', spins <= 0);
      openBtn.disabled = spins <= 0 || busy;
      openBtn.querySelector('span')!.textContent = spins > 0 ? 'Open case' : 'No keys left';
    };

    /** Fills the strip so the stage is never an empty box. */
    const layIdleStrip = (): void => {
      const idle = buildReel(seedItem());
      track.innerHTML = idle.map(cellHtml).join('');
      track.style.transition = 'none';
      track.style.transform = `translateX(${LEAD_CELLS * CELL}px)`;
    };
    layIdleStrip();
    refresh();

    // ---- Dismissal ----------------------------------------------------------------

    const finish = (): void => {
      for (const t of timers) clearTimeout(t);
      document.removeEventListener('keydown', onKey, true);
      overlay.classList.remove('open');
      // Let the fade out play before the node goes; the promise resolves with it.
      setTimeout(() => {
        overlay.remove();
        resolve(last);
      }, 180);
    };

    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        // Never mid-spin: the prize is already spent, and vanishing the dialog on the way to
        // showing it looks exactly like losing it.
        if (busy) {
          e.preventDefault();
          return;
        }
        e.preventDefault();
        finish();
        return;
      }
      if (e.key === 'Tab') {
        const items = [...shell.querySelectorAll<HTMLElement>('button:not([disabled])')];
        if (items.length === 0) return;
        const first = items[0];
        const lastEl = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener('keydown', onKey, true);

    closeBtn.addEventListener('click', () => {
      if (!busy) finish();
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay && !busy) finish();
    });

    // ---- The sequence -------------------------------------------------------------

    /**
     * The whole sequence, from a closed case to a revealed prize.
     *
     * Extracted because two buttons start it: the one in the footer, and "Open another" on the
     * reveal. That second one used to merely put a closed case back on the stage, so a button
     * that said "open another" cost two presses to open another — the label promised an action
     * and delivered a navigation.
     */
    function runOpen(): void {
      if (busy) return;
      sfx.unlockAudio();

      const result = spendSpin();
      if (!result) {
        finish();
        return;
      }
      last = { result };
      busy = true;
      refresh();
      closeBtn.disabled = true;
      revealEl.innerHTML = '';
      overlay.className = 'case-overlay open phase-crate shaking';
      setRarity(result.item.rarity);

      sfx.playUiHero(volume);

      if (stillMotion) {
        // Reduce motion: no shake, no scroll. Straight to the answer, which is the only part
        // that was ever information rather than theatre.
        overlay.className = 'case-overlay open phase-spinning';
        const cells = buildReel(result.item);
        track.innerHTML = cells.map(cellHtml).join('');
        track.style.transition = 'none';
        track.style.transform = `translateX(${-(REEL_WINNER_INDEX * CELL)}px)`;
        landed(result);
        return;
      }

      // Beat 1: the case rattles, and the light through the seam builds with it.
      after(SHAKE_MS, () => {
        overlay.className = 'case-overlay open phase-bursting';
        sfx.playReveal(volume, 0);

        // Beat 2: the lid goes, the flash covers the swap, and the reel is already running
        // underneath by the time the flash clears.
        after(BURST_MS, () => {
          overlay.className = 'case-overlay open phase-spinning';
          spinReel(result);
        });
      });
    }

    openBtn.addEventListener('click', runOpen);

    function setRarity(rarity: Rarity): void {
      shell.style.setProperty('--rc', RARITY_COLORS[rarity]);
      shell.dataset.rarity = rarity;
    }

    function spinReel(result: WheelResult): void {
      const cells = buildReel(result.item);
      track.innerHTML = cells.map(cellHtml).join('');

      const timing = reelTiming(result.item.rarity);
      const settleFraction = timing.settleMs / timing.durationMs;
      // Land the winning cell under the marker, with a small random offset inside the cell so
      // it never stops at exactly the same pixel twice.
      const jitter = (Math.random() - 0.5) * CELL * 0.34;
      const from = -LEAD_CELLS * CELL;
      const to = REEL_WINNER_INDEX * CELL + jitter;

      track.style.transition = 'none';
      const start = performance.now();
      let lastCell = -999;

      const step = (): void => {
        const t = Math.min(1, (performance.now() - start) / timing.durationMs);
        const x = from + (to - from) * reelEase(t, settleFraction);
        track.style.transform = `translateX(${-x}px)`;

        // A tick per cell crossing the marker. The gaps widen on their own as it slows, which
        // is the sound of the thing decelerating rather than a separate effect.
        //
        // Rounded, not floored: cell i is centred under the marker at x = i·CELL, so the cell
        // *under* the marker is the nearest one. Flooring lit the near-miss for the half cell
        // after it had already gone past, and ticked on cell centres instead of on the gaps
        // between them, where a real reel's pawl clicks.
        const cellIndex = Math.round(x / CELL);
        if (cellIndex !== lastCell) {
          lastCell = cellIndex;
          sfx.playWheelTick(volume);
          // Light the near-miss as it goes past, so the tease is seen and not merely present.
          stage.classList.toggle('teasing', Boolean(cells[cellIndex]?.nearMiss));
        }

        if (t < 1) {
          requestAnimationFrame(step);
          return;
        }
        stage.classList.remove('teasing');
        landed(result);
      };
      requestAnimationFrame(step);
    }

    function landed(result: WheelResult): void {
      const rank = rarityRank(result.item.rarity);
      sfx.playReveal(volume, rank);

      stage.classList.add('landed');
      track.querySelector<HTMLElement>(`[data-index="${REEL_WINNER_INDEX}"]`)?.classList.add('is-winner');

      // A rarer prize gets a longer look at the reel before the reveal comes up over it. The
      // pause is the game telling you something is coming; making it constant tells you nothing.
      const hold = stillMotion ? 0 : 320 + rank * 190;
      after(hold, () => {
        if (!stillMotion && rank >= 2) burst(overlay, result.item.rarity, rank);
        showReveal(result);
      });
    }

    function showReveal(result: WheelResult): void {
      const { item, duplicate } = result;
      overlay.classList.add('phase-revealed');
      revealEl.innerHTML = revealHtml(item, duplicate);

      busy = false;
      closeBtn.disabled = false;
      refresh();

      const again = revealEl.querySelector<HTMLButtonElement>('#revealAgain');
      const done = revealEl.querySelector<HTMLButtonElement>('#revealDone');
      again?.focus();

      again?.addEventListener('click', () => {
        if (getProfile().spins <= 0) {
          finish();
          return;
        }
        // Reset the stage to a closed case and immediately open it again — five keys should
        // not mean opening and closing this dialog five times, nor pressing twice per case.
        overlay.className = 'case-overlay open phase-crate';
        stage.classList.remove('landed');
        revealEl.innerHTML = '';
        layIdleStrip();
        refresh();
        // A frame's gap so the crate is actually on screen before it starts shaking; without
        // it the reset and the shake land in the same paint and the case never appears closed.
        requestAnimationFrame(() => requestAnimationFrame(runOpen));
      });
      done?.addEventListener('click', finish);
    }

    function revealHtml(item: CosmeticItem, duplicate: boolean): string {
      const spins = getProfile().spins;
      return `
        <div class="case-rays" aria-hidden="true"></div>
        <div class="reveal-halo" aria-hidden="true"></div>
        <div class="reveal-card">
          <div class="reveal-frame">
            <div class="reveal-art">${cosmeticPreviewHtml(item, 124)}</div>
          </div>
          <div class="reveal-tier">${RARITY_LABELS[item.rarity]}</div>
          <h3 class="reveal-name">${item.name}</h3>
          <div class="reveal-slot">${SLOT_LABELS[item.slot]}</div>
          <p class="reveal-blurb">${item.blurb}</p>
          ${
            duplicate
              ? `<div class="reveal-status dupe">
                   <span class="reveal-chalk">+${chalkForDuplicate(item.rarity)}</span>
                   <span>Already yours — traded for chalk</span>
                 </div>`
              : `<div class="reveal-status new">Added to your locker</div>`
          }
        </div>
        <div class="reveal-actions">
          <button class="case-open" id="revealAgain"><span>${
            spins > 0 ? `Open another · ${spins}` : 'Nice'
          }</span></button>
          ${spins > 0 ? '<button class="secondary" id="revealDone">Done</button>' : ''}
        </div>`;
    }

    openBtn.focus();
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
  const count = 18 + rank * 16;
  for (let i = 0; i < count; i++) {
    const bit = document.createElement('i');
    bit.style.setProperty('--x', `${(Math.random() - 0.5) * 640}px`);
    bit.style.setProperty('--y', `${-160 - Math.random() * 340}px`);
    bit.style.setProperty('--r', `${Math.random() * 720 - 360}deg`);
    bit.style.setProperty('--d', `${480 + Math.random() * 740}ms`);
    bit.style.setProperty('--c', RARITY_COLORS[rarity]);
    layer.appendChild(bit);
  }
  overlay.appendChild(layer);
  setTimeout(() => layer.remove(), 1900);
}

/** Exposed for the profile page's odds readout. */
export function rarityOdds(): Array<{ rarity: Rarity; pct: number }> {
  const total = Object.values(RARITY_WEIGHTS).reduce((a, b) => a + b, 0);
  return (Object.keys(RARITY_WEIGHTS) as Rarity[]).map((rarity) => ({
    rarity,
    pct: Math.round((RARITY_WEIGHTS[rarity] / total) * 100),
  }));
}
