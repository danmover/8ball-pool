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
  isProvisional,
  matchBand,
  tierFor,
  upcomingEvents,
} from '@8ball/shared';
import type { RoomManager } from './roomManager.js';
import type { Room } from './room.js';
import type { PlayerRepository } from './players/repository.js';
import { MatchQueue } from './matchmaking.js';

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

/** Nobody is at twelve tables, and this loops over whatever a caller sent. */
const ALIVE_QUERY_MAX = 12;

/**
 * Of these codes, which are still tables.
 *
 * Answers the "you are still at table X" strip, which cannot work this out for itself: it used
 * to compare a stored timestamp against its own copy of the empty-room window, and that window
 * only starts running once the socket drops. Walking to another screen in the same tab never
 * drops it, so the client wrote off rooms that were sitting right here.
 *
 * Says nothing but existence — not who is seated, not what is being played, not whether the
 * asker belongs there. A code is four characters, so a richer answer would make this a lookup
 * service for other people's tables.
 */
export function aliveCodes(rooms: RoomManager, codes: unknown): string[] {
  if (!Array.isArray(codes)) return [];
  return codes
    .slice(0, ALIVE_QUERY_MAX)
    .filter((code): code is string => typeof code === 'string')
    .filter((code) => rooms.get(code.toUpperCase()) !== undefined);
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
  // Ranked only ever on a straight 1v1. A rating is a statement about one player against one
  // other, and a four-way frame cannot honestly be read as that.
  room.ranked = payload.ranked === true && payload.seats === 2 && mode !== 'teams';
  // A tournament seats its entrants rather than its players — the bracket decides who is at the
  // table for each match, exactly as it does for a party knockout.
  room.isTournament = payload.tournament === true && payload.seats >= 4;

  // Applied directly rather than through `updateLobby`, which refuses to run on an open table
  // by design — these are the settings being fixed, not a later change to them.
  room.lobby.mode = mode;
  room.lobby.ruleSet = ruleSet;
  room.lobby.seriesTarget = Math.max(1, Math.min(9, Math.round(payload.seriesTarget || 1)));
  room.lobby.maxPlayers = room.isTournament
    ? Math.max(4, Math.min(MAX_SEATS, payload.seats))
    : clampPlayerCount(mode, Math.max(2, Math.min(MAX_SEATS, payload.seats)));
  if (room.isTournament) {
    room.tournamentTarget = Math.max(1, Math.min(9, Math.round(payload.seriesTarget || 1)));
    // Entrants, not match seats: eight-ball seats two per match however many are in the draw.
    room.setTournamentEntrants(room.lobby.maxPlayers);
  }
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

/**
 * Attaches this socket's identity to the seat it just took, and keeps the table's average
 * rating current for the public list.
 *
 * Also installs the hook that writes a ranked result. It goes on the Room rather than being
 * called from the socket layer because the frame result exists in exactly one place — inside
 * the loop that refereed it — and that is precisely what makes the rating worth having.
 */
function bindPlayer(room: Room, seat: string, socket: IoSocket, players: PlayerRepository): void {
  const token = socket.data.playerToken as string | undefined;
  if (token) room.playerTokens.set(seat, token);

  const seated = room
    .seats()
    .map((s) => room.playerTokens.get(s))
    .filter((t): t is string => Boolean(t))
    .map((t) => players.get(t).rating);
  room.averageRating =
    seated.length > 0 ? Math.round(seated.reduce((a, b) => a + b, 0) / seated.length) : null;

  if (!room.onRankedResult) {
    room.onRankedResult = (winner, loser) => {
      const before = { w: players.get(winner.token).rating, l: players.get(loser.token).rating };
      const after = players.recordFrame(winner.token, loser.token, {
        winner: winner.name,
        loser: loser.name,
      });

      // Told to each player privately: your rating is yours, and a table-wide broadcast would
      // put it in front of spectators who have no business with it.
      const tell = (
        seat: string,
        record: { rating: number; frames: number; wins: number; losses: number },
        was: number
      ): void => {
        const socketId = room.connections.get(seat)?.socketId;
        if (!socketId) return;
        room.io.to(socketId).emit('ratingChanged', {
          rating: record.rating,
          delta: record.rating - was,
          frames: record.frames,
          provisional: isProvisional(record),
          tier: tierFor(record.rating),
        });
      };
      tell(winner.seat, after.winner, before.w);
      tell(loser.seat, after.loser, before.l);
    };
  }
}

/** How often the queue is swept for pairs. Fast enough to feel instant, cheap enough to ignore. */
const MATCH_TICK_MS = 1000;

/** How often the calendar is checked. Minutes matter here, not seconds. */
const EVENT_TICK_MS = 20_000;

export function registerOnlineHandlers(
  io: IoServer,
  rooms: RoomManager,
  players: PlayerRepository
): void {
  const queue = new MatchQueue();
  /** The table currently hosting each scheduled event, while its window is open. */
  const eventTables = new Map<string, string>();

  /**
   * Opens and closes the scheduled events.
   *
   * The calendar itself is derived from the date and stored nowhere — see `shared/events.ts` —
   * so this only has to notice when a window opens and make the table for it. A fixed weekly
   * slot is the point: people can plan to be there, which a tournament that starts whenever
   * eight strangers happen to want one never manages.
   */
  const eventTick = setInterval(() => {
    for (const status of upcomingEvents()) {
      const existing = eventTables.get(status.event.id);

      if (status.phase === 'signup' && !existing) {
        const room = createOpenTable(io, rooms, {
          mode: status.event.mode,
          ruleSet: status.event.ruleSet,
          seats: status.event.entrants,
          visibility: 'public',
          seriesTarget: status.event.target,
          tournament: true,
        });
        if (room) {
          room.eventId = status.event.id;
          eventTables.set(status.event.id, room.code);
        }
        continue;
      }

      // Forget the table once the event is over, so next week opens a fresh one rather than
      // pointing everybody at a finished bracket.
      if (status.phase === 'scheduled' && existing) eventTables.delete(status.event.id);
    }
  }, EVENT_TICK_MS);
  eventTick.unref?.();

  /**
   * Sweeps the ranked queue.
   *
   * Pairs are made *before* a table exists, which is the whole reason the queue is not just a
   * room: it lets the rating band decide who meets rather than whoever happened to click at the
   * same moment.
   */
  const tick = setInterval(() => {
    for (const { a, b } of queue.drainPairs()) {
      const room = createOpenTable(io, rooms, {
        mode: a.mode,
        ruleSet: a.ruleSet,
        seats: 2,
        // Private: this table was made for these two, and a third person wandering in from the
        // public list would take a seat one of them is on their way to.
        visibility: 'private',
        seriesTarget: 1,
        ranked: true,
      });
      if (!room) continue;
      io.to(a.id).emit('matchFound', { code: room.code, opponent: b.name, opponentRating: b.rating });
      io.to(b.id).emit('matchFound', { code: room.code, opponent: a.name, opponentRating: a.rating });
    }

    // Tell everyone still waiting how it is going. A search that shows nothing is a search
    // people abandon after eight seconds convinced it is broken.
    const now = Date.now();
    const inQueue = queue.size;
    for (const entry of queue.entries()) {
      const waitedMs = now - entry.joinedAt;
      const band = matchBand(waitedMs);
      io.to(entry.id).emit('matchSearching', {
        waitedMs,
        inQueue,
        // Infinity does not survive JSON; null is how "anyone at all" is said on the wire.
        band: Number.isFinite(band) ? Math.round(band) : null,
      });
    }
  }, MATCH_TICK_MS);
  tick.unref?.();

  io.on('connection', (socket: IoSocket) => {
    socket.on('identify', ({ token, name }, cb) => {
      // The same opaque profile token the profile store uses, so there is one identity rather
      // than two. Held on the socket only; nothing here trusts a rating the client sends.
      const clean = (token ?? '').trim();
      if (!clean) return;
      socket.data.playerToken = clean;
      socket.data.playerName = cleanName(name);
      const record = players.get(clean);
      cb({
        rating: record.rating,
        frames: record.frames,
        provisional: isProvisional(record),
        tier: tierFor(record.rating),
      });
    });

    socket.on('listEvents', (cb) => {
      cb(
        upcomingEvents().map((s) => ({
          id: s.event.id,
          name: s.event.name,
          blurb: s.event.blurb,
          mode: s.event.mode,
          ruleSet: s.event.ruleSet,
          entrants: s.event.entrants,
          phase: s.phase,
          opensAt: s.opensAt,
          startsAt: s.startsAt,
          // The table only exists once sign-ups open; before that there is nothing to join.
          code: eventTables.get(s.event.id) ?? null,
        }))
      );
    });

    socket.on('rankedQueue', ({ mode, ruleSet }, cb) => {
      const token = socket.data.playerToken as string | undefined;
      if (!token) {
        // Ranked needs an identity to write the result against; without one there is nothing
        // to move. Said plainly rather than silently doing nothing.
        cb({ ok: false, error: 'Play a frame first to get a ranked profile' });
        return;
      }
      const record = players.get(token);
      queue.add({
        id: socket.id,
        token,
        name: (socket.data.playerName as string) ?? record.name,
        rating: record.rating,
        mode: mode && isOnlineMode(mode) ? mode : 'classic',
        ruleSet: ruleSet && RULE_SETS[ruleSet] ? ruleSet : 'casual',
        joinedAt: Date.now(),
      });
      cb({ ok: true });
    });

    socket.on('rankedCancel', () => queue.remove(socket.id));

    socket.on('disconnect', () => queue.remove(socket.id));

    socket.on('leaderboard', (cb) => {
      cb(
        players.leaderboard(50).map((r) => ({
          name: r.name,
          rating: r.rating,
          frames: r.frames,
          wins: r.wins,
          losses: r.losses,
        }))
      );
    });
    socket.on('listTables', (cb) => {
      cb(publicTables(rooms));
    });

    /*
     * Answers the resume strip: of these codes, which are still tables?
     *
     * Deliberately says nothing else — not who is at them, not what is being played, not
     * whether the asker belongs there. Existence is the one bit the strip needs, and it is
     * the one bit that leaks nothing: a code is four characters, so anything richer would be
     * a lookup service for tables you are not at.
     */
    socket.on('tablesAlive', (payload, cb) => {
      if (typeof cb !== 'function') return;
      cb(aliveCodes(rooms, payload?.codes));
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
          bindPlayer(room, seat, socket, players);
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
      bindPlayer(room, seat, socket, players);
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
