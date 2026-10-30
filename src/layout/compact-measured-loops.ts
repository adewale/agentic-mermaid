import type { AgenticLayout, MeasuredGraph } from './agentic-layered-core.ts'
import type { Point } from '../types.ts'
import { countPolylineCrossings } from '../shared/edge-crossings.ts'
import { type MeasuredBox, segmentEntersMeasuredBox, measuredBoxesOverlap, scoreMeasuredRouteCrossings } from './measured-route-safety.ts'

/** Replace a private loop corridor with a three-segment turn only when measured
 * obstacles, label ownership, terminal rays and visible crossings remain safe.
 * Optional work exhaustion retains feasible geometry. Hidden turnaround boxes
 * are excluded when tightening the resulting authored canvas. */
export function compactMeasuredLoops(input: MeasuredGraph, placed: AgenticLayout, work: { loopPairs: number }): AgenticLayout {
  if (work.loopPairs <= 0 || input.groups?.length || input.nodes.length > 256 || input.edges.length > 128 || placed.edges.reduce((n, e) => n + e.points.length, 0) > 2048) return placed
  const chargeContact = (amount: number): boolean => (work.loopPairs -= amount) >= 0
  const horizontal = input.direction === 'LR' || input.direction === 'RL',
    sign = input.direction === 'RL' || input.direction === 'BT' ? -1 : 1
  const main = horizontal ? 'x' : 'y',
    cross = horizontal ? 'y' : 'x'
  const point = (m: number, c: number): Point => (horizontal ? { x: m, y: c } : { x: c, y: m })
  const boxes = input.nodes.map((node, index) => ({ ...placed.nodes[index]!, width: node.width, height: node.height }))
  // Final route admission reserves the caption's two-pixel halo too. A
  // cosmetic shortcut must not erase a jog that keeps another halo clear.
  const labels = input.edges.map((edge, index) => {
    const p = placed.edges[index]!.labelPosition
    return edge.label && p ? { x: p.x - edge.label.width / 2 - 2, y: p.y - edge.label.height / 2 - 2, width: edge.label.width + 4, height: edge.label.height + 4 } : undefined
  })
  const ink = placed.edges.map((edge, index) => ({ points: edge.points, style: input.edges[index]!.visible === false ? 'invisible' : 'solid' }))
  const visible = () => ink.map(edge => ({ points: edge.points, visible: edge.style !== 'invisible' }))
  const distance = (p: Point, route: Point[]) =>
    Math.min(
      ...route.slice(1).map((b, index) => {
        const a = route[index]!
        const x = Math.max(Math.min(a.x, b.x), Math.min(Math.max(a.x, b.x), p.x))
        const y = Math.max(Math.min(a.y, b.y), Math.min(Math.max(a.y, b.y), p.y))
        return Math.abs(p.x - x) + Math.abs(p.y - y)
      }),
    )
  let changed = false
  for (const [index, edge] of input.edges.entries()) {
    const route = placed.edges[index]!,
      original = route.points
    if (edge.source !== edge.target || edge.visible === false || original.length <= 4) continue
    const start = original[0]!,
      end = original.at(-1)!
    if (Math.abs(start[main] - end[main]) > 1e-7 || Math.abs(start[cross] - end[cross]) < 8 - 1e-7) continue
    const occupied = [...boxes, ...labels.filter((box, other): box is MeasuredBox => Boolean(box) && other !== index)]
    const candidates = [...new Set([...original.map(p => p[main]), ...occupied.flatMap(box => (horizontal ? [box.x - 8, box.x + box.width + 8] : [box.y - 8, box.y + box.height + 8])), start[main] + 24 * sign])].filter(m => (m - start[main]) * sign >= 24)
    candidates.sort((a, b) => (a - b) * sign)
    const involved = new Set([index]),
      total = ink.reduce((n, e) => n + e.points.length, 0)
    work.loopPairs -= total * total
    if (work.loopPairs < 0) return placed
    const before = countPolylineCrossings(visible(), involved)
    for (const lane of candidates.slice(0, 32)) {
      const proposed = [{ ...start }, point(lane, start[cross]), point(lane, end[cross]), { ...end }]
      if (proposed.some(p => p.x < input.padding || p.y < input.padding || p.x > placed.width - input.padding || p.y > placed.height - input.padding)) continue
      work.loopPairs -= proposed.length * occupied.length + proposed.length * total
      if (work.loopPairs < 0) return placed
      if (proposed.slice(1).some((p, i) => occupied.some(box => segmentEntersMeasuredBox(proposed[i]!, p, box)))) continue
      let labelPosition = route.labelPosition,
        labelBox = labels[index]
      const hasOwnInk = (box: MeasuredBox) => proposed.slice(1).some((p, i) => segmentEntersMeasuredBox(proposed[i]!, p, box))
      if (labelPosition && edge.label && (distance(labelPosition, proposed) > distance(labelPosition, original) + 1e-7 || (labelBox && hasOwnInk(labelBox)))) {
        const halfMain = (horizontal ? edge.label.width : edge.label.height) / 2,
          halfCross = (horizontal ? edge.label.height : edge.label.width) / 2
        const lower = halfMain + 16,
          upper = (lane - start[main]) * sign - halfMain - 8
        if (lower > upper) continue
        const m = start[main] + sign * Math.max(lower, Math.min(upper, (labelPosition[main] - start[main]) * sign))
        const candidates = [point(m, Math.min(start[cross], end[cross]) - halfCross - 4), point(m, Math.max(start[cross], end[cross]) + halfCross + 4)]
        candidates.sort((a, b) => Math.abs(a.x - route.labelPosition!.x) + Math.abs(a.y - route.labelPosition!.y) - Math.abs(b.x - route.labelPosition!.x) - Math.abs(b.y - route.labelPosition!.y))
        labelPosition = undefined
        for (const candidate of candidates) {
          const box = { x: candidate.x - edge.label.width / 2 - 2, y: candidate.y - edge.label.height / 2 - 2, width: edge.label.width + 4, height: edge.label.height + 4 }
          work.loopPairs -= occupied.length + total
          if (work.loopPairs < 0) return placed
          if (box.x < input.padding || box.y < input.padding || box.x + box.width > placed.width - input.padding || box.y + box.height > placed.height - input.padding) continue
          if (occupied.some(other => measuredBoxesOverlap(box, other)) || hasOwnInk(box) || ink.some((other, i) => i !== index && other.style !== 'invisible' && other.points.slice(1).some((p, j) => segmentEntersMeasuredBox(other.points[j]!, p, box)))) continue
          labelPosition = candidate
          labelBox = box
          break
        }
        if (!labelPosition) continue
      }
      const value = scoreMeasuredRouteCrossings(proposed, index, ink, input, chargeContact, chargeContact)
      if (work.loopPairs < 0) return placed
      if (value === undefined || value > before) continue
      route.points = proposed
      ink[index]!.points = proposed
      if (labelPosition) route.labelPosition = { ...labelPosition }
      labels[index] = labelBox
      changed = true
      break
    }
  }
  if (!changed) return placed
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity
  const include = (x: number, y: number, w = 0, h = 0) => {
    left = Math.min(left, x)
    top = Math.min(top, y)
    right = Math.max(right, x + w)
    bottom = Math.max(bottom, y + h)
  }
  boxes.forEach(box => include(box.x, box.y, box.width, box.height))
  placed.edges.forEach((edge, index) => {
    edge.points.forEach(p => include(p.x, p.y))
    const p = edge.labelPosition,
      label = input.edges[index]!.label
    if (p && label) include(p.x - label.width / 2, p.y - label.height / 2, label.width, label.height)
  })
  const dx = input.padding - left,
    dy = input.padding - top
  placed.nodes = placed.nodes.map(p => ({ x: p.x + dx, y: p.y + dy }))
  placed.edges = placed.edges.map(edge => ({ ...edge, points: edge.points.map(p => ({ x: p.x + dx, y: p.y + dy })), ...(edge.labelPosition ? { labelPosition: { x: edge.labelPosition.x + dx, y: edge.labelPosition.y + dy } } : {}) }))
  placed.width = right - left + 2 * input.padding
  placed.height = bottom - top + 2 * input.padding
  return placed
}
