import type { GameState, Seat } from '@8ball/shared';
import { STAKES, oddsFor, newRound, type BettingRound } from '@8ball/shared';
import { icon } from '../render/icons';

/**
 * What a phone shows when the table is full.
 *
 * Until now a spectator got an error message and a dead end, which is a strange thing to do to
 * someone who has just walked over and scanned the code. They are already in the room on the
 * server — queued for the next free seat, receiving every broadcast — so the only thing missing
 * was somewhere to look.
 *
 * Betting is the reason to look. It gives the people waiting a stake in a frame they are not
 * playing, which is exactly the problem a party game has when there are more people than seats.
 */

export interface SpectatorCallbacks {
  onBet: (on: Seat, amount: number) => void;
  onLeave: () => void;
}

export interface SpectatorView {
  update(state: GameState): void;
  setBook(book: BettingRound): void;
  /** A seat freed up and this phone is first in line. */
  offerSeat(seat: Seat): void;
  settled(payload: { staked: number; returned: number; winner: Seat | null }): void;
  destroy(): void;
}

export function createSpectatorView(
  root: HTMLElement,
  cb: SpectatorCallbacks,
  queuePosition: string
): SpectatorView {
  let book: BettingRound = newRound();
  let state: GameState | null = null;
  let myBet: { on: Seat; amount: number } | null = null;
  let chosenSeat: Seat | null = null;

  root.innerHTML = `
    <div class="spectator-root">
      <header class="spec-head">
        <span class="spec-badge">${icon('phone', { size: 14 })} Watching</span>
        <span class="spec-queue" id="specQueue">${queuePosition}</span>
      </header>
      <div class="spec-score" id="specScore"></div>
      <div class="spec-book" id="specBook"></div>
      <div class="toast-stack" id="specToasts" role="status" aria-live="polite"></div>
      <div class="ctrl-buttons">
        <button class="icon-btn danger" id="specLeave" title="Leave">${icon('leave')}</button>
      </div>
    </div>`;

  const scoreEl = root.querySelector<HTMLElement>('#specScore')!;
  const bookEl = root.querySelector<HTMLElement>('#specBook')!;
  const toasts = root.querySelector<HTMLElement>('#specToasts')!;
  root.querySelector('#specLeave')!.addEventListener('click', () => cb.onLeave());

  function toast(message: string, kind = 'info'): void {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = message;
    toasts.appendChild(el);
    setTimeout(() => el.remove(), 3400);
  }

  function drawScore(): void {
    if (!state) return;
    const live = state.seatOrder.filter((s) => !state!.players[s].eliminated);
    scoreEl.innerHTML = live
      .map((seat) => {
        const p = state!.players[seat];
        const shooting = state!.currentShooter === seat;
        return `<div class="spec-player${shooting ? ' shooting' : ''}">
            <b>${p.name}</b>
            <span>${state!.series ? (state!.series.wins[seat] ?? 0) : p.score}</span>
          </div>`;
      })
      .join('');
  }

  function drawBook(): void {
    if (!state) {
      bookEl.innerHTML = '';
      return;
    }
    const live = state.seatOrder.filter((s) => !state!.players[s].eliminated);

    if (!book.open) {
      // Closed, but still worth showing — watching the odds you took hold up is half of it.
      bookEl.innerHTML = `
        <div class="book-closed">
          <span class="book-title">Betting closed</span>
          ${
            myBet
              ? `<span class="book-mine">You backed <b>${
                  state.players[myBet.on]?.name ?? myBet.on
                }</b> for ${myBet.amount}</span>`
              : '<span class="muted">No bet this frame</span>'
          }
        </div>`;
      return;
    }

    bookEl.innerHTML = `
      <div class="book-title">Back a player</div>
      <div class="book-seats">
        ${live
          .map((seat) => {
            const odds = oddsFor(book, seat);
            const picked = chosenSeat === seat;
            return `<button class="book-seat${picked ? ' picked' : ''}" data-seat="${seat}">
                <b>${state!.players[seat].name}</b>
                <span class="book-odds">${odds > 0 ? `${odds.toFixed(2)}×` : 'no bets'}</span>
              </button>`;
          })
          .join('')}
      </div>
      <div class="book-stakes">
        ${STAKES.map(
          (amount) =>
            `<button class="book-stake" data-stake="${amount}" ${chosenSeat ? '' : 'disabled'}>
               ${amount}
             </button>`
        ).join('')}
      </div>
      ${
        myBet
          ? `<div class="book-mine">Backing <b>${
              state.players[myBet.on]?.name ?? myBet.on
            }</b> for ${myBet.amount} — tap again to change</div>`
          : '<div class="muted book-hint">Pick a player, then a stake. One bet each, until the first shot.</div>'
      }`;

    bookEl.querySelectorAll<HTMLButtonElement>('[data-seat]').forEach((btn) => {
      btn.addEventListener('click', () => {
        chosenSeat = btn.dataset.seat as Seat;
        drawBook();
      });
    });
    bookEl.querySelectorAll<HTMLButtonElement>('[data-stake]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!chosenSeat) return;
        const amount = Number(btn.dataset.stake);
        myBet = { on: chosenSeat, amount };
        cb.onBet(chosenSeat, amount);
        drawBook();
      });
    });
  }

  return {
    update(next) {
      state = next;
      drawScore();
      drawBook();
    },
    setBook(next) {
      book = next;
      drawBook();
    },
    offerSeat(seat) {
      toast(`Seat ${seat.toUpperCase()} is free — rejoin to play`, 'reward');
      root.querySelector<HTMLElement>('#specQueue')!.textContent = 'A seat is free';
    },
    settled({ staked, returned, winner }) {
      myBet = null;
      chosenSeat = null;
      if (staked === 0) return;
      if (returned > staked) toast(`Your ${staked} came back as ${returned}`, 'reward');
      else if (returned === staked) toast(`Bet returned — ${staked} chalk`, 'info');
      else toast(`Lost ${staked} chalk`, 'foul');
      void winner;
      drawBook();
    },
    destroy() {
      root.innerHTML = '';
    },
  };
}
