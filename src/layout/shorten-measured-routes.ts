import type { AgenticLayout, MeasuredGraph } from './agentic-layered-core.ts'
import type { Point } from '../types.ts'
import { countPolylineCrossings } from '../shared/edge-crossings.ts'
import { type MeasuredBox, segmentEntersMeasuredBox, pointOnMeasuredSegment, measuredBoxesOverlap, scoreMeasuredRouteCrossings } from './measured-route-safety.ts'

function simplify(points: readonly Point[]): Point[] {
  const result: Point[] = []
  for (const point of points) {
    const last = result.at(-1), previous = result.at(-2)
    if (last?.x === point.x && last.y === point.y) continue
    if (previous && last && ((previous.x === last.x && last.x === point.x && (last.y - previous.y) * (point.y - last.y) >= 0)
      || (previous.y === last.y && last.y === point.y && (last.x - previous.x) * (point.x - last.x) >= 0))) result.pop()
    result.push(point)
  }
  return result
}

/** Shortcuts operate only on a completed measured graph. They retain endpoint
 * rays, clear every occupied box, and cannot increase any
 * crossing counts or introduce a shared shaft. Exhaustion leaves feasible routes intact. */
export function shortenMeasuredRoutes(input: MeasuredGraph, placed: AgenticLayout): AgenticLayout {
  if (placed.topology === 'forest' || placed.sharedEdges?.length || input.edges.length > 128
    || placed.edges.reduce((sum, edge) => sum + edge.points.length, 0) > 2048) return placed
  const boxes: MeasuredBox[] = input.nodes.map((node, index) => ({ ...placed.nodes[index]!, width: node.width, height: node.height }))
  const headers = (placed.groups ?? []).map((group, index) => ({ ...group, height: input.groups![index]!.padding.top }))
  const labels = input.edges.map((edge, index) => {
    const p = placed.edges[index]!.labelPosition
    return edge.label && p ? { x: p.x - edge.label.width / 2 - 2, y: p.y - edge.label.height / 2 - 2,
      width: edge.label.width + 4, height: edge.label.height + 4 } : undefined
  })
  const ink = placed.edges.map((edge, index) => ({ points: edge.points, source: String(input.edges[index]!.source), target: String(input.edges[index]!.target),
    style: input.edges[index]!.visible === false ? 'invisible' as const : 'solid' as const }))
  const visibleRoutes = () => ink.map(edge => ({ points: edge.points, visible: edge.style !== 'invisible' }))
  const length = (points: readonly Point[]): number => points.slice(1).reduce((sum, point, index) => sum + Math.abs(point.x - points[index]!.x) + Math.abs(point.y - points[index]!.y), 0)
  const ray = (a: Point, b: Point): string => `${Math.sign(b.x - a.x)},${Math.sign(b.y - a.y)}`
  let attempts = 512, comparisons = 8_000_000
  const chargeContact = (amount: number): boolean => (comparisons -= amount) >= 0
  for (const [index, edge] of input.edges.entries()) {
    if (placed.boundaryRoutes?.includes(index)) continue
    if (edge.source === edge.target || edge.visible === false || ink[index]!.points.length < 5) continue
    let localAttempts = 24
    const occupied = [...boxes, ...headers, ...labels.filter((box, other): box is MeasuredBox => Boolean(box) && other !== index)]
    const involved = new Set([index])
    let crossings: number | undefined
    for (let edit = 0; edit < 4; edit++) {
      const original = ink[index]!.points, anchor = placed.edges[index]!.labelPosition
      const points = [...original]
      let split = -1
      if (anchor) {
        split = points.findIndex(point => point.x === anchor.x && point.y === anchor.y)
        if (split < 0) for (let cursor = 1; cursor < points.length; cursor++) {
          if (pointOnMeasuredSegment(anchor, points[cursor - 1]!, points[cursor]!)) { split = cursor; points.splice(cursor, 0, { ...anchor }); break }
        }
        if (split < 0) break
      }
      const ranges = [[0, points.length - 1], ...(split > 0 && split < points.length - 1 ? [[0, split], [split, points.length - 1]] : [])]
      let changed = false
      search: for (const [lo, hi] of ranges) for (let first = lo!; first + 2 < hi!; first++) {
        for (let last = hi!; last > first + 2; last--) for (const horizontalFirst of [false, true]) {
          comparisons -= points.length
          if (comparisons < 0) return placed
          const a = points[first]!, b = points[last]!
          const corner = horizontalFirst ? { x: b.x, y: a.y } : { x: a.x, y: b.y }
          const candidate = simplify([...points.slice(0, first + 1), corner, ...points.slice(last)])
          if (candidate.length >= original.length || length(candidate) > length(original) + 1e-7
            || ray(candidate[0]!, candidate[1]!) !== ray(original[0]!, original[1]!)
            || ray(candidate.at(-2)!, candidate.at(-1)!) !== ray(original.at(-2)!, original.at(-1)!)) continue
          comparisons -= candidate.length * occupied.length
          if (comparisons < 0) return placed
          if (candidate.slice(1).some((point, cursor) => occupied.some(box => segmentEntersMeasuredBox(candidate[cursor]!, point, box)))) continue
          comparisons -= candidate.length * ink.reduce((sum, route) => sum + route.points.length, 0)
          if (comparisons < 0) return placed
          const count = ink.reduce((sum, route) => sum + route.points.length, 0)
          if (localAttempts-- <= 0) break search
          if (attempts-- <= 0) return placed
          comparisons -= count * count
          if (comparisons < 0) return placed
          const nextCrossings = scoreMeasuredRouteCrossings(candidate, index, ink, input, chargeContact, chargeContact)
          if (comparisons < 0) return placed
          if (nextCrossings === undefined) continue
          let labelPosition = anchor, labelBox = labels[index]
          if (anchor && edge.label && !candidate.slice(1).some((point, cursor) => pointOnMeasuredSegment(anchor, candidate[cursor]!, point))) {
            const positions: Point[] = []
            for (let cursor = 1; cursor < candidate.length; cursor++) {
              const a = candidate[cursor - 1]!, b = candidate[cursor]!, horizontal = a.y === b.y
              const half = (horizontal ? edge.label.width : edge.label.height) / 2 + 2
              const lo = Math.min(horizontal ? a.x : a.y, horizontal ? b.x : b.y) + half
              const hi = Math.max(horizontal ? a.x : a.y, horizontal ? b.x : b.y) - half
              if (lo > hi) continue
              const coord = Math.max(lo, Math.min(hi, horizontal ? anchor.x : anchor.y))
              positions.push(horizontal ? { x: coord, y: a.y } : { x: a.x, y: coord })
              positions.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
            }
            positions.sort((a, b) => Math.abs(a.x - anchor.x) + Math.abs(a.y - anchor.y) - Math.abs(b.x - anchor.x) - Math.abs(b.y - anchor.y))
            labelPosition = undefined
            for (const p of positions) {
              const box = { x: p.x - edge.label.width / 2 - 2, y: p.y - edge.label.height / 2 - 2,
                width: edge.label.width + 4, height: edge.label.height + 4 }
              comparisons -= occupied.length + ink.reduce((sum, route) => sum + route.points.length, 0)
              if (comparisons < 0) return placed
              if (box.x < 0 || box.y < 0 || box.x + box.width > placed.width || box.y + box.height > placed.height
                || occupied.some(other => measuredBoxesOverlap(box, other))) continue
              if (ink.some((route, other) => other !== index && route.style !== 'invisible'
                && route.points.slice(1).some((point, cursor) => segmentEntersMeasuredBox(route.points[cursor]!, point, box)))) continue
              labelPosition = p; labelBox = box
              break
            }
            if (!labelPosition) continue
          }
          crossings ??= countPolylineCrossings(visibleRoutes(), involved)
          ink[index]!.points = candidate
          if (nextCrossings > crossings) { ink[index]!.points = original; continue }
          placed.edges[index]!.points = candidate
          if (labelPosition) placed.edges[index]!.labelPosition = { ...labelPosition }
          labels[index] = labelBox
          crossings = nextCrossings
          changed = true
          break search
        }
      }
      if (!changed) break
    }
  }
  return placed
}
