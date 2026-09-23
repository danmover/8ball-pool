import { signal } from '@preact/signals';

/** The current path. Screens are chosen from it in `App`. */
export const route = signal(location.pathname);

window.addEventListener('popstate', () => {
  route.value = location.pathname;
});

export function navigate(to: string, replace = false): void {
  if (to === location.pathname) return;
  if (replace) history.replaceState({}, '', to);
  else history.pushState({}, '', to);
  route.value = location.pathname;
}

/** Back, or home when there is nowhere to go back to within the app. */
export function goBack(fallback = '/'): void {
  if (history.state && history.length > 1 && document.referrer.startsWith(location.origin)) history.back();
  else navigate(fallback);
}

/** `/room/:code` style matching. Returns the params or null. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/').filter(Boolean);
  const s = path.split('/').filter(Boolean);
  if (p.length !== s.length) return null;
  const out: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(':')) out[p[i].slice(1)] = decodeURIComponent(s[i]);
    else if (p[i] !== s[i]) return null;
  }
  return out;
}
