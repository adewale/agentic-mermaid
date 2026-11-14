import type { PositionedEdge, PositionedGroup, PositionedNode } from '../types.ts'
import type { LabelMetricsStyle, LabelPaintRect } from '../route-contracts.ts'
import { customTextMeasurementActive } from '../text-measurement-profile.ts'
import { graphEdgeTextBlock } from '../graph-text.ts'
import { resolveLabelContent } from '../shared/display-text.ts'
import { labelHaloExtension, pillRect, segmentEntersLabelRect } from '../shared/edge-label-geometry.ts'
import { createInkIndex, type InkBounds } from '../shared/ink-index.ts'
import { sharedTrunkConflict } from './route-lanes.ts'

type Rect = LabelPaintRect | null
export type LabelSeatSearch = (
  positioned: { nodes: PositionedNode[]; edges: PositionedEdge[]; groups: PositionedGroup[] },
  style: LabelMetricsStyle,
  labeled: PositionedEdge[],
  clearPaintRect: (inner: LabelPaintRect, halo: number, edge: PositionedEdge) => LabelPaintRect | undefined,
  rectOf: (edge: PositionedEdge) => Rect,
  intersects: (a: LabelPaintRect, b: LabelPaintRect) => boolean,
) => {
  clear: (edge: PositionedEdge, x: number, y: number, maskFree: boolean, others: readonly PositionedEdge[]) => boolean
  memo: <A, B>(search: (a: A, b: B) => boolean) => (a: A, b: B) => boolean
} | undefined

const around = (rect: LabelPaintRect, margin = 0): InkBounds => ({ x0: rect.x - margin, y0: rect.y - margin, x1: rect.x + rect.w + margin, y1: rect.y + rect.h + margin })

/**
 * Seat search for dense labelled graphs in separateEdgeLabelPills, with the
 * same answers. That pass moves label seats only: routes, cards, headers and
 * markers stay fixed. So a candidate's clearance from everything except peer
 * pills is a fixed fact of its edge and point, decided once; a search that
 * failed fails again until some seat moves; and peer pills are indexed
 * between moves. Seats move only through the memoized searches, which report
 * a move by succeeding, until the closing rescue, which reads its own paint
 * context. Reentrant host measurement can replace geometry, so it keeps the
 * reference search. Callers opt in: C4, whose relationship tables can seat
 * hundreds of colliding labels, does.
 */
export const denseLabelSeats: LabelSeatSearch = (positioned, style, labeled, clearPaintRect, rectOf, intersects) => {
  if (customTextMeasurementActive()) return undefined
  let moves = 0, indexed = -1
  let peers: (box: InkBounds) => Array<{ edge: PositionedEdge; rect: LabelPaintRect }> = () => []
  const fixed = new Map<PositionedEdge, Map<number, Map<number, [Rect?, Rect?]>>>(), trunks = new Map<PositionedEdge, PositionedEdge[]>(), sets = new WeakMap<readonly PositionedEdge[], Set<PositionedEdge>>()
  const segments = createInkIndex(positioned.edges.flatMap(edge => edge.points.slice(1).map((b, index) => {
    const a = edge.points[index]!
    return { edge, a, b, x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) }
  })), segment => segment, () => {}, Number.MAX_SAFE_INTEGER)
  const fixedPill = (edge: PositionedEdge, x: number, y: number, maskFree: boolean): Rect => {
    const metrics = edge.labelBlock ?? graphEdgeTextBlock(resolveLabelContent(edge.label!, edge.labelContent), style)
    const pill = clearPaintRect(pillRect(x, y, metrics), labelHaloExtension(edge, style.lineWidth ?? 1), edge)
    // Only an edge sharing a trunk with this one under a pill covering every
    // route can share it under a real pill.
    const plane = { ...edge, labelBlock: { ...metrics, width: 2 ** 40, height: 2 ** 40 } }
    const trunk = trunks.get(edge) ?? trunks.set(edge, positioned.edges.filter(other => other !== edge && sharedTrunkConflict(plane, [other], style, { x: 0, y: 0 }))).get(edge)!
    // The inset masking test only fires on a segment within the halo pill.
    return !pill || sharedTrunkConflict(edge, trunk, style, { x, y })
      || maskFree && segments(around(pill, 1)).some(({ edge: other, a, b }) => other !== edge && other.style !== 'invisible' && segmentEntersLabelRect(a, b, pill)) ? null : pill
  }
  return {
    clear(edge, x, y, maskFree, others) {
      const columns = fixed.get(edge) ?? fixed.set(edge, new Map()).get(edge)!, column = columns.get(x) ?? columns.set(x, new Map()).get(x)!
      const seat = column.get(y) ?? column.set(y, []).get(y)!
      if (seat[+maskFree] === undefined) seat[+maskFree] = fixedPill(edge, x, y, maskFree)
      const pill = seat[+maskFree]
      if (!pill) return false
      if (indexed !== moves) {
        peers = createInkIndex(labeled.flatMap(peer => { const rect = rectOf(peer); return rect ? [{ edge: peer, rect, ...around(rect) }] : [] }), item => item, () => {}, Number.MAX_SAFE_INTEGER)
        indexed = moves
      }
      const members = sets.get(others) ?? sets.set(others, new Set(others)).get(others)!
      return !peers(around(pill)).some(({ edge: peer, rect }) => members.has(peer) && intersects(pill, rect))
    },
    memo(search) {
      const failed = new Map<unknown, Map<unknown, number>>()
      return (a, b) => {
        const seen = failed.get(a) ?? failed.set(a, new Map()).get(a)!
        if (seen.get(b) === moves) return false
        if (search(a, b)) return !!++moves
        seen.set(b, moves)
        return false
      }
    },
  }
}
