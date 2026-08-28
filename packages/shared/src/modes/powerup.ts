import type { GameState } from '../types.js';
import { classicMode } from './classic.js';
import { NO_MODIFIERS, spawnPickups } from '../pickups.js';
import type { ModeDescriptor, ShotContext, ShotOutcome } from './types.js';

/**
 * Power-up pool: ordinary eight-ball with five discs scattered on the cloth.
 *
 * Everything about the rules is classic — groups, the 8 last, the same fouls. The only
 * addition is that routing the cue ball over a disc arms an effect for one shot. That
 * restraint is the design: a party mode that also changed how potting worked would stop being
 * pool with a twist and start being a different game that happens to have balls in it.
 *
 * Every effect is visible before the shot to both players, and every one lasts exactly one
 * shot. Nothing here is a surprise mid-stroke.
 */

function resolve(state: GameState, outcome: ShotOutcome, ctx: ShotContext): void {
  const mods = state.modifiers;
  const shooterBefore = state.currentShooter;

  classicMode.resolveShot(state, outcome, ctx);

  // A bonus visit takes the turn back — but only when the classic rules actually gave it away,
  // and never once the frame is over. Cashing it after the 8 has dropped would be absurd.
  if (
    mods?.bonusVisit &&
    state.phase !== 'game_over' &&
    state.currentShooter !== shooterBefore
  ) {
    state.currentShooter = shooterBefore;
    // A foul still costs the cue ball's position; the bonus buys the visit back, not the foul.
    if (state.phase !== 'ball_in_hand') state.phase = 'aiming';
    state.lastFoulReason = 'Bonus visit — keep the table';
  }
}

export const powerupMode: ModeDescriptor = {
  ...classicMode,
  id: 'powerup',
  name: 'Power-Up Pool',
  blurb: 'Eight-ball with pickups on the cloth. Roll the cue ball over one to arm it.',
  rulesSummary: [
    'Standard eight-ball — groups, then the 8',
    'Roll the cue ball over a disc to arm its effect',
    'Every effect lasts exactly one shot, and both players can see it',
    'Some land on you, some on your opponent',
  ],
  minPlayers: 2,
  maxPlayers: 2,
  assignSeats: (state) => {
    classicMode.assignSeats(state);
    state.pickups = spawnPickups();
    state.modifiers = { ...NO_MODIFIERS };
  },
  resolveShot: resolve,
};
