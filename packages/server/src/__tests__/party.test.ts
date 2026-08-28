import { describe, expect, it } from 'vitest';
import { NO_MODIFIERS, type Seat, type ShotModifiers, type SimEvent } from '@8ball/shared';
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
