/**
 * Ugly-layout detector — finds the defects defined in docs/design/ugly-layouts.md
 * in RENDERED output (SVG, PNG, ASCII), not the internal geometry. See that doc
 * for the definition of each defect.
 *
 * SVG is authoritative (vector paths + shapes recover exactly). PNG is a faithful
 * raster of an SVG, so its check analyses the source SVG plus a coarse pixel
 * orthogonality pass. ASCII is a glyph grid, so detection uses the renderer's
 * region metadata to find edge glyphs inside node interiors.
 */
import { onShapeOutline } from '../../src/layout-rubric.ts'
import type { NodeShape, PositionedNode } from '../../src/types.ts'

export interface Finding { kind: string; severity: 'hard' | 'soft'; detail: string }

// Evidence-based impact order, mirroring the QualityBounds provenance
// (src/agent/quality.ts BOUND_PROVENANCE, grounded in Purchase 1997/2002):
// readability-destroying defects (edges through nodes, overlaps) outrank
// routing-shape defects (diagonals, hitches, floating endpoints), which outrank
// raster-only sanity hints. detect()/detectSvg()/detectAscii() sort by this so
// the worst finding is read first instead of in discovery order.
const IMPACT_RANK: Record<string, number> = {
  'edge-through-node': 0, 'ascii-edge-through-node': 0, 'node-overlap': 0,
  'diagonal-segment': 1, 'hitch': 1, 'floating-endpoint': 1,
  'png-diagonal-ink': 2,
}

export function findingRank(kind: string): number {
  return IMPACT_RANK[kind] ?? 1
}

/** Stable sort of findings by evidence-based impact (then discovery order). */
export function sortByImpact(findings: Finding[]): Finding[] {
  return findings
    .map((f, i) => [f, i] as const)
    .sort(([a, ai], [b, bi]) => (findingRank(a.kind) - findingRank(b.kind)) || (ai - bi))
    .map(([f]) => f)
}
export interface RNode { id: string; shape: NodeShape; x: number; y: number; w: number; h: number }
export interface REdge { from: string; to: string; pts: { x: number; y: number }[] }
export interface Rendered { nodes: RNode[]; edges: REdge[] }

const EPS = 1.0 // a segment shorter than this on the off-axis is "axis-aligned"

function asPositioned(n: RNode): PositionedNode {
  return { id: n.id, label: n.id, shape: n.shape, x: n.x, y: n.y, width: n.w, height: n.h }
}

/** Self-contained "does segment a→b pass through node n's body?" (rubric parity:
 *  shape footprint inset by a graze tolerance so a tangent on the outline is OK). */
function segmentThroughNode(a: { x: number; y: number }, b: { x: number; y: number }, n: RNode): boolean {
  const GRAZE = 2.5
  const x0 = n.x + GRAZE, y0 = n.y + GRAZE, x1 = n.x + n.w - GRAZE, y1 = n.y + n.h - GRAZE
  if (x1 <= x0 || y1 <= y0) return false
  // sample the segment; a point strictly inside the (inset) body, shape-aware
  const steps = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 3))
  const cx = n.x + n.w / 2, cy = n.y + n.h / 2, hw = n.w / 2 - GRAZE, hh = n.h / 2 - GRAZE
  for (let i = 1; i < steps; i++) {
    const t = i / steps, px = a.x + (b.x - a.x) * t, py = a.y + (b.y - a.y) * t
    const dx = Math.abs(px - cx), dy = Math.abs(py - cy)
    let inside = dx < hw && dy < hh // rect/default
    if (n.shape === 'diamond') inside = dx / hw + dy / hh < 1
    else if (n.shape === 'circle' || n.shape === 'doublecircle' || n.shape === 'stadium' || n.shape === 'rounded')
      inside = (dx / hw) ** 2 + (dy / hh) ** 2 < 1
    if (inside) return true
  }
  return false
}

/** Core geometric detector over a normalized rendered diagram. */
export function detect(d: Rendered): Finding[] {
  const out: Finding[] = []
  const byId = new Map(d.nodes.map(n => [n.id, n]))
  for (const e of d.edges) {
    if (e.pts.length < 2) continue
    // diagonal segments
    for (let i = 1; i < e.pts.length; i++) {
      const dx = Math.abs(e.pts[i]!.x - e.pts[i - 1]!.x), dy = Math.abs(e.pts[i]!.y - e.pts[i - 1]!.y)
      if (dx > EPS && dy > EPS) out.push({ kind: 'diagonal-segment', severity: 'hard', detail: `${e.from}->${e.to} segment ${i}` })
    }
    // floating endpoints (not on the connected node's outline)
    const ends: Array<[RNode | undefined, { x: number; y: number }]> = [[byId.get(e.from), e.pts[0]!], [byId.get(e.to), e.pts[e.pts.length - 1]!]]
    for (const [n, p] of ends) {
      if (n && !onShapeOutline(asPositioned(n), p, 1.5)) out.push({ kind: 'floating-endpoint', severity: 'hard', detail: `${e.from}->${e.to} endpoint off ${n.id} outline` })
    }
    // edge through a non-endpoint node
    for (const n of d.nodes) {
      if (n.id === e.from || n.id === e.to) continue
      for (let i = 1; i < e.pts.length; i++) {
        if (segmentThroughNode(e.pts[i - 1]!, e.pts[i]!, n)) { out.push({ kind: 'edge-through-node', severity: 'hard', detail: `${e.from}->${e.to} crosses ${n.id}` }); break }
      }
    }
    // hitch: a short jog between two collinear runs (>=4 points, middle seg tiny
    // & perpendicular). The jog must clear the curved/pointed-shape CLIP_FLOOR:
    // attaching to a circle/diamond outline legitimately offsets the endpoint by
    // up to ~1.5px, and that sub-pixel wobble is not a visible dogleg.
    const CLIP_FLOOR = 1.5
    for (let i = 2; i < e.pts.length - 1; i++) {
      const a = e.pts[i - 2]!, b = e.pts[i - 1]!, c = e.pts[i]!, dd = e.pts[i + 1]!
      const run1Horiz = Math.abs(a.y - b.y) < EPS, run2Horiz = Math.abs(c.y - dd.y) < EPS
      const jog = Math.hypot(c.x - b.x, c.y - b.y)
      const run1 = Math.hypot(b.x - a.x, b.y - a.y), run2 = Math.hypot(dd.x - c.x, dd.y - c.y)
      if (run1Horiz && run2Horiz && Math.abs(a.y - dd.y) < 6 && jog > CLIP_FLOOR && jog < 8 && run1 > 16 && run2 > 16)
        out.push({ kind: 'hitch', severity: 'hard', detail: `${e.from}->${e.to} ${jog.toFixed(1)}px jog on a clear lane` })
    }
  }
  // node overlaps
  for (let i = 0; i < d.nodes.length; i++) for (let j = i + 1; j < d.nodes.length; j++) {
    const a = d.nodes[i]!, b = d.nodes[j]!
    const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
    if (ox > 1 && oy > 1) out.push({ kind: 'node-overlap', severity: 'hard', detail: `${a.id} overlaps ${b.id} (${Math.round(ox * oy)}px²)` })
  }
  return sortByImpact(out)
}

// --------------------------------------------------------------------------
// SVG adapter — parse our renderer's output into the normalized form.
// --------------------------------------------------------------------------
function num(s: string | undefined): number { return s ? parseFloat(s) : NaN }

export function parseSvg(svg: string): Rendered {
  const nodes: RNode[] = []
  // node groups: <g class="node ..." data-id="X" ... data-shape="S"> <shape .../>
  const nodeRe = /<g class="node[^"]*"[^>]*?data-id="([^"]*)"[^>]*?data-shape="([^"]*)"[^>]*?>([\s\S]*?)<\/g>/g
  let m: RegExpExecArray | null
  while ((m = nodeRe.exec(svg))) {
    const [, id, shape, body] = m
    // A node's footprint is the UNION of every primitive in its group, not just
    // the first. Multi-primitive shapes (a cylinder = body rect + two cap
    // ellipses) under-measure if you take one rect, which makes an edge landing
    // on the cap read as a floating endpoint. Union covers all shapes uniformly.
    let lo = [Infinity, Infinity], hi = [-Infinity, -Infinity]
    const grow = (x0: number, y0: number, x1: number, y1: number) => {
      lo = [Math.min(lo[0]!, x0), Math.min(lo[1]!, y0)]; hi = [Math.max(hi[0]!, x1), Math.max(hi[1]!, y1)]
    }
    for (const r of body!.matchAll(/<rect[^>]*?x="([\d.-]+)"[^>]*?y="([\d.-]+)"[^>]*?width="([\d.-]+)"[^>]*?height="([\d.-]+)"/g))
      grow(num(r[1]), num(r[2]), num(r[1]) + num(r[3]), num(r[2]) + num(r[4]))
    for (const e of body!.matchAll(/<ellipse[^>]*?cx="([\d.-]+)"[^>]*?cy="([\d.-]+)"[^>]*?rx="([\d.-]+)"[^>]*?ry="([\d.-]+)"/g))
      grow(num(e[1]) - num(e[3]), num(e[2]) - num(e[4]), num(e[1]) + num(e[3]), num(e[2]) + num(e[4]))
    for (const p of body!.matchAll(/<polygon[^>]*?points="([^"]+)"/g)) {
      const ps = p[1]!.trim().split(/\s+/).map(q => q.split(',').map(Number))
      grow(Math.min(...ps.map(q => q[0]!)), Math.min(...ps.map(q => q[1]!)), Math.max(...ps.map(q => q[0]!)), Math.max(...ps.map(q => q[1]!)))
    }
    if (lo[0]! < hi[0]! && lo[1]! < hi[1]!) nodes.push({ id: id!, shape: shape as NodeShape, x: lo[0]!, y: lo[1]!, w: hi[0]! - lo[0]!, h: hi[1]! - lo[1]! })
  }
  const edges: REdge[] = []
  const polyRe = /<polyline class="edge"[^>]*?data-from="([^"]*)"[^>]*?data-to="([^"]*)"[^>]*?points="([^"]+)"/g
  while ((m = polyRe.exec(svg))) {
    const pts = m[3]!.trim().split(/\s+/).map(p => { const [x, y] = p.split(',').map(Number); return { x: x!, y: y! } })
    edges.push({ from: m[1]!, to: m[2]!, pts })
  }
  // path-form edges (bendRadius>0): take M/L corner points (arcs approximated by endpoints)
  const pathRe = /<path class="edge"[^>]*?data-from="([^"]*)"[^>]*?data-to="([^"]*)"[^>]*?d="([^"]+)"/g
  while ((m = pathRe.exec(svg))) {
    const coords = [...m[3]!.matchAll(/[ML]\s*([\d.-]+)[ ,]([\d.-]+)/g)].map(c => ({ x: num(c[1]), y: num(c[2]) }))
    if (coords.length >= 2) edges.push({ from: m[1]!, to: m[2]!, pts: coords })
  }
  return { nodes, edges }
}

export function detectSvg(svg: string): Finding[] { return detect(parseSvg(svg)) }

// --------------------------------------------------------------------------
// PNG adapter — a PNG is a deterministic raster of the SVG, so every STRUCTURAL
// defect (diagonal segment, through-node, float, overlap) is decided by the SVG
// vector geometry and inherited exactly; detectSvg on the source SVG is the
// authoritative result. The PNG-specific pass is a coarse pixel sanity check
// that the rasterizer didn't corrupt structure: edge ink lives in the gaps
// BETWEEN nodes and, in an orthogonal drawing, runs horizontally/vertically.
// We mask out node footprints (their borders are legitimately curved/slanted)
// and measure the fraction of off-node edge ink whose only neighbours are
// diagonal. A clean orthogonal render is ~0; a gross raster bug spikes it.
// --------------------------------------------------------------------------
export interface Pixels { data: Uint8Array | Uint8ClampedArray; width: number; height: number }
/** nodes are in SVG user units; `scale` maps them to pixel space (viewBox at 0,0). */
export function detectPngPixels(px: Pixels, nodes: RNode[], scale: number): Finding[] {
  const { data, width: W, height: H } = px
  const ink = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= W || y >= H) return false
    const i = (y * W + x) * 4, a = data[i + 3]!
    if (a < 32) return false // transparent
    const lum = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!
    return lum < 128
  }
  // node footprints in pixel space, grown a touch so curved borders don't leak
  const M = Math.ceil(scale)
  const boxes = nodes.map(n => ({ x0: n.x * scale - M, y0: n.y * scale - M, x1: (n.x + n.w) * scale + M, y1: (n.y + n.h) * scale + M }))
  const offNode = (x: number, y: number): boolean => !boxes.some(b => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1)
  let total = 0, diagonalOnly = 0
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    if (!ink(x, y) || !offNode(x, y)) continue
    total++
    const axis = ink(x - 1, y) || ink(x + 1, y) || ink(x, y - 1) || ink(x, y + 1)
    if (!axis && (ink(x - 1, y - 1) || ink(x + 1, y - 1) || ink(x - 1, y + 1) || ink(x + 1, y + 1))) diagonalOnly++
  }
  const out: Finding[] = []
  if (total < 50) return out // too little edge ink off-node to judge
  const frac = diagonalOnly / total
  if (frac > 0.35) out.push({ kind: 'png-diagonal-ink', severity: 'soft', detail: `${(frac * 100).toFixed(0)}% of off-node edge ink is diagonal-only (raster may not match orthogonal SVG)` })
  return out
}

// --------------------------------------------------------------------------
// ASCII adapter — a glyph grid has no diagonals, so the reliably-detectable
// defect is an edge GLYPH sitting on a node's interior. The renderer's region
// metadata (renderMermaidASCIIWithMeta) marks each node's LABEL band, which is
// strictly inside the box border — so a line glyph among those cells means an
// edge was routed through the node body. This is conservative (it samples the
// label band, not the full interior) but has no false positives: nothing but
// the label and blank padding should ever occupy those cells.
// --------------------------------------------------------------------------
const LINE_GLYPHS = new Set('─│┌┐└┘├┤┬┴┼╴╵╶╷▶◀▲▼►◄↑↓←→'.split(''))
/** Subset of renderMermaidASCIIWithMeta's AsciiRegion that we read. */
export interface AsciiRegion {
  kind: string; id: string
  canvasRow: number; canvasColStart: number; canvasColEnd: number; rowSpan?: number
}
export function detectAscii(ascii: string, regions: AsciiRegion[]): Finding[] {
  const out: Finding[] = []
  const rows = ascii.split('\n')
  for (const r of regions) {
    if (r.kind !== 'node') continue
    const r0 = r.canvasRow, r1 = r.canvasRow + (r.rowSpan ?? 1)
    for (let gy = r0; gy < r1; gy++) {
      for (let gx = r.canvasColStart; gx < r.canvasColEnd; gx++) {
        const ch = rows[gy]?.[gx]
        if (ch && LINE_GLYPHS.has(ch)) {
          out.push({ kind: 'ascii-edge-through-node', severity: 'hard', detail: `${r.id}: line glyph '${ch}' on label band at (${gx},${gy})` })
          gy = r1; break
        }
      }
    }
  }
  return sortByImpact(out)
}
