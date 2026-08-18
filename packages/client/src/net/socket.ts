import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@8ball/shared';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: GameSocket | null = null;

export function getSocket(): GameSocket {
  if (!socket) {
    // In dev, the Vite server and the game server run on different ports; reuse whatever
    // host the page was loaded from (not a hardcoded "localhost") so this also works when
    // a phone on the same network opens the dev client via the machine's LAN IP.
    const url = import.meta.env.DEV ? `http://${window.location.hostname}:8787` : undefined;
    socket = io(url, { transports: ['websocket', 'polling'] });
  }
  return socket;
}
