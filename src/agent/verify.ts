// ============================================================================
// verifyMermaid: structural warnings (Tier 1) + metric warnings (Tier 2).
//
// Tier 1 — high confidence, derived from parsed structure or laid-out bounds.
// Tier 2 — best effort, heuristic-based; recall depends on font-metric
//          parity with ELK and intentional overlap conventions.
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
  Finite,
} from './types.ts'
import { WARNING_SEVERITY, toFinite } from './types.ts'
import type { PositionedGraph, PositionedNode, PositionedEdge } from '../types.ts'

const KNOWN_SHAPES = new Set([
  'rectangle', 'service', 'rounded', 'diamond', 'stadium', 'circle',
  'subroutine', 'doublecircle', 'hexagon', 'cylinder', 'asymmetric',
  'trapezoid', 'trapezoid-alt', 'state-start', 'state-end',
])

export function verifyMermaid(
  input: ValidDiagram | string,
  opts: VerifyOptions = {},
): VerifyResult {
  const d = typeof input === 'string' ? unwrapForVerify(input) : input
  if (!d) {
    return finalize([{ code: 'EMPTY_DIAGRAM' }], emptyLayout('flowchart'), opts)
  }

  if (d.body.kind === 'opaque') {
    const isEmpty = d.body.source.trim().split('\n').length <= 1
    const warnings: LayoutWarning[] = isEmpty ? [{ code: 'EMPTY_DIAGRAM' }] : []
    return finalize(warnings, emptyLayout(d.kind), opts)
  }

  const graph = d.body.graph
  if (graph.nodes.size === 0) {
    return finalize([{ code: 'EMPTY_DIAGRAM' }], emptyLayout(d.kind), opts)
  }

  const positioned = layoutGraphSync(graph, {})
  const layout = positionedToRenderedLayout(positioned, d.kind)
  const warnings: LayoutWarning[] = []

  // ---- Tier 1: structural ----------------------------------------------

  // EDGE_MISANCHORED
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

  // UNKNOWN_SHAPE
  for (const [id, node] of graph.nodes) {
    if (!KNOWN_SHAPES.has(node.shape)) {
      warnings.push({ code: 'UNKNOWN_SHAPE', node: id, shape: String(node.shape) })
    }
  }

  // OFF_CANVAS
  for (const n of positioned.nodes) {
    if (n.x < 0 || n.y < 0) {
      warnings.push({ code: 'OFF_CANVAS', target: n.id, axis: n.x < 0 ? 'x' : 'y' })
    } else if (n.x + n.width > positioned.width + 1) {
      warnings.push({ code: 'OFF_CANVAS', target: n.id, axis: 'x' })
    } else if (n.y + n.height > positioned.height + 1) {
      warnings.push({ code: 'OFF_CANVAS', target: n.id, axis: 'y' })
    }
  }

  // GROUP_BREACH
  for (const g of positioned.groups) {
    const visit = (group: typeof g) => {
      const sg = findSubgraphById(graph.subgraphs as SubgraphLike[], group.id)
      if (sg) {
        for (const n of positioned.nodes) {
          if (!sg.nodeIds.includes(n.id)) continue
          const inside =
            n.x >= group.x &&
            n.y >= group.y &&
            n.x + n.width <= group.x + group.width + 0.5 &&
            n.y + n.height <= group.y + group.height + 0.5
          if (!inside) {
            warnings.push({ code: 'GROUP_BREACH', group: group.id, member: n.id })
          }
        }
      }
      for (const child of group.children) visit(child)
    }
    visit(g)
  }

  // ---- Tier 2: metric (best-effort) ------------------------------------

  const ctx = opts.layoutContext ?? defaultLayoutContext()

  // LABEL_OVERFLOW (heuristic — ELK pads generously; recall is low)
  for (const n of positioned.nodes) {
    const label = n.label ?? ''
    if (!label) continue
    const measured = measureWidth(ctx.fontMetrics, label)
    const inner = Math.max(0, n.width - 24)
    if (measured > inner + 1) {
      warnings.push({
        code: 'LABEL_OVERFLOW',
        target: n.id,
        overflowPx: Math.ceil(measured - inner),
      })
    }
  }

  // NODE_OVERLAP
  for (let i = 0; i < positioned.nodes.length; i++) {
    for (let j = i + 1; j < positioned.nodes.length; j++) {
      const a = positioned.nodes[i]!
      const b = positioned.nodes[j]!
      const overlap = rectIntersection(a, b)
      if (overlap > 0) {
        warnings.push({ code: 'NODE_OVERLAP', a: a.id, b: b.id, areaPx: Math.round(overlap) })
      }
    }
  }

  // ROUTE_SELF_CROSS
  for (const e of positioned.edges) {
    const count = countSelfCrossings(e.points)
    if (count > 0) {
      warnings.push({ code: 'ROUTE_SELF_CROSS', edge: `${e.source}->${e.target}`, count })
    }
  }

  return finalize(warnings, layout, opts)
}

function unwrapForVerify(source: string): ValidDiagram | null {
  const parsed = parseValidDiagram(source)
  return parsed.ok ? parsed.value : null
}

function finalize(
  warnings: LayoutWarning[],
  layout: RenderedLayout,
  opts: VerifyOptions,
): VerifyResult {
  const suppress = new Set<WarningCode>(opts.suppress ?? [])
  const kept = warnings.filter(w => !suppress.has(w.code))
  const hasError = kept.some(w => WARNING_SEVERITY[w.code] === 'error')
  return { ok: !hasError, warnings: kept, layout }
}

function emptyLayout(kind: RenderedLayout['kind']): RenderedLayout {
  return {
    version: 1, seed: 0, kind,
    nodes: [], edges: [], groups: [],
    bounds: { w: toFinite(0), h: toFinite(0) },
  }
}

function positionedToRenderedLayout(p: PositionedGraph, kind: RenderedLayout['kind']): RenderedLayout {
  return {
    version: 1, seed: 0, kind,
    nodes: p.nodes.map(toRenderedNode),
    edges: p.edges.map(toRenderedEdge),
    groups: p.groups.map(g => ({
      id: g.id,
      x: f(g.x), y: f(g.y), w: f(g.width), h: f(g.height),
      members: [], label: g.label,
    })),
    bounds: { w: f(p.width), h: f(p.height) },
  }
}

function toRenderedNode(n: PositionedNode): RenderedLayoutNode {
  return { id: n.id, x: f(n.x), y: f(n.y), w: f(n.width), h: f(n.height), shape: n.shape, label: n.label }
}

function toRenderedEdge(e: PositionedEdge): RenderedLayoutEdge {
  return {
    id: `${e.source}->${e.target}`,
    from: e.source, to: e.target,
    path: e.points.map(p => [f(p.x), f(p.y)] as [Finite, Finite]),
    label: e.label && e.labelPosition
      ? { x: f(e.labelPosition.x), y: f(e.labelPosition.y), text: e.label }
      : undefined,
  }
}

function f(n: number): Finite {
  return toFinite(Math.round(n))
}

function rectIntersection(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): number {
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
      if (segmentsIntersect(points[i]!, points[i + 1]!, points[j]!, points[j + 1]!)) count++
    }
  }
  return count
}

function segmentsIntersect(p1: { x: number; y: number }, p2: { x: number; y: number }, p3: { x: number; y: number }, p4: { x: number; y: number }): boolean {
  const d1 = cross(p4.x - p3.x, p4.y - p3.y, p1.x - p3.x, p1.y - p3.y)
  const d2 = cross(p4.x - p3.x, p4.y - p3.y, p2.x - p3.x, p2.y - p3.y)
  const d3 = cross(p2.x - p1.x, p2.y - p1.y, p3.x - p1.x, p3.y - p1.y)
  const d4 = cross(p2.x - p1.x, p2.y - p1.y, p4.x - p1.x, p4.y - p1.y)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
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
