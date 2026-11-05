import type { PositionedGraph } from '../types.ts'
import type { LayoutPreferenceScore } from './certification.ts'
import type { RubricMetrics } from '../layout-rubric.ts'
import { layoutOptimizationActive } from './optimization-budget.ts'

const softMetrics = new WeakMap<PositionedGraph, readonly number[]>()
/** Preserve already assessed values only for opt-in search. Rounded preference
 * scores alone do not retain label centring or every port/bend criterion. */
export function retainComparisonMetrics(graph: PositionedGraph, metrics: RubricMetrics): void {
  if (layoutOptimizationActive()) softMetrics.set(graph, [metrics.maxBendsPerEdge, -metrics.portAnchoredEdgeRate, metrics.peerBarycenterDelta, metrics.worstLabelOffset])
}

/** Optional search may improve a criterion only without spending another one.
 * Compare complete routed geometry, not the solver's intermediate objective. */
export function nonRegressingAlternative(
  first: PositionedGraph, other: PositionedGraph,
  before = first.certification?.preference.selectedScore,
  after = other.certification?.preference.selectedScore,
): boolean {
  const firstMetrics = softMetrics.get(first), otherMetrics = softMetrics.get(other)
  if (!before || !after || !firstMetrics || !otherMetrics) return false
  const wire = (graph: PositionedGraph) => graph.edges.reduce((sum, edge) => edge.style === 'invisible' ? sum : sum + edge.points.reduce((length, point, index) => {
    const previous = edge.points[index - 1]
    return length + (previous ? Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y) : 0)
  }, 0), 0)
  const hyphens = (graph: PositionedGraph) => [...graph.nodes, ...graph.edges].reduce((sum, value) => sum + (value.labelBlock?.breaks.filter(value => value.kind === 'hyphen').length ?? 0), 0)
  const keys = Object.keys(before) as Array<keyof LayoutPreferenceScore>
  const a = [...keys.map(key => before[key]), ...firstMetrics, first.width, first.height, wire(first), hyphens(first)]
  const b = [...keys.map(key => after[key]), ...otherMetrics, other.width, other.height, wire(other), hyphens(other)]
  let improved = false
  for (let index = 0; index < a.length; index++) {
    const tolerance = Math.max(1, Math.abs(a[index]!)) * 1e-8
    if (!Number.isFinite(b[index]) || b[index]! > a[index]! + tolerance) return false
    if (b[index]! < a[index]! - tolerance) improved = true
  }
  return improved
}
