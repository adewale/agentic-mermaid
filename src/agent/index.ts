// ============================================================================
// agentic-mermaid — public agent surface (v3)
// ============================================================================

export type {
  Result,
  ValidDiagram,
  FlowchartValidDiagram,
  SequenceValidDiagram,
  MutableValidDiagram,
  ValidDiagramMeta,
  ValidDiagramPayload,
  SerializedFlowchartGraph,
  DiagramBody,
  DiagramKind,
  SequenceBody,
  SequenceParticipant,
  SequenceMessage,
  SequenceMessageStyle,
  SourceMap,
  SourceComment,
  InitDirective,
  Accessibility,
  ParseError,
  MutationError,
  MutationOp,
  FlowchartMutationOp,
  SequenceMutationOp,
  AnyMutationOp,
  NodeId,
  EdgeId,
  GroupId,
  ParticipantId,
  LayoutWarning,
  WarningCode,
  Tier1WarningCode,
  Tier2WarningCode,
  WarningSeverity,
  WarningTier,
  StructuralWarningCode,
  MetricWarningCode,
  VerifyOptions,
  VerifyResult,
  RenderedLayout,
  RenderedLayoutNode,
  RenderedLayoutEdge,
  RenderedLayoutGroup,
  LayoutContext,
  SeededRNG,
  Clock,
  MetricsTable,
  FontMetric,
  Finite,
} from './types.ts'

export {
  WARNING_SEVERITY,
  WARNING_TIER,
  ok,
  err,
  toFinite,
  asFlowchart,
  asSequence,
} from './types.ts'

export { parseMermaid } from './parse.ts'
export { serializeMermaid, synthesizeFromGraph } from './serialize.ts'
export { mutate, edgeIdOf } from './mutate.ts'
export { verifyMermaid } from './verify.ts'
export {
  createLayoutContext,
  createSeededRNG,
  createMockClock,
  defaultLayoutContext,
  defaultMetricsTable,
  measureWidth,
  withSeededRandom,
} from './context.ts'

import { renderMermaidSVG as _renderSVG } from '../index.ts'
import { renderMermaidASCII as _renderASCII } from '../ascii/index.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { withSeededRandom, defaultLayoutContext } from './context.ts'
import type { ValidDiagram, RenderedLayout, LayoutContext, Finite } from './types.ts'
import { toFinite } from './types.ts'

export function renderMermaidSVG(
  input: ValidDiagram | string,
  opts: Parameters<typeof _renderSVG>[1] = {},
): string {
  return _renderSVG(typeof input === 'string' ? input : input.canonicalSource, opts)
}

export function renderMermaidASCII(
  input: ValidDiagram | string,
  opts: Parameters<typeof _renderASCII>[1] = {},
): string {
  return _renderASCII(typeof input === 'string' ? input : input.canonicalSource, opts)
}

const f = (n: number): Finite => toFinite(Math.round(n))

export function layoutMermaid(d: ValidDiagram, ctx?: LayoutContext): RenderedLayout {
  const layoutCtx = ctx ?? defaultLayoutContext()
  if (d.body.kind === 'flowchart') {
    const p = withSeededRandom(layoutCtx.rng, () => layoutGraphSync(d.body.kind === 'flowchart' ? d.body.graph : (null as never), {}))
    return {
      version: 1, seed: 0, kind: d.kind,
      nodes: p.nodes.map(n => ({
        id: n.id, x: f(n.x), y: f(n.y), w: f(n.width), h: f(n.height),
        shape: n.shape, label: n.label,
      })),
      edges: p.edges.map(e => ({
        id: `${e.source}->${e.target}`, from: e.source, to: e.target,
        path: e.points.map(pt => [f(pt.x), f(pt.y)] as [Finite, Finite]),
        label: e.label && e.labelPosition
          ? { x: f(e.labelPosition.x), y: f(e.labelPosition.y), text: e.label }
          : undefined,
      })),
      groups: p.groups.map(g => ({
        id: g.id, x: f(g.x), y: f(g.y), w: f(g.width), h: f(g.height),
        members: [], label: g.label,
      })),
      bounds: { w: f(p.width), h: f(p.height) },
    }
  }
  return {
    version: 1, seed: 0, kind: d.kind,
    nodes: [], edges: [], groups: [],
    bounds: { w: f(0), h: f(0) },
  }
}
