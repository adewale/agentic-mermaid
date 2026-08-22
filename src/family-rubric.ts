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

import type { DiagramKind, RenderedLayout, RenderedLayoutGroup, RenderedLayoutNode } from './agent/types.ts'
import type { PositionedJourneyDiagram } from './journey/types.ts'
import type { PositionedSankeyChart } from './sankey/types.ts'

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
  /** SOFT: foreign nodes intruding into a group's region — a node whose centre
   *  sits inside a group's rect while it is NOT a (transitive) member of that
   *  group. This is the *dual* of groupBreaches: breaches catch a member that
   *  escaped its region; intrusions catch a non-member that reads as if it
   *  belongs (Palmer 1992 common-region purity is a both-directions property).
   *  Only counted for families whose groups are true bounding frames
   *  ('both' axes); 0 for band/frame/plot-region group models. */
  regionIntrusions: number
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
export const FAMILY_HARD_METRICS = ['nonFiniteGeometry', 'offCanvas', 'nodeOverlaps', 'groupBreaches', 'groupOverlaps'] as const

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
  /** Soft: a foreign node reading inside a region it does not belong to. Ranks
   *  below the hard containment defects; applied as weight × count. */
  regionIntrusions: 6,
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
const GROUP_CONTAINMENT_AXES: Partial<Record<DiagramKind, 'both' | 'x' | 'center' | 'none'>> = {
  journey: 'x',
  // Sequence blocks are temporal frames around message rows, not ownership
  // containers for actor/note node boxes.
  sequence: 'none',
  xychart: 'center',
  quadrant: 'center',
}

/**
 * Families whose groups are OWNERSHIP FRAMES — a member belongs to its group
 * and a non-member inside the frame is a common-region defect (region
 * intrusion). This is deliberately an explicit allow-list, not the 'both'
 * default: many families draw non-ownership groups (radar's concentric grid
 * rings, chart plot regions, journey bands) that data marks legitimately sit
 * inside. Flowchart/state subgraphs are also ownership frames but are scored by
 * layout-rubric.ts, not this module. Architecture groups, class namespaces,
 * ER groups, and timeline sections are ownership frames in RenderedLayout.
 */
const REGION_OWNERSHIP_KINDS = new Set<DiagramKind>(['architecture', 'class', 'er', 'timeline'])

function isBox(node: RenderedLayoutNode): boolean {
  return node.role ? node.role === 'box' : BOX_SHAPES.has(node.shape)
}

function requiresLabel(node: RenderedLayoutNode): boolean {
  return isBox(node) || node.role === 'labelled-mark'
}

function finiteRect(x: number, y: number, w: number, h: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(w) && Number.isFinite(h) && w >= 0 && h >= 0
}

function rectOverlap(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return ox > TOL && oy > TOL
}

function rectContains(outer: RenderedLayoutGroup, inner: RenderedLayoutGroup): boolean {
  return inner.x >= outer.x - TOL && inner.y >= outer.y - TOL && inner.x + inner.w <= outer.x + outer.w + TOL && inner.y + inner.h <= outer.y + outer.h + TOL
}

/** Whether `ancestor` is on `group`'s parentId chain (flattened group trees). */
function isAncestor(ancestor: RenderedLayoutGroup, group: RenderedLayoutGroup, byId: Map<string, RenderedLayoutGroup>): boolean {
  let cur: RenderedLayoutGroup | undefined = group
  const visited = new Set<string>()
  while (cur?.parentId && !visited.has(cur.id)) {
    visited.add(cur.id)
    if (cur.parentId === ancestor.id) return true
    cur = byId.get(cur.parentId)
  }
  return false
}

/**
 * The node ids that legitimately occupy `group`: its own members plus the
 * members of every descendant group (a node in a nested child still belongs
 * inside its ancestor's region, so it is not an intruder).
 */
function groupOccupants(group: RenderedLayoutGroup, groups: RenderedLayoutGroup[], byId: Map<string, RenderedLayoutGroup>): Set<string> {
  const occupants = new Set<string>(group.members)
  for (const other of groups) {
    if (other.id !== group.id && isAncestor(group, other, byId)) {
      for (const memberId of other.members) occupants.add(memberId)
    }
  }
  return occupants
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
      const a = layout.nodes[i]!,
        b = layout.nodes[j]!
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
  const axes = GROUP_CONTAINMENT_AXES[layout.kind as DiagramKind] ?? 'both'
  let groupBreaches = 0
  if (axes !== 'none') {
    const nodeById = new Map(layout.nodes.map(n => [n.id, n]))
    for (const g of layout.groups) {
      for (const memberId of g.members) {
        const n = nodeById.get(memberId)
        if (!n || !finiteRect(n.x, n.y, n.w, n.h)) continue
        const xOk = axes === 'center' ? n.x + n.w / 2 >= g.x - TOL && n.x + n.w / 2 <= g.x + g.w + TOL : n.x >= g.x - TOL && n.x + n.w <= g.x + g.w + TOL
        const yOk = axes === 'x' || (axes === 'center' ? n.y + n.h / 2 >= g.y - TOL && n.y + n.h / 2 <= g.y + g.h + TOL : n.y >= g.y - TOL && n.y + n.h <= g.y + g.h + TOL)
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
      const a = layout.groups[i]!,
        b = layout.groups[j]!
      if (!finiteRect(a.x, a.y, a.w, a.h) || !finiteRect(b.x, b.y, b.w, b.h)) continue
      if (!rectOverlap(a, b)) continue
      if (rectContains(a, b) || rectContains(b, a)) continue
      if (isAncestor(a, b, groupById) || isAncestor(b, a, groupById)) continue
      groupOverlaps++
      violations.push({ metric: 'groupOverlaps', detail: `${a.id} partially overlaps ${b.id}` })
    }
  }

  // Region-intrusion purity (the dual of groupBreaches): a foreign node whose
  // CENTRE sits strictly inside a group's rect while it is not a member of that
  // group or any of the group's descendants reads as belonging to the wrong
  // cluster. Only meaningful where groups are true bounding frames.
  let regionIntrusions = 0
  if (REGION_OWNERSHIP_KINDS.has(layout.kind as DiagramKind)) {
    for (const g of layout.groups) {
      if (!finiteRect(g.x, g.y, g.w, g.h)) continue
      const occupants = groupOccupants(g, layout.groups, groupById)
      for (const n of layout.nodes) {
        if (occupants.has(n.id) || !finiteRect(n.x, n.y, n.w, n.h)) continue
        // Skip nodes that ARE a group's frame box (a group can surface as a node).
        if (groupById.has(n.id)) continue
        const cx = n.x + n.w / 2
        const cy = n.y + n.h / 2
        if (cx > g.x + TOL && cx < g.x + g.w - TOL && cy > g.y + TOL && cy < g.y + g.h - TOL) {
          regionIntrusions++
          violations.push({ metric: 'regionIntrusions', detail: `${n.id} intrudes into ${g.id}` })
        }
      }
    }
  }

  // Label presence on semantic boxes and labelled data marks. Shapes alone
  // cannot distinguish a rectangular bar mark from a text-bearing node.
  const boxes = layout.nodes.filter(requiresLabel)
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
    regionIntrusions,
    markOverlapRate: pairs === 0 ? 0 : markOverlaps / pairs,
    labelledBoxRate: boxes.length === 0 ? 1 : labelledBoxes.length / boxes.length,
  }

  const w = FAMILY_RUBRIC_WEIGHTS
  const score = Math.max(
    0,
    Math.round(
      (100 -
        w.nonFiniteGeometry * metrics.nonFiniteGeometry -
        w.offCanvas * metrics.offCanvas -
        w.nodeOverlaps * metrics.nodeOverlaps -
        w.groupBreaches * metrics.groupBreaches -
        w.groupOverlaps * metrics.groupOverlaps -
        w.regionIntrusions * metrics.regionIntrusions -
        w.markOverlapRate * metrics.markOverlapRate -
        w.missingLabelRate * (1 - metrics.labelledBoxRate)) *
        10,
    ) / 10,
  )

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
      const a = positioned.sections[i]!,
        b = positioned.sections[j]!
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
      const inside = d.x - d.r >= t.x - TOL && d.x + d.r <= t.x + t.width + TOL && d.y - d.r >= t.y - TOL && d.y + d.r <= t.y + t.height + TOL
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
      const a = tasks[i]!,
        b = tasks[j]!
      const bad = (a.score > b.score && !(a.marker.cy < b.marker.cy - 1e-6)) || (a.score < b.score && !(b.marker.cy < a.marker.cy - 1e-6)) || (a.score === b.score && Math.abs(a.marker.cy - b.marker.cy) > 1e-6)
      if (bad) {
        scoreOrderViolations++
        violations.push({ metric: 'scoreOrderViolations', detail: `${a.id}(score ${a.score}, y ${a.marker.cy}) vs ${b.id}(score ${b.score}, y ${b.marker.cy})` })
      }
    }
  }
  const ticks = positioned.scoreGuide.ticks
  for (let i = 1; i < ticks.length; i++) {
    const prev = ticks[i - 1]!,
      cur = ticks[i]!
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
  const score = Math.max(0, Math.round((100 - w.sectionSpanOverlaps * sectionSpanOverlaps - w.markerOffCenter * markerOffCenter - w.scoreOrderViolations * scoreOrderViolations - w.actorDotsOutsideTask * actorDotsOutsideTask) * 10) / 10)

  return { metrics, violations, score }
}

// ============================================================================
// Sankey assessor — the family-specific layer over the generic family rubric,
// mirroring the journey assessor. HARD metrics assert the layout invariants
// the sankey construction is supposed to guarantee (so a regression that
// breaks the construction is caught on arbitrary inputs, not just fixtures);
// `linkCrossings` is the classic sankey computational-aesthetics metric —
// SOFT, tracked in eval/heuristic-tracker so relaxation-quality changes are
// measured rather than eyeballed.
// ============================================================================

export interface SankeyRubricMetrics {
  nodes: number
  links: number
  /** HARD: a side's stacked ribbon widths exceed its node's height. */
  sideOverstack: number
  /** HARD: two nodes in one layer overlap vertically. */
  layerOverlaps: number
  /** HARD: a node box or label anchor leaves the canvas. */
  offCanvas: number
  /** HARD: a ribbon endpoint detached from its node face/extent. */
  detachedEndpoints: number
  /** SOFT: straight-centerline ribbon pairs that properly cross. */
  linkCrossings: number
}

export interface SankeyRubricResult {
  metrics: SankeyRubricMetrics
  violations: FamilyRubricViolation[]
}

/** Strict proper-intersection test for two segments (shared endpoints and
 *  collinear touches do not count — parallel ribbons out of one face share x). */
function segmentsCross(a1: { x: number; y: number }, a2: { x: number; y: number }, b1: { x: number; y: number }, b2: { x: number; y: number }): boolean {
  const orient = (p: { x: number; y: number }, q: { x: number; y: number }, r: { x: number; y: number }): number => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x))
  const o1 = orient(a1, a2, b1),
    o2 = orient(a1, a2, b2)
  const o3 = orient(b1, b2, a1),
    o4 = orient(b1, b2, a2)
  return o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0 && o1 !== o2 && o3 !== o4
}

export function assessSankeyLayout(chart: PositionedSankeyChart): SankeyRubricResult {
  const violations: FamilyRubricViolation[] = []
  const byLabel = new Map(chart.nodes.map(node => [node.label, node]))

  // Side capacity: the ribbons stacked on one node face fit inside the node.
  let sideOverstack = 0
  for (const node of chart.nodes) {
    const height = node.y1 - node.y0
    for (const [side, widths] of [
      ['outgoing', chart.links.filter(l => l.source === node.label).map(l => l.width)],
      ['incoming', chart.links.filter(l => l.target === node.label).map(l => l.width)],
    ] as const) {
      const stacked = widths.reduce((sum, w) => sum + w, 0)
      if (stacked > height + TOL) {
        sideOverstack++
        violations.push({ metric: 'sideOverstack', detail: `${node.label} ${side} ribbons stack to ${stacked.toFixed(1)}px in a ${height.toFixed(1)}px node` })
      }
    }
  }

  // Layer discipline: nodes sharing a layer never overlap vertically.
  let layerOverlaps = 0
  const layers = new Map<number, (typeof chart.nodes)[number][]>()
  for (const node of chart.nodes) layers.set(node.layer, [...(layers.get(node.layer) ?? []), node])
  for (const layer of layers.values()) {
    for (let i = 0; i < layer.length; i++) {
      for (let j = i + 1; j < layer.length; j++) {
        const a = layer[i]!,
          b = layer[j]!
        const overlap = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)
        if (overlap > TOL) {
          layerOverlaps++
          violations.push({ metric: 'layerOverlaps', detail: `${a.label} overlaps ${b.label} by ${overlap.toFixed(1)}px in layer ${a.layer}` })
        }
      }
    }
  }

  // Canvas containment: boxes and label anchors stay on the grown canvas.
  let offCanvas = 0
  for (const node of chart.nodes) {
    const outside = node.x0 < -TOL || node.y0 < -TOL || node.x1 > chart.width + TOL || node.y1 > chart.height + TOL || node.labelX < -TOL || node.labelX > chart.width + TOL || node.labelY < -TOL || node.labelY > chart.height + TOL || !Number.isFinite(node.x0 + node.y0 + node.x1 + node.y1 + node.labelX + node.labelY)
    if (outside) {
      offCanvas++
      violations.push({ metric: 'offCanvas', detail: `${node.label} leaves the ${chart.width}×${chart.height} canvas` })
    }
  }

  // Attachment: every ribbon leaves its source's right face and enters its
  // target's left face, inside the node's vertical extent.
  let detachedEndpoints = 0
  for (const link of chart.links) {
    const source = byLabel.get(link.source),
      target = byLabel.get(link.target)
    if (!source || !target) {
      detachedEndpoints++
      violations.push({ metric: 'detachedEndpoints', detail: `${link.id} references a missing node` })
      continue
    }
    const detached = Math.abs(link.sx - source.x1) > TOL || Math.abs(link.tx - target.x0) > TOL || link.sy < source.y0 - TOL || link.sy > source.y1 + TOL || link.ty < target.y0 - TOL || link.ty > target.y1 + TOL
    if (detached) {
      detachedEndpoints++
      violations.push({ metric: 'detachedEndpoints', detail: `${link.id} detached from its node faces` })
    }
  }

  // Crossings (SOFT): straight source→target centerlines that properly cross.
  let linkCrossings = 0
  for (let i = 0; i < chart.links.length; i++) {
    for (let j = i + 1; j < chart.links.length; j++) {
      const a = chart.links[i]!,
        b = chart.links[j]!
      if (segmentsCross({ x: a.sx, y: a.sy }, { x: a.tx, y: a.ty }, { x: b.sx, y: b.sy }, { x: b.tx, y: b.ty })) linkCrossings++
    }
  }

  return {
    metrics: {
      nodes: chart.nodes.length,
      links: chart.links.length,
      sideOverstack,
      layerOverlaps,
      offCanvas,
      detachedEndpoints,
      linkCrossings,
    },
    violations,
  }
}
