import type { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@8ball/shared';
import { Room } from './room.js';
import { generateRoomCode, generateToken } from './roomCode.js';

type IoServer = Server<ClientToServerEvents, ServerToClientEvents>;

export class RoomManager {
  private rooms = new Map<string, Room>();

  createRoom(io: IoServer): Room {
    let code = generateRoomCode();
    while (this.rooms.has(code)) code = generateRoomCode();
    const room = new Room(code, io, generateToken());
    this.rooms.set(code, room);
    return room;
  }

  get(code: string | undefined): Room | undefined {
    if (!code) return undefined;
    return this.rooms.get(code);
  }

  remove(code: string): void {
    this.rooms.get(code)?.destroy();
    this.rooms.delete(code);
  }
}
