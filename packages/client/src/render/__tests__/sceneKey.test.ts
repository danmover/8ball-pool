import { describe, expect, it } from 'vitest';
import { sceneCacheKey } from '../sceneKey.js';

/**
 * This key has now been wrong in both directions, which is why it is worth pinning.
 *
 * Too coarse and the room stays painted for the wrong layout; too fine and it repaints on
 * every frame of a camera move. The tests below are the two failures, written down.
 */

describe('when the room must be repainted', () => {
  it('repaints for a different theme', () => {
    expect(sceneCacheKey('neon', 1440, 900, 0.4)).not.toBe(sceneCacheKey('ice', 1440, 900, 0.4));
  });

  it('repaints when the canvas resizes', () => {
    expect(sceneCacheKey('neon', 1440, 900, 0.4)).not.toBe(sceneCacheKey('neon', 800, 600, 0.4));
  });

  it('repaints when the table fits differently at the same canvas size', () => {
    // `chromeless` changes the fit from 0.8 to 1.0 without touching the canvas, and a key of
    // theme-plus-size left the room drawn for a table footprint 25% too big.
    expect(sceneCacheKey('neon', 1440, 900, 0.4)).not.toBe(sceneCacheKey('neon', 1440, 900, 0.5));
  });
});

describe('when it must not', () => {
  it('is unchanged by where the camera is looking', () => {
    // The camera is a transform over a fixed picture, not a new picture. Passing the *zoomed*
    // scale here redrew the floor, the rug and the furniture on every frame of a replay.
    const atRest = sceneCacheKey('classic', 1440, 900, 0.42);
    for (const zoom of [1.0, 1.2, 1.45, 1.85]) {
      expect(sceneCacheKey('classic', 1440, 900, 0.42), `zoom ${zoom}`).toBe(atRest);
    }
  });

  it('ignores sub-pixel canvas jitter', () => {
    // A resize observer reporting 900.4 then 900.6 must not count as two different rooms.
    expect(sceneCacheKey('classic', 1440.4, 900.4, 0.42)).toBe(
      sceneCacheKey('classic', 1440.1, 900.2, 0.42)
    );
  });

  it('ignores scale differences far below a visible one', () => {
    expect(sceneCacheKey('classic', 1440, 900, 0.4200001)).toBe(
      sceneCacheKey('classic', 1440, 900, 0.42)
    );
  });
});
