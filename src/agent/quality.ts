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

export interface QualityVerdict {
  ok: boolean
  metrics: QualityMetrics
  violations: string[]
}

export function checkQuality(layout: RenderedLayout, bounds: QualityBounds = {}): QualityVerdict {
  const b = { ...DEFAULT_BOUNDS, ...bounds }
  const m = measureQuality(layout)
  const violations: string[] = []
  const pairs = Math.max(1, m.edgeCount * (m.edgeCount - 1) / 2)
  if (m.edgeCrossings / pairs > b.maxCrossingsRatio) {
    violations.push(`edge crossings ${m.edgeCrossings}/${pairs} (${(m.edgeCrossings / pairs * 100).toFixed(1)}%) > cap ${(b.maxCrossingsRatio * 100).toFixed(1)}%`)
  }
  if (m.labelLegibility < b.minLabelLegibility) {
    violations.push(`label legibility ${(m.labelLegibility * 100).toFixed(0)}% < min ${(b.minLabelLegibility * 100).toFixed(0)}%`)
  }
  if (m.whitespaceBalance < b.whitespaceBand[0] || m.whitespaceBalance > b.whitespaceBand[1]) {
    violations.push(`whitespace balance ${(m.whitespaceBalance * 100).toFixed(1)}% outside band [${b.whitespaceBand[0] * 100}–${b.whitespaceBand[1] * 100}]%`)
  }
  if (m.labelEdgeProximity < b.minLabelEdgeProximity) {
    violations.push(`label-edge proximity ${m.labelEdgeProximity}px < min ${b.minLabelEdgeProximity}px`)
  }
  if (m.aspectRatio < b.aspectBand[0] || m.aspectRatio > b.aspectBand[1]) {
    violations.push(`aspect ratio ${m.aspectRatio.toFixed(2)} outside band [${b.aspectBand[0]}–${b.aspectBand[1]}]`)
  }
  return { ok: violations.length === 0, metrics: m, violations }
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
