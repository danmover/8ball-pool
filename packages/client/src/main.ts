import './style.css';
import { startRouter, setCleanup } from './router';
import { renderLanding } from './pages/landing';
import { renderHostPage } from './pages/hostPage';
import { renderControllerPage } from './pages/controllerPage';

const app = document.getElementById('app')!;

startRouter(app, (path) => {
  const tableMatch = path.match(/^\/table\/([A-Za-z0-9]{4})$/);
  const playMatch = path.match(/^\/play\/([A-Za-z0-9]{4})$/);

  if (tableMatch) {
    setCleanup(renderHostPage(app, tableMatch[1].toUpperCase()));
  } else if (playMatch) {
    setCleanup(renderControllerPage(app, playMatch[1].toUpperCase()));
  } else {
    renderLanding(app);
  }
});
