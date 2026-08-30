import { describe, expect, it, vi } from 'vitest';
import type { Seat } from '@8ball/shared';
import { Room } from '../room.js';
import { RoomManager } from '../roomManager.js';
import { registerSocketHandlers } from '../socketHandlers.js';

/**
 * Nobody may play somebody else's shot.
 *
 * This was open for the whole life of the project: `takeShot` took the seat straight from the
 * payload and only checked whose turn it was, so any socket in the room could shoot for anyone.
 * Between friends round one television it never mattered. On an open table with a stranger it
 * means playing your opponent's shots for them, so it is pinned here rather than left to a
 * comment.
 */

/** A fake socket.io server that hands back the handlers each socket registered. */
function harness(): {
  rooms: RoomManager;
  connect: () => { id: string; emit: (event: string, ...args: unknown[]) => void; data: Record<string, unknown> };
} {
  const connections: ((socket: unknown) => void)[] = [];
  const chain = { emit: () => chain, to: () => chain };
  const io = {
    on: (event: string, fn: (socket: unknown) => void) => {
      if (event === 'connection') connections.push(fn);
    },
    to: () => chain,
    emit: () => chain,
  };
  const rooms = new RoomManager();
  registerSocketHandlers(io as never, rooms);

  let nextId = 0;
  const connect = () => {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const socket = {
      id: `sock-${nextId++}`,
      data: {} as Record<string, unknown>,
      on: (event: string, fn: (...args: unknown[]) => void) => handlers.set(event, fn),
      join: () => {},
      leave: () => {},
      emit: (event: string, ...args: unknown[]) => handlers.get(event)?.(...args),
    };
    for (const fn of connections) fn(socket);
    return socket;
  };
  return { rooms, connect };
}

/** A started two-seat room where `sock` holds p1 and somebody else holds p2. */
function seated(): {
  room: Room;
  mine: ReturnType<ReturnType<typeof harness>['connect']>;
  theirs: ReturnType<ReturnType<typeof harness>['connect']>;
  rooms: RoomManager;
} {
  const { rooms, connect } = harness();
  const mine = connect();
  const theirs = connect();

  const room = rooms.createRoom({ to: () => ({ emit: () => {} }), emit: () => {} } as never);
  mine.data.roomCode = room.code;
  theirs.data.roomCode = room.code;

  room.claimSeat('p1', 'Ava', mine.id, false);
  room.claimSeat('p2', 'Ben', theirs.id, false);
  room.startGame();
  room.gameState.currentShooter = 'p1';
  room.gameState.phase = 'aiming';
  return { room, mine, theirs, rooms };
}

const shot = (seat: Seat) => ({ seat, angle: 0, power: 0.5, spin: { x: 0, y: 0 } });

describe('taking a shot', () => {
  it('lets you shoot from the seat you hold', () => {
    const { room, mine } = seated();
    const spy = vi.spyOn(room, 'handleShoot');
    mine.emit('takeShot', shot('p1'));
    expect(spy).toHaveBeenCalled();
  });

  it('refuses a shot claimed for somebody else', () => {
    const { room, theirs } = seated();
    const spy = vi.spyOn(room, 'handleShoot');
    // p2's socket claiming to be p1, on p1's turn. The old code ran this.
    theirs.emit('takeShot', shot('p1'));
    expect(spy).not.toHaveBeenCalled();
  });

  it('refuses a shot from a spectator, who holds no seat at all', () => {
    const { room, mine } = seated();
    // Same room, but this socket never claimed a seat — a spectator, or anyone who found the
    // code. It must not be able to shoot for either player.
    const watcher = { ...mine };
    room.addSpectator('sock-watcher');

    const spy = vi.spyOn(room, 'handleShoot');
    room.connections.get('p1')!.socketId = 'somebody-else';
    watcher.emit('takeShot', shot('p1'));
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('aiming and placing', () => {
  it('refuses an aim update for a seat you do not hold', () => {
    const { room, theirs } = seated();
    const spy = vi.spyOn(room, 'handleAim');
    theirs.emit('updateAim', { seat: 'p1', angle: 1, spin: { x: 0, y: 0 } });
    expect(spy).not.toHaveBeenCalled();
  });

  it('lets you aim from your own seat', () => {
    const { room, mine } = seated();
    const spy = vi.spyOn(room, 'handleAim');
    mine.emit('updateAim', { seat: 'p1', angle: 1, spin: { x: 0, y: 0 } });
    expect(spy).toHaveBeenCalled();
  });

  it('refuses a cue-ball placement for a seat you do not hold', () => {
    const { room, theirs } = seated();
    const spy = vi.spyOn(room, 'handlePlaceCueBall');
    theirs.emit('placeCueBall', { seat: 'p1', pos: { x: 400, y: 300 } });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('a host holding several seats', () => {
  it('may play any seat it actually holds', () => {
    // Hotseat and pass-and-play are real: the test is ownership of that seat, not a single
    // stored seat per socket.
    const { rooms, connect } = harness();
    const host = connect();
    const room = rooms.createRoom({ to: () => ({ emit: () => {} }), emit: () => {} } as never);
    host.data.roomCode = room.code;
    room.hostSocketId = host.id;
    room.claimSeat('p1', 'Host', host.id, true);
    room.claimSeat('p2', 'Host 2', host.id, true);
    room.startGame();
    room.gameState.phase = 'aiming';

    const spy = vi.spyOn(room, 'handleShoot');
    room.gameState.currentShooter = 'p1';
    host.emit('takeShot', shot('p1'));
    room.gameState.currentShooter = 'p2';
    host.emit('takeShot', shot('p2'));
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
