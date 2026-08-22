import type { PlayerSettings } from '@8ball/shared';
import { xpForPot } from '@8ball/shared';
import type { TableRenderer } from './TableRenderer';
import * as sfx from './sfx';

/**
 * Owns the "ball went in" moment. Everything here is driven off the `pot` / `shotSettled`
 * events the client already receives — the server sends no extra data and the rules are
 * untouched; this is spectacle and XP only.
 *
 * Layers, smallest to biggest:
 *   1. the drop itself (handled by TableRenderer.spawnPotFlash, scaled by combo)
 *   2. an XP toast flying off the pocket
 *   3. a combo callout for the second and later balls on one shot
 *   4. a streak state ("ON FIRE") across turns, owned by the caller
 *   5. a takeover flash when the game-winning ball drops
 */

const COMBO_WORDS = ['', 'DOUBLE!', 'TRIPLE!', 'QUAD!', 'RAMPAGE!', 'UNREAL!', 'ABSURD!'];

export interface ShotSummary {
  pots: number;
  /** Highest combo index reached, i.e. `pots - 1` clamped at 0. */
  bestCombo: number;
  xp: number;
}

export class PotCelebrator {
  private root: HTMLElement;
  private renderer: () => TableRenderer | null;
  private settings: PlayerSettings;
  private comboCount = 0;
  private shotXp = 0;

  constructor(root: HTMLElement, renderer: () => TableRenderer | null, settings: PlayerSettings) {
    this.root = root;
    this.renderer = renderer;
    this.settings = settings;
  }

  private get volume(): number {
    return this.settings.soundEnabled ? this.settings.soundVolume : 0;
  }

  /**
   * Call for every `pot` event. Returns the combo index of this ball (0 = first on the shot),
   * so callers can escalate their own feedback (haptics, banner flare) in step.
   */
  onPot(pos: { x: number; y: number }, ballId: number): number {
    const renderer = this.renderer();

    // A scratch is a pot event too, but it's a foul — it still gets a (muted) drop effect,
    // and definitely no combo credit or XP.
    if (ballId === 0) {
      renderer?.spawnPotFlash(pos, ballId, 0);
      sfx.playPocketSwish(this.volume);
      return -1;
    }

    const comboIndex = this.comboCount;
    this.comboCount++;

    renderer?.spawnPotFlash(pos, ballId, comboIndex);

    const xp = xpForPot(comboIndex);
    this.shotXp += xp;

    if (comboIndex === 0) {
      sfx.playPocketSwish(this.volume);
    } else {
      sfx.playCombo(this.volume, comboIndex);
      this.showCallout(COMBO_WORDS[Math.min(comboIndex, COMBO_WORDS.length - 1)], comboIndex);
    }

    if (renderer) {
      const screen = renderer.tableToScreen(pos.x, pos.y);
      this.flyXpToast(screen, xp);
    }

    return comboIndex;
  }

  /** Call on `shotSettled`. Returns what the shot was worth and resets for the next one. */
  onShotSettled(): ShotSummary {
    const summary: ShotSummary = {
      pots: this.comboCount,
      bestCombo: Math.max(0, this.comboCount - 1),
      xp: this.shotXp,
    };
    this.comboCount = 0;
    this.shotXp = 0;
    return summary;
  }

  /**
   * The game-winning ball. A true slow-motion isn't available — the sim is authoritative
   * server-side at a fixed rate — so this is a freeze-and-punch: a hard white flash centred
   * on the pocket, which at this pace reads the same.
   */
  celebrateWin(pos: { x: number; y: number } | null): void {
    const renderer = this.renderer();
    const screen = pos && renderer ? renderer.tableToScreen(pos.x, pos.y) : null;

    const flash = document.createElement('div');
    flash.className = 'win-flash';
    if (screen) {
      flash.style.setProperty('--fx', `${screen.x}px`);
      flash.style.setProperty('--fy', `${screen.y}px`);
    }
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 800);

    renderer?.shake(16);
    this.showCallout('GAME!', 5);
  }

  private showCallout(text: string, tier: number): void {
    if (!text) return;
    const el = document.createElement('div');
    el.className = 'combo-callout';
    el.textContent = text;
    // Bigger words for bigger runs, capped so a long runout doesn't fill the screen.
    el.style.fontSize = `${Math.min(2.2 + tier * 0.55, 5)}rem`;
    this.root.appendChild(el);
    setTimeout(() => el.remove(), 1200);
    this.renderer()?.shake(4 + tier * 2);
  }

  private flyXpToast(screen: { x: number; y: number }, xp: number): void {
    if (this.settings.effectsIntensity === 'low') return;
    const el = document.createElement('div');
    el.className = 'xp-toast';
    el.textContent = `+${xp} XP`;
    el.style.left = `${screen.x}px`;
    el.style.top = `${screen.y}px`;
    document.body.appendChild(el);
    // Next frame, so the transition has a start value to animate from.
    requestAnimationFrame(() => {
      el.style.transform = 'translate(-50%, -70px)';
      el.style.opacity = '0';
    });
    setTimeout(() => el.remove(), 1000);
  }
}
