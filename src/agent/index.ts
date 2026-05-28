// ============================================================================
// agentic-mermaid — public agent surface (v4)
// No LayoutContext / SeededRNG / Clock / font-metrics: that apparatus did
// nothing (ELK is deterministic on its own). See AGENT_NATIVE.md § (1).
// ============================================================================

export type {
  Result, ValidDiagram, FlowchartValidDiagram, SequenceValidDiagram, MutableValidDiagram,
  ValidDiagramMeta, ValidDiagramPayload, SerializedFlowchartGraph, DiagramBody, DiagramKind,
  SequenceBody, SequenceParticipant, SequenceMessage, SequenceMessageStyle,
  SourceMap, SourceComment, InitDirective, Accessibility,
  ParseError, MutationError, MutationOp, FlowchartMutationOp, SequenceMutationOp, AnyMutationOp,
  NodeId, EdgeId, GroupId, ParticipantId,
  LayoutWarning, WarningCode, Tier1WarningCode, Tier2WarningCode, WarningSeverity, WarningTier,
  VerifyOptions, VerifyResult, RenderedLayout, RenderedLayoutNode, RenderedLayoutEdge, RenderedLayoutGroup,
  Finite,
} from './types.ts'

export { WARNING_SEVERITY, WARNING_TIER, DEFAULT_LABEL_CHAR_CAP, ok, err, toFinite, asFlowchart, asSequence } from './types.ts'
export { parseMermaid } from './parse.ts'
export { serializeMermaid, synthesizeFromGraph } from './serialize.ts'
export { mutate, edgeIdOf } from './mutate.ts'
export { verifyMermaid } from './verify.ts'

import { renderMermaidSVG as _svg } from '../index.ts'
import { renderMermaidASCII as _ascii } from '../ascii/index.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import type { ValidDiagram, RenderedLayout, Finite } from './types.ts'
import { toFinite } from './types.ts'

export function renderMermaidSVG(input: ValidDiagram | string, opts: Parameters<typeof _svg>[1] = {}): string {
  return _svg(typeof input === 'string' ? input : input.canonicalSource, opts)
}
export function renderMermaidASCII(input: ValidDiagram | string, opts: Parameters<typeof _ascii>[1] = {}): string {
  return _ascii(typeof input === 'string' ? input : input.canonicalSource, opts)
}

const f = (n: number): Finite => toFinite(Math.round(n))

export function layoutMermaid(d: ValidDiagram): RenderedLayout {
  if (d.body.kind === 'flowchart') {
    const p = layoutGraphSync(d.body.graph, {})
    return {
      version: 1, kind: d.kind,
      nodes: p.nodes.map(n => ({ id: n.id, x: f(n.x), y: f(n.y), w: f(n.width), h: f(n.height), shape: n.shape, label: n.label })),
      edges: p.edges.map(e => ({
        id: `${e.source}->${e.target}`, from: e.source, to: e.target,
        path: e.points.map(pt => [f(pt.x), f(pt.y)] as [Finite, Finite]),
        label: e.label && e.labelPosition ? { x: f(e.labelPosition.x), y: f(e.labelPosition.y), text: e.label } : undefined,
      })),
      groups: p.groups.map(g => ({ id: g.id, x: f(g.x), y: f(g.y), w: f(g.width), h: f(g.height), members: [], label: g.label })),
      bounds: { w: f(p.width), h: f(p.height) },
    }
  }
  return { version: 1, kind: d.kind, nodes: [], edges: [], groups: [], bounds: { w: f(0), h: f(0) } }
}
