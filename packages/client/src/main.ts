/*
 * Layers, in the order they are allowed to override each other.
 *
 * They used to be four files named after the order they were written in — a base, a cosmetics
 * sheet, a "home" sheet that had grown to hold the HUD and the stats page and the online lobby,
 * and a theme sheet whose stated job was re-skinning the first one. The cascade encoded the
 * project's history rather than any structure, so eighty-one selectors were defined in two
 * places at once and changing a button meant finding all of them.
 *
 * Now each layer may only override the ones above it: tokens are facts, base knows nothing
 * about pool, components are what every screen is built from, and game and screens are the two
 * places something is allowed to be local to.
 */
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/game.css';
import './styles/screens.css';
import './styles/cosmetics.css';
import { startRouter, setCleanup, replace } from './router';
import { renderHomePage } from './pages/homePage';
import { renderHostPage } from './pages/hostPage';
import { renderControllerPage } from './pages/controllerPage';
import { renderProfilePage } from './pages/profilePage';
import { renderChallengesPage } from './pages/challengesPage';
import { renderCareerPage } from './pages/careerPage';
import { renderProgressPage } from './pages/progressPage';
import { renderStatsPage } from './pages/statsPage';
import { renderOnlinePage } from './pages/onlinePage';
import { unlockAudio } from './render/audio';
import { startMusic } from './render/music';
import { startAmbience } from './render/ambience';
import { tableThemeFor } from './render/cosmetics/tableThemes';
import { loadSettings } from './settings/settingsStore';
import { applyMotionClasses } from './settings/applySettings';
import { SyncedProfileStore } from './profile/syncedProfileStore';
import { adoptProfile, useProfileStore } from './profile/profile';
import { checkAchievements } from './profile/progression';

const app = document.getElementById('app')!;

/*
 * Motion preferences, before anything draws.
 *
 * These were only ever applied from the settings panel's save callback, so somebody who had
 * turned motion off and reopened the game got every animation back until they went and
 * changed a setting. It did not show while the menus barely moved. They move now.
 */
applyMotionClasses(loadSettings());

/**
 * Profiles live on the server now, but nothing waits for them.
 *
 * The store is local-first: the game reads and writes localStorage immediately and reconciles
 * with the server in the background, so a slow or absent server costs nothing. `hydrate` runs
 * without being awaited for the same reason — the menu draws from the local copy, and the
 * server's version replaces it a moment later if it turns out to be newer.
 *
 * In dev the client and server are on different ports; in production the server serves the
 * client, so a relative URL is right.
 */
const profileStore = new SyncedProfileStore(
  import.meta.env.DEV ? `http://${window.location.hostname}:8787` : ''
);
useProfileStore(profileStore);
export { profileStore };

void profileStore.hydrate((profile) => {
  adoptProfile(profile);
  backfillAchievements();
});

/**
 * Award anything already earned but never granted.
 *
 * Achievements are pure predicates over a stats snapshot precisely so this is possible: a
 * player who potted their five-hundredth ball before the achievement existed should be given
 * it, not locked out of it. Runs at boot and after the server's copy lands, since either can
 * be the moment the stats first become known.
 */
function backfillAchievements(): void {
  const earned = checkAchievements();
  if (earned.length > 0) {
    console.info(`Awarded ${earned.length} achievement(s) earned before they existed.`);
  }
}

backfillAchievements();

/**
 * Browsers refuse to start audio until the user has interacted, so the music can't begin at
 * page load. The first tap anywhere unlocks the context and starts the score for whichever
 * table theme is selected.
 */
window.addEventListener(
  'pointerdown',
  () => {
    unlockAudio();
    const settings = loadSettings();
    if (settings.musicEnabled && !settings.reduceMotion) {
      startMusic(tableThemeFor(settings.tableTheme).id, settings.musicVolume);
    }
    if (settings.ambienceEnabled) {
      startAmbience(tableThemeFor(settings.tableTheme).id, settings.ambienceVolume);
    }
  },
  { once: true }
);

startRouter(app, (path) => {
  const tableMatch = path.match(/^\/table\/([A-Za-z0-9]{4})$/);
  const playMatch = path.match(/^\/play\/([A-Za-z0-9]{4})$/);
  // Online tables get their own short path. Same page as a host screen underneath — the
  // difference is entry and which seat this device plays, not the game.
  const onlineMatch = path.match(/^\/t\/([A-Za-z0-9]{4})$/);

  if (tableMatch) {
    setCleanup(renderHostPage(app, tableMatch[1].toUpperCase()));
  } else if (playMatch) {
    setCleanup(renderControllerPage(app, playMatch[1].toUpperCase()));
  } else if (onlineMatch) {
    setCleanup(renderHostPage(app, onlineMatch[1].toUpperCase(), { online: true }));
  } else if (path === '/online') {
    setCleanup(renderOnlinePage(app));
  } else if (path === '/progress') {
    setCleanup(renderProgressPage(app));
  } else if (path === '/stats') {
    setCleanup(renderStatsPage(app));
  } else if (path === '/career') {
    setCleanup(renderCareerPage(app));
  } else if (path === '/profile') {
    setCleanup(renderProfilePage(app));
  } else if (path === '/challenges') {
    setCleanup(renderChallengesPage(app));
  } else {
    /*
     * Anything else is the menu. The URL is corrected to match rather than left saying
     * `/nonsense` while the menu is on screen — otherwise the address bar disagrees with the
     * page, and the bad path goes on to enter the navigation stack, so "back" walks through
     * somewhere that was never really visited.
     *
     * `replace`, not `navigate`: a mistyped URL is not a place you were.
     */
    if (path !== '/') replace('/');
    setCleanup(renderHomePage(app));
  }
});
