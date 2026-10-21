/** Keep compact two-decimal labels without turning nonzero data into zero
 * or overflowing a finite value during decimal scaling. */
export function formatChartValue(value: number): string {
  if (Number.isInteger(value)) return String(value)
  const rounded = Math.round(value * 100) / 100
  return String(Number.isFinite(rounded) && (rounded !== 0 || value === 0) ? rounded : value)
}
