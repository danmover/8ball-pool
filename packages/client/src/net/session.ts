import { signal } from '@preact/signals';
import {
  TableSession,
  modeDescriptor,
  normalizeCode,
  type ClientMsg,
  type HostMsg,
  type Identity,
  type PeerId,
  type RoomSettings,
} from '@8ball/shared';
import { GameClient } from './client';
import { ClientLink, HostLink } from './relay';
import { createBotRunner } from './bots';
import { devicePeerId, readJson, removeKey, writeJson } from '../state/storage';
import { displayName, level, profile } from '../state/profile';

/**
 * The table this device is at, if any.
 *
 * There is only ever one. It outlives the screen that started it, so you can open the locker
 * mid-frame and come back to the same game — the host's engine keeps running underneath.
 */

export interface ActiveSession {
  kind: 'host' | 'guest';
  client: GameClient;
  host: HostRunner | null;
  /** Room code on the relay; null for an offline table. */
  code: () => string | null;
  /** Cup being played, for rewards. */
  cupId: string | null;
  leave(): void;
}

export const active = signal<ActiveSession | null>(null);

export function myIdentity(): Identity {
  const p = profile.value;
  return { name: displayName(), avatar: p.avatar, level: level.value, loadout: p.loadout };
}

const SAVE_KEY = '8ball:v2:hosted';

export interface SavedHost {
  code: string | null;
  key: string | null;
  online: boolean;
  cupId: string | null;
  session: string;
  savedAt: number;
}

/** A table this device was hosting when the page closed, if it is recent enough to resume. */
export function savedHost(): SavedHost | null {
  const s = readJson<SavedHost>(SAVE_KEY);
  if (!s || Date.now() - s.savedAt > 3 * 60 * 60 * 1000) return null;
  return s;
}

export function forgetSavedHost(): void {
  removeKey(SAVE_KEY);
}

export interface HostOptions {
  online: boolean;
  settings?: Partial<RoomSettings>;
  displayMode?: boolean;
  cupId?: string | null;
  /** Called with the room code once the relay has given us one. */
  onReady?: (code: string | null) => void;
  onError?: (message: string) => void;
  resume?: SavedHost;
  /** Save to storage so a reload resumes it. Off for the home screen's demo table. */
  persist?: boolean;
}

/** Runs a table on this device: the engine, its own client, and (online) the relay link. */
export class HostRunner {
  readonly peer = devicePeerId();
  readonly client: GameClient;
  readonly code = signal<string | null>(null);
  session: TableSession | null = null;
  private link: HostLink | null = null;
  private bots = createBotRunner();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private lastMeta = '';

  constructor(private opts: HostOptions) {
    this.client = new GameClient(this.peer, (msg) => this.fromLocal(msg));
    this.client.status.value = opts.online ? 'connecting' : 'local';

    if (!opts.online) {
      this.createSession(null);
      opts.onReady?.(null);
      return;
    }

    const resume = opts.resume?.code && opts.resume.key ? { code: opts.resume.code, key: opts.resume.key } : undefined;
    this.link = new HostLink(
      {
        ready: (code) => {
          this.code.value = code;
          this.client.status.value = 'online';
          if (!this.session) {
            this.createSession(code);
            opts.onReady?.(code);
          }
          this.pushMeta(true);
        },
        join: () => {},
        leave: (peer) => this.session?.peerLeft(peer),
        message: (peer, msg) => this.session?.receive(peer, msg),
      },
      resume
    );
    this.link.state.subscribe((s) => {
      if (s === 'retrying' && this.session) this.client.status.value = 'reconnecting';
      if (s === 'closed' && this.link?.closeCode.value) {
        this.client.status.value = 'closed';
        this.client.closedReason.value = 'Lost the room on the server. Start a new table.';
      }
    });
    let failed = false;
    const giveUp = setTimeout(() => {
      if (!this.session && !failed) {
        failed = true;
        opts.onError?.("Couldn't reach the game server. Check your connection, or play offline.");
      }
    }, 9000);
    this.link.state.subscribe((s) => {
      if (s === 'open') clearTimeout(giveUp);
    });
    this.link.connect();
  }

  private createSession(code: string | null): void {
    const deps = {
      send: (to: PeerId | '*', msg: HostMsg) => this.deliver(to, msg),
      runBot: this.bots.run,
      onChange: () => this.scheduleSave(),
      dropPeer: (peer: PeerId) => this.link?.kick(peer),
    };
    const init = {
      host: this.peer,
      identity: myIdentity(),
      code,
      online: this.opts.online,
      settings: this.opts.settings,
      displayMode: this.opts.displayMode,
    };
    this.session = this.opts.resume ? TableSession.restore(this.opts.resume.session, init, deps) : new TableSession(init, deps);
    // Our own client says hello like anyone else would.
    this.client.hello(myIdentity());
    if (this.opts.resume) this.session.resume();
  }

  /** Messages from the engine: to our own screen, to the relay, or both. */
  private deliver(to: PeerId | '*', msg: HostMsg): void {
    if (to === '*' || to === this.peer) {
      // Serialised like the wire, so the host sees exactly what everyone else does.
      const copy = JSON.parse(JSON.stringify(msg)) as HostMsg;
      queueMicrotask(() => this.client.receive(copy));
    }
    if (to !== this.peer) this.link?.send(to, msg);
    if (msg.t === 'room') this.pushMeta(false);
  }

  private fromLocal(msg: ClientMsg): void {
    const copy = JSON.parse(JSON.stringify(msg)) as ClientMsg;
    queueMicrotask(() => this.session?.receive(this.peer, copy));
  }

  /** Keeps the relay's public listing up to date. */
  private pushMeta(force: boolean): void {
    if (!this.link || !this.session) return;
    const room = this.session.view();
    const meta = {
      host: displayName(),
      mode: room.settings.mode,
      players: room.seats.filter((s) => s !== null).length,
      seats: room.seats.length,
      playing: room.phase !== 'lobby',
      public: room.settings.visibility === 'public' && !modeDescriptor(room.settings.mode).solo,
    };
    const text = JSON.stringify(meta);
    if (!force && text === this.lastMeta) return;
    this.lastMeta = text;
    this.link.meta(meta);
  }

  private scheduleSave(): void {
    if (this.saveTimer || this.opts.persist === false) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      if (!this.session) return;
      writeJson(SAVE_KEY, {
        code: this.link?.code ?? null,
        key: this.link?.key ?? null,
        online: this.opts.online,
        cupId: this.opts.cupId ?? null,
        session: this.session.serialize(),
        savedAt: Date.now(),
      } satisfies SavedHost);
    }, 400);
  }

  /** Push fresh identity (name, avatar, cues) to the table. */
  refreshIdentity(): void {
    this.client.send({ t: 'identity', ...myIdentity() });
  }

  destroy(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.session?.destroy();
    this.link?.close();
    this.bots.dispose();
    this.client.dispose();
    if (this.opts.persist !== false) forgetSavedHost();
  }
}

/** Starts hosting a table and makes it the active session. */
export function hostTable(opts: HostOptions): HostRunner {
  active.value?.leave();
  const runner = new HostRunner(opts);
  active.value = {
    kind: 'host',
    client: runner.client,
    host: runner,
    code: () => runner.code.value,
    cupId: opts.cupId ?? opts.resume?.cupId ?? null,
    leave: () => {
      runner.destroy();
      if (active.value?.host === runner) active.value = null;
    },
  };
  return runner;
}

/** Joins somebody else's table by code. */
export function joinTable(rawCode: string): GameClient | null {
  const code = normalizeCode(rawCode);
  if (!code) return null;
  if (active.value?.kind === 'guest' && active.value.code() === code) return active.value.client;
  active.value?.leave();

  const peer = devicePeerId();
  let link: ClientLink | null = null;
  const client = new GameClient(peer, (msg) => link?.send(msg));
  link = new ClientLink(code, peer, {
    message: (msg) => client.receive(msg),
    hostAway: () => (client.status.value = 'host-away'),
    hostBack: () => {
      client.status.value = 'online';
      client.hello(myIdentity());
    },
    closed: (reason) => {
      client.status.value = 'closed';
      client.closedReason.value = reason === 'host-left' ? 'The host closed the table.' : 'The table has closed.';
    },
    reconnected: () => {
      client.status.value = 'online';
      client.hello(myIdentity());
    },
  });
  link.state.subscribe((s) => {
    if (s === 'open') client.hello(myIdentity());
    if (s === 'retrying' && client.status.value === 'online') client.status.value = 'reconnecting';
    if (s === 'closed' && link?.closeCode.value) {
      const code = link.closeCode.value;
      client.status.value = 'closed';
      client.closedReason.value =
        code === 4004
          ? "That table doesn't exist — check the code."
          : code === 4005
            ? 'That table is full.'
            : code === 4010
              ? 'The host removed you from the table.'
              : 'Disconnected from the table.';
    }
  });
  link.connect();

  active.value = {
    kind: 'guest',
    client,
    host: null,
    code: () => code,
    cupId: null,
    leave: () => {
      if (client.status.value !== 'closed') client.send({ t: 'sit', seat: null });
      link?.close();
      client.dispose();
      if (active.value?.client === client) active.value = null;
    },
  };
  return client;
}

export function leaveTable(): void {
  active.value?.leave();
}
