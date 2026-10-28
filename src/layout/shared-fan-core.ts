import type { AgenticLayout, MeasuredGraph } from './agentic-layered-core.ts'
import type { Point } from '../types.ts'

/** A complete, unlabelled fan net can share a junction without introducing
 * any unauthored source/target pair. Duplicate edges keep individual lanes. */
export function layoutSharedFan(
  input: MeasuredGraph,
  incoming: readonly (readonly number[])[],
  outgoing: readonly (readonly number[])[],
  unsupported: (reason: string) => never,
): AgenticLayout | undefined {
  if (!input.shareCompleteFans || input.edges.some(edge => edge.label || edge.minSpan !== 1)) return undefined
  const sources: number[] = [], targets: number[] = []
  for (let index = 0; index < input.nodes.length; index++) {
    if (!incoming[index]!.length && outgoing[index]!.length) sources.push(index)
    else if (!outgoing[index]!.length && incoming[index]!.length) targets.push(index)
    else return undefined
  }
  if (!sources.length || !targets.length || (sources.length === 1 && targets.length === 1)
    || input.edges.length !== sources.length * targets.length) return undefined
  const sourceSlots = new Map(sources.map((id, index) => [id, index]))
  const targetSlots = new Map(targets.map((id, index) => [id, index]))
  const pairs = new Set<number>()
  for (const edge of input.edges) {
    if (!sourceSlots.has(edge.source) || !targetSlots.has(edge.target)) return undefined
    const key = edge.source * input.nodes.length + edge.target
    if (pairs.has(key)) return undefined
    pairs.add(key)
  }
  const horizontal = input.direction === 'LR' || input.direction === 'RL'
  const reverse = input.direction === 'BT' || input.direction === 'RL'
  const crossSize = (id: number): number => horizontal ? input.nodes[id]!.height : input.nodes[id]!.width
  const mainSize = (id: number): number => horizontal ? input.nodes[id]!.width : input.nodes[id]!.height
  const span = (band: number[]): number => band.reduce((sum, id) => sum + crossSize(id), 0) + (band.length - 1) * input.nodeSpacing
  const sourceSpan = span(sources), targetSpan = span(targets), crossExtent = Math.max(sourceSpan, targetSpan)
  const sourceHeight = Math.max(...sources.map(mainSize)), targetHeight = Math.max(...targets.map(mainSize))
  const gap = Math.max(input.layerSpacing, 2 * Math.max(12, input.edgeSpacing ?? 6) + (input.edgeSpacing ?? 6))
  const mainExtent = sourceHeight + gap + targetHeight
  if (!Number.isFinite(mainExtent + crossExtent + 2 * input.padding)) unsupported('agentic local coordinate-range limit')
  const crosses = new Float64Array(input.nodes.length), starts = new Float64Array(input.nodes.length)
  for (const [band, size, start, height] of [[sources, sourceSpan, 0, sourceHeight], [targets, targetSpan, sourceHeight + gap, targetHeight]] as const) {
    let offset = (crossExtent - size) / 2
    for (const id of band) {
      crosses[id] = offset + crossSize(id) / 2
      starts[id] = start + (height - mainSize(id)) / 2
      offset += crossSize(id) + input.nodeSpacing
    }
  }
  const project = (cross: number, main: number): Point => horizontal
    ? { x: input.padding + (reverse ? mainExtent - main : main), y: input.padding + cross }
    : { x: input.padding + cross, y: input.padding + (reverse ? mainExtent - main : main) }
  const nodes = input.nodes.map((_, id) => project(crosses[id]! - crossSize(id) / 2, starts[id]! + (reverse ? mainSize(id) : 0)))
  const edges = input.edges.map(edge => {
    if (input.placementOnly && !input.cycleOriented && !input.loopPorts?.length) return { points: [] }
    const points: Point[] = []
    const junction = crossExtent / 2, join = sourceHeight + gap / 3, fork = sourceHeight + 2 * gap / 3
    for (const [cross, main] of [[crosses[edge.source]!, starts[edge.source]! + mainSize(edge.source)],
      [crosses[edge.source]!, join], [junction, join], [junction, fork], [crosses[edge.target]!, fork], [crosses[edge.target]!, starts[edge.target]!]]) {
      const point = project(cross!, main!)
      const last = points.at(-1), previous = points.at(-2)
      if (last?.x === point.x && last.y === point.y) continue
      if (previous && last && ((previous.x === last.x && last.x === point.x && (last.y - previous.y) * (point.y - last.y) >= 0)
        || (previous.y === last.y && last.y === point.y && (last.x - previous.x) * (point.x - last.x) >= 0))) points.pop()
      points.push(point)
    }
    return { points }
  })
  return { topology: 'layered', width: 2 * input.padding + (horizontal ? mainExtent : crossExtent),
    height: 2 * input.padding + (horizontal ? crossExtent : mainExtent), nodes, edges,
    expandedVertices: nodes.length, sharedEdges: input.edges.map((_, index) => index) }
}
