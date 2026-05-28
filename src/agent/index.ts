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
import type { ValidDiagram, RenderedLayout, LayoutContext } from './types.ts'

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
        x: Math.round(n.x),
        y: Math.round(n.y),
        w: Math.round(n.width),
        h: Math.round(n.height),
        shape: n.shape,
        label: n.label,
      })),
      edges: positioned.edges.map(e => ({
        id: `${e.source}->${e.target}`,
        from: e.source,
        to: e.target,
        path: e.points.map(p => [Math.round(p.x), Math.round(p.y)] as [number, number]),
        label: e.label && e.labelPosition
          ? {
              x: Math.round(e.labelPosition.x),
              y: Math.round(e.labelPosition.y),
              text: e.label,
            }
          : undefined,
      })),
      groups: positioned.groups.map(g => ({
        id: g.id,
        x: Math.round(g.x),
        y: Math.round(g.y),
        w: Math.round(g.width),
        h: Math.round(g.height),
        members: [],
        label: g.label,
      })),
      bounds: { w: Math.round(positioned.width), h: Math.round(positioned.height) },
    }
  }
  return {
    version: 1,
    seed: 0,
    kind: d.kind,
    nodes: [],
    edges: [],
    groups: [],
    bounds: { w: 0, h: 0 },
  }
}
