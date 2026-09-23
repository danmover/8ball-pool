import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { createApp, type App } from '../app.js';

let app: App;
let base: string;

beforeEach(async () => {
  app = createApp({ staticDir: null });
  await new Promise<void>((r) => app.server.listen(0, r));
  const port = (app.server.address() as AddressInfo).port;
  base = `127.0.0.1:${port}`;
});

afterEach(async () => {
  await app.close();
});

/** A socket that queues everything it receives, so a test can await the next message. */
class Probe {
  ws: WebSocket;
  queue: unknown[] = [];
  waiters: ((m: unknown) => void)[] = [];
  closed: { code: number; reason: string } | null = null;
  opened: Promise<void>;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.opened = new Promise((resolve, reject) => {
      this.ws.once('open', () => resolve());
      this.ws.once('error', reject);
    });
    this.ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      const w = this.waiters.shift();
      if (w) w(msg);
      else this.queue.push(msg);
    });
    this.ws.on('close', (code, reason) => {
      this.closed = { code, reason: reason.toString() };
    });
  }

  next(): Promise<any> {
    const m = this.queue.shift();
    if (m !== undefined) return Promise.resolve(m);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout')), 2000);
      this.waiters.push((msg) => {
        clearTimeout(t);
        resolve(msg);
      });
    });
  }

  send(obj: unknown): void {
    this.ws.send(JSON.stringify(obj));
  }

  async closedWith(): Promise<{ code: number; reason: string }> {
    for (let i = 0; i < 100 && !this.closed; i++) await new Promise((r) => setTimeout(r, 20));
    return this.closed!;
  }
}

describe('Node relay', () => {
  it('creates a room, forwards both ways, and stamps who is speaking', async () => {
    const host = new Probe(`ws://${base}/ws/host`);
    const ready = await host.next();
    expect(ready.sys).toBe('ready');
    expect(ready.code).toMatch(/^[A-Z2-9]{4}$/);

    const res = await fetch(`http://${base}/api/rooms/${ready.code}`);
    expect(await res.json()).toEqual({ exists: true });

    const client = new Probe(`ws://${base}/ws/join?code=${ready.code}&peer=phonePeer001`);
    await client.opened;
    expect(await host.next()).toEqual({ sys: 'join', peer: 'phonePeer001' });

    client.send({ t: 'ping', at: 1 });
    expect(await host.next()).toEqual({ from: 'phonePeer001', d: { t: 'ping', at: 1 } });

    host.send({ to: 'phonePeer001', d: { t: 'pong', at: 1 } });
    expect(await client.next()).toEqual({ t: 'pong', at: 1 });

    host.send({ to: '*', d: { t: 'notice', text: 'hi', tone: 'info' } });
    expect((await client.next()).text).toBe('hi');
  });

  it('turns away clients for rooms that do not exist', async () => {
    const client = new Probe(`ws://${base}/ws/join?code=ZZZZ&peer=phonePeer001`);
    const closed = await client.closedWith();
    expect(closed.code).toBe(4004);
  });

  it('keeps the room while the host reconnects, telling the players', async () => {
    const host = new Probe(`ws://${base}/ws/host`);
    const { code, key } = await host.next();
    const client = new Probe(`ws://${base}/ws/join?code=${code}&peer=phonePeer001`);
    await host.next(); // join
    host.ws.close();
    expect((await client.next()).sys).toBe('host-away');

    const wrongKey = new Probe(`ws://${base}/ws/host?code=${code}&key=nope`);
    expect((await wrongKey.closedWith()).code).toBe(4003);

    const back = new Probe(`ws://${base}/ws/host?code=${code}&key=${key}`);
    expect((await back.next()).sys).toBe('ready');
    expect(await back.next()).toEqual({ sys: 'join', peer: 'phonePeer001' });
    expect((await client.next()).sys).toBe('host-back');
  });

  it('lets the host kick a player and lists public rooms', async () => {
    const host = new Probe(`ws://${base}/ws/host`);
    const { code } = await host.next();
    const client = new Probe(`ws://${base}/ws/join?code=${code}&peer=phonePeer001`);
    await host.next();

    host.send({ sys: 'meta', meta: { mode: 'killer', host: 'Dan', players: 2, seats: 6, playing: false, public: true } });
    await new Promise((r) => setTimeout(r, 50));
    const rooms = (await (await fetch(`http://${base}/api/rooms`)).json()) as { code: string }[];
    expect(rooms[0]).toMatchObject({ code, mode: 'killer', host: 'Dan' });

    host.send({ sys: 'kick', peer: 'phonePeer001' });
    expect((await client.closedWith()).code).toBe(4010);
  });
});
