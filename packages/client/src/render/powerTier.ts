export function powerTierLabel(power: number): string {
  if (power < 0.05) return 'DRAG TO AIM';
  if (power < 0.3) return 'SOFT TOUCH';
  if (power < 0.6) return 'MEDIUM HIT';
  if (power < 0.85) return 'HARD HIT';
  return 'MAX POWER!';
}
