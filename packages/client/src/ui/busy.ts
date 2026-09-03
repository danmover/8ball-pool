/**
 * "Working on it."
 *
 * Nothing in the game had a pending state. Every screen that starts a game does the same
 * thing — emit, wait for the server to answer with a room code, then navigate — and in the gap
 * the button sat there looking exactly as it had before it was pressed. On anything slower than
 * localhost that is indistinguishable from a dead button, so people press it again, and the
 * career page then hosts two rooms.
 *
 * `launching` flags already existed in two pages to stop the double-fire. They were never shown
 * to anybody. This is the showing.
 */

/**
 * Marks a button as busy, or stops.
 *
 * Disabled as well as styled, because the guard and the appearance should not be two separate
 * things somebody can get out of step — that is exactly how the career page ended up with a
 * flag it never rendered. The disabled *look* is suppressed in CSS: greyed out says "you may
 * not", and the truth here is "not yet".
 */
export function setBusy(btn: HTMLButtonElement, busy: boolean): void {
  btn.classList.toggle('is-busy', busy);
  btn.disabled = busy;
  // Screen readers get told rather than shown. Without this the button simply goes quiet.
  btn.setAttribute('aria-busy', String(busy));
}

/**
 * Runs an action that finishes by navigating away, holding the button busy until it does.
 *
 * Takes a callback-style action rather than a promise because that is the shape of every call
 * site: `socket.emit(event, payload, (res) => …)`. Wrapping those in promises first would be a
 * larger change than the problem deserves.
 *
 * The `done` handed to the action is safe to call more than once, and safe not to call at all —
 * the usual ending is a navigation, which throws the whole page away.
 *
 * @returns whether the action was started. `false` means this button was already busy, which is
 *          the double-press this exists to stop.
 */
export function runBusy(btn: HTMLButtonElement, action: (done: () => void) => void): boolean {
  if (btn.disabled) return false;
  setBusy(btn, true);
  let settled = false;
  const done = (): void => {
    if (settled) return;
    settled = true;
    setBusy(btn, false);
  };
  try {
    action(done);
  } catch (err) {
    // A throw before the server is even reached would otherwise leave the button spinning for
    // ever, with no way back other than a reload.
    done();
    throw err;
  }
  return true;
}

/**
 * How long to wait before giving up on a server that never answers.
 *
 * Long enough not to fire on an ordinary slow connection, short enough that a button is never
 * stuck spinning with no way out. The action's own success path normally lands first.
 */
export const BUSY_TIMEOUT_MS = 8000;

/**
 * `runBusy` with a deadline.
 *
 * The failure this covers is a socket callback that never arrives — the server restarted, the
 * connection dropped between press and reply. Without it the button spins for ever and the only
 * way out of the screen is a reload.
 */
export function runBusyWithTimeout(
  btn: HTMLButtonElement,
  action: (done: () => void) => void,
  onTimeout?: () => void,
  timeoutMs = BUSY_TIMEOUT_MS
): boolean {
  let finished = false;
  // Bare `setTimeout` rather than `window.setTimeout`: this module is unit-tested, and the
  // tests run without a DOM.
  const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
    if (finished) return;
    finished = true;
    setBusy(btn, false);
    onTimeout?.();
  }, timeoutMs);

  return runBusy(btn, (done) => {
    action(() => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      done();
    });
  });
}
