export interface BallStyle {
  base: number; // hex color
  stripe: boolean;
  label: string;
}

// Bright, saturated pool-hall colours — these read clearly at small sizes on the felt.
const SOLID_COLORS: Record<number, number> = {
  1: 0xffcf2e,
  2: 0x2a6ee0,
  3: 0xf03a2e,
  4: 0x8b4bd8,
  5: 0xff8a1f,
  6: 0x17a85a,
  7: 0x9e3226,
};

export function styleForBall(id: number): BallStyle {
  if (id === 0) return { base: 0xf6f2e6, stripe: false, label: '' };
  if (id === 8) return { base: 0x111111, stripe: false, label: '8' };
  if (id <= 7) return { base: SOLID_COLORS[id], stripe: false, label: String(id) };
  return { base: SOLID_COLORS[id - 8], stripe: true, label: String(id) };
}
