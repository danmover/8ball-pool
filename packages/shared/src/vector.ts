export interface Vec2 {
  x: number;
  y: number;
}

/**
 * 2D vector helpers.
 *
 * Lengths use `Math.sqrt(x*x + y*y)` rather than `Math.hypot`. The two agree to within a rounding
 * error, but only `sqrt` is required by the spec to be correctly rounded, so only `sqrt` gives the
 * same answer in every browser. Shots are replayed independently on every device in a room, so the
 * simulation has to be bit-for-bit identical everywhere — and one differing last digit in a break
 * is enough to send a ball into a different pocket.
 */
export const Vec2 = {
  zero: (): Vec2 => ({ x: 0, y: 0 }),
  add: (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y }),
  sub: (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y }),
  scale: (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s }),
  dot: (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y,
  length: (a: Vec2): number => Math.sqrt(a.x * a.x + a.y * a.y),
  lengthSq: (a: Vec2): number => a.x * a.x + a.y * a.y,
  distance: (a: Vec2, b: Vec2): number => {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  },
  normalize: (a: Vec2): Vec2 => {
    const len = Math.sqrt(a.x * a.x + a.y * a.y);
    return len > 1e-9 ? { x: a.x / len, y: a.y / len } : { x: 0, y: 0 };
  },
  fromAngle: (angleRad: number): Vec2 => ({ x: Math.cos(angleRad), y: Math.sin(angleRad) }),
  angle: (a: Vec2): number => Math.atan2(a.y, a.x),
  reflect: (v: Vec2, normal: Vec2): Vec2 => {
    const d = 2 * Vec2.dot(v, normal);
    return { x: v.x - d * normal.x, y: v.y - d * normal.y };
  },
};

/** Deterministic length for code outside `Vec2` that works on raw components. */
export function hypot2(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}
