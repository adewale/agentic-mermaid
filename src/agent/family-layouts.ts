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

import type { ValidDiagram, RenderedLayout, RenderedLayoutNode, RenderedLayoutEdge, RenderedLayoutGroup, Finite } from './types.ts'
import { toFinite } from './types.ts'
import { emptyRenderedLayout } from './layout-to-rendered.ts'

import { toMermaidLines, normalizeMermaidSource } from '../mermaid-source.ts'
import { parseClassDiagram } from '../class/parser.ts'
import { layoutClassDiagramSync } from '../class/layout.ts'
import { parseErDiagram } from '../er/parser.ts'
import { layoutErDiagramSync } from '../er/layout.ts'
import { parseJourneyDiagram } from '../journey/parser.ts'
import { layoutJourneyDiagram } from '../journey/layout.ts'
import { parseArchitectureDiagram } from '../architecture/parser.ts'
import { layoutArchitectureDiagram } from '../architecture/layout.ts'
import { parseXYChart } from '../xychart/parser.ts'
import { layoutXYChart } from '../xychart/layout.ts'
import type { PositionedArchitectureGroup } from '../architecture/types.ts'
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
 * families this module doesn't own (flowchart/state/sequence/timeline are
 * handled in index.ts) so the caller can keep its existing dispatch.
 */
export function layoutFamilyToRendered(d: ValidDiagram): RenderedLayout | null {
  // Each adapter is self-contained: it wraps the legacy parse+layout in
  // try/catch and degrades to emptyRenderedLayout(d.kind) on render-error, so
  // an invalid opaque body of a renderable family never makes this throw.
  switch (d.kind) {
    case 'class':        return classToRendered(d)
    case 'er':           return erToRendered(d)
    case 'journey':      return journeyToRendered(d)
    case 'architecture': return architectureToRendered(d)
    case 'xychart':      return xychartToRendered(d)
    case 'pie':          return pieToRendered(d)
    case 'quadrant':     return quadrantToRendered(d)
    case 'gantt':        return ganttToRendered(d)
    default:             return null
  }
}

// ---- class ----------------------------------------------------------------

function classToRendered(d: ValidDiagram): RenderedLayout {
  try {
    const positioned = layoutClassDiagramSync(parseClassDiagram(toMermaidLines(d.canonicalSource)))
    const nodes: RenderedLayoutNode[] = positioned.classes.map(c => ({
      id: c.id, x: f(c.x), y: f(c.y), w: f(c.width), h: f(c.height), shape: 'rectangle', label: c.label,
    }))
    const edges: RenderedLayoutEdge[] = positioned.relationships.map((r, i) => ({
      id: `rel#${i}:${r.from}->${r.to}`, from: r.from, to: r.to,
      path: r.points.map(p => [f(p.x), f(p.y)] as [Finite, Finite]),
      label: r.label && r.labelPosition ? { x: f(r.labelPosition.x), y: f(r.labelPosition.y), text: r.label } : undefined,
    }))
    return { version: 1, kind: d.kind, nodes, edges, groups: [], bounds: { w: f(positioned.width), h: f(positioned.height) } }
  } catch { return emptyRenderedLayout(d.kind) }
}

// ---- er -------------------------------------------------------------------

function erToRendered(d: ValidDiagram): RenderedLayout {
  try {
    const positioned = layoutErDiagramSync(parseErDiagram(toMermaidLines(d.canonicalSource)))
    const nodes: RenderedLayoutNode[] = positioned.entities.map(e => ({
      id: e.id, x: f(e.x), y: f(e.y), w: f(e.width), h: f(e.height), shape: 'rectangle', label: e.label,
    }))
    const edges: RenderedLayoutEdge[] = positioned.relationships.map((r, i) => ({
      id: `rel#${i}:${r.entity1}->${r.entity2}`, from: r.entity1, to: r.entity2,
      path: r.points.map(p => [f(p.x), f(p.y)] as [Finite, Finite]),
      label: r.label ? labelMidpoint(r.points, r.label) : undefined,
    }))
    return { version: 1, kind: d.kind, nodes, edges, groups: [], bounds: { w: f(positioned.width), h: f(positioned.height) } }
  } catch { return emptyRenderedLayout(d.kind) }
}

function labelMidpoint(points: Array<{ x: number; y: number }>, text: string): { x: Finite; y: Finite; text: string } | undefined {
  if (points.length === 0) return undefined
  const mid = points[Math.floor(points.length / 2)]!
  return { x: f(mid.x), y: f(mid.y), text }
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

function architectureToRendered(d: ValidDiagram): RenderedLayout {
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
    const edges: RenderedLayoutEdge[] = positioned.edges.map((e, i) => ({
      id: `edge#${i}:${e.source.id}->${e.target.id}`, from: e.source.id, to: e.target.id,
      path: e.points.map(p => [f(p.x), f(p.y)] as [Finite, Finite]),
      label: e.label && e.labelPosition ? { x: f(e.labelPosition.x), y: f(e.labelPosition.y), text: e.label } : undefined,
    }))
    const groups: RenderedLayoutGroup[] = []
    const flatten = (g: PositionedArchitectureGroup): void => {
      groups.push({ id: g.id, x: f(g.x), y: f(g.y), w: f(g.width), h: f(g.height), members: [], label: g.label })
      for (const c of g.children) flatten(c)
    }
    for (const g of positioned.groups) flatten(g)
    return { version: 1, kind: d.kind, nodes, edges, groups, bounds: { w: f(positioned.width), h: f(positioned.height) } }
  } catch { return emptyRenderedLayout(d.kind) }
}

// ---- xychart --------------------------------------------------------------

function xychartToRendered(d: ValidDiagram): RenderedLayout {
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
    return { version: 1, kind: d.kind, nodes, edges: [], groups, bounds: { w: f(positioned.width), h: f(positioned.height) } }
  } catch { return emptyRenderedLayout(d.kind) }
}

// ---- pie ------------------------------------------------------------------

function pieToRendered(d: ValidDiagram): RenderedLayout {
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
    return { version: 1, kind: d.kind, nodes, edges: [], groups: [], bounds: { w: f(positioned.width), h: f(positioned.height) } }
  } catch { return emptyRenderedLayout(d.kind) }
}

// ---- gantt ------------------------------------------------------------------

function ganttToRendered(d: ValidDiagram): RenderedLayout {
  try {
    const normalized = normalizeMermaidSource(d.canonicalSource)
    const model = applyGanttFrontmatterConfig(parseGanttModel(normalized.lines), normalized.frontmatter)
    const schedule = resolveGanttSchedule(model)
    const positioned = layoutGantt(model, schedule)
    // Bars and milestones are the nodes; section bands are the groups. Verts
    // and ticks are markers, not boxes — they carry no node area.
    const nodes: RenderedLayoutNode[] = positioned.bars.map(b => ({
      id: b.id ?? `task#${b.taskIndex}`, x: f(b.x), y: f(b.y), w: f(Math.max(2, b.w)), h: f(b.h),
      shape: 'rectangle', label: b.label,
    }))
    const groups: RenderedLayoutGroup[] = positioned.sections.map((s, i) => ({
      id: `section#${i}`, x: f(positioned.plot.x), y: f(s.y), w: f(positioned.plot.w), h: f(s.h),
      members: positioned.bars.filter(b => b.sectionIndex === i).map(b => b.id ?? `task#${b.taskIndex}`),
      label: s.label,
    }))
    return { version: 1, kind: d.kind, nodes, edges: [], groups, bounds: { w: f(positioned.width), h: f(positioned.height) } }
  } catch { return emptyRenderedLayout(d.kind) }
}

// ---- quadrant -------------------------------------------------------------

function quadrantToRendered(d: ValidDiagram): RenderedLayout {
  try {
    const positioned = layoutQuadrantChart(parseQuadrantChart(toMermaidLines(d.canonicalSource)))
    const nodes: RenderedLayoutNode[] = positioned.points.map((p, i) => ({
      id: `point#${i}:${p.label}`, x: f(p.cx - p.radius), y: f(p.cy - p.radius),
      w: f(p.radius * 2), h: f(p.radius * 2), shape: 'circle', label: p.label,
    }))
    const groups: RenderedLayoutGroup[] = positioned.regions.map(r => ({
      id: `quadrant#${r.number}`, x: f(r.x), y: f(r.y), w: f(r.width), h: f(r.height), members: [], label: r.label,
    }))
    return { version: 1, kind: d.kind, nodes, edges: [], groups, bounds: { w: f(positioned.width), h: f(positioned.height) } }
  } catch { return emptyRenderedLayout(d.kind) }
}
