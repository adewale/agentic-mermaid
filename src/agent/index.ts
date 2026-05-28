// ============================================================================
// agentic-mermaid — public agent surface
//
// One entry point with the typed verbs the spec defines:
//   parseMermaid, serializeMermaid, mutate, verifyMermaid, layoutMermaid,
//   renderMermaidSVG, renderMermaidASCII
//
// Plus the types the agent reasons about: ValidDiagram, MutationOp,
// LayoutWarning, VerifyOptions, VerifyResult, LayoutContext, Result.
//
// Existing beautiful-mermaid exports remain in src/index.ts.
// ============================================================================

export type {
  // Result + IR
  Result,
  ValidDiagram,
  ValidDiagramMeta,
  DiagramBody,
  DiagramKind,
  SourceMap,
  SourceComment,
  InitDirective,
  Accessibility,

  // Errors
  ParseError,
  MutationError,

  // Mutation
  MutationOp,
  NodeId,
  EdgeId,
  GroupId,

  // Verify
  LayoutWarning,
  WarningCode,
  WarningSeverity,
  VerifyOptions,
  VerifyResult,
  RenderedLayout,
  RenderedLayoutNode,
  RenderedLayoutEdge,
  RenderedLayoutGroup,

  // Context
  LayoutContext,
  SeededRNG,
  Clock,
  MetricsTable,
  FontMetric,
} from './types.ts'

export { WARNING_SEVERITY, ok, err } from './types.ts'

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

// Re-export the renderer entry points so the agent surface is one-stop.
// Agents that want to render a ValidDiagram pass `d.canonicalSource` or
// call layoutMermaid + the existing renderer pipeline.
import { renderMermaidSVG as _renderSVG } from '../index.ts'
import { renderMermaidASCII as _renderASCII } from '../ascii/index.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import type { ValidDiagram, RenderedLayout, LayoutContext, Finite } from './types.ts'
import { toFinite } from './types.ts'

export function renderMermaidSVG(
  input: ValidDiagram | string,
  opts: Parameters<typeof _renderSVG>[1] = {},
): string {
  const source = typeof input === 'string' ? input : input.canonicalSource
  return _renderSVG(source, opts)
}

export function renderMermaidASCII(
  input: ValidDiagram | string,
  opts: Parameters<typeof _renderASCII>[1] = {},
): string {
  const source = typeof input === 'string' ? input : input.canonicalSource
  return _renderASCII(source, opts)
}

const f = (n: number): Finite => toFinite(Math.round(n))

export function layoutMermaid(
  d: ValidDiagram,
  _ctx?: LayoutContext,
): RenderedLayout {
  // For flowchart, run the existing layout engine and convert.
  if (d.body.kind === 'flowchart') {
    const positioned = layoutGraphSync(d.body.graph, {})
    return {
      version: 1,
      seed: 0,
      kind: d.kind,
      nodes: positioned.nodes.map(n => ({
        id: n.id,
        x: f(n.x),
        y: f(n.y),
        w: f(n.width),
        h: f(n.height),
        shape: n.shape,
        label: n.label,
      })),
      edges: positioned.edges.map(e => ({
        id: `${e.source}->${e.target}`,
        from: e.source,
        to: e.target,
        path: e.points.map(p => [f(p.x), f(p.y)] as [Finite, Finite]),
        label: e.label && e.labelPosition
          ? { x: f(e.labelPosition.x), y: f(e.labelPosition.y), text: e.label }
          : undefined,
      })),
      groups: positioned.groups.map(g => ({
        id: g.id,
        x: f(g.x),
        y: f(g.y),
        w: f(g.width),
        h: f(g.height),
        members: [],
        label: g.label,
      })),
      bounds: { w: f(positioned.width), h: f(positioned.height) },
    }
  }
  return {
    version: 1,
    seed: 0,
    kind: d.kind,
    nodes: [],
    edges: [],
    groups: [],
    bounds: { w: f(0), h: f(0) },
  }
}
