import type { RailroadBody, RailroadMutationOp } from '../railroad/types.ts'
export type { RailroadBody, RailroadMutationOp, RailroadNode, RailroadRule, Notation as RailroadNotation } from '../railroad/types.ts'
import type { CynefinBody, CynefinMutationOp } from '../cynefin/types.ts'
export type { CynefinBody, CynefinMutationOp } from '../cynefin/types.ts'
import type { VennBody, VennMutationOp } from '../venn/types.ts'
export type { VennBody, VennMutationOp } from '../venn/types.ts'
import type { WardleyBody, WardleyMutationOp } from '../wardley/types.ts'
export type { WardleyBody, WardleyMutationOp } from '../wardley/types.ts'
import type { UsecaseBody, UsecaseMutationOp } from '../usecase/types.ts'
export type { UsecaseBody, UsecaseMutationOp } from '../usecase/types.ts'
import type { AgentflowBody, AgentflowMutationOp } from '../agentflow/types.ts'
export type { AgentflowBody, AgentflowMutationOp } from '../agentflow/types.ts'
import type { SwimlaneBody, SwimlaneMutationOp } from '../swimlane/types.ts'
import type { TreeviewBody, TreeviewMutationOp } from '../treeview/types.ts'
export type { SwimlaneBody, SwimlaneMutationOp } from '../swimlane/types.ts'
export type { TreeviewBody, TreeviewNode, TreeviewMutationOp } from '../treeview/types.ts'
import type { ZenUMLBody, ZenUMLMutationOp } from '../zenuml/native-types.ts'
export type { ZenUMLBody, ZenUMLMutationOp, ZenUMLParticipant, ZenUMLStatement, ZenUMLBranch } from '../zenuml/native-types.ts'
import type { EventModelingBody, EventModelingMutationOp } from '../eventmodeling/types.ts'
export type { EventModelingBody, EventModelingMutationOp, EventFrame, EventFrameType, EventData, EventSpecification } from '../eventmodeling/types.ts'
import type { C4Body, C4MutationOp } from '../c4/types.ts'
import type { LabelContent } from '../shared/display-text.ts'

export type { C4Body, C4MutationOp } from '../c4/types.ts'

import type { BlockBody, BlockMutationOp } from '../block/types.ts'
import type { IshikawaBody, IshikawaMutationOp } from '../ishikawa/types.ts'
import type { KanbanBody, KanbanMutationOp } from '../kanban/types.ts'
import type { PacketBody, PacketMutationOp } from '../packet/types.ts'
import type { RequirementBody, RequirementMutationOp } from '../requirement/types.ts'
import type { TreemapBody, TreemapMutationOp } from '../treemap/types.ts'

export type { BlockBody, BlockMutationOp } from '../block/types.ts'
export type { IshikawaBody, IshikawaMutationOp } from '../ishikawa/types.ts'
export type { KanbanBody, KanbanMutationOp } from '../kanban/types.ts'
export type { PacketBody, PacketMutationOp } from '../packet/types.ts'
export type { RequirementBody, RequirementMutationOp } from '../requirement/types.ts'
export type { TreemapBody, TreemapMutationOp } from '../treemap/types.ts'

// ============================================================================
// Agentic Mermaid — IR and verb types (v4)
//
// v4 removes the seed/RNG/clock/font-metric apparatus that the empirical
// probe proved was theater (ELK is already deterministic; seeding changed
// nothing). The only verify knob is labelCharCap. See AGENT_NATIVE.md § (1).
// ============================================================================

import type { GitGraphCommitType, GitGraphDiagram } from '../gitgraph/types.ts'
import type { MermaidConfigMap, MermaidFrontmatterMap } from '../mermaid-source.ts'
import type { MindmapNode, MindmapShape } from '../mindmap/types.ts'
import { BRAND_CONSTRAINT_WARNING_POLICY, type BrandConstraintKind, type BrandConstraintWarningCode } from '../scene/brand-constraint-contract.ts'
import type { Direction, EdgeRouteCertificate, EdgeStyle, MermaidGraph, NodeShape, RegionContainmentCertificate, RenderOptions, RouteCertificate, RouteClass } from '../types.ts'

export type { BrandConstraintWarningCode } from '../scene/brand-constraint-contract.ts'

// ---- Result ---------------------------------------------------------------

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }
export function ok<T, E = never>(value: T): Result<T, E> {
  return { ok: true, value }
}
export function err<E, T = never>(error: E): Result<T, E> {
  return { ok: false, error }
}

// ---- Families -------------------------------------------------------------

export type DiagramKind = 'flowchart' | 'state' | 'sequence' | 'class' | 'er' | 'timeline' | 'journey' | 'xychart' | 'architecture' | 'pie' | 'quadrant' | 'gantt' | 'mindmap' | 'gitgraph' | 'radar' | 'sankey' | 'c4' | 'packet' | 'kanban' | 'requirement' | 'treemap' | 'ishikawa' | 'block' | 'eventmodeling' | 'zenuml' | 'agentflow' | 'usecase' | 'wardley' | 'venn' | 'cynefin' | 'railroad' | 'swimlane' | 'treeview'

/** Runtime extensions are open but must pass the registry's namespace validator. */
export type ExternalFamilyId = `family:${string}`
export type FamilyId = DiagramKind | ExternalFamilyId

export type { SequenceParticipantKind, SequenceParticipant, SequenceMessageStyle, SequenceMessageArrow, SequenceMessage, SequenceFragmentKind, SequenceFragmentBranch, SequenceFragment, SequenceStatement, SequenceBody, TimelineEvent, TimelinePeriod, TimelineSection, TimelineBody, JourneyTask, JourneySection, JourneyBody, ClassRelationKind, ClassNode, ClassNamespaceDecl, ClassRelation, ClassNote, ClassBody, ErCardinality, ErAttribute, ErEntity, ErGroup, ErRelation, ErStatement, ErBody, ArchitectureSide, ArchitectureEndpointBoundary, ArchitectureGroup, ArchitectureService, ArchitectureJunction, ArchitectureEndpoint, ArchitectureEdge, ArchitectureAlignment, ArchitectureBody, XyChartAxis, XyChartSeries, XyChartBody, PieSlice, PieBody, QuadrantAxis, QuadrantPointStyle, QuadrantPoint, QuadrantBody, RadarBodyAxis, RadarBodyCurve, RadarBody, SankeyBodyLink, SankeyBody, GanttBodyTaskTag, GanttBodyTask, GanttBodySection, GanttStatement, GanttBody, StateNode, StateRegion, StateTransition, StateNote, StateBody, StateFloatingNote, MindmapBody, GitGraphBody } from './diagram-bodies.ts'
import type { SequenceMessageStyle, SequenceFragmentKind, SequenceBody, TimelineBody, JourneyBody, ClassRelationKind, ClassRelation, ClassBody, ErCardinality, ErBody, ArchitectureSide, ArchitectureEndpointBoundary, ArchitectureBody, XyChartBody, PieBody, QuadrantBody, RadarBody, SankeyBody, GanttBodyTaskTag, GanttBody, StateBody, MindmapBody, GitGraphBody } from './diagram-bodies.ts'

// ---- Meta + IR ------------------------------------------------------------

export interface SourceComment {
  text: string
  line: number
}
export interface InitDirective {
  raw: string
  /** Authored object layer, retaining legacy config scope; not an effective merge. */
  parsed: MermaidConfigMap
}
export interface Accessibility {
  title?: string
  descr?: string
}

export interface ValidDiagramMeta {
  /** Native effective config view. Captured wrapper/init bytes own authored layers.
   * For explicit JSON config changes, omit wrapperSource when synthesizing. */
  frontmatter?: MermaidFrontmatterMap
  initDirectives: InitDirective[]
  comments: SourceComment[]
  accessibility: Accessibility
  /**
   * The leading source wrapper (frontmatter block, `%%{init}%%` directives,
   * `%%` comments, and blank lines before the diagram header): the exact bytes
   * before the family header. Parsed diagrams retain it even when empty.
   * serializeMermaid re-emits it untouched by default; canonical wrapper
   * synthesis is opt-in via `{ wrapper: 'canonical' }`. Diagrams synthesized
   * from JSON payloads omit it to request canonical synthesis.
   */
  wrapperSource?: string
  /**
   * In-body `%%` comments that structured serialization does not preserve,
   * computed at parse time by diffing against the canonical serialization.
   * Surfaced by verify as the Tier 3 `COMMENT_DROPPED` lint. Opaque bodies
   * preserve comments verbatim and never set this.
   *
   * `line` locates the comment in the artifact where the loss happened, which
   * is not always the artifact carrying this receipt: mutation rebuilds every
   * other meta field and the source map from its output, but reparsing
   * already-canonical source cannot rediscover a comment that serialization
   * dropped, so the original receipt — and its original line — rides along.
   * Treat it as a record of what was lost, not as an index into
   * `canonicalSource`.
   */
  droppedComments?: SourceComment[]
  /** Parser-identified body comments, anchored where the family exposes a
   * stable statement identity; unassociated/deleted anchors follow the body. */
  bodyComments?: Array<{ raw: string; anchor?: { collection: 'nodes' | 'edges' | 'groups'; id: string }; placement: 'before' | 'after' }>
}

export interface SourceLocation {
  line: number
  col: number
}

export interface SourceMapSpans {
  /** Exact authored document spans, including wrapper/config directives. */
  preserved: PreservedSourceSpans
  /** Exact authored statement spans keyed like the corresponding location map. */
  nodes: Map<string, SourceSpan>
  edges: Map<string, SourceSpan>
  groups: Map<string, SourceSpan>
  /** Exact authored sub-statement spans (labels, members, values, cardinalities). */
  labels: Map<string, SourceSpan>
  /** Authored metadata key/value tokens, keyed by canonical item occurrence identity and property. */
  metadata?: Map<string, Map<string, { key: SourceSpan; value: SourceSpan }>>
}

export interface SourceMap {
  nodes: Map<string, SourceLocation>
  edges: Map<string, SourceLocation>
  groups: Map<string, SourceLocation>
  /** Stable label spans where known: `node:<id>`, `edge#<i>:<from>-><to>`, `group:<id>`. */
  labels: Map<string, SourceLocation>
  /**
   * Exact authored spans. The legacy location maps above remain canonical-source
   * coordinates for compatibility; this sidecar is authored-source based.
   */
  spans?: SourceMapSpans
}

export type DiagramActionKind = 'href' | 'call' | 'callback'
export type DiagramActionSecurity = 'safe' | 'unsafe' | 'source-only' | 'unsupported'

export interface DiagramActionRecord {
  /** Stable source-side action id (`action:<family>:<target>:<n>`). */
  id?: string
  /** Region id this action attaches to when a rendered layout exposes regions. */
  regionId?: string
  family: DiagramKind
  target: string
  action: DiagramActionKind
  /** Original action payload after the target id; never executed by analysis. */
  raw: string
  line?: number
  href?: string
  tooltip?: string
  security: DiagramActionSecurity
  executable: false
  message?: string
}

export interface FeedbackEdgeAnalysis {
  edgeIndex: number
  from: NodeId
  to: NodeId
  label?: string
  routeClass: RouteClass
}

export interface GanttScheduleAnalysisSummary {
  criticalPathTaskIds: string[]
  slackByTaskId: Record<string, number>
  projectStart: number
  projectEnd: number
  entryTaskIds: string[]
  sinkTaskIds: string[]
}

export interface DiagramAnalysis {
  kind: FamilyId
  feedbackEdges: FeedbackEdgeAnalysis[]
  actions: DiagramActionRecord[]
  gantt?: GanttScheduleAnalysisSummary
}

export type DiagramBody =
  | { kind: 'flowchart'; graph: MermaidGraph }
  | AgentflowBody
  | UsecaseBody
  | WardleyBody
  | VennBody
  | CynefinBody
  | RailroadBody
  | SwimlaneBody
  | TreeviewBody
  | StateBody
  | SequenceBody
  | TimelineBody
  | ClassBody
  | ErBody
  | JourneyBody
  | ArchitectureBody
  | XyChartBody
  | PieBody
  | QuadrantBody
  | GanttBody
  | MindmapBody
  | GitGraphBody
  | RadarBody
  | SankeyBody
  | C4Body
  | PacketBody
  | KanbanBody
  | RequirementBody
  | TreemapBody
  | IshikawaBody
  | BlockBody
  | EventModelingBody
  | ZenUMLBody
  /**
   * Opaque body — the parser understood the family header but encountered
   * unmodeled syntax. `source` is the ORIGINAL body with indentation, blank
   * lines, and comments PRESERVED (per the Loop 5 Phase A fix), so the
   * serializer can re-emit byte-for-byte. Distinct from `ValidDiagram.canonicalSource`,
   * which for structured bodies is the rebuilt canonical form.
   */
  | { kind: 'opaque'; family: DiagramKind; source: string; diagnostic?: { code: 'GITGRAPH_DUPLICATE_COMMIT_ID'; id: string } }

/** Open, source-preserving body envelope owned by a namespaced family. */
export interface ExtensionDiagramBody {
  kind: 'extension'
  family: ExternalFamilyId
  source: string
  /** Descriptor-owned structured value; core treats it as opaque data. */
  data?: unknown
}

export interface SourceSpanPoint {
  /** UTF-16 offset in the exact authored source string. */
  readonly offset: number
  readonly line: number
  readonly col: number
}

export interface SourceSpan {
  readonly start: SourceSpanPoint
  readonly end: SourceSpanPoint
}

/** Exact spans retained when no installed family can claim the source. */
export interface PreservedSourceSpans {
  /** Exact span of the complete authored source. */
  readonly source: SourceSpan
  readonly wrapper?: SourceSpan
  /** YAML frontmatter including its delimiters and trailing newline. */
  readonly frontmatter?: SourceSpan
  /** Mermaid `%%{init...}%%` / `%%{initialize...}%%` directives. */
  readonly initDirectives?: readonly SourceSpan[]
  /** Exact source spans of `accTitle` / `accDescr` directives. */
  readonly accessibilityDirectives?: readonly SourceSpan[]
  readonly header: SourceSpan
  /** Authored payload after the header line. */
  readonly body: SourceSpan
}

/**
 * Lossless, non-renderable family envelope. Upstream-recognized sources use an
 * opaque classification; wholly unknown headers use `unknown`. In both cases
 * the original document and its source spans remain available for storage,
 * serialization, later registration, and stable capability diagnostics.
 */
export interface PreservedDiagramBody {
  readonly kind: 'preserved'
  readonly representation: 'opaque' | 'unknown'
  readonly source: string
  readonly preservation: SourcePreservationReceipt
  readonly spans: PreservedSourceSpans
  readonly diagnostic: {
    readonly code: 'UNSUPPORTED_FAMILY' | 'UNKNOWN_HEADER' | 'FAMILY_DESCRIPTOR_MISMATCH'
    readonly message: string
    readonly help: string
  }
}

export type FamilyParsedBody = DiagramBody | ExtensionDiagramBody | PreservedDiagramBody

export interface ValidDiagram {
  readonly kind: DiagramKind
  readonly meta: ValidDiagramMeta
  readonly body: DiagramBody
  readonly source: SourceMap
  /**
   * Load-bearing round-trip pillar. See AGENT_NATIVE.md § (3).
   *
   * For STRUCTURED bodies, `canonicalSource` is the normalized text
   * (`normalized.text` from `mermaid-source.ts`) — used by `renderMermaidSVG`
   * + the legacy parser for the flowchart pathway. After `serializeMermaid`,
   * the re-emitted source is rebuilt from the structured body.
   * AgentFlow preserves indentation in this source because flattening YAML
   * changes its meaning; copied parsed envelopes must remain executable.
   *
   * For OPAQUE bodies, the serializer emits `body.source` directly (NOT
   * `canonicalSource`) so original indentation and blank lines round-trip
   * byte-for-byte. `canonicalSource` is still set, but it's the normalized
   * (line-trimmed) form — useful for layout / rendering, not for fidelity.
   *
   * This split exists because the legacy flowchart parser needs trimmed
   * lines, but opaque-fallback round-trip needs the original. Treat
   * `body.source` as the source of truth for opaque-body fidelity.
   */
  readonly canonicalSource: string
}

export interface ExtensionValidDiagram {
  readonly kind: ExternalFamilyId
  /** Identity of the exact descriptor contract that produced `body.data`.
   * Core uses it to keep an upgraded registration from consuming stale,
   * descriptor-owned structured data. */
  readonly descriptorIdentity: import('../shared/extension-identity.ts').ExtensionIdentity<'family'>
  readonly meta: ValidDiagramMeta
  readonly body: ExtensionDiagramBody
  readonly source: SourceMap
  readonly canonicalSource: string
}

export interface PreservedValidDiagram {
  /** Namespaced non-registration identity; the upstream/header identity lives in `body.preservation`. */
  readonly kind: ExternalFamilyId
  readonly meta: ValidDiagramMeta
  readonly body: PreservedDiagramBody
  readonly source: SourceMap
  readonly canonicalSource: string
}

export type ParsedDiagram = ValidDiagram | ExtensionValidDiagram | PreservedValidDiagram

export type FlowchartValidDiagram = ValidDiagram & { body: { kind: 'flowchart'; graph: MermaidGraph } }
export type SwimlaneValidDiagram = ValidDiagram & { body: SwimlaneBody }
export type TreeviewValidDiagram = ValidDiagram & { body: TreeviewBody }
export function asSwimlane(d: ParsedDiagram): SwimlaneValidDiagram | null {
  return d.body.kind === 'swimlane' ? d as SwimlaneValidDiagram : null
}
export function asTreeview(d: ParsedDiagram): TreeviewValidDiagram | null {
  return d.body.kind === 'treeview' ? d as TreeviewValidDiagram : null
}
export type StateValidDiagram = ValidDiagram & { body: StateBody }
export type SequenceValidDiagram = ValidDiagram & { body: SequenceBody }
export type TimelineValidDiagram = ValidDiagram & { body: TimelineBody }
export type ClassValidDiagram = ValidDiagram & { body: ClassBody }
export type ErValidDiagram = ValidDiagram & { body: ErBody }
export type JourneyValidDiagram = ValidDiagram & { body: JourneyBody }
export type ArchitectureValidDiagram = ValidDiagram & { body: ArchitectureBody }
export type XyChartValidDiagram = ValidDiagram & { body: XyChartBody }
export type PieValidDiagram = ValidDiagram & { body: PieBody }
export type QuadrantValidDiagram = ValidDiagram & { body: QuadrantBody }
export type GanttValidDiagram = ValidDiagram & { body: GanttBody }
export type MindmapValidDiagram = ValidDiagram & { body: MindmapBody }
export type GitGraphValidDiagram = ValidDiagram & { body: GitGraphBody }
export type RadarValidDiagram = ValidDiagram & { body: RadarBody }
export type SankeyValidDiagram = ValidDiagram & { body: SankeyBody }
export type C4ValidDiagram = ValidDiagram & { body: C4Body }
export type PacketValidDiagram = ValidDiagram & { body: PacketBody }
export type KanbanValidDiagram = ValidDiagram & { body: KanbanBody }
export type RequirementValidDiagram = ValidDiagram & { body: RequirementBody }
export type TreemapValidDiagram = ValidDiagram & { body: TreemapBody }
export type ZenUMLValidDiagram = ValidDiagram & { body: ZenUMLBody }
export type EventModelingValidDiagram = ValidDiagram & { body: EventModelingBody }
export type IshikawaValidDiagram = ValidDiagram & { body: IshikawaBody }
export type BlockValidDiagram = ValidDiagram & { body: BlockBody }
export type MutableValidDiagram =
  | FlowchartValidDiagram
  | AgentflowValidDiagram
  | UsecaseValidDiagram
  | WardleyValidDiagram
  | VennValidDiagram
  | CynefinValidDiagram
  | RailroadValidDiagram
  | SwimlaneValidDiagram
  | TreeviewValidDiagram
  | StateValidDiagram
  | SequenceValidDiagram
  | TimelineValidDiagram
  | ClassValidDiagram
  | ErValidDiagram
  | JourneyValidDiagram
  | ArchitectureValidDiagram
  | XyChartValidDiagram
  | PieValidDiagram
  | QuadrantValidDiagram
  | GanttValidDiagram
  | MindmapValidDiagram
  | GitGraphValidDiagram
  | RadarValidDiagram
  | SankeyValidDiagram
  | C4ValidDiagram
  | PacketValidDiagram
  | KanbanValidDiagram
  | RequirementValidDiagram
  | TreemapValidDiagram
  | IshikawaValidDiagram
  | EventModelingValidDiagram
  | ZenUMLValidDiagram
  | BlockValidDiagram

export function asPacket(d: ParsedDiagram): PacketValidDiagram | null {
  return d.body.kind === 'packet' ? (d as PacketValidDiagram) : null
}
export function asKanban(d: ParsedDiagram): KanbanValidDiagram | null {
  return d.body.kind === 'kanban' ? (d as KanbanValidDiagram) : null
}
export function asRequirement(d: ParsedDiagram): RequirementValidDiagram | null {
  return d.body.kind === 'requirement' ? (d as RequirementValidDiagram) : null
}
export function asTreemap(d: ParsedDiagram): TreemapValidDiagram | null {
  return d.body.kind === 'treemap' ? (d as TreemapValidDiagram) : null
}
export function asIshikawa(d: ParsedDiagram): IshikawaValidDiagram | null {
  return d.body.kind === 'ishikawa' ? (d as IshikawaValidDiagram) : null
}
export function asBlock(d: ParsedDiagram): BlockValidDiagram | null {
  return d.body.kind === 'block' ? (d as BlockValidDiagram) : null
}

export function asFlowchart(d: ParsedDiagram): FlowchartValidDiagram | null {
  return d.body.kind === 'flowchart' ? (d as FlowchartValidDiagram) : null
}
export function asState(d: ParsedDiagram): StateValidDiagram | null {
  return d.body.kind === 'state' ? (d as StateValidDiagram) : null
}
export function asSequence(d: ParsedDiagram): SequenceValidDiagram | null {
  return d.body.kind === 'sequence' ? (d as SequenceValidDiagram) : null
}

export function asTimeline(d: ParsedDiagram): TimelineValidDiagram | null {
  return d.body.kind === 'timeline' ? (d as TimelineValidDiagram) : null
}

export function asClass(d: ParsedDiagram): ClassValidDiagram | null {
  return d.body.kind === 'class' ? (d as ClassValidDiagram) : null
}

export function asEr(d: ParsedDiagram): ErValidDiagram | null {
  return d.body.kind === 'er' ? (d as ErValidDiagram) : null
}

export function asJourney(d: ParsedDiagram): JourneyValidDiagram | null {
  return d.body.kind === 'journey' ? (d as JourneyValidDiagram) : null
}

export function asArchitecture(d: ParsedDiagram): ArchitectureValidDiagram | null {
  return d.body.kind === 'architecture' ? (d as ArchitectureValidDiagram) : null
}

export function asXyChart(d: ParsedDiagram): XyChartValidDiagram | null {
  return d.body.kind === 'xychart' ? (d as XyChartValidDiagram) : null
}

export function asPie(d: ParsedDiagram): PieValidDiagram | null {
  return d.body.kind === 'pie' ? (d as PieValidDiagram) : null
}

export function asQuadrant(d: ParsedDiagram): QuadrantValidDiagram | null {
  return d.body.kind === 'quadrant' ? (d as QuadrantValidDiagram) : null
}

export function asRadar(d: ParsedDiagram): RadarValidDiagram | null {
  return d.body.kind === 'radar' ? (d as RadarValidDiagram) : null
}

export function asC4(d: ParsedDiagram): C4ValidDiagram | null {
  return d.body.kind === 'c4' ? (d as C4ValidDiagram) : null
}

export function asSankey(d: ParsedDiagram): SankeyValidDiagram | null {
  return d.body.kind === 'sankey' ? (d as SankeyValidDiagram) : null
}

export function asGantt(d: ParsedDiagram): GanttValidDiagram | null {
  return d.body.kind === 'gantt' ? (d as GanttValidDiagram) : null
}

export function asMindmap(d: ParsedDiagram): MindmapValidDiagram | null {
  return d.body.kind === 'mindmap' ? (d as MindmapValidDiagram) : null
}

export function asGitGraph(d: ParsedDiagram): GitGraphValidDiagram | null {
  return d.body.kind === 'gitgraph' ? (d as GitGraphValidDiagram) : null
}

// ---- Errors ---------------------------------------------------------------

export interface SourcePreservationReceipt {
  version: 1
  classification: 'unsupported' | 'inventory-only' | 'unknown'
  /** Exact authored bytes supplied to parseRegisteredMermaid. */
  source: string
  header: string
  upstreamFamilyId?: string
  mermaidVersion: string
  /** Present for open preserved envelopes and family-detection errors emitted by this version. */
  spans?: PreservedSourceSpans
}

export interface ParseError {
  code: string
  message: string
  line?: number
  col?: number
  /** One-based column; col is retained as a compatibility alias. */
  column?: number
  diagramType?: string
  /** Present when parsing cannot proceed but no authored bytes were discarded. */
  preservation?: SourcePreservationReceipt
  help?: string
}

export interface MutationError {
  code:
    | 'NODE_NOT_FOUND'
    | 'EDGE_NOT_FOUND'
    | 'PARTICIPANT_NOT_FOUND'
    | 'MESSAGE_NOT_FOUND'
    | 'SECTION_NOT_FOUND'
    | 'PERIOD_NOT_FOUND'
    | 'EVENT_NOT_FOUND'
    | 'TASK_NOT_FOUND'
    | 'ACTOR_NOT_FOUND'
    | 'CLASS_NOT_FOUND'
    | 'MEMBER_NOT_FOUND'
    | 'RELATION_NOT_FOUND'
    | 'NOTE_NOT_FOUND'
    | 'ENTITY_NOT_FOUND'
    | 'ATTRIBUTE_NOT_FOUND'
    | 'SERVICE_NOT_FOUND'
    | 'GROUP_NOT_FOUND'
    | 'SERIES_NOT_FOUND'
    | 'AXIS_NOT_FOUND'
    | 'CURVE_NOT_FOUND'
    | 'SLICE_NOT_FOUND'
    | 'POINT_NOT_FOUND'
    | 'LINK_NOT_FOUND'
    | 'STATE_NOT_FOUND'
    | 'TRANSITION_NOT_FOUND'
    | 'DUPLICATE_NODE'
    | 'DUPLICATE_PARTICIPANT'
    | 'DUPLICATE_CLASS'
    | 'DUPLICATE_ENTITY'
    | 'DUPLICATE_STATE'
    | 'DUPLICATE_TASK'
    | 'INVALID_OP'
    | 'UNSUPPORTED_FAMILY'
    | 'UNKNOWN_HEADER'
  message: string
}

// ---- MutationOp -----------------------------------------------------------

export type NodeId = string
export type EdgeId = string
export type GroupId = string
export type ParticipantId = string

export type FlowchartMutationOp =
  // shape also accepts any documented Mermaid v11 @{ shape } name/alias
  // (normalized via src/flowchart-shapes.ts; the authored spelling serializes).
  | { kind: 'add_node'; id: NodeId; label: string; shape?: NodeShape | (string & {}); parent?: GroupId }
  | { kind: 'remove_node'; id: NodeId }
  | { kind: 'rename_node'; from: NodeId; to: NodeId }
  // target/id accept a node id, an authored v11.6 edge ID (`e1@-->`), or the
  // endpoint forms `from->to` / `from->to#k`. An id a node and an edge share
  // names the node; the endpoint forms name that edge.
  | { kind: 'set_label'; target: NodeId | EdgeId; label: string }
  | { kind: 'add_edge'; from: NodeId; to: NodeId; label?: string; style?: EdgeStyle }
  | { kind: 'remove_edge'; id: EdgeId }
  | { kind: 'set_shape'; id: NodeId; shape: NodeShape | (string & {}) }
  // Omit subgraph to set the diagram direction; name a subgraph to set that
  // subgraph's `direction` override.
  | { kind: 'set_direction'; direction: Direction; subgraph?: GroupId }
  // members are existing node ids MOVED into the new subgraph (the state
  // make_composite precedent); parent nests the new subgraph.
  | { kind: 'add_subgraph'; id: GroupId; label?: string; parent?: GroupId; members?: NodeId[] }
  // Default dissolves the box (members move to the parent scope, children are
  // promoted); removeMembers also deletes member nodes and their edges.
  | { kind: 'remove_subgraph'; id: GroupId; removeMembers?: boolean }
  // null moves the node to the top level.
  | { kind: 'move_node'; id: NodeId; subgraph: GroupId | null }
  // Declares/replaces a classDef; style is CSS-like pairs ("fill:#f96,stroke:#333").
  | { kind: 'define_class'; name: string; style: string }
  // Assigns a classDef name to a node (`class A hot`); null removes it.
  | { kind: 'set_node_class'; id: NodeId; className: string | null }
  // Sets a node's inline `style` directive; null clears it.
  | { kind: 'set_node_style'; id: NodeId; style: string | null }

export type SequenceMutationOp =
  | { kind: 'add_participant'; id: ParticipantId; label?: string; participantKind?: 'participant' | 'actor' }
  | { kind: 'remove_participant'; id: ParticipantId }
  // index = optional TOP-LEVEL insert position (same addressing as
  // remove_message/set_message_text; fragment messages have their own
  // explicit fragment-addressed ops); omitted = append.
  | { kind: 'add_message'; from: ParticipantId; to: ParticipantId; text: string; wrap?: boolean; style?: SequenceMessageStyle; index?: number }
  | { kind: 'remove_message'; index: number }
  | { kind: 'set_message_text'; index: number; text: string }
  | { kind: 'set_message_wrap'; index: number; wrap: boolean | null }
  // Source order IS the interaction timeline, so reorder is a first-class
  // edit (journey move_task precedent); from/to are top-level indices.
  | { kind: 'move_message'; from: number; to: number }
  | { kind: 'set_participant_label'; id: ParticipantId; label: string }
  | { kind: 'add_fragment'; fragmentKind: SequenceFragmentKind; label?: string; index?: number }
  | { kind: 'remove_fragment'; index: number }
  | { kind: 'set_fragment_label'; index: number; label: string | null }
  | { kind: 'add_fragment_branch'; fragmentIndex: number; label?: string }
  | { kind: 'set_fragment_branch_label'; fragmentIndex: number; branchIndex: number; label: string | null }
  | { kind: 'add_fragment_message'; fragmentIndex: number; branchIndex?: number; from: ParticipantId; to: ParticipantId; text: string; wrap?: boolean; style?: SequenceMessageStyle; index?: number }
  | { kind: 'remove_fragment_message'; fragmentIndex: number; branchIndex?: number; index: number }
  | { kind: 'set_fragment_message_text'; fragmentIndex: number; branchIndex?: number; index: number; text: string }
  | { kind: 'set_fragment_message_wrap'; fragmentIndex: number; branchIndex?: number; index: number; wrap: boolean | null }

export type TimelineMutationOp =
  | { kind: 'set_title'; title: string | null }
  // index = optional insert position (journey convention from PR #141); omitted = append.
  | { kind: 'add_section'; label: string; index?: number }
  | { kind: 'remove_section'; index: number }
  | { kind: 'set_section_label'; index: number; label: string }
  | { kind: 'add_period'; sectionIndex: number; label: string; events?: string[]; index?: number }
  | { kind: 'remove_period'; sectionIndex: number; periodIndex: number }
  | { kind: 'set_period_label'; sectionIndex: number; periodIndex: number; label: string }
  | { kind: 'add_event'; sectionIndex: number; periodIndex: number; text: string; index?: number }
  | { kind: 'remove_event'; sectionIndex: number; periodIndex: number; eventIndex: number }
  | { kind: 'set_event_text'; sectionIndex: number; periodIndex: number; eventIndex: number; text: string }
  // Timeline order IS the chronology, so reorder is a first-class edit rather
  // than a remove+re-add dance with shifting indices (journey move_task /
  // move_section precedent).
  | { kind: 'move_period'; fromSection: number; fromIndex: number; toSection: number; toIndex: number }
  | { kind: 'move_event'; fromSection: number; fromPeriod: number; fromIndex: number; toSection: number; toPeriod: number; toIndex: number }
  | { kind: 'move_section'; from: number; to: number }
  | { kind: 'set_accessibility_title'; title: string | null }
  | { kind: 'set_accessibility_description'; description: string | null }

export type ClassMutationOp =
  | { kind: 'set_title'; title: string | null }
  | { kind: 'add_class'; id: string; label?: string; generic?: string; members?: string[]; namespace?: string }
  | { kind: 'remove_class'; id: string }
  | { kind: 'rename_class'; from: string; to: string }
  | { kind: 'set_class_generic'; class: string; generic: string | null }
  | { kind: 'add_member'; class: string; text: string }
  | { kind: 'remove_member'; class: string; index: number }
  | { kind: 'add_interface'; class: string; label: string; side?: 'from' | 'to'; relationLabel?: string; lineStyle?: 'solid' | 'dashed' }
  | { kind: 'add_relation'; from: string; to: string; relKind: ClassRelationKind; label?: string; markerAt?: ClassRelation['markerAt']; fromKind?: ClassRelationKind; toKind?: ClassRelationKind; lineStyle?: ClassRelation['lineStyle'] }
  | { kind: 'remove_relation'; index: number }
  | { kind: 'add_note'; text: string; for?: string }
  | { kind: 'remove_note'; index: number }
  // Namespace membership (repo #118): a dot path (e.g. 'Platform.Auth')
  // moves the class into that namespace (declared on demand); null moves it
  // back to the top level.
  | { kind: 'set_class_namespace'; class: string; namespace: string | null }
  | { kind: 'define_class'; name: string; style: string }
  | { kind: 'set_css_class'; class: string; className: string | null }
  | { kind: 'set_class_style'; class: string; style: string | null }

export type ErMutationOp =
  | { kind: 'add_entity'; id: string; label?: string; attributes?: string[] }
  | { kind: 'remove_entity'; id: string }
  | { kind: 'rename_entity'; from: string; to: string }
  | { kind: 'set_entity_label'; entity: string; label: string | null }
  | { kind: 'add_attribute'; entity: string; text: string }
  | { kind: 'remove_attribute'; entity: string; index: number }
  | { kind: 'add_relation'; from: string; to: string; leftCard: ErCardinality; rightCard: Exclude<ErCardinality, 'parent'>; dashed?: boolean; label?: string }
  | { kind: 'remove_relation'; index: number }
  | { kind: 'set_direction'; direction: import('../types.ts').Direction }
  | { kind: 'define_class'; name: string; style: string }
  | { kind: 'set_entity_class'; entity: string; className: string | null }
  | { kind: 'set_entity_style'; entity: string; style: string | null }

export type JourneyMutationOp =
  | { kind: 'set_title'; title: string | null }
  | { kind: 'add_section'; label: string; index?: number }
  | { kind: 'remove_section'; index: number }
  | { kind: 'set_section_label'; index: number; label: string }
  | { kind: 'add_task'; sectionIndex: number; text: string; score: number; actors?: string[]; index?: number }
  | { kind: 'remove_task'; sectionIndex: number; taskIndex: number }
  | { kind: 'set_task_text'; sectionIndex: number; taskIndex: number; text: string }
  | { kind: 'set_task_score'; sectionIndex: number; taskIndex: number; score: number }
  | { kind: 'set_task_actors'; sectionIndex: number; taskIndex: number; actors: string[] }
  | { kind: 'rename_actor'; from: string; to: string }
  // Journey order IS the timeline, so ordering is a first-class edit rather
  // than a remove+re-add dance with shifting indices (every other ordered
  // family already carries its reorder op).
  | { kind: 'move_task'; fromSection: number; fromIndex: number; toSection: number; toIndex: number }
  | { kind: 'move_section'; from: number; to: number }
  | { kind: 'set_accessibility_title'; title: string | null }
  | { kind: 'set_accessibility_description'; description: string | null }

export type ArchitectureMutationOp =
  | { kind: 'set_title'; title: string | null }
  | { kind: 'set_accessibility_title'; title: string | null }
  | { kind: 'set_accessibility_description'; description: string | null }
  | { kind: 'add_service'; id: string; label?: string; icon?: string | null; iconText?: string | null; group?: string | null }
  | { kind: 'remove_service'; id: string }
  | { kind: 'rename_service'; from: string; to: string }
  | { kind: 'set_service_label'; id: string; label: string }
  | { kind: 'set_service_icon'; id: string; icon: string | null }
  | { kind: 'set_service_icon_text'; id: string; text: string | null }
  | { kind: 'move_service'; id: string; group: string | null }
  | { kind: 'add_junction'; id: string; group?: string | null }
  | { kind: 'remove_junction'; id: string }
  | { kind: 'rename_junction'; from: string; to: string }
  | { kind: 'move_junction'; id: string; group: string | null }
  | { kind: 'add_group'; id: string; label?: string; icon?: string | null; parent?: string | null }
  | { kind: 'set_group_label'; id: string; label: string }
  | { kind: 'remove_group'; id: string }
  | { kind: 'add_edge'; from: string; to: string; fromSide: ArchitectureSide; toSide: ArchitectureSide; fromBoundary?: ArchitectureEndpointBoundary; toBoundary?: ArchitectureEndpointBoundary; label?: string | null; hasArrowStart?: boolean; hasArrowEnd?: boolean }
  | { kind: 'update_edge'; index: number; from?: string; to?: string; fromSide?: ArchitectureSide; toSide?: ArchitectureSide; fromBoundary?: ArchitectureEndpointBoundary; toBoundary?: ArchitectureEndpointBoundary; label?: string | null; hasArrowStart?: boolean; hasArrowEnd?: boolean }
  | { kind: 'remove_edge'; index?: number; id?: string }

// For content-producing edits (add_state, add_transition, move_state and
// add_floating_note), region equal to the parent's current scope
// count appends a parallel region (one for a non-concurrent composite).
// Other region-addressed operations require an existing region.
export type StateMutationOp =
  // Insert an empty region (default append); region indexes of existing
  // content shift with it. Removal requires an empty region, retaining one scope.
  | { kind: 'add_region'; parent: string; index?: number }
  | { kind: 'remove_region'; parent: string; index: number }
  | { kind: 'add_state'; id: string; label?: string | null; parent?: string | null; region?: number }
  // recursive: true removes a non-empty composite with its whole subtree
  // (default refuses, naming the flag); transitions and notes touching any
  // removed id cascade away, history references (`X[H]`) included.
  | { kind: 'remove_state'; id: string; recursive?: boolean }
  | { kind: 'rename_state'; from: string; to: string }
  | { kind: 'set_state_label'; id: string; label: string | null }
  | { kind: 'add_transition'; from: string; to: string; label?: string | null; parent?: string | null; region?: number }
  | { kind: 'remove_transition'; index?: number; from?: string; to?: string; parent?: string | null; region?: number }
  | { kind: 'set_transition_label'; index?: number; from?: string; to?: string; label: string | null; parent?: string | null; region?: number }
  | { kind: 'make_composite'; id: string; members: string[]; label?: string | null }
  // omit `state` (or pass null) to set the diagram direction; a composite id
  // sets that composite's direction override (flowchart set_direction idiom).
  | { kind: 'set_direction'; direction: import('../types.ts').Direction; state?: string | null }
  // Reparent a state (with its subtree); parent: null moves it to the top
  // level; a simple parent is promoted to a composite (add_state idiom).
  | { kind: 'move_state'; id: string; parent: string | null; region?: number }
  // Hoist a composite's children + inner transitions into its parent scope
  // and drop the shell; rejects while transitions/notes still reference it.
  | { kind: 'dissolve_composite'; id: string }
  // Note ops (class-family naming). side defaults to 'right'.
  | { kind: 'add_note'; target: string; side?: 'left' | 'right'; text: string }
  | { kind: 'remove_note'; index: number }
  | { kind: 'set_note_text'; index: number; text: string }
  | { kind: 'add_floating_note'; id: string; text: string; parent?: string | null; region?: number }
  | { kind: 'remove_floating_note'; id: string }
  | { kind: 'set_floating_note_text'; id: string; text: string }
  // State paint uses the same parser-owned CSS property grammar as flowchart.
  | { kind: 'define_class'; name: string; style: string }
  | { kind: 'set_state_class'; id: string; className: string | null }
  | { kind: 'set_state_style'; id: string; style: string | null }
  | { kind: 'set_transition_style'; index?: number; default?: boolean; style: string | null; parent?: string | null; region?: number }

export type GitGraphMutationOp =
  | { kind: 'append_commit'; id?: string; message?: string; type?: Extract<GitGraphCommitType, 'NORMAL' | 'REVERSE' | 'HIGHLIGHT'>; tags?: string[] }
  | { kind: 'create_branch'; name: string; order?: number }
  | { kind: 'checkout_branch'; name: string }
  | { kind: 'merge_branch'; name: string; id?: string; type?: Extract<GitGraphCommitType, 'NORMAL' | 'REVERSE' | 'HIGHLIGHT'>; tags?: string[] }
  | { kind: 'cherry_pick'; id: string; parent?: string; tags?: string[] }
  | { kind: 'set_commit_message'; id: string; message: string | null }
  | { kind: 'set_commit_type'; id: string; type: Extract<GitGraphCommitType, 'NORMAL' | 'REVERSE' | 'HIGHLIGHT'> }
  | { kind: 'set_commit_tags'; id: string; tags: string[] }
  | { kind: 'rename_branch'; from: string; to: string }
  | { kind: 'set_accessibility_title'; title: string | null }
  | { kind: 'set_accessibility_description'; description: string | null }

export type MindmapMutationOp =
  | { kind: 'add_node'; id: string; label: string; parent: string; shape?: MindmapShape; index?: number }
  | { kind: 'remove_node'; id: string; recursive?: boolean }
  | { kind: 'rename_node'; from: string; to: string }
  | { kind: 'set_label'; id: string; label: string }
  | { kind: 'move_node'; id: string; parent: string; index?: number }
  | { kind: 'set_shape'; id: string; shape: MindmapShape }
  | { kind: 'set_icon'; id: string; icon: string | null }
  | { kind: 'set_node_class'; id: string; className: string | null }
  | { kind: 'set_accessibility_title'; title: string | null }
  | { kind: 'set_accessibility_description'; description: string | null }

export type XyChartAxisSpec = { name?: string | null; categories?: string[]; range?: { min: number; max: number } }

export type XyChartMutationOp =
  | { kind: 'set_title'; title: string | null }
  | { kind: 'set_x_axis'; axis: XyChartAxisSpec | null }
  | { kind: 'set_y_axis'; axis: XyChartAxisSpec | null }
  | { kind: 'add_series'; kind2: 'bar' | 'line'; name?: string | null; values: number[] }
  | { kind: 'remove_series'; index: number }
  | { kind: 'set_series_values'; index: number; values: number[] }
  | { kind: 'set_series_name'; index: number; name: string | null }
  | { kind: 'reorder_series'; from: number; to: number }
  | { kind: 'set_orientation'; horizontal: boolean }
  | { kind: 'set_data_point'; seriesIndex: number; index: number; value: number }

export type PieMutationOp =
  | { kind: 'set_title'; title: string | null }
  | { kind: 'set_show_data'; showData: boolean }
  | { kind: 'add_slice'; label: string; value: number }
  | { kind: 'remove_slice'; label: string }
  | { kind: 'rename_slice'; from: string; to: string }
  | { kind: 'set_slice_value'; label: string; value: number }
  | { kind: 'reorder_slice'; from: number; to: number }

export type QuadrantMutationOp =
  | { kind: 'set_title'; title: string | null }
  | { kind: 'set_axis_labels'; axis: 'x' | 'y'; near: string | null; far?: string | null }
  | { kind: 'set_quadrant_label'; quadrant: number; label: string | null }
  | { kind: 'add_point'; label: string; x: number; y: number }
  | { kind: 'remove_point'; label: string }
  | { kind: 'move_point'; label: string; x: number; y: number }
  | { kind: 'rename_point'; from: string; to: string }

export type RadarMutationOp =
  | { kind: 'set_title'; title: string | null }
  // axes (spokes) — ordered; add/remove/rename re-shape every curve's values
  | { kind: 'add_axis'; id: string; label?: string | null; index?: number; fill?: number }
  | { kind: 'remove_axis'; id: string }
  | { kind: 'rename_axis'; from: string; to: string }
  | { kind: 'set_axis_label'; id: string; label: string | null }
  | { kind: 'reorder_axis'; from: number; to: number }
  // curves (series)
  | { kind: 'add_curve'; id: string; label?: string | null; values: number[]; index?: number }
  | { kind: 'remove_curve'; id: string }
  | { kind: 'set_curve_values'; id: string; values: number[] }
  | { kind: 'set_curve_value'; curve: string; axis: string; value: number }
  | { kind: 'set_curve_label'; id: string; label: string | null }
  | { kind: 'rename_curve'; from: string; to: string }
  | { kind: 'reorder_curve'; from: number; to: number }
  // scale + display config
  | { kind: 'set_config'; max?: number | null; min?: number | null; ticks?: number | null; graticule?: 'circle' | 'polygon' | null; showLegend?: boolean | null }

export type SankeyMutationOp =
  // Links are addressed by (source, target); `occurrence` (default 0)
  // disambiguates parallel duplicate rows in authored order.
  | { kind: 'add_link'; source: string; target: string; value: number; index?: number }
  | { kind: 'remove_link'; source: string; target: string; occurrence?: number }
  | { kind: 'set_link_value'; source: string; target: string; value: number; occurrence?: number }
  // Renames every source/target occurrence; rejects when `to` already exists
  // (labels are node identity, so a collision would silently merge flows).
  | { kind: 'rename_node'; from: string; to: string }

export type GanttMutationOp =
  | { kind: 'set_title'; title: string | null }
  | { kind: 'add_section'; label: string }
  | { kind: 'rename_section'; index: number; label: string }
  | { kind: 'remove_section'; index: number }
  | { kind: 'add_task'; sectionIndex: number; label: string; taskId?: string; tags?: GanttBodyTaskTag[]; start?: string; end: string; index?: number }
  | { kind: 'remove_task'; sectionIndex: number; taskIndex: number }
  | { kind: 'rename_task'; sectionIndex: number; taskIndex: number; label: string }
  | { kind: 'set_task_status'; sectionIndex: number; taskIndex: number; status: 'active' | 'done' | 'crit' | null }
  | { kind: 'set_task_dates'; sectionIndex: number; taskIndex: number; start?: string | null; end?: string }
  // Structural-tag toggles after creation (set_task_status never touches them).
  | { kind: 'set_task_flags'; sectionIndex: number; taskIndex: number; milestone?: boolean; vert?: boolean }
  // Renames REWRITE structured after/until references (coherence by
  // construction); they REJECT while the id is referenced from opaque
  // segments, and `null` rejects while ANY reference exists.
  | { kind: 'set_task_id'; sectionIndex: number; taskIndex: number; taskId: string | null }
  // Gantt source order IS scheduling semantics (implicit starts chain from the
  // previous task), so moves REJECT prescriptively whenever they would change
  // any implicit-start task's predecessor instead of silently rescheduling it.
  | { kind: 'move_task'; fromSection: number; fromIndex: number; toSection: number; toIndex: number }
  | { kind: 'move_section'; from: number; to: number }

export type AnyMutationOp =
  | SwimlaneMutationOp | FlowchartMutationOp
  | AgentflowMutationOp
  | UsecaseMutationOp
  | WardleyMutationOp
  | VennMutationOp
  | CynefinMutationOp
  | RailroadMutationOp
  | TreeviewMutationOp
  | StateMutationOp
  | SequenceMutationOp
  | TimelineMutationOp
  | ClassMutationOp
  | ErMutationOp
  | JourneyMutationOp
  | ArchitectureMutationOp
  | XyChartMutationOp
  | PieMutationOp
  | QuadrantMutationOp
  | GanttMutationOp
  | MindmapMutationOp
  | GitGraphMutationOp
  | RadarMutationOp
  | SankeyMutationOp
  | C4MutationOp
  | PacketMutationOp
  | KanbanMutationOp
  | RequirementMutationOp
  | TreemapMutationOp
  | IshikawaMutationOp
  | BlockMutationOp
  | EventModelingMutationOp
  | ZenUMLMutationOp

// ---- Branded Finite -------------------------------------------------------

declare const FINITE_BRAND: unique symbol
export type Finite = number & { readonly [FINITE_BRAND]: true }

export function toFinite(n: number): Finite {
  if (!Number.isFinite(n)) throw new RangeError(`expected a finite number, got ${String(n)}`)
  return n as Finite
}

// ---- Verify ---------------------------------------------------------------

export type WarningSeverity = 'error' | 'warning'
export type WarningTier = 'structural' | 'geometric' | 'lint'
/** Who can fix a finding: the authored diagram source, its configuration
 * (Mermaid config, theme, render options), or Agentic Mermaid itself. */
export type WarningOrigin = 'source' | 'config' | 'engine'

export type Tier1WarningCode = 'EMPTY_DIAGRAM' | 'EDGE_MISANCHORED' | 'OFF_CANVAS' | 'GROUP_BREACH' | 'UNKNOWN_SHAPE' | 'LABEL_OVERFLOW' | 'UNRESOLVABLE_SCHEDULE' | 'RENDER_FAILED' | 'INTERNAL_ERROR'
export type Tier2WarningCode = 'NODE_OVERLAP' | 'CONTENT_OCCLUDED' | 'LAYOUT_LIMIT_EXCEEDED' | 'ROUTE_SELF_CROSS' | 'ROUTE_HITCH' | 'ROUTE_UNEXPLAINED_BEND' | 'ROUTE_LABEL_ON_SHARED_TRUNK' | 'ROUTE_SELF_LOOP_OCCUPANCY' | 'ROUTE_CONTAINER_MISANCHOR' | 'ROUTE_SHAPE_MISANCHOR' | 'ROUTE_STALE_AFTER_NODE_MOVE'
/**
 * Tier 3 (advisory lint). Family-specific quality hints for common agent
 * mistakes that still parse and render. Lint warnings never flip verify.ok.
 */
export type Tier3WarningCode =
  | 'DUPLICATE_EDGE'
  | 'UNREACHABLE_NODE'
  | 'DECISION_BRANCH_UNLABELED'
  | 'FLOW_IMBALANCE'
  | 'VENN_APPROXIMATION'
  | 'COMMENT_DROPPED'
  | 'UNSUPPORTED_SYNTAX'
  | 'CONTENT_DROPPED_ON_ROUNDTRIP'
  | 'EVENT_SOURCE_TYPE'
  | 'INEFFECTIVE_CONFIG'
  | 'LOW_CONTRAST'
  | 'LABELS_HIDDEN'
  | 'SCALE_RANGE_EXCLUDES_ZERO'
  | 'BAR_RANGE_EXCLUDES_ZERO'
  | 'VALUES_OUTSIDE_RANGE'
  | typeof BRAND_CONSTRAINT_WARNING_POLICY.warn.code
export type WarningCode = Tier1WarningCode | Tier2WarningCode | Tier3WarningCode | BrandConstraintWarningCode

export type LayoutWarning =
  | { code: 'VENN_APPROXIMATION'; message: string }
  | { code: 'EMPTY_DIAGRAM' }
  | { code: 'EDGE_MISANCHORED'; edge: EdgeId; from?: NodeId; to?: NodeId }
  | { code: 'OFF_CANVAS'; target: NodeId | EdgeId; axis: 'x' | 'y' }
  | { code: 'GROUP_BREACH'; group: GroupId; member: NodeId }
  | { code: 'UNKNOWN_SHAPE'; node: NodeId; shape: string }
  | { code: 'LABEL_OVERFLOW'; target: NodeId | EdgeId; charCount: number; limit: number }
  /**
   * The diagram parses (and round-trips) but its semantics cannot resolve, so
   * rendering will fail loudly — e.g. a Gantt whose schedule hits a bad
   * calendar date, a dependency cycle, or an everything-excluded calendar.
   * `reason` carries the named renderer error (GANTT_*…). Closes the
   * "verify ok but render throws" seam for structured gantt bodies.
   */
  | { code: 'UNRESOLVABLE_SCHEDULE'; reason: string }
  /**
   * The diagram parses on the agent side (possibly with unmodeled syntax
   * preserved verbatim) but the STRICT render parser throws on its canonical
   * source — `am render` would exit 4. Generalizes UNRESOLVABLE_SCHEDULE's
   * "verify ok but render throws" seam-closing to every family: found live
   * when onboarding agents followed verify-before-commit and still shipped
   * unrenderable quadrant/architecture diagrams. `reason` carries the
   * renderer's error message; `origin` says whether the source or its
   * configuration caused it (an engine defect is INTERNAL_ERROR instead).
   */
  | { code: 'RENDER_FAILED'; reason: string; origin: Exclude<WarningOrigin, 'engine'> }
  /**
   * Agentic Mermaid hit an internal defect while drawing this source; the
   * source did not cause it. `defaultRender` records whether an ordinary
   * render of the same request still produces output (`succeeds-unchecked`:
   * only verify's extra consistency checks failed, so the layout evidence
   * cannot be trusted) or throws (`fails`).
   */
  | { code: 'INTERNAL_ERROR'; reason: string; defaultRender: 'fails' | 'succeeds-unchecked' }
  | { code: 'NODE_OVERLAP'; a: NodeId; b: NodeId; areaPx: number }
  /** Final measured paint hides authored text or an interaction marker. */
  | { code: 'CONTENT_OCCLUDED'; target: string; feature: 'label' | 'marker'; line?: number; message: string }
  /** Content remains intact but cannot fit an explicitly requested layout budget. */
  | { code: 'LAYOUT_LIMIT_EXCEEDED'; constraint: string; message: string }
  | { code: 'ROUTE_SELF_CROSS'; edge: EdgeId; count: number }
  | { code: 'ROUTE_HITCH'; edge: EdgeId; deviationPx: number }
  | { code: 'ROUTE_UNEXPLAINED_BEND'; edge: EdgeId }
  | { code: 'ROUTE_LABEL_ON_SHARED_TRUNK'; edge: EdgeId; sharedWith: EdgeId }
  | { code: 'ROUTE_SELF_LOOP_OCCUPANCY'; edge: EdgeId; conflictWith?: EdgeId; kind: 'allocation' | 'side' | 'boundary' | 'route-route' | 'label-label' | 'label-route' }
  | { code: 'ROUTE_CONTAINER_MISANCHOR'; edge: EdgeId; container: GroupId }
  | { code: 'ROUTE_SHAPE_MISANCHOR'; edge: EdgeId; node: NodeId }
  | { code: 'ROUTE_STALE_AFTER_NODE_MOVE'; edge: EdgeId; node: NodeId }
  | { code: 'DUPLICATE_EDGE'; edge: EdgeId; duplicateOf: EdgeId; from: NodeId; to: NodeId; label?: string }
  | { code: 'UNREACHABLE_NODE'; node: NodeId }
  | { code: 'DECISION_BRANCH_UNLABELED'; node: NodeId; edge: EdgeId }
  /**
   * A sankey intermediate node (one with both inflow and outflow) receives a
   * different total than it emits. Conservation across stages is the domain's
   * defining property — the ribbon widths are an account — and an imbalance
   * renders silently as node height `max(in, out)`, hiding the unaccounted
   * quantity. Advisory lint (real datasets carry rounding drift); never flips
   * verify.ok.
   */
  | { code: 'FLOW_IMBALANCE'; node: NodeId; inflow: number; outflow: number; message: string }
  | { code: 'COMMENT_DROPPED'; count: number; lines: number[] }
  | { code: 'UNSUPPORTED_SYNTAX'; line?: number; syntax: string; node?: NodeId; message: string }
  /**
   * Structured content was lost across a parse → serialize → re-parse cycle:
   * the {nodes, edges, groups} tally changed, so canonical serialization is
   * silently dropping (or duplicating) a node/edge/group even though the bytes
   * may re-parse. The faithfulness analogue of COMMENT_DROPPED — "100% parse
   * success is not faithfulness" (Loop 17). Lint, never flips verify.ok.
   */
  | { code: 'CONTENT_DROPPED_ON_ROUNDTRIP'; before: { nodes: number; edges: number; groups: number }; after: { nodes: number; edges: number; groups: number } }
  /**
   * A Mermaid config field was accepted (for config-shape compatibility) but
   * has no effect on this family's geometry or paint — e.g. Journey's
   * sequence-era fields. Accepting-and-ignoring silently misleads migrating
   * users; this lint says so. Never flips verify.ok.
   */
  | { code: 'EVENT_SOURCE_TYPE'; node: NodeId; source: NodeId; message: string }
  | { code: 'INEFFECTIVE_CONFIG'; field: string; message: string }
  /** Authored paint remains authoritative but fails a measurable contrast
   * threshold against the final resolved background. Advisory: never repaints. */
  | { code: 'LOW_CONTRAST'; field: string; foreground: string; background: string; ratio: number; minimum: number; message: string }
  /**
   * The layout left out chart text the source asked for because it did not
   * fit: x-axis category names thinned or dropped, or bar value labels with no
   * room inside or beyond their bar. `labels` lists exactly what is missing.
   * Advisory: the chart still renders; never flips verify.ok.
   */
  | { code: 'LABELS_HIDDEN'; target: 'title' | 'legend' | 'x-axis' | 'data-labels' | 'point-labels'; labels: string[]; message: string }
  /**
   * An authored value-axis range excludes zero on a chart with bar series, so
   * bars start at `baseline` and their lengths are not proportional to their
   * values. Advisory: the authored range is kept; never flips verify.ok.
   */
  | { code: 'SCALE_RANGE_EXCLUDES_ZERO'; range: { min: number; max: number }; baseline: number; message: string }
  | { code: 'BAR_RANGE_EXCLUDES_ZERO'; range: { min: number; max: number }; baseline: number; message: string }
  /**
   * A series has values outside the authored value-axis range. A bar stops at
   * the edge of the range, so its length understates the value; a line point
   * is drawn past the plot. `values` lists every such value of the series.
   * Advisory: the authored range is kept; never flips verify.ok.
   */
  | { code: 'VALUES_OUTSIDE_RANGE'; series: string; values: number[]; range: { min: number; max: number }; message: string }
  | {
      code: BrandConstraintWarningCode
      constraint: BrandConstraintKind
      measurement: 'measurable' | 'unmeasurable' | 'not-applicable'
      role?: string
      mark?: string
      foreground?: string
      background?: string
      ratio?: number
      minimum?: number
      actual?: number
      maximum?: number
      message: string
    }

export const WARNING_SEVERITY: Record<WarningCode, WarningSeverity> = {
  VENN_APPROXIMATION: 'warning',
  EMPTY_DIAGRAM: 'error',
  UNRESOLVABLE_SCHEDULE: 'error',
  RENDER_FAILED: 'error',
  INTERNAL_ERROR: 'error',
  [BRAND_CONSTRAINT_WARNING_POLICY.error.code]: BRAND_CONSTRAINT_WARNING_POLICY.error.severity,
  EDGE_MISANCHORED: 'error',
  OFF_CANVAS: 'error',
  GROUP_BREACH: 'error',
  UNKNOWN_SHAPE: 'warning',
  LABEL_OVERFLOW: 'warning',
  NODE_OVERLAP: 'warning',
  CONTENT_OCCLUDED: 'error',
  LAYOUT_LIMIT_EXCEEDED: 'warning',
  ROUTE_SELF_CROSS: 'warning',
  ROUTE_HITCH: 'warning',
  ROUTE_UNEXPLAINED_BEND: 'warning',
  ROUTE_LABEL_ON_SHARED_TRUNK: 'warning',
  ROUTE_SELF_LOOP_OCCUPANCY: 'warning',
  ROUTE_CONTAINER_MISANCHOR: 'warning',
  ROUTE_SHAPE_MISANCHOR: 'warning',
  ROUTE_STALE_AFTER_NODE_MOVE: 'warning',
  DUPLICATE_EDGE: 'warning',
  UNREACHABLE_NODE: 'warning',
  DECISION_BRANCH_UNLABELED: 'warning',
  FLOW_IMBALANCE: 'warning',
  COMMENT_DROPPED: 'warning',
  UNSUPPORTED_SYNTAX: 'warning',
  CONTENT_DROPPED_ON_ROUNDTRIP: 'warning',
  EVENT_SOURCE_TYPE: 'warning',
  INEFFECTIVE_CONFIG: 'warning',
  LOW_CONTRAST: 'warning',
  LABELS_HIDDEN: 'warning',
  SCALE_RANGE_EXCLUDES_ZERO: 'warning',
  BAR_RANGE_EXCLUDES_ZERO: 'warning',
  VALUES_OUTSIDE_RANGE: 'warning',
  [BRAND_CONSTRAINT_WARNING_POLICY.warn.code]: BRAND_CONSTRAINT_WARNING_POLICY.warn.severity,
}

export const WARNING_TIER: Record<WarningCode, WarningTier> = {
  VENN_APPROXIMATION: 'lint',
  EMPTY_DIAGRAM: 'structural',
  UNRESOLVABLE_SCHEDULE: 'structural',
  RENDER_FAILED: 'structural',
  INTERNAL_ERROR: 'structural',
  [BRAND_CONSTRAINT_WARNING_POLICY.error.code]: BRAND_CONSTRAINT_WARNING_POLICY.error.tier,
  EDGE_MISANCHORED: 'structural',
  OFF_CANVAS: 'structural',
  GROUP_BREACH: 'structural',
  UNKNOWN_SHAPE: 'structural',
  LABEL_OVERFLOW: 'structural',
  NODE_OVERLAP: 'geometric',
  CONTENT_OCCLUDED: 'geometric',
  LAYOUT_LIMIT_EXCEEDED: 'geometric',
  ROUTE_SELF_CROSS: 'geometric',
  ROUTE_HITCH: 'geometric',
  ROUTE_UNEXPLAINED_BEND: 'geometric',
  ROUTE_LABEL_ON_SHARED_TRUNK: 'geometric',
  ROUTE_SELF_LOOP_OCCUPANCY: 'geometric',
  ROUTE_CONTAINER_MISANCHOR: 'geometric',
  ROUTE_SHAPE_MISANCHOR: 'geometric',
  ROUTE_STALE_AFTER_NODE_MOVE: 'geometric',
  DUPLICATE_EDGE: 'lint',
  UNREACHABLE_NODE: 'lint',
  DECISION_BRANCH_UNLABELED: 'lint',
  FLOW_IMBALANCE: 'lint',
  COMMENT_DROPPED: 'lint',
  UNSUPPORTED_SYNTAX: 'lint',
  CONTENT_DROPPED_ON_ROUNDTRIP: 'lint',
  EVENT_SOURCE_TYPE: 'lint',
  INEFFECTIVE_CONFIG: 'lint',
  LOW_CONTRAST: 'lint',
  LABELS_HIDDEN: 'lint',
  SCALE_RANGE_EXCLUDES_ZERO: 'lint',
  BAR_RANGE_EXCLUDES_ZERO: 'lint',
  VALUES_OUTSIDE_RANGE: 'lint',
  [BRAND_CONSTRAINT_WARNING_POLICY.warn.code]: BRAND_CONSTRAINT_WARNING_POLICY.warn.tier,
}

export const DEFAULT_LABEL_CHAR_CAP = 40

export interface VerifyOptions {
  suppress?: WarningCode[]
  labelCharCap?: number
  /** Shared source/config/geometry/appearance options used by render parity and layout evidence. */
  renderOptions?: RenderOptions
}

/**
 * Semantic region vocabulary shared by layout/action surfaces. `group` is the
 * compatibility fallback; built-in families use the more precise container
 * kinds wherever their layout model can prove one.
 */
export type RenderedRegionKind = 'node' | 'edge' | 'label' | 'canvas' | 'group' | 'cluster' | 'lane' | 'band' | 'compartment' | 'plot' | 'ring'

export interface RenderedRegion {
  id: string
  kind: RenderedRegionKind
  elementId?: string
  parentId?: string
  bounds: { x: Finite; y: Finite; w: Finite; h: Finite }
  /** Exact occupied terminal cells; repeated occurrences need not form one rectangle. */
  cellSpans?: Array<{ row: number; start: number; end: number }>
  /** Semantic route cells occluded by opaque chart marks; excluded from visible cellSpans. */
  occludedCellSpans?: Array<{ row: number; start: number; end: number }>
  sourceLine?: number
}

/** Retained bounds in the renderer's pixel coordinate system. */
export interface RenderedLabelBounds {
  x: Finite
  y: Finite
  w: Finite
  h: Finite
}

/** Painted text independent of a semantic node, such as chart ticks or titles. */
export interface RenderedLayoutLabel {
  id: string
  text: string
  bounds?: RenderedLabelBounds
  container?: RenderedLabelBounds
  visibility?: 'visible' | 'hidden' | 'semantic'
}

export interface RenderedLayoutNode {
  id: NodeId
  /** Authored immediate container, supplied by families with a typed hierarchy. */
  parentId?: GroupId
  x: Finite
  y: Finite
  w: Finite
  h: Finite
  shape: string
  label?: string
  /** Actual prepared visible text; absent when an extension did not retain measurement. */
  labelBounds?: RenderedLabelBounds
  /** Available text region; external mark labels use the canvas rather than the mark. */
  labelContainer?: RenderedLabelBounds
  /** Hidden text and semantic-only mark metadata are not unmeasured visible labels. */
  labelVisibility?: 'visible' | 'hidden' | 'semantic'
  /** Authored chart coordinates, retained before pixel rounding. */
  dataPosition?: { x: Finite; y: Finite }
  /** Explicit semantic role for family-generic quality scoring. Shape is paint,
   *  not semantics: a rectangular bar is a mark, not a node box. */
  role?: 'box' | 'mark' | 'labelled-mark'
}
export interface RenderedLayoutEdge {
  /** Lexical fragment that owns this relation, when the family retains scopes. */
  parentId?: GroupId
  id: EdgeId
  from: NodeId
  to: NodeId
  path: [Finite, Finite][]
  /** Hidden structural routes do not contribute visible crossing metrics. Omitted means visible. */
  visibility?: 'visible' | 'hidden'
  label?: { x: Finite; y: Finite; text: string; bounds?: RenderedLabelBounds }
  /** Edge route certificate; present only under layoutMermaid(d, { debug: true }) for families with an edge certificate model. */
  route?: EdgeRouteCertificate
}
export interface RenderedLayoutGroup {
  id: GroupId
  x: Finite
  y: Finite
  w: Finite
  h: Finite
  members: NodeId[]
  label?: string
  /** Parent group id for flattened region-tree consumers; undefined means root-level group. */
  parentId?: GroupId
  /** Semantic region kind used by the renderer/action sidecar. */
  regionKind?: Exclude<RenderedRegionKind, 'node' | 'edge' | 'label' | 'canvas'>
}
export interface RenderedLayout {
  /** Bounded native paint evidence, included by debug layout projection. */
  paintCertification?: import('../scene/paint-certification.ts').PaintLayoutCertification
  version: 1
  /** Open family id so registered extensions can expose the same layout envelope. */
  kind: FamilyId
  nodes: RenderedLayoutNode[]
  edges: RenderedLayoutEdge[]
  groups: RenderedLayoutGroup[]
  /** Retained painted text that does not create a semantic node or data mark. */
  labels?: RenderedLayoutLabel[]
  /** Region-containment certificates for non-edge invariants; present only under layoutMermaid(d, { debug: true }). */
  certificates?: RegionContainmentCertificate[]
  /** Optional region sidecar for renderer/action alignment; debug-only in layoutMermaid V1. */
  regions?: RenderedRegion[]
  /** Optional source-only actions aligned to region ids; debug-only in layoutMermaid V1. */
  actions?: DiagramActionRecord[]
  bounds: { w: Finite; h: Finite }
}

export interface VerificationChecks {
  renderability: 'passed' | 'failed' | 'not-checked'
  /** No detected loss is not a general losslessness proof. */
  sourceLoss: 'detected' | 'not-detected'
  taskCorrectness: 'not-checked'
}

export interface VerifyResult {
  /** Explicit check scope; ok remains the backward-compatible error gate. */
  checks?: VerificationChecks
  /** Final graphical proof or its explicit coverage limitations. */
  layoutCertification?: import('../scene/paint-certification.ts').PaintLayoutCertification
  ok: boolean
  warnings: LayoutWarning[]
  layout: RenderedLayout
}

// ---- synthesizeFromGraph payload -----------------------------------------

export interface SerializedFlowchartGraph {
  direction: import('../types.ts').Direction
  nodes: Record<string, import('../types.ts').MermaidNode> | Array<[string, import('../types.ts').MermaidNode]>
  edges?: import('../types.ts').MermaidEdge[]
  // Loose by design: payloads built from the SDK-declared shape may omit
  // `children`/`direction` on subgraphs, or styling maps entirely.
  // synthesizeFromGraph normalizes all of these defensively.
  subgraphs?: unknown
  classDefs?: unknown
  classAssignments?: unknown
  nodeStyles?: unknown
  linkStyles?: unknown
  linkCurves?: unknown
}

export interface ValidDiagramPayload {
  kind: DiagramKind | ExternalFamilyId
  descriptorIdentity?: import('../shared/extension-identity.ts').ExtensionIdentity<'family'>
  canonicalSource?: string
  meta?: Partial<ValidDiagramMeta>
  body:
    | { kind: 'flowchart'; graph: SerializedFlowchartGraph }
    | (Omit<AgentflowBody, 'graph' | 'metadata' | 'roles' | 'connectors' | 'globals'> & {
        graph: SerializedFlowchartGraph | import('../types.ts').MermaidGraph
        metadata: AgentflowBody['metadata'] | Record<string, Record<string, unknown>> | Array<[string, Record<string, unknown>]>
        roles: AgentflowBody['roles'] | Record<string, import('../agentflow/types.ts').AgentflowRole> | Array<[string, import('../agentflow/types.ts').AgentflowRole]>
        connectors: Set<string> | string[]
        globals: Set<string> | string[]
      })
    | UsecaseBody
    | WardleyBody
    | VennBody
    | CynefinBody
    | RailroadBody
    | { kind: 'swimlane'; graph: SerializedFlowchartGraph | import('../types.ts').MermaidGraph }
    | TreeviewBody
    | StateBody
    | SequenceBody
    | TimelineBody
    | ClassBody
    | ErBody
    | JourneyBody
    | ArchitectureBody
    | XyChartBody
    | PieBody
    | QuadrantBody
    | GanttBody
    | MindmapBody
    | GitGraphBody
    | RadarBody
    | SankeyBody
    | C4Body
    | PacketBody
    | KanbanBody
    | RequirementBody
    | TreemapBody
    | IshikawaBody
    | BlockBody
    | EventModelingBody
    | ZenUMLBody
    | ExtensionDiagramBody
    | { kind: 'opaque'; family: DiagramKind; source: string; diagnostic?: { code: 'GITGRAPH_DUPLICATE_COMMIT_ID'; id: string } }
}

export function asEventModeling(d: ParsedDiagram): EventModelingValidDiagram | null {
  return d.body.kind === 'eventmodeling' ? d as EventModelingValidDiagram : null
}

export function asZenUML(d: ParsedDiagram): ZenUMLValidDiagram | null {
  return d.body.kind === 'zenuml' ? d as ZenUMLValidDiagram : null
}

export type AgentflowValidDiagram = ValidDiagram & { body: AgentflowBody }
export function asAgentflow(d: ParsedDiagram): AgentflowValidDiagram | null {
  return d.body.kind === 'agentflow' ? d as AgentflowValidDiagram : null
}

export type UsecaseValidDiagram = ValidDiagram & { body: UsecaseBody }
export function asUsecase(d: ParsedDiagram): UsecaseValidDiagram | null {
  return d.body.kind === 'usecase' ? d as UsecaseValidDiagram : null
}

export type WardleyValidDiagram = ValidDiagram & { body: WardleyBody }
export function asWardley(d: ParsedDiagram): WardleyValidDiagram | null {
  return d.body.kind === 'wardley' ? d as WardleyValidDiagram : null
}

export type VennValidDiagram = ValidDiagram & { body: VennBody }
export function asVenn(d: ParsedDiagram): VennValidDiagram | null {
  return d.body.kind === 'venn' ? d as VennValidDiagram : null
}

export type CynefinValidDiagram = ValidDiagram & { body: CynefinBody }
export function asCynefin(d: ParsedDiagram): CynefinValidDiagram | null { return d.body.kind === 'cynefin' ? d as CynefinValidDiagram : null }

export type RailroadValidDiagram = ValidDiagram & { body: RailroadBody }
export function asRailroad(d: ParsedDiagram): RailroadValidDiagram | null { return d.body.kind === 'railroad' ? d as RailroadValidDiagram : null }
