import type { Server, Socket } from 'socket.io';
import {
  MAX_SEATS,
  RULE_SETS,
  clampPlayerCount,
  modeDescriptor,
  type ClientToServerEvents,
  type CreateTablePayload,
  type GameMode,
  type RuleSetId,
  type ServerToClientEvents,
  type TableSummary,
} from '@8ball/shared';
import type { RoomManager } from './roomManager.js';
import type { Room } from './room.js';

type IoServer = Server<ClientToServerEvents, ServerToClientEvents>;
type IoSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

/**
 * Online tables: no host, joinable by code or from a public list.
 *
 * Kept in its own file rather than added to `socketHandlers.ts` because the two shapes have
 * genuinely different rules. Every handler there begins by asking whether this socket is the
 * host; not one handler here does, because an open table has no host to be. Mixing them would
 * mean every reader having to work out which world each line is in.
 */

/** Solo formats make no sense with a stranger; they are excluded from online tables. */
const SOLO_MODES: GameMode[] = ['ghost', 'speed', 'sandbox', 'challenge'];

/** A cap so one person cannot fill the server with empty tables. */
const MAX_TABLES = 500;

/** Names arrive from strangers now, so they get trimmed and bounded. */
function cleanName(raw: string): string {
  return (raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 18) || 'Player';
}

function isOnlineMode(mode: GameMode): boolean {
  return !SOLO_MODES.includes(mode);
}

/**
 * Sorts the public list.
 *
 * Tables you can actually sit down at come first, then the ones closest to starting, then the
 * freshest. A list whose top row is a full game in progress is a list nobody uses.
 */
function rankTables(a: TableSummary, b: TableSummary): number {
  if (a.inPlay !== b.inPlay) return a.inPlay ? 1 : -1;
  const aFree = a.seatsTotal - a.seatsFilled;
  const bFree = b.seatsTotal - b.seatsFilled;
  if (aFree !== bFree) return aFree - bFree;
  return b.createdAt - a.createdAt;
}

export function publicTables(rooms: RoomManager): TableSummary[] {
  return rooms
    .all()
    .filter((room) => room.governance === 'open' && room.visibility === 'public')
    .map((room) => room.summary())
    .sort(rankTables);
}

/** Builds an open table with settings that are fixed from here on. */
export function createOpenTable(
  io: IoServer,
  rooms: RoomManager,
  payload: CreateTablePayload
): Room | null {
  if (rooms.size >= MAX_TABLES) return null;
  const mode: GameMode = isOnlineMode(payload.mode) ? payload.mode : 'classic';
  const ruleSet: RuleSetId = RULE_SETS[payload.ruleSet] ? payload.ruleSet : 'casual';

  const room = rooms.createRoom(io);
  room.governance = 'open';
  room.visibility = payload.visibility === 'public' ? 'public' : 'private';

  // Applied directly rather than through `updateLobby`, which refuses to run on an open table
  // by design — these are the settings being fixed, not a later change to them.
  room.lobby.mode = mode;
  room.lobby.ruleSet = ruleSet;
  room.lobby.seriesTarget = Math.max(1, Math.min(9, Math.round(payload.seriesTarget || 1)));
  room.lobby.maxPlayers = clampPlayerCount(mode, Math.max(2, Math.min(MAX_SEATS, payload.seats)));
  // Teams alternate around the table and need an even split, same as the party lobby.
  if (mode === 'teams' && room.lobby.maxPlayers % 2 !== 0) {
    room.lobby.maxPlayers = Math.min(MAX_SEATS, room.lobby.maxPlayers + 1);
  }
  if (!modeDescriptor(mode).supportsShotClock) room.lobby.shotClockSeconds = null;
  room.rebuildForLobby();
  return room;
}

/**
 * The table quick play should drop you into.
 *
 * Prefers the one closest to filling up, so people collect into a game instead of spreading
 * themselves one-per-table across a dozen half-empty ones.
 */
export function bestWaitingTable(
  rooms: RoomManager,
  mode?: GameMode,
  ruleSet?: RuleSetId
): Room | null {
  const candidates = rooms
    .all()
    .filter(
      (room) =>
        room.governance === 'open' &&
        room.visibility === 'public' &&
        !room.started &&
        room.filledSeats() > 0 &&
        room.filledSeats() < room.seats().length &&
        (!mode || room.lobby.mode === mode) &&
        (!ruleSet || room.lobby.ruleSet === ruleSet)
    )
    .sort((a, b) => b.filledSeats() - a.filledSeats());
  return candidates[0] ?? null;
}

export function registerOnlineHandlers(io: IoServer, rooms: RoomManager): void {
  io.on('connection', (socket: IoSocket) => {
    socket.on('listTables', (cb) => {
      cb(publicTables(rooms));
    });

    socket.on('createTable', (payload, cb) => {
      const room = createOpenTable(io, rooms, payload);
      if (!room) {
        cb({ ok: false, error: 'The server is full — try again shortly' });
        return;
      }
      cb({ ok: true, code: room.code });
    });

    socket.on('quickPlay', ({ mode, ruleSet }, cb) => {
      const waiting = bestWaitingTable(rooms, mode, ruleSet);
      if (waiting) {
        cb({ ok: true, code: waiting.code });
        return;
      }
      // Nothing to join, so open one and wait in it. A public table with one person in it is
      // what the next person's quick play will find.
      const room = createOpenTable(io, rooms, {
        mode: mode ?? 'classic',
        ruleSet: ruleSet ?? 'casual',
        seats: 2,
        visibility: 'public',
        seriesTarget: 1,
      });
      if (!room) {
        cb({ ok: false, error: 'The server is full — try again shortly' });
        return;
      }
      cb({ ok: true, code: room.code });
    });

    socket.on('joinTable', ({ code, name, loadout, seatToken }, cb) => {
      const room = rooms.get((code ?? '').toUpperCase());
      if (!room) {
        cb({ ok: false, error: 'No table with that code' });
        return;
      }
      if (room.governance !== 'open') {
        // A party room needs a host screen to render the table; joining it this way would give
        // you a seat at a game with nothing to look at.
        cb({ ok: false, error: 'That is a party table — join it from a phone instead' });
        return;
      }

      socket.data.roomCode = room.code;
      socket.join(room.code);

      // Coming back to a seat we already hold. Checked before looking for a free one, so a
      // refresh returns you to your own seat rather than handing you whatever is spare.
      if (seatToken) {
        const seat = room.findSeatByToken(seatToken);
        if (seat) {
          room.reconnectSeat(seat, socket.id);
          if (loadout) room.setLoadout(seat, loadout);
          socket.data.seat = seat;
          cb({ ok: true, seat, seatToken, spectating: false });
          room.broadcastRoomState();
          room.broadcastGameState();
          return;
        }
      }

      const seat = room.openSeat();
      if (!seat || room.started) {
        room.addSpectator(socket.id);
        cb({ ok: true, seat: null, seatToken: null, spectating: true });
        room.broadcastGameState();
        return;
      }

      const { token } = room.claimSeat(seat, cleanName(name), socket.id, false, loadout);
      socket.data.seat = seat;
      cb({ ok: true, seat, seatToken: token, spectating: false });
      room.broadcastRoomState();
      room.broadcastGameState();
      // Filling the last seat is what starts an open table; nobody presses anything.
      room.maybeAutoStart();
    });

    socket.on('leaveTable', () => {
      const room = rooms.get(socket.data.roomCode);
      if (!room) return;
      const seat = socket.data.seat as string | undefined;
      // Leaving on purpose is not the same as dropping off the network: there is no point
      // counting down thirty seconds for somebody who has told us they have gone.
      if (seat && room.connections.get(seat)?.socketId === socket.id) {
        room.leaveSeat(seat);
      } else {
        room.disconnectSocket(socket.id);
      }
      socket.leave(room.code);
      socket.data.roomCode = undefined;
      socket.data.seat = undefined;
    });
  });
}
