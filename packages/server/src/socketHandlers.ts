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

    socket.on('joinRoom', ({ code, name, token }, cb) => {
      const room = rooms.get(code.toUpperCase());
      if (!room) {
        cb({ ok: false, error: 'Room not found' });
        return;
      }

      if (token) {
        const seat = room.findSeatByToken(token);
        if (seat) {
          room.reconnectSeat(seat, socket.id);
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
        room.spectatorSocketIds.add(socket.id);
        socket.data.roomCode = room.code;
        socket.join(room.code);
        cb({ ok: false, error: 'Both seats are taken — you joined as a spectator' });
        room.broadcastRoomState();
        return;
      }

      const { token: newToken } = room.claimSeat(seat, name || `Player ${seat === 'p1' ? 1 : 2}`, socket.id, false);
      socket.data.roomCode = room.code;
      socket.data.seat = seat;
      socket.join(room.code);
      cb({ ok: true, seat, token: newToken });
      room.broadcastRoomState();
      room.broadcastGameState();
    });

    socket.on('hostClaimSeat', ({ seat }) => {
      const room = rooms.get(socket.data.roomCode);
      if (!room || room.hostSocketId !== socket.id || room.connections[seat]) return;
      room.claimSeat(seat, 'Host', socket.id, true);
      room.broadcastRoomState();
      room.broadcastGameState();
    });

    socket.on('hostReleaseSeat', ({ seat }) => {
      const room = rooms.get(socket.data.roomCode);
      if (!room || room.hostSocketId !== socket.id) return;
      if (room.connections[seat]?.socketId !== socket.id) return;
      room.connections[seat] = null;
      room.gameState.players[seat].connected = false;
      room.gameState.players[seat].isHost = false;
      room.broadcastRoomState();
      room.broadcastGameState();
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
      const conn = seat ? room?.connections[seat] : undefined;
      if (conn) Object.assign(conn.settings, settings);
    });

    socket.on('requestRematch', () => {
      rooms.get(socket.data.roomCode)?.requestRematch();
    });

    socket.on('disconnect', () => {
      rooms.get(socket.data.roomCode)?.disconnectSocket(socket.id);
    });
  });
}
