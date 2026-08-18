import type { Server } from 'socket.io';
import {
  BALL_RADIUS,
  BROADCAST_HZ,
  CUE_BALL_ID,
  DEFAULT_SETTINGS,
  MAX_SHOT_SPEED,
  MIN_SHOT_SPEED,
  TABLE_LENGTH,
  TABLE_WIDTH,
  Vec2,
  createInitialGameState,
  isGroupCleared,
  resolveShot,
  stepSimulation,
  summarizeShot,
} from '@8ball/shared';
import type {
  AimInput,
  BallInHandPlacement,
  ClientToServerEvents,
  GameState,
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
  connections: Record<Seat, Connection | null> = { p1: null, p2: null };
  hostSocketId: string | null = null;
  hostToken: string;
  spectatorSocketIds = new Set<string>();

  private preShotGroupCleared = false;
  private shotEvents: SimEvent[] = [];
  private loopHandle: ReturnType<typeof setInterval> | null = null;

  constructor(code: string, io: IoServer, hostToken: string) {
    this.code = code;
    this.io = io;
    this.hostToken = hostToken;
    this.gameState = createInitialGameState('Player 1', 'Player 2');
  }

  roomStateDTO(): RoomStateDTO {
    return {
      code: this.code,
      players: {
        p1: this.connections.p1 ? this.gameState.players.p1 : null,
        p2: this.connections.p2 ? this.gameState.players.p2 : null,
      },
      spectatorCount: this.spectatorSocketIds.size,
    };
  }

  broadcastRoomState(): void {
    this.io.to(this.code).emit('roomState', this.roomStateDTO());
  }

  broadcastGameState(): void {
    this.io.to(this.code).emit('gameState', this.gameState);
  }

  claimSeat(seat: Seat, name: string, socketId: string, isHost: boolean): { token: string } {
    const token = generateToken();
    this.connections[seat] = { seat, socketId, token, settings: { ...DEFAULT_SETTINGS } };
    this.gameState.players[seat] = {
      seat,
      name,
      connected: true,
      isHost,
      group: this.gameState.players[seat].group,
    };
    return { token };
  }

  findSeatByToken(token: string): Seat | null {
    for (const seat of ['p1', 'p2'] as Seat[]) {
      if (this.connections[seat]?.token === token) return seat;
    }
    return null;
  }

  reconnectSeat(seat: Seat, socketId: string): void {
    const conn = this.connections[seat];
    if (!conn) return;
    conn.socketId = socketId;
    this.gameState.players[seat].connected = true;
  }

  disconnectSocket(socketId: string): void {
    if (this.hostSocketId === socketId) this.hostSocketId = null;
    for (const seat of ['p1', 'p2'] as Seat[]) {
      const conn = this.connections[seat];
      if (conn?.socketId === socketId) {
        conn.socketId = null;
        this.gameState.players[seat].connected = false;
      }
    }
    this.spectatorSocketIds.delete(socketId);
    this.broadcastRoomState();
  }

  openSeat(): Seat | null {
    if (!this.connections.p1) return 'p1';
    if (!this.connections.p2) return 'p2';
    return null;
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
    const seatSocket = this.connections[payload.seat]?.socketId;

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
    const next = createInitialGameState(prev.players.p1.name, prev.players.p2.name);
    next.players.p1.connected = prev.players.p1.connected;
    next.players.p2.connected = prev.players.p2.connected;
    next.players.p1.isHost = prev.players.p1.isHost;
    next.players.p2.isHost = prev.players.p2.isHost;
    next.currentShooter = prev.currentShooter === 'p1' ? 'p2' : 'p1'; // alternate the break
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
        resolveShot(this.gameState, outcome, this.preShotGroupCleared);
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
