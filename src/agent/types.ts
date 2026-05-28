// ============================================================================
// Agent-Native Beautiful Mermaid — IR and verb types
//
// Second pass, informed by what the v1 build taught us:
//   - canonicalSource is the load-bearing round-trip pillar, not a fallback.
//   - mutate's input type is narrowed to FlowchartValidDiagram. Other families
//     don't typecheck — agents get a compile error rather than a runtime
//     UNSUPPORTED_FAMILY rejection.
//   - LayoutWarning split into Tier 1 (structural, reliable) and Tier 2
//     (metric, best-effort).
//   - Branded Finite is a real type (toFinite throws on NaN/Infinity).
//
// See AGENT_NATIVE.md for the design.
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

export type DiagramBody =
  | { kind: 'flowchart'; graph: MermaidGraph }
  | { kind: 'opaque'; family: DiagramKind; source: string }

/**
 * The canonical agent IR. Constructed only by `parseMermaid` and `mutate`.
 *
 * `canonicalSource` is the round-trip pillar: every reachable ValidDiagram
 * has a canonical preprocessed form, and `serializeMermaid` emits that form
 * (re-attaching meta) for opaque families. For flowchart + state, serialize
 * emits a fresh canonical form from the structured graph.
 */
export interface ValidDiagram {
  readonly kind: DiagramKind
  readonly meta: ValidDiagramMeta
  readonly body: DiagramBody
  readonly source: SourceMap
  readonly canonicalSource: string
}

/**
 * Narrowed ValidDiagram for diagrams whose body is structured (flowchart and
 * state share the same body shape). `mutate` accepts only this type at the
 * type level. Use `asFlowchart()` to narrow from `ValidDiagram`.
 */
export type FlowchartValidDiagram = ValidDiagram & {
  body: { kind: 'flowchart'; graph: MermaidGraph }
}

export function asFlowchart(d: ValidDiagram): FlowchartValidDiagram | null {
  return d.body.kind === 'flowchart' ? (d as FlowchartValidDiagram) : null
}

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
  | { kind: 'add_edge'; from: NodeId; to: NodeId; label?: string; style?: EdgeStyle }
  | { kind: 'remove_edge'; id: EdgeId }

// ---- LayoutContext -------------------------------------------------------

export interface SeededRNG {
  next(): number
  fork(): SeededRNG
}

export interface FontMetric {
  width: number
  height: number
}

export interface MetricsTable {
  family: string
  size: number
  baseCharWidth: number
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
  basePath?: string
}

// ---- Branded Finite -------------------------------------------------------

declare const FINITE_BRAND: unique symbol
export type Finite = number & { readonly [FINITE_BRAND]: true }

export function toFinite(n: number): Finite {
  if (!Number.isFinite(n)) {
    throw new RangeError(`expected a finite number, got ${String(n)}`)
  }
  return n as Finite
}

// ---- Verify --------------------------------------------------------------

export type WarningSeverity = 'error' | 'warning'
export type WarningTier = 'structural' | 'metric'

export type StructuralWarningCode =
  | 'EMPTY_DIAGRAM'
  | 'EDGE_MISANCHORED'
  | 'OFF_CANVAS'
  | 'GROUP_BREACH'
  | 'UNKNOWN_SHAPE'

export type MetricWarningCode =
  | 'LABEL_OVERFLOW'
  | 'NODE_OVERLAP'
  | 'ROUTE_SELF_CROSS'

export type WarningCode = StructuralWarningCode | MetricWarningCode

export type LayoutWarning =
  | { code: 'EMPTY_DIAGRAM' }
  | { code: 'EDGE_MISANCHORED'; edge: EdgeId; from?: NodeId; to?: NodeId }
  | { code: 'OFF_CANVAS'; target: NodeId | EdgeId; axis: 'x' | 'y' }
  | { code: 'GROUP_BREACH'; group: GroupId; member: NodeId }
  | { code: 'UNKNOWN_SHAPE'; node: NodeId; shape: string }
  | { code: 'LABEL_OVERFLOW'; target: NodeId | EdgeId; overflowPx: number }
  | { code: 'NODE_OVERLAP'; a: NodeId; b: NodeId; areaPx: number }
  | { code: 'ROUTE_SELF_CROSS'; edge: EdgeId; count: number }

export const WARNING_SEVERITY: Record<WarningCode, WarningSeverity> = {
  // Tier 1 — structural
  EMPTY_DIAGRAM: 'error',
  EDGE_MISANCHORED: 'error',
  OFF_CANVAS: 'error',
  GROUP_BREACH: 'error',
  UNKNOWN_SHAPE: 'warning',
  // Tier 2 — metric (best-effort)
  LABEL_OVERFLOW: 'error',
  NODE_OVERLAP: 'warning',
  ROUTE_SELF_CROSS: 'warning',
}

export const WARNING_TIER: Record<WarningCode, WarningTier> = {
  EMPTY_DIAGRAM: 'structural',
  EDGE_MISANCHORED: 'structural',
  OFF_CANVAS: 'structural',
  GROUP_BREACH: 'structural',
  UNKNOWN_SHAPE: 'structural',
  LABEL_OVERFLOW: 'metric',
  NODE_OVERLAP: 'metric',
  ROUTE_SELF_CROSS: 'metric',
}

export interface VerifyOptions {
  suppress?: WarningCode[]
  layoutContext?: LayoutContext
}

export interface RenderedLayoutNode {
  id: NodeId
  x: Finite
  y: Finite
  w: Finite
  h: Finite
  shape: string
  label?: string
}

export interface RenderedLayoutEdge {
  id: EdgeId
  from: NodeId
  to: NodeId
  path: [Finite, Finite][]
  label?: { x: Finite; y: Finite; text: string }
}

export interface RenderedLayoutGroup {
  id: GroupId
  x: Finite
  y: Finite
  w: Finite
  h: Finite
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
  bounds: { w: Finite; h: Finite }
}

export interface VerifyResult {
  ok: boolean
  warnings: LayoutWarning[]
  layout: RenderedLayout
}
