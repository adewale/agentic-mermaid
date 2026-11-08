import { prepareMeasuredGraphCandidate } from './measured-graph-producer.ts'
import { solveMeasuredLayout } from './measured-backend.ts'
import { trinityMeasuredAdapter } from './trinity.ts'
import { GraphLayoutUnsupportedError, LayoutCertificationError } from './backend.ts'
import { retainGraphText } from './graph-measurement.ts'
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
