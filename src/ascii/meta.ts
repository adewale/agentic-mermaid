// ============================================================================
// renderMermaidASCIIWithMeta — render ASCII art and return per-region metadata.
//
// Loop 9 M11. The intended use case is TUI integration: callers (e.g. a TUI
// debugger) need to know which characters in the rendered grid correspond to
// which node id so they can highlight, click-target, or scroll-anchor a
// region.
//
// Implementation choice: rather than instrument every renderer to capture
// per-character roles (which would touch grid.ts, canvas.ts, draw.ts, and
// every family-specific renderer), this module derives regions by scanning
// the rendered string for known node labels. This is honest about what it
// can prove:
//   - Flowchart / state: regions for each node by label match. Edges and
//     subgraphs are skipped (deferred to a future loop that instruments the
//     renderer directly).
//   - Sequence / class / ER / timeline / journey / xychart / architecture:
//     regions for each participant / class / entity / section, derived by
//     label scan. Best-effort; some renderers wrap labels and the scan
//     misses them.
//
// Determinism: identical input → identical regions (no randomness, no
// timestamps). Region order follows the scan order (top-down, left-to-right).
// ============================================================================

import { renderMermaidASCII, type AsciiRenderOptions } from './index.ts'
import { parseMermaid } from '../agent/parse.ts'

export type RegionKind = 'node' | 'edge' | 'label' | 'subgraph'

export interface AsciiRegion {
  kind: RegionKind
  /** Stable identifier for the diagram element (e.g. node id, participant id). */
  id: string
  /** Optional 1-based source line where the element was declared, when known. */
  sourceLine?: number
  /** 0-based row in the rendered canvas where the region starts. */
  canvasRow: number
  /** 0-based column where the region starts (inclusive). */
  canvasColStart: number
  /** 0-based column where the region ends (exclusive). */
  canvasColEnd: number
  /** Optional row count when the region spans multiple lines (boxed node). */
  rowSpan?: number
}

export interface AsciiWithMeta {
  ascii: string
  regions: AsciiRegion[]
}

export function renderMermaidASCIIWithMeta(input: string, opts: AsciiRenderOptions = {}): AsciiWithMeta {
  // Mirror parseMermaid's structured-or-opaque rule: if the renderer rejects
  // the source (parse failure), surface empty regions rather than throwing —
  // the meta API is read-only and shouldn't propagate parser errors.
  try {
    const ascii = renderMermaidASCII(input, opts)
    const regions = deriveRegions(ascii, input)
    return { ascii, regions }
  } catch {
    return { ascii: '', regions: [] }
  }
}

interface Candidate { id: string; label: string; sourceLine?: number }

function deriveRegions(ascii: string, source: string): AsciiRegion[] {
  const candidates = candidatesForDiagram(source)
  if (candidates.length === 0) return []
  const lines = ascii.split('\n')
  // Sort longest label first so 'Alpha' wins over 'A' on the same row.
  const sorted = [...candidates].sort((a, b) => b.label.length - a.label.length)
  // Track regions already assigned so a label scan doesn't double-match.
  const used = new Set<string>()
  const out: AsciiRegion[] = []
  for (let row = 0; row < lines.length; row++) {
    const line = lines[row]!
    for (const c of sorted) {
      if (used.has(c.id)) continue
      const idx = line.indexOf(c.label)
      if (idx < 0) continue
      out.push({
        kind: 'node',
        id: c.id,
        sourceLine: c.sourceLine,
        canvasRow: row,
        canvasColStart: idx,
        canvasColEnd: idx + c.label.length,
      })
      used.add(c.id)
    }
  }
  // Stable order: by canvasRow then canvasColStart.
  out.sort((a, b) => a.canvasRow - b.canvasRow || a.canvasColStart - b.canvasColStart)
  return out
}

function candidatesForDiagram(source: string): Candidate[] {
  const r = parseMermaid(source)
  if (!r.ok) return []
  const d = r.value
  if (d.body.kind === 'flowchart') {
    const out: Candidate[] = []
    for (const n of d.body.graph.nodes.values()) {
      const label = n.label && n.label.length > 0 ? n.label : n.id
      out.push({ id: n.id, label })
    }
    return out
  }
  if (d.body.kind === 'sequence') {
    return d.body.participants.map(p => ({ id: p.id, label: p.label || p.id }))
  }
  if (d.body.kind === 'class') {
    return d.body.classes.map(c => ({ id: c.id, label: c.label || c.id }))
  }
  if (d.body.kind === 'er') {
    return d.body.entities.map(e => ({ id: e.id, label: e.id }))
  }
  if (d.body.kind === 'timeline') {
    const out: Candidate[] = []
    for (const s of d.body.sections) {
      if (s.label) out.push({ id: s.id, label: s.label })
      for (const p of s.periods) out.push({ id: p.id, label: p.label })
    }
    return out
  }
  return []
}
