import { describe, expect, it } from 'vitest';
import { BALL_RADIUS, pathIsClear } from '../index.js';
import type { Ball } from '../types.js';

function ball(id: number, x: number, y: number): Ball {
  return { id, kind: 'solid', pos: { x, y }, vel: { x: 0, y: 0 }, spin: 0, pocketed: false };
}

describe('pathIsClear', () => {
  it('sees an empty line as clear', () => {
    expect(pathIsClear([ball(1, 500, 900)], { x: 100, y: 100 }, { x: 900, y: 100 })).toBe(true);
  });

  it('reports a ball sitting on the line as blocking', () => {
    expect(pathIsClear([ball(1, 500, 100)], { x: 100, y: 100 }, { x: 900, y: 100 })).toBe(false);
  });

  it('counts a near miss inside one diameter as blocking', () => {
    const grazing = ball(1, 500, 100 + BALL_RADIUS * 1.5);
    expect(pathIsClear([grazing], { x: 100, y: 100 }, { x: 900, y: 100 })).toBe(false);
  });

  it('ignores balls at the ends of the line', () => {
    const target = ball(7, 900, 100);
    expect(pathIsClear([target], { x: 100, y: 100 }, { x: 900, y: 100 }, [7])).toBe(true);
  });

  it('ignores balls behind the start or past the end', () => {
    const behind = ball(1, 0, 100);
    const beyond = ball(2, 1400, 100);
    expect(pathIsClear([behind, beyond], { x: 100, y: 100 }, { x: 900, y: 100 })).toBe(true);
  });

  it('ignores pocketed balls', () => {
    const down = { ...ball(1, 500, 100), pocketed: true };
    expect(pathIsClear([down], { x: 100, y: 100 }, { x: 900, y: 100 })).toBe(true);
  });
});
