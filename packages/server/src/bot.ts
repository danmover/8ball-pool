import {
  BALL_RADIUS,
  CUE_BALL_ID,
  POCKETS,
  TABLE_LENGTH,
  TABLE_WIDTH,
  Vec2,
  legalTargetBallIds,
  pathIsClear,
} from '@8ball/shared';
import type { Ball, BotDifficulty, GameState, Loadout } from '@8ball/shared';

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
  thinkMs: [number, number];
  names: string[];
}

const TUNING: Record<BotDifficulty, Tuning> = {
  rookie: {
    contactError: 0.55,
    powerError: 0.3,
    sloppiness: 0.7,
    playsPosition: false,
    thinkMs: [1300, 2200],
    names: ['Rookie Rita', 'Chalky Pete', 'Two-Left-Hands'],
  },
  club: {
    contactError: 0.22,
    powerError: 0.18,
    sloppiness: 0.4,
    playsPosition: false,
    thinkMs: [1100, 1900],
    names: ['Club Player', 'Sunday Sam', 'Bar-Room Bex'],
  },
  shark: {
    contactError: 0.09,
    powerError: 0.1,
    sloppiness: 0.15,
    playsPosition: true,
    thinkMs: [900, 1500],
    names: ['The Shark', 'Cue-Ball Kim', 'Side-Pocket Sid'],
  },
  legend: {
    contactError: 0.035,
    powerError: 0.05,
    sloppiness: 0,
    playsPosition: true,
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
   * Ranks every (legal target ball × pocket) pair and picks one according to difficulty.
   * Falls back to a nudge at the nearest legal ball when nothing is on.
   */
  chooseShot(state: GameState, seat: string): BotShot {
    const cue = state.balls.find((b) => b.id === CUE_BALL_ID);
    if (!cue || cue.pocketed) return { angle: 0, power: 0.5, spin: { x: 0, y: 0 } };

    const targets = legalTargetBallIds(state);
    const candidates = this.rankShots(state, cue, targets);

    if (candidates.length === 0) return this.safetyShot(state, cue, targets);

    // Sloppier bots pick from a wider band below the best shot — but always a *band*, never
    // the whole list. Reaching to the bottom of the ranking made weaker bots choose absurd
    // table-length cuts while a tap-in sat there, which reads as broken rather than weak.
    const best = candidates[0].score;
    const band = 30 * this.tuning.sloppiness;
    const acceptable = candidates.filter((c) => c.score >= best - band);
    const chosen = acceptable[Math.floor(Math.random() * acceptable.length)] ?? candidates[0];

    void seat;
    return {
      angle: chosen.angle + this.aimJitter(chosen.cueDist),
      power: Math.max(
        0.12,
        Math.min(1, chosen.power * (1 + (Math.random() - 0.5) * 2 * this.tuning.powerError))
      ),
      spin: this.choosePositionSpin(state, cue, chosen, targets),
    };
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
    return { x: 0, y: best === drawDist ? 0.8 : -0.8 };
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

      const probe: Ball = { id: CUE_BALL_ID, kind: 'cue', pos, vel: { x: 0, y: 0 }, spin: 0, spinV: 0, pocketed: false };
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
