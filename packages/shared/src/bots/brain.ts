import { Vec2 } from '../vector.js';
import {
  BALL_DIAMETER,
  BALL_RADIUS,
  CUE_BALL_ID,
  EIGHT_BALL_ID,
  HEAD_STRING_X,
  JUMP_ELEVATION,
  MAX_SHOT_SPEED,
  MIN_SHOT_SPEED,
  ROLL_DECEL,
  TABLE_LENGTH,
  TABLE_WIDTH,
} from '../constants.js';
import { CUSHIONS, POCKETS, type Pocket } from '../table.js';
import { applyCueStrike, cloneBalls, runShot } from '../physics.js';
import { pathIsClear } from '../trajectory.js';
import {
  callRequirement,
  legalTargetBallIds,
  preShotFacts,
  resolveShot,
  summarizeShot,
} from '../rules.js';
import { BOMB_RADIUS, physicsModsFor, type PowerId } from '../powers.js';
import type { Ball, GameState, Seat, ShootInput } from '../types.js';
import { botById, TIER_SKILL, type BotProfile, type BotSkill } from './roster.js';

/**
 * The bot's brain.
 *
 * It sees exactly what a person sees and plays with the same physics. Choosing a shot is three
 * steps:
 *
 *  1. **Propose** lines with geometry — direct pots, banks, combinations, kicks and jumps.
 *  2. **Play them out** with the real engine, then run the real rules over the result. That one
 *     move is what makes the bot understand every mode at once: it knows a scratch is ball in
 *     hand, that the 8 early loses, that a miss in Killer costs a life, and what it leaves.
 *  3. **Estimate how likely it is to come off** by replaying the best few with its own aiming
 *     error, and pick by expected value — playing safe when nothing good is on.
 *
 * Tiers differ in how much they search, whether they think about position and safety, and how
 * accurately they deliver the shot. Personalities tilt the choice: aggression, flair.
 */

export interface BotPlanRequest {
  state: GameState;
  seat: Seat;
  botId: string;
  seed: number;
  /** Overrides the tier's search budget — tests use this to keep runs short. */
  budgetMs?: number;
}

export type BotPlan =
  | {
      kind: 'shot';
      shot: ShootInput;
      /** Power Pool power to arm before shooting. */
      arm: PowerId | null;
      intent: 'break' | 'pot' | 'safety' | 'desperate';
      /** 0..1 — how good the bot thinks this is. Drives the "confident" chat lines. */
      confidence: number;
    }
  | { kind: 'place'; pos: { x: number; y: number } };

export type YieldFn = () => Promise<void>;

const defaultYield: YieldFn = () => new Promise((r) => setTimeout(r, 0));

/** Keep the tip well inside the safe grip: bots never gamble on a miscue they can't foresee. */
const SAFE_SPIN = 0.55;

/** A shot in the planning stage. */
interface Candidate {
  angle: number;
  power: number;
  spin: { x: number; y: number };
  elevation: number;
  arm: PowerId | null;
  kind: 'direct' | 'bank' | 'combo' | 'kick' | 'jump' | 'safety';
  /** Cue-ball travel to first contact — converts contact error into angle error. */
  cueDist: number;
  targetId: number;
  pocket: number | null;
  /** Geometric estimate, 0..1. */
  quality: number;
  /** Filled by simulation. */
  score?: number;
  expected?: number;
  call?: { ballId: number; pocketIndex: number } | null;
}

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

/**
 * Milliseconds for the thinking budget. Monotonic where available — a wall clock can jump (or, in
 * a test with faked timers, stand still, which turns a 15ms budget into an exhaustive search).
 */
function clock(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function cloneState(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Power that sends the cue ball `cueDist` and then the object ball `objDist` to the pocket. */
function estimatePower(cueDist: number, objDist: number, cut: number): number {
  const vObj = Math.sqrt(2 * ROLL_DECEL * objDist * 1.35) + 260;
  const vContact = vObj / Math.max(0.3, Math.cos(cut));
  const v0 = Math.sqrt(vContact * vContact + 2 * ROLL_DECEL * 1.6 * cueDist);
  return clamp((v0 - MIN_SHOT_SPEED) / (MAX_SHOT_SPEED - MIN_SHOT_SPEED), 0.12, 1);
}

/** Where to aim inside a pocket: just past the mouth, along its axis. */
function pocketAim(p: Pocket): { x: number; y: number } {
  return Vec2.add(p.mid, Vec2.scale(p.out, BALL_RADIUS * 0.9));
}

/** How cleanly a ball travelling along `dir` enters pocket `p`: 0 (shut) to 1 (square on). */
function approach(p: Pocket, dir: Vec2): number {
  const d = Vec2.dot(dir, p.out);
  if (p.kind === 'side') return d < 0.4 ? 0 : clamp((d - 0.4) / 0.5, 0, 1);
  return d < 0.25 ? 0 : clamp((d - 0.25) / 0.55, 0.35, 1);
}

function lineQuality(cut: number, cueDist: number, objDist: number, entry: number): number {
  const cutF = Math.pow(Math.max(0, Math.cos(cut)), 1.5);
  const distF = 1 / (1 + (cueDist * 0.45 + objDist) / 1400);
  return clamp(cutF * distF * (0.55 + 0.45 * entry) * 1.7, 0, 1);
}

interface Line {
  angle: number;
  power: number;
  cueDist: number;
  targetId: number;
  pocket: number;
  quality: number;
  ghost: Vec2;
  kind: 'direct' | 'bank' | 'combo' | 'kick' | 'jump';
}

/** Direct pots: every legal ball into every pocket that it can actually reach. */
function directLines(balls: Ball[], cuePos: Vec2, targets: number[], allowBlocked = false): Line[] {
  const out: Line[] = [];
  for (const id of targets) {
    const ball = balls.find((b) => b.id === id && !b.pocketed);
    if (!ball) continue;
    for (const p of POCKETS) {
      const aim = pocketAim(p);
      const toPocket = Vec2.normalize(Vec2.sub(aim, ball.pos));
      const entry = approach(p, toPocket);
      if (entry <= 0) continue;
      const ghost = Vec2.sub(ball.pos, Vec2.scale(toPocket, BALL_DIAMETER));
      const toGhost = Vec2.sub(ghost, cuePos);
      const cueDist = Vec2.length(toGhost);
      if (cueDist < 1) continue;
      const cut = Math.acos(clamp(Vec2.dot(Vec2.scale(toGhost, 1 / cueDist), toPocket), -1, 1));
      if (cut > 1.35) continue;
      if (!pathIsClear(balls, ball.pos, aim, [id, CUE_BALL_ID])) continue;
      const blocked = !pathIsClear(balls, cuePos, ghost, [CUE_BALL_ID, id]);
      if (blocked && !allowBlocked) continue;
      const objDist = Vec2.distance(ball.pos, aim);
      out.push({
        angle: Math.atan2(toGhost.y, toGhost.x),
        power: estimatePower(cueDist, objDist, cut),
        cueDist,
        targetId: id,
        pocket: p.index,
        quality: lineQuality(cut, cueDist, objDist, entry),
        ghost,
        kind: blocked ? 'jump' : 'direct',
      });
    }
  }
  return out.sort((a, b) => b.quality - a.quality);
}

/** The four long lines a ball's centre runs along when it touches each rail. */
const RAIL_LINES = [
  { axis: 'y' as const, at: BALL_RADIUS },
  { axis: 'y' as const, at: TABLE_WIDTH - BALL_RADIUS },
  { axis: 'x' as const, at: BALL_RADIUS },
  { axis: 'x' as const, at: TABLE_LENGTH - BALL_RADIUS },
];

function mirror(p: Vec2, rail: (typeof RAIL_LINES)[number]): Vec2 {
  return rail.axis === 'y' ? { x: p.x, y: 2 * rail.at - p.y } : { x: 2 * rail.at - p.x, y: p.y };
}

/** Where the line from `a` to `b` crosses a rail line, or null if it doesn't, or hits a mouth. */
function railPoint(a: Vec2, b: Vec2, rail: (typeof RAIL_LINES)[number]): Vec2 | null {
  const da = rail.axis === 'y' ? a.y - rail.at : a.x - rail.at;
  const db = rail.axis === 'y' ? b.y - rail.at : b.x - rail.at;
  if (da * db >= 0) return null;
  const t = da / (da - db);
  const hit = Vec2.add(a, Vec2.scale(Vec2.sub(b, a), t));
  // It must land on real cushion, not in a pocket mouth.
  const onRun = CUSHIONS.some((c) => {
    const isH = c.axis === 'h';
    if ((rail.axis === 'y') !== isH) return false;
    const base = isH ? c.base - c.side * BALL_RADIUS : c.base - c.side * BALL_RADIUS;
    if (Math.abs(base - rail.at) > 1) return false;
    const along = isH ? hit.x : hit.y;
    return along > c.from + BALL_RADIUS && along < c.to - BALL_RADIUS;
  });
  return onRun ? hit : null;
}

/** One-cushion banks: the object ball off a rail into a pocket. */
function bankLines(balls: Ball[], cuePos: Vec2, targets: number[]): Line[] {
  const out: Line[] = [];
  for (const id of targets) {
    const ball = balls.find((b) => b.id === id && !b.pocketed);
    if (!ball) continue;
    for (const p of POCKETS) {
      const aim = pocketAim(p);
      for (const rail of RAIL_LINES) {
        const image = mirror(aim, rail);
        const hit = railPoint(ball.pos, image, rail);
        if (!hit) continue;
        const outDir = Vec2.normalize(Vec2.sub(aim, hit));
        if (approach(p, outDir) <= 0) continue;
        if (!pathIsClear(balls, ball.pos, hit, [id, CUE_BALL_ID])) continue;
        if (!pathIsClear(balls, hit, aim, [id, CUE_BALL_ID])) continue;
        const dir = Vec2.normalize(Vec2.sub(hit, ball.pos));
        const ghost = Vec2.sub(ball.pos, Vec2.scale(dir, BALL_DIAMETER));
        const toGhost = Vec2.sub(ghost, cuePos);
        const cueDist = Vec2.length(toGhost);
        if (cueDist < 1) continue;
        const cut = Math.acos(clamp(Vec2.dot(Vec2.scale(toGhost, 1 / cueDist), dir), -1, 1));
        if (cut > 1.1) continue;
        if (!pathIsClear(balls, cuePos, ghost, [CUE_BALL_ID, id])) continue;
        const objDist = Vec2.distance(ball.pos, hit) + Vec2.distance(hit, aim);
        out.push({
          angle: Math.atan2(toGhost.y, toGhost.x),
          power: clamp(estimatePower(cueDist, objDist * 1.25, cut) + 0.08, 0.2, 1),
          cueDist,
          targetId: id,
          pocket: p.index,
          quality: lineQuality(cut, cueDist, objDist, 0.8) * 0.55,
          ghost,
          kind: 'bank',
        });
      }
    }
  }
  return out.sort((a, b) => b.quality - a.quality).slice(0, 10);
}

/** Combination lines: cue → A → B → pocket, where A is a legal first contact. */
function comboLines(balls: Ball[], cuePos: Vec2, targets: number[], pottable: (id: number) => boolean): Line[] {
  const out: Line[] = [];
  const live = balls.filter((b) => !b.pocketed && b.id !== CUE_BALL_ID);
  for (const id of targets) {
    const a = live.find((b) => b.id === id);
    if (!a) continue;
    for (const b of live) {
      if (b.id === a.id || !pottable(b.id)) continue;
      if (Vec2.distance(a.pos, b.pos) > TABLE_LENGTH * 0.3) continue;
      for (const p of POCKETS) {
        const aim = pocketAim(p);
        const toPocket = Vec2.normalize(Vec2.sub(aim, b.pos));
        if (approach(p, toPocket) <= 0) continue;
        const ghostB = Vec2.sub(b.pos, Vec2.scale(toPocket, BALL_DIAMETER));
        const aToGhostB = Vec2.sub(ghostB, a.pos);
        const aDist = Vec2.length(aToGhostB);
        if (aDist < 1) continue;
        const aDir = Vec2.scale(aToGhostB, 1 / aDist);
        const cutB = Math.acos(clamp(Vec2.dot(aDir, toPocket), -1, 1));
        if (cutB > 0.9) continue;
        const ghostA = Vec2.sub(a.pos, Vec2.scale(aDir, BALL_DIAMETER));
        const toGhostA = Vec2.sub(ghostA, cuePos);
        const cueDist = Vec2.length(toGhostA);
        if (cueDist < 1) continue;
        const cutA = Math.acos(clamp(Vec2.dot(Vec2.scale(toGhostA, 1 / cueDist), aDir), -1, 1));
        if (cutA > 0.9) continue;
        if (!pathIsClear(balls, cuePos, ghostA, [CUE_BALL_ID, a.id])) continue;
        if (!pathIsClear(balls, a.pos, ghostB, [a.id, b.id])) continue;
        if (!pathIsClear(balls, b.pos, aim, [b.id])) continue;
        const objDist = Vec2.distance(b.pos, aim);
        out.push({
          angle: Math.atan2(toGhostA.y, toGhostA.x),
          power: clamp(estimatePower(cueDist + aDist, objDist, cutA + cutB) + 0.12, 0.25, 1),
          cueDist,
          targetId: a.id,
          pocket: p.index,
          quality: lineQuality(cutA + cutB, cueDist + aDist, objDist, 0.8) * 0.6,
          ghost: ghostA,
          kind: 'combo',
        });
      }
    }
  }
  return out.sort((x, y) => y.quality - x.quality).slice(0, 8);
}

/** One-rail kicks at a legal ball — the way out of a snooker. */
function kickLines(balls: Ball[], cuePos: Vec2, targets: number[]): Line[] {
  const out: Line[] = [];
  for (const id of targets) {
    const ball = balls.find((b) => b.id === id && !b.pocketed);
    if (!ball) continue;
    for (const rail of RAIL_LINES) {
      const image = mirror(ball.pos, rail);
      const hit = railPoint(cuePos, image, rail);
      if (!hit) continue;
      if (!pathIsClear(balls, cuePos, hit, [CUE_BALL_ID])) continue;
      if (!pathIsClear(balls, hit, ball.pos, [CUE_BALL_ID, id])) continue;
      const dist = Vec2.distance(cuePos, hit) + Vec2.distance(hit, ball.pos);
      const toHit = Vec2.sub(hit, cuePos);
      out.push({
        angle: Math.atan2(toHit.y, toHit.x),
        power: clamp(0.25 + dist / 5000, 0.25, 0.7),
        cueDist: dist,
        targetId: id,
        pocket: -1,
        quality: 0.1,
        ghost: ball.pos,
        kind: 'kick',
      });
    }
  }
  return out;
}

/** The best geometric shot quality available from `cuePos`, 0..1. */
function bestQuality(balls: Ball[], cuePos: Vec2, targets: number[]): number {
  let best = 0;
  for (const line of directLines(balls, cuePos, targets)) best = Math.max(best, line.quality);
  return best;
}

export class BotBrain {
  private rng: () => number;
  private skill: BotSkill;
  private bot: BotProfile;
  private deadline = 0;
  private lastYield = 0;

  constructor(
    private req: BotPlanRequest,
    private yieldFn: YieldFn = defaultYield
  ) {
    this.rng = mulberry32(req.seed);
    this.bot = botById(req.botId) ?? botById('bot.pete')!;
    this.skill = TIER_SKILL[this.bot.tier];
  }

  async plan(): Promise<BotPlan> {
    const { state } = this.req;
    this.deadline = clock() + (this.req.budgetMs ?? this.skill.searchMs);
    this.lastYield = clock();
    if (state.phase === 'ball_in_hand') return this.placeCueBall();
    if (state.phase === 'break') return this.breakShot();
    return this.chooseShot(state);
  }

  // ---------------------------------------------------------------- helpers

  private async breathe(): Promise<void> {
    if (clock() - this.lastYield > 12) {
      await this.yieldFn();
      this.lastYield = clock();
    }
  }

  private outOfTime(): boolean {
    return clock() > this.deadline;
  }

  private cue(state: GameState): Ball | undefined {
    return state.balls.find((b) => b.id === CUE_BALL_ID && !b.pocketed);
  }

  /** Could this ball be legally potted by the shooter at some point (for combos)? */
  private pottable(state: GameState): (id: number) => boolean {
    const targets = new Set(legalTargetBallIds(state));
    if (state.mode === 'eightball') {
      const group = state.players[this.req.seat]?.group;
      return (id) => targets.has(id) || (group !== null && state.balls.find((b) => b.id === id)?.kind === group);
    }
    if (state.mode === 'nineball') return (id) => id === 9 || targets.has(id);
    return () => true;
  }

  /**
   * Plays a candidate out with the real engine and scores the result by running the real rules
   * over it. Returns the score and what it would call.
   */
  private evaluate(state: GameState, c: Candidate, angleError = 0, powerScale = 1): { score: number; call: Candidate['call'] } {
    const seat = this.req.seat;
    const balls = cloneBalls(state.balls);
    const cue = balls.find((b) => b.id === CUE_BALL_ID);
    if (!cue || cue.pocketed) return { score: -1e4, call: null };

    applyCueStrike(cue, c.angle + angleError, clamp(c.power * powerScale, 0.05, 1), c.spin, () => 1, c.elevation);
    const orbs = state.power?.orbs.map((o) => ({ ...o, pos: { ...o.pos } }));
    const run = runShot(balls, { mods: physicsModsFor(c.arm), orbs }, 120 * 14);
    const outcome = summarizeShot(run.events);

    // Nominate what the shot is meant to pot; judged on the ideal replay.
    const need = callRequirement(state);
    let call: Candidate['call'] = null;
    if (need !== 'none') {
      const legalPotted = outcome.potted.find((id) => id !== CUE_BALL_ID && (need === 'pocket' ? id === EIGHT_BALL_ID : true));
      if (legalPotted !== undefined) call = { ballId: legalPotted, pocketIndex: outcome.pottedIn[legalPotted] };
      else if (c.pocket !== null && c.pocket >= 0) call = { ballId: need === 'pocket' ? EIGHT_BALL_ID : c.targetId, pocketIndex: c.pocket };
    }

    const after = cloneState(state);
    after.balls = balls;
    const facts = preShotFacts(state);
    const livesBefore = state.players[seat]?.lives ?? 0;
    const scoreBefore = state.players[seat]?.score ?? 0;
    resolveShot(after, outcome, {
      ...facts,
      call: c.call ?? call,
      armed: c.arm,
      now: 0,
      rand: () => 0.5,
    });

    const me = after.players[seat];
    const myTeam = me?.team ?? null;
    const isMine = (s: Seat | null): boolean =>
      s !== null && (s === seat || (myTeam !== null && after.players[s]?.team === myTeam));

    if (after.phase === 'game_over') {
      return { score: isMine(after.winner) ? 10_000 : -10_000, call };
    }

    let score = 0;
    const potted = outcome.potted.filter((id) => id !== CUE_BALL_ID).length;
    if (state.mode === 'killer' && me) {
      const lost = livesBefore - (me.lives ?? 0);
      score -= lost * 320;
      if (me.eliminated) score -= 4000;
      score += potted * 40;
    }
    if (state.mode === 'power' && me) score += (me.score - scoreBefore) * 70 + outcome.collected.length * 30;

    const keeps = isMine(after.currentShooter);
    const cueAfter = after.balls.find((b) => b.id === CUE_BALL_ID && !b.pocketed);
    if (keeps) {
      score += 120 + potted * 45;
      if (cueAfter && after.phase !== 'ball_in_hand') {
        const next = bestQuality(after.balls, cueAfter.pos, legalTargetBallIds(after));
        score += next * 90 * (0.35 + this.skill.position);
      }
    } else {
      score -= 60;
      if (after.phase === 'ball_in_hand') {
        score -= 170;
      } else if (cueAfter) {
        const theirs = bestQuality(after.balls, cueAfter.pos, legalTargetBallIds(after));
        score -= theirs * 110 * (0.15 + this.skill.safety);
      }
    }
    return { score, call };
  }

  /** Mean score over a few executions with the bot's own error — its sense of what it can make. */
  private expectedScore(state: GameState, c: Candidate): number {
    const base = this.evaluate(state, c);
    c.call = base.call;
    const n = this.skill.samples;
    if (n <= 1) return base.score;
    let total = base.score;
    for (let i = 1; i < n; i++) {
      const side = i % 2 === 1 ? 1 : -1;
      const err = side * this.angleErrorFor(c.cueDist, 0.8);
      total += this.evaluate(state, c, err, 1 + (this.rng() - 0.5) * this.skill.powerError).score;
    }
    return total / n;
  }

  /** Angle error at the cue that produces a given multiple of the tier's contact error. */
  private angleErrorFor(cueDist: number, sigmas: number): number {
    return (this.skill.contactError * BALL_RADIUS * sigmas) / Math.max(BALL_RADIUS * 2, cueDist);
  }

  /** Delivers a chosen shot with the tier's error on top. */
  private execute(c: Candidate): ShootInput {
    const gauss = (this.rng() + this.rng() + this.rng() - 1.5) / 1.5; // ~N(0, 0.33·2)
    const angle = c.angle + gauss * this.angleErrorFor(c.cueDist, 1);
    const power = clamp(c.power * (1 + (this.rng() - 0.5) * 2 * this.skill.powerError), 0.08, 1);
    return {
      angle,
      power,
      spin: { x: clamp(c.spin.x, -SAFE_SPIN, SAFE_SPIN), y: clamp(c.spin.y, -SAFE_SPIN, SAFE_SPIN) },
      elevation: c.elevation,
      call: c.call ?? null,
    };
  }

  private fromLine(line: Line, extra: Partial<Candidate> = {}): Candidate {
    return {
      angle: line.angle,
      power: line.power,
      spin: { x: 0, y: 0 },
      elevation: line.kind === 'jump' ? JUMP_ELEVATION : 0,
      arm: null,
      kind: line.kind,
      cueDist: line.cueDist,
      targetId: line.targetId,
      pocket: line.pocket,
      quality: line.quality,
      ...extra,
    };
  }

  // ---------------------------------------------------------------- the break

  private breakShot(): BotPlan {
    const { state } = this.req;
    const cue = this.cue(state);
    const live = state.balls.filter((b) => !b.pocketed && b.id !== CUE_BALL_ID);
    if (!cue || live.length === 0) return this.fallback(state);
    // The apex is the object ball nearest the cue ball.
    const apex = live.reduce((best, b) => (Vec2.distance(b.pos, cue.pos) < Vec2.distance(best.pos, cue.pos) ? b : best));
    const dir = Vec2.sub(apex.pos, cue.pos);
    const tierPower = { rookie: 0.78, amateur: 0.9, pro: 0.97, master: 1 }[this.bot.tier];
    const c: Candidate = {
      angle: Math.atan2(dir.y, dir.x) + (this.rng() - 0.5) * 0.004,
      power: tierPower,
      spin: { x: 0, y: this.skill.spin ? 0.18 : 0 },
      elevation: 0,
      arm: this.pickBreakPower(state),
      kind: 'direct',
      cueDist: Vec2.length(dir),
      targetId: apex.id,
      pocket: null,
      quality: 1,
    };
    return { kind: 'shot', shot: this.execute(c), arm: c.arm, intent: 'break', confidence: 0.5 };
  }

  private held(state: GameState): PowerId[] {
    return state.power?.held[this.req.seat] ?? [];
  }

  private pickBreakPower(state: GameState): PowerId | null {
    return this.held(state).includes('bomb') ? 'bomb' : null;
  }

  // ---------------------------------------------------------------- a normal shot

  private async chooseShot(state: GameState): Promise<BotPlan> {
    const cue = this.cue(state);
    const targets = legalTargetBallIds(state);
    if (!cue || targets.length === 0) return this.fallback(state);

    const balls = state.balls;
    let lines = directLines(balls, cue.pos, targets).slice(0, this.skill.width);
    if (this.skill.creative || this.bot.style.flair > 0.5) {
      lines = lines.concat(bankLines(balls, cue.pos, targets).slice(0, this.skill.creative ? 6 : 2));
      lines = lines.concat(comboLines(balls, cue.pos, targets, this.pottable(state)).slice(0, this.skill.creative ? 5 : 2));
    }
    if (this.skill.creative) {
      // Blocked but otherwise makeable: worth a look over the top.
      const jumps = directLines(balls, cue.pos, targets, true).filter((l) => l.kind === 'jump').slice(0, 3);
      lines = lines.concat(jumps.map((l) => ({ ...l, power: Math.max(0.62, l.power + 0.2) })));
    }

    // ---- pass 1: every line, played once as planned
    const pool: Candidate[] = [];
    for (const line of lines) {
      const c = this.fromLine(line);
      c.score = this.evaluate(state, c).score;
      pool.push(c);
      await this.breathe();
      if (this.outOfTime() && pool.length >= 3) break;
    }

    // ---- pass 2: power, spin and power-up variants on the best few
    pool.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const variants: Candidate[] = [];
    // Masters work the cue ball properly: a grid of pace and spin, not just the four corners.
    const deep = this.bot.tier === 'master';
    const spins = !this.skill.spin
      ? []
      : deep
        ? [
            { x: 0, y: 0.3 },
            { x: 0, y: 0.55 },
            { x: 0, y: -0.3 },
            { x: 0, y: -0.55 },
            { x: 0.4, y: 0 },
            { x: -0.4, y: 0 },
            { x: 0.35, y: 0.35 },
            { x: -0.35, y: 0.35 },
            { x: 0.35, y: -0.35 },
            { x: -0.35, y: -0.35 },
          ]
        : [
            { x: 0, y: 0.45 },
            { x: 0, y: -0.45 },
            { x: 0.4, y: 0 },
            { x: -0.4, y: 0 },
          ];
    const scales = deep ? [0.72, 0.86, 1.15, 1.35] : [0.8, 1.25];
    const arms = this.held(state).filter((p): p is PowerId => p === 'bigPockets' || p === 'bomb');
    for (const base of pool.slice(0, deep ? 6 : 5)) {
      if (this.outOfTime()) break;
      for (const scale of scales) {
        variants.push({ ...base, power: clamp(base.power * scale, 0.1, 1), score: undefined });
      }
      for (const spin of spins) {
        variants.push({ ...base, spin, score: undefined });
        if (deep) variants.push({ ...base, spin, power: clamp(base.power * 1.2, 0.1, 1), score: undefined });
      }
      for (const arm of arms) variants.push({ ...base, arm, score: undefined });
    }
    for (const v of variants) {
      if (this.outOfTime()) break;
      v.score = this.evaluate(state, v).score;
      pool.push(v);
      await this.breathe();
    }

    // ---- pass 3: how likely is each of the top few to actually come off?
    pool.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const finalists = pool.slice(0, deep ? 8 : this.skill.samples > 1 ? 6 : 3);
    for (const c of finalists) {
      c.expected = this.skill.samples > 1 && !this.outOfTime() ? this.expectedScore(state, c) : (c.score ?? 0);
      if (c.call === undefined) c.call = this.evaluate(state, c).call;
      await this.breathe();
    }

    // ---- safeties, when nothing on the table is good enough
    const bestPot = finalists.reduce((m, c) => Math.max(m, c.expected ?? -1e9), -1e9);
    const threshold = 40 - this.bot.style.aggression * 80;
    if (this.skill.safety > 0 && state.mode !== 'killer' && bestPot < threshold) {
      const safeties = await this.safeties(state, cue, targets);
      finalists.push(...safeties);
    }
    if (finalists.length === 0) {
      const kicks = kickLines(balls, cue.pos, targets).map((l) => this.fromLine(l));
      for (const k of kicks.slice(0, 6)) {
        k.expected = this.evaluate(state, k).score;
        finalists.push(k);
      }
    }
    if (finalists.length === 0) return this.fallback(state);

    // ---- choose: best expected value, tilted by personality and sloppiness
    for (const c of finalists) {
      let e = c.expected ?? c.score ?? 0;
      if (c.kind !== 'safety') e += this.bot.style.aggression * 25;
      if (c.kind === 'bank' || c.kind === 'combo' || c.kind === 'jump') e += this.bot.style.flair * 30;
      c.expected = e;
    }
    finalists.sort((a, b) => (b.expected ?? 0) - (a.expected ?? 0));
    const band = { rookie: 90, amateur: 40, pro: 12, master: 0 }[this.bot.tier];
    const top = finalists[0].expected ?? 0;
    const acceptable = finalists.filter((c) => (c.expected ?? 0) >= top - band);
    const chosen = acceptable[Math.floor(this.rng() * acceptable.length) % acceptable.length];

    const arm = this.chooseArm(state, chosen);
    const confidence = clamp(((chosen.expected ?? 0) + 100) / 400, 0, 1);
    return {
      kind: 'shot',
      shot: this.execute(chosen),
      arm,
      intent: chosen.kind === 'safety' ? 'safety' : (chosen.expected ?? 0) < 0 ? 'desperate' : 'pot',
      confidence,
    };
  }

  /** Soft touches off each legal ball, scored purely on what they leave. */
  private async safeties(state: GameState, cue: Ball, targets: number[]): Promise<Candidate[]> {
    const out: Candidate[] = [];
    const near = targets
      .map((id) => state.balls.find((b) => b.id === id && !b.pocketed))
      .filter((b): b is Ball => Boolean(b))
      .sort((a, b) => Vec2.distance(a.pos, cue.pos) - Vec2.distance(b.pos, cue.pos))
      .slice(0, this.bot.tier === 'master' ? 4 : 3);
    const fractions = [-0.75, -0.4, 0, 0.4, 0.75];
    const powers = [0.2, 0.32, 0.45];
    for (const ball of near) {
      const toBall = Vec2.sub(ball.pos, cue.pos);
      const dist = Vec2.length(toBall);
      if (!pathIsClear(state.balls, cue.pos, ball.pos, [CUE_BALL_ID, ball.id])) continue;
      for (const f of fractions) {
        const offset = Math.asin(clamp((f * BALL_DIAMETER) / Math.max(dist, BALL_DIAMETER), -1, 1));
        for (const power of powers) {
          if (this.outOfTime() && out.length >= 4) return out;
          const c: Candidate = {
            angle: Math.atan2(toBall.y, toBall.x) + offset,
            power,
            spin: { x: 0, y: 0 },
            elevation: 0,
            arm: null,
            kind: 'safety',
            cueDist: dist,
            targetId: ball.id,
            pocket: null,
            quality: 0,
          };
          const r = this.evaluate(state, c);
          c.score = r.score;
          c.call = r.call;
          c.expected = r.score;
          out.push(c);
          await this.breathe();
        }
      }
    }
    return out.sort((a, b) => (b.expected ?? 0) - (a.expected ?? 0)).slice(0, 3);
  }

  /** Which rule-side power (if any) to arm for the chosen shot. */
  private chooseArm(state: GameState, chosen: Candidate): PowerId | null {
    if (chosen.arm) return chosen.arm;
    const held = this.held(state);
    if (held.length === 0) return null;
    const likely = (chosen.expected ?? 0) > 150;
    if (held.includes('double') && likely) return 'double';
    if (held.includes('extra') && !likely && chosen.kind !== 'safety') return 'extra';
    if (held.includes('freeze') && this.rng() < 0.5) return 'freeze';
    if (held.includes('bomb')) {
      const target = state.balls.find((b) => b.id === chosen.targetId);
      const cluster = target
        ? state.balls.filter((b) => !b.pocketed && b.id !== CUE_BALL_ID && Vec2.distance(b.pos, target.pos) < BOMB_RADIUS * 0.7).length
        : 0;
      if (cluster >= 4) return 'bomb';
    }
    if (held.length >= 3) return held[0];
    return null;
  }

  // ---------------------------------------------------------------- ball in hand

  private async placeCueBall(): Promise<BotPlan> {
    const { state } = this.req;
    const targets = legalTargetBallIds(state);
    const behindLine = state.ballInHandBehindLine;
    const margin = BALL_DIAMETER;
    const maxX = behindLine ? HEAD_STRING_X - BALL_RADIUS : TABLE_LENGTH - margin;
    const free = (pos: Vec2): boolean =>
      pos.x >= margin && pos.x <= maxX && pos.y >= margin && pos.y <= TABLE_WIDTH - margin &&
      state.balls.every((b) => b.pocketed || b.id === CUE_BALL_ID || Vec2.distance(b.pos, pos) >= BALL_DIAMETER * 1.15);

    const spots: Vec2[] = [];
    // Straight-ish behind each makeable line, at a few distances and slight angles.
    for (const id of targets) {
      const ball = state.balls.find((b) => b.id === id && !b.pocketed);
      if (!ball) continue;
      for (const p of POCKETS) {
        const toPocket = Vec2.normalize(Vec2.sub(pocketAim(p), ball.pos));
        if (approach(p, toPocket) <= 0) continue;
        for (const back of [140, 260, 420]) {
          for (const tilt of [-0.28, 0, 0.28]) {
            const dir = Vec2.fromAngle(Math.atan2(toPocket.y, toPocket.x) + Math.PI + tilt);
            spots.push(Vec2.add(Vec2.sub(ball.pos, Vec2.scale(toPocket, BALL_DIAMETER)), Vec2.scale(dir, back)));
          }
        }
      }
    }
    for (let i = 0; i < 24; i++) {
      spots.push({ x: margin + this.rng() * (maxX - margin), y: margin + this.rng() * (TABLE_WIDTH - margin * 2) });
    }

    const ranked = spots
      .filter(free)
      .map((pos) => ({ pos, q: bestQuality(state.balls, pos, targets) }))
      .sort((a, b) => b.q - a.q);
    if (ranked.length === 0) return { kind: 'place', pos: { x: TABLE_LENGTH * 0.2, y: TABLE_WIDTH / 2 } };

    // The stronger tiers also look one shot ahead from their best few spots.
    if (this.skill.position > 0.5) {
      let best = ranked[0];
      let bestScore = -Infinity;
      for (const cand of ranked.slice(0, 5)) {
        if (this.outOfTime()) break;
        const trial = cloneState(state);
        const cue = trial.balls.find((b) => b.id === CUE_BALL_ID)!;
        cue.pos = { ...cand.pos };
        cue.pocketed = false;
        trial.phase = 'aiming';
        const lines = directLines(trial.balls, cand.pos, targets).slice(0, 3);
        for (const line of lines) {
          const c = this.fromLine(line);
          const s = this.evaluate(trial, c).score;
          if (s > bestScore) {
            bestScore = s;
            best = cand;
          }
          await this.breathe();
        }
      }
      return { kind: 'place', pos: best.pos };
    }
    const band = this.bot.tier === 'rookie' ? 8 : 3;
    const pick = ranked[Math.floor(this.rng() * Math.min(band, ranked.length))];
    return { kind: 'place', pos: pick.pos };
  }

  /** Nothing sensible found: roll firmly at the nearest legal ball so at least it is not a foul. */
  private fallback(state: GameState): BotPlan {
    const cue = this.cue(state);
    const targets = legalTargetBallIds(state);
    const target = targets
      .map((id) => state.balls.find((b) => b.id === id && !b.pocketed))
      .filter((b): b is Ball => Boolean(b))
      .sort((a, b) => (cue ? Vec2.distance(a.pos, cue.pos) - Vec2.distance(b.pos, cue.pos) : 0))[0];
    const angle = cue && target ? Math.atan2(target.pos.y - cue.pos.y, target.pos.x - cue.pos.x) : this.rng() * Math.PI * 2;
    return {
      kind: 'shot',
      shot: { angle, power: 0.5, spin: { x: 0, y: 0 }, elevation: 0, call: null },
      arm: null,
      intent: 'desperate',
      confidence: 0,
    };
  }
}

/** Plans a bot's turn. `yieldFn` lets the search give the event loop back while it thinks. */
export function planBotTurn(req: BotPlanRequest, yieldFn?: YieldFn): Promise<BotPlan> {
  return new BotBrain(req, yieldFn).plan();
}

/** How long a bot pretends to think before its cue starts moving, in ms. */
export function botThinkMs(botId: string, rand: () => number = Math.random): number {
  const bot = botById(botId);
  const [lo, hi] = TIER_SKILL[bot?.tier ?? 'amateur'].thinkMs;
  return lo + rand() * (hi - lo);
}
