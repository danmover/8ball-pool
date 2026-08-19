import type { GameMode, RoomStateDTO, Seat } from '@8ball/shared';
import { MAX_SEATS, seatId, seatIndex } from '@8ball/shared';

const MODES: { id: GameMode; name: string; desc: string }[] = [
  { id: 'classic', name: 'Classic 8-Ball', desc: '1 v 1. Solids vs stripes, pot the 8 last to win.' },
  {
    id: 'teams',
    name: 'Teams',
    desc: 'Even split into two teams. Seats alternate around the table; your team shares a group.',
  },
  {
    id: 'rotation',
    name: 'Rotation',
    desc: 'Free-for-all. Hit the lowest ball first; every ball you pot scores its number. Highest wins.',
  },
];

export interface LobbyCallbacks {
  onModeChange: (mode: GameMode) => void;
  onSizeChange: (size: number) => void;
  onClaimSeat: (seat: Seat) => void;
  onReleaseSeat: (seat: Seat) => void;
  onStart: () => void;
}

/** Renders the pre-game lobby into `container` for the host screen. */
export function renderLobby(
  container: HTMLElement,
  room: RoomStateDTO,
  qrDataUrl: string,
  joinUrl: string,
  cb: LobbyCallbacks
): void {
  const { lobby } = room;
  const seats: Seat[] = Array.from({ length: lobby.maxPlayers }, (_, i) => seatId(i));
  const filled = seats.filter((s) => room.players[s]).length;
  const canStart = filled >= 2;

  container.innerHTML = `
    <div class="lobby">
      <div class="lobby-card">
        <div style="display:flex; gap:1.25rem; align-items:center; flex-wrap:wrap; justify-content:center;">
          <div style="text-align:center">
            <div class="lobby-code">${room.code}</div>
            <div style="font-size:0.78rem; color:var(--muted)">Join at <b>${joinUrl}</b></div>
          </div>
          <img src="${qrDataUrl}" width="132" height="132" alt="QR code to join" style="border-radius:10px; background:#fff; padding:6px" />
        </div>
      </div>

      <div class="lobby-card">
        <h2 style="margin:0 0 0.25rem; font-size:0.78rem; letter-spacing:0.1em; color:var(--muted)">GAME MODE</h2>
        <div class="mode-grid">
          ${MODES.map(
            (m) => `
            <button class="mode-card${lobby.mode === m.id ? ' active' : ''}" data-mode="${m.id}">
              <div class="mode-name">${m.name}</div>
              <div class="mode-desc">${m.desc}</div>
            </button>`
          ).join('')}
        </div>
      </div>

      <div class="lobby-card">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:1rem; flex-wrap:wrap">
          <h2 style="margin:0; font-size:0.78rem; letter-spacing:0.1em; color:var(--muted)">
            PLAYERS &nbsp;<span style="color:var(--paper)">${filled}/${lobby.maxPlayers}</span>
          </h2>
          <div class="stepper">
            <button class="secondary" id="sizeDown" ${lobby.maxPlayers <= 2 ? 'disabled' : ''}>−</button>
            <span class="value">${lobby.maxPlayers}</span>
            <button class="secondary" id="sizeUp" ${lobby.maxPlayers >= MAX_SEATS ? 'disabled' : ''}>+</button>
          </div>
        </div>
        <div class="seat-grid">
          ${seats
            .map((seat) => {
              const p = room.players[seat];
              const teamClass = lobby.mode === 'teams' ? (seatIndex(seat) % 2 === 0 ? 'a' : 'b') : null;
              const teamBadge = teamClass
                ? `<span class="seat-team team-${teamClass}">TEAM ${teamClass.toUpperCase()}</span>`
                : '';
              if (p) {
                return `<div class="seat-card">
                  <span>${p.isHost ? '🖥️' : '📱'}</span>
                  <span style="font-weight:700; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${p.name}</span>
                  ${teamBadge}
                </div>`;
              }
              return `<div class="seat-card empty">
                <button class="secondary" data-claim="${seat}" style="padding:0.3em 0.7em; font-size:0.76rem">
                  Play here
                </button>
                <span style="color:var(--muted); font-size:0.76rem">or scan QR</span>
                ${teamBadge}
              </div>`;
            })
            .join('')}
        </div>
      </div>

      <button id="startGame" ${canStart ? '' : 'disabled'} style="min-width:220px">
        ${canStart ? 'Start Game' : 'Need 2+ players'}
      </button>
    </div>
  `;

  container.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((btn) => {
    btn.addEventListener('click', () => cb.onModeChange(btn.dataset.mode as GameMode));
  });
  container.querySelectorAll<HTMLButtonElement>('[data-claim]').forEach((btn) => {
    btn.addEventListener('click', () => cb.onClaimSeat(btn.dataset.claim!));
  });
  container.querySelector('#sizeUp')?.addEventListener('click', () => cb.onSizeChange(lobby.maxPlayers + 1));
  container.querySelector('#sizeDown')?.addEventListener('click', () => cb.onSizeChange(lobby.maxPlayers - 1));
  container.querySelector('#startGame')?.addEventListener('click', () => cb.onStart());
}
