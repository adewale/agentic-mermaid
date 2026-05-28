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
    | { kind: 'opaque'; family: DiagramKind; source: string }
  readonly canonicalSource: string   // LOAD-BEARING: round-trip pillar
}

// Narrowed type — mutate accepts only this. Use asFlowchart() to narrow.
type FlowchartValidDiagram = ValidDiagram & { body: { kind: 'flowchart' } }

interface FlowchartGraph {
  direction: 'TD' | 'TB' | 'LR' | 'BT' | 'RL'
  nodes: Map<string, { id: string; label: string; shape: string }>
  edges: { source: string; target: string; label?: string; style: string }[]
  subgraphs: { id: string; label: string; nodeIds: string[] }[]
}

type MutationOp =
  | { kind: 'add_node'; id: string; label: string; shape?: string; parent?: string }
  | { kind: 'remove_node'; id: string }
  | { kind: 'rename_node'; from: string; to: string }
  | { kind: 'set_label'; target: string; label: string }
  | { kind: 'add_edge'; from: string; to: string; label?: string; style?: 'solid' | 'dotted' | 'thick' }
  | { kind: 'remove_edge'; id: string }   // edge id: \`\${from}->\${to}\`

// Warnings split into tiers:
//   Tier 1 (structural, reliable): EMPTY_DIAGRAM, EDGE_MISANCHORED, OFF_CANVAS, GROUP_BREACH, UNKNOWN_SHAPE
//   Tier 2 (metric, best-effort): LABEL_OVERFLOW, NODE_OVERLAP, ROUTE_SELF_CROSS
type WarningCode =
  | 'EMPTY_DIAGRAM' | 'EDGE_MISANCHORED' | 'OFF_CANVAS' | 'GROUP_BREACH' | 'UNKNOWN_SHAPE'
  | 'LABEL_OVERFLOW' | 'NODE_OVERLAP' | 'ROUTE_SELF_CROSS'

interface VerifyResult {
  ok: boolean
  warnings: { code: WarningCode; [field: string]: unknown }[]
  layout: {
    version: 1
    seed: number
    kind: DiagramKind
    nodes: { id: string; x: number; y: number; w: number; h: number; shape: string; label?: string }[]
    edges: { id: string; from: string; to: string; path: [number, number][]; label?: { x: number; y: number; text: string } }[]
    groups: unknown[]
    bounds: { w: number; h: number }
  }
}

declare const mermaid: {
  parseMermaid(source: string): Result<ValidDiagram, { code: string; message: string; line?: number; col?: number }[]>

  /** Narrow a ValidDiagram to FlowchartValidDiagram, or null if not flowchart/state. */
  asFlowchart(d: ValidDiagram): FlowchartValidDiagram | null

  /** Mutate accepts only FlowchartValidDiagram at the type level. */
  mutate(d: FlowchartValidDiagram, op: MutationOp): Result<FlowchartValidDiagram, { code: string; message: string }>

  verifyMermaid(input: ValidDiagram | string, opts?: { suppress?: WarningCode[] }): VerifyResult
  serializeMermaid(d: ValidDiagram): string
  renderMermaidSVG(input: ValidDiagram | string): string
  renderMermaidASCII(input: ValidDiagram | string): string
}

// Conventions:
// 1. Run verifyMermaid after every batch of mutations.
// 2. On verify failure, revert to the previous ValidDiagram.
// 3. Never concatenate Mermaid source strings — use mutate() and serialize().
// 4. mutate works on flowchart + state only. Use asFlowchart() to narrow.
// 5. For other families: parse, verify, render, serialize. No structural mutation.
`
