// All spatial units are abstract "table units" (tu), chosen so the ratios match a
// real 9-foot table (playing surface 2:1, ball diameter ~1/44.4 of table length).

export const TABLE_LENGTH = 2000;
export const TABLE_WIDTH = 1000;

export const BALL_RADIUS = 22.5;
export const BALL_DIAMETER = BALL_RADIUS * 2;

export const CORNER_POCKET_RADIUS = BALL_RADIUS * 1.75;
export const SIDE_POCKET_RADIUS = BALL_RADIUS * 1.9;

// Pocket capture points, in table-space (0,0) = top-left of the playing surface.
export const POCKETS: { x: number; y: number; radius: number }[] = [
  { x: 0, y: 0, radius: CORNER_POCKET_RADIUS },
  { x: TABLE_LENGTH / 2, y: -6, radius: SIDE_POCKET_RADIUS },
  { x: TABLE_LENGTH, y: 0, radius: CORNER_POCKET_RADIUS },
  { x: 0, y: TABLE_WIDTH, radius: CORNER_POCKET_RADIUS },
  { x: TABLE_LENGTH / 2, y: TABLE_WIDTH + 6, radius: SIDE_POCKET_RADIUS },
  { x: TABLE_LENGTH, y: TABLE_WIDTH, radius: CORNER_POCKET_RADIUS },
];

export const RESTITUTION_CUSHION = 0.78;
export const RESTITUTION_BALL = 0.96;

// Single-phase rolling-friction deceleration; real pool has a short sliding phase
// before a struck ball "grabs" the felt, but a single deceleration reads fine for v1.
export const FRICTION_DECEL = 420; // table-units / s^2
export const REST_EPSILON = 3; // below this speed (tu/s) a ball is considered stopped
export const SPIN_DAMPING = 0.92; // per second, side-spin decay

export const MAX_SHOT_SPEED = 4200; // tu/s at full power
export const MIN_SHOT_SPEED = 150;

export const SIM_HZ = 240; // physics substep rate
export const BROADCAST_HZ = 45; // network tick rate while balls are moving

export const CUE_BALL_ID = 0;
export const EIGHT_BALL_ID = 8;
