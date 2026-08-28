import type { Ball } from '@8ball/shared';

/**
 * Shot recording and playback.
 *
 * The client already receives a full ball snapshot at `BROADCAST_HZ` for every frame of every
 * shot — the replay costs nothing but the memory to keep the last few seconds of them. No new
 * server data, no second physics run, and no risk of the replay disagreeing with what happened,
 * because it *is* what happened.
 *
 * Deliberately free of PixiJS and of the DOM: playback is a pure index into an array of
 * snapshots, which is what lets the scrubber, the auto-replay and the tests all drive the same
 * code.
 */

/** One broadcast's worth of table state. */
export interface ReplayFrame {
  /** Milliseconds since the recording started. */
  t: number;
  balls: Ball[];
}

/** Roughly how long a replay can be. Longer than any shot anyone wants to watch twice. */
export const MAX_REPLAY_MS = 12_000;

/** Deep-copies a ball, because the live ones are mutated in place by the next broadcast. */
function cloneBall(ball: Ball): Ball {
  return {
    ...ball,
    pos: { ...ball.pos },
    vel: { ...ball.vel },
    angVel: { ...ball.angVel },
  };
}

/**
 * A rolling window of the most recent snapshots.
 *
 * Trimmed by *time* rather than by count, so a laggy connection that broadcasts less often
 * still keeps the same few seconds of pool rather than a much longer stretch of it.
 */
export class ShotRecorder {
  private frames: ReplayFrame[] = [];
  private startedAt = 0;

  /** Begins a new recording, discarding whatever came before. */
  start(now = performance.now()): void {
    this.frames = [];
    this.startedAt = now;
  }

  /** Appends a snapshot. Safe to call before `start` — the first frame begins the recording. */
  record(balls: Ball[], now = performance.now()): void {
    if (this.frames.length === 0) this.startedAt = now;
    this.frames.push({ t: now - this.startedAt, balls: balls.map(cloneBall) });

    const cutoff = now - this.startedAt - MAX_REPLAY_MS;
    if (cutoff > 0) {
      let drop = 0;
      while (drop < this.frames.length && this.frames[drop].t < cutoff) drop++;
      if (drop > 0) this.frames.splice(0, drop);
    }
  }

  /** Everything recorded, oldest first. */
  frameList(): ReplayFrame[] {
    return this.frames;
  }

  get length(): number {
    return this.frames.length;
  }

  /** How long the recording covers, in milliseconds. */
  get durationMs(): number {
    if (this.frames.length < 2) return 0;
    return this.frames[this.frames.length - 1].t - this.frames[0].t;
  }

  /**
   * The last `ms` of the recording, re-based so the first frame is at t=0.
   *
   * Always returns at least two frames when anything was recorded at all: a one-frame
   * "replay" is a still photograph, and the player would divide by a zero duration.
   */
  tail(ms: number): ReplayFrame[] {
    if (this.frames.length === 0) return [];
    const end = this.frames[this.frames.length - 1].t;
    let start = 0;
    while (start < this.frames.length - 2 && this.frames[start].t < end - ms) start++;
    const slice = this.frames.slice(start);
    const base = slice[0].t;
    return slice.map((f) => ({ t: f.t - base, balls: f.balls }));
  }

  clear(): void {
    this.frames = [];
  }
}

/**
 * Plays a recording back, at a chosen rate or under a scrubber.
 *
 * Time is tracked in *recording* milliseconds rather than wall-clock, so 0.35× slow motion and
 * dragging a scrub bar are the same operation with a different source of the number.
 */
export class ReplayPlayer {
  private frames: ReplayFrame[] = [];
  private positionMs = 0;
  private rate = 1;
  private playing = false;
  private lastTick = 0;
  private onFrame: ((balls: Ball[], progress: number) => void) | null = null;
  private onEnd: (() => void) | null = null;

  load(frames: ReplayFrame[]): void {
    this.frames = frames;
    this.positionMs = 0;
    this.playing = false;
  }

  get loaded(): boolean {
    return this.frames.length >= 2;
  }

  get durationMs(): number {
    if (this.frames.length < 2) return 0;
    return this.frames[this.frames.length - 1].t;
  }

  /** 0..1 through the recording. */
  get progress(): number {
    const d = this.durationMs;
    return d > 0 ? Math.min(1, Math.max(0, this.positionMs / d)) : 0;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  setCallbacks(
    onFrame: (balls: Ball[], progress: number) => void,
    onEnd: () => void = () => {}
  ): void {
    this.onFrame = onFrame;
    this.onEnd = onEnd;
  }

  play(rate = 1, now = performance.now()): void {
    if (!this.loaded) return;
    // Replaying from the very end just ends again; start over instead, which is what pressing
    // play on a finished replay obviously means.
    if (this.progress >= 1) this.positionMs = 0;
    this.rate = rate;
    this.playing = true;
    this.lastTick = now;
    this.emit();
  }

  pause(): void {
    this.playing = false;
  }

  /** Jumps to a fraction of the way through, and pauses there. */
  seek(progress: number): void {
    if (!this.loaded) return;
    this.playing = false;
    this.positionMs = Math.min(1, Math.max(0, progress)) * this.durationMs;
    this.emit();
  }

  /** Steps one broadcast frame, for the scrubber's nudge buttons. */
  step(delta: number): void {
    if (!this.loaded) return;
    this.playing = false;
    const i = Math.min(this.frames.length - 1, Math.max(0, this.frameIndex() + delta));
    this.positionMs = this.frames[i].t;
    this.emit();
  }

  /** Advance by wall-clock time. Call once per animation frame while playing. */
  tick(now = performance.now()): void {
    if (!this.playing || !this.loaded) return;
    const elapsed = now - this.lastTick;
    this.lastTick = now;
    this.positionMs += elapsed * this.rate;

    if (this.positionMs >= this.durationMs) {
      this.positionMs = this.durationMs;
      this.playing = false;
      this.emit();
      this.onEnd?.();
      return;
    }
    this.emit();
  }

  /** The index of the frame at the current position. */
  frameIndex(): number {
    if (this.frames.length === 0) return 0;
    // Linear from the start: a replay is a couple of hundred frames, and a binary search here
    // would be more code than the whole class saves.
    let i = 0;
    while (i < this.frames.length - 1 && this.frames[i + 1].t <= this.positionMs) i++;
    return i;
  }

  private emit(): void {
    if (this.frames.length === 0) return;
    this.onFrame?.(this.frames[this.frameIndex()].balls, this.progress);
  }
}

/**
 * Where the camera should look during a replay: the pocket the shot ended in, if it ended in
 * one, and otherwise wherever the balls were busiest.
 *
 * Falling back to the centroid rather than to "no zoom" matters — a safety shot or a miss is
 * still worth reviewing, and it's the part of the table that moved that you want to see.
 */
export function replayFocus(frames: ReplayFrame[], pocketPos: { x: number; y: number } | null): { x: number; y: number } | null {
  if (pocketPos) return pocketPos;
  if (frames.length < 2) return null;

  const first = frames[0].balls;
  const last = frames[frames.length - 1].balls;
  let sx = 0;
  let sy = 0;
  let weight = 0;
  for (const before of first) {
    const after = last.find((b) => b.id === before.id);
    if (!after) continue;
    // Weighted by how far each ball travelled: the balls that moved are the story.
    const moved = Math.hypot(after.pos.x - before.pos.x, after.pos.y - before.pos.y);
    if (moved < 1) continue;
    sx += after.pos.x * moved;
    sy += after.pos.y * moved;
    weight += moved;
  }
  if (weight <= 0) return null;
  return { x: sx / weight, y: sy / weight };
}
