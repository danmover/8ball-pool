import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { normalizeCode } from '@8ball/shared';
import { NodeRelay } from './relay.js';

/**
 * One small Node process: the built client as static files, and the relay.
 *
 * Deliberately free of frameworks. The relay is a few routes and a WebSocket upgrade, and static
 * serving needs only content types and cache headers — which is also what makes this trivial to
 * run on any Node host's free tier.
 */

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
};

export interface AppOptions {
  /** Directory of the built client, or null to serve the relay only. */
  staticDir: string | null;
}

export interface App {
  server: http.Server;
  relay: NodeRelay;
  close(): Promise<void>;
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function serveStatic(dir: string, req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://x');
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(dir, rel));
  if (!file.startsWith(path.normalize(dir))) {
    res.writeHead(403).end();
    return;
  }
  const send = (target: string, spaFallback: boolean): void => {
    fs.stat(target, (err, stat) => {
      if (err || !stat.isFile()) {
        // Unknown paths without an extension are app routes: hand them the app.
        if (!spaFallback && !path.extname(rel)) {
          send(path.join(dir, 'index.html'), true);
          return;
        }
        res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
        return;
      }
      const ext = path.extname(target).toLowerCase();
      const immutable = rel.startsWith('/assets/');
      res.writeHead(200, {
        'content-type': TYPES[ext] ?? 'application/octet-stream',
        'content-length': stat.size,
        'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      fs.createReadStream(target).pipe(res);
    });
  };
  send(file, false);
}

export function createApp(opts: AppOptions): App {
  const relay = new NodeRelay();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, OPTIONS',
        'access-control-allow-headers': 'content-type',
      });
      res.end();
      return;
    }
    if (url.pathname === '/healthz') {
      json(res, 200, { ok: true, rooms: relay.size });
      return;
    }
    if (url.pathname === '/api/rooms') {
      json(res, 200, relay.publicRooms());
      return;
    }
    const check = /^\/api\/rooms\/([A-Za-z0-9]+)$/.exec(url.pathname);
    if (check) {
      const code = normalizeCode(check[1]);
      json(res, 200, { exists: code ? relay.exists(code) : false });
      return;
    }
    if (opts.staticDir && (req.method === 'GET' || req.method === 'HEAD')) {
      serveStatic(opts.staticDir, req, res);
      return;
    }
    res.writeHead(404).end();
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 128 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname !== '/ws/host' && url.pathname !== '/ws/join') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      (ws as WebSocket & { alive?: boolean }).alive = true;
      ws.on('pong', () => ((ws as WebSocket & { alive?: boolean }).alive = true));
      if (url.pathname === '/ws/host') {
        relay.attachHost(ws, url.searchParams.get('code'), url.searchParams.get('key'));
      } else {
        relay.attachClient(ws, url.searchParams.get('code'), url.searchParams.get('peer'));
      }
    });
  });

  // Drop sockets that have stopped answering, so a phone that died doesn't hold a seat forever.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      const w = ws as WebSocket & { alive?: boolean };
      if (w.alive === false) {
        w.terminate();
        continue;
      }
      w.alive = false;
      w.ping();
    }
  }, 25_000);
  heartbeat.unref();

  return {
    server,
    relay,
    close: () =>
      new Promise((resolve) => {
        clearInterval(heartbeat);
        relay.destroy();
        for (const ws of wss.clients) ws.terminate();
        wss.close();
        server.close(() => resolve());
      }),
  };
}
