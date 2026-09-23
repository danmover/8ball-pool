import { signal } from '@preact/signals';
import type { ClientMsg, HostMsg, PeerId, PublicRoom, RoomMeta } from '@8ball/shared';
import { settings } from '../state/settings';

/**
 * Talking to the relay.
 *
 * The relay lives wherever the game was loaded from (the Worker or the Node server both serve
 * the page and the relay together), unless a build-time `VITE_RELAY_URL` or the player's own
 * setting points somewhere else — which is how the static site can be hosted in one place and
 * the relay in another.
 */

export function relayBase(): string {
  const custom = settings.value.relayUrl.trim();
  if (custom) return custom.replace(/\/+$/, '').replace(/^ws/, 'http');
  const built = import.meta.env.VITE_RELAY_URL as string | undefined;
  if (built) return built.replace(/\/+$/, '');
  if (import.meta.env.DEV) return `${location.protocol}//${location.hostname}:8787`;
  return location.origin;
}

function wsBase(): string {
  return relayBase().replace(/^http/, 'ws');
}

/** Does a room exist? `null` means the relay could not be reached at all. */
export async function roomExists(code: string): Promise<boolean | null> {
  try {
    const res = await fetch(`${relayBase()}/api/rooms/${encodeURIComponent(code)}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const body = (await res.json()) as { exists: boolean };
    return body.exists;
  } catch {
    return null;
  }
}

export async function listPublicRooms(): Promise<PublicRoom[] | null> {
  try {
    const res = await fetch(`${relayBase()}/api/rooms`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as PublicRoom[];
  } catch {
    return null;
  }
}

/** Is the relay reachable right now? */
export async function relayReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${relayBase()}/healthz`, { cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  }
}

export type LinkState = 'connecting' | 'open' | 'retrying' | 'closed';

/** Close codes that mean "don't bother reconnecting". */
const FATAL = new Set([4002, 4003, 4004, 4005, 4010]);

abstract class Link {
  state = signal<LinkState>('connecting');
  closeCode = signal<number | null>(null);
  protected ws: WebSocket | null = null;
  protected stopped = false;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private outbox: string[] = [];

  protected abstract url(): string;
  protected abstract onText(text: string): void;
  protected onOpen(): void {}
  protected onDrop(): void {}

  connect(): void {
    if (this.stopped) return;
    this.state.value = this.attempt === 0 ? 'connecting' : 'retrying';
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url());
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.state.value = 'open';
      this.onOpen();
      for (const text of this.outbox.splice(0)) ws.send(text);
      this.pingTimer = setInterval(() => {
        // Keeps proxies from idling the socket out during a long think.
        if (ws.readyState === WebSocket.OPEN) ws.send('{"t":"ping","at":0}');
      }, 25_000);
    };
    ws.onmessage = (e) => this.onText(typeof e.data === 'string' ? e.data : '');
    ws.onclose = (e) => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      if (this.ws !== ws) return;
      this.ws = null;
      this.onDrop();
      if (FATAL.has(e.code) || this.stopped) {
        this.closeCode.value = e.code;
        this.state.value = 'closed';
        return;
      }
      this.scheduleRetry();
    };
    ws.onerror = () => {
      /* onclose follows */
    };
  }

  private scheduleRetry(): void {
    if (this.stopped) return;
    this.state.value = 'retrying';
    const delay = Math.min(8000, 400 * 2 ** this.attempt++) + Math.random() * 300;
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }

  protected sendText(text: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(text);
    else if (this.outbox.length < 50) this.outbox.push(text);
  }

  close(): void {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.ws?.close(1000, 'bye');
    this.ws = null;
    this.state.value = 'closed';
  }
}

export interface HostLinkEvents {
  ready(code: string, key: string): void;
  join(peer: PeerId): void;
  leave(peer: PeerId): void;
  message(peer: PeerId, msg: ClientMsg): void;
}

/** The host's socket to the relay. Reconnects to the same room with its key. */
export class HostLink extends Link {
  code: string | null;
  key: string | null;

  constructor(
    private events: HostLinkEvents,
    resume?: { code: string; key: string }
  ) {
    super();
    this.code = resume?.code ?? null;
    this.key = resume?.key ?? null;
  }

  protected url(): string {
    const params = new URLSearchParams();
    if (this.code && this.key) {
      params.set('code', this.code);
      params.set('key', this.key);
    }
    return `${wsBase()}/ws/host?${params}`;
  }

  protected onText(text: string): void {
    let msg: { sys?: string; code?: string; key?: string; peer?: string; from?: string; d?: ClientMsg };
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (msg.sys === 'ready' && msg.code && msg.key) {
      this.code = msg.code;
      this.key = msg.key;
      this.events.ready(msg.code, msg.key);
    } else if (msg.sys === 'join' && msg.peer) this.events.join(msg.peer);
    else if (msg.sys === 'leave' && msg.peer) this.events.leave(msg.peer);
    else if (msg.from && msg.d) this.events.message(msg.from, msg.d);
  }

  send(to: PeerId | '*', msg: HostMsg): void {
    this.sendText(JSON.stringify({ to, d: msg }));
  }

  meta(meta: Omit<RoomMeta, 'code'>): void {
    this.sendText(JSON.stringify({ sys: 'meta', meta }));
  }

  kick(peer: PeerId): void {
    this.sendText(JSON.stringify({ sys: 'kick', peer }));
  }
}

export interface ClientLinkEvents {
  message(msg: HostMsg): void;
  hostAway(): void;
  hostBack(): void;
  closed(reason: string): void;
  reconnected(): void;
}

/** A player's socket to the relay. */
export class ClientLink extends Link {
  private everOpened = false;

  constructor(
    private code: string,
    private peer: PeerId,
    private events: ClientLinkEvents
  ) {
    super();
  }

  protected url(): string {
    return `${wsBase()}/ws/join?code=${encodeURIComponent(this.code)}&peer=${encodeURIComponent(this.peer)}`;
  }

  protected onOpen(): void {
    if (this.everOpened) this.events.reconnected();
    this.everOpened = true;
  }

  protected onText(text: string): void {
    let msg: HostMsg & { sys?: string; reason?: string };
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (msg.sys === 'host-away') this.events.hostAway();
    else if (msg.sys === 'host-back') this.events.hostBack();
    else if (msg.sys === 'closed') this.events.closed(msg.reason ?? 'closed');
    else if (typeof (msg as { t?: unknown }).t === 'string') this.events.message(msg);
  }

  send(msg: ClientMsg): void {
    this.sendText(JSON.stringify(msg));
  }
}
