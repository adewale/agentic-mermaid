// ============================================================================
// QUAL-1 — RenderedLayout adapters for the non-graph diagram families.
//
// The perceptual-quality metrics (measureQuality / checkQuality) operate on a
// RenderedLayout. Flowchart/state reuse the ELK geometric path; sequence and
// timeline have bespoke adapters in index.ts. Everything else previously fell
// through to emptyRenderedLayout, so those families showed nodeCount 0 — the
// metrics were blind to them (TODO QUAL-1, docs/quality.md honest-gap).
//
// This module closes that gap by projecting each family's REAL positioned
// layout (the same geometry the SVG renderer draws) into a RenderedLayout:
//
//   family        nodes                        edges                  groups
//   ------------   --------------------------   --------------------   ------------------
//   class         class boxes                  relations              —
//   er            entity boxes                 relations              —
//   journey       task boxes + section labels  —                      section frames
//   architecture  services + junctions         edges                  groups (flattened)
//   xychart       bars + line points + axis    —                      plot area
//                 ticks
//   pie           slice label boxes (legend    —                      —
//                 anchor + approx bbox)
//   quadrant      points                       —                      quadrant regions
//   gantt         tasks + milestones           —                      section bands
//
// Opaque-safe: every adapter parses d.canonicalSource via the legacy parser +
// layouter (the exact path renderMermaidSVG uses) wrapped in try/catch. An
// invalid opaque diagram of a renderable family must NOT make layoutMermaid
// throw — it degrades to emptyRenderedLayout. All coordinates pass through
// toFinite (throws on NaN/Infinity), so a garbage coordinate fails loudly
// rather than silently poisoning the metrics.
//
// Determinism: every layouter here is deterministic (no RNG / clock), so
// layoutMermaid(d) called twice is deep-equal.
// ============================================================================

import type {
  ValidDiagram,
  RenderedLayout,
  RenderedLayoutNode,
  RenderedLayoutEdge,
  RenderedLayoutGroup,
  LayoutWarning,
  Finite,
  XyChartBody,
  PieBody,
  QuadrantBody,
  GanttBody,
} from './types.ts'
import type { FamilyEdgeRouteCertificate, Point, RegionContainmentCertificate } from '../types.ts'
import { toFinite } from './types.ts'
import { emptyRenderedLayout } from './layout-to-rendered.ts'

import { toMermaidLines, normalizeMermaidSource } from '../mermaid-source.ts'
import { parseClassDiagram } from '../class/parser.ts'
import { layoutClassDiagram } from '../class/layout.ts'
import { parseErDiagram } from '../er/parser.ts'
import { layoutErDiagram } from '../er/layout.ts'
import { layoutSequenceDiagram } from '../sequence/layout.ts'
import { parseSequenceDiagram } from '../sequence/parser.ts'
import { parseTimelineDiagram } from '../timeline/parser.ts'
import { layoutTimelineDiagram } from '../timeline/layout.ts'
import { parseJourneyDiagram } from '../journey/parser.ts'
import { layoutJourneyDiagram } from '../journey/layout.ts'
import { parseArchitectureDiagram } from '../architecture/parser.ts'
import { layoutArchitectureDiagram } from '../architecture/layout.ts'
import { applyXYChartFrontmatterConfig, parseXYChart, resolveXYChartConfig, resolveXYChartTheme } from '../xychart/parser.ts'
import { layoutXYChart } from '../xychart/layout.ts'
import type { XYAxis, XYChart } from '../xychart/types.ts'
import type { PositionedArchitectureEdge, PositionedArchitectureGroup, PositionedArchitectureJunction, PositionedArchitectureService } from '../architecture/types.ts'
import { parsePieChart } from '../pie/parser.ts'
import { layoutPieChart } from '../pie/layout.ts'
import type { PieChart } from '../pie/types.ts'
import { parseQuadrantChart } from '../quadrant/parser.ts'
import { layoutQuadrantChart } from '../quadrant/layout.ts'
import type { QuadrantChart } from '../quadrant/types.ts'
import { parseGanttModel, applyGanttFrontmatterConfig, GANTT_DURATION_RE } from '../gantt/parser.ts'
import { resolveGanttSchedule } from '../gantt/schedule.ts'
import { buildGanttRenderPipeline } from '../gantt/pipeline.ts'
import { layoutGantt } from '../gantt/layout.ts'
import type { GanttEndExpr, GanttLayoutResult, GanttModel, GanttModelSection, GanttModelTask, GanttStartExpr, GanttTaskTag } from '../gantt/types.ts'

function f(n: number): Finite { return toFinite(Math.round(n)) }

/** Round a span against its rounded start. Rounding x and width
 *  independently can shift the far edge ±1px away from rounded edge
 *  endpoints, which fires the class/ER anchor tripwires (TOL 0.5) on
 *  geometry that sits exactly on-boundary pre-rounding — observed live on
 *  an onboarding-probe ER diagram. Used where edgeAnchors checks run. */
function fSpan(start: number, length: number): Finite { return toFinite(Math.round(start + length) - Math.round(start)) }

/**
 * Family-aware RenderedLayout adapter. Dispatches on body kind; for the
 * renderable non-graph families it layouts from d.canonicalSource (which is
 * always populated for both structured and opaque bodies). Returns null for
 * families this module doesn't own (flowchart/state graph layouts and opaque
 * flowchart compatibility are handled in index.ts) so the caller can keep its
 * existing dispatch.
 */
export function layoutFamilyToRendered(d: ValidDiagram, opts: { debug?: boolean } = {}): RenderedLayout | null {
  // Each adapter is self-contained: it wraps the legacy parse+layout in
  // try/catch and degrades to emptyRenderedLayout(d.kind) on render-error, so
  // an invalid opaque body of a renderable family never makes this throw.
  switch (d.kind) {
    case 'class':        return classToRendered(d, opts)
    case 'er':           return erToRendered(d, opts)
    case 'sequence':     return sequenceToRendered(d, opts)
    case 'timeline':     return timelineToRendered(d, opts)
    case 'journey':      return journeyToRendered(d)
    case 'architecture': return architectureToRendered(d, opts)
    case 'xychart':      return xychartToRendered(d, opts)
    case 'pie':          return pieToRendered(d, opts)
    case 'quadrant':     return quadrantToRendered(d, opts)
    case 'gantt':        return ganttToRendered(d, opts)
    default:             return null
  }
}

// ---- class ----------------------------------------------------------------

function classToRendered(d: ValidDiagram, opts: { debug?: boolean } = {}): RenderedLayout {
  try {
    const positioned = layoutClassDiagram(parseClassDiagram(toMermaidLines(d.canonicalSource)))
    const nodes: RenderedLayoutNode[] = positioned.classes.map(c => ({
      id: c.id, x: f(c.x), y: f(c.y), w: fSpan(c.x, c.width), h: fSpan(c.y, c.height), shape: 'rectangle', label: c.label,
    }))
    const boxById = new Map(positioned.classes.map(c => [c.id, { x: c.x, y: c.y, width: c.width, height: c.height }]))
    const edges: RenderedLayoutEdge[] = positioned.relationships.map((r, i) => ({
      id: `rel#${i}:${r.from}->${r.to}`, from: r.from, to: r.to,
      path: r.points.map(p => [f(p.x), f(p.y)] as [Finite, Finite]),
      label: r.label && r.labelPosition ? { x: f(r.labelPosition.x), y: f(r.labelPosition.y), text: r.label } : undefined,
      route: opts.debug ? boxRouteCertificate('class', i, r.points, boxById.get(r.from), boxById.get(r.to)) : undefined,
    }))
    return { version: 1, kind: d.kind, nodes, edges, groups: [], bounds: { w: f(positioned.width), h: f(positioned.height) } }
  } catch { return emptyRenderedLayout(d.kind) }
}

// ---- er -------------------------------------------------------------------

function erToRendered(d: ValidDiagram, opts: { debug?: boolean } = {}): RenderedLayout {
  try {
    const positioned = layoutErDiagram(parseErDiagram(toMermaidLines(d.canonicalSource)))
    const nodes: RenderedLayoutNode[] = positioned.entities.map(e => ({
      id: e.id, x: f(e.x), y: f(e.y), w: fSpan(e.x, e.width), h: fSpan(e.y, e.height), shape: 'rectangle', label: e.label,
    }))
    const boxById = new Map(positioned.entities.map(e => [e.id, { x: e.x, y: e.y, width: e.width, height: e.height }]))
    const edges: RenderedLayoutEdge[] = positioned.relationships.map((r, i) => ({
      id: `rel#${i}:${r.entity1}->${r.entity2}`, from: r.entity1, to: r.entity2,
      path: r.points.map(p => [f(p.x), f(p.y)] as [Finite, Finite]),
      label: r.label ? labelMidpoint(r.points, r.label) : undefined,
      route: opts.debug ? boxRouteCertificate('er', i, r.points, boxById.get(r.entity1), boxById.get(r.entity2)) : undefined,
    }))
    return { version: 1, kind: d.kind, nodes, edges, groups: [], bounds: { w: f(positioned.width), h: f(positioned.height) } }
  } catch { return emptyRenderedLayout(d.kind) }
}

function boxRouteCertificate(
  family: 'class' | 'er',
  edgeIndex: number,
  points: Point[],
  source: { x: number; y: number; width: number; height: number } | undefined,
  target: { x: number; y: number; width: number; height: number } | undefined,
): FamilyEdgeRouteCertificate {
  const sourceBoundary = !!(source && points[0] && pointOnRawRectBoundary(points[0].x, points[0].y, source, 1))
  const targetBoundary = !!(target && points[points.length - 1] && pointOnRawRectBoundary(points[points.length - 1]!.x, points[points.length - 1]!.y, target, 1))
  const orthogonal = routeOrthogonal(points)
  return {
    family,
    edgeIndex,
    routeClass: 'family-layout',
    invariant: sourceBoundary && targetBoundary && orthogonal ? 'orthogonal-box' : 'unverified-family-route',
    bendCount: bendCount(points),
    orthogonal,
    sourceBoundary,
    targetBoundary,
  }
}

function routeOrthogonal(points: Point[]): boolean {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!
    if (Math.abs(a.x - b.x) > 0.5 && Math.abs(a.y - b.y) > 0.5) return false
  }
  return true
}

function bendCount(points: Point[]): number {
  if (points.length < 3) return 0
  let bends = 0
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1]!, b = points[i]!, c = points[i + 1]!
    const sameX = Math.abs(a.x - b.x) <= 0.5 && Math.abs(b.x - c.x) <= 0.5
    const sameY = Math.abs(a.y - b.y) <= 0.5 && Math.abs(b.y - c.y) <= 0.5
    if (!sameX && !sameY) bends++
  }
  return bends
}

function pointOnRawRectBoundary(x: number, y: number, n: { x: number; y: number; width: number; height: number }, tol: number): boolean {
  const onVertical = (Math.abs(x - n.x) <= tol || Math.abs(x - (n.x + n.width)) <= tol) && y >= n.y - tol && y <= n.y + n.height + tol
  const onHorizontal = (Math.abs(y - n.y) <= tol || Math.abs(y - (n.y + n.height)) <= tol) && x >= n.x - tol && x <= n.x + n.width + tol
  return onVertical || onHorizontal
}

function labelMidpoint(points: Array<{ x: number; y: number }>, text: string): { x: Finite; y: Finite; text: string } | undefined {
  if (points.length === 0) return undefined
  const mid = points[Math.floor(points.length / 2)]!
  return { x: f(mid.x), y: f(mid.y), text }
}

type ElementCertificateFamily = 'timeline' | 'xychart' | 'pie' | 'quadrant' | 'gantt'
type ElementCertificateInvariant = RegionContainmentCertificate['invariant']

function elementCertificates(
  family: ElementCertificateFamily,
  layout: RenderedLayout,
  invariant: ElementCertificateInvariant,
  referenceGroup?: RenderedLayoutGroup,
  containment: 'bounds' | 'center' = 'bounds',
): RegionContainmentCertificate[] {
  const groupsByMember = new Map<string, RenderedLayoutGroup>()
  for (const group of layout.groups) {
    for (const member of group.members) groupsByMember.set(member, group)
  }
  return layout.nodes.map(n => {
    const withinBounds = nodeWithinBounds(n, layout.bounds)
    const group = groupsByMember.get(n.id) ?? referenceGroup
    const withinGroup = group ? (containment === 'center' ? nodeCenterWithinGroup(n, group) : nodeWithinGroup(n, group)) : undefined
    return {
      family,
      elementId: n.id,
      routeClass: 'family-layout',
      invariant: withinBounds && (withinGroup ?? true) ? invariant : 'unverified-family-layout',
      bounds: { x: n.x, y: n.y, w: n.w, h: n.h },
      center: { x: f(n.x + n.w / 2), y: f(n.y + n.h / 2) },
      containment,
      withinBounds,
      ...(group ? { groupId: group.id, withinGroup } : {}),
    }
  })
}

function nodeWithinBounds(n: RenderedLayoutNode, bounds: RenderedLayout['bounds'], tol = 0.5): boolean {
  return n.x >= -tol && n.y >= -tol && n.x + n.w <= bounds.w + tol && n.y + n.h <= bounds.h + tol
}

function nodeWithinGroup(n: RenderedLayoutNode, g: RenderedLayoutGroup, tol = 0.5): boolean {
  return n.x >= g.x - tol && n.y >= g.y - tol && n.x + n.w <= g.x + g.w + tol && n.y + n.h <= g.y + g.h + tol
}

function nodeCenterWithinGroup(n: RenderedLayoutNode, g: RenderedLayoutGroup, tol = 0.5): boolean {
  const cx = n.x + n.w / 2
  const cy = n.y + n.h / 2
  return cx >= g.x - tol && cy >= g.y - tol && cx <= g.x + g.w + tol && cy <= g.y + g.h + tol
}

// ---- sequence -------------------------------------------------------------

function sequenceToRendered(d: ValidDiagram, opts: { debug?: boolean } = {}): RenderedLayout {
  try {
    if (d.kind !== 'sequence') return emptyRenderedLayout(d.kind)
    const positioned = layoutSequenceDiagram(parseSequenceDiagram(toMermaidLines(d.canonicalSource)))
    const lifelineByActor = new Map(positioned.lifelines.map(l => [l.actorId, l.x]))
    const nodes: RenderedLayoutNode[] = [
      ...positioned.actors.map(a => ({
        id: a.id, x: f(a.x - a.width / 2), y: f(a.y), w: f(a.width), h: f(a.height),
        shape: 'rectangle', label: a.label,
      })),
      ...positioned.notes.map((n, i) => ({
        id: `note#${i}`, x: f(n.x), y: f(n.y), w: f(n.width), h: f(n.height),
        shape: 'note', label: n.text,
      })),
    ]
    return {
      version: 1, kind: d.kind,
      nodes,
      edges: positioned.messages.map((m, i) => {
        const path = sequenceMessagePath(m)
        return {
          id: `msg#${i}:${m.from}->${m.to}`, from: m.from, to: m.to,
          path: path.map(p => [f(p.x), f(p.y)] as [Finite, Finite]),
          label: m.label ? sequenceMessageLabel(m) : undefined,
          route: opts.debug ? sequenceRouteCertificate(i, m, path, lifelineByActor) : undefined,
        }
      }),
      groups: positioned.blocks.map((b, i) => ({
        id: `block#${i}:${b.type}`, x: f(b.x), y: f(b.y), w: f(b.width), h: f(b.height), members: [], label: b.label,
      })),
      bounds: { w: f(positioned.width), h: f(positioned.height) },
    }
  } catch { return emptyRenderedLayout(d.kind) }
}

function sequenceMessagePath(message: { x1: number; x2: number; y: number; isSelf: boolean }): Point[] {
  if (!message.isSelf) return [{ x: message.x1, y: message.y }, { x: message.x2, y: message.y }]
  const loopW = 30
  const loopH = 20
  return [
    { x: message.x1, y: message.y },
    { x: message.x1 + loopW, y: message.y },
    { x: message.x1 + loopW, y: message.y + loopH },
    { x: message.x2, y: message.y + loopH },
  ]
}

function sequenceMessageLabel(message: { x1: number; x2: number; y: number; isSelf: boolean; label: string }): { x: Finite; y: Finite; text: string } {
  if (message.isSelf) return { x: f(message.x1 + 38), y: f(message.y + 10), text: message.label }
  return { x: f((message.x1 + message.x2) / 2), y: f(message.y - 10), text: message.label }
}

function sequenceRouteCertificate(
  edgeIndex: number,
  message: { from: string; to: string; x1: number; x2: number; y: number; isSelf: boolean },
  points: Point[],
  lifelineByActor: Map<string, number>,
): FamilyEdgeRouteCertificate {
  const sourceX = lifelineByActor.get(message.from)
  const targetX = lifelineByActor.get(message.to)
  const first = points[0]
  const last = points[points.length - 1]
  const sourceLifeline = sourceX !== undefined && first !== undefined && Math.abs(first.x - sourceX) <= 1
  const targetLifeline = targetX !== undefined && last !== undefined && Math.abs(last.x - targetX) <= 1
  const horizontal = !message.isSelf && points.every(p => Math.abs(p.y - message.y) <= 1)
  const orthogonal = routeOrthogonal(points)
  return {
    family: 'sequence',
    edgeIndex,
    routeClass: 'family-layout',
    invariant: sourceLifeline && targetLifeline && orthogonal ? (message.isSelf ? 'self-message' : 'lifeline-message') : 'unverified-family-route',
    bendCount: bendCount(points),
    horizontal,
    sourceLifeline,
    targetLifeline,
    selfMessage: message.isSelf,
  }
}

// ---- timeline -------------------------------------------------------------

function timelineToRendered(d: ValidDiagram, opts: { debug?: boolean } = {}): RenderedLayout {
  try {
    const positioned = layoutTimelineDiagram(parseTimelineDiagram(toMermaidLines(d.canonicalSource)))
    const nodes: RenderedLayoutNode[] = []
    const groups: RenderedLayoutGroup[] = []
    for (const section of positioned.sections) {
      const members: string[] = []
      for (const period of section.periods) {
        const periodId = `${period.id}:period`
        nodes.push({
          id: periodId, x: f(period.pillX), y: f(period.pillY), w: f(period.pillWidth), h: f(period.pillHeight),
          shape: 'rounded', label: period.label,
        })
        members.push(periodId)
        for (const event of period.events) {
          nodes.push({
            id: event.id, x: f(event.x), y: f(event.y), w: f(event.width), h: f(event.height),
            shape: 'rectangle', label: event.text,
          })
          members.push(event.id)
        }
      }
      if (section.framed) {
        groups.push({ id: section.id, x: f(section.x), y: f(section.y), w: f(section.width), h: f(section.height), members, label: section.label })
      }
    }
    const layout: RenderedLayout = { version: 1, kind: d.kind, nodes, edges: [], groups, bounds: { w: f(positioned.width), h: f(positioned.height) } }
    if (opts.debug) layout.certificates = elementCertificates('timeline', layout, 'timeline-interval')
    return layout
  } catch { return emptyRenderedLayout(d.kind) }
}

// ---- journey --------------------------------------------------------------

function journeyToRendered(d: ValidDiagram): RenderedLayout {
  try {
    const positioned = layoutJourneyDiagram(parseJourneyDiagram(toMermaidLines(d.canonicalSource)))
    const nodes: RenderedLayoutNode[] = []
    const groups: RenderedLayoutGroup[] = []
    for (const s of positioned.sections) {
      const memberIds: string[] = []
      for (const t of s.tasks) {
        nodes.push({ id: t.id, x: f(t.x), y: f(t.y), w: f(t.width), h: f(t.height), shape: 'rectangle', label: t.text })
        memberIds.push(t.id)
      }
      // The group is the section COLUMN (header band down through its task
      // boxes), not just the header rect — so groupContainment verifies the
      // real invariant: every task sits inside its own section span.
      const bottom = s.tasks.length > 0
        ? Math.max(s.y + s.height, ...s.tasks.map(t => t.y + t.height))
        : s.y + s.height
      groups.push({ id: s.id, x: f(s.x), y: f(s.y), w: f(s.width), h: f(bottom - s.y), members: memberIds, label: s.label })
    }
    return { version: 1, kind: d.kind, nodes, edges: [], groups, bounds: { w: f(positioned.width), h: f(positioned.height) } }
  } catch { return emptyRenderedLayout(d.kind) }
}

// ---- architecture ---------------------------------------------------------

function architectureToRendered(d: ValidDiagram, opts: { debug?: boolean } = {}): RenderedLayout {
  try {
    const positioned = layoutArchitectureDiagram(parseArchitectureDiagram(toMermaidLines(d.canonicalSource)))
    const nodes: RenderedLayoutNode[] = [
      ...positioned.services.map(s => ({
        id: s.id, x: f(s.x), y: f(s.y), w: f(s.width), h: f(s.height), shape: 'service', label: s.label,
      })),
      ...positioned.junctions.map(j => ({
        id: j.id, x: f(j.x), y: f(j.y), w: f(j.width), h: f(j.height), shape: 'circle' as const, label: undefined,
      })),
    ]
    const flatGroups = new Map<string, PositionedArchitectureGroup>()
    const groups: RenderedLayoutGroup[] = []
    const flatten = (g: PositionedArchitectureGroup): void => {
      flatGroups.set(g.id, g)
      groups.push({ id: g.id, x: f(g.x), y: f(g.y), w: f(g.width), h: f(g.height), members: [], label: g.label, parentId: g.parentId })
      for (const c of g.children) flatten(c)
    }
    for (const g of positioned.groups) flatten(g)
    const serviceById = new Map(positioned.services.map(s => [s.id, s]))
    const junctionById = new Map(positioned.junctions.map(j => [j.id, j]))
    const edges: RenderedLayoutEdge[] = positioned.edges.map((e, i) => ({
      id: `edge#${i}:${e.source.id}->${e.target.id}`, from: e.source.id, to: e.target.id,
      path: e.points.map(p => [f(p.x), f(p.y)] as [Finite, Finite]),
      label: e.label && e.labelPosition ? { x: f(e.labelPosition.x), y: f(e.labelPosition.y), text: e.label } : undefined,
      route: opts.debug ? architectureRouteCertificate(i, e, serviceById, junctionById, flatGroups) : undefined,
    }))
    return { version: 1, kind: d.kind, nodes, edges, groups, bounds: { w: f(positioned.width), h: f(positioned.height) } }
  } catch { return emptyRenderedLayout(d.kind) }
}

function architectureRouteCertificate(
  edgeIndex: number,
  edge: PositionedArchitectureEdge,
  services: Map<string, PositionedArchitectureService>,
  junctions: Map<string, PositionedArchitectureJunction>,
  groups: Map<string, PositionedArchitectureGroup>,
): FamilyEdgeRouteCertificate {
  const boundsFor = (endpoint: PositionedArchitectureEdge['source']) => {
    if (endpoint.boundary === 'group') {
      const service = services.get(endpoint.id)
      return service?.parentId ? groups.get(service.parentId) : undefined
    }
    return services.get(endpoint.id) ?? junctions.get(endpoint.id)
  }
  const sourceBounds = boundsFor(edge.source)
  const targetBounds = boundsFor(edge.target)
  const first = edge.points[0]
  const last = edge.points[edge.points.length - 1]
  const sourceAnchored = !!(first && sourceBounds && pointOnSide(first, sourceBounds, edge.source.side, 1))
  const targetAnchored = !!(last && targetBounds && pointOnSide(last, targetBounds, edge.target.side, 1))
  const orthogonal = routeOrthogonal(edge.points)
  return {
    family: 'architecture',
    edgeIndex,
    routeClass: 'family-layout',
    invariant: sourceAnchored && targetAnchored && orthogonal ? 'side-anchored' : 'unverified-family-route',
    bendCount: bendCount(edge.points),
    orthogonal,
    sourceSide: edge.source.side,
    targetSide: edge.target.side,
    sourceBoundary: edge.source.boundary,
    targetBoundary: edge.target.boundary,
    sourceAnchored,
    targetAnchored,
  }
}

function pointOnSide(
  point: Point,
  bounds: { x: number; y: number; width: number; height: number },
  side: 'L' | 'R' | 'T' | 'B',
  tol: number,
): boolean {
  switch (side) {
    case 'L': return Math.abs(point.x - bounds.x) <= tol && point.y >= bounds.y - tol && point.y <= bounds.y + bounds.height + tol
    case 'R': return Math.abs(point.x - (bounds.x + bounds.width)) <= tol && point.y >= bounds.y - tol && point.y <= bounds.y + bounds.height + tol
    case 'T': return Math.abs(point.y - bounds.y) <= tol && point.x >= bounds.x - tol && point.x <= bounds.x + bounds.width + tol
    case 'B': return Math.abs(point.y - (bounds.y + bounds.height)) <= tol && point.x >= bounds.x - tol && point.x <= bounds.x + bounds.width + tol
  }
}

// ---- xychart --------------------------------------------------------------

function xychartToRendered(d: ValidDiagram, opts: { debug?: boolean } = {}): RenderedLayout {
  try {
    const positioned = layoutXYChart(xychartForRenderedLayout(d))
    const nodes: RenderedLayoutNode[] = []
    // Bars are the primary boxes.
    positioned.bars.forEach((b, i) => {
      nodes.push({ id: `bar#${i}`, x: f(b.x), y: f(b.y), w: f(b.width), h: f(b.height), shape: 'rectangle', label: b.label })
    })
    // Line series points become small marker boxes so line-only charts are
    // still measured (whitespace/legibility care about node area).
    positioned.lines.forEach((ln, li) => {
      ln.points.forEach((p, pi) => {
        nodes.push({ id: `line#${li}:pt#${pi}`, x: f(p.x - 3), y: f(p.y - 3), w: f(6), h: f(6), shape: 'circle', label: p.label })
      })
    })
    // Plot area is the single group (the chart's content frame).
    const groups: RenderedLayoutGroup[] = [{
      id: 'plot', x: f(positioned.plotArea.x), y: f(positioned.plotArea.y),
      w: f(positioned.plotArea.width), h: f(positioned.plotArea.height), members: [],
    }]
    const layout: RenderedLayout = { version: 1, kind: d.kind, nodes, edges: [], groups, bounds: { w: f(positioned.width), h: f(positioned.height) } }
    if (opts.debug) layout.certificates = elementCertificates('xychart', layout, 'plot-contained', groups[0], 'center')
    return layout
  } catch { return emptyRenderedLayout(d.kind) }
}

function xychartForRenderedLayout(d: ValidDiagram): XYChart {
  const normalized = normalizeMermaidSource(d.canonicalSource)
  if (d.body.kind === 'xychart') return xychartFromBody(d.body, normalized.frontmatter)
  return applyXYChartFrontmatterConfig(parseXYChart(normalized.lines), normalized.frontmatter)
}

function xychartFromBody(body: XyChartBody, frontmatter: ReturnType<typeof normalizeMermaidSource>['frontmatter']): XYChart {
  const series = body.series.map((s): XYChart['series'][number] => ({
    type: s.kind,
    label: s.name,
    data: [...s.values],
  }))
  const yAxis = xyAxisFromBody(body.yAxis)
  if (!yAxis.range && series.length > 0) {
    const allValues = series.flatMap(s => s.data)
    let min = Math.min(...allValues)
    let max = Math.max(...allValues)
    const span = max - min || 1
    min = min - span * 0.1
    max = max + span * 0.1
    if (min > 0 && min < span * 0.5) min = 0
    yAxis.range = { min, max }
  }
  if (!yAxis.range) yAxis.range = { min: 0, max: 100 }

  const chart: XYChart = {
    horizontal: body.horizontal ?? false,
    xAxis: xyAxisFromBody(body.xAxis),
    yAxis,
    series,
    config: resolveXYChartConfig({}),
    theme: resolveXYChartTheme({}),
  }
  if (body.title !== undefined) chart.title = body.title
  if (body.horizontal !== undefined) chart.headerOrientation = body.horizontal ? 'horizontal' : 'vertical'
  return applyXYChartFrontmatterConfig(chart, frontmatter)
}

function xyAxisFromBody(axis: XyChartBody['xAxis']): XYAxis {
  const out: XYAxis = {}
  if (!axis) return out
  if (axis.name !== undefined) out.title = axis.name
  if (axis.categories) out.categories = [...axis.categories]
  if (axis.range) out.range = { ...axis.range }
  return out
}

// ---- pie ------------------------------------------------------------------

function pieToRendered(d: ValidDiagram, opts: { debug?: boolean } = {}): RenderedLayout {
  try {
    const positioned = layoutPieChart(pieChartForRenderedLayout(d))
    // Pie has no structural nodes/edges — the slices are angular wedges. Use
    // each slice's legend row as a label-anchored box (legend swatch top-left,
    // approximate width from label length at the legend font baseline). This
    // gives the metrics a positive node area + legible labels to measure.
    const CHAR_PX = 7
    const nodes: RenderedLayoutNode[] = positioned.legend.map((l, i) => {
      const labelText = `${l.label} (${(l.fraction * 100).toFixed(1)}%)`
      const w = Math.max(l.swatchSize, labelText.length * CHAR_PX + l.swatchSize)
      return { id: `slice#${i}:${l.label}`, x: f(l.x), y: f(l.y), w: f(w), h: f(l.swatchSize), shape: 'rectangle', label: labelText }
    })
    const layout: RenderedLayout = { version: 1, kind: d.kind, nodes, edges: [], groups: [], bounds: { w: f(positioned.width), h: f(positioned.height) } }
    if (opts.debug) layout.certificates = elementCertificates('pie', layout, 'legend-contained')
    return layout
  } catch { return emptyRenderedLayout(d.kind) }
}

function pieChartForRenderedLayout(d: ValidDiagram): PieChart {
  if (d.body.kind === 'pie') return pieChartFromBody(d.body)
  return parsePieChart(toMermaidLines(d.canonicalSource))
}

function pieChartFromBody(body: PieBody): PieChart {
  const chart: PieChart = {
    showData: body.showData,
    entries: body.slices.map(s => ({ label: s.label, value: s.value })),
  }
  if (body.title !== undefined) chart.title = body.title
  return chart
}

// ---- gantt ------------------------------------------------------------------

function ganttToRendered(d: ValidDiagram, opts: { debug?: boolean } = {}): RenderedLayout {
  try {
    const positioned = ganttPositionedForRenderedLayout(d)
    // Bars and milestones are the nodes; section bands are the groups. Verts
    // and ticks are markers, not boxes — they carry no node area. Milestones
    // report the diamond's true bounding box; the zero-width floor on bars is
    // pulled back inside the plot so a range-edge task never fakes a breach.
    const plotRight = positioned.plot.x + positioned.plot.w
    const nodes: RenderedLayoutNode[] = positioned.bars.map(b => {
      const id = b.id ?? `task#${b.taskIndex}`
      if (b.milestoneX !== undefined) {
        const r = b.h / 2
        return { id, x: f(b.milestoneX - r), y: f(b.y), w: f(b.h), h: f(b.h), shape: 'diamond', label: b.label }
      }
      const w = Math.max(2, b.w)
      const x = Math.min(b.x, plotRight - w)
      return { id, x: f(x), y: f(b.y), w: f(w), h: f(b.h), shape: 'rectangle', label: b.label }
    })
    const groups: RenderedLayoutGroup[] = positioned.sections.map((s, i) => ({
      id: `section#${i}`, x: f(positioned.plot.x), y: f(s.y), w: f(positioned.plot.w), h: f(s.h),
      members: positioned.bars.filter(b => b.sectionIndex === i).map(b => b.id ?? `task#${b.taskIndex}`),
      label: s.label,
    }))
    const layout: RenderedLayout = { version: 1, kind: d.kind, nodes, edges: [], groups, bounds: { w: f(positioned.width), h: f(positioned.height) } }
    if (opts.debug) layout.certificates = elementCertificates('gantt', layout, 'section-contained')
    return layout
  } catch { return emptyRenderedLayout(d.kind) }
}

function ganttPositionedForRenderedLayout(d: ValidDiagram): GanttLayoutResult {
  const normalized = normalizeMermaidSource(d.canonicalSource)
  if (d.body.kind === 'gantt') {
    const model = ganttModelFromBody(d.body)
    if (model) {
      const configured = applyGanttFrontmatterConfig(model, normalized.frontmatter)
      const schedule = resolveGanttSchedule(configured)
      return layoutGantt(configured, schedule, { today: schedule.today })
    }
  }
  return buildGanttRenderPipeline(normalized.lines, normalized.frontmatter).positioned
}

function ganttModelFromBody(body: GanttBody): GanttModel | null {
  if (body.statements?.some(st => st.kind === 'opaque-block')) return null
  const sections: GanttModelSection[] = body.sections.map((s, index) => {
    const section: GanttModelSection = { taskIndexes: [], line: index + 1 }
    if (s.label !== undefined) section.label = s.label
    return section
  })
  const model: GanttModel = {
    dateFormat: 'YYYY-MM-DD',
    inclusiveEndDates: false,
    topAxis: false,
    excludes: [],
    includes: [],
    weekendStart: 'saturday',
    weekStart: 'sunday',
    sections: sections.length > 0 ? sections : [{ taskIndexes: [] }],
    tasks: [],
    clicks: [],
  }
  if (body.title !== undefined) model.title = body.title

  for (let sectionIndex = 0; sectionIndex < body.sections.length; sectionIndex++) {
    const section = body.sections[sectionIndex]!
    const modelSection = model.sections[sectionIndex]!
    for (const task of section.tasks) {
      const taskIndex = model.tasks.length
      const modelTask: GanttModelTask = {
        index: taskIndex,
        label: task.label,
        tags: [...task.tags] as GanttTaskTag[],
        end: ganttEndExpr(task.end),
        sectionIndex,
        line: taskIndex + 1,
      }
      if (task.taskId !== undefined) modelTask.id = task.taskId
      if (task.start !== undefined) modelTask.start = ganttStartExpr(task.start)
      model.tasks.push(modelTask)
      modelSection.taskIndexes.push(taskIndex)
    }
  }
  return model
}

function ganttStartExpr(raw: string): GanttStartExpr {
  const after = raw.match(/^after\s+(.+)$/)
  if (after) return { kind: 'after', refs: after[1]!.split(/\s+/).filter(Boolean) }
  return { kind: 'date', raw }
}

function ganttEndExpr(raw: string): GanttEndExpr {
  const until = raw.match(/^until\s+(.+)$/)
  if (until) return { kind: 'until', refs: until[1]!.split(/\s+/).filter(Boolean) }
  if (GANTT_DURATION_RE.test(raw)) return { kind: 'duration', raw }
  return { kind: 'date', raw }
}

/**
 * Closes the "verify ok but render throws" seam for structured gantt bodies
 * (found by harvesting upstream's `excludes weekdays …` parser case): when the
 * schedule cannot resolve, verify surfaces UNRESOLVABLE_SCHEDULE (error
 * severity) carrying the named GANTT_* reason, instead of silently degrading
 * to an empty layout. GANTT_EMPTY maps to the existing EMPTY_DIAGRAM code.
 */
export function ganttScheduleWarning(d: ValidDiagram): LayoutWarning | null {
  try {
    const normalized = normalizeMermaidSource(d.canonicalSource)
    const model = applyGanttFrontmatterConfig(parseGanttModel(normalized.lines), normalized.frontmatter)
    resolveGanttSchedule(model)
    return null
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (message.startsWith('GANTT_EMPTY')) return { code: 'EMPTY_DIAGRAM' }
    return { code: 'UNRESOLVABLE_SCHEDULE', reason: message }
  }
}

/**
 * Geometric tripwires for the gantt layout (docs/design/families/gantt.md
 * §Verification; issue #26 WS11): OFF_CANVAS when a resolved bar/milestone
 * leaves the canvas, GROUP_BREACH when a section-owned bar leaves its section
 * band. The layout produces contained geometry by construction (property-
 * tested), so these fire only if a later pass mutates geometry — the same
 * zero-noise contract as the route-contract tripwires.
 */
export function layoutGeometryWarnings(
  layout: RenderedLayout,
  opts: { edgeAnchors?: boolean; nodeOverlaps?: boolean; groupContainment?: boolean } = {},
): LayoutWarning[] {
  const warnings: LayoutWarning[] = []
  const TOL = 0.5
  for (const n of layout.nodes) {
    if (n.x < -TOL || n.x + n.w > layout.bounds.w + TOL) warnings.push({ code: 'OFF_CANVAS', target: n.id, axis: 'x' })
    if (n.y < -TOL || n.y + n.h > layout.bounds.h + TOL) warnings.push({ code: 'OFF_CANVAS', target: n.id, axis: 'y' })
  }
  for (const e of layout.edges) {
    for (const [x, y] of e.path) {
      if (x < -TOL || x > layout.bounds.w + TOL) { warnings.push({ code: 'OFF_CANVAS', target: e.id, axis: 'x' }); break }
    }
    for (const [x, y] of e.path) {
      if (y < -TOL || y > layout.bounds.h + TOL) { warnings.push({ code: 'OFF_CANVAS', target: e.id, axis: 'y' }); break }
    }
  }
  if (opts.nodeOverlaps) {
    for (let i = 0; i < layout.nodes.length; i++) {
      for (let j = i + 1; j < layout.nodes.length; j++) {
        const a = layout.nodes[i]!, b = layout.nodes[j]!
        const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
        const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
        const area = ox * oy
        if (area > TOL) warnings.push({ code: 'NODE_OVERLAP', a: a.id, b: b.id, areaPx: Math.round(area) })
      }
    }
  }
  if (opts.groupContainment) {
    const nodeById = new Map(layout.nodes.map(n => [n.id, n]))
    for (const g of layout.groups) {
      for (const memberId of g.members) {
        const n = nodeById.get(memberId)
        if (!n) continue
        const inside = n.x >= g.x - TOL && n.y >= g.y - TOL &&
          n.x + n.w <= g.x + g.w + TOL && n.y + n.h <= g.y + g.h + TOL
        if (!inside) warnings.push({ code: 'GROUP_BREACH', group: g.id, member: memberId })
      }
    }
  }
  if (opts.edgeAnchors) {
    const nodeById = new Map(layout.nodes.map(n => [n.id, n]))
    for (const e of layout.edges) {
      const first = e.path[0]
      const last = e.path[e.path.length - 1]
      const source = nodeById.get(e.from)
      const target = nodeById.get(e.to)
      if (first && source && !pointOnRectBoundary(first[0], first[1], source, TOL)) warnings.push({ code: 'ROUTE_SHAPE_MISANCHOR', edge: e.id, node: source.id })
      if (last && target && !pointOnRectBoundary(last[0], last[1], target, TOL)) warnings.push({ code: 'ROUTE_SHAPE_MISANCHOR', edge: e.id, node: target.id })
    }
  }
  return warnings
}

function pointOnRectBoundary(x: number, y: number, n: RenderedLayoutNode, tol: number): boolean {
  const onVertical = (Math.abs(x - n.x) <= tol || Math.abs(x - (n.x + n.w)) <= tol) && y >= n.y - tol && y <= n.y + n.h + tol
  const onHorizontal = (Math.abs(y - n.y) <= tol || Math.abs(y - (n.y + n.h)) <= tol) && x >= n.x - tol && x <= n.x + n.w + tol
  return onVertical || onHorizontal
}

export function ganttGeometryWarnings(layout: RenderedLayout): LayoutWarning[] {
  const warnings: LayoutWarning[] = []
  const TOL = 0.5 // coordinates round through f(); allow rounding slack
  for (const n of layout.nodes) {
    if (n.x < -TOL || n.x + n.w > layout.bounds.w + TOL) warnings.push({ code: 'OFF_CANVAS', target: n.id, axis: 'x' })
    if (n.y < -TOL || n.y + n.h > layout.bounds.h + TOL) warnings.push({ code: 'OFF_CANVAS', target: n.id, axis: 'y' })
  }
  const nodeById = new Map(layout.nodes.map(n => [n.id, n]))
  for (const g of layout.groups) {
    for (const memberId of g.members) {
      const n = nodeById.get(memberId)
      if (!n) continue
      const inside = n.x >= g.x - TOL && n.y >= g.y - TOL &&
        n.x + n.w <= g.x + g.w + TOL && n.y + n.h <= g.y + g.h + TOL
      if (!inside) warnings.push({ code: 'GROUP_BREACH', group: g.id, member: memberId })
    }
  }
  return warnings
}

// ---- quadrant -------------------------------------------------------------

function quadrantToRendered(d: ValidDiagram, opts: { debug?: boolean } = {}): RenderedLayout {
  try {
    const positioned = layoutQuadrantChart(quadrantChartForRenderedLayout(d))
    const nodes: RenderedLayoutNode[] = positioned.points.map((p, i) => ({
      id: `point#${i}:${p.label}`, x: f(p.cx - p.radius), y: f(p.cy - p.radius),
      w: f(p.radius * 2), h: f(p.radius * 2), shape: 'circle', label: p.label,
    }))
    const groups: RenderedLayoutGroup[] = positioned.regions.map(r => ({
      id: `quadrant#${r.number}`, x: f(r.x), y: f(r.y), w: f(r.width), h: f(r.height), members: [], label: r.label,
    }))
    const layout: RenderedLayout = { version: 1, kind: d.kind, nodes, edges: [], groups, bounds: { w: f(positioned.width), h: f(positioned.height) } }
    if (opts.debug) layout.certificates = elementCertificates('quadrant', layout, 'plot-contained')
    return layout
  } catch { return emptyRenderedLayout(d.kind) }
}

function quadrantChartForRenderedLayout(d: ValidDiagram): QuadrantChart {
  if (d.body.kind === 'quadrant') return quadrantChartFromBody(d.body)
  return parseQuadrantChart(toMermaidLines(d.canonicalSource))
}

function quadrantChartFromBody(body: QuadrantBody): QuadrantChart {
  const chart: QuadrantChart = {
    quadrants: [...body.quadrants] as QuadrantChart['quadrants'],
    points: body.points.map(p => ({ label: p.label, x: p.x, y: p.y })),
  }
  if (body.title !== undefined) chart.title = body.title
  if (body.xAxis) chart.xAxis = { ...body.xAxis }
  if (body.yAxis) chart.yAxis = { ...body.yAxis }
  return chart
}
