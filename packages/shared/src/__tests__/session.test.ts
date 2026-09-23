import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TableSession,
  PROTOCOL_VERSION,
  planBotTurn,
  applyStrikeState,
  cloneBalls,
  runShot,
  DEFAULT_LOADOUT,
  CUE_BALL_ID,
  type ClientMsg,
  type HostMsg,
  type PeerId,
  type RoomSettings,
  type ShotPlayback,
  type RoomView,
  type GameState,
} from '../index.js';

const HOST = 'host-peer-0001';

function identity(name: string) {
  return { name, avatar: { icon: '🎱', color: '#4f8cff' }, level: 5, loadout: { ...DEFAULT_LOADOUT } };
}

/** A table with an in-memory "network": every message is JSON round-tripped like the real wire. */
class Harness {
  session: TableSession;
  inbox = new Map<PeerId, HostMsg[]>();
  dropped: PeerId[] = [];
  members = new Set<PeerId>([HOST]);

  constructor(settings: Partial<RoomSettings> = {}, displayMode = false) {
    this.session = new TableSession(
      { host: HOST, identity: identity('Hosty'), code: 'ABCD', online: true, settings, displayMode },
      {
        send: (to, msg) => {
          const wire = JSON.parse(JSON.stringify(msg)) as HostMsg;
          const targets = to === '*' ? [...this.members] : [to];
          for (const t of targets) {
            if (!this.inbox.has(t)) this.inbox.set(t, []);
            this.inbox.get(t)!.push(wire);
          }
        },
        runBot: (req) => planBotTurn({ ...req, budgetMs: 15 }, () => Promise.resolve()),
        seed: 1234,
        dropPeer: (peer) => {
          this.dropped.push(peer);
          this.members.delete(peer);
        },
      }
    );
  }

  join(peer: PeerId, name: string): void {
    this.members.add(peer);
    this.send(peer, { t: 'hello', v: PROTOCOL_VERSION, ...identity(name) });
  }

  send(peer: PeerId, msg: ClientMsg): void {
    this.session.receive(peer, JSON.parse(JSON.stringify(msg)) as ClientMsg);
  }

  all<T extends HostMsg['t']>(peer: PeerId, t: T): Extract<HostMsg, { t: T }>[] {
    return (this.inbox.get(peer) ?? []).filter((m): m is Extract<HostMsg, { t: T }> => m.t === t);
  }

  last<T extends HostMsg['t']>(peer: PeerId, t: T): Extract<HostMsg, { t: T }> | undefined {
    const list = this.all(peer, t);
    return list[list.length - 1];
  }

  room(peer: PeerId = HOST): RoomView {
    return this.last(peer, 'room')?.room ?? this.session.view();
  }

  game(): GameState {
    return this.session.game!;
  }

  /** The peer whose turn it is. */
  shooterPeer(): PeerId | null {
    const idx = Number(this.game().currentShooter.slice(1)) - 1;
    return this.room().seats[idx]?.peer ?? null;
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-01T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('lobby', () => {
  it('seats the host and newcomers, and tells everybody', () => {
    const h = new Harness();
    h.join('guest-peer-0001', 'Guesty');
    const room = h.room('guest-peer-0001');
    expect(h.last('guest-peer-0001', 'welcome')?.you).toBe('guest-peer-0001');
    expect(room.seats.map((s) => s?.name)).toEqual(['Hosty', 'Guesty']);
    expect(room.members).toHaveLength(2);
    expect(h.last(HOST, 'notice')?.text).toMatch(/Guesty joined/);
  });

  it('only lets the host change settings, add bots and start', () => {
    const h = new Harness();
    h.join('guest-peer-0001', 'Guesty');
    h.send('guest-peer-0001', { t: 'settings', patch: { mode: 'nineball' } });
    expect(h.room().settings.mode).toBe('eightball');
    h.send(HOST, { t: 'settings', patch: { mode: 'killer', seats: 4 } });
    expect(h.room().settings.mode).toBe('killer');
    expect(h.room().seats).toHaveLength(4);
    h.send(HOST, { t: 'addBot', seat: 2, botId: 'bot.shark' });
    expect(h.room().seats[2]?.name).toBe('The Shark');
    h.send('guest-peer-0001', { t: 'start' });
    expect(h.room().phase).toBe('lobby');
  });

  it('refuses a client on the wrong protocol version', () => {
    const h = new Harness();
    h.members.add('old-client-001');
    h.send('old-client-001', { t: 'hello', v: 1, ...identity('Old') });
    expect(h.last('old-client-001', 'kicked')).toBeTruthy();
    expect(h.dropped).toContain('old-client-001');
  });

  it('refuses to start without enough players', () => {
    const h = new Harness();
    h.send(HOST, { t: 'start' });
    expect(h.last(HOST, 'error')?.message).toMatch(/at least 2/);
    expect(h.room().phase).toBe('lobby');
  });
});

describe('shots', () => {
  it('replays identically on a client from the shot message alone', () => {
    const h = new Harness();
    h.join('guest-peer-0001', 'Guesty');
    h.send(HOST, { t: 'start' });
    expect(h.room().phase).toBe('playing');
    const shooter = h.shooterPeer()!;
    const other = shooter === HOST ? 'guest-peer-0001' : HOST;

    // Someone else can't take the shot.
    h.send(other, { t: 'shoot', shot: { angle: 0, power: 1, spin: { x: 0, y: 0 }, elevation: 0 } });
    expect(h.all(other, 'shot')).toHaveLength(0);

    h.send(shooter, { t: 'shoot', shot: { angle: 0.004, power: 0.95, spin: { x: 0.2, y: 0.3 }, elevation: 0 } });
    const msg = h.last(other, 'shot')!;
    const shot: ShotPlayback = msg.shot;

    const balls = cloneBalls(shot.pre);
    applyStrikeState(balls.find((b) => b.id === CUE_BALL_ID)!, shot.strike);
    const run = runShot(balls, { mods: { ...shot.mods }, orbs: shot.orbs ?? undefined });
    expect(run.steps).toBe(shot.steps);
    for (const b of balls) {
      const r = shot.result.balls.find((x) => x.id === b.id)!;
      expect(b.pocketed).toBe(r.pocketed);
      if (!b.pocketed) {
        expect(b.pos.x).toBe(r.pos.x);
        expect(b.pos.y).toBe(r.pos.y);
      }
    }
  });

  it('holds the next turn until the balls have stopped, then starts the clock', async () => {
    const h = new Harness({ shotClock: 20 });
    h.join('guest-peer-0001', 'Guesty');
    h.send(HOST, { t: 'start' });
    const shooter = h.shooterPeer()!;
    h.send(shooter, { t: 'shoot', shot: { angle: 0, power: 0.9, spin: { x: 0, y: 0 }, elevation: 0 } });
    const shot = h.last(HOST, 'shot')!.shot;
    // A second shot before playback ends is ignored.
    const next = h.shooterPeer()!;
    h.send(next, { t: 'shoot', shot: { angle: 1, power: 0.5, spin: { x: 0, y: 0 }, elevation: 0 } });
    expect(h.all(HOST, 'shot')).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(Math.ceil((shot.steps / 120) * 1000) + 500);
    const state = h.last(HOST, 'state')!.state;
    expect(state.clock?.totalMs).toBe(20_000);
    expect(state.clock!.remainingMs).toBeGreaterThan(19_000);
  });

  it('fouls a player who runs out the clock', async () => {
    const h = new Harness({ shotClock: 10 });
    h.join('guest-peer-0001', 'Guesty');
    h.send(HOST, { t: 'start' });
    const before = h.game().currentShooter;
    await vi.advanceTimersByTimeAsync(10_500);
    expect(h.game().currentShooter).not.toBe(before);
    expect(h.game().phase).toBe('ball_in_hand');
    expect(h.game().lastShot?.foul).toMatch(/clock/);
  });

  it('only accepts legal cue-ball placements', () => {
    const h = new Harness();
    h.join('guest-peer-0001', 'Guesty');
    h.send(HOST, { t: 'start' });
    const g = h.game();
    g.phase = 'ball_in_hand';
    const shooter = h.shooterPeer()!;
    const onBall = g.balls.find((b) => b.id === 5)!.pos;
    h.send(shooter, { t: 'place', pos: onBall, commit: true });
    expect(h.game().phase).toBe('ball_in_hand');
    h.send(shooter, { t: 'place', pos: { x: 300, y: 300 }, commit: true });
    expect(h.game().phase).toBe('aiming');
    expect(h.game().balls.find((b) => b.id === 0)!.pos).toEqual({ x: 300, y: 300 });
  });
});

describe('matches', () => {
  it('plays a whole frame against a bot and reaches the results', async () => {
    const h = new Harness({ raceTo: 1 });
    h.send(HOST, { t: 'addBot', seat: 1, botId: 'bot.viper' });
    h.send(HOST, { t: 'start' });
    let guard = 0;
    while (h.room().phase !== 'results' && guard++ < 300) {
      if (h.shooterPeer() === HOST && ['aiming', 'break', 'ball_in_hand'].includes(h.game().phase)) {
        if (h.game().phase === 'ball_in_hand') {
          h.send(HOST, { t: 'place', pos: { x: 250 + (guard % 5) * 40, y: 200 + (guard % 7) * 60 }, commit: true });
        }
        h.send(HOST, { t: 'shoot', shot: { angle: guard * 1.7, power: 0.6, spin: { x: 0, y: 0 }, elevation: 0 } });
      }
      await vi.advanceTimersByTimeAsync(3000);
    }
    const room = h.room();
    expect(room.phase).toBe('results');
    expect(room.result?.winners.length).toBe(1);
    expect(h.all(HOST, 'aim').length).toBeGreaterThan(0);
  }, 60_000);

  it('moves to the next frame after an intermission in a race to two', async () => {
    const h = new Harness({ raceTo: 2 });
    h.join('guest-peer-0001', 'Guesty');
    h.send(HOST, { t: 'start' });
    forceEightEarly(h);
    await vi.advanceTimersByTimeAsync(3000);
    expect(h.room().phase).toBe('intermission');
    expect(h.room().match?.wins.reduce((a, b) => a + b, 0)).toBe(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.room().phase).toBe('playing');
    expect(h.room().match?.frame).toBe(2);
  });

  it('runs a tournament, playing out bot ties and crowning a champion', async () => {
    const h = new Harness({ format: 'tournament', entrants: 8, raceTo: 1 });
    h.send(HOST, { t: 'start' });
    let room = h.room();
    expect(room.seats).toHaveLength(8);
    expect(room.tournament?.current).toBeTruthy();
    const names = room.seats.map((s) => s?.name);
    expect(new Set(names).size).toBe(8);
    // The host loses their tie on purpose; the rest of the bracket should finish by itself.
    forceEightEarly(h, true);
    await vi.advanceTimersByTimeAsync(3000);
    room = h.room();
    expect(room.phase).toBe('results');
    expect(room.result?.champion).not.toBeNull();
    expect(room.tournament?.bracket.champion).toBeTruthy();
  });

  it('lets a bot cover a player who drops out, and hands the seat back', async () => {
    const h = new Harness();
    h.join('guest-peer-0001', 'Guesty');
    h.send(HOST, { t: 'start' });
    h.session.peerLeft('guest-peer-0001');
    await vi.advanceTimersByTimeAsync(31_000);
    const covered = h.room().seats.find((s) => s?.peer === 'guest-peer-0001')!;
    expect(covered.covering).toBe(true);
    h.join('guest-peer-0001', 'Guesty');
    const back = h.room().seats.find((s) => s?.peer === 'guest-peer-0001')!;
    expect(back.covering).toBe(false);
    expect(back.connected).toBe(true);
  });

  it('kicks a player', () => {
    const h = new Harness();
    h.join('guest-peer-0001', 'Guesty');
    h.send(HOST, { t: 'kick', peer: 'guest-peer-0001' });
    expect(h.dropped).toContain('guest-peer-0001');
    expect(h.room().seats.some((s) => s?.peer === 'guest-peer-0001')).toBe(false);
  });

  it('rematches when every player asks', async () => {
    const h = new Harness();
    h.join('guest-peer-0001', 'Guesty');
    h.send(HOST, { t: 'start' });
    forceEightEarly(h);
    await vi.advanceTimersByTimeAsync(3000);
    expect(h.room().phase).toBe('results');
    h.send('guest-peer-0001', { t: 'rematch' });
    expect(h.room().phase).toBe('playing');
  });
});

describe('practice and persistence', () => {
  it('undoes a practice shot', async () => {
    const h = new Harness({ mode: 'practice' });
    h.send(HOST, { t: 'start' });
    const before = JSON.stringify(h.game().balls);
    h.send(HOST, { t: 'shoot', shot: { angle: 0, power: 1, spin: { x: 0, y: 0 }, elevation: 0 } });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(JSON.stringify(h.game().balls)).not.toBe(before);
    h.send(HOST, { t: 'practice', action: 'undo' });
    expect(JSON.stringify(h.game().balls)).toBe(before);
  });

  it('restores a saved session', () => {
    const h = new Harness({ raceTo: 3 });
    h.join('guest-peer-0001', 'Guesty');
    h.send(HOST, { t: 'start' });
    const saved = h.session.serialize();
    const restored = TableSession.restore(
      saved,
      { host: HOST, identity: identity('Hosty'), code: 'ABCD', online: true },
      { send: () => {}, runBot: async () => ({ kind: 'place', pos: { x: 0, y: 0 } }) }
    );
    const view = restored.view();
    expect(view.phase).toBe('playing');
    expect(view.settings.raceTo).toBe(3);
    expect(view.seats[1]?.name).toBe('Guesty');
    expect(view.seats[1]?.connected).toBe(false);
    expect(restored.game?.balls.length).toBe(16);
    restored.destroy();
  });
});

/**
 * Makes the current shooter pot the 8 before clearing their group, which loses them the frame.
 * With `hostLoses`, sets it up so the host is the one shooting.
 */
function forceEightEarly(h: Harness, hostLoses = false): void {
  const g = h.game();
  if (hostLoses) {
    const hostIdx = h.room().seats.findIndex((s) => s?.peer === HOST);
    if (!g.seatOrder.includes(`p${hostIdx + 1}`)) throw new Error('host not in this frame');
    g.currentShooter = `p${hostIdx + 1}`;
  }
  g.phase = 'aiming';
  for (const b of g.balls) {
    if (b.id === 0) b.pos = { x: 1000, y: 500 };
    else if (b.id === 8) b.pos = { x: 1000, y: 200 };
    else if (b.id === 1) b.pos = { x: 400, y: 800 };
    else b.pocketed = true;
  }
  for (const s of g.seatOrder) g.players[s].group = s === g.currentShooter ? 'solid' : 'stripe';
  const shooter = h.shooterPeer()!;
  h.send(shooter, { t: 'shoot', shot: { angle: -Math.PI / 2, power: 0.45, spin: { x: 0, y: 0 }, elevation: 0 } });
}
