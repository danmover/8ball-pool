/**
 * Proves every trick-shot layout can be made, and says how forgiving it is.
 *
 *   npx tsx scripts/solve-challenges.ts [challenge-id ...]
 *
 * Single-shot puzzles are brute-forced: a fine sweep of aim angles finds every line that pots
 * anything, then each is refined over power, spin and shot type. Whole-table puzzles are played
 * greedily from the ghost-ball lines, preferring the shot that leaves the most pots next. Both run
 * the real engine and the real rules — the same code that judges the player.
 *
 * The output ends with a solution per challenge, in the shape `challenges.test.ts` pins.
 */
import { CHALLENGES, challengeBalls, type Challenge } from '../src/challenges.js';
import { createInitialGameState, legalTargetBallIds, preShotFacts, resolveShot, summarizeShot } from '../src/rules.js';
import { applyCueStrike, cloneBalls, runShot } from '../src/physics.js';
import { BALL_RADIUS, CUE_BALL_ID, CURVE_ELEVATION, JUMP_ELEVATION } from '../src/constants.js';
import { POCKETS } from '../src/table.js';
import type { GameState } from '../src/types.js';

export interface Shot {
  angle: number;
  power: number;
  spin: { x: number; y: number };
  elevation: number;
}

const DEG = Math.PI / 180;

export function freshState(ch: Challenge): GameState {
  const s = createInitialGameState('trickshot', ['Solo']);
  s.balls = challengeBalls(ch);
  s.phase = 'aiming';
  s.trick = { challengeId: ch.id, shotsUsed: 0, pottedOrder: [], stars: 0, failed: false };
  return s;
}

export function play(state: GameState, shot: Shot): { after: GameState; potted: number[]; scratch: boolean } {
  const after: GameState = JSON.parse(JSON.stringify(state));
  const balls = cloneBalls(state.balls);
  const cue = balls.find((b) => b.id === CUE_BALL_ID)!;
  applyCueStrike(cue, shot.angle, shot.power, shot.spin, () => 1, shot.elevation);
  const run = runShot(balls);
  const outcome = summarizeShot(run.events);
  after.balls = balls;
  resolveShot(after, outcome, { ...preShotFacts(state), call: null, now: 0, rand: () => 0.5 });
  return { after, potted: outcome.potted.filter((id) => id !== CUE_BALL_ID), scratch: outcome.cueBallPocketed };
}

const won = (s: GameState): boolean => s.phase === 'game_over' && !s.trick?.failed;

type Kind = 'normal' | 'jump' | 'swerve';
const ELEVATION: Record<Kind, number> = { normal: 0, jump: JUMP_ELEVATION, swerve: CURVE_ELEVATION };

function kindsFor(ch: Challenge): Kind[] {
  if (ch.goal.kind === 'jump') return ['jump'];
  if (ch.set === 'Air and Swerve') return ['normal', 'swerve'];
  return ['normal'];
}

const SPINS = [
  { x: 0, y: 0 },
  { x: 0, y: 0.6 },
  { x: 0, y: -0.6 },
  { x: -0.5, y: 0 },
  { x: 0.5, y: 0 },
  { x: -0.5, y: 0.5 },
  { x: 0.5, y: 0.5 },
  { x: -0.5, y: -0.5 },
  { x: 0.5, y: -0.5 },
];

interface Found {
  shot: Shot;
  kind: Kind;
  /** Contiguous aim window, in degrees, at this power and spin. */
  width: number;
}

/** Every way to make a one-shot puzzle, with how much aim error each forgives. */
function solveSingle(ch: Challenge): { found: Found[]; tried: number } {
  const start = freshState(ch);
  let tried = 0;
  const found: Found[] = [];
  for (const kind of kindsFor(ch)) {
    const elevation = ELEVATION[kind];
    const scanPowers = kind === 'jump' ? [0.7, 1] : [0.35, 0.6, 0.9];
    const scanSpins = kind === 'swerve' ? [{ x: -0.6, y: 0 }, { x: 0.6, y: 0 }] : [{ x: 0, y: 0 }];
    // 1. Where does anything go in at all?
    const seeds: number[] = [];
    for (let a = 0; a < 3600; a++) {
      const angle = a * 0.1 * DEG;
      let hit = false;
      for (const power of scanPowers) {
        for (const spin of scanSpins) {
          tried++;
          const r = play(start, { angle, power, spin, elevation });
          if (won(r.after) || r.potted.length > 0) hit = true;
        }
      }
      if (hit) seeds.push(angle);
    }
    // 2. Refine around each of them.
    const spins = kind === 'swerve' ? SPINS.filter((s) => s.x !== 0) : SPINS;
    const powers = kind === 'jump' ? [0.6, 0.7, 0.8, 0.9, 1] : [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
    for (const seed of seeds) {
      for (const power of powers) {
        for (const spin of spins) {
          let run = 0;
          let best: Shot | null = null;
          let bestRun = 0;
          for (let k = -6; k <= 6; k++) {
            const angle = seed + k * 0.02 * DEG;
            tried++;
            const shot = { angle, power, spin, elevation };
            if (won(play(start, shot).after)) {
              run++;
              if (run > bestRun) {
                bestRun = run;
                best = { ...shot, angle: angle - ((run - 1) / 2) * 0.02 * DEG };
              }
            } else run = 0;
          }
          if (best) found.push({ shot: best, kind, width: bestRun * 0.02 });
        }
      }
    }
  }
  found.sort((a, b) => b.width - a.width);
  return { found, tried };
}

/** Ghost-ball aim angles at every legal ball for every pocket. */
function potLines(state: GameState): number[] {
  const cue = state.balls.find((b) => b.id === CUE_BALL_ID && !b.pocketed)!;
  const out: number[] = [];
  for (const id of legalTargetBallIds(state)) {
    const ball = state.balls.find((b) => b.id === id && !b.pocketed);
    if (!ball) continue;
    for (const p of POCKETS) {
      const dx = p.mid.x - ball.pos.x;
      const dy = p.mid.y - ball.pos.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      const ghost = { x: ball.pos.x - (dx / len) * BALL_RADIUS * 2, y: ball.pos.y - (dy / len) * BALL_RADIUS * 2 };
      const aim = Math.atan2(ghost.y - cue.pos.y, ghost.x - cue.pos.x);
      // Skip cuts past about 80°, which can't go.
      const toBall = Math.atan2(ball.pos.y - cue.pos.y, ball.pos.x - cue.pos.x);
      const cut = Math.abs(Math.atan2(Math.sin(Math.atan2(dy, dx) - toBall), Math.cos(Math.atan2(dy, dx) - toBall)));
      if (cut < 80 * DEG) out.push(aim);
    }
  }
  return out;
}

function quickPots(state: GameState): number {
  let n = 0;
  for (const aim of potLines(state)) {
    for (const off of [-0.1, 0, 0.1]) {
      const r = play(state, { angle: aim + off * DEG, power: 0.5, spin: { x: 0, y: 0 }, elevation: 0 });
      if (r.potted.length > 0 && !r.scratch && !r.after.trick?.failed) {
        n++;
        break;
      }
    }
  }
  return n;
}

/** Plays a whole-table puzzle out greedily. Returns the shots, or null if it got stuck. */
function solveMulti(ch: Challenge): Shot[] | null {
  let state = freshState(ch);
  const shots: Shot[] = [];
  for (let turn = 0; turn < ch.shotLimit && !won(state); turn++) {
    let best: { shot: Shot; after: GameState; score: number } | null = null;
    for (const aim of potLines(state)) {
      for (const off of [-0.2, -0.1, 0, 0.1, 0.2]) {
        for (const power of [0.3, 0.45, 0.6, 0.8]) {
          for (const spin of [{ x: 0, y: 0 }, { x: 0, y: 0.5 }, { x: 0, y: -0.5 }]) {
            const shot = { angle: aim + off * DEG, power, spin, elevation: 0 };
            const r = play(state, shot);
            if (r.scratch || r.potted.length === 0 || r.after.trick?.failed) continue;
            const score = won(r.after) ? 1e6 : quickPots(r.after) * 10 + r.potted.length;
            if (!best || score > best.score) best = { shot, after: r.after, score };
          }
        }
      }
      if (best && best.score >= 1e6) break;
    }
    if (!best) return null;
    shots.push(best.shot);
    state = best.after;
  }
  return won(state) ? shots : null;
}

const round = (n: number, d = 5): number => Math.round(n * 10 ** d) / 10 ** d;

const only = process.argv.slice(2);
const pinned: string[] = [];
for (const ch of CHALLENGES) {
  if (only.length && !only.includes(ch.id)) continue;
  const t0 = Date.now();
  if (ch.goal.kind === 'potOrder' || ch.goal.kind === 'clearTable') {
    const shots = solveMulti(ch);
    const ms = Date.now() - t0;
    if (!shots) console.log(`✗ ${ch.id.padEnd(14)} no greedy run found (${ms}ms)`);
    else {
      const stars = shots.length <= ch.stars.three ? 3 : shots.length <= ch.stars.two ? 2 : 1;
      console.log(`✓ ${ch.id.padEnd(14)} cleared in ${shots.length} shots → ${stars}★ (${ms}ms)`);
      pinned.push(`  '${ch.id}': [${shots.map((s) => JSON.stringify({ ...s, angle: round(s.angle), spin: s.spin })).join(', ')}],`);
    }
    continue;
  }
  const { found, tried } = solveSingle(ch);
  const ms = Date.now() - t0;
  if (found.length === 0) {
    console.log(`✗ ${ch.id.padEnd(14)} impossible (${tried} shots, ${ms}ms)`);
    continue;
  }
  const best = found[0];
  const byKind = new Map<string, number>();
  for (const f of found) byKind.set(f.kind, (byKind.get(f.kind) ?? 0) + 1);
  console.log(
    `✓ ${ch.id.padEnd(14)} ${found.length} solutions ${JSON.stringify(Object.fromEntries(byKind))}, widest ${best.width.toFixed(2)}° ` +
      `@ ${(best.shot.angle / DEG).toFixed(2)}° power ${best.shot.power} spin ${JSON.stringify(best.shot.spin)} ${best.kind} (${ms}ms)`
  );
  pinned.push(`  '${ch.id}': [${JSON.stringify({ ...best.shot, angle: round(best.shot.angle) })}],`);
}
console.log('\n// solutions for challenges.test.ts\n' + pinned.join('\n'));
