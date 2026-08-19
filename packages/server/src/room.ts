import type { Server } from 'socket.io';
import {
  BALL_RADIUS,
  BROADCAST_HZ,
  CUE_BALL_ID,
  DEFAULT_LOBBY,
  DEFAULT_SETTINGS,
  MAX_SEATS,
  MAX_SHOT_SPEED,
  MIN_SHOT_SPEED,
  TABLE_LENGTH,
  TABLE_WIDTH,
  Vec2,
  createInitialGameState,
  isGroupCleared,
  lowestBallId,
  resolveShot,
  seatId,
  stepSimulation,
  summarizeShot,
} from '@8ball/shared';
import type {
  AimInput,
  BallInHandPlacement,
  ClientToServerEvents,
  GameState,
  LobbySettings,
  PlayerSettings,
  RoomStateDTO,
  Seat,
  ServerToClientEvents,
  ShootInput,
  SimEvent,
} from '@8ball/shared';
import { generateToken } from './roomCode.js';

type IoServer = Server<ClientToServerEvents, ServerToClientEvents>;

export interface Connection {
  seat: Seat;
  socketId: string | null;
  token: string;
  settings: PlayerSettings;
}

export class Room {
  code: string;
  io: IoServer;
  gameState: GameState;
  connections = new Map<Seat, Connection>();
  lobby: LobbySettings = { ...DEFAULT_LOBBY };
  started = false;
  hostSocketId: string | null = null;
  hostToken: string;
  spectatorSocketIds = new Set<string>();

  private preShotGroupCleared = false;
  private preShotLowestBall: number | null = null;
  private shotEvents: SimEvent[] = [];
  private loopHandle: ReturnType<typeof setInterval> | null = null;

  constructor(code: string, io: IoServer, hostToken: string) {
    this.code = code;
    this.io = io;
    this.hostToken = hostToken;
    this.gameState = createInitialGameState(this.lobby.mode, this.defaultNames());
  }

  private defaultNames(): string[] {
    return Array.from({ length: this.lobby.maxPlayers }, (_, i) => `Player ${i + 1}`);
  }

  /** All seat ids this lobby currently allows, whether occupied or not. */
  seats(): Seat[] {
    return Array.from({ length: this.lobby.maxPlayers }, (_, i) => seatId(i));
  }

  roomStateDTO(): RoomStateDTO {
    const players: Record<Seat, ReturnType<() => GameState['players'][string]> | null> = {};
    for (const seat of this.seats()) {
      players[seat] = this.connections.has(seat) ? this.gameState.players[seat] ?? null : null;
    }
    return {
      code: this.code,
      lobby: { ...this.lobby },
      started: this.started,
      players,
      spectatorCount: this.spectatorSocketIds.size,
    };
  }

  updateLobby(patch: Partial<LobbySettings>): void {
    if (this.started) return;
    if (patch.mode) this.lobby.mode = patch.mode;
    if (patch.maxPlayers !== undefined) {
      const clamped = Math.max(2, Math.min(MAX_SEATS, Math.round(patch.maxPlayers)));
      // Never shrink below the seats people have already taken.
      const occupied = [...this.connections.keys()].length;
      this.lobby.maxPlayers = Math.max(clamped, occupied);
    }
    // Teams mode needs an even split to alternate cleanly around the table.
    if (this.lobby.mode === 'teams' && this.lobby.maxPlayers % 2 !== 0) {
      this.lobby.maxPlayers = Math.min(MAX_SEATS, this.lobby.maxPlayers + 1);
    }
    this.rebuildGameState();
    this.broadcastRoomState();
    this.broadcastGameState();
  }

  /** Re-creates the game for the current lobby shape, preserving who's connected. */
  private rebuildGameState(): void {
    const names = this.seats().map(
      (seat, i) => this.gameState.players[seat]?.name ?? `Player ${i + 1}`
    );
    const next = createInitialGameState(this.lobby.mode, names);
    for (const seat of next.seatOrder) {
      const conn = this.connections.get(seat);
      const prev = this.gameState.players[seat];
      next.players[seat].connected = Boolean(conn && conn.socketId);
      next.players[seat].isHost = prev?.isHost ?? false;
      if (prev?.name) next.players[seat].name = prev.name;
    }
    this.gameState = next;
  }

  startGame(): void {
    if (this.started) return;
    this.started = true;
    this.rebuildGameState();
    this.broadcastRoomState();
    this.broadcastGameState();
  }

  broadcastRoomState(): void {
    this.io.to(this.code).emit('roomState', this.roomStateDTO());
  }

  broadcastGameState(): void {
    this.io.to(this.code).emit('gameState', this.gameState);
  }

  claimSeat(seat: Seat, name: string, socketId: string, isHost: boolean): { token: string } {
    const token = generateToken();
    this.connections.set(seat, { seat, socketId, token, settings: { ...DEFAULT_SETTINGS } });
    const existing = this.gameState.players[seat];
    this.gameState.players[seat] = {
      seat,
      name,
      connected: true,
      isHost,
      group: existing?.group ?? null,
      team: existing?.team ?? null,
      score: existing?.score ?? 0,
    };
    return { token };
  }

  releaseSeat(seat: Seat): void {
    this.connections.delete(seat);
    const player = this.gameState.players[seat];
    if (player) {
      player.connected = false;
      player.isHost = false;
    }
  }

  findSeatByToken(token: string): Seat | null {
    for (const [seat, conn] of this.connections) {
      if (conn.token === token) return seat;
    }
    return null;
  }

  reconnectSeat(seat: Seat, socketId: string): void {
    const conn = this.connections.get(seat);
    if (!conn) return;
    conn.socketId = socketId;
    const player = this.gameState.players[seat];
    if (player) player.connected = true;
  }

  disconnectSocket(socketId: string): void {
    if (this.hostSocketId === socketId) this.hostSocketId = null;
    for (const [seat, conn] of this.connections) {
      if (conn.socketId === socketId) {
        conn.socketId = null;
        const player = this.gameState.players[seat];
        if (player) player.connected = false;
      }
    }
    this.spectatorSocketIds.delete(socketId);
    this.broadcastRoomState();
  }

  openSeat(): Seat | null {
    return this.seats().find((seat) => !this.connections.has(seat)) ?? null;
  }

  seatSettings(seat: Seat): PlayerSettings | undefined {
    return this.connections.get(seat)?.settings;
  }

  canAct(seat: Seat): boolean {
    return (
      this.gameState.currentShooter === seat &&
      (this.gameState.phase === 'aiming' || this.gameState.phase === 'break')
    );
  }

  handleAim(input: AimInput): void {
    if (!this.canAct(input.seat)) return;
    this.io.to(this.code).emit('aimUpdate', input);
  }

  handleShoot(input: ShootInput): void {
    if (!this.canAct(input.seat)) return;
    const cue = this.gameState.balls.find((b) => b.id === CUE_BALL_ID);
    if (!cue || cue.pocketed) return;

    this.preShotGroupCleared = isGroupCleared(this.gameState, input.seat);
    this.preShotLowestBall = lowestBallId(this.gameState);
    const power = Math.max(0, Math.min(1, input.power));
    const speed = MIN_SHOT_SPEED + power * (MAX_SHOT_SPEED - MIN_SHOT_SPEED);
    cue.vel = Vec2.scale(Vec2.fromAngle(input.angle), speed);
    cue.spin = Math.max(-1, Math.min(1, input.spin.x));

    this.gameState.phase = 'shot_in_progress';
    this.shotEvents = [];
    this.io.to(this.code).emit('shotFired', input);
    this.broadcastGameState();
    this.startSimLoop();
  }

  handlePlaceCueBall(payload: BallInHandPlacement): void {
    if (this.gameState.phase !== 'ball_in_hand' || this.gameState.currentShooter !== payload.seat) return;
    const { x, y } = payload.pos;
    const seatSocket = this.connections.get(payload.seat)?.socketId;

    if (x < BALL_RADIUS || x > TABLE_LENGTH - BALL_RADIUS || y < BALL_RADIUS || y > TABLE_WIDTH - BALL_RADIUS) {
      if (seatSocket) this.io.to(seatSocket).emit('errorMessage', 'Cue ball must stay on the table.');
      return;
    }
    const overlaps = this.gameState.balls.some(
      (b) => !b.pocketed && b.id !== CUE_BALL_ID && Vec2.distance(b.pos, payload.pos) < BALL_RADIUS * 2
    );
    if (overlaps) {
      if (seatSocket) this.io.to(seatSocket).emit('errorMessage', "Can't place the cue ball there.");
      return;
    }

    const cue = this.gameState.balls.find((b) => b.id === CUE_BALL_ID)!;
    cue.pos = { x, y };
    cue.vel = Vec2.zero();
    cue.spin = 0;
    cue.pocketed = false;
    this.gameState.phase = 'aiming';
    this.broadcastGameState();
  }

  requestRematch(): void {
    if (this.gameState.phase !== 'game_over') return;
    const prev = this.gameState;
    // Rotate who breaks so the same seat doesn't always open.
    const nextBreakIndex = (prev.seatOrder.indexOf(prev.currentShooter) + 1) % prev.seatOrder.length;
    const next = createInitialGameState(
      this.lobby.mode,
      prev.seatOrder.map((seat) => prev.players[seat].name),
      nextBreakIndex
    );
    for (const seat of next.seatOrder) {
      const before = prev.players[seat];
      if (!before) continue;
      next.players[seat].connected = before.connected;
      next.players[seat].isHost = before.isHost;
    }
    this.gameState = next;
    this.broadcastGameState();
  }

  private startSimLoop(): void {
    if (this.loopHandle) return;
    const dt = 1 / BROADCAST_HZ;
    this.loopHandle = setInterval(() => {
      const { events, settled } = stepSimulation(this.gameState.balls, dt);
      this.shotEvents.push(...events);
      for (const ev of events) this.io.to(this.code).emit('simEvent', ev);
      this.broadcastGameState();

      if (settled) {
        this.stopSimLoop();
        const outcome = summarizeShot(this.shotEvents);
        resolveShot(this.gameState, outcome, this.preShotGroupCleared, this.preShotLowestBall);
        this.broadcastGameState();
      }
    }, 1000 / BROADCAST_HZ);
  }

  private stopSimLoop(): void {
    if (this.loopHandle) {
      clearInterval(this.loopHandle);
      this.loopHandle = null;
    }
  }

  destroy(): void {
    this.stopSimLoop();
  }
}
