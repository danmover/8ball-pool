import { signal, computed } from '@preact/signals';
import {
  SHOT_STEP,
  PROTOCOL_VERSION,
  seatIndex,
  type AimState,
  type ClientMsg,
  type GameState,
  type HostMsg,
  type Identity,
  type PeerId,
  type RoomView,
  type Seat,
  type ShotPlayback,
  type Vec2,
} from '@8ball/shared';

/**
 * One device's view of a table — including the host's own screen, which talks to its engine
 * through the same messages as everybody else.
 *
 * Holds the room and the settled game as signals for the UI, and hands shots to whoever is
 * drawing the table to replay. State that arrives mid-shot waits until the replay finishes, so
 * nobody ever sees the result of a shot before the balls have finished rolling.
 */

export type LinkStatus = 'connecting' | 'online' | 'reconnecting' | 'host-away' | 'closed' | 'local';

type Handler<T> = (value: T) => void;

class Emitter<Events extends Record<string, unknown>> {
  private handlers = new Map<keyof Events, Set<Handler<any>>>();
  on<K extends keyof Events>(event: K, fn: Handler<Events[K]>): () => void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(fn);
    return () => this.handlers.get(event)?.delete(fn);
  }
  emit<K extends keyof Events>(event: K, value: Events[K]): void {
    for (const fn of this.handlers.get(event) ?? []) fn(value);
  }
}

export interface ClientEvents extends Record<string, unknown> {
  shot: ShotPlayback;
  shotDone: ShotPlayback;
  aim: { seat: Seat; aim: AimState };
  place: { seat: Seat; pos: Vec2 };
  emote: { peer: PeerId; seat: number | null; name: string; id: string };
  say: { seat: number; text: string };
  notice: { text: string; tone: 'info' | 'good' | 'bad' };
  error: string;
  state: GameState;
}

export class GameClient {
  readonly me: PeerId;
  readonly room = signal<RoomView | null>(null);
  readonly game = signal<GameState | null>(null);
  readonly playing = signal<ShotPlayback | null>(null);
  readonly status = signal<LinkStatus>('connecting');
  readonly closedReason = signal<string | null>(null);
  /** Local receipt time of the current state, for clocks and timers. */
  readonly stateAt = signal(0);
  readonly events = new Emitter<ClientEvents>();

  readonly mySeats = computed(() =>
    (this.room.value?.seats ?? []).filter((s) => s && s.kind === 'human' && s.peer === this.me && !s.covering).map((s) => s!.index)
  );
  readonly isHost = computed(() => this.room.value?.host === this.me);
  /** It is this device's shot (or placement) right now. */
  readonly myTurn = computed(() => {
    const g = this.game.value;
    if (!g || this.playing.value || this.room.value?.phase !== 'playing') return false;
    if (!['aiming', 'break', 'ball_in_hand'].includes(g.phase)) return false;
    return this.mySeats.value.includes(seatIndex(g.currentShooter));
  });

  private seq = 0;
  private queued: GameState[] = [];
  private fallback: ReturnType<typeof setTimeout> | null = null;
  private claimed = false;
  private transport: (msg: ClientMsg) => void;

  constructor(me: PeerId, transport: (msg: ClientMsg) => void) {
    this.me = me;
    this.transport = transport;
  }

  send(msg: ClientMsg): void {
    this.transport(msg);
  }

  hello(identity: Identity): void {
    this.send({ t: 'hello', v: PROTOCOL_VERSION, ...identity });
  }

  receive(msg: HostMsg): void {
    switch (msg.t) {
      case 'welcome':
        if (this.status.value !== 'local') this.status.value = 'online';
        return;
      case 'room':
        this.room.value = msg.room;
        return;
      case 'state':
        if (msg.seq <= this.seq) return;
        this.seq = msg.seq;
        if (this.playing.value) this.queued.push(msg.state);
        else this.applyState(msg.state);
        return;
      case 'shot':
        if (msg.seq <= this.seq) return;
        this.seq = msg.seq;
        this.startShot(msg.shot);
        return;
      case 'aim':
        this.events.emit('aim', { seat: msg.seat, aim: msg.aim });
        return;
      case 'place':
        this.events.emit('place', { seat: msg.seat, pos: msg.pos });
        return;
      case 'emote':
        this.events.emit('emote', msg);
        return;
      case 'say':
        this.events.emit('say', msg);
        return;
      case 'notice':
        this.events.emit('notice', msg);
        return;
      case 'error':
        this.events.emit('error', msg.message);
        return;
      case 'kicked':
        this.closedReason.value = msg.reason;
        this.status.value = 'closed';
        return;
      case 'pong':
        return;
    }
  }

  private applyState(state: GameState): void {
    this.stateAt.value = performance.now();
    this.game.value = state;
    this.events.emit('state', state);
  }

  private startShot(shot: ShotPlayback): void {
    // A shot arriving while another replays (a very fast bot, a slow device) finishes the old one.
    if (this.playing.value) this.finishShot(this.playing.value.id);
    this.claimed = false;
    this.playing.value = shot;
    this.events.emit('shot', shot);
    // If nothing claims the replay — the table isn't on screen — settle it on the clock.
    const ms = shot.steps * SHOT_STEP * 1000 + 150;
    this.fallback = setTimeout(() => {
      if (!this.claimed && this.playing.value?.id === shot.id) this.finishShot(shot.id);
    }, ms);
  }

  /** The renderer is replaying this shot and will call `finishShot` itself. */
  claimShot(id: number): void {
    if (this.playing.value?.id === id) this.claimed = true;
  }

  finishShot(id: number): void {
    const shot = this.playing.value;
    if (!shot || shot.id !== id) return;
    if (this.fallback) clearTimeout(this.fallback);
    this.fallback = null;
    this.playing.value = null;
    this.applyState(shot.result);
    for (const s of this.queued.splice(0)) this.applyState(s);
    this.events.emit('shotDone', shot);
  }

  dispose(): void {
    if (this.fallback) clearTimeout(this.fallback);
  }
}
