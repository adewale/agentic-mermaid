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
//   - labelEdgeProximity: min pixel distance between any edge-label and the
//     nearest non-attached node bbox. Lower means labels overlap nodes.
//   - aspectRatio: canvas width/height. Used as a sanity check, not a gate.
// ============================================================================

import type { RenderedLayout, RenderedLayoutNode, RenderedLayoutEdge } from './types.ts'

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
  /** Min pixels between any edge-label and a non-attached node. Default 4. */
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
    flag('labelEdgeProximity', `label-edge proximity ${m.labelEdgeProximity}px < min ${b.minLabelEdgeProximity}px`)
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

// ---- label-edge proximity ------------------------------------------------

function measureLabelEdgeProximity(layout: RenderedLayout): number {
  let min = Infinity
  for (const e of layout.edges) {
    if (!e.label) continue
    for (const n of layout.nodes) {
      if (n.id === e.from || n.id === e.to) continue
      const dx = Math.max(0, Math.max(n.x - e.label.x, e.label.x - (n.x + n.w)))
      const dy = Math.max(0, Math.max(n.y - e.label.y, e.label.y - (n.y + n.h)))
      const d = Math.sqrt(dx * dx + dy * dy)
      if (d < min) min = d
    }
  }
  return min
}
