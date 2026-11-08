import { prepareMeasuredGraphCandidate } from './measured-graph-producer.ts'
import { solveMeasuredLayout } from './measured-backend.ts'
import { trinityMeasuredAdapter } from './trinity.ts'
import { GraphLayoutUnsupportedError, LayoutCertificationError } from './backend.ts'
import { retainGraphText } from './graph-measurement.ts'
import { placeMeasuredScopes } from './measured-scopes.ts'
import { trinityPlacementAdapter } from './trinity-placement.ts'
import type { MeasuredPlacement } from './measured-graph.ts'
import { LayoutWorkLimitError } from './backend.ts'
import { AGENTIC_MAX_EXPANDED_VERTICES } from './agentic-limits.ts'
import { layoutOptimization } from './optimization-context.ts'
import type { MermaidGraph, PositionedGraph } from '../types.ts'
import type { ResolvedRenderStyle } from '../styles.ts'
import type { AgenticGraphBindings, AgenticGraphOptions } from '../layout-engine.ts'

/** Share the physical producer, not Native's search, cache or legacy repair. */
export function layoutTrinityCandidate(graph: MermaidGraph, options: AgenticGraphOptions, style: ResolvedRenderStyle, bindings: AgenticGraphBindings): PositionedGraph {
  const prepared = prepareMeasuredGraphCandidate(graph, options, style, { ...bindings,
    unsupported: reason => { throw new GraphLayoutUnsupportedError(reason.replace(/^agentic /, ''), 'Trinity') },
  }, 'owned-routed')
  layoutOptimization()?.recordLayoutProducer()
  const geometry = bindings.measureRenderStage('trinity', () => solveMeasuredLayout({ role: 'routed', graph: prepared.measured }, trinityMeasuredAdapter(prepared.routingWork)))
  const positioned = prepared.project(geometry)
  retainGraphText(positioned, style)
  const result = bindings.certifyCandidate(graph, style, { strategy: 'trinity', produce: () => positioned }, true)
  if (!result.certified) throw new LayoutCertificationError([result.attempt])
  return bindings.retainSelection(graph, { selected: result.certified, reason: 'first-certified', attempts: 1,
    compared: [{ strategy: result.certified.strategy, score: result.certified.score }],
  })
}

/** A family owns routes after this bounded single-container body placement. */
export function layoutTrinityPlacement(graph: MermaidGraph, options: AgenticGraphOptions, style: ResolvedRenderStyle, bindings: AgenticGraphBindings): Pick<PositionedGraph, 'width' | 'height' | 'nodes' | 'groups'> {
  const unsupported = (reason: string): never => { throw new GraphLayoutUnsupportedError(reason.replace(/^agentic /, ''), 'Trinity') }
  const prepared = prepareMeasuredGraphCandidate(graph, options, style, { ...bindings, unsupported }, 'owned-placement')
  const input = prepared.measured, groups = input.groups ?? unsupported('placement requires a measured container'), n = input.nodes.length, work = prepared.routingWork
  const pay = (amount: number): void => { work.pairs -= amount; if (work.pairs < 0) throw new LayoutWorkLimitError('pairs') }
  if (!groups || groups.length !== 1 || groups[0]!.parent !== undefined || input.nodes.some(node => node.parent !== 0)) unsupported('placement requires one container with all service leaves')
  if (input.nodes.some(node => node.partition !== undefined || node.modelOrder !== undefined) || groups.some(group => group.partition !== undefined || group.modelOrder !== undefined)) unsupported('ordered placement constraints are outside the forest slice')
  if (input.edges.some(edge => edge.source >= n || edge.target >= n || edge.source === edge.target)) unsupported('frame endpoints and loops are outside the service forest slice')
  if (![style.nodeLineWidth, style.groupLineWidth].every(width => Number.isFinite(width) && width > 0)) unsupported('placement requires measured positive service/frame strokes')
  pay(n * 100 + input.edges.length * 30 + 100)
  const children = [[n], input.nodes.map((_, index) => index)]
  let expanded = 0
  const placed = bindings.measureRenderStage('trinity', () => placeMeasuredScopes<MeasuredPlacement>(input, groups, children, n, (scope, direction, placeChild) => {
    const members = children[scope]!
    expanded += members.length
    if (expanded > AGENTIC_MAX_EXPANDED_VERTICES) unsupported('local compound-expansion limit')
    pay(members.length * 8 + 4)
    const nodes = members.map(id => {
      const body = id < n ? input.nodes[id]! : placeChild(id)
      const corner = id < n ? style.cornerRadius ?? 0 : style.groupCornerRadius
      return { id: id < n ? input.nodes[id]!.id : groups[0]!.id, width: body.width, height: body.height,
        contact: corner ? 'rounded-rectangle' as const : 'rectangle' as const, paintCornerRadius: corner,
        paintStrokeWidth: id < n ? style.nodeLineWidth : style.groupLineWidth }
    })
    const edges = scope ? input.edges : []
    return solveMeasuredLayout({ role: 'placement', graph: { nodes, edges, direction, padding: 0, nodeSpacing: input.nodeSpacing, layerSpacing: input.layerSpacing } }, trinityPlacementAdapter(work))
  }, unsupported))
  layoutOptimization()?.recordLayoutProducer()
  return prepared.project({ width: placed.root.width, height: placed.root.height, nodes: placed.nodes, groups: placed.frames, edges: [] })
}
