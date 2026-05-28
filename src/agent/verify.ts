// ============================================================================
// verifyMermaid — Tier 1 (source/structure, reliable) + Tier 2 (geometric).
//
// v4: no LayoutContext, no seed wrapper (ELK is deterministic on its own).
// LABEL_OVERFLOW is a source-based char-count check (Tier 1).
// ============================================================================

import { parseMermaid as parseValidDiagram } from './parse.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import type {
  ValidDiagram, VerifyOptions, VerifyResult, LayoutWarning, RenderedLayout,
  WarningCode, SequenceBody,
} from './types.ts'
import { WARNING_SEVERITY, DEFAULT_LABEL_CHAR_CAP } from './types.ts'
import { positionedToRenderedLayout, emptyRenderedLayout } from './layout-to-rendered.ts'

const KNOWN_SHAPES = new Set([
  'rectangle', 'service', 'rounded', 'diamond', 'stadium', 'circle',
  'subroutine', 'doublecircle', 'hexagon', 'cylinder', 'asymmetric',
  'trapezoid', 'trapezoid-alt', 'state-start', 'state-end',
])

export function verifyMermaid(input: ValidDiagram | string, opts: VerifyOptions = {}): VerifyResult {
  const d = typeof input === 'string' ? unwrap(input) : input
  if (!d) return finalize([{ code: 'EMPTY_DIAGRAM' }], emptyRenderedLayout('flowchart'), opts)

  const cap = opts.labelCharCap ?? DEFAULT_LABEL_CHAR_CAP

  if (d.body.kind === 'sequence') return verifySequence(d.body, d.kind, cap, opts)

  if (d.body.kind === 'opaque') {
    const isEmpty = d.body.source.trim().split('\n').length <= 1
    return finalize(isEmpty ? [{ code: 'EMPTY_DIAGRAM' }] : [], emptyRenderedLayout(d.kind), opts)
  }

  const graph = d.body.graph
  if (graph.nodes.size === 0) return finalize([{ code: 'EMPTY_DIAGRAM' }], emptyRenderedLayout(d.kind), opts)

  const positioned = layoutGraphSync(graph, {})
  const layout = positionedToRenderedLayout(positioned, d.kind)
  const warnings: LayoutWarning[] = []

  // Tier 1 — structural
  for (const edge of graph.edges) {
    if (!graph.nodes.has(edge.source) || !graph.nodes.has(edge.target)) {
      warnings.push({
        code: 'EDGE_MISANCHORED', edge: `${edge.source}->${edge.target}`,
        from: graph.nodes.has(edge.source) ? edge.source : undefined,
        to: graph.nodes.has(edge.target) ? edge.target : undefined,
      })
    }
  }
  for (const [id, node] of graph.nodes) {
    if (!KNOWN_SHAPES.has(node.shape)) warnings.push({ code: 'UNKNOWN_SHAPE', node: id, shape: String(node.shape) })
    if (node.label.length > cap) warnings.push({ code: 'LABEL_OVERFLOW', target: id, charCount: node.label.length, limit: cap })
  }
  for (const edge of graph.edges) {
    if (edge.label && edge.label.length > cap) {
      warnings.push({ code: 'LABEL_OVERFLOW', target: `${edge.source}->${edge.target}`, charCount: edge.label.length, limit: cap })
    }
  }
  for (const n of positioned.nodes) {
    // Report x and y independently so a node off-canvas on both axes surfaces
    // both, instead of masking the second behind an else-if.
    if (n.x < 0 || n.x + n.width > positioned.width + 1) warnings.push({ code: 'OFF_CANVAS', target: n.id, axis: 'x' })
    if (n.y < 0 || n.y + n.height > positioned.height + 1) warnings.push({ code: 'OFF_CANVAS', target: n.id, axis: 'y' })
  }
  for (const g of positioned.groups) {
    const visit = (group: typeof g) => {
      const sg = findSubgraphById(graph.subgraphs, group.id)
      if (sg) for (const n of positioned.nodes) {
        if (!sg.nodeIds.includes(n.id)) continue
        const inside = n.x >= group.x && n.y >= group.y &&
          n.x + n.width <= group.x + group.width + 0.5 && n.y + n.height <= group.y + group.height + 0.5
        if (!inside) warnings.push({ code: 'GROUP_BREACH', group: group.id, member: n.id })
      }
      for (const c of group.children) visit(c)
    }
    visit(g)
  }

  // Tier 2 — geometric
  for (let i = 0; i < positioned.nodes.length; i++) {
    for (let j = i + 1; j < positioned.nodes.length; j++) {
      const a = positioned.nodes[i]!, b = positioned.nodes[j]!
      const o = rectIntersection(a, b)
      if (o > 0) warnings.push({ code: 'NODE_OVERLAP', a: a.id, b: b.id, areaPx: Math.round(o) })
    }
  }
  for (const e of positioned.edges) {
    const c = countSelfCrossings(e.points)
    if (c > 0) warnings.push({ code: 'ROUTE_SELF_CROSS', edge: `${e.source}->${e.target}`, count: c })
  }

  return finalize(warnings, layout, opts)
}

function verifySequence(body: SequenceBody, kind: ValidDiagram['kind'], cap: number, opts: VerifyOptions): VerifyResult {
  const warnings: LayoutWarning[] = []
  if (body.participants.length === 0 && body.messages.length === 0) {
    return finalize([{ code: 'EMPTY_DIAGRAM' }], emptyRenderedLayout(kind), opts)
  }
  const ids = new Set(body.participants.map(p => p.id))
  body.messages.forEach((m, i) => {
    if (!ids.has(m.from) || !ids.has(m.to)) {
      warnings.push({
        code: 'EDGE_MISANCHORED', edge: `msg#${i}:${m.from}->${m.to}`,
        from: ids.has(m.from) ? m.from : undefined, to: ids.has(m.to) ? m.to : undefined,
      })
    }
    if (m.text.length > cap) warnings.push({ code: 'LABEL_OVERFLOW', target: `msg#${i}:${m.from}->${m.to}`, charCount: m.text.length, limit: cap })
  })
  for (const p of body.participants) {
    if (p.label.length > cap) warnings.push({ code: 'LABEL_OVERFLOW', target: p.id, charCount: p.label.length, limit: cap })
  }
  return finalize(warnings, emptyRenderedLayout(kind), opts)
}

// ---- helpers --------------------------------------------------------------

function unwrap(source: string): ValidDiagram | null {
  const r = parseValidDiagram(source)
  return r.ok ? r.value : null
}

function finalize(warnings: LayoutWarning[], layout: RenderedLayout, opts: VerifyOptions): VerifyResult {
  const suppress = new Set<WarningCode>(opts.suppress ?? [])
  const kept = warnings.filter(w => !suppress.has(w.code))
  return { ok: !kept.some(w => WARNING_SEVERITY[w.code] === 'error'), warnings: kept, layout }
}

function rectIntersection(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): number {
  const xo = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  const yo = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  return xo * yo
}
function countSelfCrossings(points: { x: number; y: number }[]): number {
  if (points.length < 4) return 0
  let count = 0
  for (let i = 0; i < points.length - 1; i++)
    for (let j = i + 2; j < points.length - 1; j++) {
      if (i === 0 && j === points.length - 2) continue
      if (segInt(points[i]!, points[i + 1]!, points[j]!, points[j + 1]!)) count++
    }
  return count
}
function segInt(p1: { x: number; y: number }, p2: { x: number; y: number }, p3: { x: number; y: number }, p4: { x: number; y: number }): boolean {
  const d1 = cr(p4.x - p3.x, p4.y - p3.y, p1.x - p3.x, p1.y - p3.y)
  const d2 = cr(p4.x - p3.x, p4.y - p3.y, p2.x - p3.x, p2.y - p3.y)
  const d3 = cr(p2.x - p1.x, p2.y - p1.y, p3.x - p1.x, p3.y - p1.y)
  const d4 = cr(p2.x - p1.x, p2.y - p1.y, p4.x - p1.x, p4.y - p1.y)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}
function cr(x1: number, y1: number, x2: number, y2: number): number { return x1 * y2 - x2 * y1 }

function findSubgraphById(list: import('../types.ts').MermaidSubgraph[], id: string): import('../types.ts').MermaidSubgraph | null {
  for (const sg of list) { if (sg.id === id) return sg; const c = findSubgraphById(sg.children, id); if (c) return c }
  return null
}
