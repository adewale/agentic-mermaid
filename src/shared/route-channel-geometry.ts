import type { Point, PositionedEdge } from '../types.ts'

interface Envelope {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

interface RouteRevision {
  revision: number
  builtRevision: number
  points: readonly Point[]
  envelope: Envelope | null
}

function envelope(points: readonly Point[]): Envelope | null {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const point of points) {
    const x = point.x, y = point.y
    // The exact predicate has deliberately permissive NaN comparisons in its
    // parallel test. Preserve those semantics by falling back to that loop.
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }
  return { minX, maxX, minY, maxY }
}

/** Owned by one route-contract invocation, never a borrowed placement context.
 * Every owner write invalidates its edge revision, including in-place edits
 * and rollback. Array identity is an additional guard, not the lifetime proof.
 * Label geometry remains live and is never read or retained here. */
export class RouteChannelGeometry {
  private readonly routes = new WeakMap<PositionedEdge, RouteRevision>()

  invalidate(edge: PositionedEdge): void {
    const record = this.routes.get(edge)
    if (record) record.revision++
  }

  mayBlock(edge: PositionedEdge, cross: 'x' | 'y', coordinate: number, mainLo: number, mainHi: number, clearance: number, epsilon: number): boolean {
    if (!Number.isFinite(coordinate) || !Number.isFinite(mainLo) || !Number.isFinite(mainHi)) return true
    if (edge.points.length < 2) return false
    let record = this.routes.get(edge)
    if (!record) {
      record = { revision: 0, builtRevision: 0, points: edge.points, envelope: envelope(edge.points) }
      this.routes.set(edge, record)
    } else if (record.builtRevision !== record.revision || record.points !== edge.points) {
      record.points = edge.points
      record.envelope = envelope(edge.points)
      record.builtRevision = record.revision
    }
    const bounds = record.envelope
    if (!bounds) return true
    const crossLo = cross === 'x' ? bounds.minX : bounds.minY
    const crossHi = cross === 'x' ? bounds.maxX : bounds.maxY
    // Subtract the query from the interval endpoint, as the exact distance
    // predicate does. Inflating bounds first can lose a near-boundary hit to
    // floating-point rounding (for example abs(0.1 - 4.1) < 4).
    if (coordinate < crossLo && crossLo - coordinate >= clearance) return false
    if (coordinate > crossHi && coordinate - crossHi >= clearance) return false
    const routeLo = cross === 'x' ? bounds.minY : bounds.minX
    const routeHi = cross === 'x' ? bounds.maxY : bounds.maxX
    return Math.min(mainHi, routeHi) - Math.max(mainLo, routeLo) > epsilon
  }
}

