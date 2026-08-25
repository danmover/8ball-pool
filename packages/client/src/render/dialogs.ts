import { icon, type IconName } from './icons';

/**
 * Shared chrome: the confirm dialog behind destructive actions, and the toast stack.
 *
 * Toasts used to render at the bottom of the screen, which on a table view is the one place
 * nobody is looking — everyone's watching the balls. They now stack under the scoreboard at
 * the top, framed like the rest of the UI.
 */

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

  const close = (): void => {
    scrim.classList.remove('open');
    setTimeout(() => scrim.remove(), 200);
  };

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

  const input = scrim.querySelector<HTMLInputElement>('.dialog-input')!;
  input.value = value;
  input.focus();
  input.select();

  const close = (): void => {
    scrim.classList.remove('open');
    setTimeout(() => scrim.remove(), 200);
  };
  const submit = (): void => {
    const next = input.value.trim();
    close();
    if (next) onSubmit(next);
  };

  scrim.querySelector('[data-act="cancel"]')!.addEventListener('click', close);
  scrim.querySelector('[data-act="confirm"]')!.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
    if (e.key === 'Escape') close();
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
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.innerHTML = `${icon(TOAST_ICONS[kind], { size: 18 })}<span>${message}</span>`;
  stack.appendChild(el);

  // Keep the stack short — a run of fouls shouldn't paper over the table.
  while (stack.children.length > 3) stack.firstElementChild?.remove();

  setTimeout(() => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 250);
  }, ms);
}
