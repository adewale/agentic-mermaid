import { layoutCompoundGraph } from './agentic-compound-core.ts'
import { AGENTIC_MAX_EXPANDED_VERTICES } from './agentic-limits.ts'
import { GraphLayoutUnsupportedError } from './backend.ts'
import { assertTrinityWork } from './trinity-work.ts'
import { solveMeasuredLayout } from './measured-backend.ts'
import type { ChannelWork } from './channel-tracks.ts'
import type { MeasuredGraph, MeasuredRoutes } from './measured-graph.ts'

/** Scope lifting and boundary routing are shared; Trinity owns local layout. */
export function solveTrinityCompound(
  input: MeasuredGraph, work: ChannelWork,
  solve: (local: MeasuredGraph) => MeasuredRoutes & { expandedVertices: number },
): MeasuredRoutes {
  assertTrinityWork(work)
  const unsupported = (reason: string): never => {
    assertTrinityWork(work)
    throw new GraphLayoutUnsupportedError(reason.replace(/^agentic /, ''), 'Trinity')
  }
  const groups = input.groups!
  if (input.nodes.length + groups.length > 64 || input.edges.length > 128) unsupported('routed slice is limited to 64 subjects and 128 edges')
  if (![input.padding, input.nodeSpacing, input.layerSpacing].every(value => Number.isFinite(value) && value >= 0)) throw new TypeError('Invalid measured spacing')
  if (!['TD', 'TB', 'BT', 'LR', 'RL'].includes(input.direction)) throw new TypeError('Invalid measured direction')
  if (input.shareCompleteFans || input.edges.some(edge => edge.short || edge.markerPaint || edge.visible === false)) unsupported('shared fans, short edges, raw artwork and invisible constraints are outside the compound slice')
  const pay = (pairs: number, slots: number): void => { work.pairs -= pairs; work.arcs -= slots; assertTrinityWork(work) }
  pay(4 * (input.nodes.length + groups.length) + 8, 4 * (input.nodes.length + groups.length) + 4)
  const leaves = new Map(input.nodes.map(node => [node.id, node])), frames = new Map(groups.map(group => [group.id, group]))
  return layoutCompoundGraph(input, flat => {
    pay(flat.nodes.length * 32 + flat.edges.length * 8 + 32, flat.nodes.length * 24 + flat.edges.length * 2 + 24)
    const nodes = flat.nodes.map(node => {
      const leaf = leaves.get(node.id)
      if (leaf) { const { parent: _parent, ...body } = leaf; return { ...body, width: node.width, height: node.height } }
      const group = frames.get(node.id) ?? unsupported('unmeasured compound frame')
      if (group.partition !== undefined || group.modelOrder !== undefined) unsupported('ordered compound scopes are outside the measured slice')
      if (!Number.isFinite(group.paintStrokeWidth) || group.paintStrokeWidth! <= 0 || !Number.isFinite(group.paintCornerRadius) || group.paintCornerRadius! < 0) unsupported('compound frames require measured contact paint')
      // A child frame has already been sized bottom-up. Its local parent must
      // retain that body or decline capacity, rather than resize only its shell.
      return { ...node, contact: group.paintCornerRadius ? 'rounded-rectangle' as const : 'rectangle' as const,
        paintStrokeWidth: group.paintStrokeWidth, paintCornerRadius: group.paintCornerRadius, sizePolicy: 'fixed' as const }
    })
    const local: MeasuredGraph = { nodes, edges: flat.edges, direction: flat.direction, padding: flat.padding,
      nodeSpacing: input.nodeSpacing, layerSpacing: input.layerSpacing, edgeSpacing: input.edgeSpacing,
      minimumTerminalLead: input.minimumTerminalLead, maximumEdgeStrokeWidth: input.maximumEdgeStrokeWidth,
      maximumEdgeBendRadius: input.maximumEdgeBendRadius, nodeClearance: input.nodeClearance }
    let expandedVertices = 0
    const placed = solveMeasuredLayout({ role: 'routed', graph: local }, { solve: () => {
      const geometry = solve(local)
      expandedVertices = geometry.expandedVertices
      if (!Number.isSafeInteger(expandedVertices) || expandedVertices < nodes.length) throw new TypeError('Trinity lost compound expansion accounting')
      return { kind: 'routed', geometry }
    } })
    return { ...placed, expandedVertices, topology: 'layered' as const }
  }, unsupported, AGENTIC_MAX_EXPANDED_VERTICES, work)
}
