/**
 * Ball orientation, for drawing the spin the physics already computes.
 *
 * The renderer used to roll each ball's markings by how far it had *moved* — distance over
 * radius — which is only right for a ball in natural roll. A ball carrying backspin travels
 * forwards while turning backwards, and a ball with english turns about the vertical axis
 * without its markings moving across the face at all. Both came out wrong, and the cue ball,
 * where it matters most, had no marking to be wrong with.
 *
 * So orientation is now integrated from `Ball.angVel` directly. Same frame as the physics:
 * x right, y down the screen, z **into** the table — which means the camera looks along +z and
 * the visible hemisphere is the one with negative z.
 */

/** Row-major 3×3 rotation, body → world. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export function identity(): Mat3 {
  return [1, 0, 0, 0, 1, 0, 0, 0, 1];
}

/** A rotation of `angle` radians about a unit axis, by Rodrigues' formula. */
function fromAxisAngle(x: number, y: number, z: number, angle: number): Mat3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return [
    t * x * x + c,
    t * x * y - s * z,
    t * x * z + s * y,
    t * x * y + s * z,
    t * y * y + c,
    t * y * z - s * x,
    t * x * z - s * y,
    t * y * z + s * x,
    t * z * z + c,
  ];
}

export function multiply(a: Mat3, b: Mat3): Mat3 {
  const out = new Array(9) as Mat3;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return out;
}

/** Rotates a body-space vector into world space. */
export function apply(m: Mat3, x: number, y: number, z: number): { x: number; y: number; z: number } {
  return {
    x: m[0] * x + m[1] * y + m[2] * z,
    y: m[3] * x + m[4] * y + m[5] * z,
    z: m[6] * x + m[7] * y + m[8] * z,
  };
}

/**
 * Advances an orientation by an angular velocity applied for `dt` seconds.
 *
 * The angular velocity is in *world* axes, so the incremental rotation pre-multiplies. Doing it
 * the other way round makes a ball with side spin slowly tumble, which is the sort of bug that
 * looks like bad art rather than bad maths.
 */
export function integrate(m: Mat3, w: { x: number; y: number; z: number }, dt: number): Mat3 {
  const speed = Math.hypot(w.x, w.y, w.z);
  if (speed < 1e-6 || dt <= 0) return m;
  const angle = speed * dt;
  const step = fromAxisAngle(w.x / speed, w.y / speed, w.z / speed, angle);
  return orthonormalise(multiply(step, m));
}

/**
 * Pulls the matrix back onto the rotation group.
 *
 * Thousands of small multiplications a minute accumulate float error, and a drifting matrix
 * shears the markings instead of turning them. Gram-Schmidt on the rows is cheap and enough.
 */
export function orthonormalise(m: Mat3): Mat3 {
  const len0 = Math.hypot(m[0], m[1], m[2]) || 1;
  const r0 = [m[0] / len0, m[1] / len0, m[2] / len0];

  const dot = m[3] * r0[0] + m[4] * r0[1] + m[5] * r0[2];
  const p1 = [m[3] - dot * r0[0], m[4] - dot * r0[1], m[5] - dot * r0[2]];
  const len1 = Math.hypot(p1[0], p1[1], p1[2]) || 1;
  const r1 = [p1[0] / len1, p1[1] / len1, p1[2] / len1];

  // Third row is forced to the cross product, so the matrix stays right-handed.
  const r2 = [
    r0[1] * r1[2] - r0[2] * r1[1],
    r0[2] * r1[0] - r0[0] * r1[2],
    r0[0] * r1[1] - r0[1] * r1[0],
  ];
  return [r0[0], r0[1], r0[2], r1[0], r1[1], r1[2], r2[0], r2[1], r2[2]] as Mat3;
}

/**
 * A random-looking starting pose that still faces the camera.
 *
 * Not uniformly random: a fresh rack of uniformly-oriented balls hides over half the numbers,
 * which reads as a bug rather than as realism. So the marking is tilted by at most ~40° off
 * the camera and then twisted freely — varied enough that no two balls look stamped alike,
 * while every number stays legible.
 */
export function randomOrientation(rand: () => number = Math.random): Mat3 {
  const tilt = rand() * 0.7;
  const dir = rand() * Math.PI * 2;
  const lean = fromAxisAngle(Math.cos(dir), Math.sin(dir), 0, tilt);
  const twist = fromAxisAngle(0, 0, 1, rand() * Math.PI * 2);
  return orthonormalise(multiply(twist, lean));
}

/** Where a body-fixed surface point lands on screen, and whether it faces the camera. */
export interface Projected {
  /** Offset from the ball's centre, in units of the ball radius. */
  x: number;
  y: number;
  /** 1 at the centre of the visible face, 0 at the rim, negative round the back. */
  depth: number;
  /** Screen angle of the marking's own "up" axis — this is what shows english. */
  twist: number;
}

/**
 * Projects a body-fixed marking (a surface point plus its up direction) to screen.
 *
 * Orthographic, which is exact for a top-down view: the screen position is simply the world
 * vector's x and y. `twist` comes from the marking's up axis with its radial component removed,
 * and is the whole reason spin about the vertical axis is visible at all — a ball spinning that
 * way doesn't move its front-facing marking anywhere, it just turns it on the spot.
 */
export function project(m: Mat3, point: [number, number, number], up: [number, number, number]): Projected {
  const p = apply(m, point[0], point[1], point[2]);
  const u = apply(m, up[0], up[1], up[2]);

  // Camera looks along +z (into the table), so the near hemisphere has negative z.
  const depth = -p.z;

  // Remove the component of `up` along the surface normal, leaving it tangent to the sphere.
  const dot = u.x * p.x + u.y * p.y + u.z * p.z;
  const tx = u.x - dot * p.x;
  const ty = u.y - dot * p.y;

  return { x: p.x, y: p.y, depth, twist: Math.atan2(ty, tx) };
}
