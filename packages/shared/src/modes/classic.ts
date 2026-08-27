import type { GameState, Seat } from '../types.js';
import { CUE_BALL_ID } from '../constants.js';
import { BREAK_BALLS_TO_RAIL } from '../ruleSets.js';
import { rackBalls } from '../rack.js';
import { basicFoul, endGame, nextActiveSeat } from './shared.js';
import type { ModeDescriptor, ShotContext, ShotOutcome } from './types.js';

/**
 * Standard eight-ball. `teams` is the same rule set with the group shared across a team, so
 * both ids run through this module and differ only in who counts as an ally.
 */

/** Everyone sharing this seat's group — the seat alone in classic, the whole team in teams. */
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

function assignGroups(state: GameState, shooter: Seat, group: 'solid' | 'stripe'): void {
  const other = group === 'solid' ? 'stripe' : 'solid';
  const allies = new Set(alliedSeats(state, shooter));
  for (const seat of state.seatOrder) {
    state.players[seat].group = allies.has(seat) ? group : other;
  }
}

function legalTargets(state: GameState): number[] {
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

function resolve(state: GameState, outcome: ShotOutcome, ctx: ShotContext): void {
  const shooter = state.currentShooter;
  const shooterInfo = state.players[shooter];
  const wasBreak = state.phase === 'break';
  const advance = (): Seat => nextActiveSeat(state, shooter);

  // Running out the clock is a foul in its own right, ahead of any contact checks.
  if (ctx.timedOut) {
    state.turnNumber++;
    state.currentShooter = advance();
    state.phase = 'ball_in_hand';
    state.lastFoulReason = 'Shot clock expired';
    return;
  }

  let foulReason: string | null = null;
  if (outcome.cueBallPocketed) {
    foulReason = 'Scratch: cue ball pocketed';
  } else if (outcome.firstBallContacted === null) {
    foulReason = 'No ball contacted';
  } else if (shooterInfo.group) {
    const firstBall = state.balls.find((b) => b.id === outcome.firstBallContacted);
    const legalFirst =
      firstBall?.kind === shooterInfo.group || (firstBall?.kind === 'eight' && ctx.groupCleared);
    if (!legalFirst) foulReason = 'Wrong ball hit first';
  }
  if (!foulReason && outcome.potted.length === 0 && !outcome.anyCushionAfterContact) {
    foulReason = 'No rail after contact';
  }
  // The break has to actually break: four balls to a rail, or something down. Otherwise a
  // player can tap the rack and leave the table dead for the opponent.
  if (!foulReason && wasBreak && ctx.rules.breakRequirement) {
    const potted = outcome.potted.some((id) => id !== CUE_BALL_ID);
    if (!potted && outcome.objectBallsToRail < BREAK_BALLS_TO_RAIL) {
      foulReason = `Illegal break: needs ${BREAK_BALLS_TO_RAIL} balls to a rail or a pot`;
    }
  }
  const foul = foulReason !== null;

  /**
   * With call shot on, only the nominated ball in the nominated pocket keeps your visit alive.
   * Everything else on the table still counts as potted — it doesn't come back up — but it
   * doesn't earn you another shot, which is the whole point: flukes stop paying.
   */
  const calledBallDropped = (): boolean => {
    if (!ctx.rules.callShot) return true;
    if (!ctx.call) return false;
    return outcome.pottedIn[ctx.call.ballId] === ctx.call.pocketIndex;
  };

  // --- 8-ball resolution takes priority over everything else ---
  if (outcome.eightBallPocketed) {
    // Calling the 8 matters more than calling anything else: dropping it in the wrong pocket
    // is a loss in every serious rule set, not merely a missed chance.
    const called = !ctx.rules.callShot || outcome.pottedIn[8] === ctx.call?.pocketIndex;
    const legalEightPot = !foul && called && ctx.groupCleared && shooterInfo.group !== null;
    endGame(
      state,
      legalEightPot ? shooter : advance(),
      legalEightPot ? foulReason : (foulReason ?? (called ? null : '8-ball in the wrong pocket'))
    );
    return;
  }

  if (wasBreak) {
    // Table stays open after the break regardless of what was potted.
    if (foul) {
      state.currentShooter = advance();
      state.phase = 'ball_in_hand';
      // A scratch on the break costs the incoming player the whole table: they're stuck
      // behind the head string, which is what makes breaking badly genuinely expensive.
      state.ballInHandBehindLine =
        ctx.rules.kitchenAfterBreakScratch && outcome.cueBallPocketed;
    } else if (outcome.potted.length > 0) {
      state.phase = 'aiming'; // shooter continues, table still open
    } else {
      state.currentShooter = advance();
      state.phase = 'aiming';
    }
    state.lastFoulReason = foulReason;
    state.turnNumber++;
    return;
  }

  if (foul) {
    state.currentShooter = advance();
    state.phase = 'ball_in_hand';
    state.lastFoulReason = foulReason;
    state.turnNumber++;
    return;
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
  // Keeping the table needs a ball of yours *and*, under call shot, the one you nominated.
  if (!pottedOwnBall || !calledBallDropped()) state.currentShooter = advance();
  state.turnNumber++;
}

export const classicMode: ModeDescriptor = {
  id: 'classic',
  name: 'Classic 8-Ball',
  blurb: 'Solids vs stripes. Clear your group, then sink the 8 to win.',
  rulesSummary: [
    'Groups are decided by the first ball legally potted after the break',
    'Pot one of yours and you keep the table',
    'Sink the 8 early — or foul on it — and you lose',
  ],
  minPlayers: 2,
  maxPlayers: 2,
  supportsShotClock: true,
  rack: () => rackBalls(),
  assignSeats: () => {},
  legalTargetBallIds: legalTargets,
  resolveShot: resolve,
};

export const teamsMode: ModeDescriptor = {
  ...classicMode,
  id: 'teams',
  name: 'Teams',
  blurb: 'Two teams, alternating seats, one shared group each.',
  rulesSummary: [
    'Seats alternate teams around the table, exactly like real doubles',
    'Your whole team shares solids or stripes',
    'Any teammate can pot the 8 once the team has cleared its group',
  ],
  maxPlayers: 8,
  assignSeats: (state) => {
    state.seatOrder.forEach((seat, i) => {
      state.players[seat].team = i % 2 === 0 ? 'a' : 'b';
    });
  },
};

// Re-exported for the modes that reuse the plain foul set.
export { basicFoul };
