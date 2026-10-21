import type { PieEntry } from './types.ts'

/** A non-finite total would silently turn every finite slice into zero share. */
export function pieTotal(entries: readonly PieEntry[]): number {
  const total = entries.reduce((sum, entry) => sum + entry.value, 0)
  if (!Number.isFinite(total)) throw new Error('Pie total exceeds the finite numeric range; rescale the values')
  if (entries.some(entry => entry.value > 0 && entry.value / total === 0)) throw new Error('Pie slice share underflows the finite numeric range; rescale the values')
  return total
}
