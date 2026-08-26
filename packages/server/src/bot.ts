import {
  BALL_RADIUS,
  CUE_BALL_ID,
  POCKETS,
  TABLE_LENGTH,
  TABLE_WIDTH,
  Vec2,
  applyCueStrike,
  createBall,
  legalTargetBallIds,
  pathIsClear,
  stepSimulation,
  summarizeShot,
} from '@8ball/shared';
import type { Ball, BotDifficulty, GameState, Loadout, SimEvent } from '@8ball/shared';

/**
 * The computer opponent.
 *
 * It sees exactly what a human sees — ball positions and the legal-target list — and works
 * out its shot with the same geometry the aim guide uses. Difficulty is expressed as how good
 * a shot it bothers to look for and how accurately it delivers it, never as hidden knowledge
 * or physics cheats.
 */

interface Tuning {
  /**
   * Aiming error, expressed as how far off the contact point the cue ball arrives, in ball
   * radii — *not* as an angle at the cue.
   *
   * This distinction matters enormously. A fixed angular error is amplified by the distance
   * to the object ball (a 0.8° error over a table length lands the cue ball most of a ball
   * off the contact point, which throws the object ball tens of degrees), so a "shark" bot
   * modelled that way misses nearly everything long. Contact-point error is both the honest
   * model of how a real player misses and the one that makes the tiers mean something: to
   * pot a mid-range ball the contact point has to be right to within about a tenth of a
   * radius, so these numbers are deliberately small.
   */
  contactError: number;
  /** Fraction of the chosen power the bot may be off by. */
  powerError: number;
  /**
   * How far down the ranked shot list it's willing to pick. 0 always takes the best shot,
   * 0.6 often settles for a mediocre one.
   */
  sloppiness: number;
  /** Whether this tier bothers to think about where the cue ball finishes. */
  playsPosition: boolean;
  /**
   * Wall-clock milliseconds this tier may spend simulating candidate shots. Zero means it
   * doesn't search at all and ranks ghost-ball geometry instead — which is why the lower tiers
   * never find a combination or a two-ball drop.
   */
  searchBudgetMs: number;
  /** How many geometric lines to feed the search, before powers and spins multiply them up. */
  searchWidth: number;
  thinkMs: [number, number];
  names: string[];
}

/** A shot to try, with the distance used to convert the tier's contact error into an angle. */
interface SimCandidate {
  shot: BotShot;
  cueDist: number;
}

/** Simulation step and cap for evaluating a candidate — plenty for any shot to play out. */
const SIM_FRAME = 1 / 60;
const MAX_SIM_FRAMES = 420;

const TUNING: Record<BotDifficulty, Tuning> = {
  rookie: {
    contactError: 0.55,
    powerError: 0.3,
    sloppiness: 0.7,
    playsPosition: false,
    searchBudgetMs: 0,
    searchWidth: 0,
    thinkMs: [1300, 2200],
    names: ['Rookie Rita', 'Chalky Pete', 'Two-Left-Hands'],
  },
  club: {
    contactError: 0.22,
    powerError: 0.18,
    sloppiness: 0.4,
    playsPosition: false,
    searchBudgetMs: 0,
    searchWidth: 0,
    thinkMs: [1100, 1900],
    names: ['Club Player', 'Sunday Sam', 'Bar-Room Bex'],
  },
  shark: {
    contactError: 0.09,
    powerError: 0.1,
    sloppiness: 0.15,
    playsPosition: true,
    searchBudgetMs: 550,
    searchWidth: 8,
    thinkMs: [900, 1500],
    names: ['The Shark', 'Cue-Ball Kim', 'Side-Pocket Sid'],
  },
  legend: {
    contactError: 0.035,
    powerError: 0.05,
    sloppiness: 0,
    playsPosition: true,
    searchBudgetMs: 1100,
    searchWidth: 14,
    thinkMs: [700, 1200],
    names: ['The Legend', 'Nine-Ball Nia', 'Mr 147'],
  },
};

/** Bots get a random look so a lobby full of them isn't a row of identical nameplates. */
const BOT_LOADOUTS: Loadout[] = [
  { cue: 'cue.rosewood', ballSet: 'balls.classic', trail: 'trail.ice', banner: 'banner.carbon', avatar: 'avatar.eight' },
  { cue: 'cue.jetstream', ballSet: 'balls.classic', trail: 'trail.comet', banner: 'banner.neon', avatar: 'avatar.chalk' },
  { cue: 'cue.obsidian', ballSet: 'balls.classic', trail: 'trail.toxic', banner: 'banner.gold', avatar: 'avatar.skull' },
  { cue: 'cue.chalkline', ballSet: 'balls.classic', trail: 'trail.classic', banner: 'banner.felt', avatar: 'avatar.ball' },
];

export interface BotShot {
  angle: number;
  power: number;
  /** Cue tip offset, exactly as a human's spin pad sends it. */
  spin: { x: number; y: number };
}

interface Candidate {
  angle: number;
  power: number;
  score: number;
  /** Cue-to-contact-point distance, used to convert contact error into an aim angle. */
  cueDist: number;
  /** The object ball being played and where it's headed, for working out position. */
  targetId: number;
  ghost: { x: number; y: number };
}

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

export class BotPlayer {
  readonly difficulty: BotDifficulty;
  readonly name: string;
  readonly loadout: Loadout;
  private tuning: Tuning;

  /**
   * @param taken names already in the room, so a lobby of bots doesn't end up as four
   *              identical "Club Player" nameplates nobody can tell apart.
   */
  constructor(difficulty: BotDifficulty, taken: string[] = []) {
    this.difficulty = difficulty;
    this.tuning = TUNING[difficulty];

    const free = this.tuning.names.filter((n) => !taken.includes(n));
    this.name = free.length ? pick(free) : `${pick(this.tuning.names)} ${taken.length + 1}`;
    this.loadout = pick(BOT_LOADOUTS);
  }

  thinkingTimeMs(): number {
    const [min, max] = this.tuning.thinkMs;
    return min + Math.random() * (max - min);
  }

  /**
   * Picks a shot.
   *
   * The top two tiers search by *playing shots out with the real engine* and keeping whichever
   * outcome they liked best; the lower two rank ghost-ball geometry as they always have. That
   * split is most of what separates them: geometry can only ever see one ball going in one
   * pocket, so a combination or a two-ball drop is not merely unlikely for Rookie and Club —
   * it is not in their vocabulary at all.
   */
  async chooseShot(state: GameState, seat: string): Promise<BotShot> {
    const cue = state.balls.find((b) => b.id === CUE_BALL_ID);
    if (!cue || cue.pocketed) return { angle: 0, power: 0.5, spin: { x: 0, y: 0 } };

    void seat;
    const targets = legalTargetBallIds(state);
    if (this.tuning.searchBudgetMs > 0) {
      const found = await this.searchShot(state, cue, targets);
      if (found) return found;
    }
    return this.geometricShot(state, cue, targets);
  }

  /**
   * Ranks every (legal target ball × pocket) pair and picks one according to difficulty.
   * Falls back to a nudge at the nearest legal ball when nothing is on.
   */
  private geometricShot(state: GameState, cue: Ball, targets: number[]): BotShot {
    const candidates = this.rankShots(state, cue, targets);
    if (candidates.length === 0) return this.safetyShot(state, cue, targets);

    // Sloppier bots pick from a wider band below the best shot — but always a *band*, never
    // the whole list. Reaching to the bottom of the ranking made weaker bots choose absurd
    // table-length cuts while a tap-in sat there, which reads as broken rather than weak.
    const best = candidates[0].score;
    const band = 30 * this.tuning.sloppiness;
    const acceptable = candidates.filter((c) => c.score >= best - band);
    const chosen = acceptable[Math.floor(Math.random() * acceptable.length)] ?? candidates[0];

    return {
      angle: chosen.angle + this.aimJitter(chosen.cueDist),
      power: Math.max(
        0.12,
        Math.min(1, chosen.power * (1 + (Math.random() - 0.5) * 2 * this.tuning.powerError))
      ),
      spin: this.choosePositionSpin(state, cue, chosen, targets),
    };
  }

  // ------------------------------------------------------------------ simulated search

  /**
   * Plays candidate shots out with the real engine and keeps the best outcome.
   *
   * This is the only way a bot can find a shot that drops two balls, or a combination, or a
   * carom. Ghost-ball geometry answers "can I send *this* ball to *that* pocket"; it has no
   * way to notice that the object ball will go on to bump a second one in, because that
   * depends on the whole table and on how hard the shot is hit. Simulating asks the question
   * that actually matters — what happens if I hit it like this — and the answer is the truth,
   * because it comes from the same code that will run the shot for real.
   *
   * It is also, deliberately, not a cheat. The bot plays a shot the physics allows and then
   * has its tier's aiming error applied on top, so it misses like a person.
   */
  private async searchShot(state: GameState, cue: Ball, targets: number[]): Promise<BotShot | null> {
    if (targets.length === 0) return null;

    const candidates = this.generateCandidates(state, cue, targets);
    if (candidates.length === 0) return null;

    const deadline = Date.now() + this.tuning.searchBudgetMs;
    let best: { shot: BotShot; score: number; cueDist: number } | null = null;
    let sinceYield = 0;

    for (const c of candidates) {
      // Always evaluate a handful, then respect the clock. Degrading to a good single shot is
      // fine; blocking the server while other rooms wait is not.
      if (best && Date.now() > deadline) break;

      const score = this.evaluate(state, targets, c);
      if (!best || score > best.score) best = { shot: c.shot, score, cueDist: c.cueDist };

      if (++sinceYield >= 4) {
        sinceYield = 0;
        await new Promise<void>((r) => setImmediate(r));
      }
    }

    if (!best || best.score <= 0) return null;
    return {
      angle: best.shot.angle + this.aimJitter(best.cueDist),
      power: Math.max(
        0.12,
        Math.min(1, best.shot.power * (1 + (Math.random() - 0.5) * 2 * this.tuning.powerError))
      ),
      spin: best.shot.spin,
    };
  }

  /**
   * The shots worth simulating.
   *
   * Simulation is far too slow to sweep every angle, so geometry is used for what it *is* good
   * at — proposing plausible lines — and simulation decides between them. Direct shots come
   * from the existing ranking; combinations are built by chaining two ghost balls, cue → A → B
   * → pocket, which is the shape of every combo in the game.
   */
  private generateCandidates(state: GameState, cue: Ball, targets: number[]): SimCandidate[] {
    const out: SimCandidate[] = [];
    const spins = this.tuning.playsPosition
      ? [
          { x: 0, y: 0 },
          { x: 0, y: 0.7 },
          { x: 0, y: -0.7 },
        ]
      : [{ x: 0, y: 0 }];

    const direct = this.rankShots(state, cue, targets).slice(0, this.tuning.searchWidth);
    for (const d of direct) {
      for (const power of [d.power, Math.min(1, d.power * 1.35), Math.max(0.15, d.power * 0.7)]) {
        for (const spin of spins) {
          out.push({ shot: { angle: d.angle, power, spin }, cueDist: d.cueDist });
        }
      }
    }

    // Sweep either side of the ideal line on the best few, offset by a fraction of a ball at
    // the contact point rather than by a fixed angle — the same units the aiming error uses,
    // so the spread means the same thing whether the object ball is near or across the table.
    //
    // This earns its place twice over. The ghost-ball angle is an idealisation that ignores
    // throw and collision-induced deflection, so the true potting line is often a hair off it;
    // and a shot that clips a second ball on its way is only ever found by trying the line
    // next door and seeing what happens.
    for (const d of direct.slice(0, 6)) {
      for (const fraction of [-0.55, -0.28, 0.28, 0.55]) {
        const offset = (fraction * BALL_RADIUS) / Math.max(BALL_RADIUS, d.cueDist);
        out.push({
          shot: { angle: d.angle + offset, power: d.power, spin: { x: 0, y: 0 } },
          cueDist: d.cueDist,
        });
      }
    }

    for (const combo of this.comboLines(state, cue, targets)) {
      for (const power of [combo.power, Math.min(1, combo.power * 1.3)]) {
        out.push({ shot: { angle: combo.angle, power, spin: { x: 0, y: 0 } }, cueDist: combo.cueDist });
      }
    }

    return out;
  }

  /**
   * Combination lines: cue → A → B → pocket, where A is a legal target.
   *
   * Two ghost balls chained. Where must A strike B to send B to the pocket? That point is a
   * ghost; then where must the cue strike A to send A to *that* point? Also a ghost. Every leg
   * has to be clear and every cut has to be sane, or the line is fiction.
   */
  private comboLines(
    state: GameState,
    cue: Ball,
    targets: number[]
  ): { angle: number; power: number; cueDist: number; score: number }[] {
    const out: { angle: number; power: number; cueDist: number; score: number }[] = [];
    const live = state.balls.filter((b) => !b.pocketed && b.id !== CUE_BALL_ID);

    for (const id of targets) {
      const a = live.find((b) => b.id === id);
      if (!a) continue;

      for (const b of live) {
        if (b.id === a.id) continue;
        // Only worth chaining through a ball that's nearby; long combos are fantasy.
        const gap = Vec2.distance(a.pos, b.pos);
        if (gap > TABLE_LENGTH * 0.3) continue;

        for (const pocket of POCKETS) {
          const toPocket = Vec2.normalize(Vec2.sub(pocket.capture, b.pos));
          const ghostB = Vec2.sub(b.pos, Vec2.scale(toPocket, BALL_RADIUS * 2));

          const aToGhostB = Vec2.sub(ghostB, a.pos);
          const aDist = Vec2.length(aToGhostB);
          if (aDist < 1) continue;
          const aDir = Vec2.scale(aToGhostB, 1 / aDist);
          const cutB = Math.acos(Math.max(-1, Math.min(1, Vec2.dot(aDir, toPocket))));
          if (cutB > 1.0) continue;

          const ghostA = Vec2.sub(a.pos, Vec2.scale(aDir, BALL_RADIUS * 2));
          const toGhostA = Vec2.sub(ghostA, cue.pos);
          const cueDist = Vec2.length(toGhostA);
          if (cueDist < 1) continue;
          const cueDir = Vec2.scale(toGhostA, 1 / cueDist);
          const cutA = Math.acos(Math.max(-1, Math.min(1, Vec2.dot(cueDir, aDir))));
          if (cutA > 1.0) continue;

          if (!pathIsClear(state.balls, cue.pos, ghostA, [CUE_BALL_ID, a.id])) continue;
          if (!pathIsClear(state.balls, a.pos, ghostB, [a.id, b.id])) continue;
          if (!pathIsClear(state.balls, b.pos, pocket.capture, [b.id])) continue;

          // Combos bleed pace at every contact, so they want hitting.
          const power = Math.min(1, 0.55 + (cueDist + aDist) / TABLE_LENGTH * 0.35);
          out.push({ angle: Math.atan2(toGhostA.y, toGhostA.x), power, cueDist, score: -cutA - cutB });
        }
      }
    }

    return out.sort((x, y) => y.score - x.score).slice(0, 8);
  }

  /**
   * Runs one candidate to a standstill and scores what happened.
   *
   * Potting is scored *superlinearly*, so a shot that drops two legal balls decisively beats
   * two separate shots that each drop one — which is the whole reason to search at all. The
   * position term re-ranks from where the cue ball genuinely finished, which replaces the old
   * guesswork about how far draw and follow would carry it.
   */
  private evaluate(state: GameState, targets: number[], candidate: SimCandidate): number {
    const balls: Ball[] = state.balls.map((b) => ({
      ...b,
      pos: { ...b.pos },
      vel: { ...b.vel },
      angVel: { ...b.angVel },
    }));
    const cue = balls.find((b) => b.id === CUE_BALL_ID);
    if (!cue) return -Infinity;

    // Plans the intended shot — see the note in trajectory.ts. The bot's spin values are kept
    // inside the tip's safe grip, so it is never gambling on a miscue it can't foresee.
    applyCueStrike(cue, candidate.shot.angle, candidate.shot.power, candidate.shot.spin, () => 1);

    const events: SimEvent[] = [];
    for (let i = 0; i < MAX_SIM_FRAMES; i++) {
      const step = stepSimulation(balls, SIM_FRAME);
      events.push(...step.events);
      if (step.settled) break;
    }

    const summary = summarizeShot(events);
    if (summary.firstBallContacted === null) return -800; // never hit anything: foul
    if (!targets.includes(summary.firstBallContacted)) return -600; // wrong ball first: foul
    if (cue.pocketed) return -700; // scratch

    const legal = summary.potted.filter((id) => targets.includes(id)).length;
    const illegal = summary.potted.filter((id) => id !== 0 && !targets.includes(id)).length;

    let score = legal * legal * 100 - illegal * 70;
    if (legal === 0) score -= 25; // a dry shot hands the table over

    // Position: how good is the best shot available from where the cue ball actually stopped?
    if (this.tuning.playsPosition) {
      const after = { ...state, balls } as GameState;
      const next = this.rankShots(after, cue, legalTargetBallIds(after))[0];
      score += (next?.score ?? 0) * 0.35;
    }
    return score;
  }

  /**
   * Position play, for the tiers that have it.
   *
   * Nothing clever: after this shot the cue ball ends up somewhere near the contact point, and
   * draw pulls it back down the shot line while follow sends it on. So look at where the *next*
   * ball is, and pick whichever leaves the cue ball closer to it. Rookie and Club never do this
   * — playing centre-ball and hoping is itself a large part of what makes them weaker.
   */
  private choosePositionSpin(
    state: GameState,
    cue: Ball,
    chosen: Candidate,
    targets: number[]
  ): { x: number; y: number } {
    if (!this.tuning.playsPosition) return { x: 0, y: 0 };

    // The next ball to think about is the nearest legal one that isn't the one being potted.
    let next: Ball | null = null;
    let bestDist = Infinity;
    for (const id of targets) {
      if (id === chosen.targetId) continue;
      const ball = state.balls.find((b) => b.id === id && !b.pocketed);
      if (!ball) continue;
      const d = Vec2.distance(chosen.ghost, ball.pos);
      if (d < bestDist) {
        bestDist = d;
        next = ball;
      }
    }
    if (!next) return { x: 0, y: 0 };

    // Would drawing back or following through leave the cue ball nearer that ball?
    const dir = Vec2.normalize(Vec2.sub(chosen.ghost, cue.pos));
    const reach = 260;
    const drawnTo = Vec2.sub(chosen.ghost, Vec2.scale(dir, reach));
    const followedTo = Vec2.add(chosen.ghost, Vec2.scale(dir, reach));

    const drawDist = Vec2.distance(drawnTo, next.pos);
    const followDist = Vec2.distance(followedTo, next.pos);
    const stunDist = Vec2.distance(chosen.ghost, next.pos);

    const best = Math.min(drawDist, followDist, stunDist);
    if (best === stunDist) return { x: 0, y: 0 };
    // Pad y is screen-down, so positive y is below centre — backspin.
    return { x: 0, y: best === drawDist ? 0.7 : -0.7 };
  }

  /**
   * Converts the tier's contact-point error into an angle at the cue, given how far the cue
   * ball has to travel. The further the object ball, the finer the aim has to be — which is
   * exactly why long shots are the ones bots (and people) miss.
   */
  private aimJitter(cueDist: number): number {
    const lateral = this.tuning.contactError * BALL_RADIUS;
    return ((Math.random() - 0.5) * 2 * lateral) / Math.max(BALL_RADIUS, cueDist);
  }

  /** Every makeable-looking shot, best first. */
  private rankShots(state: GameState, cue: Ball, targetIds: number[]): Candidate[] {
    const out: Candidate[] = [];

    for (const id of targetIds) {
      const ball = state.balls.find((b) => b.id === id);
      if (!ball || ball.pocketed) continue;

      for (const pocket of POCKETS) {
        // Aim at the rest point inside the bag rather than the mouth's lip, so the line the bot
        // plays is the one that carries the ball all the way in.
        const aim = pocket.capture;
        // The ghost ball: where the cue ball must be at contact to send this ball pocketwards.
        const toPocket = Vec2.normalize(Vec2.sub(aim, ball.pos));
        const ghost = Vec2.sub(ball.pos, Vec2.scale(toPocket, BALL_RADIUS * 2));

        const toGhost = Vec2.sub(ghost, cue.pos);
        const cueDist = Vec2.length(toGhost);
        if (cueDist < 1) continue;
        const angle = Math.atan2(toGhost.y, toGhost.x);

        // Cut angle: dead straight is 0, and past ~80° the shot isn't really there.
        const cut = Math.acos(
          Math.max(-1, Math.min(1, Vec2.dot(Vec2.normalize(toGhost), toPocket)))
        );
        if (cut > 1.4) continue;

        // Both legs of the shot have to be clear — cue to ghost, and ball to pocket.
        if (!pathIsClear(state.balls, cue.pos, ghost, [CUE_BALL_ID, id])) continue;
        if (!pathIsClear(state.balls, ball.pos, aim, [id])) continue;

        const pocketDist = Vec2.distance(ball.pos, aim);
        // Prefer straight, short shots; long thin cuts are where misses come from. A wider
        // mouth forgives more, which is why the side pockets are worth a look.
        const score =
          100 -
          cut * 42 -
          (cueDist / TABLE_LENGTH) * 22 -
          (pocketDist / TABLE_LENGTH) * 30 +
          (pocket.halfWidth / BALL_RADIUS) * 2;

        // Enough pace to carry the object ball in, scaled by how much of the hit is lost
        // to the cut, plus a floor so soft shots still reach.
        const power = Math.min(
          1,
          0.3 + (pocketDist / TABLE_LENGTH) * 0.5 + (cueDist / TABLE_LENGTH) * 0.25 + cut * 0.2
        );

        out.push({ angle, power, score, cueDist, targetId: id, ghost });
      }
    }

    return out.sort((a, b) => b.score - a.score);
  }

  /** Nothing on: roll gently at the nearest legal ball so at least it's not a foul. */
  private safetyShot(state: GameState, cue: Ball, targetIds: number[]): BotShot {
    let best: Ball | null = null;
    let bestDist = Infinity;
    for (const id of targetIds) {
      const ball = state.balls.find((b) => b.id === id && !b.pocketed);
      if (!ball) continue;
      const d = Vec2.distance(cue.pos, ball.pos);
      if (d < bestDist) {
        bestDist = d;
        best = ball;
      }
    }
    if (!best) return { angle: Math.random() * Math.PI * 2, power: 0.45, spin: { x: 0, y: 0 } };

    const dir = Vec2.sub(best.pos, cue.pos);
    return {
      angle: Math.atan2(dir.y, dir.x) + this.aimJitter(Vec2.length(dir)),
      // Firm enough to reach a rail after contact, which most modes require.
      power: 0.55,
      spin: { x: 0, y: 0 },
    };
  }

  /**
   * Ball in hand: sample positions across the table and keep whichever gives the best-ranked
   * shot. Cheap, and it produces the same "put it where the shot is" behaviour as thinking
   * about it properly.
   */
  chooseCueBallPlacement(state: GameState): { x: number; y: number } {
    const targets = legalTargetBallIds(state);
    const margin = BALL_RADIUS * 2;
    let best = { x: TABLE_LENGTH * 0.25, y: TABLE_WIDTH / 2 };
    let bestScore = -Infinity;

    for (let i = 0; i < 40; i++) {
      const pos = {
        x: margin + Math.random() * (TABLE_LENGTH - margin * 2),
        y: margin + Math.random() * (TABLE_WIDTH - margin * 2),
      };
      const overlaps = state.balls.some(
        (b) => !b.pocketed && b.id !== CUE_BALL_ID && Vec2.distance(b.pos, pos) < BALL_RADIUS * 2.4
      );
      if (overlaps) continue;

      const probe: Ball = { ...createBall(CUE_BALL_ID, 'cue', pos.x, pos.y) };
      const top = this.rankShots(state, probe, targets)[0];
      const score = top?.score ?? -Infinity;
      if (score > bestScore) {
        bestScore = score;
        best = pos;
      }
    }

    return best;
  }
}
