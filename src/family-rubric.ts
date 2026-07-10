/**
 * Deterministic FAMILY-GENERIC layout-quality rubric.
 *
 * src/layout-rubric.ts scores the ELK-routed graph families (flowchart/state)
 * from MermaidGraph + PositionedGraph — it cannot see the other ten families.
 * This module is the companion rubric for EVERYTHING ELSE: it consumes the
 * common `RenderedLayout` projection every agent-parsed family already emits
 * (src/agent/family-layouts.ts `layoutFamilyToRendered`, plus the graph path
 * in src/agent/core.ts), so any family — current or future — that projects to
 * RenderedLayout is scored by the same invariants:
 *
 *   • finite geometry (no NaN/Infinity, no negative sizes),
 *   • nodes/edges/groups inside the canvas bounds,
 *   • no text-bearing box overlapping another box (Purchase 1997: overlap is a
 *     readability-destroying defect); data MARKS (points/junctions) may
 *     legitimately coincide, so mark overlap is a SOFT rate, not a HARD count,
 *   • group containment (members inside their group's rect — journey sections
 *     are header BANDS above their tasks, so journey guarantees the x axis
 *     only; the same reason verify.ts leaves groupContainment off for journey),
 *   • group tiling (sibling groups either nest or stay disjoint — a PARTIAL
 *     overlap is a defect; full containment is legitimate nesting, e.g.
 *     sequence blocks and architecture group trees),
 *   • label presence on every text-bearing box.
 *
 * Scores are deterministic numbers with STABLE WEIGHTS (exported below), in
 * the spirit of layout-rubric's fixed metric set: identical input produces
 * identical metrics, violations, and score. This module composes ALONGSIDE
 * layout-rubric (the tracker keeps assessLayout for flowchart); it does not
 * replace it.
 *
 * A journey-specific assessor layers on top. It reads the
 * PositionedJourneyDiagram from layoutJourneyDiagram — NOT the RenderedLayout
 * journey projection — because the projection keeps only task boxes and
 * section bands: the experience-curve markers, actor dots, and score guide
 * (exactly what the renderer rework changed) exist only on the positioned
 * diagram, the same geometry the SVG renderer draws.
 */

import type { RenderedLayout, RenderedLayoutGroup, RenderedLayoutNode, DiagramKind } from './agent/types.ts'
import type { PositionedJourneyDiagram } from './journey/types.ts'

/** Geometry tolerance (px), matching layoutGeometryWarnings / layout-rubric. */
const TOL = 0.5

export interface FamilyRubricViolation {
  metric: string
  detail: string
}

export interface FamilyRubricMetrics {
  nodes: number
  groups: number
  /** HARD (0): NaN/Infinity coordinates or negative sizes anywhere. */
  nonFiniteGeometry: number
  /** HARD (0): nodes/edge points/groups outside the canvas bounds. */
  offCanvas: number
  /** HARD (0): two text-bearing BOXES overlapping (Purchase: readability). */
  nodeOverlaps: number
  /** HARD (0): a group member outside its group's rect (per-family axes). */
  groupBreaches: number
  /** HARD (0): two sibling groups PARTIALLY overlapping (tiling: groups must
   *  nest fully or stay disjoint). */
  groupOverlaps: number
  /** SOFT: overlapping pairs involving a data MARK (point/junction marker)
   *  over all node pairs — marks may legitimately coincide (a line point on a
   *  bar, two quadrant points at one coordinate), so this is a rate to
   *  baseline, not a hard zero. 0 when fewer than two nodes. */
  markOverlapRate: number
  /** SOFT: fraction of text-bearing boxes carrying a non-empty label.
   *  1 when there are no boxes. */
  labelledBoxRate: number
}

export interface FamilyRubricResult {
  metrics: FamilyRubricMetrics
  violations: FamilyRubricViolation[]
  /** Deterministic 0–100 score under FAMILY_RUBRIC_WEIGHTS (higher = better). */
  score: number
}

/** The hard family-rubric metrics — must be zero for every diagram, always. */
export const FAMILY_HARD_METRICS = [
  'nonFiniteGeometry', 'offCanvas', 'nodeOverlaps', 'groupBreaches', 'groupOverlaps',
] as const

/**
 * Stable score weights. Ordered by impact (Purchase 1997/2002: overlap and
 * off-canvas clipping destroy readability outright; tiling and label defects
 * degrade it). Changing a weight is a scoring-contract change: regenerate the
 * heuristic-tracker baseline and say so in the PR.
 */
export const FAMILY_RUBRIC_WEIGHTS = {
  nonFiniteGeometry: 40,
  offCanvas: 12,
  nodeOverlaps: 10,
  groupBreaches: 10,
  groupOverlaps: 8,
  /** Soft: applied as weight × markOverlapRate (a fraction, not a count). */
  markOverlapRate: 10,
  /** Soft: applied as weight × (1 − labelledBoxRate). */
  missingLabelRate: 5,
} as const

/**
 * Shapes that render as text-bearing boxes. Everything else ('circle' line
 * points / quadrant points / architecture junctions) is a data MARK: marks may
 * legitimately coincide, boxes may not.
 */
const BOX_SHAPES = new Set(['rectangle', 'rounded', 'note', 'service', 'diamond', 'stadium', 'hexagon', 'cylinder'])

/**
 * Which containment axes a family's groups guarantee for their members.
 * Journey sections are header BANDS tiled above the task row (the tiled-
 * section rework): a member task is inside its band's x-span but sits below
 * it, so only 'x' applies — mirroring verify.ts, which enables full
 * groupContainment only for the families whose groups are bounding frames.
 * Default (unlisted family): 'both'.
 */
const GROUP_CONTAINMENT_AXES: Partial<Record<DiagramKind, 'both' | 'x' | 'none'>> = {
  journey: 'x',
}

function isBox(node: RenderedLayoutNode): boolean {
  return BOX_SHAPES.has(node.shape)
}

function finiteRect(x: number, y: number, w: number, h: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(w) && Number.isFinite(h) && w >= 0 && h >= 0
}

function rectOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return ox > TOL && oy > TOL
}

function rectContains(outer: RenderedLayoutGroup, inner: RenderedLayoutGroup): boolean {
  return inner.x >= outer.x - TOL && inner.y >= outer.y - TOL &&
    inner.x + inner.w <= outer.x + outer.w + TOL && inner.y + inner.h <= outer.y + outer.h + TOL
}

/** Whether `ancestor` is on `group`'s parentId chain (flattened group trees). */
function isAncestor(ancestor: RenderedLayoutGroup, group: RenderedLayoutGroup, byId: Map<string, RenderedLayoutGroup>): boolean {
  let cur: RenderedLayoutGroup | undefined = group
  for (let hops = 0; cur?.parentId && hops < 100; hops++) {
    if (cur.parentId === ancestor.id) return true
    cur = byId.get(cur.parentId)
  }
  return false
}

/**
 * Score a RenderedLayout against the family-generic rubric. Pure and
 * deterministic: identical input produces identical metrics and score.
 */
export function assessRenderedLayout(layout: RenderedLayout): FamilyRubricResult {
  const violations: FamilyRubricViolation[] = []

  let nonFinite = 0
  let offCanvas = 0

  if (!finiteRect(0, 0, layout.bounds.w, layout.bounds.h)) {
    nonFinite++
    violations.push({ metric: 'nonFiniteGeometry', detail: `bounds ${layout.bounds.w}×${layout.bounds.h}` })
  }

  for (const n of layout.nodes) {
    if (!finiteRect(n.x, n.y, n.w, n.h)) {
      nonFinite++
      violations.push({ metric: 'nonFiniteGeometry', detail: `node ${n.id}` })
      continue
    }
    if (n.x < -TOL || n.y < -TOL || n.x + n.w > layout.bounds.w + TOL || n.y + n.h > layout.bounds.h + TOL) {
      offCanvas++
      violations.push({ metric: 'offCanvas', detail: `node ${n.id} at (${n.x},${n.y}) ${n.w}×${n.h}` })
    }
  }
  for (const e of layout.edges) {
    let flagged = false
    for (const [x, y] of e.path) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        nonFinite++
        violations.push({ metric: 'nonFiniteGeometry', detail: `edge ${e.id} path` })
        flagged = true
        break
      }
      if (!flagged && (x < -TOL || y < -TOL || x > layout.bounds.w + TOL || y > layout.bounds.h + TOL)) {
        offCanvas++
        violations.push({ metric: 'offCanvas', detail: `edge ${e.id} point (${x},${y})` })
        flagged = true
      }
    }
  }
  for (const g of layout.groups) {
    if (!finiteRect(g.x, g.y, g.w, g.h)) {
      nonFinite++
      violations.push({ metric: 'nonFiniteGeometry', detail: `group ${g.id}` })
      continue
    }
    if (g.x < -TOL || g.y < -TOL || g.x + g.w > layout.bounds.w + TOL || g.y + g.h > layout.bounds.h + TOL) {
      offCanvas++
      violations.push({ metric: 'offCanvas', detail: `group ${g.id}` })
    }
  }

  // Node-node overlap: HARD for box-box pairs, SOFT rate for pairs involving a
  // mark (marks may legitimately coincide — a line point on a bar, two
  // quadrant points at one coordinate).
  let nodeOverlaps = 0
  let markOverlaps = 0
  let pairs = 0
  for (let i = 0; i < layout.nodes.length; i++) {
    for (let j = i + 1; j < layout.nodes.length; j++) {
      const a = layout.nodes[i]!, b = layout.nodes[j]!
      if (!finiteRect(a.x, a.y, a.w, a.h) || !finiteRect(b.x, b.y, b.w, b.h)) continue
      pairs++
      if (!rectOverlap(a, b)) continue
      if (isBox(a) && isBox(b)) {
        nodeOverlaps++
        violations.push({ metric: 'nodeOverlaps', detail: `${a.id} overlaps ${b.id}` })
      } else {
        markOverlaps++
      }
    }
  }

  // Group containment, honouring each family's guaranteed axes.
  const axes = GROUP_CONTAINMENT_AXES[layout.kind] ?? 'both'
  let groupBreaches = 0
  if (axes !== 'none') {
    const nodeById = new Map(layout.nodes.map(n => [n.id, n]))
    for (const g of layout.groups) {
      for (const memberId of g.members) {
        const n = nodeById.get(memberId)
        if (!n || !finiteRect(n.x, n.y, n.w, n.h)) continue
        const xOk = n.x >= g.x - TOL && n.x + n.w <= g.x + g.w + TOL
        const yOk = axes === 'x' || (n.y >= g.y - TOL && n.y + n.h <= g.y + g.h + TOL)
        if (!xOk || !yOk) {
          groupBreaches++
          violations.push({ metric: 'groupBreaches', detail: `${memberId} outside ${g.id}` })
        }
      }
    }
  }

  // Group tiling: sibling groups must nest fully or stay disjoint. Ancestry is
  // checked both via parentId (architecture's flattened tree) and geometric
  // containment (sequence blocks nest without parentId).
  let groupOverlaps = 0
  const groupById = new Map(layout.groups.map(g => [g.id, g]))
  for (let i = 0; i < layout.groups.length; i++) {
    for (let j = i + 1; j < layout.groups.length; j++) {
      const a = layout.groups[i]!, b = layout.groups[j]!
      if (!finiteRect(a.x, a.y, a.w, a.h) || !finiteRect(b.x, b.y, b.w, b.h)) continue
      if (!rectOverlap(a, b)) continue
      if (rectContains(a, b) || rectContains(b, a)) continue
      if (isAncestor(a, b, groupById) || isAncestor(b, a, groupById)) continue
      groupOverlaps++
      violations.push({ metric: 'groupOverlaps', detail: `${a.id} partially overlaps ${b.id}` })
    }
  }

  // Label presence on text-bearing boxes.
  const boxes = layout.nodes.filter(isBox)
  const labelledBoxes = boxes.filter(n => (n.label ?? '').trim().length > 0)
  for (const n of boxes) {
    if ((n.label ?? '').trim().length === 0) violations.push({ metric: 'missingLabel', detail: `box ${n.id} has no label` })
  }

  const metrics: FamilyRubricMetrics = {
    nodes: layout.nodes.length,
    groups: layout.groups.length,
    nonFiniteGeometry: nonFinite,
    offCanvas,
    nodeOverlaps,
    groupBreaches,
    groupOverlaps,
    markOverlapRate: pairs === 0 ? 0 : markOverlaps / pairs,
    labelledBoxRate: boxes.length === 0 ? 1 : labelledBoxes.length / boxes.length,
  }

  const w = FAMILY_RUBRIC_WEIGHTS
  const score = Math.max(0, Math.round((
    100
    - w.nonFiniteGeometry * metrics.nonFiniteGeometry
    - w.offCanvas * metrics.offCanvas
    - w.nodeOverlaps * metrics.nodeOverlaps
    - w.groupBreaches * metrics.groupBreaches
    - w.groupOverlaps * metrics.groupOverlaps
    - w.markOverlapRate * metrics.markOverlapRate
    - w.missingLabelRate * (1 - metrics.labelledBoxRate)
  ) * 10) / 10)

  return { metrics, violations, score }
}

export function familyHardViolations(result: FamilyRubricResult): FamilyRubricViolation[] {
  const hard = new Set<string>(FAMILY_HARD_METRICS)
  return result.violations.filter(v => hard.has(v.metric))
}

// ============================================================================
// Journey-specific assessor
// ============================================================================

export interface JourneyRubricMetrics {
  sections: number
  tasks: number
  /** HARD (0): section spans overlapping in x — spans must tile. */
  sectionSpanOverlaps: number
  /** HARD (0): a task's score marker off its column center (marker.cx must
   *  equal the task's centerX — the experience curve reads per-column). */
  markerOffCenter: number
  /** HARD (0): score→y ordering violations — a HIGHER score must sit STRICTLY
   *  higher (smaller y), equal scores at equal y, and the score-guide ticks
   *  must run 5 (top) … 1 (bottom). */
  scoreOrderViolations: number
  /** HARD (0): an actor dot escaping its task's box. */
  actorDotsOutsideTask: number
}

export interface JourneyRubricResult {
  metrics: JourneyRubricMetrics
  violations: FamilyRubricViolation[]
  /** Deterministic 0–100 score under JOURNEY_RUBRIC_WEIGHTS. */
  score: number
}

/** Stable weights for the journey assessor — same contract as above. */
export const JOURNEY_RUBRIC_WEIGHTS = {
  sectionSpanOverlaps: 15,
  markerOffCenter: 10,
  scoreOrderViolations: 15,
  actorDotsOutsideTask: 5,
} as const

/**
 * Score a positioned journey diagram against the journey-specific invariants
 * the RenderedLayout projection cannot see (markers, dots, score guide). Every
 * journey metric is HARD: the layout produces these properties by
 * construction, so any violation means a later pass broke the geometry.
 */
export function assessJourneyLayout(positioned: PositionedJourneyDiagram): JourneyRubricResult {
  const violations: FamilyRubricViolation[] = []

  // Section spans tile in x: pairwise interval overlap beyond tolerance.
  let sectionSpanOverlaps = 0
  for (let i = 0; i < positioned.sections.length; i++) {
    for (let j = i + 1; j < positioned.sections.length; j++) {
      const a = positioned.sections[i]!, b = positioned.sections[j]!
      const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
      if (ox > TOL) {
        sectionSpanOverlaps++
        violations.push({ metric: 'sectionSpanOverlaps', detail: `${a.id} overlaps ${b.id} by ${ox.toFixed(1)}px` })
      }
    }
  }

  const tasks = positioned.sections.flatMap(s => s.tasks)

  // Marker x == column center, actor dots inside the task box.
  let markerOffCenter = 0
  let actorDotsOutsideTask = 0
  for (const t of tasks) {
    if (Math.abs(t.marker.cx - t.centerX) > TOL) {
      markerOffCenter++
      violations.push({ metric: 'markerOffCenter', detail: `${t.id} marker at ${t.marker.cx}, column center ${t.centerX}` })
    }
    for (const d of t.actorDots) {
      const inside = d.x - d.r >= t.x - TOL && d.x + d.r <= t.x + t.width + TOL &&
        d.y - d.r >= t.y - TOL && d.y + d.r <= t.y + t.height + TOL
      if (!inside) {
        actorDotsOutsideTask++
        violations.push({ metric: 'actorDotsOutsideTask', detail: `${t.id} dot for ${d.label} at (${d.x},${d.y})` })
      }
    }
  }

  // Score→y strictly monotone across tasks (score 5 highest ⇒ smallest y),
  // and the guide ticks run 5 (top) … 1 (bottom).
  let scoreOrderViolations = 0
  for (let i = 0; i < tasks.length; i++) {
    for (let j = i + 1; j < tasks.length; j++) {
      const a = tasks[i]!, b = tasks[j]!
      const bad = (a.score > b.score && !(a.marker.cy < b.marker.cy - 1e-6)) ||
        (a.score < b.score && !(b.marker.cy < a.marker.cy - 1e-6)) ||
        (a.score === b.score && Math.abs(a.marker.cy - b.marker.cy) > 1e-6)
      if (bad) {
        scoreOrderViolations++
        violations.push({ metric: 'scoreOrderViolations', detail: `${a.id}(score ${a.score}, y ${a.marker.cy}) vs ${b.id}(score ${b.score}, y ${b.marker.cy})` })
      }
    }
  }
  const ticks = positioned.scoreGuide.ticks
  for (let i = 1; i < ticks.length; i++) {
    const prev = ticks[i - 1]!, cur = ticks[i]!
    if (!(prev.score > cur.score && prev.y < cur.y - 1e-6)) {
      scoreOrderViolations++
      violations.push({ metric: 'scoreOrderViolations', detail: `guide ticks out of order at index ${i} (score ${prev.score}→${cur.score}, y ${prev.y}→${cur.y})` })
    }
  }

  const metrics: JourneyRubricMetrics = {
    sections: positioned.sections.length,
    tasks: tasks.length,
    sectionSpanOverlaps,
    markerOffCenter,
    scoreOrderViolations,
    actorDotsOutsideTask,
  }

  const w = JOURNEY_RUBRIC_WEIGHTS
  const score = Math.max(0, Math.round((
    100
    - w.sectionSpanOverlaps * sectionSpanOverlaps
    - w.markerOffCenter * markerOffCenter
    - w.scoreOrderViolations * scoreOrderViolations
    - w.actorDotsOutsideTask * actorDotsOutsideTask
  ) * 10) / 10)

  return { metrics, violations, score }
}
