import type { GameMode } from '../types.js';
import { eightBallMode } from './eightball.js';
import { nineBallMode } from './nineball.js';
import { killerMode } from './killer.js';
import { powerMode } from './power.js';
import { practiceMode, timeAttackMode, trickShotMode } from './solo.js';
import type { ModeDescriptor } from './types.js';

export * from './types.js';
export * from './shared.js';
export { isGroupCleared } from './eightball.js';
export { STARTING_LIVES, MAX_LIVES } from './killer.js';
export { armPower, canArm, spendArmed } from './power.js';
export {
  activeChallenge,
  formatRunTime,
  timeAttackStars,
  TIME_ATTACK_PAR_MS,
  TIME_ATTACK_PENALTY_MS,
} from './solo.js';

/**
 * The mode registry. Adding a game mode means adding a module and one entry here — nothing else
 * in the engine, the relay or the client needs a new branch.
 */
export const MODES: Record<GameMode, ModeDescriptor> = {
  eightball: eightBallMode,
  nineball: nineBallMode,
  killer: killerMode,
  power: powerMode,
  practice: practiceMode,
  timeattack: timeAttackMode,
  trickshot: trickShotMode,
};

export function modeDescriptor(mode: GameMode): ModeDescriptor {
  return MODES[mode] ?? MODES.eightball;
}

/** Clamps a requested player count to what the mode can actually seat. */
export function clampPlayerCount(mode: GameMode, count: number): number {
  const desc = modeDescriptor(mode);
  return Math.max(desc.minPlayers, Math.min(desc.maxPlayers, Math.round(count)));
}
