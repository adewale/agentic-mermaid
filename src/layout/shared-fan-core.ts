import type { AgenticLayout, MeasuredGraph } from './agentic-layered-core.ts'
import type { Point } from '../types.ts'

/** A complete, unlabelled fan net can share a junction without introducing
 * any unauthored source/target pair. Duplicate edges keep individual lanes. */
export function layoutSharedFan(
  input: MeasuredGraph,
  incoming: readonly (readonly number[])[],
  outgoing: readonly (readonly number[])[],
  ids: ReadonlySet<string>,
  layout: (input: MeasuredGraph) => AgenticLayout,
): AgenticLayout | undefined {
  if (!input.shareCompleteFans || input.commonPorts?.length || input.edges.some(edge => edge.label || edge.minSpan !== 1)) return undefined
  const sources: number[] = [], targets: number[] = []
  for (let index = 0; index < input.nodes.length; index++) {
    if (!incoming[index]!.length && outgoing[index]!.length) sources.push(index)
    else if (!outgoing[index]!.length && incoming[index]!.length) targets.push(index)
    else return undefined
  }
  if (sources.length < 2 || targets.length < 2 || input.edges.length !== sources.length * targets.length) return undefined
  const sourceSlots = new Map(sources.map((id, index) => [id, index]))
  const targetSlots = new Map(targets.map((id, index) => [id, index]))
  const pairs = new Set<number>()
  for (const edge of input.edges) {
    if (!sourceSlots.has(edge.source) || !targetSlots.has(edge.target)) return undefined
    const key = edge.source * input.nodes.length + edge.target
    if (pairs.has(key)) return undefined
    pairs.add(key)
  }
  let suffix = 0, id = '\0agentic-fan:0'
  while (ids.has(id)) id = `\0agentic-fan:${++suffix}`
  const hub = input.nodes.length
  const placed = layout({ ...input, shareCompleteFans: false, commonPorts: [hub], layerSpacing: input.layerSpacing / 2,
    nodes: [...input.nodes, { id, width: 1, height: 1 }],
    edges: [...sources.map(source => ({ source, target: hub, minSpan: 1 })), ...targets.map(target => ({ source: hub, target, minSpan: 1 }))],
  })
  const edges = input.edges.map(edge => {
    const points: Point[] = []
    for (const point of [...placed.edges[sourceSlots.get(edge.source)!]!.points, ...placed.edges[sources.length + targetSlots.get(edge.target)!]!.points]) {
      const last = points.at(-1), previous = points.at(-2)
      if (last?.x === point.x && last.y === point.y) continue
      if (previous && last && ((previous.x === last.x && last.x === point.x && (last.y - previous.y) * (point.y - last.y) >= 0)
        || (previous.y === last.y && last.y === point.y && (last.x - previous.x) * (point.x - last.x) >= 0))) points.pop()
      points.push({ ...point })
    }
    return { points }
  })
  return { ...placed, topology: 'layered', nodes: placed.nodes.slice(0, hub), edges, sharedEdges: input.edges.map((_, index) => index) }
}
