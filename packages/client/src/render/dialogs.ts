import { icon, type IconName } from './icons';

/**
 * Shared chrome: the confirm dialog behind destructive actions, and the toast stack.
 *
 * Toasts used to render at the bottom of the screen, which on a table view is the one place
 * nobody is looking — everyone's watching the balls. They now stack under the scoreboard at
 * the top, framed like the rest of the UI.
 */

/**
 * Makes a scrim behave like a dialog rather than like a div that happens to be on top.
 *
 * Three things, all of which were missing and all of which are the difference between a dialog
 * and a trap: **Escape closes it** (the confirm dialog had no keyboard exit at all, so a
 * keyboard user who opened "End the game?" could not decline it); **focus is held inside**, so
 * Tab cannot wander onto the page behind and press something there; and **focus goes back**
 * where it came from on close, rather than to the top of the document.
 *
 * @returns the `close` the caller should use — it undoes the listeners as well as the markup.
 */
function asDialog(scrim: HTMLElement, label: string): () => void {
  return modalBehaviour(scrim, scrim.querySelector<HTMLElement>('.dialog')!, label);
}

/**
 * The same, for anything that behaves like a dialog without being one of the two above — the
 * settings drawer, chiefly.
 *
 * @param scrim   the dimmed backdrop, removed on close.
 * @param panel   the thing focus is held inside.
 * @param onClose extra teardown the caller owns, run before the panel goes.
 */
export function modalBehaviour(
  scrim: HTMLElement,
  panel: HTMLElement,
  label: string,
  onClose?: () => void
): () => void {
  const dialog = panel;
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', label);

  // Where to put focus back. Reading it now, before anything in here takes it.
  const opener = document.activeElement as HTMLElement | null;

  const focusable = (): HTMLElement[] =>
    [...dialog.querySelectorAll<HTMLElement>('button, input, [href], [tabindex]:not([tabindex="-1"])')]
      .filter((el) => !el.hasAttribute('disabled'));

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = focusable();
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    // Wrap at both ends. Without this, Tab off the last control lands on the page behind.
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  document.addEventListener('keydown', onKey, true);

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    /*
     * Always, on every route out — not only on the Escape that installed it. The settings
     * drawer had its own version of this that only unhooked itself when Escape was the thing
     * that closed it, so closing with the X or a click on the scrim left the listener behind.
     * Every open-and-close after that added another.
     */
    document.removeEventListener('keydown', onKey, true);
    onClose?.();
    scrim.classList.remove('open');
    setTimeout(() => scrim.remove(), 200);
    /*
     * Only if there is still something to go back to. The usual ending is a navigation, and
     * the next most common is an opener that has been hidden rather than removed — a menu item
     * whose menu closed behind the dialog. `isConnected` says yes to both, and focusing a
     * hidden element silently does nothing, which leaves the keyboard stranded on the body.
     */
    if (opener?.isConnected && opener.getClientRects().length > 0) opener.focus();
  }
  return close;
}

export function confirmLeave(
  title: string,
  message: string,
  onConfirm: () => void
): void {
  const scrim = document.createElement('div');
  scrim.className = 'dialog-scrim';
  scrim.innerHTML = `
    <div class="dialog">
      <div class="dialog-icon">${icon('leave', { size: 30 })}</div>
      <h2>${title}</h2>
      <p>${message}</p>
      <div class="dialog-actions">
        <button class="secondary" data-act="cancel">Stay</button>
        <button class="danger-btn" data-act="confirm">Leave</button>
      </div>
    </div>`;
  document.body.appendChild(scrim);
  requestAnimationFrame(() => scrim.classList.add('open'));

  const close = asDialog(scrim, title);
  // Staying is the safe answer, so it is the one already under the finger.
  scrim.querySelector<HTMLElement>('[data-act="cancel"]')!.focus();

  scrim.querySelector('[data-act="cancel"]')!.addEventListener('click', close);
  scrim.querySelector('[data-act="confirm"]')!.addEventListener('click', () => {
    close();
    onConfirm();
  });
  scrim.addEventListener('click', (e) => {
    if (e.target === scrim) close();
  });
}

/**
 * Asks for a line of text, in the game's own chrome.
 *
 * Replaces `window.prompt`, which is a grey OS box in the middle of a cartoon pool hall — and
 * worse, one that browsers are entitled to suppress outright, so the button that opened it
 * could look like it did nothing at all.
 *
 * @param onSubmit called with the trimmed value; never called if the dialog is cancelled.
 */
export function promptText(
  title: string,
  value: string,
  onSubmit: (value: string) => void,
  opts: { placeholder?: string; maxLength?: number; confirmLabel?: string } = {}
): void {
  const { placeholder = '', maxLength = 24, confirmLabel = 'Save' } = opts;
  const scrim = document.createElement('div');
  scrim.className = 'dialog-scrim';
  scrim.innerHTML = `
    <div class="dialog">
      <div class="dialog-icon">${icon('edit', { size: 28 })}</div>
      <h2>${title}</h2>
      <input class="dialog-input" type="text" maxlength="${maxLength}"
             placeholder="${placeholder}" spellcheck="false" />
      <div class="dialog-actions">
        <button class="secondary" data-act="cancel">Cancel</button>
        <button data-act="confirm">${confirmLabel}</button>
      </div>
    </div>`;
  document.body.appendChild(scrim);
  requestAnimationFrame(() => scrim.classList.add('open'));

  const close = asDialog(scrim, title);

  const input = scrim.querySelector<HTMLInputElement>('.dialog-input')!;
  input.value = value;
  input.focus();
  input.select();

  const submit = (): void => {
    const next = input.value.trim();
    close();
    if (next) onSubmit(next);
  };

  scrim.querySelector('[data-act="cancel"]')!.addEventListener('click', close);
  scrim.querySelector('[data-act="confirm"]')!.addEventListener('click', submit);
  // Escape is handled by `asDialog` now, for the whole dialog rather than only while the input
  // has focus — it used to stop working the moment you tabbed to a button.
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  });
  scrim.addEventListener('click', (e) => {
    if (e.target === scrim) close();
  });
}

export type ToastKind = 'info' | 'foul' | 'reward';

const TOAST_ICONS: Record<ToastKind, IconName> = {
  info: 'target',
  foul: 'close',
  reward: 'star',
};

/**
 * Pushes a toast onto the top-centre stack. `stack` is the container the page owns, so
 * toasts are cleaned up with the page rather than leaking onto the next screen.
 */
export function showToast(
  stack: HTMLElement,
  message: string,
  kind: ToastKind = 'info',
  ms = 2600
): void {
  /*
   * Toasts carry the only account of what just happened — a foul, whose turn it is, a reward.
   * None of it was reaching a screen reader, so the entire running commentary of the game was
   * silent. Set on the stack rather than on each toast, because a live region has to be in the
   * document *before* the thing it announces is put into it.
   *
   * A foul interrupts; everything else waits its turn. That distinction is the whole reason
   * `assertive` exists, and getting it backwards is how a page starts talking over itself.
   */
  if (!stack.hasAttribute('role')) {
    stack.setAttribute('role', 'status');
    stack.setAttribute('aria-live', 'polite');
  }
  if (kind === 'foul') stack.setAttribute('aria-live', 'assertive');

  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.innerHTML = `${icon(TOAST_ICONS[kind], { size: 18 })}<span>${message}</span>`;
  stack.appendChild(el);

  // Back to polite once this one has been read, so an ordinary note does not interrupt.
  if (kind === 'foul') {
    setTimeout(() => stack.setAttribute('aria-live', 'polite'), 100);
  }

  // Keep the stack short — a run of fouls shouldn't paper over the table.
  while (stack.children.length > 3) stack.firstElementChild?.remove();

  setTimeout(() => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 250);
  }, ms);
}
