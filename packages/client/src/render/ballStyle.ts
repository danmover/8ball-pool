export interface BallStyle {
  base: number; // hex color
  stripe: boolean;
  label: string;
}

const SOLID_COLORS: Record<number, number> = {
  1: 0xf4c430,
  2: 0x1f5fbf,
  3: 0xd6392e,
  4: 0x6c3fa6,
  5: 0xe07a1f,
  6: 0x1f7a3f,
  7: 0x7a2e2e,
};

export function styleForBall(id: number): BallStyle {
  if (id === 0) return { base: 0xf6f2e6, stripe: false, label: '' };
  if (id === 8) return { base: 0x111111, stripe: false, label: '8' };
  if (id <= 7) return { base: SOLID_COLORS[id], stripe: false, label: String(id) };
  return { base: SOLID_COLORS[id - 8], stripe: true, label: String(id) };
}
