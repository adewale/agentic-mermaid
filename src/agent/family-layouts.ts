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

import type {
  ParsedDiagram,
  ValidDiagram,
  RenderedLayout,
  RenderedLayoutNode,
  RenderedLayoutEdge,
  RenderedLayoutGroup,
  LayoutWarning,
  Finite,
  FamilyId,
} from './types.ts'
import type {
  FamilyEdgeRouteCertificate, Point, PositionedDiagram, PositionedGraph, RegionContainmentCertificate, RenderOptions,
} from '../types.ts'
import { toFinite } from './types.ts'
import { emptyRenderedLayout, positionedGraphToRenderedView } from './layout-to-rendered.ts'
import { serializeMermaid } from './serialize.ts'
import { getFamily } from './families.ts'
import type {
  FamilyPositionedProjectionContext, FamilyPositionedProjectionOptions,
  FamilyPositionedView, FamilyLayoutResult,
} from './families.ts'
import { resolveRenderRequest, resolvedRenderExecutionPlanOf } from '../render-contract.ts'
import type { RenderOutput, ResolvedRenderRequest } from '../render-contract.ts'
import { positionResolvedFamily } from '../positioning.ts'

import { normalizeMermaidSource } from '../mermaid-source.ts'
import type { PositionedClassDiagram } from '../class/types.ts'
import type { PositionedErDiagram } from '../er/types.ts'
import { ER_STYLE_DEFAULTS } from '../er/layout.ts'
import { separateRelationshipLabels } from '../er/renderer.ts'
import { resolveRenderStyle } from '../styles.ts'
import type { PositionedSequenceDiagram } from '../sequence/types.ts'
import type { PositionedTimelineDiagram } from '../timeline/types.ts'
import type { PositionedJourneyDiagram } from '../journey/types.ts'
import type {
  PositionedArchitectureDiagram, PositionedArchitectureEdge, PositionedArchitectureGroup,
  PositionedArchitectureJunction, PositionedArchitectureService,
} from '../architecture/types.ts'
import type { PositionedXYChart } from '../xychart/types.ts'
import type { PositionedPieChart } from '../pie/types.ts'
import { formatPiePercent } from '../pie/layout.ts'
import type { PositionedQuadrantChart } from '../quadrant/types.ts'
import { parseGanttModel, applyGanttFrontmatterConfig } from '../gantt/parser.ts'
import { resolveGanttSchedule } from '../gantt/schedule.ts'
import type { GanttLayoutResult } from '../gantt/types.ts'
import type { PositionedMindmapDiagram } from '../mindmap/types.ts'
import type { PositionedGitGraphDiagram } from '../gitgraph/types.ts'

function f(n: number): Finite { return toFinite(Math.round(n)) }

/** Round a span against its rounded start. Rounding x and width
 *  independently can shift the far edge ±1px away from rounded edge
 *  endpoints, which fires the class/ER anchor tripwires (TOL 0.5) on
 *  geometry that sits exactly on-boundary pre-rounding — observed live on
 *  an onboarding-probe ER diagram. Used where edgeAnchors checks run. */
function fSpan(start: number, length: number): Finite { return toFinite(Math.round(start + length) - Math.round(start)) }

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
}

/** A descriptor layout/projection failure with enough context for public
 * adapters to distinguish it from verification and parsing failures. */
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
export function positionResolvedFamilyArtifact(
  d: ParsedDiagram,
  request: ResolvedRenderRequest,
  options: FamilyPositionedProjectionOptions = {},
): ProjectedFamilyArtifact | null {
  const descriptor = resolvedRenderExecutionPlanOf(request).family
  if (descriptor.id !== d.kind) {
    throw new Error(`Resolved request planned family ${descriptor.id}, not ${d.kind}`)
  }
  if (!descriptor.layout || !descriptor.projectPositioned) return null
  let result: ReturnType<typeof positionResolvedFamily>
  try {
    result = positionResolvedFamily(d.kind, request)
  } catch (error) {
    throw new FamilyLayoutError(d.kind, 'layout', error)
  }
  let view: FamilyPositionedView
  try {
    view = descriptor.projectPositioned({ positioned: result.positioned, options })
  } catch (error) {
    throw new FamilyLayoutError(d.kind, 'projectPositioned', error)
  }
  return {
    request,
    layoutResult: result,
    positioned: result.positioned,
    rendered: stampFamilyKind(d.kind, view),
  }
}

function structuredBodyExpectsNodes(d: ParsedDiagram): boolean {
  switch (d.body.kind) {
    case 'xychart': return d.body.series.length > 0
    case 'pie': return d.body.slices.length > 0
    case 'gantt': return d.body.sections.some(section => section.tasks.length > 0)
    default: return false
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
  return rendered
}

/**
 * Invoke a descriptor's pure positioned view without parsing or laying out.
 * This open-id form is useful to extension conformance tests even though the
 * current public `RenderedLayout` envelope remains a closed built-in union.
 */
export function projectPositionedView(
  familyId: FamilyId,
  positioned: PositionedDiagram,
  options: FamilyPositionedProjectionOptions = {},
): FamilyPositionedView | null {
  const descriptor = getFamily(familyId)
  if (!descriptor?.projectPositioned) return null
  return descriptor.projectPositioned({ positioned, options })
}

/**
 * Produce the one canonical positioned artifact used by every agent
 * projection. Most descriptors receive `canonicalSource`, preserving the
 * established RenderedLayout contract (including authored declaration order
 * and its historical wrapper/config policy) while removing the independent
 * family parsers and layouters that previously interpreted that source.
 * Families whose former adapter was body/config based use their canonical
 * serializer as the source-context bridge; the descriptor still owns all
 * parsing and positioning.
 */
export function positionFamilyArtifact(
  d: ParsedDiagram,
  options: PositionFamilyArtifactOptions = {},
): ProjectedFamilyArtifact | null {
  const descriptor = getFamily(d.kind)
  if (!descriptor?.layout || !descriptor.projectPositioned) return null
  const projectionOptions: FamilyPositionedProjectionOptions = { debug: options.debug }

  const sourceText = d.body.kind !== 'opaque' && (
    d.kind === 'state' || d.kind === 'quadrant' || d.kind === 'mindmap' || d.kind === 'gitgraph'
  )
    ? serializeMermaid(d)
    : d.canonicalSource
  const canRetryFromBody = structuredBodyExpectsNodes(d)

  const projectSource = (text: string): ProjectedFamilyArtifact => {
    const output = options.output ?? 'layout'
    const request = resolveRenderRequest(
      text,
      options.renderOptions ?? {},
      output,
      output === 'layout' ? projectionOptions : undefined,
    )
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
export function layoutFamilyToRendered(
  d: ParsedDiagram,
  options: PositionFamilyArtifactOptions = {},
): RenderedLayout | null {
  const descriptor = getFamily(d.kind)
  if (!descriptor?.layout || !descriptor.projectPositioned) return null
  // Before descriptor convergence, source-preserved state diagrams had no
  // RenderedLayout adapter. Keep that observable 0x0 fallback stable; typed
  // state bodies still use the descriptor-owned positioned graph below.
  if (d.kind === 'state' && d.body.kind === 'opaque') return emptyRenderedLayout(d.kind)
  return positionFamilyArtifact(d, options)?.rendered ?? null
}

/** Facade for adapters that already own a canonical request receipt. */
export function layoutResolvedFamilyToRendered(
  d: ParsedDiagram,
  request: ResolvedRenderRequest,
  options: FamilyPositionedProjectionOptions = {},
): RenderedLayout | null {
  if (d.kind === 'state' && d.body.kind === 'opaque') return emptyRenderedLayout(d.kind)
  return positionResolvedFamilyArtifact(d, request, options)?.rendered ?? null
}

/** Flowchart and state share the canonical ELK positioned-graph view. */
export function projectGraphPositioned(
  { positioned, options }: FamilyPositionedProjectionContext<PositionedGraph>,
): FamilyPositionedView {
  return positionedGraphToRenderedView(positioned, options)
}

// ---- mindmap / gitgraph ---------------------------------------------------

export function projectMindmapPositioned(
  { positioned }: FamilyPositionedProjectionContext<PositionedMindmapDiagram>,
): FamilyPositionedView {
  const nodes: RenderedLayoutNode[] = positioned.nodes.map(node => ({
    id: node.id, x: f(node.x), y: f(node.y),
    w: f(node.width), h: f(node.height), shape: node.shape === 'circle' ? 'ellipse' : 'rectangle', label: node.label,
  }))
  const edges: RenderedLayoutEdge[] = positioned.edges.map((edge, index) => ({
    id: `edge#${index}:${edge.from}->${edge.to}`, from: edge.from, to: edge.to,
    path: edge.points.map(point => [f(point.x), f(point.y)] as [Finite, Finite]),
  }))
  return { version: 1, nodes, edges, groups: [], bounds: { w: f(positioned.width), h: f(positioned.height) } }
}

export function projectGitGraphPositioned(
  { positioned }: FamilyPositionedProjectionContext<PositionedGitGraphDiagram>,
): FamilyPositionedView {
  const nodes: RenderedLayoutNode[] = positioned.commits.map(commit => {
    const type = commit.customType ?? commit.type
    return {
      id: commit.id, x: f(commit.x - 10), y: f(commit.y - 10), w: f(20), h: f(20),
      shape: type === 'CHERRY_PICK' ? 'diamond' : type === 'HIGHLIGHT' ? 'rectangle' : 'ellipse',
      label: commit.message || commit.id,
    }
  })
  const edges: RenderedLayoutEdge[] = positioned.edges.map((edge, index) => ({
    id: `edge#${index}:${edge.from}->${edge.to}`, from: edge.from, to: edge.to,
    path: edge.points.map(point => [f(point.x), f(point.y)] as [Finite, Finite]),
  }))
  const groups: RenderedLayoutGroup[] = positioned.showBranches ? positioned.branches.map(branch => {
    const commits = positioned.commits.filter(commit => commit.branch === branch.name)
    const minX = Math.min(branch.x1, branch.x2, ...commits.map(commit => commit.x - 10))
    const minY = Math.min(branch.y1, branch.y2, ...commits.map(commit => commit.y - 10))
    const maxX = Math.max(branch.x1, branch.x2, ...commits.map(commit => commit.x + 10))
    const maxY = Math.max(branch.y1, branch.y2, ...commits.map(commit => commit.y + 10))
    return {
      id: `branch:${branch.name}`,
      x: f(minX), y: f(minY), w: f(Math.max(1, maxX - minX)), h: f(Math.max(1, maxY - minY)),
      members: commits.map(commit => commit.id), label: branch.name,
    }
  }) : []
  return { version: 1, nodes, edges, groups, bounds: { w: f(positioned.width), h: f(positioned.height) } }
}

// ---- class ----------------------------------------------------------------

export function projectClassPositioned(
  { positioned, options }: FamilyPositionedProjectionContext<PositionedClassDiagram>,
): FamilyPositionedView {
  const nodes: RenderedLayoutNode[] = positioned.classes.map(c => ({
    id: c.id, x: f(c.x), y: f(c.y), w: fSpan(c.x, c.width), h: fSpan(c.y, c.height), shape: 'rectangle', label: c.label,
  }))
  const boxById = new Map(positioned.classes.map(c => [c.id, { x: c.x, y: c.y, width: c.width, height: c.height }]))
  const edges: RenderedLayoutEdge[] = positioned.relationships.map((r, i) => ({
    id: `rel#${i}:${r.from}->${r.to}`, from: r.from, to: r.to,
    path: r.points.map(p => [f(p.x), f(p.y)] as [Finite, Finite]),
    label: r.label && r.labelPosition ? { x: f(r.labelPosition.x), y: f(r.labelPosition.y), text: r.label } : undefined,
    route: options.debug ? boxRouteCertificate('class', i, r.points, boxById.get(r.from), boxById.get(r.to)) : undefined,
  }))
  // Namespaces are groups whose members are their directly-declared classes
  // (the family rubric's group-containment axis judges them).
  const groups: RenderedLayoutGroup[] = positioned.namespaces.map(ns => ({
    id: ns.id, x: f(ns.x), y: f(ns.y), w: fSpan(ns.x, ns.width), h: fSpan(ns.y, ns.height),
    members: [...ns.classIds], label: ns.label, parentId: ns.parentId,
  }))
  return { version: 1, nodes, edges, groups, bounds: { w: f(positioned.width), h: f(positioned.height) } }
}

// ---- er -------------------------------------------------------------------

export function projectErPositioned(
  { positioned, options }: FamilyPositionedProjectionContext<PositionedErDiagram>,
): FamilyPositionedView {
  const nodes: RenderedLayoutNode[] = positioned.entities.map(e => ({
    id: e.id, x: f(e.x), y: f(e.y), w: fSpan(e.x, e.width), h: fSpan(e.y, e.height), shape: 'rectangle', label: e.label,
  }))
  const boxById = new Map(positioned.entities.map(e => [e.id, { x: e.x, y: e.y, width: e.width, height: e.height }]))
  const labelPositions = separateRelationshipLabels(positioned, resolveRenderStyle({}, ER_STYLE_DEFAULTS))
  const edges: RenderedLayoutEdge[] = positioned.relationships.map((r, i) => {
    const at = labelPositions.get(r)
    return {
      id: `rel#${i}:${r.entity1}->${r.entity2}`, from: r.entity1, to: r.entity2,
      path: r.points.map(p => [f(p.x), f(p.y)] as [Finite, Finite]),
      label: r.label && at ? { x: f(at.x), y: f(at.y), text: r.label } : undefined,
      route: options.debug ? boxRouteCertificate('er', i, r.points, boxById.get(r.entity1), boxById.get(r.entity2)) : undefined,
    }
  })
  const groups: RenderedLayoutGroup[] = positioned.groups.map(group => ({
    id: group.id, x: f(group.x), y: f(group.y), w: fSpan(group.x, group.width), h: fSpan(group.y, group.height),
    members: [
      ...positioned.entities.filter(entity => entity.groupId === group.id).map(entity => entity.id),
      ...positioned.groups.filter(child => child.parentId === group.id).map(child => child.id),
    ],
    label: group.label, parentId: group.parentId,
  }))
  return { version: 1, nodes, edges, groups, bounds: { w: f(positioned.width), h: f(positioned.height) } }
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
  layout: FamilyPositionedView,
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

function nodeWithinBounds(n: RenderedLayoutNode, bounds: FamilyPositionedView['bounds'], tol = 0.5): boolean {
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

export function projectSequencePositioned(
  { positioned, options }: FamilyPositionedProjectionContext<PositionedSequenceDiagram>,
): FamilyPositionedView {
  const lifelineByActor = new Map(positioned.lifelines.map(l => [l.actorId, l.x]))
  const nodes: RenderedLayoutNode[] = [
    ...positioned.actors.map(a => ({
      id: a.id, x: f(a.x - a.width / 2), y: f(a.y), w: f(a.width), h: f(a.height),
      shape: 'rectangle', label: a.label, role: 'box' as const,
    })),
    ...positioned.notes.map((n, i) => ({
      id: `note#${i}`, x: f(n.x), y: f(n.y), w: f(n.width), h: f(n.height),
      shape: 'note', label: n.text, role: 'box' as const,
    })),
  ]
  return {
    version: 1,
    nodes,
    edges: positioned.messages.map((m, i) => {
      const path = sequenceMessagePath(m)
      return {
        id: `msg#${i}:${m.from}->${m.to}`, from: m.from, to: m.to,
        path: path.map(p => [f(p.x), f(p.y)] as [Finite, Finite]),
        label: m.label ? sequenceMessageLabel(m) : undefined,
        route: options.debug ? sequenceRouteCertificate(i, m, path, lifelineByActor) : undefined,
      }
    }),
    groups: positioned.blocks.map((b, i) => ({
      id: `block#${i}:${b.type}`, x: f(b.x), y: f(b.y), w: f(b.width), h: f(b.height), members: [], label: b.label,
    })),
    bounds: { w: f(positioned.width), h: f(positioned.height) },
  }
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

export function projectTimelinePositioned(
  { positioned, options }: FamilyPositionedProjectionContext<PositionedTimelineDiagram>,
): FamilyPositionedView {
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
  const layout: FamilyPositionedView = { version: 1, nodes, edges: [], groups, bounds: { w: f(positioned.width), h: f(positioned.height) } }
  if (options.debug) layout.certificates = elementCertificates('timeline', layout, 'timeline-interval')
  return layout
}

// ---- journey --------------------------------------------------------------

export function projectJourneyPositioned(
  { positioned }: FamilyPositionedProjectionContext<PositionedJourneyDiagram>,
): FamilyPositionedView {
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
  return { version: 1, nodes, edges: [], groups, bounds: { w: f(positioned.width), h: f(positioned.height) } }
}

// ---- architecture ---------------------------------------------------------

export function projectArchitecturePositioned(
  { positioned, options }: FamilyPositionedProjectionContext<PositionedArchitectureDiagram>,
): FamilyPositionedView {
  const nodes: RenderedLayoutNode[] = [
    ...positioned.services.map(s => ({
      id: s.id, x: f(s.x), y: f(s.y), w: f(s.width), h: f(s.height), shape: 'service', label: s.label, role: 'box' as const,
    })),
    ...positioned.junctions.map(j => ({
      id: j.id, x: f(j.x), y: f(j.y), w: f(j.width), h: f(j.height), shape: 'circle' as const, label: undefined, role: 'mark' as const,
    })),
  ]
  const flatGroups = new Map<string, PositionedArchitectureGroup>()
  const groups: RenderedLayoutGroup[] = []
  const flatten = (g: PositionedArchitectureGroup): void => {
    flatGroups.set(g.id, g)
    groups.push({
      id: g.id, x: f(g.x), y: f(g.y), w: f(g.width), h: f(g.height),
      members: [
        ...positioned.services.filter(service => service.parentId === g.id).map(service => service.id),
        ...positioned.junctions.filter(junction => junction.parentId === g.id).map(junction => junction.id),
      ],
      label: g.label, parentId: g.parentId,
    })
    for (const c of g.children) flatten(c)
  }
  for (const g of positioned.groups) flatten(g)
  const serviceById = new Map(positioned.services.map(s => [s.id, s]))
  const junctionById = new Map(positioned.junctions.map(j => [j.id, j]))
  const edges: RenderedLayoutEdge[] = positioned.edges.map((e, i) => ({
    id: `edge#${i}:${e.source.id}->${e.target.id}`, from: e.source.id, to: e.target.id,
    path: e.points.map(p => [f(p.x), f(p.y)] as [Finite, Finite]),
    label: e.label && e.labelPosition ? { x: f(e.labelPosition.x), y: f(e.labelPosition.y), text: e.label } : undefined,
    route: options.debug ? architectureRouteCertificate(i, e, serviceById, junctionById, flatGroups) : undefined,
  }))
  return { version: 1, nodes, edges, groups, bounds: { w: f(positioned.width), h: f(positioned.height) } }
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
    invariant: sourceAnchored && targetAnchored && orthogonal && edge.obstacleFree ? 'side-anchored' : 'unverified-family-route',
    bendCount: bendCount(edge.points),
    orthogonal,
    sourceSide: edge.source.side,
    targetSide: edge.target.side,
    sourceBoundary: edge.source.boundary,
    targetBoundary: edge.target.boundary,
    sourceAnchored,
    targetAnchored,
    placement: edge.placement,
    sourceFacesTarget: edge.sourceFacesTarget,
    targetFacesSource: edge.targetFacesSource,
    obstacleFree: edge.obstacleFree,
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

export function projectXyChartPositioned(
  { positioned, options }: FamilyPositionedProjectionContext<PositionedXYChart>,
): FamilyPositionedView {
  const nodes: RenderedLayoutNode[] = []
  // Bars are the primary boxes.
  positioned.bars.forEach((b, i) => {
    nodes.push({ id: `bar#${i}`, x: f(b.x), y: f(b.y), w: f(b.width), h: f(b.height), shape: 'rectangle', label: b.label, role: 'labelled-mark' })
  })
  // Line series points become small marker boxes so line-only charts are
  // still measured (whitespace/legibility care about node area).
  positioned.lines.forEach((ln, li) => {
    ln.points.forEach((p, pi) => {
      nodes.push({ id: `line#${li}:pt#${pi}`, x: f(p.x - 3), y: f(p.y - 3), w: f(6), h: f(6), shape: 'circle', label: p.label, role: p.label ? 'labelled-mark' : 'mark' })
    })
  })
  // Plot area is the single group (the chart's content frame).
  const groups: RenderedLayoutGroup[] = [{
    id: 'plot', x: f(positioned.plotArea.x), y: f(positioned.plotArea.y),
    w: f(positioned.plotArea.width), h: f(positioned.plotArea.height), members: nodes
      .filter(node => node.x + node.w / 2 >= positioned.plotArea.x && node.x + node.w / 2 <= positioned.plotArea.x + positioned.plotArea.width &&
        node.y + node.h / 2 >= positioned.plotArea.y && node.y + node.h / 2 <= positioned.plotArea.y + positioned.plotArea.height)
      .map(node => node.id),
  }]
  const layout: FamilyPositionedView = { version: 1, nodes, edges: [], groups, bounds: { w: f(positioned.width), h: f(positioned.height) } }
  if (options.debug) layout.certificates = elementCertificates('xychart', layout, 'plot-contained', groups[0], 'center')
  return layout
}

// ---- pie ------------------------------------------------------------------

export function projectPiePositioned(
  { positioned, options }: FamilyPositionedProjectionContext<PositionedPieChart>,
): FamilyPositionedView {
  // Pie has no structural nodes/edges — the slices are angular wedges. Use
  // each slice's legend row as a label-anchored box (legend swatch top-left,
  // approximate width from label length at the legend font baseline). This
  // gives the metrics a positive node area + legible labels to measure.
  const CHAR_PX = 7
  const nodes: RenderedLayoutNode[] = positioned.legend.map((l, i) => {
    const labelText = `${l.label} (${formatPiePercent(l.fraction)})`
    const w = Math.max(l.swatchSize, labelText.length * CHAR_PX + l.swatchSize)
    return { id: `slice#${i}:${l.label}`, x: f(l.x), y: f(l.y), w: f(w), h: f(l.swatchSize), shape: 'rectangle', label: labelText }
  })
  const layout: FamilyPositionedView = { version: 1, nodes, edges: [], groups: [], bounds: { w: f(positioned.width), h: f(positioned.height) } }
  if (options.debug) layout.certificates = elementCertificates('pie', layout, 'legend-contained')
  return layout
}

// ---- gantt ------------------------------------------------------------------

export function projectGanttPositioned(
  { positioned, options }: FamilyPositionedProjectionContext<GanttLayoutResult>,
): FamilyPositionedView {
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
  const layout: FamilyPositionedView = { version: 1, nodes, edges: [], groups, bounds: { w: f(positioned.width), h: f(positioned.height) } }
  if (options.debug) layout.certificates = elementCertificates('gantt', layout, 'section-contained')
  return layout
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
  opts: { edgeAnchors?: boolean; nodeOverlaps?: boolean; groupContainment?: boolean | 'center' } = {},
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
        const inside = opts.groupContainment === 'center'
          ? n.x + n.w / 2 >= g.x - TOL && n.y + n.h / 2 >= g.y - TOL &&
            n.x + n.w / 2 <= g.x + g.w + TOL && n.y + n.h / 2 <= g.y + g.h + TOL
          : n.x >= g.x - TOL && n.y >= g.y - TOL &&
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

export function projectQuadrantPositioned(
  { positioned, options }: FamilyPositionedProjectionContext<PositionedQuadrantChart>,
): FamilyPositionedView {
  const nodes: RenderedLayoutNode[] = positioned.points.map((p, i) => ({
    id: `point#${i}:${p.label}`, x: f(p.cx - p.radius), y: f(p.cy - p.radius),
    w: f(p.radius * 2), h: f(p.radius * 2), shape: 'circle', label: p.label, role: 'labelled-mark' as const,
  }))
  const groups: RenderedLayoutGroup[] = positioned.regions.map(r => ({
    id: `quadrant#${r.number}`, x: f(r.x), y: f(r.y), w: f(r.width), h: f(r.height),
    members: positioned.points.map((point, index) => ({ point, index })).filter(({ point }) =>
      r.number === (point.nx >= 0.5 ? (point.ny >= 0.5 ? 1 : 4) : (point.ny >= 0.5 ? 2 : 3)))
      .map(({ point, index }) => `point#${index}:${point.label}`),
    label: r.label,
  }))
  const layout: FamilyPositionedView = { version: 1, nodes, edges: [], groups, bounds: { w: f(positioned.width), h: f(positioned.height) } }
  if (options.debug) layout.certificates = elementCertificates('quadrant', layout, 'plot-contained')
  return layout
}
