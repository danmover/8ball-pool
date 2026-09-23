import { Vec2 } from './vector.js';
import {
  BALL_DIAMETER,
  BALL_RADIUS,
  BREAK_BOOST,
  CUE_BALL_ID,
  EIGHT_BALL_ID,
  HEAD_STRING_X,
  MAX_ELEVATION,
  TABLE_LENGTH,
  TABLE_WIDTH,
} from './constants.js';
import { POCKETS } from './table.js';
import {
  applyCueStrike,
  cloneBalls,
  readStrike,
  restBall,
  runShot,
  SHOT_STEP,
} from './physics.js';
import { computeTrajectoryPreview, predictedPocket } from './trajectory.js';
import {
  callRequirement,
  createInitialGameState,
  legalTargetBallIds,
  preShotFacts,
  resolveShot,
  summarizeShot,
} from './rules.js';
import { armPower, modeDescriptor, spendArmed } from './modes/index.js';
import { physicsModsFor, type PowerId } from './powers.js';
import { challengeBalls, challengeById, CHALLENGES } from './challenges.js';
import { createTournament, nextMatch, recordFrameWin, roundReached } from './tournament.js';
import { cleanAvatar, resolveLoadout } from './cosmetics.js';
import { botById, botLine, pickBot, TIER_ORDER, type BotLine } from './bots/roster.js';
import type { BotPlan, BotPlanRequest } from './bots/brain.js';
import {
  DEFAULT_ROOM_SETTINGS,
  PROTOCOL_VERSION,
  isValidEmote,
  type ClientMsg,
  type HostMsg,
  type Identity,
  type KingView,
  type MatchResult,
  type MatchView,
  type MemberView,
  type PeerId,
  type RoomPhase,
  type RoomSettings,
  type RoomView,
  type SeatView,
  type ShotPlayback,
  type TournamentView,
} from './protocol.js';
import {
  emptyFrameStats,
  MAX_SEATS,
  seatId,
  seatIndex,
  type AimState,
  type FrameStats,
  type GameState,
  type Seat,
  type ShootInput,
} from './types.js';
import { ruleSetOrder } from './ruleSets.js';

/**
 * A table: the room, its seats, the match and every shot played on it.
 *
 * This is the whole game server, and it runs on whichever device hosts the table — a laptop on
 * the TV, a phone in a pub, or the same browser tab when playing a bot offline. It never touches
 * a socket: messages arrive through `receive()` and leave through `deps.send()`, so the same
 * class serves an in-page loopback, a relay across the internet, and the test suite.
 *
 * Shots are refereed here and then *described*, not streamed: one `shot` message carries the
 * balls before the strike, the strike itself and the settled result, and every device replays
 * the simulation locally. See `physics.runShot` for why that replay is exact.
 */

export interface SessionDeps {
  send(to: PeerId | '*', msg: HostMsg): void;
  /** Plans a bot's turn — in the browser this runs in a Web Worker. */
  runBot(req: BotPlanRequest): Promise<BotPlan>;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** Seed for racks, orbs, bots and the draw. */
  seed?: number;
  /** Called after anything worth persisting. */
  onChange?: () => void;
  /** Asks the transport to disconnect a peer (kicks). */
  dropPeer?: (peer: PeerId) => void;
}

export interface SessionInit {
  host: PeerId;
  identity: Identity;
  code: string | null;
  online: boolean;
  settings?: Partial<RoomSettings>;
  displayMode?: boolean;
}

interface Member {
  peer: PeerId;
  name: string;
  avatar: Identity['avatar'];
  level: number;
  loadout: Identity['loadout'];
  connected: boolean;
  greeted: boolean;
  lastEmoteAt: number;
}

/** How long after the balls stop before the next turn starts, so the result can be read. */
const TURN_GAP_MS = 350;
/** Pause between frames of a match. */
const INTERMISSION_MS = 4500;
/** A disconnected player's seat is covered by a bot after this long, mid-match. */
const TAKEOVER_MS = 30_000;
/** An empty lobby seat is freed after its owner has been gone this long. */
const LOBBY_RELEASE_MS = 90_000;
/** Aim updates relayed per seat, at most this often. */
const AIM_RELAY_MS = 50;
const EMOTE_COOLDOWN_MS = 1200;
/** Practice keeps this many shots to undo. */
const UNDO_DEPTH = 25;
/** A streak of this many wins the table in Winner Stays On. */
const KING_TARGET = 3;

const TIER_STRENGTH = { rookie: 1, amateur: 2, pro: 3.4, master: 5 } as const;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function finite(n: unknown, lo: number, hi: number, fallback: number): number {
  return typeof n === 'number' && Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
}

function cleanName(raw: unknown, fallback = 'Player'): string {
  const s = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, 16) : '';
  return s || fallback;
}

function addStats(a: FrameStats, b: FrameStats): FrameStats {
  return {
    shots: a.shots + b.shots,
    pots: a.pots + b.pots,
    fouls: a.fouls + b.fouls,
    bestRun: Math.max(a.bestRun, b.bestRun),
    bestShot: Math.max(a.bestShot, b.bestShot),
  };
}

/** Clamps a settings patch to what the table can actually do. */
export function sanitizeSettings(base: RoomSettings, patch: Partial<RoomSettings>): RoomSettings {
  const next: RoomSettings = { ...base };
  if (patch.mode && modeDescriptor(patch.mode).id === patch.mode) next.mode = patch.mode;
  if (patch.ruleSet && ruleSetOrder().includes(patch.ruleSet)) next.ruleSet = patch.ruleSet;
  if (patch.raceTo !== undefined) next.raceTo = Math.round(finite(patch.raceTo, 1, 7, base.raceTo));
  if (patch.shotClock !== undefined) {
    next.shotClock = patch.shotClock === null ? null : Math.round(finite(patch.shotClock, 10, 90, 30));
  }
  if (patch.guide && ['full', 'short', 'off'].includes(patch.guide)) next.guide = patch.guide;
  if (patch.format && ['match', 'tournament', 'king'].includes(patch.format)) next.format = patch.format;
  if (patch.entrants !== undefined) next.entrants = finite(patch.entrants, 4, 8, 8) > 4 ? 8 : 4;
  if (patch.visibility && ['private', 'public'].includes(patch.visibility)) next.visibility = patch.visibility;
  if (patch.botTier && TIER_ORDER.includes(patch.botTier)) next.botTier = patch.botTier;
  if (patch.challengeId !== undefined) {
    next.challengeId = patch.challengeId && challengeById(patch.challengeId) ? patch.challengeId : null;
  }
  if (patch.seats !== undefined) next.seats = Math.round(finite(patch.seats, 1, MAX_SEATS, base.seats));

  const desc = modeDescriptor(next.mode);
  if (desc.solo) {
    next.seats = 1;
    next.format = 'match';
    next.raceTo = 1;
    next.shotClock = null;
  } else {
    if (next.format === 'match') next.seats = Math.max(desc.minPlayers, Math.min(desc.maxPlayers, next.seats));
    // Brackets and the king's queue are one-on-one.
    if (next.format !== 'match' && !['eightball', 'nineball'].includes(next.mode)) next.mode = 'eightball';
    if (next.format === 'king') next.seats = Math.max(3, Math.min(MAX_SEATS, next.seats));
    if (next.format === 'tournament') next.seats = next.entrants;
  }
  if (!desc.supportsShotClock) next.shotClock = null;
  return next;
}

export class TableSession {
  readonly host: PeerId;
  readonly code: string | null;
  readonly online: boolean;
  private settings: RoomSettings;
  private displayMode: boolean;
  private seats: (SeatView | null)[] = [];
  private members = new Map<PeerId, Member>();
  private phase: RoomPhase = 'lobby';
  game: GameState | null = null;
  private match: MatchView | null = null;
  private tournament: TournamentView | null = null;
  private king: KingView | null = null;
  private result: MatchResult | null = null;
  private rematchVotes = new Set<number>();
  private seq = 0;
  private shotId = 0;
  private busyUntil = 0;
  private clockDeadline: number | null = null;
  private clockTotal = 0;
  private timers = new Map<string, unknown>();
  private rng: () => number;
  private history: GameState[] = [];
  private taStartedAt: number | null = null;
  private lastAimAt = new Map<Seat, number>();
  private botAngle = new Map<number, number>();
  /** Bumped whenever a bot's in-flight plan should be abandoned. */
  private botEpoch = 0;
  private deps: Required<Omit<SessionDeps, 'onChange' | 'dropPeer' | 'seed'>> &
    Pick<SessionDeps, 'onChange' | 'dropPeer'>;

  constructor(init: SessionInit, deps: SessionDeps) {
    this.host = init.host;
    this.code = init.code;
    this.online = init.online;
    this.displayMode = init.displayMode ?? false;
    this.settings = sanitizeSettings(DEFAULT_ROOM_SETTINGS, init.settings ?? {});
    this.rng = mulberry32(deps.seed ?? Math.floor(Math.random() * 2 ** 31));
    this.deps = {
      send: deps.send,
      runBot: deps.runBot,
      now: deps.now ?? (() => Date.now()),
      setTimer: deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms)),
      clearTimer: deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)),
      onChange: deps.onChange,
      dropPeer: deps.dropPeer,
    };
    this.resizeSeats();
    this.members.set(this.host, {
      peer: this.host,
      ...this.cleanIdentity(init.identity),
      connected: true,
      greeted: true,
      lastEmoteAt: 0,
    });
    if (!this.displayMode) this.seatHuman(0, this.host);
  }

  // ================================================================ views

  view(): RoomView {
    const hostMember = this.members.get(this.host);
    return {
      code: this.code,
      online: this.online,
      host: this.host,
      displayMode: this.displayMode,
      settings: { ...this.settings },
      seats: this.seats.map((s) => (s ? { ...s } : null)),
      members: [...this.members.values()].map(
        (m): MemberView => ({
          peer: m.peer,
          name: m.name,
          avatar: m.avatar,
          level: m.level,
          isHost: m.peer === this.host,
          connected: m.connected,
        })
      ),
      phase: this.phase,
      match: this.match ? clone(this.match) : null,
      tournament: this.tournament ? clone(this.tournament) : null,
      king: this.king ? clone(this.king) : null,
      result: this.result ? clone(this.result) : null,
      rematch: [...this.rematchVotes],
      table: hostMember?.loadout.table ?? 'table.club',
      balls: hostMember?.loadout.balls ?? 'balls.classic',
    };
  }

  get roomPhase(): RoomPhase {
    return this.phase;
  }

  get roomSettings(): RoomSettings {
    return { ...this.settings };
  }

  /** The game as clients will see it, with the clock as time remaining. */
  private gameView(): GameState | null {
    if (!this.game) return null;
    const out = clone(this.game);
    out.clock =
      this.clockDeadline !== null
        ? { totalMs: this.clockTotal, remainingMs: Math.max(0, this.clockDeadline - this.deps.now()) }
        : null;
    if (out.timeAttack && this.taStartedAt !== null && out.phase !== 'game_over') {
      out.timeAttack.elapsedMs = Math.max(0, this.deps.now() - this.taStartedAt);
    }
    return out;
  }

  private broadcastRoom(): void {
    this.deps.send('*', { t: 'room', room: this.view() });
    this.deps.onChange?.();
  }

  private broadcastState(): void {
    const state = this.gameView();
    if (state) this.deps.send('*', { t: 'state', state, seq: ++this.seq });
    this.deps.onChange?.();
  }

  private notice(text: string, tone: 'info' | 'good' | 'bad' = 'info'): void {
    this.deps.send('*', { t: 'notice', text, tone });
  }

  // ================================================================ timers

  private schedule(key: string, ms: number, fn: () => void): void {
    this.cancel(key);
    const handle = this.deps.setTimer(() => {
      this.timers.delete(key);
      fn();
    }, Math.max(0, ms));
    this.timers.set(key, handle);
  }

  private cancel(key: string): void {
    const handle = this.timers.get(key);
    if (handle !== undefined) {
      this.deps.clearTimer(handle);
      this.timers.delete(key);
    }
  }

  destroy(): void {
    for (const handle of this.timers.values()) this.deps.clearTimer(handle);
    this.timers.clear();
    this.botEpoch++;
  }

  // ================================================================ seats & members

  private cleanIdentity(id: Partial<Identity>): Omit<Member, 'peer' | 'connected' | 'greeted' | 'lastEmoteAt'> {
    return {
      name: cleanName(id.name),
      avatar: cleanAvatar(id.avatar),
      level: Math.round(finite(id.level, 1, 999, 1)),
      loadout: resolveLoadout(id.loadout),
    };
  }

  private resizeSeats(): void {
    const n = this.settings.seats;
    while (this.seats.length < n) this.seats.push(null);
    // Never drop an occupied seat; trim empty ones from the end.
    while (this.seats.length > n && this.seats[this.seats.length - 1] === null) this.seats.pop();
    this.seats.forEach((s, i) => {
      if (s) s.index = i;
    });
  }

  private seatHuman(index: number, peer: PeerId, guest?: { name: string; avatar: Identity['avatar'] }): void {
    const m = this.members.get(peer);
    if (!m) return;
    this.seats[index] = {
      index,
      kind: 'human',
      peer,
      name: guest ? cleanName(guest.name, `Player ${index + 1}`) : m.name,
      avatar: guest ? cleanAvatar(guest.avatar) : m.avatar,
      level: guest ? 1 : m.level,
      loadout: m.loadout,
      botId: null,
      ready: peer === this.host,
      connected: m.connected,
      covering: false,
    };
  }

  private seatBot(index: number, botId: string): void {
    const bot = botById(botId);
    if (!bot) return;
    this.seats[index] = {
      index,
      kind: 'bot',
      peer: null,
      name: bot.name,
      avatar: bot.avatar,
      level: { rookie: 3, amateur: 12, pro: 28, master: 50 }[bot.tier],
      loadout: resolveLoadout(bot.loadout),
      botId: bot.id,
      ready: true,
      connected: true,
      covering: false,
    };
  }

  private takenBotIds(): string[] {
    return this.seats.filter((s): s is SeatView => s !== null && s.botId !== null).map((s) => s.botId!);
  }

  private seatOf(peer: PeerId): number {
    return this.seats.findIndex((s) => s?.peer === peer && s.kind === 'human');
  }

  /** Does `peer` control seat `index` right now? */
  private controls(peer: PeerId, index: number): boolean {
    const s = this.seats[index];
    return !!s && s.kind === 'human' && s.peer === peer && !s.covering;
  }

  /** Is the seat played by the computer at the moment — a bot, or a bot covering for someone? */
  private botControlled(index: number): string | null {
    const s = this.seats[index];
    if (!s) return null;
    if (s.kind === 'bot') return s.botId;
    return s.covering ? s.botId : null;
  }

  private isHost(peer: PeerId): boolean {
    return peer === this.host;
  }

  // ================================================================ inbound

  /** A peer's connection closed. */
  peerLeft(peer: PeerId): void {
    const m = this.members.get(peer);
    if (!m || peer === this.host) return;
    m.connected = false;
    for (const s of this.seats) if (s?.peer === peer) s.connected = false;
    if (this.phase === 'lobby') {
      this.schedule(`release:${peer}`, LOBBY_RELEASE_MS, () => {
        this.seats = this.seats.map((s) => (s?.peer === peer ? null : s));
        this.members.delete(peer);
        this.broadcastRoom();
      });
    } else {
      this.schedule(`takeover:${peer}`, TAKEOVER_MS, () => this.coverFor(peer));
    }
    this.broadcastRoom();
  }

  /** Puts a bot in for somebody who has dropped out mid-match, until they come back. */
  private coverFor(peer: PeerId): void {
    let changed = false;
    this.seats.forEach((s, i) => {
      if (!s || s.peer !== peer || s.connected || s.covering) return;
      s.covering = true;
      s.botId = pickBot(this.settings.botTier, this.takenBotIds(), this.rng).id;
      changed = true;
      this.notice(`${s.name} dropped out — a bot is covering`, 'info');
      if (this.game && seatIndex(this.game.currentShooter) === i) this.onTurnReady();
    });
    if (changed) this.broadcastRoom();
  }

  receive(peer: PeerId, msg: ClientMsg): void {
    if (!msg || typeof msg !== 'object' || typeof (msg as { t?: unknown }).t !== 'string') return;
    if (msg.t === 'hello') {
      this.hello(peer, msg);
      return;
    }
    const member = this.members.get(peer);
    if (!member) return;

    switch (msg.t) {
      case 'identity':
        this.updateIdentity(member, msg);
        return;
      case 'sit':
        this.sit(peer, msg.seat);
        return;
      case 'ready':
        this.setReady(peer, !!msg.ready);
        return;
      case 'aim':
        this.relayAim(peer, msg.aim);
        return;
      case 'shoot':
        this.shoot(peer, msg.shot);
        return;
      case 'place':
        this.place(peer, msg.pos, !!msg.commit);
        return;
      case 'arm':
        this.arm(peer, msg.power);
        return;
      case 'emote':
        this.emote(member, msg.id);
        return;
      case 'rematch':
        this.voteRematch(peer);
        return;
      case 'ping':
        this.deps.send(peer, { t: 'pong', at: msg.at });
        return;
    }

    if (!this.isHost(peer)) return;
    switch (msg.t) {
      case 'settings':
        this.configure(msg.patch);
        return;
      case 'addBot':
        this.addBot(msg.seat, msg.botId ?? null, msg.tier);
        return;
      case 'addGuest':
        this.addGuest(msg.seat, msg.name, msg.avatar);
        return;
      case 'clearSeat':
        this.clearSeat(msg.seat);
        return;
      case 'kick':
        this.kick(msg.peer);
        return;
      case 'display':
        this.setDisplay(!!msg.on);
        return;
      case 'start':
        this.start();
        return;
      case 'toLobby':
        this.toLobby();
        return;
      case 'practice':
        this.practice(msg.action);
        return;
    }
  }

  private hello(peer: PeerId, msg: Extract<ClientMsg, { t: 'hello' }>): void {
    if (msg.v !== PROTOCOL_VERSION) {
      this.deps.send(peer, { t: 'kicked', reason: 'This table is running a different version of the game. Refresh and try again.' });
      this.deps.dropPeer?.(peer);
      return;
    }
    const identity = this.cleanIdentity(msg);
    const existing = this.members.get(peer);
    const returning = !!existing;
    if (existing) {
      Object.assign(existing, identity, { connected: true });
    } else {
      if (this.members.size >= 24) {
        this.deps.send(peer, { t: 'kicked', reason: 'This table is full.' });
        this.deps.dropPeer?.(peer);
        return;
      }
      this.members.set(peer, { peer, ...identity, connected: true, greeted: false, lastEmoteAt: 0 });
    }
    this.cancel(`release:${peer}`);
    this.cancel(`takeover:${peer}`);

    // Reclaim a seat, including one a bot was covering.
    let reclaimed = false;
    this.seats.forEach((s) => {
      if (s?.peer !== peer) return;
      s.connected = true;
      if (s.covering) {
        s.covering = false;
        s.botId = null;
        reclaimed = true;
      }
    });

    // Newcomers in the lobby take the first free seat.
    if (this.phase === 'lobby' && this.seatOf(peer) === -1) {
      const free = this.seats.findIndex((s) => s === null);
      if (free !== -1) this.seatHuman(free, peer);
    }

    this.deps.send(peer, { t: 'welcome', you: peer, host: this.host, v: PROTOCOL_VERSION });
    this.broadcastRoom();
    const state = this.gameView();
    if (state) this.deps.send(peer, { t: 'state', state, seq: ++this.seq });
    if (!returning) this.notice(`${identity.name} joined the table`, 'info');
    if (reclaimed && this.game) this.onTurnReady();
  }

  private updateIdentity(member: Member, id: Identity): void {
    Object.assign(member, this.cleanIdentity(id));
    for (const s of this.seats) {
      if (s?.peer !== member.peer || s.kind !== 'human') continue;
      // Guests seated from the host keep their own names.
      if (member.peer !== this.host || s.index === this.seatOf(this.host)) {
        s.name = member.name;
        s.avatar = member.avatar;
        s.level = member.level;
      }
      s.loadout = member.loadout;
    }
    this.broadcastRoom();
  }

  private sit(peer: PeerId, index: number | null): void {
    if (this.phase !== 'lobby' && this.phase !== 'results') return;
    const current = this.seatOf(peer);
    if (index === null) {
      if (current !== -1) this.seats[current] = null;
      this.broadcastRoom();
      return;
    }
    if (!Number.isInteger(index) || index < 0 || index >= this.seats.length) return;
    if (this.seats[index] !== null) return;
    if (current !== -1) this.seats[current] = null;
    this.seatHuman(index, peer);
    this.rematchVotes.clear();
    this.broadcastRoom();
  }

  private setReady(peer: PeerId, ready: boolean): void {
    for (const s of this.seats) if (s?.peer === peer) s.ready = ready;
    this.broadcastRoom();
  }

  private emote(member: Member, id: string): void {
    if (!isValidEmote(id)) return;
    const now = this.deps.now();
    if (now - member.lastEmoteAt < EMOTE_COOLDOWN_MS) return;
    member.lastEmoteAt = now;
    const seat = this.seatOf(member.peer);
    this.deps.send('*', { t: 'emote', peer: member.peer, seat: seat === -1 ? null : seat, name: member.name, id });
  }

  private botSay(index: number, kind: BotLine, chance = 1): void {
    const id = this.botControlled(index);
    const bot = botById(id);
    if (!bot || this.rng() > chance * bot.style.chatter) return;
    const text = botLine(bot, kind, this.rng);
    if (text) this.deps.send('*', { t: 'say', seat: index, text });
  }

  // ================================================================ host controls

  configure(patch: Partial<RoomSettings>): void {
    if (this.phase !== 'lobby' && this.phase !== 'results') return;
    this.settings = sanitizeSettings(this.settings, patch);
    if (!this.online && this.settings.visibility === 'public') this.settings.visibility = 'private';
    this.resizeSeats();
    // A solo table has one seat, and it is the host's.
    if (modeDescriptor(this.settings.mode).solo) {
      this.seats = [null];
      this.seatHuman(0, this.host);
    }
    this.phase = 'lobby';
    this.result = null;
    this.rematchVotes.clear();
    this.broadcastRoom();
  }

  private addBot(index: number, botId: string | null, tier?: RoomSettings['botTier']): void {
    if (this.phase !== 'lobby' && this.phase !== 'results') return;
    if (!Number.isInteger(index) || index < 0 || index >= this.seats.length) return;
    if (this.seats[index] && this.seats[index]!.kind !== 'bot') return;
    const chosen = botById(botId) ?? pickBot(tier ?? this.settings.botTier, this.takenBotIds(), this.rng);
    this.seatBot(index, chosen.id);
    this.broadcastRoom();
  }

  private addGuest(index: number, name: string, avatar: Identity['avatar']): void {
    if (this.phase !== 'lobby' && this.phase !== 'results') return;
    if (!Number.isInteger(index) || index < 0 || index >= this.seats.length || this.seats[index]) return;
    this.seatHuman(index, this.host, { name, avatar });
    this.seats[index]!.ready = true;
    this.broadcastRoom();
  }

  private clearSeat(index: number): void {
    if (this.phase !== 'lobby' && this.phase !== 'results') return;
    const s = this.seats[index];
    if (!s) return;
    this.seats[index] = null;
    this.broadcastRoom();
  }

  private kick(peer: PeerId): void {
    if (peer === this.host || !this.members.has(peer)) return;
    const name = this.members.get(peer)!.name;
    this.seats = this.seats.map((s) => (s?.peer === peer ? (this.phase === 'lobby' ? null : s) : s));
    // Mid-match, a kicked player's seat is played out by a bot.
    for (const s of this.seats) {
      if (s?.peer === peer) {
        s.peer = null;
        s.connected = true;
        s.covering = true;
        s.botId = pickBot(this.settings.botTier, this.takenBotIds(), this.rng).id;
      }
    }
    this.members.delete(peer);
    this.deps.send(peer, { t: 'kicked', reason: 'The host removed you from the table.' });
    this.deps.dropPeer?.(peer);
    this.notice(`${name} was removed`, 'info');
    this.broadcastRoom();
    if (this.game) this.onTurnReady();
  }

  private setDisplay(on: boolean): void {
    if (this.phase !== 'lobby' && this.phase !== 'results') return;
    this.displayMode = on;
    const mine = this.seats.findIndex((s) => s?.peer === this.host);
    if (on) {
      this.seats = this.seats.map((s) => (s?.peer === this.host ? null : s));
    } else if (mine === -1) {
      const free = this.seats.findIndex((s) => s === null);
      if (free !== -1) this.seatHuman(free, this.host);
    }
    this.broadcastRoom();
  }

  // ================================================================ starting

  start(): void {
    if (this.phase !== 'lobby' && this.phase !== 'results') return;
    const desc = modeDescriptor(this.settings.mode);
    this.result = null;
    this.rematchVotes.clear();
    this.tournament = null;
    this.king = null;
    this.history = [];
    this.taStartedAt = null;

    if (desc.solo) {
      this.seats = [null];
      this.seatHuman(0, this.host);
      this.beginMatch([0]);
      return;
    }

    const fmt = this.settings.format;
    if (fmt === 'tournament' || fmt === 'king') {
      const size = fmt === 'tournament' ? this.settings.entrants : Math.max(3, this.settings.seats);
      while (this.seats.length < size) this.seats.push(null);
      for (let i = 0; i < size; i++) {
        if (!this.seats[i]) this.seatBot(i, pickBot(this.settings.botTier, this.takenBotIds(), this.rng).id);
      }
      this.seats = this.seats.slice(0, size);
    } else {
      // Close the gaps so seats 0..n-1 are the players, in the order they sat.
      const seated = this.seats.filter((s): s is SeatView => s !== null);
      if (seated.length < desc.minPlayers) {
        this.deps.send(this.host, { t: 'error', message: `${desc.name} needs at least ${desc.minPlayers} players.` });
        return;
      }
      if (seated.length > desc.maxPlayers) {
        this.deps.send(this.host, { t: 'error', message: `${desc.name} seats at most ${desc.maxPlayers}.` });
        return;
      }
      this.seats = seated.map((s, i) => ({ ...s, index: i }));
      this.settings.seats = this.seats.length;
    }
    this.seats.forEach((s) => s && (s.ready = true));

    if (fmt === 'tournament') {
      const seeds = this.seats.map((_, i) => seatId(i));
      // Shuffle the draw so nobody always meets the same opponent first.
      for (let i = seeds.length - 1; i > 0; i--) {
        const j = Math.floor(this.rng() * (i + 1));
        [seeds[i], seeds[j]] = [seeds[j], seeds[i]];
      }
      this.tournament = { bracket: createTournament(seeds, this.settings.raceTo), simulated: [], current: null };
      this.phase = 'playing';
      this.nextTournamentTie();
      return;
    }
    if (fmt === 'king') {
      const order = this.seats.map((_, i) => i);
      this.king = { holder: order[0], streak: 0, queue: order.slice(1), target: KING_TARGET, best: null };
      this.beginMatch([order[0], order[1]], 1);
      return;
    }
    this.beginMatch(this.seats.map((_, i) => i));
  }

  private beginMatch(playing: number[], breaker = Math.floor(this.rng() * playing.length)): void {
    this.phase = 'playing';
    this.match = {
      raceTo: this.settings.format === 'king' ? 1 : this.settings.raceTo,
      frame: 1,
      wins: this.seats.map(() => 0),
      playing,
      breaker: playing[breaker % playing.length],
      stats: this.seats.map(() => emptyFrameStats()),
    };
    this.beginFrame();
    for (const i of playing) this.botSay(i, 'greet', 0.8);
  }

  private beginFrame(): void {
    const match = this.match!;
    const playing = match.playing;
    const seatIds = playing.map((i) => seatId(i));
    const names = playing.map((i) => this.seats[i]?.name ?? `Player ${i + 1}`);
    const breakerAt = Math.max(0, playing.indexOf(match.breaker));
    const game = createInitialGameState(this.settings.mode, names, {
      breaker: breakerAt,
      ruleSet: this.settings.ruleSet,
      rand: this.rng,
      seatIds,
    });
    for (const i of playing) game.players[seatId(i)].isBot = this.seats[i]?.kind === 'bot';

    if (this.settings.mode === 'trickshot') {
      const challenge = challengeById(this.settings.challengeId ?? '') ?? CHALLENGES[0];
      this.settings.challengeId = challenge.id;
      game.balls = challengeBalls(challenge);
      game.phase = 'aiming';
      game.trick = { challengeId: challenge.id, shotsUsed: 0, pottedOrder: [], stars: 0, failed: false };
    }
    this.game = game;
    this.history = [];
    this.busyUntil = 0;
    this.broadcastRoom();
    this.onTurnReady();
  }

  // ================================================================ turns

  private shooterIndex(): number {
    return this.game ? seatIndex(this.game.currentShooter) : -1;
  }

  private awaitingShot(): boolean {
    const p = this.game?.phase;
    return p === 'aiming' || p === 'break' || p === 'ball_in_hand';
  }

  /** The table has just become someone's to play. Starts their clock, or their bot. */
  private onTurnReady(): void {
    this.cancel('clock');
    this.cancel('bot');
    this.botEpoch++;
    this.clockDeadline = null;
    const game = this.game;
    if (!game || this.phase !== 'playing' || !this.awaitingShot()) {
      this.broadcastState();
      return;
    }
    const idx = this.shooterIndex();
    const botId = this.botControlled(idx);
    const from = Math.max(this.deps.now(), this.busyUntil);

    const seconds = this.settings.shotClock;
    if (!botId && seconds && modeDescriptor(game.mode).supportsShotClock) {
      this.clockTotal = seconds * 1000;
      this.clockDeadline = from + this.clockTotal;
      this.schedule('clock', this.clockDeadline - this.deps.now(), () => this.timeout());
    }
    this.broadcastState();
    if (botId) this.scheduleBot(idx, botId, from - this.deps.now());
  }

  private timeout(): void {
    const game = this.game;
    if (!game || !this.awaitingShot()) return;
    const facts = preShotFacts(game);
    resolveShot(
      game,
      {
        potted: [],
        pottedIn: {},
        banked: [],
        cueBallPocketed: false,
        eightBallPocketed: false,
        firstBallContacted: null,
        anyCushionAfterContact: false,
        cushionsBeforeContact: 0,
        objectBallsToRail: 0,
        collected: [],
        jumped: false,
      },
      { ...facts, timedOut: true, now: this.deps.now(), rand: this.rng }
    );
    this.notice(`${game.players[game.lastShooter!]?.name ?? 'Player'} ran out of time`, 'bad');
    if (game.phase === 'game_over') this.frameOver();
    else this.onTurnReady();
  }

  // ================================================================ aiming & shooting

  private relayAim(peer: PeerId, raw: AimState): void {
    const game = this.game;
    if (!game || !this.awaitingShot()) return;
    const idx = this.shooterIndex();
    if (!this.controls(peer, idx)) return;
    const now = this.deps.now();
    if (now - (this.lastAimAt.get(game.currentShooter) ?? 0) < AIM_RELAY_MS) return;
    this.lastAimAt.set(game.currentShooter, now);
    const aim: AimState = {
      angle: finite(raw?.angle, -1e3, 1e3, 0),
      spin: { x: finite(raw?.spin?.x, -1, 1, 0), y: finite(raw?.spin?.y, -1, 1, 0) },
      elevation: finite(raw?.elevation, 0, MAX_ELEVATION, 0),
      power: finite(raw?.power, 0, 1, 0),
    };
    this.deps.send('*', { t: 'aim', seat: game.currentShooter, aim });
  }

  private arm(peer: PeerId, power: PowerId | null): void {
    const game = this.game;
    if (!game || !this.controls(peer, this.shooterIndex())) return;
    if (armPower(game, game.currentShooter, power)) this.broadcastState();
  }

  private shoot(peer: PeerId, input: ShootInput): void {
    if (!this.controls(peer, this.shooterIndex())) return;
    this.executeShot(input);
  }

  /** Where the rules want a nomination and none (or a bad one) came in, read one off the aim. */
  private resolveCall(game: GameState, input: ShootInput): ShootInput['call'] {
    const need = callRequirement(game);
    if (need === 'none') return null;
    let call = input.call ?? null;
    const legal = legalTargetBallIds(game);
    const valid =
      call &&
      Number.isInteger(call.pocketIndex) &&
      call.pocketIndex >= 0 &&
      call.pocketIndex < POCKETS.length &&
      (need === 'pocket' || legal.includes(call.ballId));
    if (!valid) {
      const preview = computeTrajectoryPreview(game.balls, CUE_BALL_ID, input.angle, 'full', input.spin, input.power, input.elevation);
      const ballId = preview.firstContactBallId ?? legal[0] ?? EIGHT_BALL_ID;
      const pocket = predictedPocket(preview);
      const target = game.balls.find((b) => b.id === ballId);
      const nearest = target
        ? POCKETS.reduce((best, p) => (Vec2.distance(p.mid, target.pos) < Vec2.distance(best.mid, target.pos) ? p : best)).index
        : 0;
      call = { ballId, pocketIndex: pocket ?? nearest };
    }
    if (need === 'pocket') call = { ballId: EIGHT_BALL_ID, pocketIndex: call!.pocketIndex };
    return call;
  }

  private executeShot(raw: ShootInput): void {
    const game = this.game;
    if (!game || this.phase !== 'playing') return;
    if (game.phase !== 'aiming' && game.phase !== 'break') return;
    const now = this.deps.now();
    if (now < this.busyUntil - 150) return;
    const cue = game.balls.find((b) => b.id === CUE_BALL_ID);
    if (!cue || cue.pocketed) return;

    const input: ShootInput = {
      angle: finite(raw?.angle, -1e3, 1e3, 0),
      power: finite(raw?.power, 0, 1, 0.5),
      spin: { x: finite(raw?.spin?.x, -1, 1, 0), y: finite(raw?.spin?.y, -1, 1, 0) },
      elevation: finite(raw?.elevation, 0, MAX_ELEVATION, 0),
      call: null,
    };
    const mag = Math.sqrt(input.spin.x * input.spin.x + input.spin.y * input.spin.y);
    if (mag > 1) input.spin = { x: input.spin.x / mag, y: input.spin.y / mag };
    input.call = this.resolveCall(game, { ...input, call: raw?.call ?? null });

    this.cancel('clock');
    this.cancel('bot');
    this.clockDeadline = null;
    if (game.mode === 'practice') {
      this.history.push(clone(game));
      if (this.history.length > UNDO_DEPTH) this.history.shift();
    }

    const shooter = game.currentShooter;
    const facts = preShotFacts(game);
    const armed = spendArmed(game);
    const pre = cloneBalls(game.balls);
    const orbsBefore = game.power ? clone(game.power.orbs) : null;
    const boost = game.phase === 'break' ? BREAK_BOOST : 1;
    const strike = applyCueStrike(cue, input.angle, input.power, input.spin, this.rng, input.elevation, boost);
    const strikeState = readStrike(cue, strike.miscued);
    const run = runShot(game.balls, { mods: physicsModsFor(armed), orbs: game.power?.orbs });
    const outcome = summarizeShot(run.events);
    const durationMs = Math.round(run.steps * SHOT_STEP * 1000);

    if (game.mode === 'timeattack' && this.taStartedAt === null) this.taStartedAt = now;
    if (game.timeAttack && this.taStartedAt !== null) game.timeAttack.elapsedMs = now + durationMs - this.taStartedAt;

    resolveShot(game, outcome, {
      ...facts,
      call: input.call,
      armed,
      now: now + durationMs,
      rand: this.rng,
    });
    // Whatever went in, nothing is still moving.
    for (const b of game.balls) if (!b.pocketed) restBall(b);

    this.busyUntil = now + durationMs + TURN_GAP_MS;
    const playback: ShotPlayback = {
      id: ++this.shotId,
      seat: shooter,
      input,
      pre,
      strike: strikeState,
      mods: physicsModsFor(armed),
      orbs: orbsBefore,
      steps: run.steps,
      result: clone(game),
    };
    if (strike.miscued) playback.result.lastFoulReason = playback.result.lastFoulReason ?? 'Miscue!';
    this.deps.send('*', { t: 'shot', shot: playback, seq: ++this.seq });
    this.deps.onChange?.();

    const shooterIdx = seatIndex(shooter);
    this.schedule('turn', this.busyUntil - now, () => this.afterShot(shooterIdx));
  }

  private afterShot(shooterIdx: number): void {
    const game = this.game;
    if (!game) return;
    const last = game.lastShot;
    if (last && game.phase !== 'game_over') {
      if (last.foul) this.botSay(shooterIdx, 'foul', 0.6);
      else if (last.potted.length >= 2 || last.run >= 4) this.botSay(shooterIdx, 'goodShot', 0.7);
      else if (last.potted.length === 0) {
        this.botSay(shooterIdx, 'miss', 0.25);
        const next = this.shooterIndex();
        if (next !== shooterIdx) this.botSay(next, 'opponentMiss', 0.25);
      }
    }
    if (game.phase === 'game_over') this.frameOver();
    else this.onTurnReady();
  }

  // ================================================================ ball in hand

  /** Is `pos` somewhere the cue ball may legally be put down? */
  private legalPlacement(game: GameState, pos: { x: number; y: number }): boolean {
    const r = BALL_RADIUS;
    if (pos.x < r || pos.x > TABLE_LENGTH - r || pos.y < r || pos.y > TABLE_WIDTH - r) return false;
    const kitchen = game.phase === 'break' || game.ballInHandBehindLine;
    if (kitchen && pos.x > HEAD_STRING_X) return false;
    return game.balls.every((b) => b.id === CUE_BALL_ID || b.pocketed || Vec2.distance(b.pos, pos) >= BALL_DIAMETER);
  }

  private place(peer: PeerId, raw: { x: number; y: number }, commit: boolean): void {
    const game = this.game;
    if (!game || !this.controls(peer, this.shooterIndex())) return;
    this.placeCue(raw, commit);
  }

  private placeCue(raw: { x: number; y: number }, commit: boolean): void {
    const game = this.game!;
    const canPlace =
      game.phase === 'ball_in_hand' || game.phase === 'break' || (game.mode === 'practice' && game.phase === 'aiming');
    if (!canPlace || this.deps.now() < this.busyUntil - 150) return;
    const pos = { x: finite(raw?.x, 0, TABLE_LENGTH, TABLE_LENGTH / 4), y: finite(raw?.y, 0, TABLE_WIDTH, TABLE_WIDTH / 2) };
    if (!commit) {
      this.deps.send('*', { t: 'place', seat: game.currentShooter, pos });
      return;
    }
    if (!this.legalPlacement(game, pos)) return;
    const cue = game.balls.find((b) => b.id === CUE_BALL_ID)!;
    cue.pos = pos;
    cue.pocketed = false;
    restBall(cue);
    game.ballInHandBehindLine = false;
    if (game.phase === 'ball_in_hand') game.phase = 'aiming';
    this.broadcastState();
  }

  // ================================================================ bots

  private scheduleBot(idx: number, botId: string, delay: number): void {
    const epoch = this.botEpoch;
    const bot = botById(botId);
    const think = bot ? 900 + this.rng() * 900 : 1200;
    this.schedule('bot', delay + think, () => {
      if (epoch !== this.botEpoch || !this.game) return;
      const snapshot = clone(this.game);
      void this.deps
        .runBot({ state: snapshot, seat: this.game.currentShooter, botId, seed: Math.floor(this.rng() * 2 ** 31) })
        .then((plan) => {
          if (epoch !== this.botEpoch) return;
          this.performBotPlan(idx, plan, epoch);
        })
        .catch(() => {
          if (epoch !== this.botEpoch) return;
          this.performBotPlan(idx, { kind: 'shot', shot: { angle: 0, power: 0.4, spin: { x: 0, y: 0 }, elevation: 0 }, arm: null, intent: 'desperate', confidence: 0 }, epoch);
        });
    });
  }

  /** Plays a bot's plan out on screen the way a person would: move, line up, draw back, strike. */
  private performBotPlan(idx: number, plan: BotPlan, epoch: number): void {
    const game = this.game;
    if (!game || this.shooterIndex() !== idx) return;
    const seat = game.currentShooter;

    if (plan.kind === 'place') {
      const cue = game.balls.find((b) => b.id === CUE_BALL_ID)!;
      const from = cue.pocketed ? { x: TABLE_LENGTH * 0.25, y: TABLE_WIDTH / 2 } : { ...cue.pos };
      const steps = 10;
      for (let i = 1; i <= steps; i++) {
        this.schedule(`botmove${i}`, i * 45, () => {
          if (epoch !== this.botEpoch) return;
          const t = i / steps;
          const e = t * t * (3 - 2 * t);
          this.deps.send('*', {
            t: 'place',
            seat,
            pos: { x: from.x + (plan.pos.x - from.x) * e, y: from.y + (plan.pos.y - from.y) * e },
          });
        });
      }
      this.schedule('botplace', steps * 45 + 250, () => {
        if (epoch !== this.botEpoch) return;
        this.placeCue(plan.pos, true);
        const g = this.game!;
        if (!this.legalPlacement(g, plan.pos) && g.phase === 'ball_in_hand') {
          // The plan went stale; drop it anywhere legal.
          const fallback = this.findFreeSpot(g);
          this.placeCue(fallback, true);
        }
        this.onTurnReady();
      });
      return;
    }

    if (plan.arm) armPower(game, seat, plan.arm);
    const target = plan.shot.angle;
    const start = this.botAngle.get(idx) ?? target + (this.rng() - 0.5) * 1.6;
    let delta = target - start;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    const sweepSteps = 16;
    const sweepMs = 55;
    const chargeSteps = 8;
    for (let i = 1; i <= sweepSteps; i++) {
      this.schedule(`botaim${i}`, i * sweepMs, () => {
        if (epoch !== this.botEpoch) return;
        const t = i / sweepSteps;
        // Ease out, with a small overshoot-and-settle like a hand finding the line.
        const e = 1 - Math.pow(1 - t, 3) + Math.sin(t * Math.PI) * 0.03;
        this.deps.send('*', {
          t: 'aim',
          seat,
          aim: { angle: start + delta * e, spin: plan.shot.spin, elevation: plan.shot.elevation, power: 0 },
        });
      });
    }
    for (let i = 1; i <= chargeSteps; i++) {
      this.schedule(`botcharge${i}`, sweepSteps * sweepMs + 250 + i * 50, () => {
        if (epoch !== this.botEpoch) return;
        this.deps.send('*', {
          t: 'aim',
          seat,
          aim: { angle: target, spin: plan.shot.spin, elevation: plan.shot.elevation, power: (plan.shot.power * i) / chargeSteps },
        });
      });
    }
    if (plan.arm) this.broadcastState();
    this.schedule('botshoot', sweepSteps * sweepMs + 250 + chargeSteps * 50 + 180, () => {
      if (epoch !== this.botEpoch) return;
      this.botAngle.set(idx, target);
      this.executeShot(plan.shot);
    });
  }

  private findFreeSpot(game: GameState): { x: number; y: number } {
    const maxX = game.ballInHandBehindLine ? HEAD_STRING_X - BALL_RADIUS : TABLE_LENGTH - BALL_DIAMETER;
    for (let i = 0; i < 400; i++) {
      const pos = {
        x: BALL_DIAMETER + this.rng() * (maxX - BALL_DIAMETER),
        y: BALL_DIAMETER + this.rng() * (TABLE_WIDTH - BALL_DIAMETER * 2),
      };
      if (this.legalPlacement({ ...game, phase: 'ball_in_hand' }, pos)) return pos;
    }
    return { x: TABLE_LENGTH * 0.2, y: TABLE_WIDTH / 2 };
  }

  // ================================================================ frames & matches

  private frameOver(): void {
    const game = this.game!;
    const match = this.match!;
    this.cancel('clock');
    this.clockDeadline = null;

    for (const seat of game.seatOrder) {
      const i = seatIndex(seat);
      match.stats[i] = addStats(match.stats[i] ?? emptyFrameStats(), game.players[seat].frame);
    }

    const desc = modeDescriptor(game.mode);
    if (desc.solo) {
      const ta = game.timeAttack;
      const trick = game.trick;
      this.result = {
        winners: game.winner ? [seatIndex(game.winner)] : [],
        champion: null,
        frames: 1,
        standings: [{ seat: 0, wins: game.winner ? 1 : 0, stats: match.stats[0] }],
        solo: {
          stars: ta ? ta.stars : trick ? trick.stars : 0,
          timeMs: ta?.finalMs ?? null,
          challengeId: trick?.challengeId ?? null,
          failed: trick?.failed ?? false,
        },
      };
      this.phase = 'results';
      this.broadcastState();
      this.broadcastRoom();
      return;
    }

    // Who won the frame — the whole team in doubles.
    const winners = game.winner
      ? game.seatOrder
          .filter((s) => s === game.winner || (game.winningTeam && game.players[s].team === game.winningTeam))
          .map(seatIndex)
      : [];
    for (const w of winners) match.wins[w] = (match.wins[w] ?? 0) + 1;
    const lead = winners[0];
    for (const i of match.playing) {
      if (winners.includes(i)) this.botSay(i, 'win', 0.9);
      else this.botSay(i, 'lose', 0.9);
    }

    if (this.tournament) {
      const t = this.tournament;
      if (t.current && lead !== undefined) recordFrameWin(t.bracket, t.current, seatId(lead));
      const tie = t.bracket.matches.find((m) => m.id === t.current);
      if (tie?.winner || t.bracket.champion) {
        this.nextTournamentTie();
      } else {
        this.intermission();
      }
      return;
    }

    if (this.king) {
      const k = this.king;
      const [a, b] = match.playing;
      const winner = lead ?? a;
      const loser = winner === a ? b : a;
      if (winner === k.holder) k.streak++;
      else {
        k.holder = winner;
        k.streak = 1;
      }
      k.queue = k.queue.filter((s) => s !== winner && s !== loser);
      k.queue.push(loser);
      if (!k.best || k.streak > k.best.streak) k.best = { seat: k.holder, streak: k.streak };
      if (k.streak >= k.target) {
        this.finishMatch([k.holder], k.holder);
        return;
      }
      match.playing = [k.holder, k.queue[0]];
      match.breaker = k.queue[0];
      match.wins = this.seats.map(() => 0);
      this.intermission();
      return;
    }

    const decided = match.playing.some((i) => (match.wins[i] ?? 0) >= match.raceTo);
    if (decided) {
      this.finishMatch(winners, null);
      return;
    }
    // Alternate the break.
    const at = match.playing.indexOf(match.breaker);
    match.breaker = match.playing[(at + 1) % match.playing.length];
    this.intermission();
  }

  private intermission(): void {
    this.phase = 'intermission';
    this.broadcastState();
    this.broadcastRoom();
    this.schedule('frame', INTERMISSION_MS, () => {
      if (this.phase !== 'intermission' || !this.match) return;
      this.match.frame++;
      this.phase = 'playing';
      this.beginFrame();
    });
  }

  private finishMatch(winners: number[], champion: number | null): void {
    const match = this.match!;
    const everyone = this.tournament || this.king ? this.seats.map((_, i) => i) : match.playing;
    const reached = this.tournament ? roundReached(this.tournament.bracket) : null;
    const depth = (seat: number) => reached?.get(seatId(seat)) ?? 0;
    const standings = everyone
      .map((seat) => ({ seat, wins: match.wins[seat] ?? 0, stats: match.stats[seat] ?? emptyFrameStats() }))
      .sort((a, b) => {
        const aw = winners.includes(a.seat) ? 1 : 0;
        const bw = winners.includes(b.seat) ? 1 : 0;
        if (aw !== bw) return bw - aw;
        return depth(b.seat) - depth(a.seat) || b.wins - a.wins || b.stats.pots - a.stats.pots;
      });
    this.result = { winners, champion, frames: match.frame, standings, solo: null };
    this.phase = 'results';
    this.broadcastState();
    this.broadcastRoom();
  }

  /** Moves a bracket on: plays out bot-only ties instantly, then seats the next real one. */
  private nextTournamentTie(): void {
    const t = this.tournament!;
    const race = t.bracket.target;
    for (let guard = 0; guard < 64 && !t.bracket.champion; guard++) {
      const tie = nextMatch(t.bracket);
      if (!tie || !tie.a || !tie.b) break;
      const ai = seatIndex(tie.a);
      const bi = seatIndex(tie.b);
      if (this.seats[ai]?.kind !== 'bot' || this.seats[bi]?.kind !== 'bot') {
        t.current = tie.id;
        if (!this.match) {
          this.beginMatch([ai, bi]);
        } else {
          this.match.playing = [ai, bi];
          this.match.breaker = this.rng() < 0.5 ? ai : bi;
          this.match.wins = this.seats.map(() => 0);
          this.match.frame = this.match.frame + 1;
          if (this.phase === 'playing' && this.game?.phase === 'game_over') {
            this.phase = 'intermission';
            this.broadcastRoom();
            this.schedule('frame', INTERMISSION_MS + 1000, () => {
              this.phase = 'playing';
              this.beginFrame();
            });
          } else {
            this.beginFrame();
          }
        }
        return;
      }
      // Two bots: settle it by strength so nobody has to watch.
      const sa = TIER_STRENGTH[botById(this.seats[ai]!.botId)?.tier ?? 'amateur'];
      const sb = TIER_STRENGTH[botById(this.seats[bi]!.botId)?.tier ?? 'amateur'];
      while (!tie.winner) {
        recordFrameWin(t.bracket, tie.id, this.rng() < sa / (sa + sb) ? tie.a : tie.b);
      }
      t.simulated.push(tie.id);
      void race;
    }
    const champ = t.bracket.champion ? seatIndex(t.bracket.champion) : null;
    t.current = null;
    if (!this.match) {
      this.match = {
        raceTo: race,
        frame: 0,
        wins: this.seats.map(() => 0),
        playing: [],
        breaker: 0,
        stats: this.seats.map(() => emptyFrameStats()),
      };
    }
    this.finishMatch(champ !== null ? [champ] : [], champ);
  }

  private voteRematch(peer: PeerId): void {
    if (this.phase !== 'results') return;
    if (this.isHost(peer)) {
      this.start();
      return;
    }
    const idx = this.seatOf(peer);
    if (idx === -1) return;
    this.rematchVotes.add(idx);
    const humans = this.seats.filter((s) => s?.kind === 'human' && s.peer !== this.host).map((s) => s!.index);
    if (humans.every((i) => this.rematchVotes.has(i))) this.start();
    else this.broadcastRoom();
  }

  toLobby(): void {
    this.cancel('frame');
    this.cancel('turn');
    this.cancel('clock');
    this.cancel('bot');
    this.botEpoch++;
    this.phase = 'lobby';
    this.game = null;
    this.match = null;
    this.tournament = null;
    this.king = null;
    this.result = null;
    this.rematchVotes.clear();
    // Covering bots step aside; people who left are gone.
    this.seats = this.seats.map((s) => {
      if (!s) return null;
      if (s.kind === 'human' && s.peer === null) return null;
      return { ...s, covering: false, botId: s.kind === 'bot' ? s.botId : null, ready: s.kind === 'bot' || s.peer === this.host };
    });
    this.settings.seats = Math.max(this.settings.seats, 1);
    this.resizeSeats();
    this.broadcastRoom();
    this.deps.onChange?.();
  }

  // ================================================================ practice tools

  private practice(action: 'rerack' | 'undo'): void {
    const game = this.game;
    if (!game || game.mode !== 'practice' || this.deps.now() < this.busyUntil - 150) return;
    if (action === 'undo') {
      const prev = this.history.pop();
      if (!prev) return;
      this.game = prev;
    } else {
      this.history = [];
      this.beginFrame();
      return;
    }
    this.onTurnReady();
  }

  // ================================================================ persistence

  serialize(): string {
    return JSON.stringify({
      v: 1,
      settings: this.settings,
      displayMode: this.displayMode,
      seats: this.seats,
      members: [...this.members.values()],
      phase: this.phase,
      game: this.game,
      match: this.match,
      tournament: this.tournament,
      king: this.king,
      result: this.result,
      seq: this.seq,
      shotId: this.shotId,
      taStartedAt: this.taStartedAt,
    });
  }

  /** Rebuilds a session saved with `serialize()` — the host reloaded its tab mid-match. */
  static restore(json: string, init: SessionInit, deps: SessionDeps): TableSession {
    const s = new TableSession({ ...init }, deps);
    try {
      const data = JSON.parse(json);
      s.settings = sanitizeSettings(DEFAULT_ROOM_SETTINGS, data.settings ?? {});
      s.displayMode = !!data.displayMode;
      s.seats = data.seats ?? s.seats;
      s.members = new Map(
        (data.members ?? []).map((m: Member) => [m.peer, { ...m, connected: m.peer === init.host }])
      );
      if (!s.members.has(init.host)) {
        s.members.set(init.host, { peer: init.host, ...s.cleanIdentity(init.identity), connected: true, greeted: true, lastEmoteAt: 0 });
      }
      for (const seat of s.seats) if (seat && seat.peer !== init.host && seat.kind === 'human') seat.connected = false;
      s.phase = data.phase ?? 'lobby';
      s.game = data.game ?? null;
      s.match = data.match ?? null;
      s.tournament = data.tournament ?? null;
      s.king = data.king ?? null;
      s.result = data.result ?? null;
      s.seq = data.seq ?? 0;
      s.shotId = data.shotId ?? 0;
      s.taStartedAt = data.taStartedAt ?? null;
      if (s.phase === 'intermission') {
        s.schedule('frame', 1500, () => {
          if (!s.match) return;
          s.match.frame++;
          s.phase = 'playing';
          s.beginFrame();
        });
      }
    } catch {
      /* a corrupt save just starts a fresh lobby */
    }
    return s;
  }

  /** Kicks the turn machinery back into life after a restore. */
  resume(): void {
    this.broadcastRoom();
    if (this.phase === 'playing' && this.game) this.onTurnReady();
    else this.broadcastState();
  }
}
