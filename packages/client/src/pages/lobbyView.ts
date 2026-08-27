import type { BotDifficulty, GameMode, RoomStateDTO, RuleSetId, Seat } from '@8ball/shared';
import {
  MAX_SEATS,
  RULE_SETS,
  allModes,
  modeDescriptor,
  resolveLoadout,
  ruleSetOrder,
  seatId,
  seatIndex,
} from '@8ball/shared';
import { avatarSvg } from '../render/avatar';
import { modeArtSvg } from '../render/modeArt';
import { icon } from '../render/icons';

const SHOT_CLOCK_STEPS: (number | null)[] = [null, 60, 45, 30, 20, 15, 10];

const BOT_LABELS: Record<BotDifficulty, string> = {
  rookie: 'Rookie',
  club: 'Club',
  shark: 'Shark',
  legend: 'Legend',
};

export interface LobbyCallbacks {
  onModeChange: (mode: GameMode) => void;
  onSizeChange: (size: number) => void;
  onClaimSeat: (seat: Seat) => void;
  onReleaseSeat: (seat: Seat) => void;
  onAddBot: (seat: Seat, difficulty: BotDifficulty) => void;
  onRemoveBot: (seat: Seat) => void;
  onShotClockChange: (seconds: number | null) => void;
  onSeriesChange: (target: number) => void;
  onRuleSetChange: (id: RuleSetId) => void;
  onStart: () => void;
}

/** Renders the pre-game lobby into `container` for the host screen. */
export function renderLobby(
  container: HTMLElement,
  room: RoomStateDTO,
  qrDataUrl: string,
  joinUrl: string,
  cb: LobbyCallbacks,
  defaultBotDifficulty: BotDifficulty = 'club'
): void {
  const { lobby } = room;
  const descriptor = modeDescriptor(lobby.mode);
  const seats: Seat[] = Array.from({ length: lobby.maxPlayers }, (_, i) => seatId(i));
  const filled = seats.filter((s) => room.players[s]).length;
  const canStart = filled >= descriptor.minPlayers;
  const clockIndex = Math.max(0, SHOT_CLOCK_STEPS.indexOf(lobby.shotClockSeconds));

  container.innerHTML = `
    <div class="lobby">
      <div class="lobby-card hero">
        <div class="code-hero">
          <div>
            <div class="code-label">Scan or enter this code</div>
            <div class="lobby-code">${room.code.split('').map((c) => `<span>${c}</span>`).join('')}</div>
            <div class="code-url">${joinUrl}</div>
          </div>
          <img class="code-qr" src="${qrDataUrl}" width="140" height="140" alt="QR code to join" />
        </div>
      </div>

      <div class="lobby-card">
        <h2 style="margin:0 0 0.25rem; font-size:0.78rem; letter-spacing:0.1em; color:var(--muted)">GAME MODE</h2>
        <div class="mode-grid">
          ${allModes()
            .map(
              (m) => `
            <button class="mode-card${lobby.mode === m.id ? ' active' : ''}" data-mode="${m.id}">
              <span class="mode-card-art">${modeArtSvg(m.id)}</span>
              <div class="mode-name">${m.name}</div>
              <div class="mode-desc">${m.blurb}</div>
            </button>`
            )
            .join('')}
        </div>
      </div>

      <div class="lobby-card">
        <h2 style="margin:0 0 0.25rem; font-size:0.78rem; letter-spacing:0.1em; color:var(--muted)">RULES</h2>
        <div class="rules-row">
          ${ruleSetOrder()
            .map((id) => {
              const set = RULE_SETS[id];
              return `
            <button class="rule-card${lobby.ruleSet === id ? ' active' : ''}" data-ruleset="${id}">
              <div class="rule-name">${set.name}</div>
              <div class="rule-blurb">${set.blurb}</div>
            </button>`;
            })
            .join('')}
        </div>
      </div>

      <div class="lobby-card">
        <div class="lobby-options">
          <div class="option-block">
            <h2>SHOT CLOCK</h2>
            <div class="stepper">
              <button class="secondary" id="clockDown" ${
                clockIndex <= 0 || !descriptor.supportsShotClock ? 'disabled' : ''
              }>−</button>
              <span class="value">${
                !descriptor.supportsShotClock
                  ? 'n/a'
                  : lobby.shotClockSeconds
                    ? `${lobby.shotClockSeconds}s`
                    : 'Off'
              }</span>
              <button class="secondary" id="clockUp" ${
                clockIndex >= SHOT_CLOCK_STEPS.length - 1 || !descriptor.supportsShotClock
                  ? 'disabled'
                  : ''
              }>+</button>
            </div>
          </div>
          <div class="option-block">
            <h2>MATCH LENGTH</h2>
            <div class="stepper">
              <button class="secondary" id="seriesDown" ${lobby.seriesTarget <= 1 ? 'disabled' : ''}>−</button>
              <span class="value">${
                lobby.seriesTarget === 1 ? 'Single frame' : `First to ${lobby.seriesTarget}`
              }</span>
              <button class="secondary" id="seriesUp" ${lobby.seriesTarget >= 9 ? 'disabled' : ''}>+</button>
            </div>
          </div>
          ${
            room.spectatorCount > 0
              ? `<div class="option-block"><h2>WATCHING</h2><div class="value">👀 ${room.spectatorCount}</div></div>`
              : ''
          }
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
              const number = seatIndex(seat) + 1;
              if (p) {
                // Show the equipped avatar here so a player's cosmetics read before the
                // game even starts.
                const avatar = avatarSvg(
                  seatIndex(seat),
                  p.name,
                  false,
                  resolveLoadout(p.loadout).avatar
                );
                const source = p.isBot
                  ? { name: 'bot' as const, title: 'Computer player' }
                  : p.isHost
                    ? { name: 'screen' as const, title: 'Playing from the host screen' }
                    : { name: 'phone' as const, title: 'Playing from a phone' };

                return `<div class="seat-slot filled${p.isBot ? ' bot' : ''}">
                  <span class="seat-no">${number}</span>
                  <span class="seat-avatar" style="background-image:${avatar}"></span>
                  <span class="seat-info">
                    <span class="seat-name">${p.name}</span>
                    <span class="seat-meta">
                      <span class="seat-source" title="${source.title}">${icon(source.name, { size: 14 })}</span>
                      ${p.isBot && p.botDifficulty ? `<span class="bot-tag">${BOT_LABELS[p.botDifficulty]}</span>` : '<span class="ready-tag">Ready</span>'}
                      ${teamBadge}
                    </span>
                  </span>
                  ${
                    p.isBot
                      ? `<button class="seat-x" data-removebot="${seat}" title="Remove bot">${icon('close', { size: 12 })}</button>`
                      : ''
                  }
                </div>`;
              }
              return `<div class="seat-slot empty">
                <span class="seat-no">${number}</span>
                <span class="seat-empty-art">${icon('ball', { size: 26 })}</span>
                <span class="seat-info">
                  <span class="seat-name muted">Open seat</span>
                  <span class="seat-actions">
                    <button class="mini" data-claim="${seat}">Play here</button>
                    <button class="mini secondary" data-addbot="${seat}">${icon('bot', { size: 14 })} Bot</button>
                  </span>
                </span>
                ${teamBadge}
              </div>`;
            })
            .join('')}
        </div>
      </div>

      <button id="startGame" ${canStart ? '' : 'disabled'} style="min-width:220px">
        ${canStart ? 'Start Game' : `Need ${descriptor.minPlayers}+ players`}
      </button>
    </div>
  `;

  container.querySelectorAll<HTMLButtonElement>('[data-ruleset]').forEach((btn) => {
    btn.addEventListener('click', () => cb.onRuleSetChange(btn.dataset.ruleset as RuleSetId));
  });

  container.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((btn) => {
    btn.addEventListener('click', () => cb.onModeChange(btn.dataset.mode as GameMode));
  });
  container.querySelectorAll<HTMLButtonElement>('[data-claim]').forEach((btn) => {
    btn.addEventListener('click', () => cb.onClaimSeat(btn.dataset.claim!));
  });
  container.querySelectorAll<HTMLButtonElement>('[data-addbot]').forEach((btn) => {
    btn.addEventListener('click', () => cb.onAddBot(btn.dataset.addbot!, defaultBotDifficulty));
  });
  container.querySelectorAll<HTMLButtonElement>('[data-removebot]').forEach((btn) => {
    btn.addEventListener('click', () => cb.onRemoveBot(btn.dataset.removebot!));
  });
  container.querySelector('#sizeUp')?.addEventListener('click', () => cb.onSizeChange(lobby.maxPlayers + 1));
  container.querySelector('#sizeDown')?.addEventListener('click', () => cb.onSizeChange(lobby.maxPlayers - 1));
  container
    .querySelector('#clockUp')
    ?.addEventListener('click', () => cb.onShotClockChange(SHOT_CLOCK_STEPS[clockIndex + 1] ?? null));
  container
    .querySelector('#clockDown')
    ?.addEventListener('click', () => cb.onShotClockChange(SHOT_CLOCK_STEPS[clockIndex - 1] ?? null));
  container
    .querySelector('#seriesUp')
    ?.addEventListener('click', () => cb.onSeriesChange(lobby.seriesTarget + 1));
  container
    .querySelector('#seriesDown')
    ?.addEventListener('click', () => cb.onSeriesChange(lobby.seriesTarget - 1));
  container.querySelector('#startGame')?.addEventListener('click', () => cb.onStart());
}
