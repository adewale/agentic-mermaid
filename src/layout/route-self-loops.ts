import { resolveLabelContent } from '../shared/display-text.ts'
import type { Point, PortSide, PositionedEdge, PositionedGroup, PositionedNode, RouteBlocker } from '../types.ts'
import { graphEdgeTextBlock } from '../graph-text.ts'
import { clipEdgeToShape } from '../shape-clipping.ts'
import { LABEL_PILL_PADDING, labelHaloExtension, labelRect } from '../shared/edge-label-geometry.ts'
import { type LaneContext, setRoutePoints, opposite, routesCrossOrOverlap } from './route-geometry.ts'
import { routeCandidateMarkerBlocker, routeMarkerPaintRegions } from './route-marker-clearance.ts'
import { nodePaintBounds, paintedStrokeExtent } from '../scene/bounds.ts'
import { shapeOutline } from '../shape-outline.ts'
import { STROKE_WIDTHS, type ResolvedRenderStyle } from '../styles.ts'
export function createSelfLoopRouter(nodeMap: ReadonlyMap<string, PositionedNode>, groupMap: ReadonlyMap<string, PositionedGroup>, ctx: Pick<LaneContext, 'nodes' | 'edges' | 'style' | 'routeChannelGeometry'>, markerBlockers?: RouteBlocker[], reserved = new Set<PositionedEdge>()): (edge: PositionedEdge) => PortSide | null {
  const style = ctx.style

  // ---- Self-loop arc routing (plan §State 6; upstream #6336/#6049) --------
  //
  // ELK emits a self-loop as a ~10px stub that hides behind its own label
  // pill. Rebuild every self-loop as the standard arc: leave the node on one
  // side at cross-center − d, run out to a real depth, return at cross-center
  // + d — orthogonal, endpoints on the outline at DISTINCT points, label ON
  // the outer segment. The side starts from ELK's stub (the space it already
  // reserved) and falls back to the side with the most clear depth; the depth
  // is clamped against sibling nodes, group borders, and foreign label pills,
  // so the arc cannot introduce an overlap. This is the typed self-loop route
  // class doing its own certified repair — not an exemption from the gates.
  // Occupancy is allocated per node AND side. A node-global rank eventually
  // pushed attachments beyond the usable side span; clipping then collapsed
  // dense loops onto identical boundary-running geometry.
  const selfLoopRank = new Map<string, number>()
  const selfLoopLabelRects: Array<{ x: number; y: number; w: number; h: number }> = []
  const selfLoopLabelsBySide = new Map<string, Array<{ edge: PositionedEdge; rectIndex: number }>>()
  const rectsOverlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean => Math.min(a.x + a.w, b.x + b.w) > Math.max(a.x, b.x) && Math.min(a.y + a.h, b.y + b.h) > Math.max(a.y, b.y)
  const repairSelfLoopArc = (edge: PositionedEdge): PortSide | null => {
    const node = nodeMap.get(edge.source)
    if (!node) return null

    const cx = node.x + node.width / 2
    const cy = node.y + node.height / 2
    // Preferred side: where ELK parked the stub (its reserved space).
    const interior = edge.points.slice(1, -1)
    const ref = interior.length > 0 ? { x: interior.reduce((s, p) => s + p.x, 0) / interior.length, y: interior.reduce((s, p) => s + p.y, 0) / interior.length } : (edge.points[0] ?? { x: node.x, y: cy })
    const relX = (ref.x - cx) / Math.max(node.width / 2, 1)
    const relY = (ref.y - cy) / Math.max(node.height / 2, 1)
    const preferred: PortSide = Math.abs(relX) >= Math.abs(relY) ? (relX < 0 ? 'W' : 'E') : relY < 0 ? 'N' : 'S'
    const sideOrder: PortSide[] = [preferred, opposite(preferred), ...(preferred === 'W' || preferred === 'E' ? (['N', 'S'] as const) : (['W', 'E'] as const))]

    // Label pill measured once — it sits just OUTSIDE the loop's outer
    // segment (a pill wider than the loop is deep would otherwise cover the
    // whole arc, recreating the hidden-stub defect for short labels). The
    // rubric's self-loop rule measures pill-RECT-to-route, so a 4px gap is
    // well inside its allowance.
    const pill = edge.label ? (edge.labelBlock ?? graphEdgeTextBlock(resolveLabelContent(edge.label, edge.labelContent), style)) : null
    const pillMain = (side: PortSide): number => (pill ? (side === 'N' || side === 'S' ? pill.height : pill.width) + 2 * LABEL_PILL_PADDING : 0)

    const clearDepth = (side: PortSide, d: number): number => {
      const vertical = side === 'N' || side === 'S' // depth runs along y
      const crossCenter = vertical ? cx : cy
      const bandLo = crossCenter - d - 6
      const bandHi = crossCenter + d + 6
      const sideCoord = side === 'W' ? node.x : side === 'E' ? node.x + node.width : side === 'N' ? node.y : node.y + node.height
      const sign = side === 'W' || side === 'N' ? -1 : 1
      let max = 1000
      const consider = (lo: number, hi: number, nearEdge: number, inside: boolean): void => {
        if (hi < bandLo || lo > bandHi) return
        const dist = (nearEdge - sideCoord) * sign
        const margin = inside ? 2 : 6
        if (dist > 0) max = Math.min(max, dist - margin)
      }
      for (const other of ctx.nodes) {
        if (other.id === node.id) continue
        consider(vertical ? other.x : other.y, vertical ? other.x + other.width : other.y + other.height, vertical ? (sign < 0 ? other.y + other.height : other.y) : sign < 0 ? other.x + other.width : other.x, false)
      }
      for (const group of groupMap.values()) {
        const containsNode = cx > group.x && cx < group.x + group.width && cy > group.y && cy < group.y + group.height
        if (containsNode) {
          // The loop must stay inside its own group: the border caps depth.
          const inner = vertical ? (sign < 0 ? group.y : group.y + group.height) : sign < 0 ? group.x : group.x + group.width
          const dist = (inner - sideCoord) * sign
          if (dist > 0) max = Math.min(max, dist - 4)
        } else {
          consider(vertical ? group.x : group.y, vertical ? group.x + group.width : group.y + group.height, vertical ? (sign < 0 ? group.y + group.height : group.y) : sign < 0 ? group.x + group.width : group.x, false)
        }
      }
      for (const other of ctx.edges) {
        // Self-loop labels are allocated together with their loop geometry;
        // stale ELK positions must not collapse later loop depth.
        if (other === edge || other.source === other.target || !other.label) continue
        const r = labelRect(other, style)
        if (!r) continue
        consider(vertical ? r.x : r.y, vertical ? r.x + r.w : r.y + r.h, vertical ? (sign < 0 ? r.y + r.h : r.y) : sign < 0 ? r.x + r.w : r.x, false)
      }
      return max
    }

    const crossSize = (side: PortSide): number => (side === 'N' || side === 'S' ? node.width : node.height)
    const sideKey = (side: PortSide): string => `${node.id}:${side}`
    const sideRank = (side: PortSide): number => selfLoopRank.get(sideKey(side)) ?? 0
    const baseAttachment = (side: PortSide): number => Math.min(Math.max(crossSize(side) / 4, 6), 10, Math.max(crossSize(side) / 2 - 2, 3))
    const sideHasSlot = (side: PortSide): boolean => baseAttachment(side) + sideRank(side) * 6 <= crossSize(side) / 2 - 2
    const pickGeometry = (side: PortSide): { d: number; desired: number; clear: number } => {
      const rank = sideRank(side)
      const d = baseAttachment(side) + rank * 6
      const desired = 24 + rank * Math.max(14, pillMain(side) + 8)
      return { d, desired, clear: clearDepth(side, d) }
    }
    type LabelUpdate = { edge: PositionedEdge; position: Point; rectIndex?: number }
    const labelPlanFor = (side: PortSide, depth: number, points: Point[]): LabelUpdate[] | null => {
      if (!edge.label || !pill) return []
      // Center the pill normally just beyond its outer segment. If a blocker
      // capped two same-side depths close together, shift the later pill only
      // far enough along that segment to clear the earlier pill while staying
      // within the route-label distance contract.
      const vertical = side === 'N' || side === 'S'
      const normalSign = side === 'W' || side === 'N' ? -1 : 1
      const tangentSign = side === 'W' || side === 'S' ? -1 : 1
      const sideCoord = side === 'W' ? node.x : side === 'E' ? node.x + node.width : side === 'N' ? node.y : node.y + node.height
      const outer = sideCoord + normalSign * (depth + pillMain(side) / 2 + 4)
      const crossPitch = (vertical ? pill.width : pill.height) + 2 * LABEL_PILL_PADDING + 2
      const rank = sideRank(side)
      let position = vertical ? { x: cx, y: outer } : { x: outer, y: cy }
      const rectAt = (p: Point): { x: number; y: number; w: number; h: number } => ({
        x: p.x - pill.width / 2 - LABEL_PILL_PADDING,
        y: p.y - pill.height / 2 - LABEL_PILL_PADDING,
        w: pill.width + 2 * LABEL_PILL_PADDING,
        h: pill.height + 2 * LABEL_PILL_PADDING,
      })
      // Once a side gains a nested route, move its earlier centered pill to
      // one tangent and start the later pill on the other. Both remain close
      // to their outer segments, while the wider nested route can pass through
      // the center lane without crossing the earlier pill.
      const labelSideKey = sideKey(side)
      const previousOnSide = selfLoopLabelsBySide.get(labelSideKey) ?? []
      const updates: Array<{ edge: PositionedEdge; position: Point; rectIndex?: number }> = []
      const proposedRects = selfLoopLabelRects.slice()
      if (rank > 0) {
        for (const previous of previousOnSide) {
          const old = previous.edge.labelPosition!
          const position = vertical ? { x: cx - tangentSign * crossPitch, y: old.y } : { x: old.x, y: cy - tangentSign * crossPitch }
          updates.push({ edge: previous.edge, position, rectIndex: previous.rectIndex })
          proposedRects[previous.rectIndex] = labelRect({ ...previous.edge, labelPosition: position }, style)!
        }
        position = vertical ? { x: cx + tangentSign * crossPitch * rank, y: outer } : { x: outer, y: cy + tangentSign * crossPitch * rank }
      }
      if (proposedRects.some(r => rectsOverlap(rectAt(position), r))) {
        for (let attempt = 0; attempt < 8; attempt++) {
          const direction = attempt % 2 === 0 ? tangentSign : -tangentSign
          const offset = (1 + Math.floor(attempt / 2)) * crossPitch
          const candidate = vertical ? { x: cx + direction * offset, y: outer } : { x: outer, y: cy + direction * offset }
          if (!proposedRects.some(r => rectsOverlap(rectAt(candidate), r))) {
            position = candidate
            break
          }
        }
      }
      updates.push({ edge, position })
      // Prove the COMPLETE prepared pill and halo, including earlier labels a
      // nested loop would shift. No live seat or occupancy is changed here.
      const positions = new Map(updates.map(update => [update.edge, update.position]))
      const paintedLabel = (owner: PositionedEdge, position: Point) => {
        const rect = labelRect({ ...owner, labelPosition: position }, style)
        if (!rect) return null
        const halo = labelHaloExtension(owner, style.lineWidth ?? 1)
        return { x: rect.x - halo, y: rect.y - halo, w: rect.w + 2 * halo, h: rect.h + 2 * halo }
      }
      const bodyStyle = style as Partial<ResolvedRenderStyle>
      for (const update of updates) {
        const rect = paintedLabel(update.edge, update.position)
        const ownRect = labelRect({ ...update.edge, labelPosition: update.position }, style)
        if (!rect || !ownRect || !Object.values(rect).every(Number.isFinite)) return null
        const ownPoints = update.edge === edge ? points : update.edge.points
        let distance = Infinity
        for (let i = 1; i < ownPoints.length; i++) {
          const a = ownPoints[i - 1]!, b = ownPoints[i]!
          if (a.x !== b.x && a.y !== b.y) return null
          distance = Math.min(distance,
            Math.max(ownRect.x - Math.max(a.x, b.x), Math.min(a.x, b.x) - ownRect.x - ownRect.w, 0)
            + Math.max(ownRect.y - Math.max(a.y, b.y), Math.min(a.y, b.y) - ownRect.y - ownRect.h, 0))
        }
        // A wider later label may shift an earlier short label off its arc.
        // Every staged seat must retain the existing self-loop association.
        if (!(distance <= ownRect.h / 2 + 4)) return null
        const meets = (x: number, y: number, w: number, h: number): boolean => {
          // Reject arithmetic/writer uncertainty; never shrink foreign paint.
          const error = (Math.abs(x) + Math.abs(y) + Math.abs(w) + Math.abs(h) + Math.abs(rect.x) + Math.abs(rect.y) + rect.w + rect.h) * 1e-10 + 1e-9
          return !Number.isFinite(error) || rectsOverlap(rect, { x: x - error, y: y - error, w: w + 2 * error, h: h + 2 * error })
        }
        for (const other of ctx.nodes) {
          const outline = shapeOutline(other, { fill: other.inlineStyle?.fill ?? bodyStyle.nodeFillColor ?? 'var(--_node-fill)', stroke: other.inlineStyle?.stroke ?? bodyStyle.nodeBorderColor ?? 'var(--_node-stroke)', strokeWidth: other.inlineStyle?.['stroke-width'] ?? String(bodyStyle.nodeLineWidth ?? STROKE_WIDTHS.innerBox) }, bodyStyle.cornerRadius ?? 0)
          const bounds = nodePaintBounds({ kind: 'shape', id: other.id, role: 'node', geometry: outline.geometry, paint: outline.paint, ...(outline.childPaints ? { childPaints: outline.childPaints } : {}) })
          if (!bounds || meets(bounds.x0, bounds.y0, bounds.x1 - bounds.x0, bounds.y1 - bounds.y0)) return null
        }
        for (const group of groupMap.values()) {
          const height = group.concurrencyRegion ? 0 : group.headerHeight ?? group.height
          if (!Number.isFinite(height) || height < 0) return null
          const extent = paintedStrokeExtent({ stroke: group.inlineStyle?.stroke ?? 'black', strokeWidth: group.inlineStyle?.['stroke-width'] ?? String(bodyStyle.groupLineWidth ?? STROKE_WIDTHS.innerBox) }, true)
          if (extent === undefined) return null
          if (height > 0 && meets(group.x - extent, group.y - extent, group.width + 2 * extent, height + 2 * extent)) return null
        }
        for (const other of ctx.edges) {
          const staged = other === edge ? { ...other, points } : other
          const markers = routeMarkerPaintRegions(staged, style)
          if (!markers || markers.some(marker => !marker.bounds || meets(marker.bounds.x0, marker.bounds.y0, marker.bounds.x1 - marker.bounds.x0, marker.bounds.y1 - marker.bounds.y0))) return null
          if (other === update.edge || !other.label) continue
          const position = positions.get(other) ?? other.labelPosition
          if (!position) continue
          const peer = paintedLabel(other, position)
          if (!peer || meets(peer.x, peer.y, peer.w, peer.h)) return null
        }
      }
      return updates
    }
    // A side's raw capacity is only a proposal. Its complete marker seats
    // must also clear the live peer routes before occupancy can be committed.
    const candidateFor = (side: PortSide, g: { d: number; desired: number; clear: number }): { points: Point[]; labels: LabelUpdate[] } | null => {
      const depth = Math.max(Math.min(g.desired, g.clear), 8)
      const d = g.d
      const points: Point[] = (() => {
        switch (side) {
          case 'W':
            return [
              { x: node.x, y: cy - d },
              { x: node.x - depth, y: cy - d },
              { x: node.x - depth, y: cy + d },
              { x: node.x, y: cy + d },
            ]
          case 'E':
            return [
              { x: node.x + node.width, y: cy - d },
              { x: node.x + node.width + depth, y: cy - d },
              { x: node.x + node.width + depth, y: cy + d },
              { x: node.x + node.width, y: cy + d },
            ]
          case 'N':
            return [
              { x: cx - d, y: node.y },
              { x: cx - d, y: node.y - depth },
              { x: cx + d, y: node.y - depth },
              { x: cx + d, y: node.y },
            ]
          default:
            return [
              { x: cx - d, y: node.y + node.height },
              { x: cx - d, y: node.y + node.height + depth },
              { x: cx + d, y: node.y + node.height + depth },
              { x: cx + d, y: node.y + node.height },
            ]
        }
      })()
      // Clip both endpoints onto non-rectangular outlines before measuring
      // the actual marker pose. Failed seats leave all live routes unchanged.
      const clipped = clipEdgeToShape(clipEdgeToShape(points, node, true), node, false)
      if ([...reserved].some(other => other !== edge && routesCrossOrOverlap(clipped, other.points))) return null
      const blocker = routeCandidateMarkerBlocker(edge, clipped, ctx.edges, style)
      if (blocker) { markerBlockers?.push(blocker); return null }
      const labels = labelPlanFor(side, depth, clipped)
      return labels ? { points: clipped, labels } : null
    }
    let chosen: PortSide | null = null
    let geo: { d: number; desired: number; clear: number } | null = null
    let clipped: Point[] | null = null
    let labelUpdates: LabelUpdate[] = []
    const allocatedOrder = sideOrder
      .map((side, preference) => ({ side, preference, rank: sideRank(side) }))
      .sort((a, b) => a.rank - b.rank || a.preference - b.preference)
      .map(entry => entry.side)
    for (const side of allocatedOrder) {
      if (!sideHasSlot(side)) continue
      const g = pickGeometry(side)
      if (g.clear < Math.min(g.desired, 14)) continue
      const candidate = candidateFor(side, g)
      if (!candidate) continue
      chosen = side
      geo = g
      clipped = candidate.points
      labelUpdates = candidate.labels
      break
    }
    if (!chosen || !geo || !clipped) {
      // Preserve the existing widest-side fallback, requiring the same full
      // marker admission before it can become a certified loop.
      const available = allocatedOrder.filter(sideHasSlot)
      if (available.length === 0) return null
      const side = available.reduce((best, side) => (pickGeometry(side).clear > pickGeometry(best).clear ? side : best), available[0]!)
      const g = pickGeometry(side)
      const candidate = candidateFor(side, g)
      if (!candidate) return null
      chosen = side
      geo = g
      clipped = candidate.points
      labelUpdates = candidate.labels
    }
    reserved.add(edge)
    selfLoopRank.set(sideKey(chosen), sideRank(chosen) + 1)
    setRoutePoints(ctx, edge, clipped)
    const labelSideKey = sideKey(chosen)
    const previousOnSide = selfLoopLabelsBySide.get(labelSideKey) ?? []
    for (const update of labelUpdates) {
      update.edge.labelPosition = update.position
      const rect = labelRect(update.edge, style)!
      if (update.rectIndex !== undefined) selfLoopLabelRects[update.rectIndex] = rect
      else {
        const rectIndex = selfLoopLabelRects.push(rect) - 1
        previousOnSide.push({ edge: update.edge, rectIndex })
      }
    }
    if (labelUpdates.length) selfLoopLabelsBySide.set(labelSideKey, previousOnSide)
    return chosen
  }
  return repairSelfLoopArc
}
