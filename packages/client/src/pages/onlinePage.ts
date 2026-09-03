import {
  MODE_ORDER,
  RULE_SETS,
  modeDescriptor,
  ruleSetOrder,
  type GameMode,
  type RuleSetId,
  type TableSummary,
  type TableVisibility,
  timeUntil,
} from '@8ball/shared';
import { getSocket } from '../net/socket';
import { formatRating, identify, rankedIdentity, type RankedIdentity } from '../net/identity';
import { getProfile } from '../profile/profile';
import { icon } from '../render/icons';
import { showToast } from '../render/dialogs';
import { goBack, navigate } from '../router';
import { mountResumeStrip } from './pageShell';

/**
 * The online front door.
 *
 * Two ways in, because they answer different questions. **Quick Play** is for "I want to play
 * pool now" and should be one tap. The **browser** is for "I want a 9-ball game on tournament
 * rules" or "I want to watch" — more taps, but you chose what you got.
 *
 * Solo formats are deliberately absent: playing the ghost against a stranger is not a thing.
 */

/** Modes that make sense with somebody else at the table. */
const ONLINE_MODES: GameMode[] = MODE_ORDER.filter(
  (m) => !['ghost', 'speed', 'sandbox', 'challenge'].includes(m)
);

/** How often the list refreshes itself while you are looking at it. */
const REFRESH_MS = 4000;

export function renderOnlinePage(root: HTMLElement): () => void {
  const socket = getSocket();
  let tables: TableSummary[] = [];
  let refreshTimer: ReturnType<typeof setInterval> | null = null;
  let eventTimer: ReturnType<typeof setInterval> | null = null;

  // Create-a-table form state.
  let newMode: GameMode = 'classic';
  let newRules: RuleSetId = 'casual';
  let newSeats = 2;
  let newVisibility: TableVisibility = 'public';
  let newRanked = false;
  let creating = false;
  let me: RankedIdentity | null = rankedIdentity();
  let board: { name: string; rating: number; frames: number; wins: number; losses: number }[] = [];
  let showBoard = false;
  /** Set while the ranked queue is running, so the button becomes a cancel. */
  let searching: { waitedMs: number; inQueue: number; band: number | null } | null = null;
  let newTournament = false;
  type EventRow = {
    id: string;
    name: string;
    blurb: string;
    entrants: number;
    phase: 'scheduled' | 'signup' | 'running';
    opensAt: number;
    startsAt: number;
    code: string | null;
  };
  let events: EventRow[] = [];

  function toast(msg: string, kind = 'info'): void {
    const stack = root.querySelector<HTMLElement>('#onlineToasts');
    if (stack) showToast(stack, msg, kind as Parameters<typeof showToast>[2]);
  }

  function refresh(): void {
    socket.emit('listTables', (list) => {
      tables = list;
      paintList();
    });
  }

  function refreshEvents(): void {
    socket.emit('listEvents', (list) => {
      events = list;
      draw();
    });
  }

  function tableRow(t: TableSummary): string {
    const full = t.seatsFilled >= t.seatsTotal;
    const label = t.inPlay ? 'Watch' : full ? 'Full' : 'Join';
    return `
      <div class="table-row${t.inPlay ? ' in-play' : ''}">
        <span class="table-mode">${modeDescriptor(t.mode).name}</span>
        <span class="table-rules">${RULE_SETS[t.ruleSet].name}${
          t.ranked ? ' · <b class="ranked-tag">RANKED</b>' : ''
        }${t.averageRating !== null ? ` · ~${t.averageRating}` : ''}</span>
        <span class="table-seats">${t.seatsFilled}/${t.seatsTotal}</span>
        <span class="table-state">${
          t.inPlay
            ? `in play${t.spectators > 0 ? ` · ${t.spectators} watching` : ''}`
            : 'waiting'
        }</span>
        <button class="mini${t.inPlay ? ' secondary' : ''}" data-join="${t.code}"
                ${full && !t.inPlay ? 'disabled' : ''}>${label}</button>
      </div>`;
  }

  function paintList(): void {
    const listEl = root.querySelector<HTMLElement>('#tableList');
    if (!listEl) return;
    listEl.innerHTML =
      tables.length === 0
        ? `<p class="muted empty-tables">
             No tables open right now. Quick Play will start one and wait for somebody.
           </p>`
        : tables.map(tableRow).join('');

    listEl.querySelectorAll<HTMLButtonElement>('[data-join]').forEach((btn) => {
      btn.addEventListener('click', () => navigate(`/t/${btn.dataset.join}`));
    });
  }

  function draw(): void {
    root.innerHTML = `
      <div class="page online-page">
        <header class="page-head">
          <button class="mini secondary" id="backBtn">${icon('home', { size: 14 })} Back</button>
          <h1>Play Online</h1>
          <span class="rank-badge" title="Your ranked standing">${formatRating(me)}</span>
        </header>

        <section class="quick-play">
          <button class="play-btn" id="quickPlayBtn">
            <span class="play-main">QUICK PLAY</span>
            <span class="play-sub">Straight into a game</span>
          </button>
          <button class="play-btn secondary-play${searching ? ' searching' : ''}" id="rankedBtn">
            <span class="play-main">${searching ? 'SEARCHING…' : 'RANKED MATCH'}</span>
            <span class="play-sub">${
              searching
                ? `${Math.round(searching.waitedMs / 1000)}s · ${
                    searching.band === null
                      ? 'anyone at all now'
                      : `within ${searching.band} rating`
                  }${searching.inQueue > 1 ? ` · ${searching.inQueue} waiting` : ''}`
                : 'Matched on rating — counts toward it'
            }</span>
          </button>
          <form class="join-box" id="codeForm">
            <input id="codeInput" maxlength="4" placeholder="CODE" autocapitalize="characters"
                   autocomplete="off" aria-label="Table code" />
            <button type="submit" class="secondary">Join by code</button>
          </form>
        </section>

        <section class="events">
          <h2>Scheduled tournaments</h2>
          ${
            events.length === 0
              ? '<p class="muted">Loading the calendar…</p>'
              : events
                  .map(
                    (e) => `
              <div class="event-row${e.phase === 'signup' ? ' open' : ''}">
                <div class="event-main">
                  <b>${e.name}</b>
                  <small>${e.blurb}</small>
                </div>
                <span class="event-when">
                  ${
                    e.phase === 'signup'
                      ? `Doors open · starts ${timeUntil(e.startsAt)}`
                      : e.phase === 'running'
                        ? 'Under way'
                        : `${e.entrants} players · ${timeUntil(e.opensAt)}`
                  }
                </span>
                ${
                  e.phase === 'signup' && e.code
                    ? `<button class="mini" data-event="${e.code}">Enter</button>`
                    : e.phase === 'running' && e.code
                      ? `<button class="mini secondary" data-event="${e.code}">Watch</button>`
                      : '<span class="muted event-soon">soon</span>'
                }
              </div>`
                  )
                  .join('')
          }
          <p class="muted event-note">All times UTC.</p>
        </section>

        <section class="table-browser">
          <div class="section-head">
            <h2>Open tables</h2>
            <button class="mini secondary" id="refreshBtn">Refresh</button>
          </div>
          <div class="table-list" id="tableList"></div>
        </section>

        <section class="create-table">
          <h2>Start a table</h2>
          <div class="create-row">
            <label>Game
              <select id="newMode">
                ${ONLINE_MODES.map(
                  (m) => `<option value="${m}"${m === newMode ? ' selected' : ''}>${
                    modeDescriptor(m).name
                  }</option>`
                ).join('')}
              </select>
            </label>
            <label>Rules
              <select id="newRules">
                ${ruleSetOrder()
                  .map(
                    (r) => `<option value="${r}"${r === newRules ? ' selected' : ''}>${
                      RULE_SETS[r].name
                    }</option>`
                  )
                  .join('')}
              </select>
            </label>
            <label>Seats
              <select id="newSeats">
                ${[2, 3, 4, 5, 6, 7, 8]
                  .map((n) => `<option value="${n}"${n === newSeats ? ' selected' : ''}>${n}</option>`)
                  .join('')}
              </select>
            </label>
            <label>Who can join
              <select id="newVisibility">
                <option value="public"${newVisibility === 'public' ? ' selected' : ''}>Anyone</option>
                <option value="private"${
                  newVisibility === 'private' ? ' selected' : ''
                }>Only with the code</option>
              </select>
            </label>
          </div>
          <label class="ranked-toggle${newSeats < 4 ? ' disabled' : ''}">
            <input type="checkbox" id="newTournament" ${newTournament ? 'checked' : ''}
                   ${newSeats < 4 ? 'disabled' : ''} />
            <span>
              <b>Knockout</b>
              <small>${
                newSeats < 4
                  ? 'Four or more entrants — a bracket needs somebody to knock out'
                  : `A ${newSeats}-player bracket rather than one frame`
              }</small>
            </span>
          </label>
          <label class="ranked-toggle${newSeats !== 2 || newMode === 'teams' ? ' disabled' : ''}">
            <input type="checkbox" id="newRanked" ${newRanked ? 'checked' : ''}
                   ${newSeats !== 2 || newMode === 'teams' ? 'disabled' : ''} />
            <span>
              <b>Ranked</b>
              <small>${
                newSeats !== 2 || newMode === 'teams'
                  ? 'Two-seat games only — a rating is one player against one other'
                  : 'Counts toward your rating'
              }</small>
            </span>
          </label>
          <button id="createBtn"${creating ? ' disabled' : ''}>Create table</button>
          <p class="muted create-note">
            Settings are fixed once the table exists — an online table has no host to change them.
          </p>
        </section>

        <section class="leaderboard">
          <div class="section-head">
            <h2>Ladder</h2>
            <button class="mini secondary" id="boardBtn">${showBoard ? 'Hide' : 'Show'}</button>
          </div>
          ${
            showBoard
              ? board.length === 0
                ? '<p class="muted">Nobody has finished their placement frames yet.</p>'
                : `<table class="board-table">
                     <thead><tr><th>#</th><th>Who</th><th>Rating</th><th>W–L</th></tr></thead>
                     <tbody>${board
                       .map(
                         (r, i) =>
                           `<tr><td>${i + 1}</td><td>${r.name}</td><td>${r.rating}</td><td>${
                             r.wins
                           }–${r.losses}</td></tr>`
                       )
                       .join('')}</tbody>
                   </table>`
              : ''
          }
        </section>

        <div class="toast-stack" id="onlineToasts" role="status" aria-live="polite"></div>
      </div>`;

    wire();
    paintList();
  }

  function wire(): void {
    root.querySelector('#backBtn')!.addEventListener('click', () => goBack());
    mountResumeStrip(root);
    root.querySelector('#refreshBtn')!.addEventListener('click', refresh);

    root.querySelector('#rankedBtn')!.addEventListener('click', () => {
      if (searching) {
        socket.emit('rankedCancel');
        searching = null;
        draw();
        return;
      }
      socket.emit('rankedQueue', {}, (res) => {
        if (!res.ok) {
          toast(res.error, 'foul');
          return;
        }
        searching = { waitedMs: 0, inQueue: 1, band: null };
        draw();
      });
    });

    root.querySelector('#quickPlayBtn')!.addEventListener('click', () => {
      socket.emit('quickPlay', {}, (res) => {
        if (!res.ok) {
          toast(res.error, 'foul');
          return;
        }
        navigate(`/t/${res.code}`);
      });
    });

    root.querySelector<HTMLFormElement>('#codeForm')!.addEventListener('submit', (e) => {
      e.preventDefault();
      const value = root.querySelector<HTMLInputElement>('#codeInput')!.value.trim().toUpperCase();
      if (value.length !== 4) {
        toast('A table code is four characters', 'foul');
        return;
      }
      navigate(`/t/${value}`);
    });

    root.querySelector<HTMLSelectElement>('#newMode')!.addEventListener('change', (e) => {
      newMode = (e.target as HTMLSelectElement).value as GameMode;
      // Eight-ball seats exactly two however many the picker offers; show the truth rather than
      // letting someone pick six and quietly get two.
      const desc = modeDescriptor(newMode);
      newSeats = Math.max(desc.minPlayers, Math.min(desc.maxPlayers, newSeats));
      draw();
    });
    root.querySelector<HTMLSelectElement>('#newRules')!.addEventListener('change', (e) => {
      newRules = (e.target as HTMLSelectElement).value as RuleSetId;
    });
    root.querySelector<HTMLSelectElement>('#newSeats')!.addEventListener('change', (e) => {
      newSeats = Number((e.target as HTMLSelectElement).value);
      // Ranked needs two seats and a knockout needs four, so both notes have to be redrawn.
      if (newSeats !== 2) newRanked = false;
      if (newSeats < 4) newTournament = false;
      draw();
    });
    root.querySelector<HTMLSelectElement>('#newVisibility')!.addEventListener('change', (e) => {
      newVisibility = (e.target as HTMLSelectElement).value as TableVisibility;
    });
    root.querySelector<HTMLInputElement>('#newRanked')?.addEventListener('change', (e) => {
      newRanked = (e.target as HTMLInputElement).checked;
    });
    root.querySelector<HTMLInputElement>('#newTournament')?.addEventListener('change', (e) => {
      newTournament = (e.target as HTMLInputElement).checked;
    });
    root.querySelectorAll<HTMLButtonElement>('[data-event]').forEach((btn) => {
      btn.addEventListener('click', () => navigate(`/t/${btn.dataset.event}`));
    });

    root.querySelector('#boardBtn')!.addEventListener('click', () => {
      showBoard = !showBoard;
      if (showBoard) {
        socket.emit('leaderboard', (rows) => {
          board = rows;
          draw();
        });
      } else {
        draw();
      }
    });

    root.querySelector('#createBtn')!.addEventListener('click', () => {
      if (creating) return;
      creating = true;
      socket.emit(
        'createTable',
        {
          mode: newMode,
          ruleSet: newRules,
          seats: newSeats,
          visibility: newVisibility,
          seriesTarget: 1,
          ranked: newRanked,
          tournament: newTournament,
        },
        (res) => {
          creating = false;
          if (!res.ok) {
            toast(res.error, 'foul');
            return;
          }
          navigate(`/t/${res.code}`);
        }
      );
    });
  }

  const onSearching = (payload: { waitedMs: number; inQueue: number; band: number | null }): void => {
    if (!searching) return;
    searching = payload;
    // Repaint only the button's subtitle, so redrawing the page does not fight the form above.
    const sub = root.querySelector<HTMLElement>('#rankedBtn .play-sub');
    if (sub) {
      sub.textContent = `${Math.round(payload.waitedMs / 1000)}s · ${
        payload.band === null ? 'anyone at all now' : `within ${payload.band} rating`
      }${payload.inQueue > 1 ? ` · ${payload.inQueue} waiting` : ''}`;
    }
  };
  const onFound = ({ code, opponent, opponentRating }: { code: string; opponent: string; opponentRating: number }): void => {
    searching = null;
    toast(`Matched with ${opponent} (${opponentRating})`, 'reward');
    navigate(`/t/${code}`);
  };
  socket.on('matchSearching', onSearching);
  socket.on('matchFound', onFound);

  draw();
  // Tell the server who we are before anything ranked can happen. Harmless without a token —
  // you can still play, it just does not count.
  void identify().then((id) => {
    me = id;
    draw();
  });
  refresh();
  refreshEvents();
  refreshTimer = setInterval(refresh, REFRESH_MS);
  // The calendar moves in minutes, not seconds, so it is checked far less often than the list.
  eventTimer = setInterval(refreshEvents, 30_000);

  // A stale list is worse than no list — it sends people at tables that filled up while they
  // were reading. Nothing here belongs to the profile, so there is nothing to save on the way out.
  void getProfile;

  return () => {
    if (refreshTimer) clearInterval(refreshTimer);
    if (eventTimer) clearInterval(eventTimer);
    refreshTimer = null;
    eventTimer = null;
    socket.off('matchSearching', onSearching);
    socket.off('matchFound', onFound);
    // Leaving the page should leave the queue — being matched into a table you have navigated
    // away from is how a ranked frame gets forfeited by somebody who did nothing wrong.
    if (searching) socket.emit('rankedCancel');
    root.innerHTML = '';
  };
}
