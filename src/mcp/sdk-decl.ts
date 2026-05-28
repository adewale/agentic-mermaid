// ============================================================================
// SDK declaration embedded in the MCP server's system prompt.
//
// This is the typed surface the model sees inside Code Mode. Kept compact
// (~700 tokens) so it doesn't bloat every prompt.
// ============================================================================

export const SDK_DECLARATION = `// Mermaid agent SDK available as the global \`mermaid\`. All calls are
// synchronous and pure. Compose multi-step edits in one execute() call.

type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }

type DiagramKind =
  | 'flowchart' | 'state' | 'sequence' | 'class' | 'er'
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
  readonly source: { nodes: Map<string, { line: number; col: number }>; /* ... */ }
  readonly canonicalSource: string
}

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
  | { kind: 'remove_edge'; id: string }   // edge id format: \`\${from}->\${to}\`

type WarningCode =
  | 'LABEL_OVERFLOW' | 'OFF_CANVAS' | 'EDGE_MISANCHORED' | 'GROUP_BREACH'
  | 'EMPTY_DIAGRAM'  | 'NODE_OVERLAP' | 'ROUTE_SELF_CROSS' | 'UNKNOWN_SHAPE'

type LayoutWarning = { code: WarningCode; [field: string]: unknown }

interface VerifyResult {
  ok: boolean
  warnings: LayoutWarning[]
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
  /** Parse Mermaid source into a typed ValidDiagram. Multi-error. */
  parseMermaid(source: string): Result<ValidDiagram, { code: string; message: string; line?: number; col?: number }[]>

  /** Apply one structural edit. Returns Err if op is invalid for this diagram. */
  mutate(d: ValidDiagram, op: MutationOp): Result<ValidDiagram, { code: string; message: string }>

  /**
   * Verify rendering correctness without producing pixels. Returns structured
   * warnings. Run after every batch of mutations before committing.
   *   - suppress lists WarningCodes to omit (e.g., ['UNKNOWN_SHAPE']).
   *   - severity 'error' codes flip ok=false; 'warning' codes do not.
   */
  verifyMermaid(input: ValidDiagram | string, opts?: { suppress?: WarningCode[] }): VerifyResult

  /** Serialize back to canonical Mermaid source. */
  serializeMermaid(d: ValidDiagram): string

  /** Render to SVG (one string). Accepts source or ValidDiagram. */
  renderMermaidSVG(input: ValidDiagram | string): string

  /** Render to ASCII (one string). Cheaper than SVG for agent contexts. */
  renderMermaidASCII(input: ValidDiagram | string): string
}

// Conventions:
// 1. Run verifyMermaid after every batch of mutations, before serializing.
// 2. On verify failure, revert to the previous ValidDiagram and try a different op.
// 3. Never concatenate Mermaid source strings — use mutate() and serialize().
// 4. The whole pipeline is synchronous and deterministic.
`
