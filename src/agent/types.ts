// ============================================================================
// Agent-Native Beautiful Mermaid — IR and verb types (v4)
//
// v4 removes the seed/RNG/clock/font-metric apparatus that the empirical
// probe proved was theater (ELK is already deterministic; seeding changed
// nothing). The only verify knob is labelCharCap. See AGENT_NATIVE.md § (1).
// ============================================================================

import type { MermaidGraph, NodeShape, EdgeStyle } from '../types.ts'
import type { MermaidFrontmatterMap, MermaidConfigMap } from '../mermaid-source.ts'

// ---- Result ---------------------------------------------------------------

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }
export function ok<T, E = never>(value: T): Result<T, E> { return { ok: true, value } }
export function err<E, T = never>(error: E): Result<T, E> { return { ok: false, error } }

// ---- Families -------------------------------------------------------------

export type DiagramKind =
  | 'flowchart' | 'state' | 'sequence' | 'class' | 'er'
  | 'timeline' | 'journey' | 'xychart' | 'architecture'

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

export interface SequenceBody {
  kind: 'sequence'
  participants: SequenceParticipant[]
  messages: SequenceMessage[]
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
}

export interface SourceMap {
  nodes: Map<string, { line: number; col: number }>
  edges: Map<string, { line: number; col: number }>
  groups: Map<string, { line: number; col: number }>
}

export type DiagramBody =
  | { kind: 'flowchart'; graph: MermaidGraph }
  | SequenceBody
  | { kind: 'opaque'; family: DiagramKind; source: string }

export interface ValidDiagram {
  readonly kind: DiagramKind
  readonly meta: ValidDiagramMeta
  readonly body: DiagramBody
  readonly source: SourceMap
  /** Load-bearing round-trip pillar. See AGENT_NATIVE.md § (3). */
  readonly canonicalSource: string
}

export type FlowchartValidDiagram = ValidDiagram & { body: { kind: 'flowchart'; graph: MermaidGraph } }
export type SequenceValidDiagram = ValidDiagram & { body: SequenceBody }
export type MutableValidDiagram = FlowchartValidDiagram | SequenceValidDiagram

export function asFlowchart(d: ValidDiagram): FlowchartValidDiagram | null {
  return d.body.kind === 'flowchart' ? (d as FlowchartValidDiagram) : null
}
export function asSequence(d: ValidDiagram): SequenceValidDiagram | null {
  return d.body.kind === 'sequence' ? (d as SequenceValidDiagram) : null
}

// ---- Errors ---------------------------------------------------------------

export interface ParseError { code: string; message: string; line?: number; col?: number }

export interface MutationError {
  code:
    | 'NODE_NOT_FOUND' | 'EDGE_NOT_FOUND'
    | 'PARTICIPANT_NOT_FOUND' | 'MESSAGE_NOT_FOUND'
    | 'DUPLICATE_NODE' | 'DUPLICATE_PARTICIPANT'
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

export type AnyMutationOp = FlowchartMutationOp | SequenceMutationOp
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
export type WarningTier = 'structural' | 'geometric'

export type Tier1WarningCode =
  | 'EMPTY_DIAGRAM' | 'EDGE_MISANCHORED' | 'OFF_CANVAS'
  | 'GROUP_BREACH' | 'UNKNOWN_SHAPE' | 'LABEL_OVERFLOW'
export type Tier2WarningCode = 'NODE_OVERLAP' | 'ROUTE_SELF_CROSS'
export type WarningCode = Tier1WarningCode | Tier2WarningCode

export type LayoutWarning =
  | { code: 'EMPTY_DIAGRAM' }
  | { code: 'EDGE_MISANCHORED'; edge: EdgeId; from?: NodeId; to?: NodeId }
  | { code: 'OFF_CANVAS'; target: NodeId | EdgeId; axis: 'x' | 'y' }
  | { code: 'GROUP_BREACH'; group: GroupId; member: NodeId }
  | { code: 'UNKNOWN_SHAPE'; node: NodeId; shape: string }
  | { code: 'LABEL_OVERFLOW'; target: NodeId | EdgeId; charCount: number; limit: number }
  | { code: 'NODE_OVERLAP'; a: NodeId; b: NodeId; areaPx: number }
  | { code: 'ROUTE_SELF_CROSS'; edge: EdgeId; count: number }

export const WARNING_SEVERITY: Record<WarningCode, WarningSeverity> = {
  EMPTY_DIAGRAM: 'error',
  EDGE_MISANCHORED: 'error',
  OFF_CANVAS: 'error',
  GROUP_BREACH: 'error',
  UNKNOWN_SHAPE: 'warning',
  LABEL_OVERFLOW: 'warning',
  NODE_OVERLAP: 'warning',
  ROUTE_SELF_CROSS: 'warning',
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
    | SequenceBody
    | { kind: 'opaque'; family: DiagramKind; source: string }
}
