import type { PlayerSettings } from '@8ball/shared';
import type { TableRenderer } from '../render/TableRenderer';
import { applyTableThemeToPage, tableThemeFor, venueFor } from '../render/cosmetics/tableThemes';
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

  const theme = tableThemeFor(settings.tableTheme);
  /*
   * The room, as opposed to the table.
   *
   * Scenes, music and ambience are authored per shipped venue, and a table built in the Theme
   * Studio is not one of those — so it borrows the room of the preset it shares a lamp with.
   * All three have to agree on that, or you get an ice cavern that sounds like a pub.
   */
  const venue = venueFor(theme);

  renderer?.setColorblindPatterns(settings.colorblindPatterns);
  renderer?.setTableTheme(settings.tableTheme);
  renderer?.setEffectsIntensity(effects);
  renderer?.setTrailsEnabled(settings.ballTrails && !settings.reduceMotion);
  renderer?.setShakeEnabled(settings.screenShake && !settings.reduceMotion);
  // The moving half of the room is the first thing "reduce motion" is actually about.
  renderer?.setAmbientMotion(!settings.reduceMotion);

  // The surround behind the table follows the theme even on pages with no renderer.
  applyTableThemeToPage(theme);

  // Each table theme is scored, so switching the table switches the music with it.
  if (settings.musicEnabled && !settings.reduceMotion) {
    startMusic(venue, settings.musicVolume);
  } else {
    stopMusic();
  }
  setMusicVolume(settings.musicEnabled ? settings.musicVolume : 0);

  // The room is a separate bus from the music, so it survives the tune being turned off.
  // `reduceMotion` deliberately does *not* silence it — it is about movement, not sound, and a
  // steady room tone is if anything the calmer option.
  if (settings.ambienceEnabled) {
    startAmbience(venue, settings.ambienceVolume);
  } else {
    stopAmbience();
  }
  setAmbienceVolume(settings.ambienceEnabled ? settings.ambienceVolume : 0);

  applyMotionClasses(settings, effects);
}

/**
 * The two body classes the CSS keys motion off, applied without needing a renderer.
 *
 * These used to be set only inside `applyRenderSettings`, which the menus call *only* from the
 * settings panel's save callback — so a player who had turned motion off and then opened the
 * game got the full set of animations until they went into settings and changed something.
 * Nobody noticed while the menus barely moved; they move now, so this is called at start-up
 * as well.
 */
export function applyMotionClasses(
  settings: PlayerSettings,
  effects: PlayerSettings['effectsIntensity'] = settings.effectsIntensity
): void {
  document.body.classList.toggle('fx-low', effects === 'low');
  document.body.classList.toggle('reduce-motion', settings.reduceMotion);
}
