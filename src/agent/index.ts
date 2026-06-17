// ============================================================================
// agentic-mermaid — public agent surface (v4)
// No LayoutContext / SeededRNG / Clock / font-metrics: that apparatus did
// nothing (ELK is deterministic on its own). See AGENT_NATIVE.md § (1).
// ============================================================================

export type {
  Result, ValidDiagram, FlowchartValidDiagram, StateValidDiagram, SequenceValidDiagram, TimelineValidDiagram,
  ClassValidDiagram, ErValidDiagram, JourneyValidDiagram, ArchitectureValidDiagram, XyChartValidDiagram, PieValidDiagram, QuadrantValidDiagram, GanttValidDiagram, MutableValidDiagram,
  ValidDiagramMeta, ValidDiagramPayload, SerializedFlowchartGraph, DiagramBody, DiagramKind,
  StateBody, StateNode, StateTransition,
  SequenceBody, SequenceParticipant, SequenceMessage, SequenceMessageStyle,
  TimelineBody, TimelineSection, TimelinePeriod, TimelineEvent,
  ClassBody, ClassNode, ClassRelation, ClassRelationKind, ClassNote,
  ErBody, ErEntity, ErRelation, ErAttribute, ErCardinality,
  JourneyBody, JourneySection, JourneyTask,
  ArchitectureBody, ArchitectureGroup, ArchitectureService, ArchitectureJunction, ArchitectureEdge, ArchitectureEndpoint, ArchitectureSide,
  XyChartBody, XyChartAxis, XyChartSeries, XyChartAxisSpec,
  PieBody, PieSlice, QuadrantBody, QuadrantAxis, QuadrantPoint,
  GanttBody, GanttBodySection, GanttBodyTask, GanttBodyTaskTag, GanttStatement,
  SourceMap, SourceComment, InitDirective, Accessibility,
  ParseError, MutationError, MutationOp, FlowchartMutationOp, StateMutationOp, SequenceMutationOp, TimelineMutationOp,
  ClassMutationOp, ErMutationOp, JourneyMutationOp, ArchitectureMutationOp, XyChartMutationOp, PieMutationOp, QuadrantMutationOp, GanttMutationOp, AnyMutationOp,
  NodeId, EdgeId, GroupId, ParticipantId,
  LayoutWarning, WarningCode, Tier1WarningCode, Tier2WarningCode, WarningSeverity, WarningTier,
  VerifyOptions, VerifyResult, RenderedLayout, RenderedLayoutNode, RenderedLayoutEdge, RenderedLayoutGroup,
  DiagramAnalysis, DiagramActionRecord, DiagramActionKind, DiagramActionSecurity, FeedbackEdgeAnalysis, GanttScheduleAnalysisSummary,
  Finite,
} from './types.ts'

export { WARNING_SEVERITY, WARNING_TIER, DEFAULT_LABEL_CHAR_CAP, ok, err, toFinite, asFlowchart, asState, asSequence, asTimeline, asClass, asEr, asJourney, asArchitecture, asXyChart, asPie, asQuadrant, asGantt } from './types.ts'
export { parseMermaid } from './parse.ts'
export { serializeMermaid, synthesizeFromGraph } from './serialize.ts'
export { mutate, edgeIdOf } from './mutate.ts'
export { verifyMermaid } from './verify.ts'
export { measureQuality, checkQuality, DEFAULT_BOUNDS } from './quality.ts'
export type { QualityMetrics, QualityBounds, QualityVerdict } from './quality.ts'
export type { RouteCertificate, FamilyRouteCertificate, LayoutRouteCertificate, LayoutRouteClass, RouteClass, RouteBlocker, RoutePortAssignment, PortSemanticRole, AnyPort, PortSide, DiamondFacet } from '../types.ts'
export { registerFamily, getFamily, knownFamilies, BUILTIN_FAMILY_METADATA, BUILTIN_FAMILY_METADATA_COVERS_DIAGRAM_KIND, builtinFamilyMetadata } from './families.ts'
export type { FamilyPlugin, ExtractedLabel, BuiltinFamilyMetadata, BuiltinFamilyId } from './families.ts'
export { renderMermaidPNG } from './png.ts'
export type { PngOptions } from './png.ts'
export { renderMermaidASCIIWithMeta, ASCII_ROUTE_PARITY_CONTRACT } from '../ascii/meta.ts'
export type { AsciiRegion, AsciiWithMeta, RegionKind, AsciiWarning, AsciiWarningCode } from '../ascii/meta.ts'
export { describeMermaid, describeMermaidSource, describeMermaidTree } from './describe.ts'
export { analyzeMermaid, analyzeMermaidSource, collectActionRecords } from './analyze.ts'
export { TEXT_MEASUREMENT_CONTRACT, measureText, measureTextWidth } from '../text-metrics.ts'
export type { TextMeasurementContract, TextMeasurementInput, TextMeasurementResult } from '../text-metrics.ts'
export type { DescribeTree } from './describe.ts'
export type { DescribeOptions } from './describe.ts'
export { asciiToMermaid } from '../ascii/reverse.ts'

import { renderMermaidSVG as _svg } from '../index.ts'
export { verifyNoExternalRefs } from '../index.ts'
import { renderMermaidASCII as _ascii } from '../ascii/index.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { parseMermaid as parseFlowchartLegacy } from '../parser.ts'
import { stateBodyToGraph } from './state-body.ts'
import { serializeMermaid as _serialize } from './serialize.ts'
import type { ValidDiagram, RenderedLayout } from './types.ts'
import { positionedToRenderedLayout, emptyRenderedLayout } from './layout-to-rendered.ts'
import { layoutFamilyToRendered } from './family-layouts.ts'

export function renderMermaidSVG(input: ValidDiagram | string, opts: Parameters<typeof _svg>[1] = {}): string {
  return _svg(typeof input === 'string' ? input : _serialize(input), opts)
}
export function renderMermaidASCII(input: ValidDiagram | string, opts: Parameters<typeof _ascii>[1] = {}): string {
  return _ascii(typeof input === 'string' ? input : _serialize(input), opts)
}

export function layoutMermaid(d: ValidDiagram, opts: { debug?: boolean } = {}): RenderedLayout {
  if (d.body.kind === 'flowchart') {
    return positionedToRenderedLayout(layoutGraphSync(d.body.graph, {}), d.kind, opts)
  }
  // State diagrams (BUILD-19) project to a MermaidGraph via the legacy parser,
  // so layout reuses the flowchart geometric path.
  if (d.body.kind === 'state') {
    return positionedToRenderedLayout(layoutGraphSync(stateBodyToGraph(d.body), {}), d.kind, opts)
  }
  if (d.body.kind === 'opaque' && d.kind === 'flowchart') {
    try {
      return positionedToRenderedLayout(layoutGraphSync(parseFlowchartLegacy(d.canonicalSource), {}), d.kind, opts)
    } catch {
      return emptyRenderedLayout(d.kind)
    }
  }
  // QUAL-1: renderable non-graph families project their real positioned
  // layout (parsed from d.canonicalSource — works for both structured and
  // opaque bodies) so the perceptual-quality metrics see them. Debug mode
  // includes family-specific route/layout certificates where available.
  const familyLayout = layoutFamilyToRendered(d, opts)
  if (familyLayout) return familyLayout
  return emptyRenderedLayout(d.kind)
}
