import type { WebSocket } from 'ws';
import {
  HOST_GRACE_MS,
  MAX_CLIENTS,
  RateLimiter,
  cleanMeta,
  generateCode,
  generateKey,
  isValidPeer,
  normalizeCode,
  parseHostFrame,
  rankPublicRooms,
  sysFrame,
  wrapClientFrame,
  type PublicRoom,
  type RoomMeta,
} from '@8ball/shared';

/**
 * The relay, for Node.
 *
 * Holds sockets and forwards messages — nothing else. Every routing decision is made by the
 * shared helpers in `@8ball/shared/relay`, which the Cloudflare Worker uses too, so the two
 * backends cannot disagree about who is allowed to say what.
 */

interface Room {
  code: string;
  key: string;
  host: WebSocket | null;
  clients: Map<string, { ws: WebSocket; limiter: RateLimiter }>;
  meta: RoomMeta | null;
  metaAt: number;
  closeTimer: ReturnType<typeof setTimeout> | null;
}

const OPEN = 1;

function send(ws: WebSocket | null | undefined, text: string): void {
  if (ws && ws.readyState === OPEN) ws.send(text);
}

export class NodeRelay {
  private rooms = new Map<string, Room>();

  get size(): number {
    return this.rooms.size;
  }

  exists(code: string): boolean {
    return this.rooms.has(code);
  }

  publicRooms(now = Date.now()): PublicRoom[] {
    const list: PublicRoom[] = [];
    for (const room of this.rooms.values()) {
      if (room.meta && room.host) list.push({ ...room.meta, updatedAt: room.metaAt });
    }
    return rankPublicRooms(list, now);
  }

  /** A host connecting: a new room, or its old one back. */
  attachHost(ws: WebSocket, rawCode: string | null, rawKey: string | null): void {
    const code = rawCode ? normalizeCode(rawCode) : null;
    let room = code ? this.rooms.get(code) : undefined;

    if (room) {
      if (room.key !== rawKey) {
        ws.close(4003, 'bad-key');
        return;
      }
      if (room.host && room.host !== ws) room.host.close(4001, 'replaced');
    } else if (code && rawKey) {
      // The relay restarted under a live game: let the host put its room back where it was, so
      // the players' links still work.
      room = this.createRoom(code, rawKey);
    } else {
      let fresh = generateCode();
      for (let i = 0; i < 20 && this.rooms.has(fresh); i++) fresh = generateCode();
      if (this.rooms.has(fresh)) {
        ws.close(4009, 'busy');
        return;
      }
      room = this.createRoom(fresh, generateKey());
    }

    const wasAway = room.host === null;
    room.host = ws;
    if (room.closeTimer) clearTimeout(room.closeTimer);
    room.closeTimer = null;
    send(ws, sysFrame.ready(room.code, room.key));
    for (const peer of room.clients.keys()) send(ws, sysFrame.join(peer));
    if (wasAway) for (const c of room.clients.values()) send(c.ws, sysFrame.hostBack());

    const current = room;
    ws.on('message', (data) => this.fromHost(current, ws, data.toString()));
    ws.on('close', () => this.hostGone(current, ws));
    ws.on('error', () => ws.close());
  }

  attachClient(ws: WebSocket, rawCode: string | null, peer: string | null): void {
    const code = normalizeCode(rawCode);
    const room = code ? this.rooms.get(code) : undefined;
    if (!room) {
      ws.close(4004, 'no-room');
      return;
    }
    if (!isValidPeer(peer)) {
      ws.close(4002, 'bad-peer');
      return;
    }
    const existing = room.clients.get(peer);
    if (!existing && room.clients.size >= MAX_CLIENTS) {
      ws.close(4005, 'full');
      return;
    }
    if (existing && existing.ws !== ws) existing.ws.close(4001, 'replaced');
    const entry = { ws, limiter: new RateLimiter() };
    room.clients.set(peer, entry);
    send(room.host, sysFrame.join(peer));
    if (!room.host) send(ws, sysFrame.hostAway());

    ws.on('message', (data) => {
      if (!entry.limiter.take()) {
        ws.close(4008, 'rate');
        return;
      }
      const framed = wrapClientFrame(peer, data.toString());
      if (framed) send(room.host, framed);
    });
    ws.on('close', () => {
      if (room.clients.get(peer)?.ws !== ws) return;
      room.clients.delete(peer);
      send(room.host, sysFrame.leave(peer));
    });
    ws.on('error', () => ws.close());
  }

  private createRoom(code: string, key: string): Room {
    const room: Room = { code, key, host: null, clients: new Map(), meta: null, metaAt: 0, closeTimer: null };
    this.rooms.set(code, room);
    return room;
  }

  private fromHost(room: Room, ws: WebSocket, text: string): void {
    if (room.host !== ws) return;
    const frame = parseHostFrame(text);
    switch (frame.kind) {
      case 'send':
        if (frame.to === '*') for (const c of room.clients.values()) send(c.ws, frame.payload);
        else send(room.clients.get(frame.to)?.ws, frame.payload);
        return;
      case 'meta': {
        const meta = cleanMeta(frame.meta, room.code);
        room.meta = meta?.public ? meta : null;
        room.metaAt = Date.now();
        return;
      }
      case 'kick': {
        const c = room.clients.get(frame.peer);
        if (c) {
          room.clients.delete(frame.peer);
          c.ws.close(4010, 'kicked');
        }
        return;
      }
    }
  }

  private hostGone(room: Room, ws: WebSocket): void {
    if (room.host !== ws) return;
    room.host = null;
    for (const c of room.clients.values()) send(c.ws, sysFrame.hostAway());
    room.closeTimer = setTimeout(() => this.closeRoom(room.code, 'host-left'), HOST_GRACE_MS);
    room.closeTimer.unref?.();
  }

  closeRoom(code: string, reason: string): void {
    const room = this.rooms.get(code);
    if (!room) return;
    if (room.closeTimer) clearTimeout(room.closeTimer);
    for (const c of room.clients.values()) {
      send(c.ws, sysFrame.closed(reason));
      c.ws.close(4000, reason);
    }
    room.host?.close(4000, reason);
    this.rooms.delete(code);
  }

  destroy(): void {
    for (const code of [...this.rooms.keys()]) this.closeRoom(code, 'shutdown');
  }
}
