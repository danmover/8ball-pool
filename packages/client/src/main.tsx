import '@fontsource-variable/outfit';
import './styles/tokens.css';
import './styles/base.css';
import './styles/ui.css';
import './styles/screens.css';
import './styles/hud.css';
import { render } from 'preact';
import { App } from './app/App';
import { unlockAudio } from './audio/sfx';
import { startMusic } from './audio/music';
import { settings } from './state/settings';
import { route } from './app/router';

render(<App />, document.getElementById('app')!);

/*
 * Browsers only start audio after a gesture. The first tap anywhere unlocks it, and starts the
 * menu music if the player is on a menu.
 */
window.addEventListener(
  'pointerdown',
  () => {
    unlockAudio();
    const onTable = route.value.startsWith('/room/') || route.value === '/local';
    // resume() is asynchronous; start the music once the context is actually running.
    setTimeout(() => {
      if (settings.value.musicOn && !onTable) startMusic();
    }, 120);
  },
  { once: true }
);

// Offline play: the service worker caches the whole game after the first visit.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* offline caching unavailable — the game still works online */
    });
  });
}
