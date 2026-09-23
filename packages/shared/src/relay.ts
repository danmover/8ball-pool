import type { GameMode } from './types.js';

/**
 * The relay's rules, shared by the Node server and the Cloudflare Worker.
 *
 * A relay is deliberately dumb: it forwards the host's messages to the right clients and the
 * clients' messages to the host, and knows nothing about pool. That is what lets it run on a
 * free tier — it does no simulation and holds no game state — and what keeps two very different
 * backends honest: they share every routing decision through the functions in this file.
 *
 * Wire format:
 *   host  → relay  `{"to":"<peer>|*","d":<HostMsg>}` or `{"sys":"meta"|"kick",...}`
 *   relay → host   `{"from":"<peer>","d":<ClientMsg>}` or `{"sys":"join"|"leave"|"ready",...}`
 *   client → relay  a bare ClientMsg
 *   relay → client  a bare HostMsg, or `{"sys":"host-away"|"host-back"|"closed"}`
 */

/** Unambiguous characters only — no 0/O or 1/I to misread off a TV across the room. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 4;

/** How long a room waits for its host to come back before closing. */
export const HOST_GRACE_MS = 5 * 60_000;
/** Largest message the relay will forward. A shot with its full result is a few kilobytes. */
export const MAX_MESSAGE_BYTES = 96 * 1024;
/** Clients per room, spectators included. */
export const MAX_CLIENTS = 24;
/** Messages per second a client may send before it is cut off. */
export const CLIENT_RATE_LIMIT = 40;

export function generateCode(rand: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)];
  return out;
}

export function normalizeCode(raw: string | null | undefined): string | null {
  const code = (raw ?? '').trim().toUpperCase();
  if (code.length !== CODE_LENGTH) return null;
  for (const ch of code) if (!CODE_ALPHABET.includes(ch)) return null;
  return code;
}

/** Peer ids are chosen by the client: 8–40 url-safe characters. */
export function isValidPeer(peer: string | null | undefined): peer is string {
  return typeof peer === 'string' && /^[A-Za-z0-9_-]{8,40}$/.test(peer);
}

export function generateKey(rand: () => number = Math.random): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 24; i++) out += chars[Math.floor(rand() * chars.length)];
  return out;
}

/** What a public room shows in the browser. The relay stores nothing else about a game. */
export interface RoomMeta {
  code: string;
  host: string;
  mode: GameMode;
  players: number;
  seats: number;
  /** Lobby, or already playing (joinable to watch). */
  playing: boolean;
  public: boolean;
}

export interface PublicRoom extends RoomMeta {
  updatedAt: number;
}

export function cleanMeta(raw: unknown, code: string): RoomMeta | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  const modes: GameMode[] = ['eightball', 'nineball', 'killer', 'power'];
  const mode = modes.includes(m.mode as GameMode) ? (m.mode as GameMode) : null;
  if (!mode) return null;
  const n = (v: unknown, hi: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(hi, Math.round(v))) : 0;
  return {
    code,
    host: typeof m.host === 'string' ? m.host.slice(0, 16) : 'Host',
    mode,
    players: n(m.players, 8),
    seats: n(m.seats, 8),
    playing: m.playing === true,
    public: m.public === true,
  };
}

export type HostFrame =
  | { kind: 'send'; to: string; payload: string }
  | { kind: 'meta'; meta: unknown }
  | { kind: 'kick'; peer: string }
  | { kind: 'invalid' };

/** Reads one message from a host socket. */
export function parseHostFrame(text: string): HostFrame {
  if (text.length > MAX_MESSAGE_BYTES) return { kind: 'invalid' };
  let msg: unknown;
  try {
    msg = JSON.parse(text);
  } catch {
    return { kind: 'invalid' };
  }
  if (!msg || typeof msg !== 'object') return { kind: 'invalid' };
  const m = msg as Record<string, unknown>;
  if (m.sys === 'meta') return { kind: 'meta', meta: m.meta };
  if (m.sys === 'kick' && isValidPeer(m.peer as string)) return { kind: 'kick', peer: m.peer as string };
  if (typeof m.to === 'string' && m.d !== undefined) {
    if (m.to !== '*' && !isValidPeer(m.to)) return { kind: 'invalid' };
    return { kind: 'send', to: m.to, payload: JSON.stringify(m.d) };
  }
  return { kind: 'invalid' };
}

/**
 * Wraps a client's message for the host, stamped with who sent it.
 *
 * The message is parsed and re-serialised rather than spliced into a string: a client that could
 * smuggle its own `"from"` key into the envelope could speak as somebody else.
 */
export function wrapClientFrame(peer: string, text: string): string | null {
  if (text.length > MAX_MESSAGE_BYTES) return null;
  try {
    const d = JSON.parse(text);
    if (!d || typeof d !== 'object') return null;
    return JSON.stringify({ from: peer, d });
  } catch {
    return null;
  }
}

export const sysFrame = {
  ready: (code: string, key: string): string => JSON.stringify({ sys: 'ready', code, key }),
  join: (peer: string): string => JSON.stringify({ sys: 'join', peer }),
  leave: (peer: string): string => JSON.stringify({ sys: 'leave', peer }),
  hostAway: (): string => JSON.stringify({ sys: 'host-away' }),
  hostBack: (): string => JSON.stringify({ sys: 'host-back' }),
  closed: (reason: string): string => JSON.stringify({ sys: 'closed', reason }),
};

/** A per-socket token bucket, so one client can't flood the host. */
export class RateLimiter {
  private tokens: number;
  private last: number;
  constructor(
    private perSecond = CLIENT_RATE_LIMIT,
    now = Date.now()
  ) {
    this.tokens = perSecond;
    this.last = now;
  }
  take(now = Date.now()): boolean {
    this.tokens = Math.min(this.perSecond, this.tokens + ((now - this.last) / 1000) * this.perSecond);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/** Public rooms, freshest and fullest-but-not-full first. */
export function rankPublicRooms(rooms: PublicRoom[], now = Date.now(), maxAgeMs = 90_000): PublicRoom[] {
  return rooms
    .filter((r) => r.public && now - r.updatedAt < maxAgeMs)
    .sort((a, b) => {
      if (a.playing !== b.playing) return a.playing ? 1 : -1;
      const aFree = a.seats - a.players;
      const bFree = b.seats - b.players;
      if ((aFree > 0) !== (bFree > 0)) return aFree > 0 ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    })
    .slice(0, 50);
}
