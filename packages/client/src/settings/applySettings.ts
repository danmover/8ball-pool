import type { PlayerSettings } from '@8ball/shared';
import type { TableRenderer } from '../render/TableRenderer';
import { applyTableThemeToPage, tableThemeFor } from '../render/cosmetics/tableThemes';
import { setMusicVolume, startMusic, stopMusic } from '../render/music';
import { setAmbienceVolume, startAmbience, stopAmbience } from '../render/ambience';

/**
 * One place that maps settings onto the renderer and the document, so the host screen, the
 * phone controller and the menu backdrop can't drift apart on what a setting means.
 */
export function applyRenderSettings(
  renderer: TableRenderer | null,
  settings: PlayerSettings
): void {
  // Reduce motion is a master switch: it forces the low-effects path on top of its own.
  const effects = settings.reduceMotion ? 'low' : settings.effectsIntensity;

  renderer?.setColorblindPatterns(settings.colorblindPatterns);
  renderer?.setTableTheme(settings.tableTheme);
  renderer?.setEffectsIntensity(effects);
  renderer?.setTrailsEnabled(settings.ballTrails && !settings.reduceMotion);
  renderer?.setShakeEnabled(settings.screenShake && !settings.reduceMotion);

  // The surround behind the table follows the theme even on pages with no renderer.
  applyTableThemeToPage(tableThemeFor(settings.tableTheme));

  // Each table theme is scored, so switching the table switches the music with it.
  if (settings.musicEnabled && !settings.reduceMotion) {
    startMusic(tableThemeFor(settings.tableTheme).id, settings.musicVolume);
  } else {
    stopMusic();
  }
  setMusicVolume(settings.musicEnabled ? settings.musicVolume : 0);

  // The room is a separate bus from the music, so it survives the tune being turned off.
  // `reduceMotion` deliberately does *not* silence it — it is about movement, not sound, and a
  // steady room tone is if anything the calmer option.
  if (settings.ambienceEnabled) {
    startAmbience(tableThemeFor(settings.tableTheme).id, settings.ambienceVolume);
  } else {
    stopAmbience();
  }
  setAmbienceVolume(settings.ambienceEnabled ? settings.ambienceVolume : 0);

  // Drives the CSS that stills banner effects and celebrations.
  document.body.classList.toggle('fx-low', effects === 'low');
  document.body.classList.toggle('reduce-motion', settings.reduceMotion);
}
