export const SDK_DECLARATION = `// Mermaid agent SDK available as the global \`mermaid\`. All calls are
// synchronous and pure. Compose multi-step edits in one execute() call.

type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }

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
    | { kind: 'sequence'; participants: SeqParticipant[]; messages: SeqMessage[] }
    | { kind: 'opaque'; family: DiagramKind; source: string }
  readonly canonicalSource: string   // LOAD-BEARING round-trip pillar
}

type FlowchartValidDiagram = ValidDiagram & { body: { kind: 'flowchart' } }
type SequenceValidDiagram  = ValidDiagram & { body: { kind: 'sequence' } }

interface FlowchartGraph {
  direction: 'TD' | 'TB' | 'LR' | 'BT' | 'RL'
  nodes: Map<string, { id: string; label: string; shape: string }>
  edges: { source: string; target: string; label?: string; style: string }[]
  subgraphs: { id: string; label: string; nodeIds: string[] }[]
}
interface SeqParticipant { id: string; label: string; kind: 'participant' | 'actor' }
interface SeqMessage { from: string; to: string; text: string; style: string }

type FlowchartMutationOp =
  | { kind: 'add_node'; id: string; label: string; shape?: string; parent?: string }
  | { kind: 'remove_node'; id: string }
  | { kind: 'rename_node'; from: string; to: string }
  | { kind: 'set_label'; target: string; label: string }
  | { kind: 'add_edge'; from: string; to: string; label?: string; style?: 'solid' | 'dotted' | 'thick' }
  | { kind: 'remove_edge'; id: string }   // edge id: \`\${from}->\${to}\`

type SequenceMutationOp =
  | { kind: 'add_participant'; id: string; label?: string; participantKind?: 'participant' | 'actor' }
  | { kind: 'remove_participant'; id: string }
  | { kind: 'add_message'; from: string; to: string; text: string; style?: 'sync' | 'reply' | 'async' | 'async-dashed' | 'lost' | 'lost-dashed' }
  | { kind: 'remove_message'; index: number }
  | { kind: 'set_message_text'; index: number; text: string }

// Tier 1 (structural, reliable): EMPTY_DIAGRAM, EDGE_MISANCHORED, OFF_CANVAS,
//   GROUP_BREACH, UNKNOWN_SHAPE, LABEL_OVERFLOW (source-based char-cap).
// Tier 2 (geometric, advisory): NODE_OVERLAP, ROUTE_SELF_CROSS.
type WarningCode =
  | 'EMPTY_DIAGRAM' | 'EDGE_MISANCHORED' | 'OFF_CANVAS' | 'GROUP_BREACH'
  | 'UNKNOWN_SHAPE' | 'LABEL_OVERFLOW' | 'NODE_OVERLAP' | 'ROUTE_SELF_CROSS'

interface VerifyResult {
  ok: boolean
  warnings: { code: WarningCode; [field: string]: unknown }[]
  layout: { version: 1; kind: DiagramKind; nodes: unknown[]; edges: unknown[]; groups: unknown[]; bounds: { w: number; h: number } }
}

declare const mermaid: {
  parseMermaid(source: string): Result<ValidDiagram, { code: string; message: string }[]>
  asFlowchart(d: ValidDiagram): FlowchartValidDiagram | null
  asSequence(d: ValidDiagram):  SequenceValidDiagram | null
  mutate(d: FlowchartValidDiagram, op: FlowchartMutationOp): Result<FlowchartValidDiagram, { code: string; message: string }>
  mutate(d: SequenceValidDiagram,  op: SequenceMutationOp):  Result<SequenceValidDiagram, { code: string; message: string }>
  verifyMermaid(input: ValidDiagram | string, opts?: { suppress?: WarningCode[]; labelCharCap?: number }): VerifyResult
  serializeMermaid(d: ValidDiagram): string
  renderMermaidSVG(input: ValidDiagram | string): string
  renderMermaidASCII(input: ValidDiagram | string): string
}

// Conventions:
// 1. verifyMermaid after every batch of mutations; on failure revert.
// 2. Never concatenate Mermaid source — use mutate() + serializeMermaid().
// 3. mutate works on flowchart + state + simple sequence. Narrow via
//    asFlowchart / asSequence. A sequence diagram with notes/alt/loop/activate
//    falls back to opaque (asSequence returns null) — edit canonicalSource.
// 4. Layout is deterministic; there is no seed.
`
