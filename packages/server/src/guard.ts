import type { Socket } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@8ball/shared';

type IoSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

/**
 * What stands between the socket API and the open internet.
 *
 * Until now every client was somebody's friend in the same room, so anything they sent was
 * either a real action or their own problem. Public tables change that: any browser can now
 * open a socket and emit whatever it likes, as fast as it likes.
 *
 * Two defences, both deliberately blunt. A **rate limit** so no single socket can occupy the
 * server, and **shape checks** so a handler never reaches its logic holding a string where it
 * expected a number. Neither is clever, and neither is trying to be — the server already
 * refereed the physics, so the interesting attacks were never possible anyway.
 *
 * Worth saying plainly: none of this stops somebody automating a client that sends perfectly
 * ordinary, well-formed shots. That is the botting problem, and it is not solved here or
 * anywhere else in this codebase.
 */

/** Per-socket budget: how many events, over what window. */
export interface RateLimit {
  events: number;
  windowMs: number;
}

/**
 * The default budget.
 *
 * Generous by the standards of a person: aiming streams updates while a finger is down, which
 * is by far the chattiest thing a real client does. Anything past this is not somebody playing
 * pool.
 */
export const DEFAULT_LIMIT: RateLimit = { events: 240, windowMs: 10_000 };

/**
 * Events exempt from the budget.
 *
 * `updateAim` is a firehose by design — it is how the other screens see the cue move — and
 * counting it would throttle the one thing that has to feel continuous. It is cheap: the
 * server does nothing with it but forward it.
 */
const UNLIMITED = new Set(['updateAim']);

export class SocketGuard {
  private counts = new Map<string, { count: number; resetAt: number }>();

  constructor(private limit: RateLimit = DEFAULT_LIMIT) {}

  /** Returns false when this socket has had its share for now. */
  allow(socketId: string, event: string, now = Date.now()): boolean {
    if (UNLIMITED.has(event)) return true;

    const bucket = this.counts.get(socketId);
    if (!bucket || now >= bucket.resetAt) {
      this.counts.set(socketId, { count: 1, resetAt: now + this.limit.windowMs });
      return true;
    }
    bucket.count++;
    return bucket.count <= this.limit.events;
  }

  forget(socketId: string): void {
    this.counts.delete(socketId);
  }

  get tracked(): number {
    return this.counts.size;
  }
}

/**
 * Wraps a socket so every handler registered afterwards is rate limited.
 *
 * Done by replacing `on` rather than by editing every handler, so a new event cannot be added
 * without the limit — the failure mode of the alternative is a handler somebody forgot.
 */
export function guardSocket(socket: IoSocket, guard: SocketGuard): void {
  const original = socket.on.bind(socket);
  (socket as unknown as { on: typeof socket.on }).on = ((event: string, handler: (...args: unknown[]) => void) => {
    if (event === 'disconnect') {
      return original(event as never, ((...args: unknown[]) => {
        guard.forget(socket.id);
        (handler as (...a: unknown[]) => void)(...args);
      }) as never);
    }
    return original(event as never, ((...args: unknown[]) => {
      if (!guard.allow(socket.id, event)) {
        // Dropped in silence. Telling a flooder they are being limited is just another message
        // to send them, and a real client never sees this.
        return;
      }
      (handler as (...a: unknown[]) => void)(...args);
    }) as never);
  }) as typeof socket.on;
}

// ---- Shape checks ----
//
// Small and explicit rather than a schema library: there are a dozen payloads, they change with
// the game, and a dependency here would be more code than the checks themselves.

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** A number inside a range, rejecting NaN and Infinity rather than clamping them to an end. */
export function inRange(v: unknown, min: number, max: number): v is number {
  return isFiniteNumber(v) && v >= min && v <= max;
}

export function isSeatId(v: unknown): v is string {
  return typeof v === 'string' && /^p[1-8]$/.test(v);
}

export function isRoomCode(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9]{4}$/.test(v);
}

/** A shot, as it arrives from a stranger's browser. */
export function isValidShot(input: unknown): boolean {
  if (!input || typeof input !== 'object') return false;
  const i = input as Record<string, unknown>;
  return (
    isSeatId(i.seat) &&
    isFiniteNumber(i.angle) &&
    inRange(i.power, 0, 1) &&
    Boolean(i.spin) &&
    typeof i.spin === 'object' &&
    inRange((i.spin as Record<string, unknown>).x, -1, 1) &&
    inRange((i.spin as Record<string, unknown>).y, -1, 1) &&
    (i.elevation === undefined || inRange(i.elevation, 0, Math.PI / 2))
  );
}

export function isValidAim(input: unknown): boolean {
  if (!input || typeof input !== 'object') return false;
  const i = input as Record<string, unknown>;
  return isSeatId(i.seat) && isFiniteNumber(i.angle);
}

/** A cue-ball placement. Bounds are the Room's business; this only rejects nonsense. */
export function isValidPlacement(input: unknown): boolean {
  if (!input || typeof input !== 'object') return false;
  const i = input as Record<string, unknown>;
  const pos = i.pos as Record<string, unknown> | undefined;
  return isSeatId(i.seat) && Boolean(pos) && isFiniteNumber(pos!.x) && isFiniteNumber(pos!.y);
}
