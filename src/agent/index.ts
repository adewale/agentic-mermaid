// ============================================================================
// agentic-mermaid — public agent surface (v4)
// No LayoutContext / SeededRNG / Clock / font-metrics: that apparatus did
// nothing (ELK is deterministic on its own). See AGENT_NATIVE.md § (1).
// ============================================================================

export type {
  Result, ValidDiagram, FlowchartValidDiagram, SequenceValidDiagram, TimelineValidDiagram, MutableValidDiagram,
  ValidDiagramMeta, ValidDiagramPayload, SerializedFlowchartGraph, DiagramBody, DiagramKind,
  SequenceBody, SequenceParticipant, SequenceMessage, SequenceMessageStyle,
  TimelineBody, TimelineSection, TimelinePeriod, TimelineEvent,
  SourceMap, SourceComment, InitDirective, Accessibility,
  ParseError, MutationError, MutationOp, FlowchartMutationOp, SequenceMutationOp, TimelineMutationOp, AnyMutationOp,
  NodeId, EdgeId, GroupId, ParticipantId,
  LayoutWarning, WarningCode, Tier1WarningCode, Tier2WarningCode, WarningSeverity, WarningTier,
  VerifyOptions, VerifyResult, RenderedLayout, RenderedLayoutNode, RenderedLayoutEdge, RenderedLayoutGroup,
  Finite,
} from './types.ts'

export { WARNING_SEVERITY, WARNING_TIER, DEFAULT_LABEL_CHAR_CAP, ok, err, toFinite, asFlowchart, asSequence, asTimeline } from './types.ts'
export { parseMermaid } from './parse.ts'
export { serializeMermaid, synthesizeFromGraph } from './serialize.ts'
export { mutate, edgeIdOf } from './mutate.ts'
export { verifyMermaid } from './verify.ts'
export { measureQuality, checkQuality, DEFAULT_BOUNDS } from './quality.ts'
export type { QualityMetrics, QualityBounds, QualityVerdict } from './quality.ts'
export { registerFamily, getFamily, knownFamilies } from './families.ts'
export type { FamilyPlugin, ExtractedLabel } from './families.ts'

import { renderMermaidSVG as _svg } from '../index.ts'
import { renderMermaidASCII as _ascii } from '../ascii/index.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import type { ValidDiagram, RenderedLayout } from './types.ts'
import { positionedToRenderedLayout, emptyRenderedLayout } from './layout-to-rendered.ts'

export function renderMermaidSVG(input: ValidDiagram | string, opts: Parameters<typeof _svg>[1] = {}): string {
  return _svg(typeof input === 'string' ? input : input.canonicalSource, opts)
}
export function renderMermaidASCII(input: ValidDiagram | string, opts: Parameters<typeof _ascii>[1] = {}): string {
  return _ascii(typeof input === 'string' ? input : input.canonicalSource, opts)
}

export function layoutMermaid(d: ValidDiagram): RenderedLayout {
  if (d.body.kind === 'flowchart') {
    return positionedToRenderedLayout(layoutGraphSync(d.body.graph, {}), d.kind)
  }
  return emptyRenderedLayout(d.kind)
}
