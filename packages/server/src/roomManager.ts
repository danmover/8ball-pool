import type { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@8ball/shared';
import { Room } from './room.js';
import { generateRoomCode, generateToken } from './roomCode.js';

type IoServer = Server<ClientToServerEvents, ServerToClientEvents>;

/**
 * How long a room with nobody in it is kept before it is thrown away.
 *
 * Long enough to survive a phone locking, a tab reloading or a wifi hiccup — all of which
 * disconnect every socket in a small room — and short enough that a public list is not full of
 * tables nobody is at.
 */
export const EMPTY_ROOM_TTL_MS = 3 * 60 * 1000;

/** How often the sweeper looks. Cheap: it walks a Map of at most a few hundred entries. */
const SWEEP_INTERVAL_MS = 30 * 1000;

export class RoomManager {
  private rooms = new Map<string, Room>();
  /** When each room was last seen with somebody in it. */
  private lastOccupied = new Map<string, number>();
  private sweeper: ReturnType<typeof setInterval> | null = null;

  createRoom(io: IoServer): Room {
    let code = generateRoomCode();
    while (this.rooms.has(code)) code = generateRoomCode();
    const room = new Room(code, io, generateToken());
    this.rooms.set(code, room);
    this.lastOccupied.set(code, Date.now());
    this.startSweeper();
    return room;
  }

  get(code: string | undefined): Room | undefined {
    if (!code) return undefined;
    return this.rooms.get(code);
  }

  /** Every room, for the public table list. */
  all(): Room[] {
    return [...this.rooms.values()];
  }

  get size(): number {
    return this.rooms.size;
  }

  remove(code: string): void {
    this.rooms.get(code)?.destroy();
    this.rooms.delete(code);
    this.lastOccupied.delete(code);
  }

  /**
   * Throws away rooms nobody has been in for a while.
   *
   * Rooms used to live forever — `remove()` existed and nothing ever called it. That was a slow
   * leak when a session meant a handful of rooms; with public tables it is an unbounded list of
   * dead ones that people can still see and try to join.
   *
   * Emptiness is measured over *time* rather than on the last disconnect, because a whole small
   * room can briefly go empty when the only two people both reload.
   */
  sweep(now = Date.now()): string[] {
    const removed: string[] = [];
    for (const [code, room] of this.rooms) {
      if (room.isOccupied()) {
        this.lastOccupied.set(code, now);
        continue;
      }
      const since = this.lastOccupied.get(code) ?? now;
      if (now - since >= EMPTY_ROOM_TTL_MS) {
        this.remove(code);
        removed.push(code);
      }
    }
    if (this.rooms.size === 0) this.stopSweeper();
    return removed;
  }

  private startSweeper(): void {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    // Never hold the process open just to sweep an empty map.
    this.sweeper.unref?.();
  }

  private stopSweeper(): void {
    if (!this.sweeper) return;
    clearInterval(this.sweeper);
    this.sweeper = null;
  }

  /** Tears everything down — used by tests, and by a graceful shutdown. */
  destroy(): void {
    this.stopSweeper();
    for (const code of [...this.rooms.keys()]) this.remove(code);
  }
}
