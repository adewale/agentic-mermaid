// ============================================================================
// Agentic Mermaid — IR and verb types (v4)
//
// v4 removes the seed/RNG/clock/font-metric apparatus that the empirical
// probe proved was theater (ELK is already deterministic; seeding changed
// nothing). The only verify knob is labelCharCap. See AGENT_NATIVE.md § (1).
// ============================================================================

import type { MermaidGraph, NodeShape, EdgeStyle, RouteCertificate } from '../types.ts'
import type { MermaidFrontmatterMap, MermaidConfigMap } from '../mermaid-source.ts'

// ---- Result ---------------------------------------------------------------

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }
export function ok<T, E = never>(value: T): Result<T, E> { return { ok: true, value } }
export function err<E, T = never>(error: E): Result<T, E> { return { ok: false, error } }

// ---- Families -------------------------------------------------------------

export type DiagramKind =
  | 'flowchart' | 'state' | 'sequence' | 'class' | 'er'
  | 'timeline' | 'journey' | 'xychart' | 'architecture' | 'pie' | 'quadrant' | 'gantt'

// ---- Sequence body --------------------------------------------------------

export interface SequenceParticipant {
  id: string
  label: string
  kind: 'participant' | 'actor'
}

export type SequenceMessageStyle =
  | 'sync'          // ->>
  | 'reply'         // -->>
  | 'async'         // ->
  | 'async-dashed'  // -->
  | 'lost'          // -x
  | 'lost-dashed'   // --x

export interface SequenceMessage {
  from: string
  to: string
  text: string
  style: SequenceMessageStyle
}

// BUILD-18: ordered statement list. Refs index into the participants/messages
// arrays (which remain the canonical views the SDK declaration, synthesize
// payloads, describe, verify, and tests consume). Opaque-block segments carry
// unmodeled lines (Note/alt/loop/par/activate/autonumber/title…) VERBATIM so
// they ride along in their original position. Messages/participants INSIDE an
// opaque-block are invisible to mutation ops and the messages/participants
// arrays — only top-level structured statements are addressable.
export type SequenceStatement =
  | { kind: 'participant'; ref: number }   // index into participants
  | { kind: 'message'; ref: number }       // index into messages
  | { kind: 'opaque-block'; lines: string[] }

export interface SequenceBody {
  kind: 'sequence'
  participants: SequenceParticipant[]
  messages: SequenceMessage[]
  // Optional for back-compat: synthesizeFromGraph payloads and hand-built
  // bodies may omit it; the serializer falls back to participants-then-messages
  // ordering when absent. Parsed bodies always populate it.
  statements?: SequenceStatement[]
}

// ---- Timeline body --------------------------------------------------------

export interface TimelineEvent {
  /** Stable within one parse; recomputed each parse. Not a durable identifier. */
  id: string
  text: string
}

export interface TimelinePeriod {
  id: string
  /** The temporal label (e.g., "2020", "Q1 2024"). */
  label: string
  events: TimelineEvent[]
}

export interface TimelineSection {
  id: string
  /** Undefined = implicit/ungrouped section. */
  label?: string
  periods: TimelinePeriod[]
}

export interface TimelineBody {
  kind: 'timeline'
  title?: string
  sections: TimelineSection[]
}

// ---- Journey body ----------------------------------------------------------

export interface JourneyTask {
  /** Stable within one parse; recomputed each parse. Not a durable identifier. */
  id: string
  text: string
  /** Satisfaction score, integer 1..5 (Mermaid journey convention). */
  score: number
  actors: string[]
}

export interface JourneySection {
  id: string
  /** Undefined = implicit/ungrouped section. */
  label?: string
  tasks: JourneyTask[]
}

export interface JourneyBody {
  kind: 'journey'
  title?: string
  sections: JourneySection[]
}

// ---- Class diagram body ---------------------------------------------------

export type ClassRelationKind =
  | 'inheritance'    // <|--
  | 'composition'    // *--
  | 'aggregation'    // o--
  | 'association'    // -->  (or --)
  | 'dependency'     // ..>
  | 'realization'    // ..|>
  | 'link-solid'     // --
  | 'link-dashed'    // ..

export interface ClassNode {
  /** The bare class name (e.g., 'Animal'). */
  id: string
  /** Optional display label (e.g., from `class X["My Label"]` or `class X as "..."`). */
  label?: string
  /** Members, each as the raw source string ('+String name', '+eat()', '<<interface>>'). */
  members: string[]
}

export interface ClassRelation {
  from: string
  to: string
  kind: ClassRelationKind
  /** Optional relationship label, e.g., from `A --> B : uses`. */
  label?: string
  /** Optional cardinality on the `from` side (e.g., '"1"'). */
  fromCardinality?: string
  /** Optional cardinality on the `to` side. */
  toCardinality?: string
}

export interface ClassNote {
  text: string
  /** Class id the note is attached to (undefined = freestanding). */
  for?: string
}

export interface ClassBody {
  kind: 'class'
  title?: string
  classes: ClassNode[]
  relations: ClassRelation[]
  notes: ClassNote[]
}

// ---- ER body --------------------------------------------------------------

export type ErCardinality =
  | 'one-only'         // ||
  | 'zero-or-one'      // |o or o|
  | 'zero-or-many'     // }o or o{
  | 'one-or-many'      // }| or |{

export interface ErAttribute {
  /** The full source line (e.g., 'string name PK "comment"'). */
  text: string
}

export interface ErEntity {
  id: string
  attributes: ErAttribute[]
}

export interface ErRelation {
  from: string
  to: string
  leftCard: ErCardinality
  rightCard: ErCardinality
  /** Solid (--) or dashed (..) line. */
  dashed: boolean
  label?: string
}

export interface ErBody {
  kind: 'er'
  entities: ErEntity[]
  relations: ErRelation[]
}

// ---- Architecture body -----------------------------------------------------

export type ArchitectureSide = 'L' | 'R' | 'T' | 'B'

export interface ArchitectureGroup {
  id: string
  label: string
  icon?: string
  /** Undefined = root (not nested in another group). */
  parentId?: string
}

export interface ArchitectureService {
  id: string
  label: string
  icon?: string
  /** Undefined = ungrouped (not inside a group). */
  parentId?: string
}

export interface ArchitectureJunction {
  id: string
  parentId?: string
}

export interface ArchitectureEndpoint {
  id: string
  side: ArchitectureSide
}

export interface ArchitectureEdge {
  source: ArchitectureEndpoint
  target: ArchitectureEndpoint
  label?: string
  hasArrowStart: boolean
  hasArrowEnd: boolean
}

export interface ArchitectureBody {
  kind: 'architecture'
  groups: ArchitectureGroup[]
  services: ArchitectureService[]
  junctions: ArchitectureJunction[]
  edges: ArchitectureEdge[]
}

// ---- XY chart body ---------------------------------------------------------

/** A single chart axis: an optional bare-text name plus EITHER categorical
 *  labels (x-axis only) OR a numeric range. All three fields are optional;
 *  a structured axis carries at least one of them. */
export interface XyChartAxis {
  /** Optional bare-text axis name/title. */
  name?: string
  /** Categorical labels (x-axis only) — mutually exclusive with range. */
  categories?: string[]
  /** Numeric range — mutually exclusive with categories. */
  range?: { min: number; max: number }
}

export interface XyChartSeries {
  /** Stable within one parse; recomputed each parse. Not a durable identifier. */
  id: string
  kind: 'bar' | 'line'
  /** Optional bare-text series name. */
  name?: string
  /** Data values; all finite. */
  values: number[]
}

export interface XyChartBody {
  kind: 'xychart'
  title?: string
  /** Header orientation suffix: `xychart-beta horizontal`. Default vertical. */
  horizontal?: boolean
  xAxis?: XyChartAxis
  yAxis?: XyChartAxis
  series: XyChartSeries[]
}

// ---- Pie body ---------------------------------------------------------------

export interface PieSlice {
  /** Stable within one parse; recomputed each parse. Not a durable identifier. */
  id: string
  /** The slice label (contents of the `"..."` quotes). */
  label: string
  /** The slice value — a positive finite number. */
  value: number
}

export interface PieBody {
  kind: 'pie'
  title?: string
  /** When true (`pie showData`), the legend shows each slice's numeric value. */
  showData: boolean
  /** Slices in source order (drawn clockwise). */
  slices: PieSlice[]
}

// ---- Quadrant body ----------------------------------------------------------

/** Axis label pair. The "far" side is optional in the grammar. */
export interface QuadrantAxis {
  /** x-axis: left label / y-axis: bottom label. */
  near: string
  /** x-axis: right label / y-axis: top label. Optional. */
  far?: string
}

export interface QuadrantPoint {
  label: string
  /** Normalized x in [0, 1] (0 = left, 1 = right). */
  x: number
  /** Normalized y in [0, 1] (0 = bottom, 1 = top). */
  y: number
}

export interface QuadrantBody {
  kind: 'quadrant'
  title?: string
  xAxis?: QuadrantAxis
  yAxis?: QuadrantAxis
  /**
   * Quadrant region labels indexed 1..4 by Mermaid's numbering:
   *   1 = top-right, 2 = top-left, 3 = bottom-left, 4 = bottom-right.
   * Stored 0-based where index `n-1` holds quadrant-`n`.
   */
  quadrants: [string?, string?, string?, string?]
  /** Plotted points in source order. */
  points: QuadrantPoint[]
}

// ---- Gantt body --------------------------------------------------------------

export type GanttBodyTaskTag = 'active' | 'done' | 'crit' | 'milestone' | 'vert'

export interface GanttBodyTask {
  /** Stable within one parse; recomputed each parse. Not a durable identifier. */
  id: string
  /** Mermaid task id from `:id, start, end` — referenced by after/until/click. */
  taskId?: string
  label: string
  /** Status/shape tags in canonical order (active/done/crit/milestone/vert). */
  tags: GanttBodyTaskTag[]
  /** Raw start expression: a date in the diagram's dateFormat or `after id…`.
   *  Undefined = starts when the previous task ends (Mermaid default). */
  start?: string
  /** Raw end expression: a date, a duration token (`3d`), or `until id…`. */
  end: string
}

export interface GanttBodySection {
  id: string
  /** Undefined = implicit/ungrouped section. */
  label?: string
  tasks: GanttBodyTask[]
}

/**
 * Segment-preserving statement list (the sequence-body pattern): typed ops see
 * sections/tasks/title; calendar directives (dateFormat, excludes, weekend…),
 * click lines, comments, and markers ride along VERBATIM as opaque-block
 * segments — never dropped, edited at the source level only.
 */
export type GanttStatement =
  | { kind: 'title' }
  | { kind: 'section'; ref: number }                    // index into sections
  | { kind: 'task'; section: number; ref: number }      // section + task index
  | { kind: 'opaque-block'; lines: string[] }

export interface GanttBody {
  kind: 'gantt'
  title?: string
  sections: GanttBodySection[]
  /** Optional for synthesized payloads; parsed bodies always populate it. */
  statements?: GanttStatement[]
}

// ---- State diagram body -----------------------------------------------------

/**
 * A state node. Simple states carry an optional display label; composite states
 * additionally carry their own nested `states` + `transitions` (and an optional
 * per-composite `direction`). The reserved pseudostate `[*]` is NOT a StateNode
 * — it is modeled contextually as the endpoint id '[*]' on transitions (source
 * = start pseudostate, target = end pseudostate), scoped per composite level.
 */
export interface StateNode {
  id: string
  /** Optional display label (`state "Label" as id` / `id : Label`). */
  label?: string
  /** Composite children — present iff this is a composite state. */
  states?: StateNode[]
  /** Composite-internal transitions — present iff this is a composite state. */
  transitions?: StateTransition[]
  /** Optional per-composite layout direction. */
  direction?: import('../types.ts').Direction
}

export interface StateTransition {
  /** Source state id, or '[*]' for a start pseudostate. */
  from: string
  /** Target state id, or '[*]' for an end pseudostate. */
  to: string
  label?: string
}

export interface StateBody {
  kind: 'state'
  states: StateNode[]
  transitions: StateTransition[]
  /** Optional top-level layout direction. */
  direction?: import('../types.ts').Direction
}

// ---- Meta + IR ------------------------------------------------------------

export interface SourceComment { text: string; line: number }
export interface InitDirective { raw: string; parsed: MermaidConfigMap }
export interface Accessibility { title?: string; descr?: string }

export interface ValidDiagramMeta {
  frontmatter?: MermaidFrontmatterMap
  initDirectives: InitDirective[]
  comments: SourceComment[]
  accessibility: Accessibility
  /**
   * The leading source wrapper (frontmatter block, `%%{init}%%` directives,
   * `%%` comments, and blank lines before the diagram header), preserved
   * byte-verbatim. serializeMermaid re-emits it untouched by default;
   * canonical wrapper synthesis is opt-in via `{ wrapper: 'canonical' }`.
   * Absent on diagrams synthesized from JSON payloads, which fall back to
   * canonical synthesis.
   */
  wrapperSource?: string
  /**
   * In-body `%%` comments that structured serialization does not preserve,
   * computed at parse time by diffing against the canonical serialization.
   * Surfaced by verify as the Tier 3 `COMMENT_DROPPED` lint. Opaque bodies
   * preserve comments verbatim and never set this.
   */
  droppedComments?: SourceComment[]
}

export interface SourceMap {
  nodes: Map<string, { line: number; col: number }>
  edges: Map<string, { line: number; col: number }>
  groups: Map<string, { line: number; col: number }>
}

export type DiagramBody =
  | { kind: 'flowchart'; graph: MermaidGraph }
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
  /**
   * Opaque body — the parser understood the family header but encountered
   * unmodeled syntax. `source` is the ORIGINAL body with indentation, blank
   * lines, and comments PRESERVED (per the Loop 5 Phase A fix), so the
   * serializer can re-emit byte-for-byte. Distinct from `ValidDiagram.canonicalSource`,
   * which for structured bodies is the rebuilt canonical form.
   */
  | { kind: 'opaque'; family: DiagramKind; source: string }

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

export type FlowchartValidDiagram = ValidDiagram & { body: { kind: 'flowchart'; graph: MermaidGraph } }
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
export type MutableValidDiagram = FlowchartValidDiagram | StateValidDiagram | SequenceValidDiagram | TimelineValidDiagram | ClassValidDiagram | ErValidDiagram | JourneyValidDiagram | ArchitectureValidDiagram | XyChartValidDiagram | PieValidDiagram | QuadrantValidDiagram | GanttValidDiagram

export function asFlowchart(d: ValidDiagram): FlowchartValidDiagram | null {
  return d.body.kind === 'flowchart' ? (d as FlowchartValidDiagram) : null
}
export function asState(d: ValidDiagram): StateValidDiagram | null {
  return d.body.kind === 'state' ? (d as StateValidDiagram) : null
}
export function asSequence(d: ValidDiagram): SequenceValidDiagram | null {
  return d.body.kind === 'sequence' ? (d as SequenceValidDiagram) : null
}

export function asTimeline(d: ValidDiagram): TimelineValidDiagram | null {
  return d.body.kind === 'timeline' ? (d as TimelineValidDiagram) : null
}

export function asClass(d: ValidDiagram): ClassValidDiagram | null {
  return d.body.kind === 'class' ? (d as ClassValidDiagram) : null
}

export function asEr(d: ValidDiagram): ErValidDiagram | null {
  return d.body.kind === 'er' ? (d as ErValidDiagram) : null
}

export function asJourney(d: ValidDiagram): JourneyValidDiagram | null {
  return d.body.kind === 'journey' ? (d as JourneyValidDiagram) : null
}

export function asArchitecture(d: ValidDiagram): ArchitectureValidDiagram | null {
  return d.body.kind === 'architecture' ? (d as ArchitectureValidDiagram) : null
}

export function asXyChart(d: ValidDiagram): XyChartValidDiagram | null {
  return d.body.kind === 'xychart' ? (d as XyChartValidDiagram) : null
}

export function asPie(d: ValidDiagram): PieValidDiagram | null {
  return d.body.kind === 'pie' ? (d as PieValidDiagram) : null
}

export function asQuadrant(d: ValidDiagram): QuadrantValidDiagram | null {
  return d.body.kind === 'quadrant' ? (d as QuadrantValidDiagram) : null
}

export function asGantt(d: ValidDiagram): GanttValidDiagram | null {
  return d.body.kind === 'gantt' ? (d as GanttValidDiagram) : null
}

// ---- Errors ---------------------------------------------------------------

export interface ParseError { code: string; message: string; line?: number; col?: number }

export interface MutationError {
  code:
    | 'NODE_NOT_FOUND' | 'EDGE_NOT_FOUND'
    | 'PARTICIPANT_NOT_FOUND' | 'MESSAGE_NOT_FOUND'
    | 'SECTION_NOT_FOUND' | 'PERIOD_NOT_FOUND' | 'EVENT_NOT_FOUND'
    | 'TASK_NOT_FOUND' | 'ACTOR_NOT_FOUND'
    | 'CLASS_NOT_FOUND' | 'MEMBER_NOT_FOUND' | 'RELATION_NOT_FOUND' | 'NOTE_NOT_FOUND'
    | 'ENTITY_NOT_FOUND' | 'ATTRIBUTE_NOT_FOUND'
    | 'SERVICE_NOT_FOUND' | 'GROUP_NOT_FOUND'
    | 'SERIES_NOT_FOUND'
    | 'SLICE_NOT_FOUND' | 'POINT_NOT_FOUND'
    | 'STATE_NOT_FOUND' | 'TRANSITION_NOT_FOUND'
    | 'DUPLICATE_NODE' | 'DUPLICATE_PARTICIPANT' | 'DUPLICATE_CLASS' | 'DUPLICATE_ENTITY' | 'DUPLICATE_STATE' | 'DUPLICATE_TASK'
    | 'INVALID_OP'
  message: string
}

// ---- MutationOp -----------------------------------------------------------

export type NodeId = string
export type EdgeId = string
export type GroupId = string
export type ParticipantId = string

export type FlowchartMutationOp =
  | { kind: 'add_node'; id: NodeId; label: string; shape?: NodeShape; parent?: GroupId }
  | { kind: 'remove_node'; id: NodeId }
  | { kind: 'rename_node'; from: NodeId; to: NodeId }
  | { kind: 'set_label'; target: NodeId | EdgeId; label: string }
  | { kind: 'add_edge'; from: NodeId; to: NodeId; label?: string; style?: EdgeStyle }
  | { kind: 'remove_edge'; id: EdgeId }

export type SequenceMutationOp =
  | { kind: 'add_participant'; id: ParticipantId; label?: string; participantKind?: 'participant' | 'actor' }
  | { kind: 'remove_participant'; id: ParticipantId }
  | { kind: 'add_message'; from: ParticipantId; to: ParticipantId; text: string; style?: SequenceMessageStyle }
  | { kind: 'remove_message'; index: number }
  | { kind: 'set_message_text'; index: number; text: string }

export type TimelineMutationOp =
  | { kind: 'set_title'; title: string | null }
  | { kind: 'add_section'; label: string }
  | { kind: 'remove_section'; index: number }
  | { kind: 'set_section_label'; index: number; label: string }
  | { kind: 'add_period'; sectionIndex: number; label: string; events?: string[] }
  | { kind: 'remove_period'; sectionIndex: number; periodIndex: number }
  | { kind: 'set_period_label'; sectionIndex: number; periodIndex: number; label: string }
  | { kind: 'add_event'; sectionIndex: number; periodIndex: number; text: string }
  | { kind: 'remove_event'; sectionIndex: number; periodIndex: number; eventIndex: number }
  | { kind: 'set_event_text'; sectionIndex: number; periodIndex: number; eventIndex: number; text: string }

export type ClassMutationOp =
  | { kind: 'set_title'; title: string | null }
  | { kind: 'add_class'; id: string; label?: string; members?: string[] }
  | { kind: 'remove_class'; id: string }
  | { kind: 'rename_class'; from: string; to: string }
  | { kind: 'add_member'; class: string; text: string }
  | { kind: 'remove_member'; class: string; index: number }
  | { kind: 'add_relation'; from: string; to: string; relKind: ClassRelationKind; label?: string }
  | { kind: 'remove_relation'; index: number }
  | { kind: 'add_note'; text: string; for?: string }
  | { kind: 'remove_note'; index: number }

export type ErMutationOp =
  | { kind: 'add_entity'; id: string; attributes?: string[] }
  | { kind: 'remove_entity'; id: string }
  | { kind: 'rename_entity'; from: string; to: string }
  | { kind: 'add_attribute'; entity: string; text: string }
  | { kind: 'remove_attribute'; entity: string; index: number }
  | { kind: 'add_relation'; from: string; to: string; leftCard: ErCardinality; rightCard: ErCardinality; dashed?: boolean; label?: string }
  | { kind: 'remove_relation'; index: number }

export type JourneyMutationOp =
  | { kind: 'set_title'; title: string | null }
  | { kind: 'add_section'; label: string }
  | { kind: 'remove_section'; index: number }
  | { kind: 'set_section_label'; index: number; label: string }
  | { kind: 'add_task'; sectionIndex: number; text: string; score: number; actors?: string[] }
  | { kind: 'remove_task'; sectionIndex: number; taskIndex: number }
  | { kind: 'set_task_text'; sectionIndex: number; taskIndex: number; text: string }
  | { kind: 'set_task_score'; sectionIndex: number; taskIndex: number; score: number }
  | { kind: 'set_task_actors'; sectionIndex: number; taskIndex: number; actors: string[] }
  | { kind: 'rename_actor'; from: string; to: string }

export type ArchitectureMutationOp =
  | { kind: 'add_service'; id: string; label?: string; icon?: string | null; group?: string | null }
  | { kind: 'remove_service'; id: string }
  | { kind: 'rename_service'; from: string; to: string }
  | { kind: 'set_service_label'; id: string; label: string }
  | { kind: 'set_service_icon'; id: string; icon: string | null }
  | { kind: 'move_service'; id: string; group: string | null }
  | { kind: 'add_group'; id: string; label?: string; icon?: string | null; parent?: string | null }
  | { kind: 'remove_group'; id: string }
  | { kind: 'add_edge'; from: string; to: string; fromSide: ArchitectureSide; toSide: ArchitectureSide; label?: string | null; hasArrowStart?: boolean; hasArrowEnd?: boolean }
  | { kind: 'remove_edge'; index?: number; id?: string }

export type StateMutationOp =
  | { kind: 'add_state'; id: string; label?: string | null; parent?: string | null }
  | { kind: 'remove_state'; id: string }
  | { kind: 'rename_state'; from: string; to: string }
  | { kind: 'set_state_label'; id: string; label: string | null }
  | { kind: 'add_transition'; from: string; to: string; label?: string | null; parent?: string | null }
  | { kind: 'remove_transition'; index?: number; from?: string; to?: string; parent?: string | null }
  | { kind: 'set_transition_label'; index?: number; from?: string; to?: string; label: string | null; parent?: string | null }
  | { kind: 'make_composite'; id: string; members: string[]; label?: string | null }

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

export type GanttMutationOp =
  | { kind: 'set_title'; title: string | null }
  | { kind: 'add_section'; label: string }
  | { kind: 'rename_section'; index: number; label: string }
  | { kind: 'remove_section'; index: number }
  | { kind: 'add_task'; sectionIndex: number; label: string; taskId?: string; tags?: GanttBodyTaskTag[]; start?: string; end: string }
  | { kind: 'remove_task'; sectionIndex: number; taskIndex: number }
  | { kind: 'rename_task'; sectionIndex: number; taskIndex: number; label: string }
  | { kind: 'set_task_status'; sectionIndex: number; taskIndex: number; status: 'active' | 'done' | 'crit' | null }
  | { kind: 'set_task_dates'; sectionIndex: number; taskIndex: number; start?: string | null; end?: string }

export type AnyMutationOp = FlowchartMutationOp | StateMutationOp | SequenceMutationOp | TimelineMutationOp | ClassMutationOp | ErMutationOp | JourneyMutationOp | ArchitectureMutationOp | XyChartMutationOp | PieMutationOp | QuadrantMutationOp | GanttMutationOp
export type MutationOp = FlowchartMutationOp // legacy alias

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

export type Tier1WarningCode =
  | 'EMPTY_DIAGRAM' | 'EDGE_MISANCHORED' | 'OFF_CANVAS'
  | 'GROUP_BREACH' | 'UNKNOWN_SHAPE' | 'LABEL_OVERFLOW'
export type Tier2WarningCode =
  | 'NODE_OVERLAP' | 'ROUTE_SELF_CROSS' | 'ROUTE_HITCH'
  | 'ROUTE_UNEXPLAINED_BEND' | 'ROUTE_LABEL_ON_SHARED_TRUNK'
  | 'ROUTE_CONTAINER_MISANCHOR' | 'ROUTE_SHAPE_MISANCHOR' | 'ROUTE_STALE_AFTER_NODE_MOVE'
/**
 * Tier 3 (advisory lint). Family-specific quality hints for common agent
 * mistakes that still parse and render. Lint warnings never flip verify.ok.
 */
export type Tier3WarningCode = 'DUPLICATE_EDGE' | 'UNREACHABLE_NODE' | 'DECISION_BRANCH_UNLABELED' | 'COMMENT_DROPPED'
export type WarningCode = Tier1WarningCode | Tier2WarningCode | Tier3WarningCode

export type LayoutWarning =
  | { code: 'EMPTY_DIAGRAM' }
  | { code: 'EDGE_MISANCHORED'; edge: EdgeId; from?: NodeId; to?: NodeId }
  | { code: 'OFF_CANVAS'; target: NodeId | EdgeId; axis: 'x' | 'y' }
  | { code: 'GROUP_BREACH'; group: GroupId; member: NodeId }
  | { code: 'UNKNOWN_SHAPE'; node: NodeId; shape: string }
  | { code: 'LABEL_OVERFLOW'; target: NodeId | EdgeId; charCount: number; limit: number }
  | { code: 'NODE_OVERLAP'; a: NodeId; b: NodeId; areaPx: number }
  | { code: 'ROUTE_SELF_CROSS'; edge: EdgeId; count: number }
  | { code: 'ROUTE_HITCH'; edge: EdgeId; deviationPx: number }
  | { code: 'ROUTE_UNEXPLAINED_BEND'; edge: EdgeId }
  | { code: 'ROUTE_LABEL_ON_SHARED_TRUNK'; edge: EdgeId; sharedWith: EdgeId }
  | { code: 'ROUTE_CONTAINER_MISANCHOR'; edge: EdgeId; container: GroupId }
  | { code: 'ROUTE_SHAPE_MISANCHOR'; edge: EdgeId; node: NodeId }
  | { code: 'ROUTE_STALE_AFTER_NODE_MOVE'; edge: EdgeId; node: NodeId }
  | { code: 'DUPLICATE_EDGE'; edge: EdgeId; duplicateOf: EdgeId; from: NodeId; to: NodeId; label?: string }
  | { code: 'UNREACHABLE_NODE'; node: NodeId }
  | { code: 'DECISION_BRANCH_UNLABELED'; node: NodeId; edge: EdgeId }
  | { code: 'COMMENT_DROPPED'; count: number; lines: number[] }

export const WARNING_SEVERITY: Record<WarningCode, WarningSeverity> = {
  EMPTY_DIAGRAM: 'error',
  EDGE_MISANCHORED: 'error',
  OFF_CANVAS: 'error',
  GROUP_BREACH: 'error',
  UNKNOWN_SHAPE: 'warning',
  LABEL_OVERFLOW: 'warning',
  NODE_OVERLAP: 'warning',
  ROUTE_SELF_CROSS: 'warning',
  ROUTE_HITCH: 'warning',
  ROUTE_UNEXPLAINED_BEND: 'warning',
  ROUTE_LABEL_ON_SHARED_TRUNK: 'warning',
  ROUTE_CONTAINER_MISANCHOR: 'warning',
  ROUTE_SHAPE_MISANCHOR: 'warning',
  ROUTE_STALE_AFTER_NODE_MOVE: 'warning',
  DUPLICATE_EDGE: 'warning',
  UNREACHABLE_NODE: 'warning',
  DECISION_BRANCH_UNLABELED: 'warning',
  COMMENT_DROPPED: 'warning',
}

export const WARNING_TIER: Record<WarningCode, WarningTier> = {
  EMPTY_DIAGRAM: 'structural',
  EDGE_MISANCHORED: 'structural',
  OFF_CANVAS: 'structural',
  GROUP_BREACH: 'structural',
  UNKNOWN_SHAPE: 'structural',
  LABEL_OVERFLOW: 'structural',
  NODE_OVERLAP: 'geometric',
  ROUTE_SELF_CROSS: 'geometric',
  ROUTE_HITCH: 'geometric',
  ROUTE_UNEXPLAINED_BEND: 'geometric',
  ROUTE_LABEL_ON_SHARED_TRUNK: 'geometric',
  ROUTE_CONTAINER_MISANCHOR: 'geometric',
  ROUTE_SHAPE_MISANCHOR: 'geometric',
  ROUTE_STALE_AFTER_NODE_MOVE: 'geometric',
  DUPLICATE_EDGE: 'lint',
  UNREACHABLE_NODE: 'lint',
  DECISION_BRANCH_UNLABELED: 'lint',
  COMMENT_DROPPED: 'lint',
}

export const DEFAULT_LABEL_CHAR_CAP = 40

export interface VerifyOptions {
  suppress?: WarningCode[]
  labelCharCap?: number
}

export interface RenderedLayoutNode {
  id: NodeId; x: Finite; y: Finite; w: Finite; h: Finite; shape: string; label?: string
}
export interface RenderedLayoutEdge {
  id: EdgeId; from: NodeId; to: NodeId; path: [Finite, Finite][]
  label?: { x: Finite; y: Finite; text: string }
  /** Route-contract certificate; present only under layoutMermaid(d, { debug: true }). */
  route?: RouteCertificate
}
export interface RenderedLayoutGroup {
  id: GroupId; x: Finite; y: Finite; w: Finite; h: Finite; members: NodeId[]; label?: string
}
export interface RenderedLayout {
  version: 1
  kind: DiagramKind
  nodes: RenderedLayoutNode[]
  edges: RenderedLayoutEdge[]
  groups: RenderedLayoutGroup[]
  bounds: { w: Finite; h: Finite }
}

export interface VerifyResult {
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
}

export interface ValidDiagramPayload {
  kind: DiagramKind
  meta?: Partial<ValidDiagramMeta>
  body:
    | { kind: 'flowchart'; graph: SerializedFlowchartGraph }
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
    | { kind: 'opaque'; family: DiagramKind; source: string }
}
