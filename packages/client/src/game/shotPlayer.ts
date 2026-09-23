import {
  CUE_BALL_ID,
  SHOT_STEP,
  applyStrikeState,
  cloneBalls,
  stepSimulation,
  type Ball,
  type Orb,
  type PhysicsMods,
  type ShotPlayback,
  type SimEvent,
} from '@8ball/shared';

/**
 * Replays a shot exactly as the host refereed it.
 *
 * The simulation always advances in whole `SHOT_STEP`s — the same sequence of steps the host
 * ran — however fast or slow the display is. What the screen shows is interpolated between the
 * last two steps, so a 144 Hz display is as smooth as a 60 Hz one and the physics never sees a
 * variable time step.
 */
export class ShotPlayer {
  readonly shot: ShotPlayback;
  readonly balls: Ball[];
  private prev: Map<number, { x: number; y: number; z: number }> = new Map();
  private mods: PhysicsMods;
  readonly orbs: Orb[] | undefined;
  private steps = 0;
  private acc = 0;
  done = false;
  /** Playback speed; tapping the table fast-forwards. */
  speed = 1;

  constructor(shot: ShotPlayback) {
    this.shot = shot;
    this.balls = cloneBalls(shot.pre);
    const cue = this.balls.find((b) => b.id === CUE_BALL_ID);
    if (cue) applyStrikeState(cue, shot.strike);
    this.mods = { ...shot.mods };
    this.orbs = shot.orbs ? shot.orbs.map((o) => ({ ...o, pos: { ...o.pos } })) : undefined;
    this.snapshot();
  }

  private snapshot(): void {
    for (const b of this.balls) this.prev.set(b.id, { x: b.pos.x, y: b.pos.y, z: b.z });
  }

  /** Advances by `dt` seconds of display time. Returns the events that happened. */
  advance(dt: number): SimEvent[] {
    if (this.done) return [];
    const events: SimEvent[] = [];
    this.acc += Math.min(dt, 0.1) * this.speed;
    while (this.acc >= SHOT_STEP && this.steps < this.shot.steps) {
      this.snapshot();
      const res = stepSimulation(this.balls, SHOT_STEP, { mods: this.mods, orbs: this.orbs });
      this.steps++;
      this.acc -= SHOT_STEP;
      for (const ev of res.events) if (ev.type !== 'shotSettled') events.push(ev);
    }
    if (this.steps >= this.shot.steps) {
      this.done = true;
      this.acc = 0;
      this.snapshot();
    }
    return events;
  }

  /** How far between the last two steps the display is, 0..1. */
  get alpha(): number {
    return this.done ? 1 : Math.min(1, this.acc / SHOT_STEP);
  }

  /** Interpolated position of a ball for drawing. */
  position(ball: Ball): { x: number; y: number; z: number } {
    const p = this.prev.get(ball.id);
    if (!p || ball.pocketed) return { x: ball.pos.x, y: ball.pos.y, z: ball.z };
    const a = this.alpha;
    return { x: p.x + (ball.pos.x - p.x) * a, y: p.y + (ball.pos.y - p.y) * a, z: p.z + (ball.z - p.z) * a };
  }

  get progress(): number {
    return this.shot.steps > 0 ? this.steps / this.shot.steps : 1;
  }
}
