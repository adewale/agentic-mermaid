export interface ChartWidthFit {
  maxWidth: number
  width: number
  attempts: number
  status: 'fitted' | 'exceeded'
}

/** Families supply complete positioned candidates; text and placement remain
 * with their owners. Only the selected candidate proceeds to drawing. */
export function fitChartWidth<T extends { width: number }>(
  natural: T,
  maxWidth: number,
  candidate: (attempt: 1 | 2, previous: T) => T | undefined,
): T & { widthFit: ChartWidthFit } {
  let selected = natural, previous = natural, attempts = 1
  if (natural.width > maxWidth + 0.01) {
    for (const attempt of [1, 2] as const) {
      const next = candidate(attempt, previous)
      if (!next) break
      attempts++
      previous = next
      if (next.width < selected.width) selected = next
      if (next.width <= maxWidth + 0.01) { selected = next; break }
    }
  }
  return Object.assign(selected, { widthFit: { maxWidth, width: selected.width, attempts, status: selected.width <= maxWidth + 0.01 ? 'fitted' as const : 'exceeded' as const } })
}
