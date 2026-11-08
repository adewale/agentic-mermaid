import type { MeasuredGraph, MeasuredRoutes } from './measured-graph.ts'

/** Discard private placement margins after the final route and caption edits.
 * Preserve the requested padding around every retained body and route. */
export function fitMeasuredLayout<T extends MeasuredRoutes>(input: MeasuredGraph, placed: T): T {
  if (input.groups?.length || !input.nodes.length || input.nodes.length > 256 || input.edges.length > 128 || placed.edges.reduce((n, e) => n + e.points.length, 0) > 2048) return placed
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
  input.nodes.forEach((node, index) => { const actual = placed.nodes[index]!; include(actual.x, actual.y, actual.width ?? node.width, actual.height ?? node.height) })
  placed.edges.forEach((edge, index) => {
    edge.points.forEach(p => include(p.x, p.y))
    const p = edge.labelPosition,
      label = input.edges[index]!.label
    if (p && label) include(p.x - label.width / 2, p.y - label.height / 2, label.width, label.height)
  })
  const dx = input.padding - left,
    dy = input.padding - top
  placed.nodes = placed.nodes.map(p => ({ ...p, x: p.x + dx, y: p.y + dy }))
  placed.edges = placed.edges.map(edge => ({ ...edge, points: edge.points.map(p => ({ x: p.x + dx, y: p.y + dy })), ...(edge.labelPosition ? { labelPosition: { x: edge.labelPosition.x + dx, y: edge.labelPosition.y + dy } } : {}) }))
  placed.width = right - left + 2 * input.padding
  placed.height = bottom - top + 2 * input.padding
  return placed
}
