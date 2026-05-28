// ============================================================================
// agentic-mermaid — public agent surface
// ============================================================================

export type {
  Result,
  ValidDiagram,
  FlowchartValidDiagram,
  ValidDiagramMeta,
  DiagramBody,
  DiagramKind,
  SourceMap,
  SourceComment,
  InitDirective,
  Accessibility,
  ParseError,
  MutationError,
  MutationOp,
  NodeId,
  EdgeId,
  GroupId,
  LayoutWarning,
  WarningCode,
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
} from './types.ts'

export { parseMermaid } from './parse.ts'
export { serializeMermaid } from './serialize.ts'
export { mutate, edgeIdOf } from './mutate.ts'
export { verifyMermaid } from './verify.ts'
export {
  createLayoutContext,
  createSeededRNG,
  createMockClock,
  defaultLayoutContext,
  defaultMetricsTable,
  measureWidth,
} from './context.ts'

import { renderMermaidSVG as _renderSVG } from '../index.ts'
import { renderMermaidASCII as _renderASCII } from '../ascii/index.ts'
import { layoutGraphSync } from '../layout-engine.ts'
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

export function layoutMermaid(d: ValidDiagram, _ctx?: LayoutContext): RenderedLayout {
  if (d.body.kind === 'flowchart') {
    const p = layoutGraphSync(d.body.graph, {})
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
