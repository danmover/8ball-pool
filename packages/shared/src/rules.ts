import type { GameState, PlayerInfo, Seat, SimEvent } from './types.js';
import { CUE_BALL_ID, EIGHT_BALL_ID } from './constants.js';
import { rackBalls } from './rack.js';

export function otherSeat(seat: Seat): Seat {
  return seat === 'p1' ? 'p2' : 'p1';
}

export function createInitialGameState(p1Name: string, p2Name: string): GameState {
  const players: Record<Seat, PlayerInfo> = {
    p1: { seat: 'p1', name: p1Name, connected: false, isHost: false, group: null },
    p2: { seat: 'p2', name: p2Name, connected: false, isHost: false, group: null },
  };
  return {
    balls: rackBalls(),
    players,
    currentShooter: 'p1',
    phase: 'break',
    winner: null,
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

export function isGroupCleared(state: GameState, seat: Seat): boolean {
  const group = state.players[seat].group;
  if (!group) return false;
  return state.balls.filter((b) => b.kind === group).every((b) => b.pocketed);
}

/**
 * Applies 8-ball rules to a settled shot, mutating and returning `state`.
 * `preShotGroupCleared` must be captured by the caller *before* stepping the
 * simulation, since potting your last group ball and the 8-ball in the same
 * shot is illegal even though both are "pocketed" by the time we get here.
 */
export function resolveShot(
  state: GameState,
  outcome: ShotOutcome,
  preShotGroupCleared: boolean
): GameState {
  const shooter = state.currentShooter;
  const opponent = otherSeat(shooter);
  const shooterInfo = state.players[shooter];
  const wasBreak = state.phase === 'break';

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
    if (legalEightPot) {
      state.winner = shooter;
    } else {
      state.winner = opponent;
    }
    state.phase = 'game_over';
    state.lastFoulReason = foulReason;
    return state;
  }

  if (wasBreak) {
    // Table stays open after the break regardless of what was potted.
    if (foul) {
      state.currentShooter = opponent;
      state.phase = 'ball_in_hand';
    } else if (outcome.potted.length > 0) {
      state.phase = 'aiming'; // shooter continues, table still open
    } else {
      state.currentShooter = opponent;
      state.phase = 'aiming';
    }
    state.lastFoulReason = foulReason;
    state.turnNumber++;
    return state;
  }

  if (foul) {
    state.currentShooter = opponent;
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
      const group = [...pottedKinds][0];
      state.players[shooter].group = group;
      state.players[opponent].group = group === 'solid' ? 'stripe' : 'solid';
    }
  }

  const pottedOwnBall = outcome.potted.some((id) => {
    const ball = state.balls.find((b) => b.id === id);
    return ball && shooterInfo.group && ball.kind === shooterInfo.group;
  });

  state.phase = 'aiming';
  state.lastFoulReason = null;
  if (!pottedOwnBall) {
    state.currentShooter = opponent;
  }
  state.turnNumber++;
  return state;
}
