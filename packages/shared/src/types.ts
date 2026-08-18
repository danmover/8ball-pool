import type { Vec2 } from './vector.js';

export type BallGroup = 'solid' | 'stripe';
export type BallKind = 'cue' | 'eight' | BallGroup;

export interface Ball {
  id: number; // 0 = cue, 1-7 solids, 8 = eight, 9-15 stripes
  kind: BallKind;
  pos: Vec2;
  vel: Vec2;
  spin: number; // side-spin scalar, -1..1, decays over time
  pocketed: boolean;
}

export type Seat = 'p1' | 'p2';

export interface PlayerInfo {
  seat: Seat;
  name: string;
  connected: boolean;
  isHost: boolean; // true if this seat is being played from the host screen
  group: BallGroup | null; // assigned after first legal pot post-break
}

export type TurnPhase =
  | 'break'
  | 'aiming'
  | 'shot_in_progress'
  | 'ball_in_hand'
  | 'game_over';

export interface GameState {
  balls: Ball[];
  players: Record<Seat, PlayerInfo>;
  currentShooter: Seat;
  phase: TurnPhase;
  winner: Seat | null;
  lastFoulReason: string | null;
  turnNumber: number;
}

export interface AimInput {
  seat: Seat;
  angle: number; // radians
  spin: { x: number; y: number }; // -1..1 each, tip offset on cue ball
}

export interface ShootInput extends AimInput {
  power: number; // 0..1
}

export interface BallInHandPlacement {
  seat: Seat;
  pos: Vec2;
}

export type TrajectoryPreviewMode = 'off' | 'basic' | 'full';
export type FeltTheme = 'green' | 'blue' | 'crimson' | 'midnight';

export interface PlayerSettings {
  trajectoryPreview: TrajectoryPreviewMode;
  soundEnabled: boolean;
  soundVolume: number; // 0..1
  hapticsEnabled: boolean;
  colorblindPatterns: boolean;
  leftHanded: boolean;
  feltTheme: FeltTheme;
  effectsIntensity: 'low' | 'high';
}

export const DEFAULT_SETTINGS: PlayerSettings = {
  trajectoryPreview: 'full',
  soundEnabled: true,
  soundVolume: 0.7,
  hapticsEnabled: true,
  colorblindPatterns: false,
  leftHanded: false,
  feltTheme: 'green',
  effectsIntensity: 'high',
};

export interface TrajectorySegment {
  from: Vec2;
  to: Vec2;
}

export interface TrajectoryPreview {
  cueBallPath: TrajectorySegment[];
  ghostBallPos: Vec2 | null;
  firstContactBallId: number | null;
  objectBallPath: TrajectorySegment[];
}

// ---- Socket event contracts ----

export interface ServerToClientEvents {
  roomState: (state: RoomStateDTO) => void;
  gameState: (state: GameState) => void;
  aimUpdate: (input: AimInput) => void;
  shotFired: (input: ShootInput) => void;
  simEvent: (event: SimEvent) => void;
  errorMessage: (message: string) => void;
}

export interface ClientToServerEvents {
  hostCreateRoom: (payload: { hostName: string }, cb: (res: { code: string; token: string }) => void) => void;
  hostRejoin: (
    payload: { code: string; token: string },
    cb: (res: { ok: boolean }) => void
  ) => void;
  joinRoom: (
    payload: { code: string; name: string; token?: string },
    cb: (res: { ok: true; seat: Seat; token: string } | { ok: false; error: string }) => void
  ) => void;
  hostClaimSeat: (payload: { seat: Seat }) => void;
  hostReleaseSeat: (payload: { seat: Seat }) => void;
  updateAim: (input: AimInput) => void;
  takeShot: (input: ShootInput) => void;
  placeCueBall: (payload: BallInHandPlacement) => void;
  updateSettings: (settings: Partial<PlayerSettings>) => void;
  requestRematch: () => void;
}

export interface RoomStateDTO {
  code: string;
  players: Record<Seat, PlayerInfo | null>;
  spectatorCount: number;
}

export type SimEvent =
  | { type: 'pot'; ballId: number; pos: Vec2 }
  | { type: 'cushion'; ballId: number; pos: Vec2; speed: number }
  | { type: 'ballCollision'; a: number; b: number; pos: Vec2; impulse: number }
  | { type: 'shotSettled' };
