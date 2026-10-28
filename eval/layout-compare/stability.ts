import type { RenderedLayout, RenderedLayoutEdge, RenderedLayoutNode } from '../../src/agent/types.ts'

const median = (values: number[]): number => {
  const ordered = [...values].sort((a, b) => a - b)
  const middle = Math.floor(ordered.length / 2)
  return ordered.length ? (ordered[middle]! + ordered[Math.floor((ordered.length - 1) / 2)]!) / 2 : 0
}
const center = (node: RenderedLayoutNode) => ({ x: node.x + node.w / 2, y: node.y + node.h / 2 })
const EPS = 1e-6

function displacement(values: number[], scale: number) {
  const ordered = [...values].sort((a, b) => a - b)
  const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
  const p95 = ordered.length ? ordered[Math.ceil(ordered.length * .95) - 1]! : 0
  return { count: values.length, mean, p95, max: ordered.at(-1) ?? 0, normalizedMean: mean / scale, normalizedP95: p95 / scale }
}

/** Stable public identities and a declared affected set; both whole-graph and
 * unaffected movement are retained. Translation alignment uses component-wise
 * median displacement, normalized by the original median node diagonal.
 * This measures stability, not an incremental-layout or usability guarantee. */
export function measureEditStability(before: RenderedLayout, after: RenderedLayout, affected: ReadonlySet<string>) {
  const afterNodes = new Map(after.nodes.map(node => [node.id, node]))
  const pairs = before.nodes.flatMap(node => afterNodes.has(node.id) ? [{ before: node, after: afterNodes.get(node.id)! }] : [])
  const unchanged = pairs.filter(pair => !affected.has(pair.before.id))
  const scale = median(before.nodes.map(node => Math.hypot(node.w, node.h)).filter(value => value > EPS)) || 1
  const translation = { x: median(unchanged.map(pair => center(pair.after).x - center(pair.before).x)), y: median(unchanged.map(pair => center(pair.after).y - center(pair.before).y)) }
  const movement = (selected: typeof pairs, aligned: boolean) => selected.map(pair => {
    const a = center(pair.before), b = center(pair.after)
    return Math.hypot(b.x - a.x - (aligned ? translation.x : 0), b.y - a.y - (aligned ? translation.y : 0))
  })
  let relativeOrderInversions = 0
  for (let i = 0; i < unchanged.length; i++) for (let j = i + 1; j < unchanged.length; j++) {
    const a = unchanged[i]!, b = unchanged[j]!
    for (const axis of ['x', 'y'] as const) {
      const previous = center(a.before)[axis] - center(b.before)[axis], next = center(a.after)[axis] - center(b.after)[axis]
      if (Math.abs(previous) > EPS && Math.abs(next) > EPS && previous * next < 0) relativeOrderInversions++
    }
  }
  const keyedEdges = (layout: RenderedLayout) => {
    const occurrence = new Map<string, number>()
    return new Map(layout.edges.map(edge => {
      const key = JSON.stringify([edge.id, edge.from, edge.to, edge.label?.text]), ordinal = occurrence.get(key) ?? 0
      occurrence.set(key, ordinal + 1)
      return [`${key}:${ordinal}`, edge]
    }))
  }
  const targetEdges = keyedEdges(after), beforeNodes = new Map(before.nodes.map(node => [node.id, node]))
  const side = (edge: RenderedLayoutEdge, end: 'from' | 'to', nodes: Map<string, RenderedLayoutNode>) => {
    const node = nodes.get(edge[end]), point = end === 'from' ? edge.path[0] : edge.path.at(-1)
    if (!node || !point) return undefined
    const dx = (point[0] - node.x - node.w / 2) / Math.max(node.w / 2, EPS), dy = (point[1] - node.y - node.h / 2) / Math.max(node.h / 2, EPS)
    return Math.abs(dx) > Math.abs(dy) ? dx < 0 ? 'W' : 'E' : dy < 0 ? 'N' : 'S'
  }
  let comparedEdges = 0, rawRouteChanges = 0, alignedRouteChanges = 0, boundingBoxSideChanges = 0, unavailableEndpoints = 0
  for (const [key, edge] of keyedEdges(before)) {
    const next = targetEdges.get(key)
    if (!next || affected.has(edge.from) || affected.has(edge.to)) continue
    comparedEdges++
    const changed = (aligned: boolean) => edge.path.length !== next.path.length || edge.path.some((point, index) => {
      const target = next.path[index]!
      return Math.abs(target[0] - point[0] - (aligned ? translation.x : 0)) > EPS || Math.abs(target[1] - point[1] - (aligned ? translation.y : 0)) > EPS
    })
    rawRouteChanges += Number(changed(false)); alignedRouteChanges += Number(changed(true))
    for (const end of ['from', 'to'] as const) {
      const previous = side(edge, end, beforeNodes), current = side(next, end, afterNodes)
      if (previous === undefined || current === undefined) unavailableEndpoints++
      else boundingBoxSideChanges += Number(previous !== current)
    }
  }
  return {
    affected: [...affected].sort(), normalization: { medianOriginalNodeDiagonal: scale, translation },
    unchanged: { raw: displacement(movement(unchanged, false), scale), aligned: displacement(movement(unchanged, true), scale) },
    wholeGraph: { raw: displacement(movement(pairs, false), scale), aligned: displacement(movement(pairs, true), scale) },
    relativeOrderInversions, comparedEdges, rawRouteChanges, alignedRouteChanges, boundingBoxSideChanges, unavailableEndpoints,
    limitations: ['Bounding-box attachment sides are proxies, not authored preferred-port scores.', 'Duplicate edge identities use source occurrence order; indistinguishable duplicate edits have no unique correspondence.'],
  }
}
