import type { Point } from '../types.ts'

/** Distance to the first turn, including redundant collinear route vertices. */
export function terminalRunLength(points: readonly Point[], start: boolean): number {
  const origin = start ? points[0] : points.at(-1)
  if (!origin) return 0
  let dx = 0, dy = 0, run = 0
  for (let i = 1; i < points.length; i++) {
    const p = points[start ? i : points.length - 1 - i]!
    const x = p.x - origin.x, y = p.y - origin.y, length = Math.hypot(x, y)
    if (!length) continue
    if (!run) { dx = x / length; dy = y / length }
    const along = x * dx + y * dy
    if (Math.abs(x * dy - y * dx) > 1e-7 || along < run) break
    run = along
  }
  return run
}

/** One local corridor translation, with both anchors and endpoint rays fixed.
 * No visibility search or mutation: the owning router must admit the complete
 * candidate against its existing obstacles, labels and peer-route rules. */
export function extendTerminalRuns(points: Point[], clearance: { start: number; end: number }): Point[] | undefined {
  let candidate = points
  for (const start of [true, false]) {
    const needed = start ? clearance.start : clearance.end
    if (terminalRunLength(candidate, start) + 1e-7 >= needed) continue
    if (candidate.length < 4) return undefined
    const originIndex = start ? 0 : candidate.length - 1, step = start ? 1 : -1
    const origin = candidate[originIndex]!, corner = candidate[originIndex + step]!, peer = candidate[originIndex + 2 * step]!
    const dx = Math.abs(corner.x - origin.x) > 1e-7 ? Math.sign(corner.x - origin.x) : 0, dy = Math.abs(corner.y - origin.y) > 1e-7 ? Math.sign(corner.y - origin.y) : 0
    if (Number(!dx) + Number(!dy) !== 1 || (dx ? Math.abs(corner.x - peer.x) > 1e-7 : Math.abs(corner.y - peer.y) > 1e-7)) return undefined
    if (candidate === points) candidate = points.map(point => ({ ...point }))
    const key = dx ? 'x' : 'y', value = origin[key] + (dx || dy) * needed
    candidate[originIndex + step]![key] = value
    candidate[originIndex + 2 * step]![key] = value
  }
  if (candidate === points) return points
  for (const start of [true, false]) {
    if (terminalRunLength(candidate, start) + 1e-7 < (start ? clearance.start : clearance.end)) return undefined
    const i = start ? 0 : points.length - 1, j = start ? 1 : i - 1
    const a = points[i]!, old = points[j]!, next = candidate[j]!
    if ((old.x - a.x) * (next.x - a.x) + (old.y - a.y) * (next.y - a.y) <= 0) return undefined
  }
  return candidate
}
