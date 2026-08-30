import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import cors from 'cors';
import type { ClientToServerEvents, ServerToClientEvents } from '@8ball/shared';
import { RoomManager } from './roomManager.js';
import { registerSocketHandlers } from './socketHandlers.js';
import { registerOnlineHandlers } from './onlineHandlers.js';
import { SqliteProfileRepository } from './profiles/sqliteRepository.js';
import { registerProfileRoutes } from './profiles/routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: '*' },
});

const rooms = new RoomManager();
registerSocketHandlers(io, rooms);
registerOnlineHandlers(io, rooms);

const profiles = new SqliteProfileRepository();
registerProfileRoutes(app, profiles);

app.get('/healthz', (_req, res) => {
  res.json({ ok: true });
});

const clientDist = path.resolve(__dirname, '../../client/dist');
app.use(express.static(clientDist));
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;
httpServer.listen(PORT, () => {
  console.log(`8ball-pool server listening on :${PORT}`);
});
