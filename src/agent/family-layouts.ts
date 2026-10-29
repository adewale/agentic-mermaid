import { positionedPaintCertification } from '../scene/positioned.ts'
import { assertScenesOf } from '../scene/assertions.ts'
import { PaintLayoutCertificationError, retainRenderedPaintCertification } from '../scene/paint-certification.ts'
// ============================================================================
// Canonical positioned-artifact → RenderedLayout projections.
//
// The perceptual-quality metrics (measureQuality / checkQuality) operate on a
// RenderedLayout. Every projector in this module is deliberately pure over the
// artifact supplied by its FamilyDescriptor: no projector parses source or
// performs layout. SVG, PNG, layout JSON, verification, certificates, and
// quality checks therefore share the same family-owned positioning path.
//
// This module closes that gap by projecting each family's REAL positioned
// layout (the same artifact type its SVG renderer draws) into RenderedLayout:
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
//   radar        axes/data/legend/title       —                      graticule rings
//   gantt         tasks + milestones           —                      section bands
//
// The layout-JSON facade invokes a descriptor once for normal input. A narrow
// structured-body fallback retains the pre-existing stale-source resilience;
// descriptor failures otherwise propagate with family/operation context. All
// projected coordinates pass through toFinite (throws on
// NaN/Infinity), so a garbage artifact fails loudly rather than silently
// poisoning the metrics.
//
// Determinism: each view is a deterministic function of one positioned input.
// ============================================================================

import { applyGanttFrontmatterConfig, parseGanttModel } from '../gantt/parser.ts'
import { resolveGanttSchedule } from '../gantt/schedule.ts'
import { AuthoredStyleColorError } from '../shared/style-props.ts'
import { normalizeMermaidSource } from '../mermaid-source.ts'
import { positionResolvedFamily, retainedFamilyProjection } from '../positioning.ts'
import type { RenderOutput, ResolvedRenderRequest } from '../render-contract.ts'
import { RenderConfigError, resolvedRenderExecutionPlanOf, resolveRenderRequest } from '../render-contract.ts'
import { withTextMeasurementExecution } from '../text-measurement-profile.ts'
import type { PositionedDiagram, RenderOptions } from '../types.ts'
import type { FamilyLayoutResult, FamilyPositionedProjectionOptions, FamilyPositionedView } from './families.ts'
import { getFamily } from './families.ts'
import { renderSourceForParsedDiagram } from './render-input.ts'
import { serializeMermaid } from './serialize.ts'
import type { FamilyId, LayoutWarning, ParsedDiagram, RenderedLayout, RenderedLayoutNode, ValidDiagram } from './types.ts'

export { projectGraphPositioned } from '../positioned-views/graph.ts'
export { projectMindmapPositioned } from '../positioned-views/mindmap.ts'
export { projectGitGraphPositioned } from '../positioned-views/gitgraph.ts'
export { projectClassPositioned } from '../positioned-views/class.ts'
export { projectErPositioned } from '../positioned-views/er.ts'
export { projectSequencePositioned } from '../positioned-views/sequence.ts'
export { projectTimelinePositioned } from '../positioned-views/timeline.ts'
export { projectJourneyPositioned } from '../positioned-views/journey.ts'
export { projectArchitecturePositioned } from '../positioned-views/architecture.ts'
export { projectXyChartPositioned } from '../positioned-views/xychart.ts'
export { projectPiePositioned } from '../positioned-views/pie.ts'
export { projectGanttPositioned } from '../positioned-views/gantt.ts'
export { projectQuadrantPositioned } from '../positioned-views/quadrant.ts'
export { projectRadarPositioned } from '../positioned-views/radar.ts'
export { projectSankeyPositioned } from '../positioned-views/sankey.ts'

export interface ProjectedFamilyArtifact {
  /** Resolved request whose executable family/backend references stay private. */
  request: ResolvedRenderRequest
  /** Exact result, including accessibility ownership, consumed by SVG. */
  layoutResult: FamilyLayoutResult
  /** Exact output of the descriptor-owned layout hook. */
  positioned: PositionedDiagram
  /** Family-neutral descriptor projection, stamped with the built-in id. */
  rendered: RenderedLayout
}

/** Projection controls plus the shared render options consumed by SVG/PNG. */
export interface PositionFamilyArtifactOptions extends FamilyPositionedProjectionOptions {
  renderOptions?: RenderOptions
  /** Internal adapter selection; public layout remains the default. */
  output?: Extract<RenderOutput, 'layout' | 'svg'>
  /** Cross-check every built-in Scene lowered for this artifact, as verify does. */
  assertScenes?: boolean
}

/** A descriptor layout/projection failure with enough context for public
 * adapters to distinguish it from verification and parsing failures. The hook's
 * own error stays its ES2022 `cause`, so verify can still tell whose it is. */
export class FamilyLayoutError extends Error {
  readonly family: FamilyId
  readonly operation: 'layout' | 'projectPositioned'

  constructor(family: FamilyId, operation: 'layout' | 'projectPositioned', cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    super(`Mermaid family "${family}" ${operation} hook failed: ${reason}`, { cause })
    this.name = 'FamilyLayoutError'
    this.family = family
    this.operation = operation
  }
}

/** Project one already-resolved request without re-reading raw public options. */
export function positionResolvedFamilyArtifact(d: ParsedDiagram, request: ResolvedRenderRequest, options: FamilyPositionedProjectionOptions = {}): ProjectedFamilyArtifact | null {
  const executionPlan = resolvedRenderExecutionPlanOf(request)
  const descriptor = executionPlan.family
  if (descriptor.id !== d.kind) {
    throw new Error(`Resolved request planned family ${descriptor.id}, not ${d.kind}`)
  }
  if (!descriptor.layout || !descriptor.projectPositioned) return null
  if (request.renderOptions.layoutSafety === 'strict' && (!descriptor.lowerScene || d.kind.startsWith('family:'))) throw new FamilyLayoutError(d.kind, 'projectPositioned', new RenderConfigError('Strict layout safety requires native Scene evidence'))
  let result: ReturnType<typeof positionResolvedFamily>
  try {
    result = positionResolvedFamily(d.kind, request, request.source, options)
  } catch (error) {
    throw new FamilyLayoutError(d.kind, 'layout', error)
  }
  let view: FamilyPositionedView
  try {
    view = retainedFamilyProjection(result) ?? withTextMeasurementExecution(executionPlan.textMeasurement, () =>
      descriptor.projectPositioned!({ positioned: result.positioned, options }))
  } catch (error) {
    throw new FamilyLayoutError(d.kind, 'projectPositioned', error)
  }
  const rendered = stampFamilyKind(d.kind, view)
  if (descriptor.lowerScene && !d.kind.startsWith('family:')) {
    const certification = positionedPaintCertification(request, result)
    if (request.renderOptions.layoutSafety === 'strict' && certification.status !== 'passed') throw new PaintLayoutCertificationError(certification)
    retainRenderedPaintCertification(rendered, certification)
    if (options.debug) rendered.paintCertification = certification
  }
  return { request, layoutResult: result, positioned: result.positioned, rendered }
}

function structuredBodyExpectsNodes(d: ParsedDiagram): boolean {
  switch (d.body.kind) {
    case 'xychart':
      return d.body.series.length > 0
    case 'pie':
      return d.body.slices.length > 0
    case 'gantt':
      return d.body.sections.some(section => section.tasks.length > 0)
    default:
      return false
  }
}

/** Stamp the public family id without changing the established JSON field
 * order. The layout-equivalence baseline deliberately treats that order as
 * part of the byte-stable layout contract. */
function stampFamilyKind(kind: FamilyId, view: FamilyPositionedView): RenderedLayout {
  const rendered: RenderedLayout = {
    version: view.version,
    kind,
    nodes: view.nodes,
    edges: view.edges,
    groups: view.groups,
    bounds: view.bounds,
  }
  // Historically debug certificates were appended after the base layout.
  // Assignment preserves that serialization order while keeping the view
  // projector family-neutral.
  if (view.certificates !== undefined) rendered.certificates = view.certificates
  if (view.labels !== undefined) rendered.labels = view.labels
  return rendered
}

/**
 * Invoke a descriptor's pure positioned view without parsing or laying out.
 * This open-id form is useful to extension conformance tests even though the
 * current public `RenderedLayout` envelope remains a closed built-in union.
 */
export function projectPositionedView(familyId: FamilyId, positioned: PositionedDiagram, options: FamilyPositionedProjectionOptions = {}): FamilyPositionedView | null {
  const descriptor = getFamily(familyId)
  if (!descriptor?.projectPositioned) return null
  return descriptor.projectPositioned({ positioned, options })
}

/**
 * Produce the one canonical positioned artifact used by every agent
 * projection. Most descriptors receive `canonicalSource` under the diagram's
 * config wrapper, preserving authored declaration order and drawing what the
 * saved source draws, while removing the independent family parsers and
 * layouters that previously interpreted that source.
 * Families whose former adapter was body/config based use their canonical
 * serializer as the source-context bridge; the descriptor still owns all
 * parsing and positioning.
 */
export function familyArtifactSource(d: ParsedDiagram): string {
  return renderSourceForParsedDiagram(d)
}

export function positionFamilyArtifact(d: ParsedDiagram, options: PositionFamilyArtifactOptions = {}): ProjectedFamilyArtifact | null {
  const descriptor = getFamily(d.kind)
  if (!descriptor?.layout || !descriptor.projectPositioned) return null
  const projectionOptions: FamilyPositionedProjectionOptions = { debug: options.debug }

  const sourceText = familyArtifactSource(d)
  const canRetryFromBody = structuredBodyExpectsNodes(d)

  const projectSource = (text: string): ProjectedFamilyArtifact => {
    const output = options.output ?? 'layout'
    const request = resolveRenderRequest(text, options.renderOptions ?? {}, output, output === 'layout' ? projectionOptions : undefined)
    if (options.assertScenes) assertScenesOf(request)
    return positionResolvedFamilyArtifact(d, request, projectionOptions)!
  }

  // Valid mutations rebuild canonicalSource, but callers can still construct
  // a structurally valid object with stale source. Preserve the existing
  // structured-body resilience by retrying through the canonical serializer
  // only when the historical source projection has no semantic nodes (or
  // cannot be positioned). Normal diagrams — including every built-in
  // conformance example — invoke the descriptor exactly once.
  let primary: ProjectedFamilyArtifact
  try {
    primary = projectSource(sourceText)
  } catch (error) {
    if (!canRetryFromBody) throw error
    const serialized = serializeMermaid(d)
    if (serialized === sourceText) throw error
    return projectSource(serialized)
  }
  if (!canRetryFromBody || primary.rendered.nodes.length > 0) return primary
  const serialized = serializeMermaid(d)
  return serialized === sourceText ? primary : projectSource(serialized)
}

/** Layout-JSON facade. Descriptor failures propagate with family/operation context. */
export function layoutFamilyToRendered(d: ParsedDiagram, options: PositionFamilyArtifactOptions = {}): RenderedLayout | null {
  const descriptor = getFamily(d.kind)
  if (!descriptor?.layout || !descriptor.projectPositioned) return null
  return positionFamilyArtifact(d, options)?.rendered ?? null
}

/** Facade for adapters that already own a canonical request receipt. */
export function layoutResolvedFamilyToRendered(d: ParsedDiagram, request: ResolvedRenderRequest, options: FamilyPositionedProjectionOptions = {}): RenderedLayout | null {
  return positionResolvedFamilyArtifact(d, request, options)?.rendered ?? null
}

/** Flowchart and state share the canonical ELK positioned-graph view. */

// ---- gantt ------------------------------------------------------------------

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
    return e instanceof AuthoredStyleColorError
      ? { code: 'RENDER_FAILED', reason: message, origin: 'source' }
      : { code: 'UNRESOLVABLE_SCHEDULE', reason: message }
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
export function layoutGeometryWarnings(layout: RenderedLayout, opts: { edgeAnchors?: boolean; nodeOverlaps?: boolean; groupContainment?: boolean | 'center' } = {}): LayoutWarning[] {
  const warnings: LayoutWarning[] = []
  const TOL = 0.5
  for (const n of layout.nodes) {
    if (n.x < -TOL || n.x + n.w > layout.bounds.w + TOL) warnings.push({ code: 'OFF_CANVAS', target: n.id, axis: 'x' })
    if (n.y < -TOL || n.y + n.h > layout.bounds.h + TOL) warnings.push({ code: 'OFF_CANVAS', target: n.id, axis: 'y' })
  }
  for (const e of layout.edges) {
    for (const [x, y] of e.path) {
      if (x < -TOL || x > layout.bounds.w + TOL) {
        warnings.push({ code: 'OFF_CANVAS', target: e.id, axis: 'x' })
        break
      }
    }
    for (const [x, y] of e.path) {
      if (y < -TOL || y > layout.bounds.h + TOL) {
        warnings.push({ code: 'OFF_CANVAS', target: e.id, axis: 'y' })
        break
      }
    }
  }
  for (const label of layout.labels ?? []) {
    if (label.visibility === 'hidden' || label.visibility === 'semantic' || !label.bounds) continue
    const { x, y, w, h } = label.bounds
    if (x < -TOL || x + w > layout.bounds.w + TOL) warnings.push({ code: 'OFF_CANVAS', target: label.id, axis: 'x' })
    if (y < -TOL || y + h > layout.bounds.h + TOL) warnings.push({ code: 'OFF_CANVAS', target: label.id, axis: 'y' })
  }
  if (opts.nodeOverlaps) {
    for (let i = 0; i < layout.nodes.length; i++) {
      for (let j = i + 1; j < layout.nodes.length; j++) {
        const a = layout.nodes[i]!,
          b = layout.nodes[j]!
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
        const inside = opts.groupContainment === 'center' ? n.x + n.w / 2 >= g.x - TOL && n.y + n.h / 2 >= g.y - TOL && n.x + n.w / 2 <= g.x + g.w + TOL && n.y + n.h / 2 <= g.y + g.h + TOL : n.x >= g.x - TOL && n.y >= g.y - TOL && n.x + n.w <= g.x + g.w + TOL && n.y + n.h <= g.y + g.h + TOL
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
      const inside = n.x >= g.x - TOL && n.y >= g.y - TOL && n.x + n.w <= g.x + g.w + TOL && n.y + n.h <= g.y + g.h + TOL
      if (!inside) warnings.push({ code: 'GROUP_BREACH', group: g.id, member: memberId })
    }
  }
  return warnings
}
