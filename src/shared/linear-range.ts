/** Normalize finite endpoints without overflowing their difference. The usual
 * arithmetic remains unchanged for representable spans. */
export function linearFraction(value: number, min: number, max: number): number {
  if (min === max) return 0
  const span = max - min
  return Number.isFinite(span) ? (value - min) / span : (value / 2 - min / 2) / (max / 2 - min / 2)
}
