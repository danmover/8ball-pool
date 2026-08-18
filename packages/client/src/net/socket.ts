import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@8ball/shared';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: GameSocket | null = null;

export function getSocket(): GameSocket {
  if (!socket) {
    const url = import.meta.env.DEV ? 'http://localhost:8787' : undefined;
    socket = io(url, { transports: ['websocket', 'polling'] });
  }
  return socket;
}
