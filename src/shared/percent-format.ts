/** One decimal, half-up, retaining a visible minimum for a positive fraction. */
export function formatPercent1(fraction: number): string {
  if (!(fraction > 0)) return '0.0%'
  const pct = Math.max(0.1, Math.round(fraction * 1000) / 10)
  return `${pct.toFixed(1)}%`
}
