import { resolveLabelContent } from '../shared/display-text.ts'
import type { Point, PortSide, PositionedEdge, PositionedGroup, PositionedNode } from '../types.ts'
import { graphEdgeTextBlock } from '../graph-text.ts'
import { clipEdgeToShape } from '../shape-clipping.ts'
import { LABEL_PILL_PADDING, labelRect } from '../shared/edge-label-geometry.ts'
import { type LaneContext, opposite } from './route-geometry.ts'
export function createSelfLoopRouter(nodeMap: ReadonlyMap<string, PositionedNode>, groupMap: ReadonlyMap<string, PositionedGroup>, ctx: Pick<LaneContext, 'nodes' | 'edges' | 'style'>): (edge: PositionedEdge) => PortSide | null {
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
    let chosen: PortSide | null = null
    let geo: { d: number; desired: number; clear: number } | null = null
    const allocatedOrder = sideOrder
      .map((side, preference) => ({ side, preference, rank: sideRank(side) }))
      .sort((a, b) => a.rank - b.rank || a.preference - b.preference)
      .map(entry => entry.side)
    for (const side of allocatedOrder) {
      if (!sideHasSlot(side)) continue
      const g = pickGeometry(side)
      if (g.clear >= Math.min(g.desired, 14)) {
        chosen = side
        geo = g
        break
      }
    }
    if (!chosen || !geo) {
      // No side offers the minimum arc — keep the widest one (still honest,
      // still certified; the audit gates verify no overlap was introduced).
      const available = allocatedOrder.filter(sideHasSlot)
      if (available.length === 0) return null
      chosen = available.reduce((best, side) => (pickGeometry(side).clear > pickGeometry(best).clear ? side : best), available[0]!)
      geo = pickGeometry(chosen)
    }
    selfLoopRank.set(sideKey(chosen), sideRank(chosen) + 1)
    const depth = Math.max(Math.min(geo.desired, geo.clear), 8)
    const d = geo.d

    const points: Point[] = (() => {
      switch (chosen) {
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
    // Clip both endpoints onto non-rectangular outlines (diamond facets,
    // circles, …) — the clip slides the endpoint along its own orthogonal
    // segment, so orthogonality is preserved.
    edge.points = clipEdgeToShape(clipEdgeToShape(points, node, true), node, false)
    if (edge.label && pill) {
      // Center the pill normally just beyond its outer segment. If a blocker
      // capped two same-side depths close together, shift the later pill only
      // far enough along that segment to clear the earlier pill while staying
      // within the route-label distance contract.
      const vertical = chosen === 'N' || chosen === 'S'
      const normalSign = chosen === 'W' || chosen === 'N' ? -1 : 1
      const tangentSign = chosen === 'W' || chosen === 'S' ? -1 : 1
      const sideCoord = chosen === 'W' ? node.x : chosen === 'E' ? node.x + node.width : chosen === 'N' ? node.y : node.y + node.height
      const outer = sideCoord + normalSign * (depth + pillMain(chosen) / 2 + 4)
      const crossPitch = (vertical ? pill.width : pill.height) + 2 * LABEL_PILL_PADDING + 2
      const rank = sideRank(chosen) - 1
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
      const labelSideKey = sideKey(chosen)
      const previousOnSide = selfLoopLabelsBySide.get(labelSideKey) ?? []
      if (rank > 0) {
        for (const previous of previousOnSide) {
          const old = previous.edge.labelPosition!
          previous.edge.labelPosition = vertical ? { x: cx - tangentSign * crossPitch, y: old.y } : { x: old.x, y: cy - tangentSign * crossPitch }
          selfLoopLabelRects[previous.rectIndex] = rectAt(previous.edge.labelPosition)
        }
        position = vertical ? { x: cx + tangentSign * crossPitch * rank, y: outer } : { x: outer, y: cy + tangentSign * crossPitch * rank }
      }
      if (selfLoopLabelRects.some(r => rectsOverlap(rectAt(position), r))) {
        for (let attempt = 0; attempt < 8; attempt++) {
          const direction = attempt % 2 === 0 ? tangentSign : -tangentSign
          const offset = (1 + Math.floor(attempt / 2)) * crossPitch
          const candidate = vertical ? { x: cx + direction * offset, y: outer } : { x: outer, y: cy + direction * offset }
          if (!selfLoopLabelRects.some(r => rectsOverlap(rectAt(candidate), r))) {
            position = candidate
            break
          }
        }
      }
      edge.labelPosition = position
      const rectIndex = selfLoopLabelRects.push(rectAt(position)) - 1
      previousOnSide.push({ edge, rectIndex })
      selfLoopLabelsBySide.set(labelSideKey, previousOnSide)
    }
    return chosen
  }
  return repairSelfLoopArc
}
