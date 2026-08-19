import type { GameMode, GameState, PlayerInfo, Seat, SimEvent, Team } from './types.js';
import { seatId } from './types.js';
import { CUE_BALL_ID, EIGHT_BALL_ID } from './constants.js';
import { rackBalls } from './rack.js';

/** Next seat in turn order, wrapping around. */
export function nextSeat(state: GameState, seat: Seat): Seat {
  const order = state.seatOrder;
  if (order.length === 0) return seat;
  const i = order.indexOf(seat);
  return order[(i + 1) % order.length];
}

/** In teams mode seats alternate teams around the table, exactly like real doubles. */
export function teamForIndex(index: number): Team {
  return index % 2 === 0 ? 'a' : 'b';
}

export function createInitialGameState(
  mode: GameMode,
  names: string[],
  startingIndex = 0
): GameState {
  const count = Math.max(2, names.length);
  const seatOrder: Seat[] = Array.from({ length: count }, (_, i) => seatId(i));
  const players: Record<Seat, PlayerInfo> = {};

  seatOrder.forEach((seat, i) => {
    players[seat] = {
      seat,
      name: names[i] ?? `Player ${i + 1}`,
      connected: false,
      isHost: false,
      group: null,
      team: mode === 'teams' ? teamForIndex(i) : null,
      score: 0,
    };
  });

  return {
    mode,
    balls: rackBalls(),
    seatOrder,
    players,
    currentShooter: seatOrder[startingIndex % seatOrder.length],
    phase: 'break',
    winner: null,
    winningTeam: null,
    lastFoulReason: null,
    turnNumber: 0,
  };
}

export interface ShotOutcome {
  potted: number[];
  cueBallPocketed: boolean;
  eightBallPocketed: boolean;
  firstBallContacted: number | null;
  anyCushionAfterContact: boolean;
}

export function summarizeShot(events: SimEvent[]): ShotOutcome {
  let firstBallContacted: number | null = null;
  let anyCushionAfterContact = false;
  const potted: number[] = [];
  let cueBallPocketed = false;
  let eightBallPocketed = false;

  for (const ev of events) {
    if (ev.type === 'ballCollision') {
      if (firstBallContacted === null) {
        if (ev.a === CUE_BALL_ID) firstBallContacted = ev.b;
        else if (ev.b === CUE_BALL_ID) firstBallContacted = ev.a;
      }
    } else if (ev.type === 'cushion') {
      if (firstBallContacted !== null) anyCushionAfterContact = true;
    } else if (ev.type === 'pot') {
      potted.push(ev.ballId);
      if (ev.ballId === CUE_BALL_ID) cueBallPocketed = true;
      if (ev.ballId === EIGHT_BALL_ID) eightBallPocketed = true;
    }
  }

  return { potted, cueBallPocketed, eightBallPocketed, firstBallContacted, anyCushionAfterContact };
}

/** Everyone who shares this seat's group — the seat alone in classic, the whole team in teams mode. */
function alliedSeats(state: GameState, seat: Seat): Seat[] {
  const team = state.players[seat]?.team;
  if (state.mode !== 'teams' || !team) return [seat];
  return state.seatOrder.filter((s) => state.players[s].team === team);
}

export function isGroupCleared(state: GameState, seat: Seat): boolean {
  const group = state.players[seat]?.group;
  if (!group) return false;
  return state.balls.filter((b) => b.kind === group).every((b) => b.pocketed);
}

/** Lowest-numbered object ball still on the table — the only legal first contact in rotation. */
export function lowestBallId(state: GameState): number | null {
  const remaining = state.balls.filter((b) => !b.pocketed && b.id !== CUE_BALL_ID).map((b) => b.id);
  return remaining.length ? Math.min(...remaining) : null;
}

/** Which balls are currently legal for the shooter to hit first — for UI highlighting only. */
export function legalTargetBallIds(state: GameState): number[] {
  if (state.phase !== 'aiming' && state.phase !== 'break') return [];

  if (state.mode === 'rotation') {
    const lowest = lowestBallId(state);
    return lowest === null ? [] : [lowest];
  }

  const shooter = state.players[state.currentShooter];
  if (!shooter) return [];
  const remaining = (kind: 'solid' | 'stripe'): number[] =>
    state.balls.filter((b) => b.kind === kind && !b.pocketed).map((b) => b.id);

  if (!shooter.group) return [...remaining('solid'), ...remaining('stripe')];
  if (isGroupCleared(state, state.currentShooter)) {
    const eight = state.balls.find((b) => b.kind === 'eight' && !b.pocketed);
    return eight ? [eight.id] : [];
  }
  return remaining(shooter.group);
}

function assignGroups(state: GameState, shooter: Seat, group: 'solid' | 'stripe'): void {
  const other = group === 'solid' ? 'stripe' : 'solid';
  const allies = new Set(alliedSeats(state, shooter));
  for (const seat of state.seatOrder) {
    state.players[seat].group = allies.has(seat) ? group : other;
  }
}

function endGame(state: GameState, winner: Seat | null, foulReason: string | null): void {
  state.phase = 'game_over';
  state.winner = winner;
  state.winningTeam = winner ? (state.players[winner]?.team ?? null) : null;
  state.lastFoulReason = foulReason;
}

/** Rotation mode: score potted balls, enforce lowest-ball-first, end when the table clears. */
function resolveRotationShot(state: GameState, outcome: ShotOutcome, lowestBefore: number | null): GameState {
  const shooter = state.currentShooter;
  let foul = false;
  let foulReason: string | null = null;

  if (outcome.cueBallPocketed) {
    foul = true;
    foulReason = 'Scratch: cue ball pocketed';
  } else if (outcome.firstBallContacted === null) {
    foul = true;
    foulReason = 'No ball contacted';
  } else if (lowestBefore !== null && outcome.firstBallContacted !== lowestBefore) {
    foul = true;
    foulReason = `Must hit the ${lowestBefore} ball first`;
  } else if (outcome.potted.length === 0 && !outcome.anyCushionAfterContact) {
    foul = true;
    foulReason = 'No rail after contact';
  }

  // Balls potted on a foul don't score, but they stay down.
  const scored = foul ? [] : outcome.potted.filter((id) => id !== CUE_BALL_ID);
  for (const id of scored) state.players[shooter].score += id;

  const tableCleared = state.balls.every((b) => b.id === CUE_BALL_ID || b.pocketed);
  if (tableCleared) {
    let best: Seat | null = null;
    for (const seat of state.seatOrder) {
      if (best === null || state.players[seat].score > state.players[best].score) best = seat;
    }
    endGame(state, best, foulReason);
    return state;
  }

  state.turnNumber++;
  if (foul) {
    state.currentShooter = nextSeat(state, shooter);
    state.phase = 'ball_in_hand';
    state.lastFoulReason = foulReason;
    return state;
  }

  state.phase = 'aiming';
  state.lastFoulReason = null;
  if (scored.length === 0) state.currentShooter = nextSeat(state, shooter);
  return state;
}

/**
 * Applies the active mode's rules to a settled shot, mutating and returning `state`.
 *
 * `preShotGroupCleared` must be captured by the caller *before* stepping the simulation,
 * since potting your last group ball and the 8-ball in the same shot is illegal even
 * though both are "pocketed" by the time we get here. `lowestBefore` is likewise the
 * lowest ball on the table before the shot, needed for rotation mode's legal-contact test.
 */
export function resolveShot(
  state: GameState,
  outcome: ShotOutcome,
  preShotGroupCleared: boolean,
  lowestBefore: number | null = null
): GameState {
  if (state.mode === 'rotation') return resolveRotationShot(state, outcome, lowestBefore);

  const shooter = state.currentShooter;
  const shooterInfo = state.players[shooter];
  const wasBreak = state.phase === 'break';
  const advance = (): Seat => nextSeat(state, shooter);

  let foul = false;
  let foulReason: string | null = null;

  if (outcome.cueBallPocketed) {
    foul = true;
    foulReason = 'Scratch: cue ball pocketed';
  } else if (outcome.firstBallContacted === null) {
    foul = true;
    foulReason = 'No ball contacted';
  } else if (shooterInfo.group) {
    const firstBall = state.balls.find((b) => b.id === outcome.firstBallContacted);
    const legalFirst =
      firstBall?.kind === shooterInfo.group || (firstBall?.kind === 'eight' && preShotGroupCleared);
    if (!legalFirst) {
      foul = true;
      foulReason = 'Wrong ball hit first';
    }
  }

  if (!foul && outcome.potted.length === 0 && !outcome.anyCushionAfterContact) {
    foul = true;
    foulReason = 'No rail after contact';
  }

  // --- 8-ball resolution takes priority over everything else ---
  if (outcome.eightBallPocketed) {
    const legalEightPot = !foul && preShotGroupCleared && shooterInfo.group !== null;
    endGame(state, legalEightPot ? shooter : advance(), foulReason);
    return state;
  }

  if (wasBreak) {
    // Table stays open after the break regardless of what was potted.
    if (foul) {
      state.currentShooter = advance();
      state.phase = 'ball_in_hand';
    } else if (outcome.potted.length > 0) {
      state.phase = 'aiming'; // shooter continues, table still open
    } else {
      state.currentShooter = advance();
      state.phase = 'aiming';
    }
    state.lastFoulReason = foulReason;
    state.turnNumber++;
    return state;
  }

  if (foul) {
    state.currentShooter = advance();
    state.phase = 'ball_in_hand';
    state.lastFoulReason = foulReason;
    state.turnNumber++;
    return state;
  }

  // Assign groups off the first non-break legal pot on an open table.
  if (!shooterInfo.group) {
    const pottedKinds = new Set(
      outcome.potted
        .map((id) => state.balls.find((b) => b.id === id)?.kind)
        .filter((k): k is 'solid' | 'stripe' => k === 'solid' || k === 'stripe')
    );
    if (pottedKinds.size === 1) {
      assignGroups(state, shooter, [...pottedKinds][0]);
    }
  }

  const group = state.players[shooter].group;
  const pottedOwnBall = outcome.potted.some((id) => {
    const ball = state.balls.find((b) => b.id === id);
    return ball && group && ball.kind === group;
  });

  state.phase = 'aiming';
  state.lastFoulReason = null;
  if (!pottedOwnBall) state.currentShooter = advance();
  state.turnNumber++;
  return state;
}
