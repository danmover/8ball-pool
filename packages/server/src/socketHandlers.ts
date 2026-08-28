import type { Server, Socket } from 'socket.io';
import type { ClientToServerEvents, Seat, ServerToClientEvents } from '@8ball/shared';
import { RoomManager } from './roomManager.js';

type IoServer = Server<ClientToServerEvents, ServerToClientEvents>;
type IoSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

export function registerSocketHandlers(io: IoServer, rooms: RoomManager): void {
  io.on('connection', (socket: IoSocket) => {
    socket.on('hostCreateRoom', (_payload, cb) => {
      const room = rooms.createRoom(io);
      room.hostSocketId = socket.id;
      socket.data.roomCode = room.code;
      socket.join(room.code);
      cb({ code: room.code, token: room.hostToken });
      room.broadcastRoomState();
    });

    socket.on('hostRejoin', ({ code, token }, cb) => {
      const room = rooms.get(code);
      if (!room || room.hostToken !== token) {
        cb({ ok: false });
        return;
      }
      room.hostSocketId = socket.id;
      socket.data.roomCode = code;
      socket.join(code);
      cb({ ok: true });
      room.broadcastRoomState();
      room.broadcastGameState();
    });

    socket.on('joinRoom', ({ code, name, token, loadout }, cb) => {
      const room = rooms.get(code.toUpperCase());
      if (!room) {
        cb({ ok: false, error: 'Room not found' });
        return;
      }

      if (token) {
        const seat = room.findSeatByToken(token);
        if (seat) {
          room.reconnectSeat(seat, socket.id);
          if (loadout) room.setLoadout(seat, loadout);
          socket.data.roomCode = room.code;
          socket.data.seat = seat;
          socket.join(room.code);
          cb({ ok: true, seat, token });
          room.broadcastRoomState();
          room.broadcastGameState();
          return;
        }
      }

      const seat = room.openSeat();
      if (!seat) {
        // Spectators get the live game state and are queued for the next seat that frees up.
        socket.data.roomCode = room.code;
        socket.join(room.code);
        room.addSpectator(socket.id);
        cb({ ok: false, error: 'Table is full — watching as a spectator' });
        room.broadcastGameState();
        return;
      }

      const { token: newToken } = room.claimSeat(
        seat,
        name || `Player ${seat === 'p1' ? 1 : 2}`,
        socket.id,
        false,
        loadout
      );
      socket.data.roomCode = room.code;
      socket.data.seat = seat;
      socket.join(room.code);
      cb({ ok: true, seat, token: newToken });
      room.broadcastRoomState();
      room.broadcastGameState();
    });

    socket.on('hostClaimSeat', ({ seat, loadout, name }) => {
      const room = rooms.get(socket.data.roomCode);
      if (!room || room.hostSocketId !== socket.id || room.connections.has(seat)) return;
      if (!room.seats().includes(seat)) return;
      const taken = [...room.connections.values()].filter((c) => c.socketId === socket.id).length;
      // The host's profile name, numbered when they're playing more than one seat hotseat.
      const base = (name ?? '').trim() || 'Host';
      room.claimSeat(seat, taken === 0 ? base : `${base} ${taken + 1}`, socket.id, true, loadout);
      room.broadcastRoomState();
      room.broadcastGameState();
    });

    socket.on('setLoadout', ({ loadout }) => {
      const room = rooms.get(socket.data.roomCode);
      if (!room) return;
      // A host holding several seats updates all of them; a phone owns exactly one.
      const seats =
        room.hostSocketId === socket.id
          ? [...room.connections.values()].filter((c) => c.socketId === socket.id).map((c) => c.seat)
          : [socket.data.seat as Seat].filter(Boolean);
      for (const seat of seats) room.setLoadout(seat, loadout);
    });

    socket.on('hostReleaseSeat', ({ seat }) => {
      const room = rooms.get(socket.data.roomCode);
      if (!room || room.hostSocketId !== socket.id) return;
      if (room.connections.get(seat)?.socketId !== socket.id) return;
      room.releaseSeat(seat);
      room.broadcastRoomState();
      room.broadcastGameState();
    });

    socket.on('hostUpdateLobby', (patch) => {
      const room = rooms.get(socket.data.roomCode);
      if (!room || room.hostSocketId !== socket.id) return;
      room.updateLobby(patch);
    });

    socket.on('hostStartGame', () => {
      const room = rooms.get(socket.data.roomCode);
      if (!room || room.hostSocketId !== socket.id) return;
      room.startGame();
    });

    socket.on('hostStartTournament', ({ target, entrants }) => {
      const room = rooms.get(socket.data.roomCode);
      if (!room || room.hostSocketId !== socket.id) return;
      room.startTournament(target, entrants);
    });

    socket.on('hostStartKing', ({ entrants }) => {
      const room = rooms.get(socket.data.roomCode);
      if (!room || room.hostSocketId !== socket.id) return;
      room.startKingOfTable(entrants);
    });

    socket.on('hostReturnToLobby', () => {
      const room = rooms.get(socket.data.roomCode);
      if (!room || room.hostSocketId !== socket.id) return;
      room.returnToLobby();
    });

    socket.on('updateAim', (input) => {
      rooms.get(socket.data.roomCode)?.handleAim(input);
    });

    socket.on('takeShot', (input) => {
      rooms.get(socket.data.roomCode)?.handleShoot(input);
    });

    socket.on('placeCueBall', (payload) => {
      rooms.get(socket.data.roomCode)?.handlePlaceCueBall(payload);
    });

    socket.on('updateSettings', (settings) => {
      const room = rooms.get(socket.data.roomCode);
      const seat = socket.data.seat as Seat | undefined;
      const stored = seat ? room?.seatSettings(seat) : undefined;
      if (stored) Object.assign(stored, settings);
    });

    socket.on('useSpot', ({ seat }) => {
      const room = rooms.get(socket.data.roomCode);
      if (!room) return;
      // The host may hold several seats hotseat, so trust the named seat only when this socket
      // actually owns it.
      if (room.connections.get(seat)?.socketId !== socket.id) return;
      room.useSpot(seat);
    });

    socket.on('requestRematch', () => {
      rooms.get(socket.data.roomCode)?.requestRematch();
    });

    socket.on('hostAddBot', ({ seat, difficulty }) => {
      const room = rooms.get(socket.data.roomCode);
      if (!room || room.hostSocketId !== socket.id) return;
      room.addBot(seat, difficulty);
    });

    socket.on('hostRemoveBot', ({ seat }) => {
      const room = rooms.get(socket.data.roomCode);
      if (!room || room.hostSocketId !== socket.id) return;
      room.removeBot(seat);
    });

    socket.on('hostStartChallenge', ({ challengeId }) => {
      const room = rooms.get(socket.data.roomCode);
      if (!room || room.hostSocketId !== socket.id) return;
      room.startChallenge(challengeId);
    });

    socket.on('sendEmote', ({ emote }) => {
      const room = rooms.get(socket.data.roomCode);
      const seat = socket.data.seat as Seat | undefined;
      if (!room || !seat) return;
      room.handleEmote(seat, emote);
    });

    socket.on('disconnect', () => {
      rooms.get(socket.data.roomCode)?.disconnectSocket(socket.id);
    });
  });
}
