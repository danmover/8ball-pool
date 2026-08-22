import { getSocket } from '../net/socket';
import { saveSession } from '../settings/settingsStore';
import { navigate } from '../router';

export function renderLanding(root: HTMLElement): void {
  root.innerHTML = `
    <div class="landing">
      <h1>🎱 8-Ball Pool</h1>
      <p class="tagline">Host on a big screen. Play from your phone.</p>
      <div class="card">
        <h2>Host a table</h2>
        <button id="hostBtn">Host a Table</button>
      </div>
      <div class="card">
        <h2>Your locker</h2>
        <button id="profileBtn" class="secondary">🎡 Cosmetics &amp; Prize Wheel</button>
      </div>
      <div class="card">
        <h2>Join a table</h2>
        <input id="codeInput" maxlength="4" placeholder="ROOM CODE" autocapitalize="characters" autocomplete="off" />
        <button id="joinBtn" class="secondary">Join</button>
        <p id="joinError" class="error"></p>
      </div>
    </div>
  `;

  const hostBtn = root.querySelector<HTMLButtonElement>('#hostBtn')!;
  const codeInput = root.querySelector<HTMLInputElement>('#codeInput')!;
  const joinBtn = root.querySelector<HTMLButtonElement>('#joinBtn')!;
  const joinError = root.querySelector<HTMLElement>('#joinError')!;

  root.querySelector('#profileBtn')!.addEventListener('click', () => navigate('/profile'));

  hostBtn.addEventListener('click', () => {
    hostBtn.disabled = true;
    const socket = getSocket();
    socket.emit('hostCreateRoom', { hostName: 'Host' }, (res) => {
      saveSession(res.code, 'host', { token: res.token });
      navigate(`/table/${res.code}`);
    });
  });

  joinBtn.addEventListener('click', () => {
    const code = codeInput.value.trim().toUpperCase();
    if (code.length < 4) {
      joinError.textContent = 'Enter the 4-character table code.';
      return;
    }
    navigate(`/play/${code}`);
  });

  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.toUpperCase();
  });
  codeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinBtn.click();
  });
}
