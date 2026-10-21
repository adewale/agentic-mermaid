/**
 * Post-process edge points to ensure all segments are purely orthogonal.
 *
 * When ELK uses SEPARATE hierarchy handling (required for subgraph direction
 * overrides), cross-hierarchy edges may only get start/end coordinates without
 * intermediate bend points, producing diagonal lines.
 *
 * When margins are provided, routes diagonal segments through the left or right
 * margin of the diagram (outside all subgraphs). Alternates sides and adds
 * spacing offsets to prevent overlapping parallel edges.
 *
 * Without margins, falls back to Z-path through the vertical midpoint.
 *
 * Returns the original array reference (identity) if no changes were needed,
 * so callers can detect whether routing was applied.
 */
import type { Point } from '../../types.ts'
import type { MarginInfo } from '../geometry.ts'

export function orthogonalizeEdgePoints(
  points: Point[],
  margins?: MarginInfo,
  edgeIndex: number = 0
): Point[] {
  if (points.length < 2) return points

  // Check if any segment needs orthogonalization
  let needsWork = false
  for (let i = 1; i < points.length; i++) {
    const dx = Math.abs(points[i]!.x - points[i - 1]!.x)
    const dy = Math.abs(points[i]!.y - points[i - 1]!.y)
    if (dx > 1 && dy > 1) { needsWork = true; break }
  }
  if (!needsWork) return points

  const EDGE_SPACING = 12
  const result: Point[] = [points[0]!]

  for (let i = 1; i < points.length; i++) {
    const prev = result[result.length - 1]!
    const curr = points[i]!
    const dx = Math.abs(curr.x - prev.x)
    const dy = Math.abs(curr.y - prev.y)

    if (dx > 1 && dy > 1) {
      if (margins) {
        // Margin routing: exit horizontally → travel vertically along margin → enter horizontally
        // Alternate left/right margins and offset for parallel edge spacing
        const useRight = edgeIndex % 2 === 0
        const offset = Math.floor(edgeIndex / 2) * EDGE_SPACING
        const marginX = useRight
          ? margins.rightX + offset
          : margins.leftX - offset

        result.push({ x: marginX, y: prev.y })
        result.push({ x: marginX, y: curr.y })
      } else {
        // Fallback: Z-path through vertical midpoint
        const midY = (prev.y + curr.y) / 2
        result.push({ x: prev.x, y: midY })
        result.push({ x: curr.x, y: midY })
      }
    }

    result.push(curr)
  }

  return result
}
