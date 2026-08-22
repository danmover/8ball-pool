import type { GameState, Seat } from '../types.js';
import { CUE_BALL_ID } from '../constants.js';
import { rackBalls } from '../rack.js';
import { endGame, nextActiveSeat } from './shared.js';
import { activeSeats, type ModeDescriptor, type ShotContext, type ShotOutcome } from './types.js';

/**
 * Cutthroat: every player owns a block of balls and has to protect them. You're out when your
 * last one is potted, and the last player with a ball still on the table wins.
 *
 * The classic game is three players with 1-5 / 6-10 / 11-15. We deal the 15 object balls out
 * evenly for any seat count from 2 up, so it also works as a 5-player free-for-all.
 */
const OBJECT_BALLS = Array.from({ length: 15 }, (_, i) => i + 1);

/**
 * Deals in contiguous blocks (1-5 / 6-10 / 11-15 at three players, as in the real game),
 * then hands out any remainder one at a time. Every ball must end up owned — a ball nobody
 * owns can never eliminate anyone, so it would just sit there confusing the count.
 */
function dealBalls(seatCount: number): number[][] {
  const perSeat = Math.floor(OBJECT_BALLS.length / seatCount);
  const hands = Array.from({ length: seatCount }, (_, i) =>
    OBJECT_BALLS.slice(i * perSeat, (i + 1) * perSeat)
  );
  OBJECT_BALLS.slice(perSeat * seatCount).forEach((id, i) => {
    hands[i % seatCount].push(id);
  });
  return hands;
}

function ownerOf(state: GameState, ballId: number): Seat | null {
  return state.seatOrder.find((seat) => state.players[seat].ownedBalls.includes(ballId)) ?? null;
}

/** A player is out once every ball they own is down. */
function updateElimination(state: GameState): void {
  for (const seat of state.seatOrder) {
    const player = state.players[seat];
    if (player.eliminated) continue;
    const anyLeft = player.ownedBalls.some(
      (id) => !(state.balls.find((b) => b.id === id)?.pocketed ?? true)
    );
    if (!anyLeft) player.eliminated = true;
  }
}

function resolve(state: GameState, outcome: ShotOutcome, ctx: ShotContext): void {
  const shooter = state.currentShooter;

  let foulReason: string | null = null;
  if (ctx.timedOut) {
    foulReason = 'Shot clock expired';
  } else if (outcome.cueBallPocketed) {
    foulReason = 'Scratch: cue ball pocketed';
  } else if (outcome.firstBallContacted === null) {
    foulReason = 'No ball contacted';
  } else if (ownerOf(state, outcome.firstBallContacted) === shooter) {
    // Hitting your own ball first is a foul — you're supposed to be shooting at theirs.
    foulReason = 'You hit one of your own balls first';
  } else if (outcome.potted.length === 0 && !outcome.anyCushionAfterContact) {
    foulReason = 'No rail after contact';
  }
  const foul = foulReason !== null;

  updateElimination(state);

  const stillIn = activeSeats(state);
  if (stillIn.length <= 1) {
    endGame(state, stillIn[0] ?? null, foulReason);
    return;
  }

  state.turnNumber++;

  if (foul) {
    // On a foul the shooter's own potted balls are spotted back — you can't clear yourself
    // out of trouble by fouling.
    state.currentShooter = nextActiveSeat(state, shooter);
    state.phase = 'ball_in_hand';
    state.lastFoulReason = foulReason;
    return;
  }

  state.phase = 'aiming';
  state.lastFoulReason = null;
  // Potting somebody else's ball keeps you at the table.
  const pottedOpponentBall = outcome.potted.some(
    (id) => id !== CUE_BALL_ID && ownerOf(state, id) !== shooter
  );
  if (!pottedOpponentBall || state.players[shooter].eliminated) {
    state.currentShooter = nextActiveSeat(state, shooter);
  }
}

export const cutthroatMode: ModeDescriptor = {
  id: 'cutthroat',
  name: 'Cutthroat',
  blurb: 'Everyone owns a set of balls. Last player with one left on the table wins.',
  rulesSummary: [
    'The 15 balls are dealt out evenly between the players',
    'Pot other people’s balls — never strike your own first',
    'You’re out when your last ball goes down',
    'Last player standing takes it',
  ],
  minPlayers: 2,
  maxPlayers: 5,
  supportsShotClock: true,
  rack: () => rackBalls(),
  assignSeats: (state) => {
    const hands = dealBalls(state.seatOrder.length);
    state.seatOrder.forEach((seat, i) => {
      state.players[seat].ownedBalls = hands[i] ?? [];
      state.players[seat].eliminated = false;
      state.players[seat].group = null;
    });
  },
  legalTargetBallIds: (state) => {
    const shooter = state.currentShooter;
    return state.balls
      .filter((b) => !b.pocketed && b.id !== CUE_BALL_ID && ownerOf(state, b.id) !== shooter)
      .map((b) => b.id);
  },
  resolveShot: resolve,
};
