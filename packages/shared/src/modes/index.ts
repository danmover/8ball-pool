import type { GameMode } from '../types.js';
import { classicMode, teamsMode } from './classic.js';
import { rotationMode } from './rotation.js';
import { nineBallMode } from './nineball.js';
import { cutthroatMode } from './cutthroat.js';
import { killerMode } from './killer.js';
import { sandboxMode } from './sandbox.js';
import { ghostMode } from './ghost.js';
import { challengeMode } from './challenge.js';
import type { ModeDescriptor } from './types.js';

export * from './types.js';
export * from './shared.js';
export { isGroupCleared } from './classic.js';
export { STARTING_LIVES } from './killer.js';
export { activeChallenge } from './challenge.js';
export type { ChallengeState } from './challenge.js';

/**
 * The mode registry. Adding a game mode means adding a module and one entry here — nothing
 * else in the engine, the server or the client needs a new branch.
 */
export const MODES: Record<GameMode, ModeDescriptor> = {
  classic: classicMode,
  teams: teamsMode,
  rotation: rotationMode,
  nineball: nineBallMode,
  cutthroat: cutthroatMode,
  killer: killerMode,
  sandbox: sandboxMode,
  ghost: ghostMode,
  challenge: challengeMode,
};

/**
 * Menu order — the two everyone knows first, the party modes after, practice last.
 * Modes offered in the lobby's picker. `challenge` is deliberately absent — trick shots are
 * launched from their own browser, not chosen as a lobby mode.
 */
export const MODE_ORDER: GameMode[] = [
  'classic',
  'nineball',
  'teams',
  'cutthroat',
  'killer',
  'rotation',
  'ghost',
  'sandbox',
];

export function modeDescriptor(mode: GameMode): ModeDescriptor {
  return MODES[mode] ?? MODES.classic;
}

export function allModes(): ModeDescriptor[] {
  return MODE_ORDER.map((id) => MODES[id]);
}

/** Clamps a requested lobby size to what the mode can actually seat. */
export function clampPlayerCount(mode: GameMode, count: number): number {
  const desc = modeDescriptor(mode);
  return Math.max(desc.minPlayers, Math.min(desc.maxPlayers, Math.round(count)));
}
