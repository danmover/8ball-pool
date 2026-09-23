import type { Vec2 } from './vector.js';
import type { AimState, Ball, BotTier, FrameStats, GameMode, GameState, Seat, ShootInput } from './types.js';
import type { RuleSetId } from './ruleSets.js';
import type { Avatar, Loadout } from './cosmetics.js';
import type { Orb, PhysicsMods, PowerId } from './powers.js';
import type { StrikeState } from './physics.js';
import type { Tournament } from './tournament.js';

/**
 * Everything that crosses the wire between a host and the devices at its table.
 *
 * The host runs the game (`TableSession`). Clients send `ClientMsg`s and receive `HostMsg`s.
 * The relay in between never reads either — it only forwards — so this file is the whole
 * contract, and the same messages flow over an in-page loopback when playing offline.
 */

export const PROTOCOL_VERSION = 2;

export type PeerId = string;

export type RoomFormat = 'match' | 'tournament' | 'king';
export type GuideLevel = 'full' | 'short' | 'off';

export interface RoomSettings {
  mode: GameMode;
  ruleSet: RuleSetId;
  /** Frames needed to win a match (or a tournament tie). */
  raceTo: number;
  /** Seconds per shot, or null for no clock. */
  shotClock: number | null;
  /** How many seats the table has. */
  seats: number;
  /** The longest aim guide anyone at this table may use. */
  guide: GuideLevel;
  format: RoomFormat;
  /** Tournament size; bots fill the draw. */
  entrants: number;
  visibility: 'private' | 'public';
  /** Tier used for bots that fill a draw or take over a dropped seat. */
  botTier: BotTier;
  /** Trick-shot puzzle, when `mode` is `trickshot`. */
  challengeId: string | null;
}

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  mode: 'eightball',
  ruleSet: 'standard',
  raceTo: 1,
  shotClock: null,
  seats: 2,
  guide: 'full',
  format: 'match',
  entrants: 8,
  visibility: 'private',
  botTier: 'amateur',
  challengeId: null,
};

export interface SeatView {
  index: number;
  kind: 'human' | 'bot';
  /** Who controls it. A host can hold several seats (pass and play). */
  peer: PeerId | null;
  name: string;
  avatar: Avatar;
  level: number;
  loadout: Loadout;
  botId: string | null;
  ready: boolean;
  connected: boolean;
  /** A bot is playing this seat until its owner reconnects. */
  covering: boolean;
}

export interface MemberView {
  peer: PeerId;
  name: string;
  avatar: Avatar;
  level: number;
  isHost: boolean;
  connected: boolean;
}

export interface MatchView {
  raceTo: number;
  /** 1-based frame number. */
  frame: number;
  /** Frames won, per seat index. */
  wins: number[];
  /** Seat indices in the current frame. */
  playing: number[];
  /** Seat index that broke (or breaks next). */
  breaker: number;
  /** Stats for the whole match so far, per seat index. */
  stats: FrameStats[];
}

export interface TournamentView {
  bracket: Tournament;
  /** Match ids that were played out by the computer (bot against bot). */
  simulated: string[];
  /** The match on the table right now. */
  current: string | null;
}

export interface KingView {
  holder: number;
  streak: number;
  /** Seat indices waiting, front first. */
  queue: number[];
  /** A streak of this many wins the table. */
  target: number;
  best: { seat: number; streak: number } | null;
}

export interface MatchResult {
  /** Seat indices that won (two in doubles). */
  winners: number[];
  /** Tournament or king champion, when there is one. */
  champion: number | null;
  frames: number;
  /** Final standings, best first. */
  standings: { seat: number; wins: number; stats: FrameStats }[];
  /** Solo runs: stars, time, objective. */
  solo: { stars: number; timeMs: number | null; challengeId: string | null; failed: boolean } | null;
}

export type RoomPhase = 'lobby' | 'playing' | 'intermission' | 'results';

export interface RoomView {
  code: string | null;
  online: boolean;
  host: PeerId;
  /** The host screen is a display only; everyone plays from their own device. */
  displayMode: boolean;
  settings: RoomSettings;
  seats: (SeatView | null)[];
  members: MemberView[];
  phase: RoomPhase;
  match: MatchView | null;
  tournament: TournamentView | null;
  king: KingView | null;
  result: MatchResult | null;
  /** Seat indices that have asked for a rematch. */
  rematch: number[];
  /** Table skin everyone sees — the host's. */
  table: string;
}

/** One shot, everything every device needs to replay it identically. */
export interface ShotPlayback {
  id: number;
  seat: Seat;
  input: ShootInput;
  /** Balls before the strike. */
  pre: Ball[];
  /** The cue ball straight after the strike. */
  strike: StrikeState;
  mods: PhysicsMods;
  orbs: Orb[] | null;
  /** `SHOT_STEP`s to rest. */
  steps: number;
  /** The table and the rules' verdict once everything has stopped. */
  result: GameState;
}

export const EMOTES = ['👍', '👏', '😂', '😱', '🔥', '🎯', '😭', '😤', '🙈', '🤝'] as const;
export const QUICK_CHAT = [
  'Nice shot!',
  'Good game!',
  'Unlucky!',
  'Oops…',
  'Well played',
  'Hurry up!',
  'Thanks!',
  'Rematch?',
] as const;

/** `e:<index>` for an emoji, `q:<index>` for a quick-chat line. */
export function isValidEmote(id: string): boolean {
  const m = /^([eq]):(\d+)$/.exec(id);
  if (!m) return false;
  const i = Number(m[2]);
  return m[1] === 'e' ? i < EMOTES.length : i < QUICK_CHAT.length;
}

export function emoteText(id: string): string {
  const [kind, index] = id.split(':');
  return (kind === 'e' ? EMOTES[Number(index)] : QUICK_CHAT[Number(index)]) ?? '';
}

export interface Identity {
  name: string;
  avatar: Avatar;
  level: number;
  loadout: Loadout;
}

export type ClientMsg =
  | ({ t: 'hello'; v: number } & Identity)
  | ({ t: 'identity' } & Identity)
  | { t: 'sit'; seat: number | null }
  | { t: 'ready'; ready: boolean }
  | { t: 'aim'; aim: AimState }
  | { t: 'shoot'; shot: ShootInput }
  | { t: 'place'; pos: Vec2; commit: boolean }
  | { t: 'arm'; power: PowerId | null }
  | { t: 'emote'; id: string }
  | { t: 'rematch' }
  | { t: 'ping'; at: number }
  // ---- host only
  | { t: 'settings'; patch: Partial<RoomSettings> }
  | { t: 'addBot'; seat: number; botId?: string | null; tier?: BotTier }
  | { t: 'addGuest'; seat: number; name: string; avatar: Avatar }
  | { t: 'clearSeat'; seat: number }
  | { t: 'kick'; peer: PeerId }
  | { t: 'display'; on: boolean }
  | { t: 'start' }
  | { t: 'toLobby' }
  | { t: 'practice'; action: 'rerack' | 'undo' };

export type HostMsg =
  | { t: 'welcome'; you: PeerId; host: PeerId; v: number }
  | { t: 'room'; room: RoomView }
  | { t: 'state'; state: GameState; seq: number }
  | { t: 'shot'; shot: ShotPlayback; seq: number }
  | { t: 'aim'; seat: Seat; aim: AimState }
  | { t: 'place'; seat: Seat; pos: Vec2 }
  | { t: 'emote'; peer: PeerId; seat: number | null; name: string; id: string }
  | { t: 'say'; seat: number; text: string }
  | { t: 'notice'; text: string; tone: 'info' | 'good' | 'bad' }
  | { t: 'kicked'; reason: string }
  | { t: 'pong'; at: number }
  | { t: 'error'; message: string };
