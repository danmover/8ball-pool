import {
  MODE_ORDER,
  RULE_SETS,
  modeDescriptor,
  ruleSetOrder,
  type GameMode,
  type RuleSetId,
  type TableSummary,
  type TableVisibility,
} from '@8ball/shared';
import { getSocket } from '../net/socket';
import { formatRating, identify, rankedIdentity, type RankedIdentity } from '../net/identity';
import { getProfile } from '../profile/profile';
import { icon } from '../render/icons';
import { showToast } from '../render/dialogs';
import { navigate } from '../router';

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
          <form class="join-box" id="codeForm">
            <input id="codeInput" maxlength="4" placeholder="CODE" autocapitalize="characters"
                   autocomplete="off" aria-label="Table code" />
            <button type="submit" class="secondary">Join by code</button>
          </form>
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

        <div class="toast-stack" id="onlineToasts"></div>
      </div>`;

    wire();
    paintList();
  }

  function wire(): void {
    root.querySelector('#backBtn')!.addEventListener('click', () => navigate('/'));
    root.querySelector('#refreshBtn')!.addEventListener('click', refresh);

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
      // Ranked is only offered on a two-seat table, so the note has to be redrawn with it.
      if (newSeats !== 2) newRanked = false;
      draw();
    });
    root.querySelector<HTMLSelectElement>('#newVisibility')!.addEventListener('change', (e) => {
      newVisibility = (e.target as HTMLSelectElement).value as TableVisibility;
    });
    root.querySelector<HTMLInputElement>('#newRanked')?.addEventListener('change', (e) => {
      newRanked = (e.target as HTMLInputElement).checked;
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

  draw();
  // Tell the server who we are before anything ranked can happen. Harmless without a token —
  // you can still play, it just does not count.
  void identify().then((id) => {
    me = id;
    draw();
  });
  refresh();
  refreshTimer = setInterval(refresh, REFRESH_MS);

  // A stale list is worse than no list — it sends people at tables that filled up while they
  // were reading. Nothing here belongs to the profile, so there is nothing to save on the way out.
  void getProfile;

  return () => {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = null;
    root.innerHTML = '';
  };
}
