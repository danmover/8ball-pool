import type { BallGroup, GameState, Seat } from '../types.js';
import { CUE_BALL_ID, EIGHT_BALL_ID } from '../constants.js';
import { BREAK_BALLS_TO_RAIL } from '../ruleSets.js';
import { rackBalls } from '../rack.js';
import { basicFoul, endGame, nextActiveSeat, respot } from './shared.js';
import type { ModeDescriptor, ModeResult, ShotContext, ShotOutcome } from './types.js';

/**
 * Eight-ball, 1v1 or 2v2.
 *
 * Doubles is the same game with the group shared across a team and seats alternating teams
 * around the table, exactly like real doubles — so it is a player count, not a separate mode.
 */

/** Everyone sharing this seat's group — the seat alone in singles, the whole team in doubles. */
function alliedSeats(state: GameState, seat: Seat): Seat[] {
  const team = state.players[seat]?.team;
  if (!team) return [seat];
  return state.seatOrder.filter((s) => state.players[s].team === team);
}

export function isGroupCleared(state: GameState, seat: Seat): boolean {
  const group = state.players[seat]?.group;
  if (!group) return false;
  return state.balls.filter((b) => b.kind === group).every((b) => b.pocketed);
}

function assignGroups(state: GameState, shooter: Seat, group: BallGroup): void {
  const other: BallGroup = group === 'solid' ? 'stripe' : 'solid';
  const allies = new Set(alliedSeats(state, shooter));
  for (const seat of state.seatOrder) {
    state.players[seat].group = allies.has(seat) ? group : other;
  }
}

function legalTargets(state: GameState): number[] {
  const shooter = state.players[state.currentShooter];
  if (!shooter) return [];
  const remaining = (kind: BallGroup): number[] =>
    state.balls.filter((b) => b.kind === kind && !b.pocketed).map((b) => b.id);

  if (!shooter.group) return [...remaining('solid'), ...remaining('stripe')];
  if (isGroupCleared(state, state.currentShooter)) {
    const eight = state.balls.find((b) => b.id === EIGHT_BALL_ID && !b.pocketed);
    return eight ? [eight.id] : [];
  }
  return remaining(shooter.group);
}

function resolve(state: GameState, outcome: ShotOutcome, ctx: ShotContext): ModeResult {
  const shooter = state.currentShooter;
  const info = state.players[shooter];
  const wasBreak = state.phase === 'break';
  const advance = (): Seat => nextActiveSeat(state, shooter);
  const handOver = (foul: string): ModeResult => {
    state.currentShooter = advance();
    state.phase = 'ball_in_hand';
    state.ballInHandBehindLine = false;
    return { foul };
  };

  let foul = basicFoul(outcome, ctx.timedOut);
  if (!foul && outcome.firstBallContacted !== null) {
    const first = state.balls.find((b) => b.id === outcome.firstBallContacted);
    if (info.group) {
      const legal = first?.kind === info.group || (first?.kind === 'eight' && ctx.groupCleared);
      if (!legal) foul = first?.kind === 'eight' ? 'Hit the 8 too early' : 'Hit the wrong group first';
    } else if (!wasBreak && first?.kind === 'eight') {
      foul = 'Hit the 8 first on an open table';
    }
  }
  if (!foul && wasBreak && ctx.rules.breakRequirement) {
    const pottedAny = outcome.potted.some((id) => id !== CUE_BALL_ID);
    if (!pottedAny && outcome.objectBallsToRail < BREAK_BALLS_TO_RAIL) {
      foul = `Weak break — ${BREAK_BALLS_TO_RAIL} balls must reach a rail`;
    }
  }

  // ---- The 8 ----
  if (outcome.eightBallPocketed) {
    if (wasBreak) {
      // The 8 on the break comes back up; nobody wins or loses a frame on a lucky break.
      respot(state, EIGHT_BALL_ID);
      if (foul) {
        state.currentShooter = advance();
        state.phase = 'ball_in_hand';
        state.ballInHandBehindLine = ctx.rules.kitchenAfterBreakScratch && outcome.cueBallPocketed;
        return { foul };
      }
      state.phase = 'aiming';
      return { foul: null, note: '8 on the break — it comes back up' };
    }

    const called =
      !ctx.rules.callEight || outcome.pottedIn[EIGHT_BALL_ID] === ctx.call?.pocketIndex;
    const legal = !foul && called && ctx.groupCleared && info.group !== null;
    if (legal) {
      endGame(state, shooter, null);
      return { foul: null };
    }
    const reason =
      foul ??
      (!ctx.groupCleared || info.group === null
        ? '8-ball potted too early'
        : '8-ball in the wrong pocket');
    endGame(state, advance(), reason);
    return { foul: reason };
  }

  // ---- The break ----
  if (wasBreak) {
    if (foul) {
      state.currentShooter = advance();
      state.phase = 'ball_in_hand';
      state.ballInHandBehindLine = ctx.rules.kitchenAfterBreakScratch && outcome.cueBallPocketed;
      return { foul };
    }
    // The table stays open after the break whatever went down.
    state.phase = 'aiming';
    if (!outcome.potted.some((id) => id !== CUE_BALL_ID)) state.currentShooter = advance();
    return { foul: null };
  }

  if (foul) return handOver(foul);

  // ---- Groups ----
  let keepOpen = false;
  if (!info.group) {
    const kinds = new Set(
      outcome.potted
        .map((id) => state.balls.find((b) => b.id === id)?.kind)
        .filter((k): k is BallGroup => k === 'solid' || k === 'stripe')
    );
    if (kinds.size === 1) assignGroups(state, shooter, [...kinds][0]);
    // Both groups down: the table stays open and the shooter carries on.
    else if (kinds.size === 2) keepOpen = true;
  }

  const group = state.players[shooter].group;
  const pottedOwn =
    keepOpen ||
    outcome.potted.some((id) => {
      const ball = state.balls.find((b) => b.id === id);
      return ball !== undefined && group !== null && ball.kind === group;
    });

  // Under call shot only the nominated ball in the nominated pocket keeps the visit alive.
  const calledOk =
    !ctx.rules.callShot ||
    (ctx.call !== null && outcome.pottedIn[ctx.call.ballId] === ctx.call.pocketIndex);

  state.phase = 'aiming';
  if (!pottedOwn || !calledOk) state.currentShooter = advance();
  return { foul: null };
}

export const eightBallMode: ModeDescriptor = {
  id: 'eightball',
  name: '8-Ball',
  blurb: 'Solids or stripes. Clear your group, then sink the 8 in the pocket you call.',
  rulesSummary: [
    'Your group is whichever you pot first after the break',
    'Pot one of yours and you keep the table',
    'Clear your group, then call a pocket and sink the 8 to win',
    'Four players? It becomes 2v2 doubles with a shared group',
  ],
  minPlayers: 2,
  maxPlayers: 4,
  solo: false,
  supportsShotClock: true,
  usesRuleSet: true,
  rack: () => rackBalls(),
  assignSeats: (state) => {
    const doubles = state.seatOrder.length === 4;
    state.seatOrder.forEach((seat, i) => {
      state.players[seat].team = doubles ? (i % 2 === 0 ? 'a' : 'b') : null;
      state.players[seat].group = null;
    });
  },
  legalTargetBallIds: legalTargets,
  callRequirement: (state, rules) => {
    if (state.phase === 'break') return 'none';
    if (rules.callShot) return 'ballAndPocket';
    if (rules.callEight && isGroupCleared(state, state.currentShooter)) return 'pocket';
    return 'none';
  },
  resolveShot: resolve,
};
