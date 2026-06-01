// ============================================================================
// Reverse ASCII → Mermaid (Loop 10 M5, raiscui-inspired).
//
// BEST-EFFORT, FLOWCHART-ONLY, LOSSY BY NATURE. The ASCII render only carries
// node LABELS (the text inside boxes), not the original node IDs — so this
// reconstructs structure with SYNTHESIZED ids (N0, N1, …). It recovers:
//   - boxes (┌─┐ / └─┘ rectangles, and their ASCII +,-,| equivalents) → nodes
//   - arrows (──►, ◄──, ▼, ▲, and ASCII >,<,v,^) → directed edges, by
//     spatial adjacency of an arrowhead to a box border
//
// What it does NOT recover: original ids, edge labels, node shapes (everything
// becomes a rectangle), subgraphs, styling. Round-trip is STRUCTURAL
// (same node-label set + same edge count), never byte-identical source.
//
// Honest contract (see QUALITY.md): reliable for simple linear chains and
// simple fan-outs. Dense/overlapping routes may miss or mis-attribute edges.
// ============================================================================

import type { Result, ParseError } from '../agent/types.ts'
import { ok, err } from '../agent/types.ts'

interface Box { id: string; label: string; top: number; left: number; bottom: number; right: number }

const TL = new Set(['┌', '╭'])
const TR = new Set(['┐', '╮'])
const ARROW_R = new Set(['►', '▶', '>'])
const ARROW_L = new Set(['◄', '◀', '<'])
const ARROW_D = new Set(['▼', 'v'])
const ARROW_U = new Set(['▲', '^'])

/** Detect rectangular boxes in the ASCII canvas. Returns boxes with their label text. */
function detectBoxes(rows: string[]): Box[] {
  const boxes: Box[] = []
  let counter = 0
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y]!
    for (let x = 0; x < row.length; x++) {
      const ch = row[x]!
      // A top-left corner (Unicode ┌/╭ or ASCII '+').
      const isCorner = TL.has(ch) || (ch === '+' && isAsciiTopLeft(rows, x, y))
      if (!isCorner) continue
      const box = traceBox(rows, x, y)
      if (box) { box.id = `N${counter++}`; boxes.push(box) }
    }
  }
  return boxes
}

function isAsciiTopLeft(rows: string[], x: number, y: number): boolean {
  // '+' is a corner if a '-' is to its right and a '|' below.
  const right = rows[y]?.[x + 1]
  const below = rows[y + 1]?.[x]
  return right === '-' && below === '|'
}

/** Given a top-left corner, scan right for the top edge and down for the left edge. */
function traceBox(rows: string[], x0: number, y0: number): Box | null {
  const topRow = rows[y0]!
  let x1 = -1
  for (let x = x0 + 1; x < topRow.length; x++) {
    const ch = topRow[x]!
    if (TR.has(ch) || ch === '+') { x1 = x; break }
    if (ch !== '─' && ch !== '-') break
  }
  if (x1 < 0) return null
  let y1 = -1
  for (let y = y0 + 1; y < rows.length; y++) {
    const ch = rows[y]?.[x0]
    if (ch === '└' || ch === '╰' || ch === '+') { y1 = y; break }
    if (ch !== '│' && ch !== '|') break
  }
  if (y1 < 0) return null
  // Extract label: non-border text inside the box, joined.
  const labelParts: string[] = []
  for (let y = y0 + 1; y < y1; y++) {
    const seg = (rows[y] ?? '').slice(x0 + 1, x1).replace(/[│|]/g, ' ').trim()
    if (seg) labelParts.push(seg)
  }
  return { id: '', label: labelParts.join(' ').trim(), top: y0, left: x0, bottom: y1, right: x1 }
}

/** Which box border is the cell (x,y) adjacent to / inside? */
function boxAt(boxes: Box[], x: number, y: number, slack = 1): Box | null {
  for (const b of boxes) {
    if (x >= b.left - slack && x <= b.right + slack && y >= b.top - slack && y <= b.bottom + slack) return b
  }
  return null
}

/**
 * Detect directed edges by finding arrowheads and walking back along the
 * connector to the originating box. Best-effort: handles the common
 * horizontal (──►) and vertical (▼) cases.
 */
function detectEdges(rows: string[], boxes: Box[]): Array<[string, string]> {
  const edges: Array<[string, string]> = []
  const seen = new Set<string>()
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y]!
    for (let x = 0; x < row.length; x++) {
      const ch = row[x]!
      let target: Box | null = null
      let source: Box | null = null
      if (ARROW_R.has(ch)) { target = boxAt(boxes, x + 1, y); source = walkLeft(rows, boxes, x, y) }
      else if (ARROW_L.has(ch)) { target = boxAt(boxes, x - 1, y); source = walkRight(rows, boxes, x, y) }
      else if (ARROW_D.has(ch)) { target = boxAt(boxes, x, y + 1); source = walkUp(rows, boxes, x, y) }
      else if (ARROW_U.has(ch)) { target = boxAt(boxes, x, y - 1); source = walkDown(rows, boxes, x, y) }
      if (source && target && source.id !== target.id) {
        const key = `${source.id}->${target.id}`
        if (!seen.has(key)) { seen.add(key); edges.push([source.id, target.id]) }
      }
    }
  }
  return edges
}

const HLINE = new Set(['─', '-', '┬', '┴', '┼', '├', '┤', '+'])
const VLINE = new Set(['│', '|', '┬', '┴', '┼', '├', '┤', '+'])

function walkLeft(rows: string[], boxes: Box[], x: number, y: number): Box | null {
  for (let cx = x - 1; cx >= 0; cx--) {
    const b = boxAt(boxes, cx, y); if (b) return b
    if (!HLINE.has(rows[y]?.[cx] ?? '')) { // allow turning up/down at a junction
      const up = boxAt(boxes, cx, y - 1), dn = boxAt(boxes, cx, y + 1)
      return up ?? dn ?? null
    }
  }
  return null
}
function walkRight(rows: string[], boxes: Box[], x: number, y: number): Box | null {
  for (let cx = x + 1; cx < (rows[y]?.length ?? 0); cx++) {
    const b = boxAt(boxes, cx, y); if (b) return b
    if (!HLINE.has(rows[y]?.[cx] ?? '')) break
  }
  return null
}
function walkUp(rows: string[], boxes: Box[], x: number, y: number): Box | null {
  let cx = x
  for (let cy = y - 1; cy >= 0; cy--) {
    const b = boxAt(boxes, cx, cy); if (b) return b
    const ch = rows[cy]?.[cx] ?? ''
    // Junction/fork glyphs (┬┴┼├┤ and corners): the trunk may bend
    // horizontally here (fan-out connectors like `├───┬───┐`). If the cell
    // directly above is NOT a vertical line, hop along the horizontal run to
    // the column that continues upward (the trunk root), then resume.
    const isJunction = '┬┴┼├┤┐┌╮╭'.includes(ch)
    if (isJunction && !VLINE.has(rows[cy - 1]?.[cx] ?? '')) {
      const hop = hopToTrunk(rows, cx, cy)
      if (hop === null) {
        const left = boxAt(boxes, cx - 1, cy), right = boxAt(boxes, cx + 1, cy)
        return left ?? right ?? null
      }
      cx = hop
      continue
    }
    if (VLINE.has(ch)) continue
    if (HLINE.has(ch)) {
      const hop = hopToTrunk(rows, cx, cy)
      if (hop !== null) { cx = hop; continue }
      const left = boxAt(boxes, cx - 1, cy), right = boxAt(boxes, cx + 1, cy)
      return left ?? right ?? null
    }
    // Dead air — give up.
    const left = boxAt(boxes, cx - 1, cy), right = boxAt(boxes, cx + 1, cy)
    return left ?? right ?? null
  }
  return null
}

/** On a horizontal junction row, scan left then right for a column whose cell
 *  above is a vertical line (the trunk continuing up). Returns that column or null. */
function hopToTrunk(rows: string[], x: number, y: number): number | null {
  const above = (cx: number) => rows[y - 1]?.[cx] ?? ''
  // Prefer the nearest column (left then right) that has a vertical above it.
  for (let d = 0; d < 200; d++) {
    for (const cx of [x - d, x + d]) {
      const here = rows[y]?.[cx] ?? ''
      if (!HLINE.has(here) && !'┐┌╮╭'.includes(here)) continue
      if (VLINE.has(above(cx))) return cx
    }
  }
  return null
}
function walkDown(rows: string[], boxes: Box[], x: number, y: number): Box | null {
  for (let cy = y + 1; cy < rows.length; cy++) {
    const b = boxAt(boxes, x, cy); if (b) return b
    if (!VLINE.has(rows[cy]?.[x] ?? '')) break
  }
  return null
}

function escapeLabel(label: string): string {
  // If the label has spaces or special chars, the [..] form handles it; quote
  // only when it contains brackets that would break the shape.
  return /["[\]{}()]/.test(label) ? `["${label.replace(/"/g, '&quot;')}"]` : `[${label}]`
}

/**
 * Reverse an ASCII flowchart render back to (best-effort) Mermaid source.
 * Returns synthesized ids (N0, N1, …) with recovered labels and edges.
 */
export function asciiToMermaid(ascii: string, opts: { direction?: 'TD' | 'LR' } = {}): Result<string, ParseError[]> {
  if (!ascii.trim()) return err([{ code: 'EMPTY', message: 'empty ASCII input' }])
  const rows = ascii.replace(/\[[0-9;]*m/g, '').split(/\r?\n/) // strip ANSI
  const boxes = detectBoxes(rows)
  if (boxes.length === 0) return err([{ code: 'NO_BOXES', message: 'no boxes detected in ASCII; not a recognized flowchart render' }])

  const edges = detectEdges(rows, boxes)
  const dir = opts.direction ?? 'LR'
  const lines: string[] = [`flowchart ${dir}`]
  // Emit node declarations (id + recovered label).
  for (const b of boxes) lines.push(`  ${b.id}${escapeLabel(b.label || b.id)}`)
  // Emit edges.
  for (const [from, to] of edges) lines.push(`  ${from} --> ${to}`)
  return ok(lines.join('\n'))
}
