import type { PositionedErDiagram, PositionedErRelationship } from './types.ts'
import type { Point } from '../types.ts'
import type { ResolvedRenderStyle } from '../styles.ts'
import { preparePixelText, type PixelTextBlock } from '../shared/prepared-text.ts'
import { resolveLabelContent } from '../shared/display-text.ts'
import { resolveRoleStyle, type InternalStyleFace } from '../scene/style-registry.ts'
import { projectRoundedConnectorPath } from '../scene/connector-geometry.ts'

export function erRelationshipBlock(rel: Pick<PositionedErRelationship, 'label' | 'identifying' | 'labelContent'>, style: ResolvedRenderStyle, styleFace?: Readonly<InternalStyleFace>): PixelTextBlock {
  const role = resolveRoleStyle(styleFace, 'relationship', { category: rel.identifying ? 'identifying' : 'non-identifying' }, { includeFallback: false })
  return preparePixelText(resolveLabelContent(rel.label, rel.labelContent), { transform: role?.textTransform ?? style.edgeTextTransform, fontSize: role?.fontSize ?? style.edgeLabelFontSize, fontWeight: role?.fontWeight ?? style.edgeLabelFontWeight, letterSpacing: role?.letterSpacing ?? style.edgeLetterSpacing })
}

/** Final native labels belong to the exact artifact returned by family layout.
 * The producer reservation is only a preference; the final center is resolved
 * after every route/frame/title transform with the request's actual style. */
export function finalizeErRelationshipLabels(diagram: PositionedErDiagram, style: ResolvedRenderStyle, styleFace?: Readonly<InternalStyleFace>): void {
  if (diagram.labelPlacement !== 'shaft-aware') return
  const positions = separateRelationshipLabels(diagram, style, styleFace)
  for (const rel of diagram.relationships) {
    const center = positions.get(rel)
    if (center) rel.finalLabelPosition = { ...center }
    else delete rel.finalLabelPosition
  }
}

/** Projection and drawing consume the same final coordinates. Programmatic
 * diagrams without a completed native layout can still use the search helper
 * with their actual style; final coordinates are not reusable proof objects. */
export function retainedErRelationshipLabels(diagram: PositionedErDiagram): Map<PositionedErRelationship, Point> | undefined {
  if (diagram.labelPlacement !== 'shaft-aware') return undefined
  const positions = new Map<PositionedErRelationship, Point>()
  for (const rel of diagram.relationships) {
    if (!rel.label || rel.points.length < 2) continue
    const center = rel.finalLabelPosition
    if (!center || !Number.isFinite(center.x) || !Number.isFinite(center.y)) return undefined
    positions.set(rel, center)
  }
  return positions
}

/**
 * Deterministic label separation: center-out arc positions along each
 * relationship's own polyline; the first whose pill clears every earlier pill
 * and every entity, marker and foreign shaft wins; the midpoint stays when nothing clears (surfaced
 * by eval/overlap-audit rather than hidden).
 */
export class ErLabelWorkLimitError extends RangeError {
  readonly code = 'ER_LABEL_WORK_LIMIT'
  constructor() { super('ER_LABEL_WORK_LIMIT: label-slot search exceeds 400000 operations; split the diagram or reduce its relationships'); this.name = 'ErLabelWorkLimitError' }
}

export function separateRelationshipLabels(
  diagram: PositionedErDiagram,
  style: ResolvedRenderStyle,
  styleFace?: Readonly<InternalStyleFace>,
): Map<PositionedErRelationship, { x: number; y: number }> {
  interface Box { x0: number; y0: number; x1: number; y1: number }
  const out = new Map<PositionedErRelationship, { x: number; y: number }>()
  if (!diagram.relationships.some(rel => rel.label && rel.points.length > 1)) return out
  const shaftAware = diagram.labelPlacement === 'shaft-aware'
  const intersects = (a: Box, b: Box): boolean =>
    Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.5 && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0.5
  const entityBoxes: Box[] = [
    ...diagram.entities.map(e => ({ x0: e.x, y0: e.y, x1: e.x + e.width, y1: e.y + e.height })),
    ...diagram.groups.map(g => ({ x0: g.x, y0: g.y, x1: g.x + g.width, y1: g.y + g.headerHeight })),
  ]
  // Crow's-foot/cardinality glyphs occupy a small zone around every route
  // endpoint. Treat those zones as reserved so a displaced relationship label
  // cannot become readable against boxes yet straddle a marker.
  const endpointBoxes: Box[] = diagram.relationships.flatMap(relationship => {
    if (relationship.points.length === 0) return []
    const endpoints = [relationship.points[0]!, relationship.points[relationship.points.length - 1]!]
    return endpoints.map(point => ({ x0: point.x - 18, y0: point.y - 18, x1: point.x + 18, y1: point.y + 18 }))
  })
  const placed: Box[] = []
  let searchWork = 0
  const charge = (count = 1) => { searchWork += count; if (searchWork > 400_000) throw new ErLabelWorkLimitError() }
  charge(entityBoxes.length + endpointBoxes.length)
  // Only the selected native producer opts into this policy. ELK, including
  // explicit fallback, keeps its existing final label algorithm. Use the visible
  // rounded projection with a tolerance allowance as a placement heuristic;
  // depth-limited flattening does not certify a universal error bound. Final
  // paint certification remains responsible for proving actual clearance.
  const shafts = shaftAware ? diagram.relationships.flatMap(owner => {
    if (owner.points.length < 2) return []
    const roleStyle = resolveRoleStyle(styleFace, 'relationship', { category: owner.identifying ? 'identifying' : 'non-identifying' }, { includeFallback: false })
    const radius = roleStyle?.bendRadius ?? style.edgeBendRadius, width = roleStyle?.lineWidth ?? style.lineWidth
    if (width <= 0) return []
    const rounded = radius > 0 && owner.points.length > 2
    const points = rounded ? projectRoundedConnectorPath(owner.points, radius, { metric: 'manhattan', precision: 3 }).geometry.points : owner.points
    // Keep thin visible strokes wider than the box-intersection tolerance.
    const padding = Math.max(.5, width / 2) + (rounded ? .5 : 0)
    return points.slice(1).map((b, index) => {
      charge()
      const a = points[index]!
      return { owner, box: { x0: Math.min(a.x, b.x) - padding, y0: Math.min(a.y, b.y) - padding, x1: Math.max(a.x, b.x) + padding, y1: Math.max(a.y, b.y) + padding } }
    })
  }) : []
  for (const rel of diagram.relationships) {
    if (!rel.label || rel.points.length < 2) continue
    const m = rel.labelBlock ?? erRelationshipBlock(rel, style, styleFace)
    // Match the public readability audit's conservative glyph-clearance box
    // (8px per side), not merely the smaller painted pill dimensions.
    const bgW = m.width + 16, bgH = m.height + 16
    const boxAt = (cx: number, cy: number): Box => ({ x0: cx - bgW / 2, y0: cy - bgH / 2, x1: cx + bgW / 2, y1: cy + bgH / 2 })
    const foreignShafts: Box[] = []
    for (const shaft of shafts) { charge(); if (shaft.owner !== rel) foreignShafts.push(shaft.box) }
    const collides = (b: Box): boolean => {
      charge()
      return b.x0 < 0 || b.y0 < 0 || b.x1 > diagram.width || b.y1 > diagram.height
      || placed.some(o => { charge(); return intersects(b, o) }) || entityBoxes.some(o => { charge(); return intersects(b, o) }) || endpointBoxes.some(o => { charge(); return intersects(b, o) })
      || foreignShafts.some(o => { charge(); return intersects(b, o) })
    }
    const pts = rel.points
    const segLens: number[] = []
    let total = 0
    for (let i = 1; i < pts.length; i++) { charge(); const l = Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y); segLens.push(l); total += l }
    const at = (dist: number): { x: number; y: number } => {
      let d = dist
      for (let i = 0; i < segLens.length; i++) {
        charge()
        if (d <= segLens[i]! || i === segLens.length - 1) {
          const t = segLens[i]! === 0 ? 0 : Math.max(0, Math.min(1, d / segLens[i]!))
          return { x: pts[i]!.x + (pts[i + 1]!.x - pts[i]!.x) * t, y: pts[i]!.y + (pts[i + 1]!.y - pts[i]!.y) * t }
        }
        d -= segLens[i]!
      }
      return pts[pts.length - 1]!
    }
    charge(pts.length * 2)
    const mid = erRelationshipMidpoint(pts)
    let chosen = { x: mid.x, y: mid.y }
    let chosenBox = boxAt(mid.x, mid.y)
    // A positioned diagram may have been edited after layout. Never use a
    // producer reservation unless it is still finite and on this exact route.
    const reserved = shaftAware ? rel.labelPosition : undefined
    if (reserved && Number.isFinite(reserved.x) && Number.isFinite(reserved.y) && pts.slice(1).some((b, index) => {
      charge()
      const a = pts[index]!, dx = b.x - a.x, dy = b.y - a.y, lengthSquared = dx * dx + dy * dy
      const fraction = lengthSquared ? Math.max(0, Math.min(1, ((reserved.x - a.x) * dx + (reserved.y - a.y) * dy) / lengthSquared)) : 0
      return Math.hypot(reserved.x - a.x - fraction * dx, reserved.y - a.y - fraction * dy) <= .001
    }) && !collides(boxAt(reserved.x, reserved.y))) {
      chosen = { ...reserved }; chosenBox = boxAt(chosen.x, chosen.y)
    }
    let needsSlot = collides(chosenBox)
    if (needsSlot) {
      for (const f of [0.4, 0.6, 0.3, 0.7, 0.25, 0.75, 0.2, 0.8, 0.15, 0.85]) {
        const q = at(total * f)
        const b = boxAt(q.x, q.y)
        if (!collides(b)) { chosen = q; chosenBox = b; needsSlot = false; break }
      }
    }
    if (needsSlot) {
      // Samples can miss a narrow clear slot. Subtract the actual occupied
      // intervals from each orthogonal segment, retaining the nearest free
      // point to the midpoint. Earlier clear placements remain unchanged.
      charge(entityBoxes.length + endpointBoxes.length + placed.length + foreignShafts.length)
      const obstacles = [...entityBoxes, ...endpointBoxes, ...placed, ...foreignShafts]
      let best: { point: Point; distance: number } | undefined, walked = 0
      for (let i = 1; i < pts.length; i++) {
        charge()
        const a = pts[i - 1]!, b = pts[i]!, length = segLens[i - 1]!
        const vertical = a.x === b.x, horizontal = a.y === b.y
        if (length === 0 || !vertical && !horizontal) { walked += length; continue }
        const fixed = vertical ? a.x : a.y, halfCross = (vertical ? bgW : bgH) / 2, halfMain = (vertical ? bgH : bgW) / 2
        const viewportCross = vertical ? diagram.width : diagram.height, viewportMain = vertical ? diagram.height : diagram.width
        if (fixed - halfCross < 0 || fixed + halfCross > viewportCross) { walked += length; continue }
        const lo = Math.max(Math.min(vertical ? a.y : a.x, vertical ? b.y : b.x), halfMain)
        const hi = Math.min(Math.max(vertical ? a.y : a.x, vertical ? b.y : b.x), viewportMain - halfMain)
        if (lo >= hi) { walked += length; continue }
        const forbidden: Array<[number, number]> = []
        for (const obstacle of obstacles) {
          charge()
          const crossLo = vertical ? obstacle.x0 : obstacle.y0, crossHi = vertical ? obstacle.x1 : obstacle.y1
          if (Math.min(fixed + halfCross, crossHi) - Math.max(fixed - halfCross, crossLo) <= .5) continue
          forbidden.push([(vertical ? obstacle.y0 : obstacle.x0) - halfMain + .5, (vertical ? obstacle.y1 : obstacle.x1) + halfMain - .5])
        }
        forbidden.sort((a, b) => { charge(); return a[0] - b[0] || a[1] - b[1] })
        const start = vertical ? a.y : a.x, sign = Math.sign((vertical ? b.y : b.x) - start)
        const preferred = start + sign * (total / 2 - walked)
        const consider = (from: number, to: number) => {
          charge()
          const inset = Math.max(1e-6, Number.EPSILON * Math.max(1, Math.abs(from), Math.abs(to)) * 8)
          if (to - from <= inset * 2) return
          const value = Math.max(from + inset, Math.min(to - inset, preferred))
          const distance = Math.abs(walked + Math.abs(value - start) - total / 2)
          if (!best || distance < best.distance) best = { point: vertical ? { x: fixed, y: value } : { x: value, y: fixed }, distance }
        }
        let cursor = lo
        for (const [from, to] of forbidden) {
          charge()
          if (to <= cursor) continue
          if (from > hi) break
          if (from > cursor) consider(cursor, Math.min(hi, from))
          cursor = Math.max(cursor, to)
          if (cursor >= hi) break
        }
        if (cursor < hi) consider(cursor, hi)
        walked += length
      }
      if (best && !collides(boxAt(best.point.x, best.point.y))) { chosen = best.point; chosenBox = boxAt(chosen.x, chosen.y) }
    }
    placed.push(chosenBox)
    out.set(rel, chosen)
  }
  return out
}

export function erRelationshipMidpoint(points: Array<{ x: number; y: number }>): { x: number; y: number } {
  if (points.length === 0) return { x: 0, y: 0 }
  if (points.length === 1) return points[0]!

  // Compute total path length
  let totalLen = 0
  for (let i = 1; i < points.length; i++) {
    const dx = points[i]!.x - points[i - 1]!.x
    const dy = points[i]!.y - points[i - 1]!.y
    totalLen += Math.sqrt(dx * dx + dy * dy)
  }

  if (totalLen === 0) return points[0]!

  // Walk to 50% of total length, interpolating within the segment that crosses the halfway mark
  const halfLen = totalLen / 2
  let walked = 0
  for (let i = 1; i < points.length; i++) {
    const dx = points[i]!.x - points[i - 1]!.x
    const dy = points[i]!.y - points[i - 1]!.y
    const segLen = Math.sqrt(dx * dx + dy * dy)
    if (walked + segLen >= halfLen) {
      const t = segLen > 0 ? (halfLen - walked) / segLen : 0
      return {
        x: points[i - 1]!.x + dx * t,
        y: points[i - 1]!.y + dy * t,
      }
    }
    walked += segLen
  }

  return points[points.length - 1]!
}
