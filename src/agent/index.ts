// ============================================================================
// agentic-mermaid — public agent surface (v4)
// No LayoutContext / SeededRNG / Clock / font-metrics: that apparatus did
// nothing (ELK is deterministic on its own). See AGENT_NATIVE.md § (1).
// ============================================================================

export type {
  Result, ValidDiagram, FlowchartValidDiagram, SequenceValidDiagram, TimelineValidDiagram,
  ClassValidDiagram, ErValidDiagram, JourneyValidDiagram, ArchitectureValidDiagram, MutableValidDiagram,
  ValidDiagramMeta, ValidDiagramPayload, SerializedFlowchartGraph, DiagramBody, DiagramKind,
  SequenceBody, SequenceParticipant, SequenceMessage, SequenceMessageStyle,
  TimelineBody, TimelineSection, TimelinePeriod, TimelineEvent,
  ClassBody, ClassNode, ClassRelation, ClassRelationKind, ClassNote,
  ErBody, ErEntity, ErRelation, ErAttribute, ErCardinality,
  JourneyBody, JourneySection, JourneyTask,
  ArchitectureBody, ArchitectureGroup, ArchitectureService, ArchitectureJunction, ArchitectureEdge, ArchitectureEndpoint, ArchitectureSide,
  SourceMap, SourceComment, InitDirective, Accessibility,
  ParseError, MutationError, MutationOp, FlowchartMutationOp, SequenceMutationOp, TimelineMutationOp,
  ClassMutationOp, ErMutationOp, JourneyMutationOp, ArchitectureMutationOp, AnyMutationOp,
  NodeId, EdgeId, GroupId, ParticipantId,
  LayoutWarning, WarningCode, Tier1WarningCode, Tier2WarningCode, WarningSeverity, WarningTier,
  VerifyOptions, VerifyResult, RenderedLayout, RenderedLayoutNode, RenderedLayoutEdge, RenderedLayoutGroup,
  Finite,
} from './types.ts'

export { WARNING_SEVERITY, WARNING_TIER, DEFAULT_LABEL_CHAR_CAP, ok, err, toFinite, asFlowchart, asSequence, asTimeline, asClass, asEr, asJourney, asArchitecture } from './types.ts'
export { parseMermaid } from './parse.ts'
export { serializeMermaid, synthesizeFromGraph } from './serialize.ts'
export { mutate, edgeIdOf } from './mutate.ts'
export { verifyMermaid } from './verify.ts'
export { measureQuality, checkQuality, DEFAULT_BOUNDS } from './quality.ts'
export type { QualityMetrics, QualityBounds, QualityVerdict } from './quality.ts'
export { registerFamily, getFamily, knownFamilies } from './families.ts'
export type { FamilyPlugin, ExtractedLabel } from './families.ts'
export { renderMermaidPNG } from './png.ts'
export type { PngOptions } from './png.ts'
export { renderMermaidASCIIWithMeta } from '../ascii/meta.ts'
export type { AsciiRegion, AsciiWithMeta, RegionKind } from '../ascii/meta.ts'
export { describeMermaid, describeMermaidSource, describeMermaidTree } from './describe.ts'
export type { DescribeTree } from './describe.ts'
export type { DescribeOptions } from './describe.ts'
export { asciiToMermaid } from '../ascii/reverse.ts'

import { renderMermaidSVG as _svg } from '../index.ts'
export { verifyNoExternalRefs } from '../index.ts'
import { renderMermaidASCII as _ascii } from '../ascii/index.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { serializeMermaid as _serialize } from './serialize.ts'
import type { ValidDiagram, RenderedLayout } from './types.ts'
import { positionedToRenderedLayout, emptyRenderedLayout } from './layout-to-rendered.ts'

export function renderMermaidSVG(input: ValidDiagram | string, opts: Parameters<typeof _svg>[1] = {}): string {
  return _svg(typeof input === 'string' ? input : _serialize(input), opts)
}
export function renderMermaidASCII(input: ValidDiagram | string, opts: Parameters<typeof _ascii>[1] = {}): string {
  return _ascii(typeof input === 'string' ? input : _serialize(input), opts)
}

export function layoutMermaid(d: ValidDiagram): RenderedLayout {
  if (d.body.kind === 'flowchart') {
    return positionedToRenderedLayout(layoutGraphSync(d.body.graph, {}), d.kind)
  }
  if (d.body.kind === 'sequence') return layoutSequenceToRendered(d as ValidDiagram & { body: SequenceBody })
  if (d.body.kind === 'timeline') return layoutTimelineToRendered(d as ValidDiagram & { body: TimelineBody })
  return emptyRenderedLayout(d.kind)
}

// ---- Sequence + Timeline → RenderedLayout adapters ------------------------
//
// Phase D — expose real geometric layouts for non-flowchart families so the
// perceptual-quality checks from Phase F apply uniformly. NODE_OVERLAP and
// ROUTE_SELF_CROSS (Tier 2) remain flowchart-specific by design — those
// concepts don't generalize. For sequence/timeline, geometric concerns are
// covered by the perceptual metrics (label legibility, whitespace balance,
// edge crossings) acting on the layouts these adapters produce.

import { layoutSequenceDiagram } from '../sequence/layout.ts'
import { layoutTimelineDiagram } from '../timeline/layout.ts'
import type { TimelineBody, SequenceBody, Finite } from './types.ts'
import { toFinite } from './types.ts'

function f(n: number): Finite { return toFinite(Math.round(n)) }

function layoutSequenceToRendered(d: ValidDiagram & { body: SequenceBody }): RenderedLayout {
  const positioned = layoutSequenceDiagram({
    actors: d.body.participants.map(p => ({ id: p.id, label: p.label, type: p.kind })),
    messages: d.body.messages.map(m => ({
      from: m.from, to: m.to, label: m.text,
      style: m.style === 'reply' ? 'reply' : m.style === 'sync' ? 'sync' : 'async',
    })),
    blocks: [], notes: [], activations: [],
  } as unknown as Parameters<typeof layoutSequenceDiagram>[0])
  return {
    version: 1, kind: d.kind,
    nodes: positioned.actors.map(a => ({
      id: a.id, x: f(a.x - a.width / 2), y: f(a.y), w: f(a.width), h: f(a.height),
      shape: 'rectangle', label: a.label,
    })),
    edges: positioned.messages.map((m, i) => ({
      id: `msg#${i}:${m.from}->${m.to}`, from: m.from, to: m.to,
      path: [[f(m.x1), f(m.y)], [f(m.x2), f(m.y)]] as [Finite, Finite][],
      label: m.label ? { x: f((m.x1 + m.x2) / 2), y: f(m.y), text: m.label } : undefined,
    })),
    groups: [],
    bounds: { w: f(positioned.width), h: f(positioned.height) },
  }
}

function layoutTimelineToRendered(d: ValidDiagram & { body: TimelineBody }): RenderedLayout {
  // The legacy timeline layout consumes a different parsed shape; rather than
  // shimming, build a synthetic positioned layout: one node per event,
  // arranged left-to-right by section then period, top-down by event index.
  const NODE_W = 120, NODE_H = 40, PAD = 16, ROW_H = NODE_H + PAD
  const nodes: RenderedLayout['nodes'] = []
  let col = 0
  for (const s of d.body.sections) {
    for (const p of s.periods) {
      let row = 0
      // period label node
      nodes.push({
        id: `${p.id}:label`, x: f(col * (NODE_W + PAD) + PAD), y: f(PAD),
        w: f(NODE_W), h: f(NODE_H), shape: 'rectangle', label: p.label,
      })
      row++
      for (const e of p.events) {
        nodes.push({
          id: e.id, x: f(col * (NODE_W + PAD) + PAD), y: f(PAD + row * ROW_H),
          w: f(NODE_W), h: f(NODE_H), shape: 'rectangle', label: e.text,
        })
        row++
      }
      col++
    }
  }
  const w = Math.max(NODE_W + PAD * 2, col * (NODE_W + PAD) + PAD)
  const h = nodes.reduce((m, n) => Math.max(m, n.y + n.h + PAD), PAD)
  return { version: 1, kind: d.kind, nodes, edges: [], groups: [], bounds: { w: f(w), h: f(h) } }
}
