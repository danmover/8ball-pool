import type { GameState, Seat } from '../types.js';
import { CUE_BALL_ID } from '../constants.js';
import { rackBalls } from '../rack.js';
import {
  MAX_HELD_POWERS,
  ballPoints,
  emptyPowerState,
  refillOrbs,
  type PowerId,
} from '../powers.js';
import { endGame, nextActiveSeat, remainingBallIds } from './shared.js';
import { activeSeats, type ModeDescriptor, type ModeResult, type ShotContext, type ShotOutcome } from './types.js';

/**
 * Power Pool: a points race with power orbs on the cloth.
 *
 * Every ball is worth a point and the 8 is worth three. Pot and you keep the table; miss and it
 * passes on. Roll the cue ball through an orb to bank a power, and arm it before any shot. The
 * frame ends as soon as nobody can catch the leader, or when the table is empty.
 */

/** Points still available on the table. */
function pointsLeft(state: GameState): number {
  return remainingBallIds(state).reduce((sum, id) => sum + ballPoints(id), 0);
}

/**
 * The leader, once nobody else can catch them — or the winner on a cleared table, with ties
 * going to whoever got there first.
 */
function decided(state: GameState): Seat | null {
  const seats = activeSeats(state);
  const ranked = [...seats].sort((a, b) => state.players[b].score - state.players[a].score);
  const [first, second] = ranked;
  if (!first) return null;
  const lead = state.players[first].score - (second ? state.players[second].score : 0);
  const left = pointsLeft(state);
  if (left === 0) {
    const top = state.players[first].score;
    const tied = ranked.filter((s) => state.players[s].score === top);
    if (tied.length === 1) return first;
    // Tie on an empty table: the one who reached the score first. `reachedAt` is kept per seat.
    const reached = state.power?.reachedAt ?? {};
    return tied.sort((a, b) => (reached[a] ?? 0) - (reached[b] ?? 0))[0];
  }
  return lead > left ? first : null;
}

function resolve(state: GameState, outcome: ShotOutcome, ctx: ShotContext): ModeResult {
  const shooter = state.currentShooter;
  const player = state.players[shooter];
  const power = (state.power ??= emptyPowerState());
  const armed = ctx.armed;

  let foul: string | null = null;
  if (ctx.timedOut) foul = 'Shot clock expired';
  else if (outcome.cueBallPocketed) foul = 'Scratch — cue ball potted';
  else if (outcome.firstBallContacted === null) foul = 'No ball hit';

  const potted = outcome.potted.filter((id) => id !== CUE_BALL_ID);
  let points = potted.reduce((sum, id) => sum + ballPoints(id), 0);
  if (armed === 'double') points *= 2;
  if (foul) points -= 1;
  const before = player.score;
  player.score = Math.max(0, player.score + points);
  if (player.score !== before) {
    power.reachedAt ??= {};
    power.reachedAt[shooter] = state.turnNumber;
  }

  // Bank what the cue ball collected, up to the hand limit.
  const held = (power.held[shooter] ??= []);
  for (const id of outcome.collected) {
    if (held.length < MAX_HELD_POWERS) held.push(id);
  }

  // A frozen player's turn is spent; the freeze thaws.
  power.frozen = power.frozen.filter((s) => s !== shooter);
  power.armed = null;

  const winner = decided(state);
  if (winner) {
    endGame(state, winner, null);
    return { foul, points: player.score - before };
  }

  const kept = !foul && (potted.length > 0 || armed === 'extra');
  const next = kept ? shooter : nextActiveSeat(state, shooter);
  if (armed === 'freeze') {
    const target = kept ? nextActiveSeat(state, shooter) : next;
    if (target !== shooter && !power.frozen.includes(target)) power.frozen.push(target);
  }
  state.currentShooter = next;
  state.phase = outcome.cueBallPocketed ? 'ball_in_hand' : 'aiming';
  state.ballInHandBehindLine = false;

  refillOrbs(power, state.balls, ctx.rand);
  const note = armed === 'extra' && potted.length === 0 && !foul ? 'Extra shot — keep the table' : null;
  return { foul, points: player.score - before, note };
}

export const powerMode: ModeDescriptor = {
  id: 'power',
  name: 'Power Pool',
  blurb: 'A points race with power-ups on the cloth. Bombs, big pockets, double points.',
  rulesSummary: [
    'Every ball is a point — the 8 is worth three',
    'Pot and you keep the table; miss and it passes on',
    'Roll the cue ball through an orb to bank a power, then arm it on any shot',
    'A foul costs a point. The frame ends when nobody can catch the leader',
  ],
  minPlayers: 2,
  maxPlayers: 4,
  solo: false,
  supportsShotClock: true,
  usesRuleSet: false,
  rack: () => rackBalls(),
  assignSeats: (state, rand) => {
    for (const seat of state.seatOrder) {
      state.players[seat].score = 0;
      state.players[seat].group = null;
    }
    state.power = emptyPowerState();
    refillOrbs(state.power, state.balls, rand);
  },
  legalTargetBallIds: (state) => remainingBallIds(state),
  callRequirement: () => 'none',
  resolveShot: resolve,
};

/** Whether `seat` may arm `power` right now. */
export function canArm(state: GameState, seat: Seat, power: PowerId | null): boolean {
  if (state.mode !== 'power' || !state.power) return false;
  if (state.currentShooter !== seat) return false;
  if (state.phase !== 'aiming' && state.phase !== 'break' && state.phase !== 'ball_in_hand') return false;
  if (power === null) return true;
  return (state.power.held[seat] ?? []).includes(power);
}

/**
 * Arms (or disarms, with null) a held power. The power stays in hand until the shot is taken,
 * so changing your mind costs nothing.
 */
export function armPower(state: GameState, seat: Seat, power: PowerId | null): boolean {
  if (!canArm(state, seat, power) || !state.power) return false;
  state.power.armed = power;
  return true;
}

/** Takes the armed power out of the shooter's hand as the shot is struck. */
export function spendArmed(state: GameState): PowerId | null {
  const power = state.power;
  if (!power?.armed) return null;
  const held = power.held[state.currentShooter] ?? [];
  const i = held.indexOf(power.armed);
  if (i === -1) {
    power.armed = null;
    return null;
  }
  held.splice(i, 1);
  return power.armed;
}
