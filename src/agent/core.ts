// ============================================================================
// agentic-mermaid — runtime-neutral agent surface (v4).
// Everything here is pure JS/TS (elkjs bundled build included) and safe to
// bundle for workerd/browser targets. The public barrel (`./index.ts`)
// re-exports this plus the Node-native `renderMermaidPNG`; import this module
// from code that must not drag in the napi resvg addon.
// No LayoutContext / SeededRNG / Clock / font-metrics: that apparatus did
// nothing (ELK is deterministic on its own). See AGENT_NATIVE.md § (1).
// ============================================================================

export type {
  Result, ValidDiagram, FlowchartValidDiagram, StateValidDiagram, SequenceValidDiagram, TimelineValidDiagram,
  ClassValidDiagram, ErValidDiagram, JourneyValidDiagram, ArchitectureValidDiagram, XyChartValidDiagram, PieValidDiagram, QuadrantValidDiagram, GanttValidDiagram, MutableValidDiagram,
  ValidDiagramMeta, ValidDiagramPayload, SerializedFlowchartGraph, DiagramBody, DiagramKind,
  StateBody, StateNode, StateTransition,
  SequenceBody, SequenceParticipant, SequenceMessage, SequenceMessageStyle,
  TimelineBody, TimelineSection, TimelinePeriod, TimelineEvent,
  ClassBody, ClassNode, ClassRelation, ClassRelationKind, ClassNote,
  ErBody, ErEntity, ErRelation, ErAttribute, ErCardinality,
  JourneyBody, JourneySection, JourneyTask,
  ArchitectureBody, ArchitectureGroup, ArchitectureService, ArchitectureJunction, ArchitectureEdge, ArchitectureEndpoint, ArchitectureSide,
  XyChartBody, XyChartAxis, XyChartSeries, XyChartAxisSpec,
  PieBody, PieSlice, QuadrantBody, QuadrantAxis, QuadrantPoint,
  GanttBody, GanttBodySection, GanttBodyTask, GanttBodyTaskTag, GanttStatement,
  SourceMap, SourceComment, InitDirective, Accessibility,
  ParseError, MutationError, MutationOp, FlowchartMutationOp, StateMutationOp, SequenceMutationOp, TimelineMutationOp,
  ClassMutationOp, ErMutationOp, JourneyMutationOp, ArchitectureMutationOp, XyChartMutationOp, PieMutationOp, QuadrantMutationOp, GanttMutationOp, AnyMutationOp,
  NodeId, EdgeId, GroupId, ParticipantId,
  LayoutWarning, WarningCode, Tier1WarningCode, Tier2WarningCode, WarningSeverity, WarningTier,
  VerifyOptions, VerifyResult, RenderedLayout, RenderedLayoutNode, RenderedLayoutEdge, RenderedLayoutGroup, RenderedRegion, RenderedRegionKind,
  DiagramAnalysis, DiagramActionRecord, DiagramActionKind, DiagramActionSecurity, FeedbackEdgeAnalysis, GanttScheduleAnalysisSummary,
  Finite,
} from './types.ts'

export { WARNING_SEVERITY, WARNING_TIER, DEFAULT_LABEL_CHAR_CAP, ok, err, toFinite, asFlowchart, asState, asSequence, asTimeline, asClass, asEr, asJourney, asArchitecture, asXyChart, asPie, asQuadrant, asGantt } from './types.ts'
export { parseMermaid } from './parse.ts'
export { serializeMermaid, synthesizeFromGraph } from './serialize.ts'
export { mutate, edgeIdOf } from './mutate.ts'
export { verifyMermaid } from './verify.ts'
export { measureQuality, checkQuality, DEFAULT_BOUNDS, BOUND_PROVENANCE } from './quality.ts'
export type { QualityMetrics, QualityBounds, QualityVerdict, RankedViolation, BoundProvenance, BoundBasis, ViolationSeverity } from './quality.ts'
export { layoutCertificateProof } from './certificates.ts'
export type { LayoutCertificateProof } from './certificates.ts'
export type { RouteCertificate, EdgeRouteCertificate, FamilyEdgeRouteCertificate, RegionContainmentCertificate, FamilyRouteCertificate, LayoutRouteCertificate, LayoutRouteClass, RouteClass, RouteBlocker, RoutePortAssignment, PortSemanticRole, AnyPort, PortSide, DiamondFacet } from '../types.ts'
export { registerFamily, getFamily, knownFamilies, BUILTIN_FAMILY_METADATA, BUILTIN_FAMILY_METADATA_COVERS_DIAGRAM_KIND, builtinFamilyMetadata } from './families.ts'
export type { FamilyPlugin, ExtractedLabel, BuiltinFamilyMetadata, BuiltinFamilyId } from './families.ts'
export { renderMermaidASCIIWithMeta, ASCII_ROUTE_PARITY_CONTRACT } from '../ascii/meta.ts'
export type { AsciiRegion, AsciiWithMeta, RegionKind, AsciiWarning, AsciiWarningCode } from '../ascii/meta.ts'
export { describeMermaid, describeMermaidSource, describeMermaidTree } from './describe.ts'
export { analyzeMermaid, analyzeMermaidSource, collectActionRecords } from './analyze.ts'
export { TEXT_MEASUREMENT_CONTRACT, measureText, measureTextWidth } from '../text-metrics.ts'
export type { TextMeasurementContract, TextMeasurementInput, TextMeasurementResult } from '../text-metrics.ts'
export type { DescribeTree } from './describe.ts'
export type { DescribeOptions } from './describe.ts'
export { asciiToMermaid } from '../ascii/reverse.ts'

import { renderMermaidSVG as _svg } from '../index.ts'
export { verifyNoExternalRefs } from '../index.ts'
import { renderMermaidASCII as _ascii } from '../ascii/index.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { parseMermaid as parseFlowchartLegacy } from '../parser.ts'
import { stateBodyToGraph } from './state-body.ts'
import { serializeMermaid as _serialize } from './serialize.ts'
import type { ValidDiagram, RenderedLayout, RenderedRegion } from './types.ts'
import { positionedToRenderedLayout, emptyRenderedLayout } from './layout-to-rendered.ts'
import { layoutFamilyToRendered } from './family-layouts.ts'
import { collectActionRecords as collectRenderedActionRecords } from './analyze.ts'
import { toFinite } from './types.ts'

export function renderMermaidSVG(input: ValidDiagram | string, opts: Parameters<typeof _svg>[1] = {}): string {
  return _svg(typeof input === 'string' ? input : _serialize(input), opts)
}
export function renderMermaidASCII(input: ValidDiagram | string, opts: Parameters<typeof _ascii>[1] = {}): string {
  return _ascii(typeof input === 'string' ? input : _serialize(input), opts)
}

export interface LayoutMermaidOptions { debug?: boolean; regions?: boolean; actions?: boolean }

export function layoutMermaid(d: ValidDiagram, opts: LayoutMermaidOptions = {}): RenderedLayout {
  if (d.body.kind === 'flowchart') {
    return enrichRenderedLayout(d, positionedToRenderedLayout(layoutGraphSync(d.body.graph, {}), d.kind, opts), opts)
  }
  // State diagrams (BUILD-19) project to a MermaidGraph via the legacy parser,
  // so layout reuses the flowchart geometric path.
  if (d.body.kind === 'state') {
    return enrichRenderedLayout(d, positionedToRenderedLayout(layoutGraphSync(stateBodyToGraph(d.body), {}), d.kind, opts), opts)
  }
  if (d.body.kind === 'opaque' && d.kind === 'flowchart') {
    try {
      return enrichRenderedLayout(d, positionedToRenderedLayout(layoutGraphSync(parseFlowchartLegacy(d.canonicalSource), {}), d.kind, opts), opts)
    } catch {
      return emptyRenderedLayout(d.kind)
    }
  }
  // QUAL-1: renderable non-graph families project their real positioned
  // layout (parsed from d.canonicalSource — works for both structured and
  // opaque bodies) so the perceptual-quality metrics see them. Debug mode
  // includes family-specific route/layout certificates where available.
  const familyLayout = layoutFamilyToRendered(d, opts)
  if (familyLayout) return enrichRenderedLayout(d, familyLayout, opts)
  return enrichRenderedLayout(d, emptyRenderedLayout(d.kind), opts)
}

function enrichRenderedLayout(d: ValidDiagram, layout: RenderedLayout, opts: LayoutMermaidOptions): RenderedLayout {
  const wantRegions = opts.debug || opts.regions
  const wantActions = opts.debug || opts.actions
  if (!wantRegions && !wantActions) return layout
  const next: RenderedLayout = { ...layout }
  if (wantRegions) next.regions = buildRenderedRegions(d, layout)
  if (wantActions) {
    const nodeIds = new Set<string>(layout.nodes.map(n => n.id))
    next.actions = collectRenderedActionRecords(d)
      .filter(a => nodeIds.has(a.target))
      .map(a => ({ ...a, regionId: a.regionId ?? `node:${a.target}` }))
  }
  return next
}

function buildRenderedRegions(d: ValidDiagram, layout: RenderedLayout): RenderedRegion[] {
  const regions: RenderedRegion[] = [{
    id: 'canvas',
    kind: 'canvas',
    bounds: { x: toFinite(0), y: toFinite(0), w: layout.bounds.w, h: layout.bounds.h },
  }]
  const groupByMember = new Map<string, string>()
  for (const group of layout.groups) for (const member of group.members) groupByMember.set(member, group.id)
  const sourceLines = sourceLineHints(d)
  for (const group of layout.groups) {
    regions.push({
      id: `group:${group.id}`,
      kind: 'group',
      elementId: group.id,
      parentId: group.parentId ? `group:${group.parentId}` : 'canvas',
      bounds: { x: group.x, y: group.y, w: group.w, h: group.h },
      sourceLine: d.source.groups.get(group.id)?.line ?? sourceLines.groups.get(group.id),
    })
  }
  for (const node of layout.nodes) {
    regions.push({
      id: `node:${node.id}`,
      kind: 'node',
      elementId: node.id,
      parentId: groupByMember.has(node.id) ? `group:${groupByMember.get(node.id)!}` : 'canvas',
      bounds: { x: node.x, y: node.y, w: node.w, h: node.h },
      sourceLine: d.source.nodes.get(node.id)?.line ?? sourceLines.nodes.get(node.id),
    })
  }
  for (const edge of layout.edges) {
    const xs = edge.path.map(p => p[0])
    const ys = edge.path.map(p => p[1])
    if (xs.length > 0 && ys.length > 0) {
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
      regions.push({
        id: `edge:${edge.id}`,
        kind: 'edge',
        elementId: edge.id,
        parentId: 'canvas',
        bounds: { x: toFinite(minX), y: toFinite(minY), w: toFinite(Math.max(1, maxX - minX)), h: toFinite(Math.max(1, maxY - minY)) },
      })
    }
    if (edge.label) {
      const w = Math.max(1, edge.label.text.length * 7)
      const h = 14
      const labelX = d.kind === 'sequence' && edge.from === edge.to
        ? edge.label.x // sequence self-message labels render with text-anchor="start"
        : edge.label.x - w / 2
      regions.push({
        id: `label:${edge.id}`,
        kind: 'label',
        elementId: edge.id,
        parentId: `edge:${edge.id}`,
        bounds: { x: toFinite(labelX), y: toFinite(edge.label.y - h / 2), w: toFinite(w), h: toFinite(h) },
      })
    }
  }
  return regions
}

function sourceLineHints(d: ValidDiagram): { nodes: Map<string, number>; groups: Map<string, number> } {
  const nodes = new Map<string, number>()
  const groups = new Map<string, number>()
  const source = d.body.kind === 'opaque' ? d.body.source : d.canonicalSource
  const lines = source.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]!
    const group = text.match(/^\s*subgraph\s+([A-Za-z0-9_:-]+)/)
    if (group?.[1] && !groups.has(group[1])) groups.set(group[1], i + 1)
    for (const node of text.matchAll(/(?:^|[\s&;])([A-Za-z][A-Za-z0-9_:-]*)(?=\s*(?:\[|\(|\{|--|==|-.|$))/g)) {
      const id = node[1]!
      if (id === 'subgraph' || id === 'end' || id === d.kind) continue
      if (!nodes.has(id)) nodes.set(id, i + 1)
    }
  }
  return { nodes, groups }
}
