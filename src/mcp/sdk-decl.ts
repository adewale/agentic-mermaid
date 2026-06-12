export const SDK_DECLARATION = `// Mermaid agent SDK available as the global \`mermaid\`. All calls are
// synchronous and pure. Compose multi-step edits in one execute() call.
// Code Mode is synchronous: async/await, Promise jobs, and dynamic import are not supported.

type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }

type MermaidConfigScalar = string | number | boolean | null
type MermaidConfigValue = MermaidConfigScalar | MermaidConfigValue[] | { [key: string]: MermaidConfigValue | undefined }
type MermaidRuntimeConfig = {
  [key: string]: MermaidConfigValue | undefined
  theme?: string
  fontFamily?: string
  themeVariables?: { [key: string]: MermaidConfigValue | undefined; fontFamily?: string }
  timeline?: { [key: string]: MermaidConfigValue | undefined; disableMulticolor?: boolean; sectionFills?: string[]; sectionColours?: string[] }
  xyChart?: { [key: string]: MermaidConfigValue | undefined }
  useMaxWidth?: boolean
  useWidth?: number
  themeCSS?: string
}

type DiagramKind = 'flowchart' | 'state' | 'sequence' | 'class' | 'er'
                 | 'timeline' | 'journey' | 'xychart' | 'architecture' | 'pie' | 'quadrant' | 'gantt'

interface ValidDiagram {
  readonly kind: DiagramKind
  readonly meta: {
    frontmatter?: Record<string, unknown>
    initDirectives: { raw: string; parsed: Record<string, unknown> }[]
    comments: { text: string; line: number }[]
    accessibility: { title?: string; descr?: string }
  }
  readonly body:
    | { kind: 'flowchart'; graph: FlowchartGraph }
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
  readonly canonicalSource: string   // normalized renderer input; opaque fidelity uses body.source
}

type FlowchartValidDiagram = ValidDiagram & { body: { kind: 'flowchart'; graph: FlowchartGraph } }
type StateValidDiagram     = ValidDiagram & { body: StateBody }
type SequenceValidDiagram  = ValidDiagram & { body: SequenceBody }
type TimelineValidDiagram  = ValidDiagram & { body: TimelineBody }
type ClassValidDiagram     = ValidDiagram & { body: ClassBody }
type ErValidDiagram        = ValidDiagram & { body: ErBody }
type JourneyValidDiagram   = ValidDiagram & { body: JourneyBody }
type ArchitectureValidDiagram = ValidDiagram & { body: ArchitectureBody }
type XyChartValidDiagram   = ValidDiagram & { body: XyChartBody }
type PieValidDiagram       = ValidDiagram & { body: PieBody }
type QuadrantValidDiagram  = ValidDiagram & { body: QuadrantBody }
type GanttValidDiagram     = ValidDiagram & { body: GanttBody }

interface FlowchartGraph {
  direction: 'TD' | 'TB' | 'LR' | 'BT' | 'RL'
  nodes: Map<string, { id: string; label: string; shape: string }>
  edges: {
    source: string; target: string; label?: string; style: string
    hasArrowStart?: boolean; hasArrowEnd?: boolean; startMarker?: string; endMarker?: string
  }[]
  subgraphs: { id: string; label: string; nodeIds: string[]; children: FlowchartGraph['subgraphs']; direction?: FlowchartGraph['direction'] }[]
}

interface StateNode { id: string; label?: string; states?: StateNode[]; transitions?: StateTransition[]; direction?: 'TD' | 'TB' | 'LR' | 'BT' | 'RL' }
interface StateTransition { from: string; to: string; label?: string }   // from/to may be '[*]'
interface StateBody { kind: 'state'; states: StateNode[]; transitions: StateTransition[]; direction?: 'TD' | 'TB' | 'LR' | 'BT' | 'RL' }

interface SeqParticipant { id: string; label: string; kind: 'participant' | 'actor' }
interface SeqMessage { from: string; to: string; text: string; style: string }
// BUILD-18: ordered statement list. participant/message refs index into the
// participants/messages arrays; opaque-block carries unmodeled lines verbatim.
// Mutation ops only see top-level messages — messages inside an opaque block are
// never touched.
type SequenceStatement =
  | { kind: 'participant'; ref: number }
  | { kind: 'message'; ref: number }
  | { kind: 'opaque-block'; lines: string[] }
interface SequenceBody { kind: 'sequence'; participants: SeqParticipant[]; messages: SeqMessage[]; statements?: SequenceStatement[] }

interface TimelineEvent { id: string; text: string }
interface TimelinePeriod { id: string; label: string; events: TimelineEvent[] }
interface TimelineSection { id: string; label?: string; periods: TimelinePeriod[] }
interface TimelineBody { kind: 'timeline'; title?: string; sections: TimelineSection[] }

interface ClassNode { id: string; label?: string; members: string[] }
type ClassRelationKind = 'inheritance' | 'composition' | 'aggregation' | 'association' | 'dependency' | 'realization' | 'link-solid' | 'link-dashed'
interface ClassRelation { from: string; to: string; kind: ClassRelationKind; label?: string; fromCardinality?: string; toCardinality?: string }
interface ClassNote { text: string; for?: string }
interface ClassBody { kind: 'class'; title?: string; classes: ClassNode[]; relations: ClassRelation[]; notes: ClassNote[] }

type ErCardinality = 'one-only' | 'zero-or-one' | 'zero-or-many' | 'one-or-many'
interface ErAttribute { text: string }
interface ErEntity { id: string; attributes: ErAttribute[] }
interface ErRelation { from: string; to: string; leftCard: ErCardinality; rightCard: ErCardinality; dashed: boolean; label?: string }
interface ErBody { kind: 'er'; entities: ErEntity[]; relations: ErRelation[] }

interface JourneyTask { id: string; text: string; score: number; actors: string[] }
interface JourneySection { id: string; label?: string; tasks: JourneyTask[] }
interface JourneyBody { kind: 'journey'; title?: string; sections: JourneySection[] }

type ArchitectureSide = 'L' | 'R' | 'T' | 'B'
interface ArchitectureGroup { id: string; label: string; icon?: string; parentId?: string }
interface ArchitectureService { id: string; label: string; icon?: string; parentId?: string }
interface ArchitectureJunction { id: string; parentId?: string }
interface ArchitectureEndpoint { id: string; side: ArchitectureSide }
interface ArchitectureEdge { source: ArchitectureEndpoint; target: ArchitectureEndpoint; label?: string; hasArrowStart: boolean; hasArrowEnd: boolean }
interface ArchitectureBody { kind: 'architecture'; groups: ArchitectureGroup[]; services: ArchitectureService[]; junctions: ArchitectureJunction[]; edges: ArchitectureEdge[] }

interface XyChartAxis { name?: string; categories?: string[]; range?: { min: number; max: number } }
interface XyChartSeries { id: string; kind: 'bar' | 'line'; name?: string; values: number[] }
interface XyChartBody { kind: 'xychart'; title?: string; horizontal?: boolean; xAxis?: XyChartAxis; yAxis?: XyChartAxis; series: XyChartSeries[] }

interface PieSlice { id: string; label: string; value: number }   // value > 0
interface PieBody { kind: 'pie'; title?: string; showData: boolean; slices: PieSlice[] }

interface QuadrantAxis { near: string; far?: string }
interface QuadrantPoint { label: string; x: number; y: number }   // x,y in [0,1]
// quadrants indexed 0-based; index n-1 holds Mermaid quadrant-n
// (1=top-right, 2=top-left, 3=bottom-left, 4=bottom-right)
interface QuadrantBody { kind: 'quadrant'; title?: string; xAxis?: QuadrantAxis; yAxis?: QuadrantAxis; quadrants: [string?, string?, string?, string?]; points: QuadrantPoint[] }

type GanttTaskTag = 'active' | 'done' | 'crit' | 'milestone' | 'vert'
// start: a date in the diagram's dateFormat or 'after id…'; undefined = previous task's end.
// end: a date, a duration token ('3d', '2w'), or 'until id…'.
interface GanttTask { id: string; taskId?: string; label: string; tags: GanttTaskTag[]; start?: string; end: string }
interface GanttSection { id: string; label?: string; tasks: GanttTask[] }
// Segment-preserving body: calendar directives (dateFormat, excludes, weekend…),
// click lines, and comments ride along VERBATIM as opaque-block segments — they
// are preserved, not typed-editable. Tasks inside opaque segments are invisible
// to mutation ops.
type GanttStatement =
  | { kind: 'title' }
  | { kind: 'section'; ref: number }
  | { kind: 'task'; section: number; ref: number }
  | { kind: 'opaque-block'; lines: string[] }
interface GanttBody { kind: 'gantt'; title?: string; sections: GanttSection[]; statements?: GanttStatement[] }

type FlowchartMutationOp =
  | { kind: 'add_node'; id: string; label: string; shape?: string; parent?: string }
  | { kind: 'remove_node'; id: string }
  | { kind: 'rename_node'; from: string; to: string }
  | { kind: 'set_label'; target: string; label: string }
  | { kind: 'add_edge'; from: string; to: string; label?: string; style?: 'solid' | 'dotted' | 'thick' }
  | { kind: 'remove_edge'; id: string }

type StateMutationOp =
  | { kind: 'add_state'; id: string; label?: string | null; parent?: string | null }
  | { kind: 'remove_state'; id: string }
  | { kind: 'rename_state'; from: string; to: string }
  | { kind: 'set_state_label'; id: string; label: string | null }
  | { kind: 'add_transition'; from: string; to: string; label?: string | null; parent?: string | null }   // from/to may be '[*]'
  | { kind: 'remove_transition'; index?: number; from?: string; to?: string; parent?: string | null }
  | { kind: 'set_transition_label'; index?: number; from?: string; to?: string; label: string | null; parent?: string | null }
  | { kind: 'make_composite'; id: string; members: string[]; label?: string | null }

type SequenceMutationOp =
  | { kind: 'add_participant'; id: string; label?: string; participantKind?: 'participant' | 'actor' }
  | { kind: 'remove_participant'; id: string }
  | { kind: 'add_message'; from: string; to: string; text: string; style?: 'sync' | 'reply' | 'async' | 'async-dashed' | 'lost' | 'lost-dashed' }
  | { kind: 'remove_message'; index: number }
  | { kind: 'set_message_text'; index: number; text: string }

type TimelineMutationOp =
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

type ClassMutationOp =
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

type ErMutationOp =
  | { kind: 'add_entity'; id: string; attributes?: string[] }
  | { kind: 'remove_entity'; id: string }
  | { kind: 'rename_entity'; from: string; to: string }
  | { kind: 'add_attribute'; entity: string; text: string }
  | { kind: 'remove_attribute'; entity: string; index: number }
  | { kind: 'add_relation'; from: string; to: string; leftCard: ErCardinality; rightCard: ErCardinality; dashed?: boolean; label?: string }
  | { kind: 'remove_relation'; index: number }

type JourneyMutationOp =
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

type ArchitectureMutationOp =
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

type XyChartAxisSpec = { name?: string | null; categories?: string[]; range?: { min: number; max: number } }
type XyChartMutationOp =
  | { kind: 'set_title'; title: string | null }
  | { kind: 'set_x_axis'; axis: XyChartAxisSpec | null }
  | { kind: 'set_y_axis'; axis: XyChartAxisSpec | null }
  | { kind: 'add_series'; kind2: 'bar' | 'line'; name?: string | null; values: number[] }
  | { kind: 'remove_series'; index: number }
  | { kind: 'set_series_values'; index: number; values: number[] }
  | { kind: 'set_series_name'; index: number; name: string | null }
  | { kind: 'reorder_series'; from: number; to: number }

type PieMutationOp =
  | { kind: 'set_title'; title: string | null }
  | { kind: 'set_show_data'; showData: boolean }
  | { kind: 'add_slice'; label: string; value: number }   // value > 0
  | { kind: 'remove_slice'; label: string }
  | { kind: 'rename_slice'; from: string; to: string }
  | { kind: 'set_slice_value'; label: string; value: number }
  | { kind: 'reorder_slice'; from: number; to: number }

type QuadrantMutationOp =
  | { kind: 'set_title'; title: string | null }
  | { kind: 'set_axis_labels'; axis: 'x' | 'y'; near: string | null; far?: string | null }
  | { kind: 'set_quadrant_label'; quadrant: number; label: string | null }   // quadrant 1..4
  | { kind: 'add_point'; label: string; x: number; y: number }   // x,y in [0,1]
  | { kind: 'remove_point'; label: string }
  | { kind: 'move_point'; label: string; x: number; y: number }
  | { kind: 'rename_point'; from: string; to: string }

type GanttMutationOp =
  | { kind: 'set_title'; title: string | null }
  | { kind: 'add_section'; label: string }
  | { kind: 'rename_section'; index: number; label: string }
  | { kind: 'remove_section'; index: number }
  | { kind: 'add_task'; sectionIndex: number; label: string; taskId?: string; tags?: GanttTaskTag[]; start?: string; end: string }
  | { kind: 'remove_task'; sectionIndex: number; taskIndex: number }
  | { kind: 'rename_task'; sectionIndex: number; taskIndex: number; label: string }
  | { kind: 'set_task_status'; sectionIndex: number; taskIndex: number; status: 'active' | 'done' | 'crit' | null }
  | { kind: 'set_task_dates'; sectionIndex: number; taskIndex: number; start?: string | null; end?: string }

// Tier 1 (structural, reliable): EMPTY_DIAGRAM, EDGE_MISANCHORED, OFF_CANVAS,
//   GROUP_BREACH, UNKNOWN_SHAPE, LABEL_OVERFLOW (source-based char-cap).
// Tier 2 (geometric, advisory): NODE_OVERLAP, ROUTE_SELF_CROSS.
// Tier 3 (lint, advisory): DUPLICATE_EDGE, UNREACHABLE_NODE.
type WarningCode =
  | 'EMPTY_DIAGRAM' | 'EDGE_MISANCHORED' | 'OFF_CANVAS' | 'GROUP_BREACH'
  | 'UNKNOWN_SHAPE' | 'LABEL_OVERFLOW' | 'NODE_OVERLAP' | 'ROUTE_SELF_CROSS'
  | 'DUPLICATE_EDGE' | 'UNREACHABLE_NODE'

interface VerifyResult {
  ok: boolean
  warnings: { code: WarningCode; [field: string]: unknown }[]
  layout: { version: 1; kind: DiagramKind; nodes: unknown[]; edges: unknown[]; groups: unknown[]; bounds: { w: number; h: number } }
}

declare const mermaid: {
  parseMermaid(source: string): Result<ValidDiagram, { code: string; message: string }[]>
  asFlowchart(d: ValidDiagram): FlowchartValidDiagram | null
  asState(d: ValidDiagram):     StateValidDiagram | null
  asSequence(d: ValidDiagram):  SequenceValidDiagram | null
  asTimeline(d: ValidDiagram):  TimelineValidDiagram | null
  asClass(d: ValidDiagram):     ClassValidDiagram | null
  asEr(d: ValidDiagram):        ErValidDiagram | null
  asJourney(d: ValidDiagram):   JourneyValidDiagram | null
  asArchitecture(d: ValidDiagram): ArchitectureValidDiagram | null
  asXyChart(d: ValidDiagram):   XyChartValidDiagram | null
  asPie(d: ValidDiagram):       PieValidDiagram | null
  asQuadrant(d: ValidDiagram):  QuadrantValidDiagram | null
  asGantt(d: ValidDiagram):     GanttValidDiagram | null
  mutate(d: FlowchartValidDiagram, op: FlowchartMutationOp): Result<FlowchartValidDiagram, { code: string; message: string }>
  mutate(d: StateValidDiagram,     op: StateMutationOp):     Result<StateValidDiagram, { code: string; message: string }>
  mutate(d: SequenceValidDiagram,  op: SequenceMutationOp):  Result<SequenceValidDiagram, { code: string; message: string }>
  mutate(d: TimelineValidDiagram,  op: TimelineMutationOp):  Result<TimelineValidDiagram, { code: string; message: string }>
  mutate(d: ClassValidDiagram,     op: ClassMutationOp):     Result<ClassValidDiagram, { code: string; message: string }>
  mutate(d: ErValidDiagram,        op: ErMutationOp):        Result<ErValidDiagram, { code: string; message: string }>
  mutate(d: JourneyValidDiagram,   op: JourneyMutationOp):   Result<JourneyValidDiagram, { code: string; message: string }>
  mutate(d: ArchitectureValidDiagram, op: ArchitectureMutationOp): Result<ArchitectureValidDiagram, { code: string; message: string }>
  mutate(d: XyChartValidDiagram,   op: XyChartMutationOp):   Result<XyChartValidDiagram, { code: string; message: string }>
  mutate(d: PieValidDiagram,       op: PieMutationOp):       Result<PieValidDiagram, { code: string; message: string }>
  mutate(d: QuadrantValidDiagram,  op: QuadrantMutationOp):  Result<QuadrantValidDiagram, { code: string; message: string }>
  mutate(d: GanttValidDiagram,     op: GanttMutationOp):     Result<GanttValidDiagram, { code: string; message: string }>
  verifyMermaid(input: ValidDiagram | string, opts?: { suppress?: WarningCode[]; labelCharCap?: number }): VerifyResult
  serializeMermaid(d: ValidDiagram): string
  renderMermaidSVG(input: ValidDiagram | string, opts?: { security?: 'default' | 'strict'; idPrefix?: string; mermaidConfig?: MermaidRuntimeConfig }): string
  renderMermaidASCII(input: ValidDiagram | string, opts?: { useAscii?: boolean; mermaidConfig?: MermaidRuntimeConfig }): string
}

// Conventions:
// 1. For new diagrams, author Mermaid source directly, then parse/verify/render.
// 2. For existing structured diagrams, use mutate() + verify + serializeMermaid();
//    do not regenerate/concatenate source when a typed op exists.
// 3. mutate works on flowchart, state, simple sequence, timeline, class, ER,
//    journey, architecture, xychart, pie, quadrant, and gantt. Narrow via
//    asFlowchart/asState/asSequence/asTimeline/asClass/asEr/asJourney/
//    asArchitecture/asXyChart/asPie/asQuadrant/asGantt.
//    State owns a dedicated body (BUILD-19); asFlowchart returns null on it.
//    Gantt bodies are segment-preserving: directives/click/comment lines ride
//    along verbatim as opaque-block segments and are edited as source only.
//    Opaque-fallback
//    bodies (unmodeled syntax) are source-level only; if explicitly edited as
//    text, re-parse and verify before returning.
// 4. verify.ok is structural, not a visual-quality score; inspect warnings/layout or render artifacts for layout quality.
// 5. Layout is deterministic; there is no seed.
`
