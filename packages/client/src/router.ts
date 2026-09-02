export type RouteHandler = (root: HTMLElement) => void | (() => void);

let currentCleanup: (() => void) | void;

/**
 * Where "back" goes.
 *
 * Every page used to hard-code `navigate('/')` in its back button, so wherever you had come
 * from, back meant the home screen. Open the locker from the online lobby and you lost the
 * lobby; open it from your phone mid-frame and you lost the table. It also put the on-screen
 * button and the browser's own back button into disagreement, since `navigate` pushes history
 * and the browser therefore did the right thing while the button did not.
 *
 * A stack of the paths walked in this tab. Kept in `sessionStorage` so a reload does not
 * strand you: refreshing the locker should still have somewhere to go back to.
 */
const STACK_KEY = '8ball:nav';

function readStack(): string[] {
  try {
    const raw = sessionStorage.getItem(STACK_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function writeStack(stack: string[]): void {
  // A long stack is a sign of going round in circles, not of deep navigation.
  sessionStorage.setItem(STACK_KEY, JSON.stringify(stack.slice(-12)));
}

function resolve(root: HTMLElement, onRoute: (path: string) => void): void {
  if (currentCleanup) currentCleanup();
  root.innerHTML = '';
  currentCleanup = undefined;
  onRoute(window.location.pathname);
}

export function navigate(path: string): void {
  const here = window.location.pathname;
  if (path !== here) {
    const stack = readStack();
    /*
     * Going back to somewhere already on the stack unwinds to it rather than piling on. Without
     * this, table → locker → table → locker leaves four entries and "back" walks you through
     * the history of your own indecision instead of leaving.
     */
    const seen = stack.lastIndexOf(path);
    if (seen >= 0) stack.length = seen;
    else stack.push(here);
    writeStack(stack);
  }
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/**
 * The page before this one, or the home screen if there is none.
 *
 * `fallback` is for pages that have a sensible parent even when they were opened cold — a
 * shared link to a table, say, where "back" should offer the lobby rather than nothing.
 */
export function goBack(fallback = '/'): void {
  const stack = readStack();
  const previous = stack.pop();
  writeStack(stack);
  const target = previous ?? fallback;
  window.history.pushState({}, '', target);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/** Where `goBack()` would take you, so a button can name it. */
export function backTarget(fallback = '/'): string {
  const stack = readStack();
  return stack[stack.length - 1] ?? fallback;
}

/** Replaces the current entry instead of stacking — for redirects that are not navigation. */
export function replace(path: string): void {
  window.history.replaceState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function startRouter(root: HTMLElement, onRoute: (path: string) => void): void {
  window.addEventListener('popstate', () => resolve(root, onRoute));
  resolve(root, onRoute);
}

export function setCleanup(fn: () => void): void {
  currentCleanup = fn;
}
