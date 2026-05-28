// ============================================================================
// Agent-Native Beautiful Mermaid — IR and verb types
//
// See AGENT_NATIVE.md for the design. The shapes here are the contract surface
// agents and tooling reason about. Codes and MutationOp kinds are doc-sync
// tested against the LayoutWarning / MutationOp tables in AGENT_NATIVE.md.
// ============================================================================

import type { MermaidGraph, NodeShape, EdgeStyle } from '../types.ts'
import type { MermaidFrontmatterMap, MermaidConfigMap } from '../mermaid-source.ts'

// ---- Result type ----------------------------------------------------------

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }

export function ok<T, E = never>(value: T): Result<T, E> {
  return { ok: true, value }
}

export function err<E, T = never>(error: E): Result<T, E> {
  return { ok: false, error }
}

// ---- Diagram families -----------------------------------------------------

export type DiagramKind =
  | 'flowchart'
  | 'state'
  | 'sequence'
  | 'class'
  | 'er'
  | 'timeline'
  | 'journey'
  | 'xychart'
  | 'architecture'

// ---- ValidDiagram ---------------------------------------------------------

export interface SourceComment {
  text: string
  line: number
}

export interface InitDirective {
  raw: string
  parsed: MermaidConfigMap
}

export interface Accessibility {
  title?: string
  descr?: string
}

export interface ValidDiagramMeta {
  frontmatter?: MermaidFrontmatterMap
  initDirectives: InitDirective[]
  comments: SourceComment[]
  accessibility: Accessibility
}

/**
 * Source-position map: identifier → (line, col) in the canonical (preprocessed)
 * source. Used by agent tools to point at specific elements.
 */
export interface SourceMap {
  nodes: Map<string, { line: number; col: number }>
  edges: Map<string, { line: number; col: number }>
  groups: Map<string, { line: number; col: number }>
}

/**
 * The canonical agent IR. Constructed only by `parseMermaid` and `mutate`.
 * A lint rule (and convention) bans construction elsewhere.
 *
 * `body` is family-specific. For flowchart it's a MermaidGraph. For families
 * not yet fully covered in the agent surface, `body` is { kind: 'opaque',
 * source: string } and round-trip is by source preservation.
 */
export interface ValidDiagram {
  readonly kind: DiagramKind
  readonly meta: ValidDiagramMeta
  readonly body: DiagramBody
  readonly source: SourceMap
  /** Canonical preprocessed source. Carried for round-trip on opaque families. */
  readonly canonicalSource: string
}

export type DiagramBody =
  | { kind: 'flowchart'; graph: MermaidGraph }
  | { kind: 'opaque'; family: DiagramKind; source: string }

// ---- Errors --------------------------------------------------------------

export interface ParseError {
  code: string
  message: string
  line?: number
  col?: number
}

export interface MutationError {
  code:
    | 'NODE_NOT_FOUND'
    | 'EDGE_NOT_FOUND'
    | 'DUPLICATE_NODE'
    | 'INVALID_OP'
    | 'UNSUPPORTED_FAMILY'
  message: string
}

// ---- MutationOp ----------------------------------------------------------

export type NodeId = string
export type EdgeId = string
export type GroupId = string

export type MutationOp =
  | { kind: 'add_node'; id: NodeId; label: string; shape?: NodeShape; parent?: GroupId }
  | { kind: 'remove_node'; id: NodeId }
  | { kind: 'rename_node'; from: NodeId; to: NodeId }
  | { kind: 'set_label'; target: NodeId | EdgeId; label: string }
  | {
      kind: 'add_edge'
      from: NodeId
      to: NodeId
      label?: string
      style?: EdgeStyle
    }
  | { kind: 'remove_edge'; id: EdgeId }

// ---- LayoutContext -------------------------------------------------------

/**
 * Seeded RNG. The default seed is 0. The agent surface uses this for any
 * place ELK (or our own layout) needs a random number, so two runs with the
 * same source and seed produce byte-identical layout JSON.
 *
 * Implementation is a simple LCG; sufficient for layout shuffles, not for
 * security.
 */
export interface SeededRNG {
  next(): number
  fork(): SeededRNG
}

export interface FontMetric {
  width: number
  height: number
}

/**
 * Frozen font-metric table. Keyed by `${family}|${size}|${char}`. The
 * library reads metrics from this table on the deterministic path so
 * layout doesn't depend on platform font measurement.
 */
export interface MetricsTable {
  family: string
  size: number
  /** Char width in px for monospace approximation; per-char overrides in `chars`. */
  baseCharWidth: number
  /** Line height in px. */
  lineHeight: number
  chars: Record<string, FontMetric>
}

export interface Clock {
  now(): number
}

export interface LayoutContext {
  rng: SeededRNG
  fontMetrics: MetricsTable
  clock: Clock
  /** Base path for any future @include resolution; unused in v1. */
  basePath?: string
}

// ---- Verify -------------------------------------------------------------

export type WarningSeverity = 'error' | 'warning'

export type WarningCode =
  | 'LABEL_OVERFLOW'
  | 'OFF_CANVAS'
  | 'EDGE_MISANCHORED'
  | 'GROUP_BREACH'
  | 'EMPTY_DIAGRAM'
  | 'NODE_OVERLAP'
  | 'ROUTE_SELF_CROSS'
  | 'UNKNOWN_SHAPE'

export type LayoutWarning =
  | { code: 'LABEL_OVERFLOW'; target: NodeId | EdgeId; overflowPx: number }
  | { code: 'OFF_CANVAS'; target: NodeId | EdgeId; axis: 'x' | 'y' }
  | { code: 'EDGE_MISANCHORED'; edge: EdgeId; from?: NodeId; to?: NodeId }
  | { code: 'GROUP_BREACH'; group: GroupId; member: NodeId }
  | { code: 'EMPTY_DIAGRAM' }
  | { code: 'NODE_OVERLAP'; a: NodeId; b: NodeId; areaPx: number }
  | { code: 'ROUTE_SELF_CROSS'; edge: EdgeId; count: number }
  | { code: 'UNKNOWN_SHAPE'; node: NodeId; shape: string }

export const WARNING_SEVERITY: Record<WarningCode, WarningSeverity> = {
  LABEL_OVERFLOW: 'error',
  OFF_CANVAS: 'error',
  EDGE_MISANCHORED: 'error',
  GROUP_BREACH: 'error',
  EMPTY_DIAGRAM: 'error',
  NODE_OVERLAP: 'warning',
  ROUTE_SELF_CROSS: 'warning',
  UNKNOWN_SHAPE: 'warning',
}

export interface VerifyOptions {
  suppress?: WarningCode[]
  layoutContext?: LayoutContext
}

export interface RenderedLayoutNode {
  id: NodeId
  x: number
  y: number
  w: number
  h: number
  shape: string
  label?: string
}

export interface RenderedLayoutEdge {
  id: EdgeId
  from: NodeId
  to: NodeId
  path: [number, number][]
  label?: { x: number; y: number; text: string }
}

export interface RenderedLayoutGroup {
  id: GroupId
  x: number
  y: number
  w: number
  h: number
  members: NodeId[]
  label?: string
}

export interface RenderedLayout {
  version: 1
  seed: number
  kind: DiagramKind
  nodes: RenderedLayoutNode[]
  edges: RenderedLayoutEdge[]
  groups: RenderedLayoutGroup[]
  bounds: { w: number; h: number }
}

export interface VerifyResult {
  ok: boolean
  warnings: LayoutWarning[]
  layout: RenderedLayout
}
