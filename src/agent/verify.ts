// ============================================================================
// verifyMermaid: structural "did this render cleanly?" check
//
// Runs layout, inspects the bounds the layout pass already computes, and
// emits structured LayoutWarning codes. No vision required.
//
// The data already exists — the layout pass computes bounds and discards them.
// This module is plumbing, not new analysis.
// ============================================================================

import { parseMermaid as parseValidDiagram } from './parse.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { defaultLayoutContext, measureWidth } from './context.ts'
import type {
  ValidDiagram,
  VerifyOptions,
  VerifyResult,
  LayoutWarning,
  RenderedLayout,
  RenderedLayoutNode,
  RenderedLayoutEdge,
  WarningCode,
} from './types.ts'
import { WARNING_SEVERITY } from './types.ts'
import type { PositionedGraph, PositionedNode, PositionedEdge } from '../types.ts'

export function verifyMermaid(
  input: ValidDiagram | string,
  opts: VerifyOptions = {},
): VerifyResult {
  const d = typeof input === 'string' ? unwrapForVerify(input) : input
  if (!d) {
    const layout = emptyLayout('flowchart')
    return {
      ok: false,
      warnings: [{ code: 'EMPTY_DIAGRAM' }],
      layout,
    }
  }

  // Opaque families: we don't have a positioned graph; report only structural
  // things we can know from source (empty body).
  if (d.body.kind === 'opaque') {
    const isEmpty = d.body.source.trim().split('\n').length <= 1
    const layout = emptyLayout(d.kind)
    const warnings: LayoutWarning[] = isEmpty ? [{ code: 'EMPTY_DIAGRAM' }] : []
    return finalize(warnings, layout, opts)
  }

  const graph = d.body.graph

  if (graph.nodes.size === 0) {
    const layout = emptyLayout(d.kind)
    return finalize([{ code: 'EMPTY_DIAGRAM' }], layout, opts)
  }

  // Run layout. We use the existing engine; deterministic context affects
  // font measurement via the spec below.
  const positioned = layoutGraphSync(graph, {})
  const layout = positionedToRenderedLayout(positioned, d.kind)

  const warnings: LayoutWarning[] = []

  // EDGE_MISANCHORED: edge endpoints reference nodes not in the node map.
  for (const edge of graph.edges) {
    if (!graph.nodes.has(edge.source) || !graph.nodes.has(edge.target)) {
      warnings.push({
        code: 'EDGE_MISANCHORED',
        edge: `${edge.source}->${edge.target}`,
        from: graph.nodes.has(edge.source) ? edge.source : undefined,
        to: graph.nodes.has(edge.target) ? edge.target : undefined,
      })
    }
  }

  // UNKNOWN_SHAPE: any node whose shape isn't one of the known set.
  const KNOWN_SHAPES = new Set([
    'rectangle',
    'service',
    'rounded',
    'diamond',
    'stadium',
    'circle',
    'subroutine',
    'doublecircle',
    'hexagon',
    'cylinder',
    'asymmetric',
    'trapezoid',
    'trapezoid-alt',
    'state-start',
    'state-end',
  ])
  for (const [id, node] of graph.nodes) {
    if (!KNOWN_SHAPES.has(node.shape)) {
      warnings.push({ code: 'UNKNOWN_SHAPE', node: id, shape: String(node.shape) })
    }
  }

  const ctx = opts.layoutContext ?? defaultLayoutContext()

  // LABEL_OVERFLOW: best-effort using the frozen metrics table. We compare
  // the measured text width to the node's inner width minus a small padding.
  for (const n of positioned.nodes) {
    const label = n.label ?? ''
    if (!label) continue
    const measured = measureWidth(ctx.fontMetrics, label)
    // Inner width assumes ~24px horizontal padding total.
    const inner = Math.max(0, n.width - 24)
    if (measured > inner + 1) {
      warnings.push({
        code: 'LABEL_OVERFLOW',
        target: n.id,
        overflowPx: Math.ceil(measured - inner),
      })
    }
  }

  // OFF_CANVAS: any node whose bounding box exits the canvas.
  for (const n of positioned.nodes) {
    if (n.x < 0 || n.y < 0) {
      warnings.push({ code: 'OFF_CANVAS', target: n.id, axis: n.x < 0 ? 'x' : 'y' })
    } else if (n.x + n.width > positioned.width + 1) {
      warnings.push({ code: 'OFF_CANVAS', target: n.id, axis: 'x' })
    } else if (n.y + n.height > positioned.height + 1) {
      warnings.push({ code: 'OFF_CANVAS', target: n.id, axis: 'y' })
    }
  }

  // NODE_OVERLAP: pairwise bounding-box intersection. O(n²) — fine at our scale.
  for (let i = 0; i < positioned.nodes.length; i++) {
    for (let j = i + 1; j < positioned.nodes.length; j++) {
      const a = positioned.nodes[i]!
      const b = positioned.nodes[j]!
      const overlap = rectIntersection(a, b)
      if (overlap > 0) {
        warnings.push({
          code: 'NODE_OVERLAP',
          a: a.id,
          b: b.id,
          areaPx: Math.round(overlap),
        })
      }
    }
  }

  // ROUTE_SELF_CROSS: count self-intersections of an edge path.
  for (const e of positioned.edges) {
    const count = countSelfCrossings(e.points)
    if (count > 0) {
      warnings.push({
        code: 'ROUTE_SELF_CROSS',
        edge: `${e.source}->${e.target}`,
        count,
      })
    }
  }

  // GROUP_BREACH: every group member must lie within its group's bounds.
  for (const g of positioned.groups) {
    const recurse = (group: typeof g) => {
      for (const n of positioned.nodes) {
        const inside =
          n.x >= group.x &&
          n.y >= group.y &&
          n.x + n.width <= group.x + group.width + 0.5 &&
          n.y + n.height <= group.y + group.height + 0.5
        const sg = findSubgraphById(graph.subgraphs, group.id)
        if (sg && sg.nodeIds.includes(n.id) && !inside) {
          warnings.push({ code: 'GROUP_BREACH', group: group.id, member: n.id })
        }
      }
      for (const child of group.children) recurse(child)
    }
    recurse(g)
  }

  return finalize(warnings, layout, opts)
}

// ---- Helpers -------------------------------------------------------------

function unwrapForVerify(source: string): ValidDiagram | null {
  const parsed = parseValidDiagram(source)
  if (!parsed.ok) return null
  return parsed.value
}

function finalize(
  warnings: LayoutWarning[],
  layout: RenderedLayout,
  opts: VerifyOptions,
): VerifyResult {
  const suppress = new Set<WarningCode>(opts.suppress ?? [])
  const kept = warnings.filter(w => !suppress.has(w.code))
  const hasError = kept.some(w => WARNING_SEVERITY[w.code] === 'error')
  return {
    ok: !hasError,
    warnings: kept,
    layout,
  }
}

function emptyLayout(kind: RenderedLayout['kind']): RenderedLayout {
  return {
    version: 1,
    seed: 0,
    kind,
    nodes: [],
    edges: [],
    groups: [],
    bounds: { w: 0, h: 0 },
  }
}

function positionedToRenderedLayout(
  p: PositionedGraph,
  kind: RenderedLayout['kind'],
): RenderedLayout {
  return {
    version: 1,
    seed: 0,
    kind,
    nodes: p.nodes.map(toRenderedNode),
    edges: p.edges.map(toRenderedEdge),
    groups: p.groups.map(g => ({
      id: g.id,
      x: round(g.x),
      y: round(g.y),
      w: round(g.width),
      h: round(g.height),
      members: [],
      label: g.label,
    })),
    bounds: { w: round(p.width), h: round(p.height) },
  }
}

function toRenderedNode(n: PositionedNode): RenderedLayoutNode {
  return {
    id: n.id,
    x: round(n.x),
    y: round(n.y),
    w: round(n.width),
    h: round(n.height),
    shape: n.shape,
    label: n.label,
  }
}

function toRenderedEdge(e: PositionedEdge): RenderedLayoutEdge {
  return {
    id: `${e.source}->${e.target}`,
    from: e.source,
    to: e.target,
    path: e.points.map(p => [round(p.x), round(p.y)] as [number, number]),
    label: e.label && e.labelPosition
      ? { x: round(e.labelPosition.x), y: round(e.labelPosition.y), text: e.label }
      : undefined,
  }
}

function round(n: number): number {
  // Quantize to integers for stable layout JSON equality. Sub-pixel
  // differences in ELK output are noise for the agent loop.
  return Math.round(n)
}

function rectIntersection(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): number {
  const xOverlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  const yOverlap = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  return xOverlap * yOverlap
}

function countSelfCrossings(points: { x: number; y: number }[]): number {
  if (points.length < 4) return 0
  let count = 0
  for (let i = 0; i < points.length - 1; i++) {
    for (let j = i + 2; j < points.length - 1; j++) {
      if (i === 0 && j === points.length - 2) continue
      if (segmentsIntersect(points[i]!, points[i + 1]!, points[j]!, points[j + 1]!)) {
        count++
      }
    }
  }
  return count
}

function segmentsIntersect(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  p4: { x: number; y: number },
): boolean {
  const d1 = cross(p4.x - p3.x, p4.y - p3.y, p1.x - p3.x, p1.y - p3.y)
  const d2 = cross(p4.x - p3.x, p4.y - p3.y, p2.x - p3.x, p2.y - p3.y)
  const d3 = cross(p2.x - p1.x, p2.y - p1.y, p3.x - p1.x, p3.y - p1.y)
  const d4 = cross(p2.x - p1.x, p2.y - p1.y, p4.x - p1.x, p4.y - p1.y)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true
  return false
}

function cross(x1: number, y1: number, x2: number, y2: number): number {
  return x1 * y2 - x2 * y1
}

interface SubgraphLike {
  id: string
  nodeIds: string[]
  children: SubgraphLike[]
}

function findSubgraphById(subgraphs: SubgraphLike[], id: string): SubgraphLike | null {
  for (const sg of subgraphs) {
    if (sg.id === id) return sg
    const child = findSubgraphById(sg.children, id)
    if (child) return child
  }
  return null
}
