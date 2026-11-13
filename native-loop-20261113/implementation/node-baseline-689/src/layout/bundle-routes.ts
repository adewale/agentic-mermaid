import type { PositionedEdge } from '../types.ts'

interface BundleRouteGeometry {
  readonly source: string
  readonly target: string
  readonly edgeIndex: number | undefined
  readonly coordinates: readonly number[]
}

const constructed = new WeakMap<PositionedEdge, BundleRouteGeometry>()

function retain(edge: PositionedEdge): void {
  const origin = edge.points[0]
  if (!origin) return
  const coordinates: number[] = []
  for (const point of edge.points) coordinates.push(point.x - origin.x, point.y - origin.y)
  constructed.set(edge, { source: edge.source, target: edge.target, edgeIndex: edge.edgeIndex, coordinates })
}

/** Commit the related routes just built by a bounded bundle/lane producer.
 * Shared fans and parallel/reciprocal lanes have different geometry, but each
 * needs at least two related relationships. A membership set is not proof. */
export function retainConstructedBundleRoutes(edges: readonly PositionedEdge[], bundled: Set<PositionedEdge>): void {
  const first = edges[0]
  if (!first || edges.length < 2 || !(edges.every(edge => edge.source === first.source) ||
    edges.every(edge => edge.target === first.target) ||
    edges.every(edge => (edge.source === first.source && edge.target === first.target) ||
      (edge.source === first.target && edge.target === first.source)))) {
    throw new Error('Bundle construction requires related fan or parallel routes')
  }
  for (const edge of edges) { retain(edge); bundled.add(edge) }
}

/** Label-only edits and uniform translation preserve the constructed ink;
 * changed endpoints, membership identities or interior lanes do not. */
export function hasConstructedBundleRoute(edge: PositionedEdge): boolean {
  const owned = constructed.get(edge)
  if (!owned || edge.source !== owned.source || edge.target !== owned.target || edge.edgeIndex !== owned.edgeIndex ||
    edge.points.length * 2 !== owned.coordinates.length) return false
  const origin = edge.points[0]
  if (!origin) return false
  for (let i = 0; i < edge.points.length; i++) {
    const point = edge.points[i]!
    if (!(Math.abs(point.x - origin.x - owned.coordinates[i * 2]!) <= 1e-6) ||
      !(Math.abs(point.y - origin.y - owned.coordinates[i * 2 + 1]!) <= 1e-6)) return false
  }
  return true
}

/** A private snapshot copy of a constructed route keeps its ownership, so a
 * cached layout is audited exactly like the fresh one it was copied from.
 * Ownership stays bound to the copied ink: moving its interior still drops it. */
export function transferConstructedBundleRoute(source: object, copy: object): void {
  const owned = constructed.get(source as PositionedEdge)
  if (owned) constructed.set(copy as PositionedEdge, owned)
}

/** Carry ownership only through a known construction-preserving operation:
 * clipping, polyline simplification or removal of a proven tiny hitch. Late
 * rerouting and certificate reissuance deliberately cannot call this seam. */
export function bundleRouteBeforeRewrite(edge: PositionedEdge): BundleRouteGeometry | undefined {
  return hasConstructedBundleRoute(edge) ? constructed.get(edge) : undefined
}

export function retainBundleRouteAfterRewrite(edge: PositionedEdge, before: BundleRouteGeometry | undefined): void {
  if (before && constructed.get(edge) === before && edge.source === before.source && edge.target === before.target && edge.edgeIndex === before.edgeIndex) retain(edge)
}
