import { icon, type IconName } from './icons';
import { mountNotices, type NoticeKind } from './notices';

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

export interface ConfirmOptions {
  title: string;
  message: string;
  /** Label on the button that does the thing. */
  confirmLabel: string;
  /** Label on the button that doesn't. */
  cancelLabel: string;
  iconName?: IconName;
  onConfirm: () => void;
}

/**
 * "Are you sure?", in the game's own chrome.
 *
 * This was `confirmLeave` and nothing else — the labels "Stay" and "Leave" and a door icon were
 * baked into the markup, so the second thing that needed confirming had a choice between lying
 * about what its buttons did and growing a second copy of the dialog. The leave case is now a
 * three-line wrapper over this, which is all it ever was.
 */
export function confirmDialog(opts: ConfirmOptions): void {
  const { title, message, confirmLabel, cancelLabel, iconName = 'leave', onConfirm } = opts;
  const scrim = document.createElement('div');
  scrim.className = 'dialog-scrim';
  scrim.innerHTML = `
    <div class="dialog">
      <div class="dialog-icon">${icon(iconName, { size: 30 })}</div>
      <h2>${title}</h2>
      <p>${message}</p>
      <div class="dialog-actions">
        <button class="secondary" data-act="cancel">${cancelLabel}</button>
        <button class="danger-btn" data-act="confirm">${confirmLabel}</button>
      </div>
    </div>`;
  document.body.appendChild(scrim);
  requestAnimationFrame(() => scrim.classList.add('open'));

  const close = asDialog(scrim, title);
  // Backing out is the safe answer, so it is the one already under the finger.
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

export function confirmLeave(title: string, message: string, onConfirm: () => void): void {
  confirmDialog({ title, message, confirmLabel: 'Leave', cancelLabel: 'Stay', onConfirm });
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

export type ToastKind = NoticeKind;

/**
 * The old name for "say something", kept because six screens speak it.
 *
 * It used to build its own toast element here. It now hands the message to the page's notice
 * centre — the one system that owns everything the game announces — so the five menu screens
 * that still call `showToast` get the same shape, timing and live region as the table without
 * each having to be rewritten. `stack` is the element the page owns, which is what keeps the
 * rail scoped to the page rather than leaking onto the next one.
 */
export function showToast(
  stack: HTMLElement,
  message: string,
  kind: ToastKind = 'info',
  ms = 2600
): void {
  mountNotices(stack).show(message, { kind, ms });
}
