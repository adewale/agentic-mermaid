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
                 | 'timeline' | 'journey' | 'xychart' | 'architecture'

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
    | SequenceBody
    | TimelineBody
    | ClassBody
    | ErBody
    | { kind: 'opaque'; family: DiagramKind; source: string }
  readonly canonicalSource: string   // normalized renderer input; opaque fidelity uses body.source
}

type FlowchartValidDiagram = ValidDiagram & { body: { kind: 'flowchart'; graph: FlowchartGraph } }
type SequenceValidDiagram  = ValidDiagram & { body: SequenceBody }
type TimelineValidDiagram  = ValidDiagram & { body: TimelineBody }
type ClassValidDiagram     = ValidDiagram & { body: ClassBody }
type ErValidDiagram        = ValidDiagram & { body: ErBody }

interface FlowchartGraph {
  direction: 'TD' | 'TB' | 'LR' | 'BT' | 'RL'
  nodes: Map<string, { id: string; label: string; shape: string }>
  edges: {
    source: string; target: string; label?: string; style: string
    hasArrowStart?: boolean; hasArrowEnd?: boolean; startMarker?: string; endMarker?: string
  }[]
  subgraphs: { id: string; label: string; nodeIds: string[]; children: FlowchartGraph['subgraphs']; direction?: FlowchartGraph['direction'] }[]
}

interface SeqParticipant { id: string; label: string; kind: 'participant' | 'actor' }
interface SeqMessage { from: string; to: string; text: string; style: string }
interface SequenceBody { kind: 'sequence'; participants: SeqParticipant[]; messages: SeqMessage[] }

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

type FlowchartMutationOp =
  | { kind: 'add_node'; id: string; label: string; shape?: string; parent?: string }
  | { kind: 'remove_node'; id: string }
  | { kind: 'rename_node'; from: string; to: string }
  | { kind: 'set_label'; target: string; label: string }
  | { kind: 'add_edge'; from: string; to: string; label?: string; style?: 'solid' | 'dotted' | 'thick' }
  | { kind: 'remove_edge'; id: string }

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
  asSequence(d: ValidDiagram):  SequenceValidDiagram | null
  asTimeline(d: ValidDiagram):  TimelineValidDiagram | null
  asClass(d: ValidDiagram):     ClassValidDiagram | null
  asEr(d: ValidDiagram):        ErValidDiagram | null
  mutate(d: FlowchartValidDiagram, op: FlowchartMutationOp): Result<FlowchartValidDiagram, { code: string; message: string }>
  mutate(d: SequenceValidDiagram,  op: SequenceMutationOp):  Result<SequenceValidDiagram, { code: string; message: string }>
  mutate(d: TimelineValidDiagram,  op: TimelineMutationOp):  Result<TimelineValidDiagram, { code: string; message: string }>
  mutate(d: ClassValidDiagram,     op: ClassMutationOp):     Result<ClassValidDiagram, { code: string; message: string }>
  mutate(d: ErValidDiagram,        op: ErMutationOp):        Result<ErValidDiagram, { code: string; message: string }>
  verifyMermaid(input: ValidDiagram | string, opts?: { suppress?: WarningCode[]; labelCharCap?: number }): VerifyResult
  serializeMermaid(d: ValidDiagram): string
  renderMermaidSVG(input: ValidDiagram | string, opts?: { security?: 'default' | 'strict'; idPrefix?: string; mermaidConfig?: MermaidRuntimeConfig }): string
  renderMermaidASCII(input: ValidDiagram | string, opts?: { useAscii?: boolean; mermaidConfig?: MermaidRuntimeConfig }): string
}

// Conventions:
// 1. For new diagrams, author Mermaid source directly, then parse/verify/render.
// 2. For existing structured diagrams, use mutate() + verify + serializeMermaid();
//    do not regenerate/concatenate source when a typed op exists.
// 3. mutate works on flowchart/state, simple sequence, timeline, class, and ER.
//    Narrow via asFlowchart/asSequence/asTimeline/asClass/asEr. Journey,
//    xychart, architecture, and opaque-fallback bodies are source-level only;
//    if explicitly edited as text, re-parse and verify before returning.
// 4. verify.ok is structural, not a visual-quality score; inspect warnings/layout or render artifacts for layout quality.
// 5. Layout is deterministic; there is no seed.
`
