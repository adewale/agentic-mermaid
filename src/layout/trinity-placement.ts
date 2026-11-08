import { GraphLayoutUnsupportedError, LayoutWorkLimitError } from './backend.ts'
import { AGENTIC_MAX_NODES, AGENTIC_MAX_EDGES } from './agentic-limits.ts'
import type { ChannelWork } from './channel-tracks.ts'
import type { MeasuredGraph, MeasuredPlacement, MeasuredLayoutAdapter } from './measured-graph.ts'
import { placeMeasuredForest } from './measured-forest.ts'
import { assertTrinityWork } from './trinity-work.ts'

/** A family-owned body-placement job, without generic endpoint/routing demands.
 * Reuse the same ordered subtree/shelf producer as Native; never invent routes. */
export function trinityPlacementAdapter(work: ChannelWork): MeasuredLayoutAdapter<'placement'> {
  return { solve(request) {
    const geometry = tryTrinityForestPlacement(request.graph, work)
    if (!geometry) throw new GraphLayoutUnsupportedError('placement requires an unlabelled flat forest without endpoint constraints', 'Trinity')
    return { kind: 'placed', geometry }
  } }
}

export function tryTrinityForestPlacement(input: MeasuredGraph, work: ChannelWork): MeasuredPlacement | undefined {
  assertTrinityWork(work)
  const n = input.nodes.length, m = input.edges.length
  if (n > AGENTIC_MAX_NODES || m > AGENTIC_MAX_EDGES || input.groups?.length || input.shareCompleteFans) return undefined
  if (![input.padding, input.nodeSpacing, input.layerSpacing].every(value => Number.isFinite(value) && value >= 0)) throw new TypeError('Invalid measured spacing')
  if (!['TD', 'TB', 'BT', 'LR', 'RL'].includes(input.direction)) throw new TypeError('Invalid measured direction')
  if (input.minimumTerminalLead !== undefined || input.nodeClearance !== undefined || input.maximumEdgeStrokeWidth !== undefined || input.maximumEdgeBendRadius !== undefined || input.edgeSpacing !== undefined) return undefined
  const ids = new Set<string>()
  for (const node of input.nodes) {
    if (typeof node.id !== 'string' || ids.has(node.id)) throw new TypeError('Measured node identities must be unique strings')
    ids.add(node.id)
    if (node.contact !== 'rectangle' && node.contact !== 'rounded-rectangle') return undefined
    if (![node.width, node.height].every(value => Number.isFinite(value) && value > 0)) throw new TypeError('Invalid measured body size')
    if (node.paintStrokeWidth === undefined) return undefined
    if (!Number.isFinite(node.paintStrokeWidth) || node.paintStrokeWidth <= 0 || node.paintCornerRadius !== undefined && (!Number.isFinite(node.paintCornerRadius) || node.paintCornerRadius < 0)) throw new TypeError('Invalid measured body paint')
    if (node.parent !== undefined || node.partition !== undefined || node.modelOrder !== undefined || node.minimumPortSpacing !== undefined) return undefined
  }
  for (const edge of input.edges) {
    if (![edge.source, edge.target].every(value => Number.isInteger(value) && value >= 0 && value < n)) throw new TypeError('Measured endpoint is outside the node array')
    if (!Number.isSafeInteger(edge.minSpan) || edge.minSpan < 1) throw new TypeError('Invalid measured minimum span')
    if (edge.short !== undefined && edge.short !== true || edge.visible !== undefined && typeof edge.visible !== 'boolean') throw new TypeError('Invalid measured edge preference')
    if (edge.minSpan !== 1 || edge.label || edge.short || edge.boundaryMarker || edge.markerPaint || edge.visible === false || edge.sourcePortSpan !== undefined || edge.targetPortSpan !== undefined) return undefined
  }
  work.pairs -= n + m; work.arcs -= m
  if (work.pairs < 0) throw new LayoutWorkLimitError('pairs')
  if (work.arcs < 0) throw new LayoutWorkLimitError('arcs')
  if (!n) {
    const extent = input.padding * 2
    if (!Number.isFinite(extent)) throw new TypeError('Trinity extent overflow')
    return { width: extent, height: extent, nodes: [] }
  }
  const measured = {
    nodes: input.nodes.map(node => ({ id: node.id, width: node.width + node.paintStrokeWidth!, height: node.height + node.paintStrokeWidth! })),
    edges: input.edges.map(edge => ({ source: edge.source, target: edge.target, minSpan: edge.minSpan })),
    direction: input.direction, padding: input.padding, nodeSpacing: input.nodeSpacing, layerSpacing: input.layerSpacing,
  }
  if (measured.nodes.some(node => !Number.isFinite(node.width) || !Number.isFinite(node.height))) throw new TypeError('Trinity extent overflow')
  const placed = placeMeasuredForest(measured)
  if (!placed) return undefined
  return { width: placed.width, height: placed.height, nodes: placed.nodes.map((at, index) => ({
    x: at.x + input.nodes[index]!.paintStrokeWidth! / 2, y: at.y + input.nodes[index]!.paintStrokeWidth! / 2,
    width: input.nodes[index]!.width, height: input.nodes[index]!.height,
  })) }
}
