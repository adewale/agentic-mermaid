import type { AgenticLayout, MeasuredGraph } from './agentic-layered-core.ts'
import type { Point } from '../types.ts'
import { countPolylineCrossings } from '../shared/edge-crossings.ts'

interface Box { x: number; y: number; width: number; height: number }

function inside(a: Point, b: Point, box: Box): boolean {
  return a.x === b.x
    ? a.x > box.x && a.x < box.x + box.width && Math.max(a.y, b.y) > box.y && Math.min(a.y, b.y) < box.y + box.height
    : a.y > box.y && a.y < box.y + box.height && Math.max(a.x, b.x) > box.x && Math.min(a.x, b.x) < box.x + box.width
}

function onSegment(point: Point, a: Point, b: Point): boolean {
  return (a.x === b.x ? Math.abs(point.x - a.x) < 1e-7 : Math.abs(point.y - a.y) < 1e-7)
    && point.x >= Math.min(a.x, b.x) && point.x <= Math.max(a.x, b.x)
    && point.y >= Math.min(a.y, b.y) && point.y <= Math.max(a.y, b.y)
}

function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

function sharesShaft(a: Point, b: Point, c: Point, d: Point): boolean {
  return (a.x === b.x && c.x === d.x && Math.abs(a.x - c.x) <= 0.5
    && Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) > 0.01)
    || (a.y === b.y && c.y === d.y && Math.abs(a.y - c.y) <= 0.5
      && Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) > 0.01)
}

/** A bend touching another route must not erase a crossing from the metric.
 * Only an authored common endpoint may be an unmarked contact. */
function crossingScore(points: Point[], index: number, routes: readonly { points: Point[]; style: string }[], input: MeasuredGraph): number | undefined {
  let score = 0
  const edge = input.edges[index]!
  for (const [other, route] of routes.entries()) {
    if (other === index || route.style === 'invisible') continue
    const peerEdge = input.edges[other]!, contacts = new Map<string, Point>()
    for (let i = 1; i < points.length; i++) for (let j = 1; j < route.points.length; j++) {
      const a = points[i - 1]!, b = points[i]!, c = route.points[j - 1]!, d = route.points[j]!
      if (sharesShaft(a, b, c, d)) return undefined
      const av = a.x === b.x, bv = c.x === d.x
      let p: Point | undefined
      if (av !== bv) {
        const vertical = av ? a : c, horizontal = av ? c : a
        const point = { x: vertical.x, y: horizontal.y }
        if (onSegment(point, a, b) && onSegment(point, c, d)) p = point
      } else if (av ? a.x === c.x : a.y === c.y) {
        const lo = Math.max(av ? Math.min(a.y, b.y) : Math.min(a.x, b.x), av ? Math.min(c.y, d.y) : Math.min(c.x, d.x))
        const hi = Math.min(av ? Math.max(a.y, b.y) : Math.max(a.x, b.x), av ? Math.max(c.y, d.y) : Math.max(c.x, d.x))
        if (hi >= lo) p = av ? { x: a.x, y: lo } : { x: lo, y: a.y }
      }
      if (!p) continue
      const common = ([['source', 0], ['target', points.length - 1]] as const).some(([end, pointIndex]) =>
        ([['source', 0], ['target', route.points.length - 1]] as const).some(([peerEnd, peerIndex]) => edge[end] === peerEdge[peerEnd]
          && points[pointIndex]!.x === p!.x && points[pointIndex]!.y === p!.y && route.points[peerIndex]!.x === p!.x && route.points[peerIndex]!.y === p!.y))
      if (!common) contacts.set(`${p.x},${p.y}`, p)
    }
    const crossings = countPolylineCrossings([{ points }, route])
    if (crossings < contacts.size) return undefined
    score += crossings
  }
  return score
}

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
  const boxes: Box[] = input.nodes.map((node, index) => ({ ...placed.nodes[index]!, width: node.width, height: node.height }))
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
  for (const [index, edge] of input.edges.entries()) {
    if (edge.source === edge.target || edge.visible === false || ink[index]!.points.length < 5) continue
    let localAttempts = 24
    const occupied = [...boxes, ...headers, ...labels.filter((box, other): box is Box => Boolean(box) && other !== index)]
    const involved = new Set([index])
    let crossings: number | undefined
    for (let edit = 0; edit < 4; edit++) {
      const original = ink[index]!.points, anchor = placed.edges[index]!.labelPosition
      const points = [...original]
      let split = -1
      if (anchor) {
        split = points.findIndex(point => point.x === anchor.x && point.y === anchor.y)
        if (split < 0) for (let cursor = 1; cursor < points.length; cursor++) {
          if (onSegment(anchor, points[cursor - 1]!, points[cursor]!)) { split = cursor; points.splice(cursor, 0, { ...anchor }); break }
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
          if (candidate.slice(1).some((point, cursor) => occupied.some(box => inside(candidate[cursor]!, point, box)))) continue
          comparisons -= candidate.length * ink.reduce((sum, route) => sum + route.points.length, 0)
          if (comparisons < 0) return placed
          const count = ink.reduce((sum, route) => sum + route.points.length, 0)
          if (localAttempts-- <= 0) break search
          if (attempts-- <= 0) return placed
          comparisons -= count * count
          if (comparisons < 0) return placed
          const nextCrossings = crossingScore(candidate, index, ink, input)
          if (nextCrossings === undefined) continue
          let labelPosition = anchor, labelBox = labels[index]
          if (anchor && edge.label && !candidate.slice(1).some((point, cursor) => onSegment(anchor, candidate[cursor]!, point))) {
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
                || occupied.some(other => intersects(box, other))) continue
              if (ink.some((route, other) => other !== index && route.style !== 'invisible'
                && route.points.slice(1).some((point, cursor) => inside(route.points[cursor]!, point, box)))) continue
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
