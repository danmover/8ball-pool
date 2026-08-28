import { describe, expect, it } from 'vitest';
import { MAX_REPLAY_MS, ReplayPlayer, ShotRecorder, replayFocus } from '../replay.js';
import { createBall } from '@8ball/shared';
import type { Ball } from '@8ball/shared';

/**
 * The replay is only worth having if it shows what actually happened, so the properties that
 * matter are: snapshots are copied rather than aliased, the window is bounded, and playback
 * lands on the right frame for a given position.
 */

const at = (id: number, x: number, y: number): Ball => createBall(id, 'solid', x, y);

describe('recording', () => {
  it('keeps what it was given', () => {
    const r = new ShotRecorder();
    r.start(0);
    r.record([at(1, 100, 100)], 0);
    r.record([at(1, 200, 100)], 50);
    expect(r.length).toBe(2);
    expect(r.frameList()[1].balls[0].pos.x).toBe(200);
  });

  it('copies rather than aliases, so the next broadcast cannot rewrite history', () => {
    // The live ball objects are mutated in place, so a shallow reference here would leave every
    // recorded frame showing the final position — a replay of a shot that never moved.
    const r = new ShotRecorder();
    const ball = at(1, 100, 100);
    r.start(0);
    r.record([ball], 0);
    ball.pos.x = 900;
    r.record([ball], 50);

    expect(r.frameList()[0].balls[0].pos.x).toBe(100);
    expect(r.frameList()[1].balls[0].pos.x).toBe(900);
  });

  it('bounds the window by time, not by frame count', () => {
    // A laggy connection broadcasts less often; it should still keep the same few seconds of
    // pool rather than a much longer stretch of it.
    const r = new ShotRecorder();
    r.start(0);
    for (let t = 0; t <= MAX_REPLAY_MS + 4000; t += 50) r.record([at(1, t, 0)], t);
    expect(r.durationMs).toBeLessThanOrEqual(MAX_REPLAY_MS + 50);
    // And the newest frame survives.
    expect(r.frameList()[r.length - 1].balls[0].pos.x).toBeGreaterThan(MAX_REPLAY_MS);
  });

  it('takes a tail re-based to zero', () => {
    const r = new ShotRecorder();
    r.start(0);
    for (let t = 0; t <= 8000; t += 100) r.record([at(1, t, 0)], t);
    const tail = r.tail(3000);
    expect(tail[0].t).toBe(0);
    expect(tail[tail.length - 1].t).toBeLessThanOrEqual(3100);
    expect(tail[tail.length - 1].balls[0].pos.x).toBe(8000);
  });

  it('never returns a one-frame replay, which is a photograph', () => {
    const r = new ShotRecorder();
    r.start(0);
    r.record([at(1, 0, 0)], 0);
    r.record([at(1, 10, 0)], 5000);
    // Asking for a window shorter than the gap between the only two frames.
    expect(r.tail(10).length).toBeGreaterThanOrEqual(2);
  });

  it('reports nothing when nothing was recorded', () => {
    const r = new ShotRecorder();
    expect(r.tail(3000)).toEqual([]);
    expect(r.durationMs).toBe(0);
  });
});

describe('playback', () => {
  const recording = (): ShotRecorder => {
    const r = new ShotRecorder();
    r.start(0);
    for (let t = 0; t <= 1000; t += 100) r.record([at(1, t, 0)], t);
    return r;
  };

  it('refuses to play a recording too short to be one', () => {
    const p = new ReplayPlayer();
    p.load([]);
    expect(p.loaded).toBe(false);
    p.play(1, 0);
    expect(p.isPlaying).toBe(false);
  });

  it('advances in recording time, scaled by the rate', () => {
    const p = new ReplayPlayer();
    p.load(recording().frameList());
    p.play(0.5, 0);
    // 400ms of wall clock at half speed is 200ms of the shot.
    p.tick(400);
    expect(p.progress).toBeCloseTo(0.2, 3);
  });

  it('lands on the frame covering the current position', () => {
    const p = new ReplayPlayer();
    p.load(recording().frameList());
    let seen: Ball[] = [];
    p.setCallbacks((balls) => (seen = balls));
    p.seek(0.55);
    // 550ms into a recording sampled every 100ms is the frame stamped 500.
    expect(seen[0].pos.x).toBe(500);
  });

  it('stops at the end and says so exactly once', () => {
    const p = new ReplayPlayer();
    p.load(recording().frameList());
    let ended = 0;
    p.setCallbacks(() => {}, () => ended++);
    p.play(1, 0);
    p.tick(2000);
    expect(p.isPlaying).toBe(false);
    expect(p.progress).toBe(1);
    p.tick(3000); // ticking a stopped player does nothing
    expect(ended).toBe(1);
  });

  it('restarts when play is pressed on a finished replay', () => {
    const p = new ReplayPlayer();
    p.load(recording().frameList());
    p.play(1, 0);
    p.tick(2000);
    expect(p.progress).toBe(1);
    p.play(1, 2000);
    expect(p.progress).toBe(0);
    expect(p.isPlaying).toBe(true);
  });

  it('steps frame by frame and pauses while doing it', () => {
    const p = new ReplayPlayer();
    p.load(recording().frameList());
    p.play(1, 0);
    p.step(2);
    expect(p.isPlaying).toBe(false);
    expect(p.frameIndex()).toBe(2);
    p.step(-1);
    expect(p.frameIndex()).toBe(1);
    p.step(-50); // clamped, not negative
    expect(p.frameIndex()).toBe(0);
  });

  it('clamps a seek outside the recording', () => {
    const p = new ReplayPlayer();
    p.load(recording().frameList());
    p.seek(5);
    expect(p.progress).toBe(1);
    p.seek(-3);
    expect(p.progress).toBe(0);
  });
});

describe('where to point the camera', () => {
  it('uses the pocket when the shot ended in one', () => {
    expect(replayFocus([], { x: 35, y: 35 })).toEqual({ x: 35, y: 35 });
  });

  it('follows the balls that moved when nothing was potted', () => {
    // A safety is still worth reviewing, and the part of the table that moved is the part you
    // want to see — so this must not fall back to "no zoom".
    const before = [at(1, 100, 100), at(2, 900, 300)];
    const after = [at(1, 100, 100), at(2, 500, 300)];
    const focus = replayFocus(
      [
        { t: 0, balls: before },
        { t: 100, balls: after },
      ],
      null
    );
    expect(focus).not.toBeNull();
    // Ball 1 never moved, so it contributes nothing; the focus is where ball 2 ended.
    expect(focus!.x).toBeCloseTo(500, 3);
    expect(focus!.y).toBeCloseTo(300, 3);
  });

  it('gives up rather than guessing when nothing moved at all', () => {
    const still = [at(1, 100, 100)];
    expect(
      replayFocus(
        [
          { t: 0, balls: still },
          { t: 100, balls: still },
        ],
        null
      )
    ).toBeNull();
  });
});
