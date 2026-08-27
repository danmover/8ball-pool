import { icon } from '../render/icons';
import { profileStore } from '../main';

/**
 * Moving a profile to another device.
 *
 * Two halves, because both directions are needed and neither is obviously "the" one: show a
 * code on the device that has the progress, type it into the device that doesn't. No account,
 * no password, no reset flow — the honest cost of which is stated on the dialog itself rather
 * than left for someone to discover after losing a phone.
 */
export function openTransferDialog(): void {
  const scrim = document.createElement('div');
  scrim.className = 'dialog-scrim';
  scrim.innerHTML = `
    <div class="dialog transfer-dialog">
      <div class="dialog-icon">${icon('phone', { size: 28 })}</div>
      <h2>Play on another device</h2>

      <div class="transfer-half">
        <h3>Carry this profile over</h3>
        <p>Get a code here, then enter it on the other device.</p>
        <button id="getCode">Get a code</button>
        <div class="transfer-code" id="codeOut" hidden></div>
      </div>

      <div class="transfer-rule"><span>or</span></div>

      <div class="transfer-half">
        <h3>Bring a profile here</h3>
        <p>Enter a code from your other device. This replaces the progress on <em>this</em> one.</p>
        <input class="dialog-input" id="codeIn" maxlength="6" placeholder="CODE"
               autocapitalize="characters" autocomplete="off" spellcheck="false" />
        <button class="secondary" id="claimCode">Bring it here</button>
      </div>

      <p class="transfer-warning">
        There's no password and no email — the code is the only way across. If you lose every
        device you've played on, the profile goes with them.
      </p>

      <div class="dialog-actions">
        <button class="secondary" data-act="close">Done</button>
      </div>
    </div>`;
  document.body.appendChild(scrim);
  requestAnimationFrame(() => scrim.classList.add('open'));

  const close = (): void => {
    scrim.classList.remove('open');
    setTimeout(() => scrim.remove(), 200);
  };

  const codeOut = scrim.querySelector<HTMLElement>('#codeOut')!;
  const codeIn = scrim.querySelector<HTMLInputElement>('#codeIn')!;

  scrim.querySelector('#getCode')!.addEventListener('click', async () => {
    codeOut.hidden = false;
    codeOut.textContent = '…';
    try {
      const { code, expiresAt } = await profileStore.createTransferCode();
      const minutes = Math.max(1, Math.round((expiresAt - Date.now()) / 60000));
      codeOut.innerHTML = `<b>${code}</b><small>expires in ${minutes} min · works once</small>`;
    } catch {
      codeOut.textContent = "Couldn't reach the server. Try again in a moment.";
    }
  });

  scrim.querySelector('#claimCode')!.addEventListener('click', async () => {
    const code = codeIn.value.trim().toUpperCase();
    if (!code) return;
    try {
      await profileStore.claimTransferCode(code);
      // A full reload is the simplest way to be certain every screen is showing the new
      // profile rather than a mix of the two.
      window.location.reload();
    } catch (err) {
      codeOut.hidden = false;
      codeOut.textContent = err instanceof Error ? err.message : 'That code did not work.';
    }
  });

  scrim.querySelector('[data-act="close"]')!.addEventListener('click', close);
  scrim.addEventListener('click', (e) => {
    if (e.target === scrim) close();
  });
}
