// All spatial units are abstract "table units" (tu), chosen so the ratios match a
// real 9-foot table (playing surface 2:1, ball diameter ~1/44.4 of table length).

export const TABLE_LENGTH = 2000;
export const TABLE_WIDTH = 1000;

export const BALL_RADIUS = 22.5;
export const BALL_DIAMETER = BALL_RADIUS * 2;

// ---- Pocket mouths ----
// A pocket is an *opening between two cushion ends*, not a circle painted on the cloth. These
// two numbers say where each cushion run stops, and everything else — the physics, the aim
// guide, the bot's aiming points and the drawn bags — is derived from them in `table.ts`.
// They are deliberately the sizes the table has always been *drawn* with; the old physics used
// a far smaller capture circle, which is why balls that visibly entered a pocket bounced out.

/** How far back from each corner the two cushions meeting there stop. */
export const CORNER_MOUTH = 70;
/** How far either side of the middle the long rails stop for a side pocket. */
export const SIDE_MOUTH = 58;
/** Radius of the rounded cushion nose at each mouth end — what a rattling ball bounces off. */
export const JAW_RADIUS = 9;

export const RESTITUTION_CUSHION = 0.78;
export const RESTITUTION_BALL = 0.96;

export const REST_EPSILON = 3; // below this speed (tu/s) a ball is considered stopped

// ---- Cloth and contact physics ----
//
// A ball is a uniform sphere: I = (2/5)mR², so the useful ratio mR²/I is 5/2 and mass never
// appears on its own. Everything below is an acceleration in table units, so the simulation
// needs no mass at all.
//
// The table is 2000 tu long and a 9-foot playing surface is about 2.54 m, so 1 m ≈ 787 tu.

/** Gravity, in table units. 9.81 m/s² at 787 tu/m. */
export const GRAVITY = 7720;

/**
 * Sliding friction between ball and cloth, while the contact patch is still skidding.
 *
 * Held at the real coefficient (~0.2) deliberately. This is the number that decides how far a
 * draw shot keeps its bite and how long a ball skids before it grabs the felt, so it is exactly
 * the part that has to be honest for spin to behave the way a pool player expects.
 */
export const MU_SLIDE = 0.2;

/**
 * Rolling resistance once the ball has settled into natural roll.
 *
 * This one is *not* the real coefficient — real cloth is nearer 0.01, which would leave balls
 * gliding for two and a half table lengths and make every frame a waiting game. It is set for
 * pace. Sliding is where the physics has to be real; rolling is where the game has to be fun,
 * and the two barely interact.
 */
export const MU_ROLL = 0.054;

/**
 * Angular deceleration of spin about the vertical axis, in rad/s².
 *
 * Given as a rate rather than a friction coefficient because the torque that kills english
 * depends on the radius of the contact patch — how far the cloth is squashed under the ball —
 * and that is the one quantity in this model there is no principled way to derive. Set so a
 * full-english shot has spent most of it after a couple of seconds.
 */
export const SPIN_DECEL = 45;

/** Friction between two balls at contact — this is what produces throw. */
export const MU_BALL = 0.06;

/** Friction between ball and cushion rubber — this is what makes english change the angle. */
export const MU_CUSHION = 0.2;

/**
 * How far up the ball, as a fraction of its radius, the cue may strike.
 *
 * Past about half a radius a real tip miscues, and this is also what keeps the tip on the ball:
 * the contact point has to stay on the sphere.
 */
export const MAX_TIP_OFFSET = 0.5;

/** Deceleration while skidding, in table units/s². */
export const SLIDE_DECEL = MU_SLIDE * GRAVITY;
/**
 * Deceleration once rolling. Deliberately close to the old single-phase `FRICTION_DECEL` of
 * 420, so that adding a real sliding phase changed how spin behaves without changing how far a
 * plain rolling shot travels — the game's pace is unchanged.
 */
export const ROLL_DECEL = MU_ROLL * GRAVITY;

export const MAX_SHOT_SPEED = 4200; // tu/s at full power
export const MIN_SHOT_SPEED = 150;

export const SIM_HZ = 240; // physics substep rate
export const BROADCAST_HZ = 45; // network tick rate while balls are moving

export const CUE_BALL_ID = 0;
export const EIGHT_BALL_ID = 8;
