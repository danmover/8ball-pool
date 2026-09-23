import type { GameMode, GameState, PlayerInfo, Seat, ShotSummary, SimEvent } from './types.js';
import { emptyFrameStats, seatId } from './types.js';
import { CUE_BALL_ID, EIGHT_BALL_ID } from './constants.js';
import { modeDescriptor } from './modes/index.js';
import { endGame } from './modes/shared.js';
import { DEFAULT_RULE_SET, FOUL_LIMIT, ruleOptions, type RuleSetId } from './ruleSets.js';
import { isGroupCleared, lowestBallId } from './modes/index.js';
import type { CallRequirement, ShotContext, ShotOutcome } from './modes/types.js';
import type { PowerId } from './powers.js';

/**
 * The rules front door. Every mode's logic lives in `modes/`; this module builds frames, reads
 * shots out of simulation events, and wraps each mode's verdict with the bookkeeping every mode
 * shares — frame stats, the visit run, the shot summary and the three-foul rule.
 */

export type { ShotContext, ShotOutcome, CallRequirement };
export { isGroupCleared, lowestBallId };

export interface NewFrameOptions {
  /** Index into the seat order of whoever breaks. */
  breaker?: number;
  ruleSet?: RuleSetId;
  rand?: () => number;
  /**
   * Seat ids to use, in turn order. Defaults to p1..pN; a tournament match passes the two
   * seats actually playing so the frame's seats line up with the room's.
   */
  seatIds?: Seat[];
}

export function createInitialGameState(
  mode: GameMode,
  names: string[],
  opts: NewFrameOptions = {}
): GameState {
  const descriptor = modeDescriptor(mode);
  const rand = opts.rand ?? Math.random;
  const count = Math.max(descriptor.minPlayers, opts.seatIds?.length ?? names.length);
  const seatOrder: Seat[] = opts.seatIds ?? Array.from({ length: count }, (_, i) => seatId(i));
  const players: Record<Seat, PlayerInfo> = {};

  seatOrder.forEach((seat, i) => {
    players[seat] = {
      seat,
      name: names[i] ?? `Player ${i + 1}`,
      group: null,
      team: null,
      score: 0,
      lives: null,
      eliminated: false,
      isBot: false,
      frame: emptyFrameStats(),
    };
  });

  const state: GameState = {
    mode,
    ruleSet: opts.ruleSet ?? DEFAULT_RULE_SET,
    balls: descriptor.rack(count, rand),
    seatOrder,
    players,
    currentShooter: seatOrder[(opts.breaker ?? 0) % seatOrder.length],
    phase: descriptor.solo ? 'aiming' : 'break',
    winner: null,
    winningTeam: null,
    lastFoulReason: null,
    lastShooter: null,
    consecutiveFouls: {},
    ballInHandBehindLine: false,
    turnNumber: 0,
    visitRun: 0,
    clock: null,
    lastShot: null,
    power: null,
    timeAttack: null,
    trick: null,
  };

  descriptor.assignSeats(state, rand);
  return state;
}

/** Reads the facts the rules need out of a shot's raw simulation events. */
export function summarizeShot(events: SimEvent[]): ShotOutcome {
  let firstBallContacted: number | null = null;
  let anyCushionAfterContact = false;
  let cushionsBeforeContact = 0;
  const potted: number[] = [];
  const pottedIn: Record<number, number> = {};
  const collected: PowerId[] = [];
  let cueBallPocketed = false;
  let eightBallPocketed = false;
  let jumped = false;
  // Distinct balls, not rail hits: one ball rattling round a corner would otherwise satisfy the
  // break requirement on its own.
  const railed = new Set<number>();
  // Rails each object ball has touched this shot, to tell a bank from a straight pot.
  const rails = new Map<number, number>();
  const banked: number[] = [];

  for (const ev of events) {
    if (ev.type === 'ballCollision') {
      if (firstBallContacted === null) {
        if (ev.a === CUE_BALL_ID) firstBallContacted = ev.b;
        else if (ev.b === CUE_BALL_ID) firstBallContacted = ev.a;
      }
    } else if (ev.type === 'cushion') {
      if (ev.ballId !== CUE_BALL_ID) rails.set(ev.ballId, (rails.get(ev.ballId) ?? 0) + 1);
      if (firstBallContacted !== null) {
        anyCushionAfterContact = true;
        if (ev.ballId !== CUE_BALL_ID) railed.add(ev.ballId);
      } else if (ev.ballId === CUE_BALL_ID) {
        cushionsBeforeContact++;
      }
    } else if (ev.type === 'pot') {
      potted.push(ev.ballId);
      pottedIn[ev.ballId] = ev.pocketIndex;
      if (ev.ballId !== CUE_BALL_ID && (rails.get(ev.ballId) ?? 0) > 0) banked.push(ev.ballId);
      if (ev.ballId === CUE_BALL_ID) cueBallPocketed = true;
      if (ev.ballId === EIGHT_BALL_ID) eightBallPocketed = true;
    } else if (ev.type === 'orb') {
      collected.push(ev.power);
    } else if (ev.type === 'land' && ev.ballId === CUE_BALL_ID) {
      jumped = true;
    }
  }

  return {
    potted,
    pottedIn,
    banked,
    cueBallPocketed,
    eightBallPocketed,
    firstBallContacted,
    anyCushionAfterContact,
    cushionsBeforeContact,
    objectBallsToRail: railed.size,
    collected,
    jumped,
  };
}

/** Which balls are currently legal for the shooter to hit first — for UI highlighting only. */
export function legalTargetBallIds(state: GameState): number[] {
  if (state.phase !== 'aiming' && state.phase !== 'break' && state.phase !== 'ball_in_hand') return [];
  return modeDescriptor(state.mode).legalTargetBallIds(state);
}

/** What the shooter must nominate before the next shot. */
export function callRequirement(state: GameState): CallRequirement {
  return modeDescriptor(state.mode).callRequirement(state, ruleOptions(state.ruleSet));
}

export interface ResolveInput {
  /** Captured before the shot: was the shooter's group already cleared? */
  groupCleared: boolean;
  /** Captured before the shot: lowest ball on the table. */
  lowestBefore: number | null;
  timedOut?: boolean;
  call?: { ballId: number; pocketIndex: number } | null;
  armed?: PowerId | null;
  now?: number;
  rand?: () => number;
}

/**
 * Applies the active mode's rules to a settled shot, mutating and returning `state`.
 *
 * `groupCleared` and `lowestBefore` must be captured by the caller *before* stepping the
 * simulation — potting your last group ball and the 8 in the same shot is illegal even though
 * both read as "pocketed" by the time we get here.
 */
export function resolveShot(state: GameState, outcome: ShotOutcome, input: ResolveInput): GameState {
  const ctx: ShotContext = {
    groupCleared: input.groupCleared,
    lowestBefore: input.lowestBefore,
    timedOut: input.timedOut ?? false,
    rules: ruleOptions(state.ruleSet),
    call: input.call ?? null,
    armed: input.armed ?? null,
    now: input.now ?? Date.now(),
    rand: input.rand ?? Math.random,
  };
  const shooter = state.currentShooter;
  const player = state.players[shooter];
  const potted = outcome.potted.filter((id) => id !== CUE_BALL_ID);

  const result = modeDescriptor(state.mode).resolveShot(state, outcome, ctx);
  state.lastShooter = shooter;
  state.turnNumber++;
  state.lastFoulReason = result.foul ?? result.note ?? null;

  // Frame stats and the visit run. A visit is broken by a foul or by the table changing hands.
  const kept = state.currentShooter === shooter && state.phase !== 'game_over' && !result.foul;
  if (player && !ctx.timedOut) player.frame.shots++;
  if (player) {
    player.frame.pots += result.foul ? 0 : potted.length;
    if (result.foul) player.frame.fouls++;
    player.frame.bestShot = Math.max(player.frame.bestShot, result.foul ? 0 : potted.length);
  }
  const run = result.foul ? 0 : state.visitRun + potted.length;
  if (player) player.frame.bestRun = Math.max(player.frame.bestRun, run);
  state.visitRun = kept ? run : 0;

  const summary: ShotSummary = {
    seat: shooter,
    potted,
    foul: result.foul,
    kept,
    run,
    railsFirst: outcome.cushionsBeforeContact,
    jumped: outcome.jumped,
    power: ctx.armed,
    collected: outcome.collected,
    points: result.points ?? 0,
    lifeDelta: result.lifeDelta ?? 0,
    wonFrame: state.phase === 'game_over' && state.winner === shooter,
  };
  state.lastShot = summary;

  applyThreeFoulRule(state, ctx, result.foul !== null, shooter);
  return state;
}

/**
 * Three consecutive fouls loses the frame — when the rules say so. Applied here once rather
 * than inside each mode, and the count rides along in state so the table can warn you.
 */
function applyThreeFoulRule(state: GameState, ctx: ShotContext, fouled: boolean, seat: Seat): void {
  if (!ctx.rules.threeFoul || !modeDescriptor(state.mode).usesRuleSet) return;
  const next = fouled ? (state.consecutiveFouls[seat] ?? 0) + 1 : 0;
  state.consecutiveFouls[seat] = next;
  if (state.phase === 'game_over') return;
  if (next >= FOUL_LIMIT) {
    const mine = state.players[seat];
    const winner =
      state.seatOrder.find(
        (s) =>
          s !== seat &&
          !state.players[s].eliminated &&
          (!mine?.team || state.players[s].team !== mine.team)
      ) ?? null;
    endGame(state, winner, `${FOUL_LIMIT} fouls in a row`);
    if (state.lastShot) state.lastShot.wonFrame = false;
  }
}

/** The captured-before-the-shot facts `resolveShot` needs. */
export function preShotFacts(state: GameState): { groupCleared: boolean; lowestBefore: number | null } {
  return {
    groupCleared: isGroupCleared(state, state.currentShooter),
    lowestBefore: lowestBallId(state),
  };
}
