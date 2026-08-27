import './style.css';
import './cosmetics.css';
import './home.css';
// Last, so it re-skins components built against the old dark palette.
import './theme.css';
import { startRouter, setCleanup } from './router';
import { renderHomePage } from './pages/homePage';
import { renderHostPage } from './pages/hostPage';
import { renderControllerPage } from './pages/controllerPage';
import { renderProfilePage } from './pages/profilePage';
import { renderChallengesPage } from './pages/challengesPage';
import { renderCareerPage } from './pages/careerPage';
import { unlockAudio } from './render/audio';
import { startMusic } from './render/music';
import { tableThemeFor } from './render/cosmetics/tableThemes';
import { loadSettings } from './settings/settingsStore';
import { SyncedProfileStore } from './profile/syncedProfileStore';
import { adoptProfile, useProfileStore } from './profile/profile';

const app = document.getElementById('app')!;

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

void profileStore.hydrate((profile) => adoptProfile(profile));

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
  },
  { once: true }
);

startRouter(app, (path) => {
  const tableMatch = path.match(/^\/table\/([A-Za-z0-9]{4})$/);
  const playMatch = path.match(/^\/play\/([A-Za-z0-9]{4})$/);

  if (tableMatch) {
    setCleanup(renderHostPage(app, tableMatch[1].toUpperCase()));
  } else if (playMatch) {
    setCleanup(renderControllerPage(app, playMatch[1].toUpperCase()));
  } else if (path === '/career') {
    setCleanup(renderCareerPage(app));
  } else if (path === '/profile') {
    setCleanup(renderProfilePage(app));
  } else if (path === '/challenges') {
    setCleanup(renderChallengesPage(app));
  } else {
    setCleanup(renderHomePage(app));
  }
});
