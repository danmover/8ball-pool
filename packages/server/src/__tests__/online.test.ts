import { afterEach, describe, expect, it, vi } from 'vitest';
import { ABANDON_GRACE_MS } from '@8ball/shared';
import { Room } from '../room.js';
import { EMPTY_ROOM_TTL_MS, RoomManager } from '../roomManager.js';
import { bestWaitingTable, createOpenTable, publicTables } from '../onlineHandlers.js';

/**
 * Open tables have no host, which is exactly what makes them worth testing carefully: there is
 * nobody to notice something has gone wrong and press a button.
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

const managers: RoomManager[] = [];
function manager(): { rooms: RoomManager; io: never; sent: ReturnType<typeof recordingIo>['sent'] } {
  const { io, sent } = recordingIo();
  const rooms = new RoomManager();
  managers.push(rooms);
  return { rooms, io, sent };
}

afterEach(() => {
  for (const m of managers.splice(0)) m.destroy();
  vi.useRealTimers();
});

const table = (rooms: RoomManager, io: never, over: Partial<Parameters<typeof createOpenTable>[2]> = {}) =>
  createOpenTable(io, rooms, {
    mode: 'classic',
    ruleSet: 'casual',
    seats: 2,
    visibility: 'public',
    seriesTarget: 1,
    ...over,
  })!;

describe('creating an open table', () => {
  it('has no host and cannot be configured by anyone', () => {
    const { rooms, io } = manager();
    const room = table(rooms, io);
    expect(room.governance).toBe('open');
    expect(room.canConfigure('anyone')).toBe(false);
    expect(room.canConfigure(room.hostSocketId ?? '')).toBe(false);
  });

  it('fixes its settings at creation', () => {
    const { rooms, io } = manager();
    const room = table(rooms, io, { ruleSet: 'tournament', seriesTarget: 3 });
    expect(room.lobby.ruleSet).toBe('tournament');

    // The party path must refuse: nobody at an open table has standing to change the rules on
    // everyone else half way through.
    room.updateLobby({ ruleSet: 'casual', mode: 'nineball', seriesTarget: 9 });
    expect(room.lobby.ruleSet).toBe('tournament');
    expect(room.lobby.mode).toBe('classic');
    expect(room.lobby.seriesTarget).toBe(3);
  });

  it('refuses the solo formats, which make no sense with a stranger', () => {
    const { rooms, io } = manager();
    for (const mode of ['ghost', 'speed', 'sandbox', 'challenge'] as const) {
      expect(table(rooms, io, { mode }).lobby.mode).toBe('classic');
    }
  });

  it('clamps the seat count to what the mode can seat', () => {
    const { rooms, io } = manager();
    // Eight-ball is strictly 1v1 however many seats were asked for.
    expect(table(rooms, io, { seats: 8 }).lobby.maxPlayers).toBe(2);
    // Teams need an even split to alternate around the table.
    expect(table(rooms, io, { mode: 'teams', seats: 3 }).lobby.maxPlayers % 2).toBe(0);
  });
});

describe('the public list', () => {
  it('shows only public open tables', () => {
    const { rooms, io } = manager();
    table(rooms, io);
    table(rooms, io, { visibility: 'private' });
    rooms.createRoom(io); // a party room

    const listed = publicTables(rooms);
    expect(listed).toHaveLength(1);
  });

  it('puts tables you can sit at above games already running', () => {
    const { rooms, io } = manager();
    const playing = table(rooms, io);
    playing.addBot('p1', 'club');
    playing.addBot('p2', 'club');
    playing.startGame();
    const waiting = table(rooms, io);

    expect(publicTables(rooms)[0].code).toBe(waiting.code);
  });

  it('reports seats honestly', () => {
    const { rooms, io } = manager();
    const room = table(rooms, io);
    room.addBot('p1', 'club');
    const [summary] = publicTables(rooms);
    expect(summary.seatsFilled).toBe(1);
    expect(summary.seatsTotal).toBe(2);
    expect(summary.inPlay).toBe(false);
  });
});

describe('quick play', () => {
  it('prefers the table closest to filling up', () => {
    // Otherwise people spread one-per-table across a dozen half-empty ones and nothing starts.
    const { rooms, io } = manager();
    const empty = table(rooms, io, { seats: 4, mode: 'cutthroat' });
    const nearlyFull = table(rooms, io, { seats: 4, mode: 'cutthroat' });
    nearlyFull.addBot('p1', 'club');
    nearlyFull.addBot('p2', 'club');
    nearlyFull.addBot('p3', 'club');
    empty.addBot('p1', 'club');

    expect(bestWaitingTable(rooms)?.code).toBe(nearlyFull.code);
  });

  it('ignores tables already in play', () => {
    const { rooms, io } = manager();
    const room = table(rooms, io);
    room.addBot('p1', 'club');
    room.startGame();
    expect(bestWaitingTable(rooms)).toBeNull();
  });

  it('ignores an empty table, which is nobody to play', () => {
    const { rooms, io } = manager();
    table(rooms, io);
    expect(bestWaitingTable(rooms)).toBeNull();
  });

  it('respects a requested mode', () => {
    const { rooms, io } = manager();
    const nine = table(rooms, io, { mode: 'nineball' });
    nine.addBot('p1', 'club');
    const eight = table(rooms, io, { mode: 'classic' });
    eight.addBot('p1', 'club');

    expect(bestWaitingTable(rooms, 'nineball')?.code).toBe(nine.code);
    expect(bestWaitingTable(rooms, 'rotation')).toBeNull();
  });
});

describe('starting without a host', () => {
  it('starts itself when the last seat fills', () => {
    const { rooms, io } = manager();
    const room = table(rooms, io);
    room.addBot('p1', 'club');
    room.maybeAutoStart();
    expect(room.started).toBe(false);

    room.addBot('p2', 'club');
    room.maybeAutoStart();
    expect(room.started).toBe(true);
  });

  it('waits for a full table rather than deciding for everyone', () => {
    // On an open table nobody has the standing to say four is enough for a six-seat game.
    const { rooms, io } = manager();
    const room = table(rooms, io, { mode: 'cutthroat', seats: 4 });
    room.addBot('p1', 'club');
    room.addBot('p2', 'club');
    room.addBot('p3', 'club');
    room.maybeAutoStart();
    expect(room.started).toBe(false);
  });

  it('leaves party rooms alone', () => {
    const { rooms, io } = manager();
    const party = rooms.createRoom(io);
    party.addBot('p1', 'club');
    party.addBot('p2', 'club');
    party.maybeAutoStart();
    expect(party.started).toBe(false);
  });
});

describe('abandonment', () => {
  it('starts a countdown when a seat drops, and says so to the whole table', () => {
    vi.useFakeTimers();
    const { rooms, io, sent } = manager();
    const room = table(rooms, io);
    room.claimSeat('p1', 'Ava', 'sock-a', false);
    room.claimSeat('p2', 'Ben', 'sock-b', false);
    room.startGame();
    sent.length = 0;

    room.disconnectSocket('sock-b');
    const notice = sent.find((m) => m.event === 'seatDisconnected');
    expect(notice).toBeDefined();
    expect(notice!.payload).toMatchObject({ seat: 'p2', name: 'Ben' });
  });

  it('forfeits the frame to whoever stayed when the countdown runs out', () => {
    vi.useFakeTimers();
    const { rooms, io } = manager();
    const room = table(rooms, io);
    room.claimSeat('p1', 'Ava', 'sock-a', false);
    room.claimSeat('p2', 'Ben', 'sock-b', false);
    room.startGame();

    room.disconnectSocket('sock-b');
    expect(room.gameState.phase).not.toBe('game_over');

    vi.advanceTimersByTime(ABANDON_GRACE_MS + 100);
    expect(room.gameState.phase).toBe('game_over');
    expect(room.gameState.winner).toBe('p1');
  });

  it('cancels the countdown when they make it back', () => {
    vi.useFakeTimers();
    const { rooms, io, sent } = manager();
    const room = table(rooms, io);
    room.claimSeat('p1', 'Ava', 'sock-a', false);
    room.claimSeat('p2', 'Ben', 'sock-b', false);
    room.startGame();

    room.disconnectSocket('sock-b');
    room.reconnectSeat('p2', 'sock-b2');
    expect(sent.some((m) => m.event === 'seatReconnected')).toBe(true);

    vi.advanceTimersByTime(ABANDON_GRACE_MS + 100);
    expect(room.gameState.phase).not.toBe('game_over');
  });

  it('plays on with the rest when a bigger table loses one player', () => {
    // Knocking a four-player game over because one person went into a tunnel would punish the
    // three who are still here.
    vi.useFakeTimers();
    const { rooms, io } = manager();
    const room = table(rooms, io, { mode: 'cutthroat', seats: 4 });
    for (const [seat, name] of [['p1', 'A'], ['p2', 'B'], ['p3', 'C'], ['p4', 'D']] as const) {
      room.claimSeat(seat, name, `sock-${seat}`, false);
    }
    room.startGame();

    room.disconnectSocket('sock-p3');
    vi.advanceTimersByTime(ABANDON_GRACE_MS + 100);

    expect(room.gameState.phase).not.toBe('game_over');
    expect(room.gameState.players.p3.eliminated).toBe(true);
  });

  it('frees a seat held by somebody who left before the game started', () => {
    // Found by running it for real: without this, somebody who joins a public table and closes
    // the tab holds a chair for ever. The table fills with ghosts, never starts, and quick play
    // keeps sending people into it.
    vi.useFakeTimers();
    const { rooms, io } = manager();
    const room = table(rooms, io);
    room.claimSeat('p1', 'Ava', 'sock-a', false);
    expect(room.filledSeats()).toBe(1);

    room.disconnectSocket('sock-a');
    vi.advanceTimersByTime(ABANDON_GRACE_MS + 100);

    expect(room.filledSeats()).toBe(0);
    expect(room.started).toBe(false);
  });

  it('keeps the seat for somebody who reloads before the game starts', () => {
    vi.useFakeTimers();
    const { rooms, io } = manager();
    const room = table(rooms, io);
    room.claimSeat('p1', 'Ava', 'sock-a', false);
    room.disconnectSocket('sock-a');
    room.reconnectSeat('p1', 'sock-a2');

    vi.advanceTimersByTime(ABANDON_GRACE_MS + 100);
    expect(room.filledSeats()).toBe(1);
  });

  it('never forfeits a party seat — a phone locking is normal there', () => {
    vi.useFakeTimers();
    const { rooms, io } = manager();
    const room = rooms.createRoom(io);
    room.claimSeat('p1', 'Ava', 'sock-a', false);
    room.claimSeat('p2', 'Ben', 'sock-b', false);
    room.startGame();

    room.disconnectSocket('sock-b');
    vi.advanceTimersByTime(ABANDON_GRACE_MS * 3);
    expect(room.gameState.phase).not.toBe('game_over');
  });

  it('treats leaving on purpose as immediate', () => {
    // No point counting down thirty seconds for someone who has told us they have gone.
    const { rooms, io } = manager();
    const room = table(rooms, io);
    room.claimSeat('p1', 'Ava', 'sock-a', false);
    room.claimSeat('p2', 'Ben', 'sock-b', false);
    room.startGame();

    room.leaveSeat('p2');
    expect(room.gameState.phase).toBe('game_over');
    expect(room.gameState.winner).toBe('p1');
  });
});

describe('reaping empty rooms', () => {
  it('keeps a room somebody is in', () => {
    const { rooms, io } = manager();
    const room = table(rooms, io);
    room.claimSeat('p1', 'Ava', 'sock-a', false);
    expect(rooms.sweep(Date.now() + EMPTY_ROOM_TTL_MS * 2)).toEqual([]);
    expect(rooms.get(room.code)).toBeDefined();
  });

  it('throws away one nobody has been in for a while', () => {
    const { rooms, io } = manager();
    const room = table(rooms, io);
    expect(rooms.sweep(Date.now())).toEqual([]);
    expect(rooms.sweep(Date.now() + EMPTY_ROOM_TTL_MS + 1)).toEqual([room.code]);
    expect(rooms.get(room.code)).toBeUndefined();
  });

  it('does not count bots as occupancy', () => {
    // A room of nothing but bots playing to an empty gallery is exactly what this clears away.
    const { rooms, io } = manager();
    const room = table(rooms, io);
    room.addBot('p1', 'club');
    room.addBot('p2', 'club');
    expect(room.isOccupied()).toBe(false);
    expect(rooms.sweep(Date.now() + EMPTY_ROOM_TTL_MS + 1)).toEqual([room.code]);
  });

  it('resets the clock when somebody comes back', () => {
    const { rooms, io } = manager();
    const room = table(rooms, io);
    const nearly = Date.now() + EMPTY_ROOM_TTL_MS - 1000;
    rooms.sweep(nearly);

    room.claimSeat('p1', 'Ava', 'sock-a', false);
    rooms.sweep(nearly + 500);
    // Occupied at that point, so the countdown restarts from there rather than expiring.
    room.disconnectSocket('sock-a');
    expect(rooms.sweep(nearly + 1500)).toEqual([]);
  });

  it('counts a spectator as somebody', () => {
    const { rooms, io } = manager();
    const room = table(rooms, io);
    room.addSpectator('watcher');
    expect(rooms.sweep(Date.now() + EMPTY_ROOM_TTL_MS + 1)).toEqual([]);
  });
});
