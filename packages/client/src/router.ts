export type RouteHandler = (root: HTMLElement) => void | (() => void);

let currentCleanup: (() => void) | void;

function resolve(root: HTMLElement, onRoute: (path: string) => void): void {
  if (currentCleanup) currentCleanup();
  root.innerHTML = '';
  currentCleanup = undefined;
  onRoute(window.location.pathname);
}

export function navigate(path: string): void {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function startRouter(root: HTMLElement, onRoute: (path: string) => void): void {
  window.addEventListener('popstate', () => resolve(root, onRoute));
  resolve(root, onRoute);
}

export function setCleanup(fn: () => void): void {
  currentCleanup = fn;
}
