import type { GameMode, GameState, PlayerInfo, Seat, SimEvent, Team } from './types.js';
import { seatId } from './types.js';
import { CUE_BALL_ID, EIGHT_BALL_ID } from './constants.js';
import { modeDescriptor } from './modes/index.js';
import { endGame } from './modes/shared.js';
import { DEFAULT_RULE_SET, FOUL_LIMIT, ruleOptions, type RuleSetId } from './ruleSets.js';
import { isGroupCleared, lowestBallId, nextActiveSeat } from './modes/index.js';
import type { ShotContext, ShotOutcome } from './modes/types.js';

/**
 * The rules front door. Every mode's actual logic lives in `modes/`; this module keeps the
 * long-standing public API (`createInitialGameState`, `legalTargetBallIds`, `resolveShot`,
 * `summarizeShot`) so the server and both client views never have to know which mode is in
 * play.
 */

export type { ShotContext, ShotOutcome };
export { isGroupCleared, lowestBallId };

/** Next seat in turn order, wrapping around. Skips players who are out of the frame. */
function nextSeat(state: GameState, seat: Seat): Seat {
  return nextActiveSeat(state, seat);
}

/** In teams mode seats alternate teams around the table, exactly like real doubles. */
function teamForIndex(index: number): Team {
  return index % 2 === 0 ? 'a' : 'b';
}

export function createInitialGameState(
  mode: GameMode,
  names: string[],
  startingIndex = 0,
  ruleSet: RuleSetId = DEFAULT_RULE_SET
): GameState {
  const descriptor = modeDescriptor(mode);
  const count = Math.max(descriptor.minPlayers, names.length);
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
      loadout: {},
      lives: null,
      ownedBalls: [],
      eliminated: false,
      isBot: false,
      botDifficulty: null,
      spotsLeft: 0,
    };
  });

  const state: GameState = {
    mode,
    balls: descriptor.rack(count),
    seatOrder,
    players,
    currentShooter: seatOrder[startingIndex % seatOrder.length],
    phase: 'break',
    winner: null,
    winningTeam: null,
    lastFoulReason: null,
    lastShooter: null,
    consecutiveFouls: {},
    ruleSet,
    ballInHandBehindLine: false,
    turnNumber: 0,
    shotClock: null,
    series: null,
    tournament: null,
    king: null,
    pickups: null,
    modifiers: null,
    speedRun: null,
    challenge: null,
  };

  // Groups, lives and owned balls are the mode's business, not this function's.
  descriptor.assignSeats(state);
  return state;
}

export function summarizeShot(events: SimEvent[]): ShotOutcome {
  let firstBallContacted: number | null = null;
  let anyCushionAfterContact = false;
  let cushionsBeforeContact = 0;
  const potted: number[] = [];
  const pottedIn: Record<number, number> = {};
  let cueBallPocketed = false;
  let eightBallPocketed = false;
  // Distinct balls, not rail hits: one ball rattling round a corner would otherwise satisfy
  // the break requirement on its own.
  const railed = new Set<number>();

  for (const ev of events) {
    if (ev.type === 'ballCollision') {
      if (firstBallContacted === null) {
        if (ev.a === CUE_BALL_ID) firstBallContacted = ev.b;
        else if (ev.b === CUE_BALL_ID) firstBallContacted = ev.a;
      }
    } else if (ev.type === 'cushion') {
      if (firstBallContacted !== null) {
        anyCushionAfterContact = true;
        if (ev.ballId !== CUE_BALL_ID) railed.add(ev.ballId);
      } else if (ev.ballId === CUE_BALL_ID) {
        cushionsBeforeContact++;
      }
    } else if (ev.type === 'pot') {
      potted.push(ev.ballId);
      pottedIn[ev.ballId] = ev.pocketIndex;
      if (ev.ballId === CUE_BALL_ID) cueBallPocketed = true;
      if (ev.ballId === EIGHT_BALL_ID) eightBallPocketed = true;
    }
  }

  return {
    potted,
    pottedIn,
    cueBallPocketed,
    eightBallPocketed,
    firstBallContacted,
    anyCushionAfterContact,
    cushionsBeforeContact,
    objectBallsToRail: railed.size,
  };
}

/** Which balls are currently legal for the shooter to hit first — for UI highlighting only. */
export function legalTargetBallIds(state: GameState): number[] {
  if (state.phase !== 'aiming' && state.phase !== 'break') return [];
  return modeDescriptor(state.mode).legalTargetBallIds(state);
}

/**
 * Applies the active mode's rules to a settled shot, mutating and returning `state`.
 *
 * `preShotGroupCleared` must be captured by the caller *before* stepping the simulation,
 * since potting your last group ball and the 8-ball in the same shot is illegal even
 * though both are "pocketed" by the time we get here. `lowestBefore` is likewise the
 * lowest ball on the table before the shot, needed by the lowest-ball-first modes.
 */
export function resolveShot(
  state: GameState,
  outcome: ShotOutcome,
  preShotGroupCleared: boolean,
  lowestBefore: number | null = null,
  timedOut = false,
  call: { ballId: number; pocketIndex: number } | null = null,
  now: number = Date.now()
): GameState {
  const ctx: ShotContext = {
    groupCleared: preShotGroupCleared,
    lowestBefore,
    timedOut,
    rules: ruleOptions(state.ruleSet),
    call,
    now,
  };
  const shooter = state.currentShooter;
  modeDescriptor(state.mode).resolveShot(state, outcome, ctx);
  state.lastShooter = shooter;
  applyThreeFoulRule(state, ctx);
  return state;
}

/**
 * Three consecutive fouls loses the frame.
 *
 * Applied here rather than inside each mode: every mode already sets `lastFoulReason`, so the
 * counter can be driven off that in one place instead of being threaded through seven files.
 * The warning matters as much as the rule — being dumped out of a frame by a rule nobody
 * mentioned is the worst possible way to learn it — so the count rides along in state.
 */
function applyThreeFoulRule(state: GameState, ctx: ShotContext): void {
  if (!ctx.rules.threeFoul || state.phase === 'game_over') return;

  // `resolveShot` has already passed the turn on, so the seat that just fouled is whoever the
  // shot belonged to — tracked by the mode as the previous shooter.
  const fouled = state.lastFoulReason !== null;
  const seat = state.lastShooter ?? state.currentShooter;
  const next = fouled ? (state.consecutiveFouls[seat] ?? 0) + 1 : 0;
  state.consecutiveFouls[seat] = next;

  if (next >= FOUL_LIMIT) {
    const others = state.seatOrder.filter((s) => s !== seat && !state.players[s].eliminated);
    endGame(state, others[0] ?? null, `${FOUL_LIMIT} fouls in a row`);
  }
}
