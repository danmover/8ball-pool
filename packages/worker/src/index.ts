import { DurableObject } from 'cloudflare:workers';
import {
  HOST_GRACE_MS,
  MAX_CLIENTS,
  CLIENT_RATE_LIMIT,
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
} from '../../shared/src/relay.js';

/**
 * The game on Cloudflare's free plan.
 *
 * Static files come straight from Workers Assets. Each room is a Durable Object holding the
 * host's and the players' WebSockets and forwarding between them — using the hibernation API,
 * so a room where nobody is doing anything is evicted from memory and costs nothing, and its
 * sockets survive the eviction. Routing is the same shared code the Node relay runs.
 */

interface Env {
  ASSETS: Fetcher;
  ROOMS: DurableObjectNamespace<RoomRelay>;
  DIRECTORY: DurableObjectNamespace<Directory>;
}

interface RoomRecord {
  code: string;
  key: string;
  meta: RoomMeta | null;
}

type Attachment = { role: 'host' } | { role: 'client'; peer: string };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
    },
  });
}

/** Accepts a socket only long enough to close it with a reason the client can read. */
function refuse(code: number, reason: string): Response {
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);
  server.accept();
  server.close(code, reason);
  return new Response(null, { status: 101, webSocket: client });
}

function safeSend(ws: WebSocket, text: string): void {
  try {
    ws.send(text);
  } catch {
    /* socket already gone */
  }
}

export class RoomRelay extends DurableObject<Env> {
  /** Token buckets per client, in memory only — they reset if the room hibernates, which is fine. */
  private buckets = new Map<string, { tokens: number; last: number }>();

  private async record(): Promise<RoomRecord | undefined> {
    return this.ctx.storage.get<RoomRecord>('room');
  }

  private hosts(): WebSocket[] {
    return this.ctx.getWebSockets('host');
  }

  private clients(): WebSocket[] {
    return this.ctx.getWebSockets('client');
  }

  private peerOf(ws: WebSocket): string | null {
    const att = ws.deserializeAttachment() as Attachment | null;
    return att?.role === 'client' ? att.peer : null;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/exists') return json({ exists: Boolean(await this.record()) });
    if (url.pathname === '/host') return this.acceptHost(url);
    if (url.pathname === '/join') return this.acceptClient(url);
    return new Response('Not found', { status: 404 });
  }

  private async acceptHost(url: URL): Promise<Response> {
    const code = url.searchParams.get('code')!;
    const key = url.searchParams.get('key');
    const creating = url.searchParams.get('create') === '1';
    let room = await this.record();

    if (room) {
      if (creating) return new Response('taken', { status: 409 });
      if (room.key !== key) return refuse(4003, 'bad-key');
    } else {
      // A brand-new room, or one the host is putting back after the relay was redeployed.
      room = { code, key: creating || !key ? generateKey() : key, meta: null };
      await this.ctx.storage.put('room', room);
    }

    const wasAway = this.hosts().length === 0;
    for (const old of this.hosts()) old.close(4001, 'replaced');

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, ['host']);
    server.serializeAttachment({ role: 'host' } satisfies Attachment);
    await this.ctx.storage.deleteAlarm();

    safeSend(server, sysFrame.ready(room.code, room.key));
    for (const c of this.clients()) {
      const peer = this.peerOf(c);
      if (peer) safeSend(server, sysFrame.join(peer));
      if (wasAway) safeSend(c, sysFrame.hostBack());
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  private async acceptClient(url: URL): Promise<Response> {
    const room = await this.record();
    if (!room) return refuse(4004, 'no-room');
    const peer = url.searchParams.get('peer');
    if (!isValidPeer(peer)) return refuse(4002, 'bad-peer');

    const existing = this.ctx.getWebSockets(`peer:${peer}`);
    if (existing.length === 0 && this.clients().length >= MAX_CLIENTS) return refuse(4005, 'full');
    for (const old of existing) old.close(4001, 'replaced');

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, ['client', `peer:${peer}`]);
    server.serializeAttachment({ role: 'client', peer } satisfies Attachment);

    const host = this.hosts()[0];
    if (host) safeSend(host, sysFrame.join(peer));
    else safeSend(server, sysFrame.hostAway());
    return new Response(null, { status: 101, webSocket: client });
  }

  private allow(peer: string): boolean {
    const now = Date.now();
    const b = this.buckets.get(peer) ?? { tokens: CLIENT_RATE_LIMIT, last: now };
    b.tokens = Math.min(CLIENT_RATE_LIMIT, b.tokens + ((now - b.last) / 1000) * CLIENT_RATE_LIMIT);
    b.last = now;
    this.buckets.set(peer, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const text = typeof message === 'string' ? message : new TextDecoder().decode(message);
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att) return;

    if (att.role === 'client') {
      if (!this.allow(att.peer)) {
        ws.close(4008, 'rate');
        return;
      }
      const framed = wrapClientFrame(att.peer, text);
      const host = this.hosts()[0];
      if (framed && host) safeSend(host, framed);
      return;
    }

    const frame = parseHostFrame(text);
    if (frame.kind === 'send') {
      const targets = frame.to === '*' ? this.clients() : this.ctx.getWebSockets(`peer:${frame.to}`);
      for (const t of targets) safeSend(t, frame.payload);
    } else if (frame.kind === 'kick') {
      for (const t of this.ctx.getWebSockets(`peer:${frame.peer}`)) t.close(4010, 'kicked');
    } else if (frame.kind === 'meta') {
      const room = await this.record();
      if (!room) return;
      const meta = cleanMeta(frame.meta, room.code);
      const wasPublic = Boolean(room.meta?.public);
      room.meta = meta?.public ? meta : null;
      await this.ctx.storage.put('room', room);
      if (room.meta || wasPublic) await this.tellDirectory(room.code, room.meta);
    }
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    await this.dropped(ws, code);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.dropped(ws, 1011);
  }

  private async dropped(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code);
    } catch {
      /* already closed */
    }
    const att = ws.deserializeAttachment() as Attachment | null;
    if (att?.role === 'client') {
      const stillHere = this.ctx.getWebSockets(`peer:${att.peer}`).some((s) => s !== ws);
      const host = this.hosts()[0];
      if (!stillHere && host) safeSend(host, sysFrame.leave(att.peer));
      return;
    }
    if (att?.role === 'host' && this.hosts().filter((s) => s !== ws).length === 0) {
      for (const c of this.clients()) safeSend(c, sysFrame.hostAway());
      await this.ctx.storage.setAlarm(Date.now() + HOST_GRACE_MS);
    }
  }

  /** The host never came back: close the room. */
  async alarm(): Promise<void> {
    if (this.hosts().length > 0) return;
    const room = await this.record();
    for (const c of this.clients()) {
      safeSend(c, sysFrame.closed('host-left'));
      c.close(4000, 'host-left');
    }
    if (room?.meta) await this.tellDirectory(room.code, null);
    await this.ctx.storage.deleteAll();
  }

  private async tellDirectory(code: string, meta: RoomMeta | null): Promise<void> {
    const dir = this.env.DIRECTORY.get(this.env.DIRECTORY.idFromName('global'));
    await dir.fetch('https://directory/update', {
      method: 'POST',
      body: JSON.stringify({ code, meta }),
    });
  }
}

/** The list of public rooms. One instance, and it only ever holds a few hundred bytes a room. */
export class Directory extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/update' && request.method === 'POST') {
      const { code, meta } = (await request.json()) as { code: string; meta: RoomMeta | null };
      if (meta) await this.ctx.storage.put(`room:${code}`, { ...meta, updatedAt: Date.now() } satisfies PublicRoom);
      else await this.ctx.storage.delete(`room:${code}`);
      return new Response('ok');
    }
    if (url.pathname === '/list') {
      const now = Date.now();
      const all = await this.ctx.storage.list<PublicRoom>({ prefix: 'room:' });
      const stale: string[] = [];
      for (const [k, v] of all) if (now - v.updatedAt > 10 * 60_000) stale.push(k);
      if (stale.length) await this.ctx.storage.delete(stale);
      return json(rankPublicRooms([...all.values()], now, 10 * 60_000));
    }
    return new Response('Not found', { status: 404 });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/ws/host' || url.pathname === '/ws/join') {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });

      if (url.pathname === '/ws/join') {
        const code = normalizeCode(url.searchParams.get('code'));
        if (!code) return refuse(4004, 'no-room');
        const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
        return stub.fetch(new Request(`https://room/join?${url.searchParams}`, request));
      }

      const asked = url.searchParams.get('code');
      if (asked) {
        const code = normalizeCode(asked);
        if (!code) return refuse(4003, 'bad-key');
        const params = new URLSearchParams({ code, key: url.searchParams.get('key') ?? '' });
        const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
        return stub.fetch(new Request(`https://room/host?${params}`, request));
      }
      // A new room: find a free code.
      for (let attempt = 0; attempt < 8; attempt++) {
        const code = generateCode();
        const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
        const res = await stub.fetch(new Request(`https://room/host?code=${code}&create=1`, request));
        if (res.status !== 409) return res;
      }
      return refuse(4009, 'busy');
    }

    if (url.pathname === '/api/rooms') {
      const dir = env.DIRECTORY.get(env.DIRECTORY.idFromName('global'));
      return dir.fetch('https://directory/list');
    }
    const check = /^\/api\/rooms\/([A-Za-z0-9]+)$/.exec(url.pathname);
    if (check) {
      const code = normalizeCode(check[1]);
      if (!code) return json({ exists: false });
      return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch('https://room/exists');
    }
    if (url.pathname === '/healthz') return json({ ok: true });

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
