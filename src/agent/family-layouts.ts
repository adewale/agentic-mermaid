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

import type { ValidDiagram, RenderedLayout, RenderedLayoutNode, RenderedLayoutEdge, RenderedLayoutGroup, LayoutWarning, Finite } from './types.ts'
import type { FamilyRouteCertificate, Point } from '../types.ts'
import { toFinite } from './types.ts'
import { emptyRenderedLayout } from './layout-to-rendered.ts'

import { toMermaidLines, normalizeMermaidSource } from '../mermaid-source.ts'
import { parseClassDiagram } from '../class/parser.ts'
import { layoutClassDiagramSync } from '../class/layout.ts'
import { parseErDiagram } from '../er/parser.ts'
import { layoutErDiagramSync } from '../er/layout.ts'
import { layoutSequenceDiagram } from '../sequence/layout.ts'
import { parseTimelineDiagram } from '../timeline/parser.ts'
import { layoutTimelineDiagram } from '../timeline/layout.ts'
import { parseJourneyDiagram } from '../journey/parser.ts'
import { layoutJourneyDiagram } from '../journey/layout.ts'
import { parseArchitectureDiagram } from '../architecture/parser.ts'
import { layoutArchitectureDiagram } from '../architecture/layout.ts'
import { parseXYChart } from '../xychart/parser.ts'
import { layoutXYChart } from '../xychart/layout.ts'
import type { PositionedArchitectureEdge, PositionedArchitectureGroup, PositionedArchitectureJunction, PositionedArchitectureService } from '../architecture/types.ts'
import { parsePieChart } from '../pie/parser.ts'
import { layoutPieChart } from '../pie/layout.ts'
import { parseQuadrantChart } from '../quadrant/parser.ts'
import { layoutQuadrantChart } from '../quadrant/layout.ts'
import { parseGanttModel, applyGanttFrontmatterConfig } from '../gantt/parser.ts'
import { resolveGanttSchedule } from '../gantt/schedule.ts'
import { layoutGantt } from '../gantt/layout.ts'

function f(n: number): Finite { return toFinite(Math.round(n)) }

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
    const positioned = layoutClassDiagramSync(parseClassDiagram(toMermaidLines(d.canonicalSource)))
    const nodes: RenderedLayoutNode[] = positioned.classes.map(c => ({
      id: c.id, x: f(c.x), y: f(c.y), w: f(c.width), h: f(c.height), shape: 'rectangle', label: c.label,
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
    const positioned = layoutErDiagramSync(parseErDiagram(toMermaidLines(d.canonicalSource)))
    const nodes: RenderedLayoutNode[] = positioned.entities.map(e => ({
      id: e.id, x: f(e.x), y: f(e.y), w: f(e.width), h: f(e.height), shape: 'rectangle', label: e.label,
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
): FamilyRouteCertificate {
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
type ElementCertificateInvariant = Extract<FamilyRouteCertificate, { family: ElementCertificateFamily }>['invariant']

function elementCertificates(
  family: ElementCertificateFamily,
  layout: RenderedLayout,
  invariant: ElementCertificateInvariant,
  referenceGroup?: RenderedLayoutGroup,
): FamilyRouteCertificate[] {
  const groupsByMember = new Map<string, RenderedLayoutGroup>()
  for (const group of layout.groups) {
    for (const member of group.members) groupsByMember.set(member, group)
  }
  return layout.nodes.map(n => {
    const withinBounds = nodeWithinBounds(n, layout.bounds)
    const group = groupsByMember.get(n.id) ?? referenceGroup
    const withinGroup = group ? nodeWithinGroup(n, group) : undefined
    return {
      family,
      elementId: n.id,
      routeClass: 'family-layout',
      invariant: withinBounds && (withinGroup ?? true) ? invariant : 'unverified-family-layout',
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

// ---- sequence -------------------------------------------------------------

function sequenceToRendered(d: ValidDiagram, opts: { debug?: boolean } = {}): RenderedLayout {
  try {
    if (d.body.kind !== 'sequence') return emptyRenderedLayout(d.kind)
    const positioned = layoutSequenceDiagram({
      actors: d.body.participants.map(p => ({ id: p.id, label: p.label, type: p.kind })),
      messages: d.body.messages.map(m => ({
        from: m.from, to: m.to, label: m.text,
        lineStyle: m.style === 'reply' || m.style === 'async-dashed' || m.style === 'lost-dashed' ? 'dashed' : 'solid',
        arrowHead: m.style === 'async' || m.style === 'async-dashed' ? 'open' : 'filled',
      })),
      blocks: [], notes: [],
    })
    const lifelineByActor = new Map(positioned.lifelines.map(l => [l.actorId, l.x]))
    return {
      version: 1, kind: d.kind,
      nodes: positioned.actors.map(a => ({
        id: a.id, x: f(a.x - a.width / 2), y: f(a.y), w: f(a.width), h: f(a.height),
        shape: 'rectangle', label: a.label,
      })),
      edges: positioned.messages.map((m, i) => ({
        id: `msg#${i}:${m.from}->${m.to}`, from: m.from, to: m.to,
        path: [[f(m.x1), f(m.y)], [f(m.x2), f(m.y)]],
        label: m.label ? { x: f((m.x1 + m.x2) / 2), y: f(m.y), text: m.label } : undefined,
        route: opts.debug ? sequenceRouteCertificate(i, m, lifelineByActor) : undefined,
      })),
      groups: positioned.blocks.map((b, i) => ({
        id: `block#${i}:${b.type}`, x: f(b.x), y: f(b.y), w: f(b.width), h: f(b.height), members: [], label: b.label,
      })),
      bounds: { w: f(positioned.width), h: f(positioned.height) },
    }
  } catch { return emptyRenderedLayout(d.kind) }
}

function sequenceRouteCertificate(
  edgeIndex: number,
  message: { from: string; to: string; x1: number; x2: number; y: number; isSelf: boolean },
  lifelineByActor: Map<string, number>,
): FamilyRouteCertificate {
  const sourceX = lifelineByActor.get(message.from)
  const targetX = lifelineByActor.get(message.to)
  const sourceLifeline = sourceX !== undefined && Math.abs(message.x1 - sourceX) <= 1
  const targetLifeline = targetX !== undefined && Math.abs(message.x2 - targetX) <= 1
  const horizontal = true // sequence messages render on a single lifeline row in this adapter
  return {
    family: 'sequence',
    edgeIndex,
    routeClass: 'family-layout',
    invariant: sourceLifeline && targetLifeline ? (message.isSelf ? 'self-message' : 'lifeline-message') : 'unverified-family-route',
    bendCount: 0,
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
      groups.push({ id: s.id, x: f(s.x), y: f(s.y), w: f(s.width), h: f(s.height), members: memberIds, label: s.label })
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
): FamilyRouteCertificate {
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
    const normalized = normalizeMermaidSource(d.canonicalSource)
    const positioned = layoutXYChart(parseXYChart(normalized.lines, normalized.frontmatter))
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
    if (opts.debug) layout.certificates = elementCertificates('xychart', layout, 'plot-contained', groups[0])
    return layout
  } catch { return emptyRenderedLayout(d.kind) }
}

// ---- pie ------------------------------------------------------------------

function pieToRendered(d: ValidDiagram, opts: { debug?: boolean } = {}): RenderedLayout {
  try {
    const positioned = layoutPieChart(parsePieChart(toMermaidLines(d.canonicalSource)))
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

// ---- gantt ------------------------------------------------------------------

function ganttToRendered(d: ValidDiagram, opts: { debug?: boolean } = {}): RenderedLayout {
  try {
    const normalized = normalizeMermaidSource(d.canonicalSource)
    const model = applyGanttFrontmatterConfig(parseGanttModel(normalized.lines), normalized.frontmatter)
    const schedule = resolveGanttSchedule(model)
    const positioned = layoutGantt(model, schedule)
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
 * Geometric tripwires for the gantt layout (docs/design/gantt.md
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
    const positioned = layoutQuadrantChart(parseQuadrantChart(toMermaidLines(d.canonicalSource)))
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
