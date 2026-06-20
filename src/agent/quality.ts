// ============================================================================
// Perceptual quality metrics for rendered diagrams.
//
// Deterministic, layout-derived metrics — meant for CI gating. The numeric
// results are stable across runs because they depend only on the ELK layout
// (which is itself deterministic, see AGENT_NATIVE.md § determinism).
//
// What's measured:
//   - edgeCrossings: number of pairwise edge-segment intersections (excluding
//     shared endpoints). Lower is better.
//   - labelLegibility: fraction of node labels whose rendered length fits the
//     node's width at a 12px font baseline.
//   - whitespaceBalance: ratio of node-occupied area to total canvas area
//     (0..1). Targets a band — too dense AND too sparse both lose points.
//   - labelEdgeProximity: min pixel distance between any edge-label bbox and
//     the nearest non-attached node bbox, other edge-label bbox, or non-own
//     edge path. Lower means labels overlap nodes, edges, or each other.
//   - aspectRatio: canvas width/height. Used as a sanity check, not a gate.
// ============================================================================

import type { RenderedLayout, RenderedLayoutNode, RenderedLayoutEdge } from './types.ts'
import { measureMultilineText } from '../text-metrics.ts'
import { FONT_SIZES, FONT_WEIGHTS } from '../styles.ts'

export interface QualityMetrics {
  edgeCrossings: number
  labelLegibility: number  // 0..1 — fraction of labels that fit
  whitespaceBalance: number  // 0..1 — fill ratio
  labelEdgeProximity: number  // pixels; Infinity if no edge labels
  aspectRatio: number  // w/h; Infinity if h=0
  nodeCount: number
  edgeCount: number
}

export interface QualityBounds {
  /** Max edge crossings per (edge × edge) pair. Default 0.05 = 5%. */
  maxCrossingsRatio?: number
  /** Min label legibility. Default 0.85 = 85% of labels fit. */
  minLabelLegibility?: number
  /** Whitespace fill band [min, max]. Default [0.05, 0.55]. */
  whitespaceBand?: [number, number]
  /** Min pixels between any edge-label bbox and a non-attached node, another edge-label, or another edge path. Default 4. */
  minLabelEdgeProximity?: number
  /** Aspect ratio band [min, max]. Default [0.2, 5.0]. */
  aspectBand?: [number, number]
}

export const DEFAULT_BOUNDS: Required<QualityBounds> = {
  maxCrossingsRatio: 0.05,
  minLabelLegibility: 0.85,
  whitespaceBand: [0.05, 0.55],
  minLabelEdgeProximity: 4,
  aspectBand: [0.2, 5.0],
}

// ---- provenance + severity -------------------------------------------------
//
// The bands above are a mix of evidence-backed and chosen thresholds, and
// pretending they are equally well-founded is dishonest (quality.md: "we do
// not claim our metrics match a human designer's eye"). The graph-drawing
// aesthetics literature — Purchase, "Which Aesthetic Has the Greatest Effect
// on Human Understanding?" (GD 1997) and "Metrics for Graph Drawing
// Aesthetics" (JVLC 2002) — measured, with human subjects, that minimizing
// EDGE CROSSINGS dominates comprehension; bends and symmetry matter far less;
// and aspect ratio is a sanity bound, not an aesthetic. We record that
// provenance here so a reader knows which violation to weight, and so future
// recalibration starts from the evidence rather than from feel.

export type BoundBasis =
  | 'evidence'   // backed by human-subject graph-drawing studies
  | 'derived'    // mechanical correctness (labels must physically fit)
  | 'chosen'     // plausible heuristic, not validated against human perception
  | 'sanity'     // a guardrail against the absurd, not an aesthetic target

export type ViolationSeverity =
  | 'primary'    // the aesthetic with the strongest evidence of impact
  | 'secondary'  // measurable but weaker human-comprehension impact
  | 'sanity'     // out-of-range guardrail, not a quality verdict

export interface BoundProvenance {
  basis: BoundBasis
  severity: ViolationSeverity
  note: string
}

/** Per-metric provenance. Keyed by the QualityMetrics field each bound gates. */
export const BOUND_PROVENANCE: Record<
  'edgeCrossings' | 'labelLegibility' | 'whitespaceBalance' | 'labelEdgeProximity' | 'aspectRatio',
  BoundProvenance
> = {
  edgeCrossings: {
    basis: 'evidence', severity: 'primary',
    note: 'Crossings are the single aesthetic with the strongest human-subject evidence (Purchase 1997/2002). Weight this violation highest.',
  },
  labelLegibility: {
    basis: 'derived', severity: 'secondary',
    note: 'Labels that exceed node width are mechanically unreadable; the 7px/char model under-estimates fit under condensed fonts.',
  },
  labelEdgeProximity: {
    basis: 'chosen', severity: 'secondary',
    note: 'Edge-labels overlapping nodes hurt readability, but the 4px floor is chosen, not validated against perception.',
  },
  whitespaceBalance: {
    basis: 'chosen', severity: 'secondary',
    note: 'A node/canvas fill band is a rough proxy for "too sparse / too dense"; the literature gives weak support and the band is hand-set.',
  },
  aspectRatio: {
    basis: 'sanity', severity: 'sanity',
    note: 'Aspect ratio is a guardrail against absurd canvases, not an aesthetic; Purchase did not find it drives comprehension.',
  },
}

const CHAR_PX = 7  // approx character width at 12px font
const EDGE_LABEL_BOX_PADDING = 8
const GEOM_EPS = 1e-9

export function measureQuality(layout: RenderedLayout): QualityMetrics {
  return {
    edgeCrossings: countEdgeCrossings(layout.edges),
    labelLegibility: measureLabelLegibility(layout.nodes),
    whitespaceBalance: measureWhitespaceBalance(layout),
    labelEdgeProximity: measureLabelEdgeProximity(layout),
    aspectRatio: layout.bounds.h > 0 ? layout.bounds.w / layout.bounds.h : Infinity,
    nodeCount: layout.nodes.length,
    edgeCount: layout.edges.length,
  }
}

export interface RankedViolation {
  metric: keyof typeof BOUND_PROVENANCE
  severity: ViolationSeverity
  message: string
}

export interface QualityVerdict {
  ok: boolean
  metrics: QualityMetrics
  /** Human-readable violation strings. Backward-compatible. */
  violations: string[]
  /**
   * The same violations, each tagged with its evidence-based severity so a
   * consumer can weight a crossings violation above a whitespace one
   * (Purchase 1997/2002). Ordered primary → secondary → sanity.
   */
  ranked: RankedViolation[]
}

export function checkQuality(layout: RenderedLayout, bounds: QualityBounds = {}): QualityVerdict {
  const b = { ...DEFAULT_BOUNDS, ...bounds }
  const m = measureQuality(layout)
  const ranked: RankedViolation[] = []
  const flag = (metric: keyof typeof BOUND_PROVENANCE, message: string) =>
    ranked.push({ metric, severity: BOUND_PROVENANCE[metric].severity, message })
  const pairs = Math.max(1, m.edgeCount * (m.edgeCount - 1) / 2)
  if (m.edgeCrossings / pairs > b.maxCrossingsRatio) {
    flag('edgeCrossings', `edge crossings ${m.edgeCrossings}/${pairs} (${(m.edgeCrossings / pairs * 100).toFixed(1)}%) > cap ${(b.maxCrossingsRatio * 100).toFixed(1)}%`)
  }
  if (m.labelLegibility < b.minLabelLegibility) {
    flag('labelLegibility', `label legibility ${(m.labelLegibility * 100).toFixed(0)}% < min ${(b.minLabelLegibility * 100).toFixed(0)}%`)
  }
  if (m.whitespaceBalance < b.whitespaceBand[0] || m.whitespaceBalance > b.whitespaceBand[1]) {
    flag('whitespaceBalance', `whitespace balance ${(m.whitespaceBalance * 100).toFixed(1)}% outside band [${b.whitespaceBand[0] * 100}–${b.whitespaceBand[1] * 100}]%`)
  }
  if (m.labelEdgeProximity < b.minLabelEdgeProximity) {
    flag('labelEdgeProximity', `edge-label clearance ${m.labelEdgeProximity}px < min ${b.minLabelEdgeProximity}px`)
  }
  if (m.aspectRatio < b.aspectBand[0] || m.aspectRatio > b.aspectBand[1]) {
    flag('aspectRatio', `aspect ratio ${m.aspectRatio.toFixed(2)} outside band [${b.aspectBand[0]}–${b.aspectBand[1]}]`)
  }
  const order: Record<ViolationSeverity, number> = { primary: 0, secondary: 1, sanity: 2 }
  ranked.sort((x, y) => order[x.severity] - order[y.severity])
  return { ok: ranked.length === 0, metrics: m, violations: ranked.map(v => v.message), ranked }
}

// ---- crossings -----------------------------------------------------------

function countEdgeCrossings(edges: RenderedLayoutEdge[]): number {
  let count = 0
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const a = edges[i]!, b = edges[j]!
      // Shared endpoints — not a "crossing" in the visual sense.
      const shared = a.from === b.from || a.from === b.to || a.to === b.from || a.to === b.to
      const ap = a.path, bp = b.path
      for (let ai = 0; ai < ap.length - 1; ai++) {
        for (let bi = 0; bi < bp.length - 1; bi++) {
          if (shared && (ai === 0 || ai === ap.length - 2) && (bi === 0 || bi === bp.length - 2)) continue
          if (segmentsCross(ap[ai]!, ap[ai + 1]!, bp[bi]!, bp[bi + 1]!)) count++
        }
      }
    }
  }
  return count
}

function segmentsCross(p1: [number, number], p2: [number, number], p3: [number, number], p4: [number, number]): boolean {
  const d = (a: [number, number], b: [number, number], c: [number, number]): number =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2)
  const d3 = d(p1, p2, p3), d4 = d(p1, p2, p4)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

// ---- label legibility -----------------------------------------------------

function measureLabelLegibility(nodes: RenderedLayoutNode[]): number {
  if (nodes.length === 0) return 1
  let fits = 0
  for (const n of nodes) {
    if (!n.label) { fits++; continue }
    const renderedWidth = n.label.length * CHAR_PX
    if (renderedWidth <= n.w) fits++
  }
  return fits / nodes.length
}

// ---- whitespace balance --------------------------------------------------

function measureWhitespaceBalance(layout: RenderedLayout): number {
  const total = layout.bounds.w * layout.bounds.h
  if (total <= 0) return 0
  let filled = 0
  for (const n of layout.nodes) filled += n.w * n.h
  return Math.min(1, filled / total)
}

// ---- edge-label proximity ------------------------------------------------

interface Rect { x: number; y: number; w: number; h: number }
type Point = [number, number]

function nodeBox(n: RenderedLayoutNode): Rect {
  return { x: n.x, y: n.y, w: n.w, h: n.h }
}

function edgeLabelBox(label: NonNullable<RenderedLayoutEdge['label']>): Rect {
  const metrics = measureMultilineText(label.text, FONT_SIZES.edgeLabel, FONT_WEIGHTS.edgeLabel)
  const w = metrics.width + EDGE_LABEL_BOX_PADDING * 2
  const h = metrics.height + EDGE_LABEL_BOX_PADDING * 2
  return { x: label.x - w / 2, y: label.y - h / 2, w, h }
}

function rectDistance(a: Rect, b: Rect): number {
  const dx = Math.max(0, Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w)))
  const dy = Math.max(0, Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h)))
  return Math.hypot(dx, dy)
}

function pointInRect(p: Point, r: Rect): boolean {
  return p[0] >= r.x && p[0] <= r.x + r.w && p[1] >= r.y && p[1] <= r.y + r.h
}

function pointToRectDistance(p: Point, r: Rect): number {
  const dx = Math.max(0, Math.max(r.x - p[0], p[0] - (r.x + r.w)))
  const dy = Math.max(0, Math.max(r.y - p[1], p[1] - (r.y + r.h)))
  return Math.hypot(dx, dy)
}

function pointToSegmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.hypot(p[0] - a[0], p[1] - a[1])

  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq))
  const projX = a[0] + t * dx
  const projY = a[1] + t * dy
  return Math.hypot(p[0] - projX, p[1] - projY)
}

function segmentsIntersectInclusive(a: Point, b: Point, c: Point, d: Point): boolean {
  const orient = (p: Point, q: Point, r: Point): number =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  const onSegment = (p: Point, q: Point, r: Point): boolean =>
    q[0] >= Math.min(p[0], r[0]) - GEOM_EPS && q[0] <= Math.max(p[0], r[0]) + GEOM_EPS &&
    q[1] >= Math.min(p[1], r[1]) - GEOM_EPS && q[1] <= Math.max(p[1], r[1]) + GEOM_EPS

  const o1 = orient(a, b, c)
  const o2 = orient(a, b, d)
  const o3 = orient(c, d, a)
  const o4 = orient(c, d, b)
  if (Math.abs(o1) <= GEOM_EPS && onSegment(a, c, b)) return true
  if (Math.abs(o2) <= GEOM_EPS && onSegment(a, d, b)) return true
  if (Math.abs(o3) <= GEOM_EPS && onSegment(c, a, d)) return true
  if (Math.abs(o4) <= GEOM_EPS && onSegment(c, b, d)) return true
  return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0)
}

function segmentIntersectsRect(a: Point, b: Point, r: Rect): boolean {
  if (pointInRect(a, r) || pointInRect(b, r)) return true

  const topLeft: Point = [r.x, r.y]
  const topRight: Point = [r.x + r.w, r.y]
  const bottomRight: Point = [r.x + r.w, r.y + r.h]
  const bottomLeft: Point = [r.x, r.y + r.h]
  return segmentsIntersectInclusive(a, b, topLeft, topRight) ||
    segmentsIntersectInclusive(a, b, topRight, bottomRight) ||
    segmentsIntersectInclusive(a, b, bottomRight, bottomLeft) ||
    segmentsIntersectInclusive(a, b, bottomLeft, topLeft)
}

function rectToSegmentDistance(r: Rect, a: Point, b: Point): number {
  if (segmentIntersectsRect(a, b, r)) return 0

  const corners: Point[] = [
    [r.x, r.y],
    [r.x + r.w, r.y],
    [r.x + r.w, r.y + r.h],
    [r.x, r.y + r.h],
  ]
  return Math.min(
    pointToRectDistance(a, r),
    pointToRectDistance(b, r),
    ...corners.map(c => pointToSegmentDistance(c, a, b)),
  )
}

function measureLabelEdgeProximity(layout: RenderedLayout): number {
  let min = Infinity
  const labels = layout.edges
    .filter((e): e is RenderedLayoutEdge & { label: NonNullable<RenderedLayoutEdge['label']> } => e.label !== undefined)
    .map(e => ({ edge: e, box: edgeLabelBox(e.label) }))

  for (const { edge, box } of labels) {
    for (const n of layout.nodes) {
      if (n.id === edge.from || n.id === edge.to) continue
      const d = rectDistance(box, nodeBox(n))
      if (d < min) min = d
    }
  }
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      const d = rectDistance(labels[i]!.box, labels[j]!.box)
      if (d < min) min = d
    }
  }
  for (const { edge, box } of labels) {
    for (const other of layout.edges) {
      if (other === edge) continue
      for (let i = 0; i < other.path.length - 1; i++) {
        const d = rectToSegmentDistance(box, other.path[i]!, other.path[i + 1]!)
        if (d < min) min = d
      }
    }
  }
  return min
}
