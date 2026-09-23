import type { GameState } from '../types.js';
import { CUE_BALL_ID, EIGHT_BALL_ID } from '../constants.js';
import { rackScattered } from '../rack.js';
import { endGame, nextActiveSeat, remainingBallIds } from './shared.js';
import { activeSeats, type ModeDescriptor, type ModeResult, type ShotContext, type ShotOutcome } from './types.js';

/**
 * Killer: everyone has three lives and has to pot *something* on every visit. Miss or foul and
 * you drop a life; lose them all and you're out. Last player standing wins.
 *
 * Two twists keep it lively with a full table: the black gives a life back (up to five), and
 * the table always passes on, so nobody waits long for their go.
 */
export const STARTING_LIVES = 3;
export const MAX_LIVES = 5;

function resolve(state: GameState, outcome: ShotOutcome, ctx: ShotContext): ModeResult {
  const shooter = state.currentShooter;
  const player = state.players[shooter];
  const lives = player.lives ?? STARTING_LIVES;

  let foul: string | null = null;
  if (ctx.timedOut) foul = 'Shot clock expired';
  else if (outcome.cueBallPocketed) foul = 'Scratch — cue ball potted';
  else if (outcome.firstBallContacted === null) foul = 'No ball hit';

  const potted = outcome.potted.filter((id) => id !== CUE_BALL_ID);
  const wasBreak = state.phase === 'break';
  let lifeDelta = 0;
  let note: string | null = null;

  if (foul || (potted.length === 0 && !wasBreak)) {
    lifeDelta = -1;
    note = foul ? null : `${player.name} missed — lost a life`;
  } else if (!foul && potted.includes(EIGHT_BALL_ID) && lives < MAX_LIVES) {
    lifeDelta = 1;
    note = `${player.name} potted the black — extra life!`;
  }
  player.lives = Math.max(0, Math.min(MAX_LIVES, lives + lifeDelta));
  if (player.lives === 0) {
    player.eliminated = true;
    note = `${player.name} is out!`;
  }

  // Re-spread the balls once the table empties, so a long game never runs dry.
  if (remainingBallIds(state).length === 0) {
    const fresh = rackScattered(Math.floor(ctx.rand() * 1e9));
    const cue = state.balls.find((b) => b.id === CUE_BALL_ID);
    state.balls = fresh.map((b) => (b.id === CUE_BALL_ID && cue ? { ...cue, pocketed: false } : b));
  }

  const stillIn = activeSeats(state);
  if (stillIn.length <= 1) {
    endGame(state, stillIn[0] ?? null, null);
    return { foul, note, lifeDelta };
  }

  // The table always passes on in killer — that's what makes every visit count.
  state.currentShooter = nextActiveSeat(state, shooter);
  state.phase = outcome.cueBallPocketed ? 'ball_in_hand' : 'aiming';
  state.ballInHandBehindLine = false;
  return { foul, note, lifeDelta };
}

export const killerMode: ModeDescriptor = {
  id: 'killer',
  name: 'Killer',
  blurb: 'Three lives each. Pot every visit or lose one. Last one standing wins.',
  rulesSummary: [
    'Any ball counts — just pot something every visit',
    'A miss or a foul costs a life; lose all three and you’re out',
    'Pot the black to win a life back (up to five)',
    'The table passes on after every shot',
  ],
  minPlayers: 2,
  maxPlayers: 8,
  solo: false,
  supportsShotClock: true,
  usesRuleSet: false,
  // Played on a spread table: from a tight rack nobody can pot for the first few visits, and
  // with lives on the line the frame would be decided before the balls ever broke up.
  rack: (_count, rand) => rackScattered(Math.floor(rand() * 1e9)),
  assignSeats: (state) => {
    for (const seat of state.seatOrder) {
      state.players[seat].lives = STARTING_LIVES;
      state.players[seat].group = null;
    }
    // A spread table needs no break.
    state.phase = 'aiming';
  },
  legalTargetBallIds: (state) => remainingBallIds(state),
  callRequirement: () => 'none',
  resolveShot: resolve,
};
