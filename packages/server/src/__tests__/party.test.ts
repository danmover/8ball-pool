import { describe, expect, it } from 'vitest';
import {
  CUE_BALL_ID,
  NO_MODIFIERS,
  TABLE_WIDTH,
  type Seat,
  type ShotModifiers,
  type SimEvent,
} from '@8ball/shared';
import { Room } from '../room.js';

/**
 * The party formats, driven through `Room` directly.
 *
 * Deliberately not through a socket and a pair of bots: a rotation bug only shows up after
 * several *finished frames*, and waiting for bots to play those takes minutes and gives a
 * different answer every run. Here a frame is won by setting a winner, which is the only part
 * of it the rotation actually reads.
 */

/** A `Server` stand-in — the Room only ever emits, and nothing here listens. */
function fakeIo(): never {
  const chain = { emit: () => chain, to: () => chain };
  return chain as never;
}

/**
 * A `Server` stand-in that records what was emitted and to whom.
 *
 * Needed for betting, where the *addressing* is the behaviour under test: a payout that went
 * to the room instead of the bettor would tell everyone what everyone else staked.
 */
function recordingIo(): { io: never; sent: { to: string; event: string; payload: unknown }[] } {
  const sent: { to: string; event: string; payload: unknown }[] = [];
  const make = (target: string) => ({
    emit: (event: string, payload: unknown) => {
      sent.push({ to: target, event, payload });
      return make(target);
    },
    to: (next: string) => make(next),
  });
  return { io: make('') as never, sent };
}

function room(): Room {
  return new Room('TEST', fakeIo(), 'host-token');
}

/** Reaches the private members these formats live in; the alternative is exporting them. */
type Internals = {
  king: { holder: Seat; streak: number; queue: Seat[]; best: { seat: Seat; streak: number } | null } | null;
  recordFrameResult(): void;
  rollModifiers(events: SimEvent[]): void;
  pendingModifiers: Map<Seat, ShotModifiers>;
  seatKingMatch(): void;
};
const inner = (r: Room): Internals => r as unknown as Internals;

/** Waits for the shot in flight to come to rest, or gives up after `ms`. */
async function settled(r: Room, ms = 25_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (r.gameState.phase === 'shot_in_progress' && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  expect(r.gameState.phase, 'the shot never settled').not.toBe('shot_in_progress');
}

/** Plays out one frame: `winner` takes it, and the room moves on to the next. */
function winFrame(r: Room, winner: Seat): void {
  r.gameState.winner = winner;
  r.gameState.phase = 'game_over';
  inner(r).recordFrameResult();
  r.requestRematch();
}

describe('king of the table', () => {
  const setup = (players: number): Room => {
    const r = room();
    for (let i = 1; i <= players; i++) r.addBot(`p${i}`, 'club');
    r.startKingOfTable(players);
    return r;
  };

  it('seats the holder against the front of the queue', () => {
    const r = setup(3);
    const king = inner(r).king!;
    expect(king.holder).toBe('p1');
    expect(king.queue).toEqual(['p2', 'p3']);
    // Everyone not at the table sits out; the two who are, do not.
    expect(r.gameState.players.p3.eliminated).toBe(true);
    expect(r.gameState.players.p1.eliminated).toBe(false);
    expect(r.gameState.players.p2.eliminated).toBe(false);
  });

  it('gives the break to the challenger', () => {
    // The holder has already had the table; the incoming player gets the one advantage going.
    const r = setup(3);
    expect(r.gameState.currentShooter).toBe('p2');
  });

  it('keeps the holder on and sends the loser to the back', () => {
    const r = setup(3);
    winFrame(r, 'p1');
    const king = inner(r).king!;
    expect(king.holder).toBe('p1');
    expect(king.streak).toBe(1);
    expect(king.queue).toEqual(['p3', 'p2']);
  });

  it('hands the table over when the challenger wins', () => {
    const r = setup(3);
    winFrame(r, 'p2');
    const king = inner(r).king!;
    expect(king.holder).toBe('p2');
    expect(king.streak).toBe(1);
    // The beaten holder joins the back of the queue rather than dropping out.
    expect(king.queue).toEqual(['p3', 'p1']);
  });

  it('never loses anyone from the rotation, however long it runs', () => {
    const r = setup(4);
    const winners: Seat[] = ['p1', 'p3', 'p3', 'p2', 'p4', 'p4', 'p1'];
    for (const w of winners) {
      const king = inner(r).king!;
      // Only someone actually at the table can win the frame.
      const atTable = [king.holder, king.queue[0]];
      winFrame(r, atTable.includes(w) ? w : atTable[0]);
      const after = inner(r).king!;
      expect(new Set([after.holder, ...after.queue]).size).toBe(4);
    }
  });

  it('counts a run up and remembers the best one', () => {
    const r = setup(3);
    winFrame(r, 'p1');
    winFrame(r, 'p1');
    winFrame(r, 'p1');
    expect(inner(r).king!.streak).toBe(3);
    // Losing resets the streak but not the record.
    const challenger = inner(r).king!.queue[0];
    winFrame(r, challenger);
    expect(inner(r).king!.streak).toBe(1);
    expect(inner(r).king!.best).toEqual({ seat: 'p1', streak: 3 });
  });

  it('fills a short room with bots rather than refusing to start', () => {
    // Two people should still be able to run a queue.
    const r = room();
    r.addBot('p1', 'club');
    r.addBot('p2', 'club');
    r.startKingOfTable(2);
    expect(inner(r).king!.queue.length).toBeGreaterThanOrEqual(2);
  });
});

describe('power-up banking', () => {
  const pickup = (kind: 'magnet' | 'freeze' | 'bonus' | 'blocker' | 'ghost'): SimEvent =>
    ({ type: 'pickup', kind, pos: { x: 35, y: 35 } }) as SimEvent;

  const started = (): Room => {
    const r = room();
    r.updateLobby({ mode: 'powerup' });
    r.addBot('p1', 'club');
    r.addBot('p2', 'club');
    r.startGame();
    return r;
  };

  it('holds a self-effect for the collector when they lose the table', () => {
    // The bug this exists for: collecting a magnet and then missing used to throw it away
    // silently, even though routing the cue ball over the disc is what you paid for it with.
    const r = started();
    r.gameState.lastShooter = 'p1';
    r.gameState.currentShooter = 'p2';
    inner(r).rollModifiers([pickup('magnet')]);

    // p2 shoots now and gets nothing of p1's.
    expect(r.gameState.modifiers!.magnetPocket).toBeNull();
    // p1's magnet is still waiting for them.
    expect(inner(r).pendingModifiers.get('p1')?.magnetPocket).toBe(0);

    r.gameState.lastShooter = 'p2';
    r.gameState.currentShooter = 'p1';
    inner(r).rollModifiers([]);
    expect(r.gameState.modifiers!.magnetPocket).toBe(0);
  });

  it('never turns your own freeze back on you', () => {
    const r = started();
    r.gameState.lastShooter = 'p1';
    r.gameState.currentShooter = 'p1'; // kept the table
    inner(r).rollModifiers([pickup('freeze')]);
    expect(r.gameState.modifiers!.freezeGuide).toBe(false);
    expect(inner(r).pendingModifiers.get('p2')?.freezeGuide).toBe(true);
  });

  it('applies a self-effect immediately when the table is kept', () => {
    const r = started();
    r.gameState.lastShooter = 'p1';
    r.gameState.currentShooter = 'p1';
    inner(r).rollModifiers([pickup('bonus')]);
    expect(r.gameState.modifiers!.bonusVisit).toBe(true);
  });

  it('spends an effect on one shot and no more', () => {
    const r = started();
    r.gameState.lastShooter = 'p1';
    r.gameState.currentShooter = 'p1';
    inner(r).rollModifiers([pickup('ghost')]);
    expect(r.gameState.modifiers!.ghostLine).toBe(true);

    inner(r).rollModifiers([]);
    expect(r.gameState.modifiers!.ghostLine).toBe(false);
  });

  it('does not stack two of a kind into something unreadable', () => {
    const r = started();
    r.gameState.lastShooter = 'p1';
    r.gameState.currentShooter = 'p2';
    inner(r).rollModifiers([pickup('blocker'), pickup('blocker')]);
    // One pocket blocked, not two — a second blocker just moves which one.
    expect(r.gameState.modifiers!.blockedPocket).toBe(0);
  });

  it('leaves every other mode alone', () => {
    // No pickups in state means the whole system is inert, which is what keeps the aim guide
    // and the bot's search running the engine they have always run.
    const r = room();
    r.addBot('p1', 'club');
    r.addBot('p2', 'club');
    r.startGame();
    expect(r.gameState.pickups).toBeNull();
    inner(r).rollModifiers([pickup('magnet')]);
    expect(r.gameState.modifiers).toBeNull();
  });

  it('reads the whole shot, not just the tick it settled on', async () => {
    // The regression this exists for. A disc is almost always collected while the cue ball is
    // still rolling, so passing the final tick's events — which is what the sim loop did —
    // meant the list was empty every single time and no effect ever armed. Every other test
    // here calls rollModifiers directly and so could not have caught it; this one plays a real
    // shot through the loop.
    const r = started();
    const cue = r.gameState.balls.find((b) => b.id === CUE_BALL_ID)!;
    cue.pos = { x: 300, y: TABLE_WIDTH / 2 };

    // Put a disc squarely in the cue ball's path, and nothing else in the way.
    for (const ball of r.gameState.balls) {
      if (ball.id !== CUE_BALL_ID) ball.pocketed = true;
    }
    r.gameState.pickups = [
      { id: 0, kind: 'bonus', pos: { x: 700, y: TABLE_WIDTH / 2 }, taken: false },
    ];
    r.gameState.phase = 'aiming';
    r.gameState.currentShooter = 'p1';

    // Gently: the sim loop runs in real time, so a hard shot is still rolling long after any
    // reasonable test timeout.
    r.handleShoot({ seat: 'p1', angle: 0, power: 0.3, spin: { x: 0, y: 0 } });
    // Polled rather than slept for a fixed duration. A wall-clock wait passes alone and fails
    // under a full run, because the loop is real-time and competing for the same event loop as
    // every other suite — and a flaky test is worse than none.
    await settled(r);

    expect(r.gameState.pickups![0].taken, 'the disc should have been rolled over').toBe(true);
    // With no object balls left there is nothing to hit, so the shot is a foul and the table
    // passes — which means p1's own effect is banked rather than cashed. Either way it must
    // exist somewhere, and before the fix it existed nowhere.
    expect(inner(r).pendingModifiers.get('p1')?.bonusVisit).toBe(true);
  }, 30000);

  it('clears the bank on a new rack', () => {
    const r = started();
    r.gameState.lastShooter = 'p1';
    r.gameState.currentShooter = 'p2';
    inner(r).rollModifiers([pickup('magnet')]);
    expect(inner(r).pendingModifiers.size).toBeGreaterThan(0);

    winFrame(r, 'p1');
    expect(inner(r).pendingModifiers.size).toBe(0);
  });
});

describe('spectator betting', () => {
  type BetInternals = {
    betting: { open: boolean; bets: { bettorId: string; on: string; amount: number }[] };
    settleBets(winner: string | null): void;
  };
  const bets = (r: Room): BetInternals => r as unknown as BetInternals;

  /** A started two-bot table with `count` spectators watching. */
  function table(count = 2): { room: Room; sent: ReturnType<typeof recordingIo>['sent'] } {
    const { io, sent } = recordingIo();
    const r = new Room('TEST', io, 'tok');
    r.addBot('p1', 'club');
    r.addBot('p2', 'club');
    r.startGame();
    for (let i = 0; i < count; i++) r.addSpectator(`spec${i}`);
    return { room: r, sent };
  }

  it('takes a stake from someone watching', () => {
    const { room } = table();
    room.placeSpectatorBet('spec0', 'Ava', 'p1', 50);
    expect(bets(room).betting.bets).toHaveLength(1);
  });

  it('refuses anyone who is not a spectator', () => {
    // Someone with a cue in their hand betting on the frame they are playing is a different
    // game entirely, and not one worth having in a pub.
    const { room } = table();
    room.placeSpectatorBet('some-player-socket', 'Cheat', 'p1', 50);
    expect(bets(room).betting.bets).toHaveLength(0);
  });

  it('refuses a stake on a seat that is not in the frame', () => {
    const { room } = table();
    room.placeSpectatorBet('spec0', 'Ava', 'p7', 50);
    expect(bets(room).betting.bets).toHaveLength(0);
  });

  it('sends the book to someone who starts watching mid-frame', () => {
    // Otherwise they are shown an open book that isn't, tap a stake, and nothing happens — a
    // silent refusal is the worst possible way to explain a rule.
    const { room, sent } = table(0);
    bets(room).betting.open = false;
    sent.length = 0;
    room.addSpectator('late');

    const addressed = sent.filter((m) => m.event === 'bettingBook' && m.to === 'late');
    expect(addressed).toHaveLength(1);
    expect((addressed[0].payload as { open: boolean }).open).toBe(false);
  });

  it('pays each bettor privately, not the whole room', () => {
    const { room, sent } = table();
    room.placeSpectatorBet('spec0', 'Ava', 'p1', 50);
    room.placeSpectatorBet('spec1', 'Ben', 'p2', 50);
    sent.length = 0;

    bets(room).settleBets('p1');
    const payouts = sent.filter((m) => m.event === 'betSettled');
    expect(payouts).toHaveLength(2);
    // Addressed to the bettor's own socket, never broadcast to the room code.
    expect(payouts.map((p) => p.to).sort()).toEqual(['spec0', 'spec1']);
    expect(payouts.find((p) => p.to === 'spec0')!.payload).toMatchObject({ returned: 100 });
    expect(payouts.find((p) => p.to === 'spec1')!.payload).toMatchObject({ returned: 0 });
  });

  it('clears the book once it has been settled', () => {
    const { room } = table();
    room.placeSpectatorBet('spec0', 'Ava', 'p1', 50);
    bets(room).settleBets('p1');
    expect(bets(room).betting.bets).toHaveLength(0);
    expect(bets(room).betting.open).toBe(true);
  });

  it('hands stakes back when the frame had no winner', () => {
    const { room, sent } = table();
    room.placeSpectatorBet('spec0', 'Ava', 'p1', 50);
    sent.length = 0;
    bets(room).settleBets(null);
    expect(sent.find((m) => m.event === 'betSettled')!.payload).toMatchObject({ returned: 50 });
  });

  it('settles nothing when nobody bet', () => {
    const { room, sent } = table();
    sent.length = 0;
    bets(room).settleBets('p1');
    expect(sent.filter((m) => m.event === 'betSettled')).toHaveLength(0);
  });
});

describe('handicaps', () => {
  it('seeds a seat with the tokens its handicap gives it', () => {
    const r = room();
    r.updateLobby({ handicaps: { p1: { spots: 2, shotClockSeconds: null } } });
    r.addBot('p1', 'club');
    r.addBot('p2', 'club');
    r.startGame();
    expect(r.gameState.players.p1.spotsLeft).toBe(2);
    expect(r.gameState.players.p2.spotsLeft).toBe(0);
  });

  it('spends one token and hands over a free ball in hand', () => {
    const r = room();
    r.updateLobby({ handicaps: { p1: { spots: 1, shotClockSeconds: null } } });
    r.addBot('p1', 'club');
    r.addBot('p2', 'club');
    r.startGame();
    r.gameState.currentShooter = 'p1';
    r.gameState.phase = 'aiming';

    r.useSpot('p1');
    expect(r.gameState.phase).toBe('ball_in_hand');
    expect(r.gameState.players.p1.spotsLeft).toBe(0);
    // A spot is a free placement, not the restricted one a break scratch earns.
    expect(r.gameState.ballInHandBehindLine).toBe(false);
  });

  it('refuses a seat that has none left', () => {
    const r = room();
    r.addBot('p1', 'club');
    r.addBot('p2', 'club');
    r.startGame();
    r.gameState.currentShooter = 'p1';
    r.gameState.phase = 'aiming';
    r.useSpot('p1');
    expect(r.gameState.phase).toBe('aiming');
  });

  it('refuses a seat that is not at the table', () => {
    const r = room();
    r.updateLobby({ handicaps: { p2: { spots: 1, shotClockSeconds: null } } });
    r.addBot('p1', 'club');
    r.addBot('p2', 'club');
    r.startGame();
    r.gameState.currentShooter = 'p1';
    r.gameState.phase = 'aiming';

    r.useSpot('p2');
    expect(r.gameState.phase).toBe('aiming');
    expect(r.gameState.players.p2.spotsLeft).toBe(1);
  });

  it('refills the tokens every frame', () => {
    const r = room();
    r.updateLobby({ handicaps: { p1: { spots: 1, shotClockSeconds: null } } });
    r.addBot('p1', 'club');
    r.addBot('p2', 'club');
    r.startGame();
    r.gameState.currentShooter = 'p1';
    r.gameState.phase = 'aiming';
    r.useSpot('p1');
    expect(r.gameState.players.p1.spotsLeft).toBe(0);

    winFrame(r, 'p2');
    // A spot you didn't need last frame isn't banked, and one you spent isn't held against you.
    expect(r.gameState.players.p1.spotsLeft).toBe(1);
  });
});

describe('speed pool', () => {
  it('starts a clock with the rack and no penalty', () => {
    const r = room();
    r.updateLobby({ mode: 'speed' });
    r.addBot('p1', 'club');
    r.startGame();
    expect(r.gameState.speedRun).not.toBeNull();
    expect(r.gameState.speedRun!.penaltyMs).toBe(0);
    expect(r.gameState.speedRun!.finalMs).toBeNull();
    expect(NO_MODIFIERS.magnetPocket).toBeNull(); // the shared default is untouched
  });
});
