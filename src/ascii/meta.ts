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
//   - Flowchart / state: regions for each node by label match. Flowchart
//     subgraphs are exposed as best-effort label regions using the same stable
//     ids as SVG/layout JSON; edge spans remain deferred until renderer
//     instrumentation lands.
//   - Sequence / class / ER / timeline / gantt / journey / xychart /
//     architecture: regions for each participant / class / entity / section /
//     task, derived by label scan. Best-effort; some renderers wrap labels
//     and the scan misses them.
//
// Determinism: identical input → identical regions (no randomness, no
// timestamps). Region order follows the scan order (top-down, left-to-right).
// ============================================================================

import { renderMermaidASCII, type AsciiRenderOptions } from './index.ts'
import { parseMermaid } from '../agent/parse.ts'
import { visualWidth } from './width.ts'

export type RegionKind = 'node' | 'edge' | 'label' | 'subgraph'

export type AsciiWarningCode = 'ASCII_RENDER_FAILED' | 'ASCII_EDGE_REGION_UNMAPPED'
export interface AsciiWarning { code: AsciiWarningCode; message: string; severity: 'degraded' }

export const ASCII_ROUTE_PARITY_CONTRACT = {
  version: 1,
  routeIntent: 'shared-route-classes',
  svgSource: 'route-contract classifyRoutes() + certificates',
  asciiSource: 'grid router seeded with classifyRoutes() routeClass metadata, longest-path layering, and direct-lane-first routing',
  degradationWarnings: ['ASCII_RENDER_FAILED', 'ASCII_EDGE_REGION_UNMAPPED'],
} as const

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
  warnings: AsciiWarning[]
  routeParity: typeof ASCII_ROUTE_PARITY_CONTRACT
}

export function renderMermaidASCIIWithMeta(input: string, opts: AsciiRenderOptions = {}): AsciiWithMeta {
  // Mirror parseMermaid's structured-or-opaque rule: if the renderer rejects
  // the source (parse failure), surface empty regions rather than throwing —
  // the meta API is read-only and shouldn't propagate parser errors.
  try {
    const ascii = renderMermaidASCII(input, opts)
    const regions = deriveRegions(ascii, input)
    return { ascii, regions, warnings: deriveWarnings(input, regions), routeParity: ASCII_ROUTE_PARITY_CONTRACT }
  } catch {
    return { ascii: '', regions: [], warnings: [{ code: 'ASCII_RENDER_FAILED', severity: 'degraded', message: 'ASCII/Unicode renderer failed; no route parity evidence is available.' }], routeParity: ASCII_ROUTE_PARITY_CONTRACT }
  }
}

function deriveWarnings(source: string, regions: AsciiRegion[]): AsciiWarning[] {
  const parsed = parseMermaid(source)
  if (!parsed.ok) return []
  if (parsed.value.body.kind !== 'flowchart' && parsed.value.body.kind !== 'state') return []
  const edgeRegions = regions.filter(r => r.kind === 'edge').length
  const edgeCount = parsed.value.body.kind === 'flowchart' ? parsed.value.body.graph.edges.length : parsed.value.body.transitions.length
  if (edgeCount > 0 && edgeRegions === 0) {
    return [{
      code: 'ASCII_EDGE_REGION_UNMAPPED',
      severity: 'degraded',
      message: 'ASCII route drawing follows the explicit route-intent parity mapping, but per-edge cell spans are not instrumented yet.',
    }]
  }
  return []
}

interface Candidate { id: string; label: string; sourceLine?: number; kind?: RegionKind }

function addCandidate(out: Candidate[], id: string, label: string | undefined, sourceLine?: number, kind: RegionKind = 'node'): void {
  const normalized = label?.trim()
  if (!normalized) return
  out.push({ id, label: normalized, sourceLine, kind })
}

function addCandidateWithFallback(out: Candidate[], id: string, label: string | undefined, sourceLine?: number, kind: RegionKind = 'node'): void {
  addCandidate(out, id, label, sourceLine, kind)
  if (label !== id) addCandidate(out, id, id, sourceLine, kind)
}

function deriveRegions(ascii: string, source: string): AsciiRegion[] {
  const candidates = candidatesForDiagram(source)
  if (candidates.length === 0) return []
  const lines = ascii.split('\n')
  // Sort longest label first so 'Alpha' wins over 'A' on the same row.
  const sorted = [...candidates].sort((a, b) => visualWidth(b.label) - visualWidth(a.label))
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
        kind: c.kind ?? 'node',
        id: c.id,
        sourceLine: c.sourceLine,
        canvasRow: row,
        canvasColStart: visualWidth(line.slice(0, idx)),
        canvasColEnd: visualWidth(line.slice(0, idx)) + visualWidth(c.label),
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
    for (const n of d.body.graph.nodes.values()) addCandidateWithFallback(out, n.id, n.label && n.label.length > 0 ? n.label : n.id, d.source.nodes.get(n.id)?.line)
    const visit = (groups: typeof d.body.graph.subgraphs): void => {
      for (const g of groups) {
        addCandidateWithFallback(out, g.id, g.label || g.id, d.source.groups.get(g.id)?.line, 'subgraph')
        visit(g.children)
      }
    }
    visit(d.body.graph.subgraphs)
    return out
  }
  if (d.body.kind === 'state') {
    const out: Candidate[] = []
    const visit = (states: typeof d.body.states): void => {
      for (const s of states) {
        addCandidateWithFallback(out, s.id, s.label ?? s.id)
        if (s.states) visit(s.states)
      }
    }
    visit(d.body.states)
    return out
  }
  if (d.body.kind === 'sequence') {
    return d.body.participants.flatMap(p => {
      const out: Candidate[] = []
      addCandidateWithFallback(out, p.id, p.label || p.id)
      return out
    })
  }
  if (d.body.kind === 'class') {
    return d.body.classes.flatMap(c => {
      const out: Candidate[] = []
      addCandidateWithFallback(out, c.id, c.label || c.id)
      return out
    })
  }
  if (d.body.kind === 'er') {
    return d.body.entities.map(e => ({ id: e.id, label: e.id }))
  }
  if (d.body.kind === 'timeline') {
    const out: Candidate[] = []
    for (const s of d.body.sections) {
      addCandidate(out, s.id, s.label)
      for (const p of s.periods) addCandidate(out, p.id, p.label)
    }
    return out
  }
  if (d.body.kind === 'journey') {
    const out: Candidate[] = []
    addCandidate(out, 'title', d.body.title)
    for (const s of d.body.sections) {
      addCandidate(out, s.id, s.label)
      for (const t of s.tasks) addCandidate(out, t.id, t.text)
    }
    return out
  }
  if (d.body.kind === 'architecture') {
    const out: Candidate[] = []
    for (const g of d.body.groups) addCandidateWithFallback(out, g.id, g.label || g.id)
    for (const s of d.body.services) addCandidateWithFallback(out, s.id, s.label || s.id)
    return out
  }
  if (d.body.kind === 'xychart') {
    const out: Candidate[] = []
    addCandidate(out, 'title', d.body.title)
    addCandidate(out, 'x-axis', d.body.xAxis?.name)
    addCandidate(out, 'y-axis', d.body.yAxis?.name)
    d.body.xAxis?.categories?.forEach((label, index) => addCandidate(out, `x-category-${index}`, label))
    for (const s of d.body.series) addCandidate(out, s.id, s.name)
    return out
  }
  if (d.body.kind === 'pie') {
    const out: Candidate[] = []
    addCandidate(out, 'title', d.body.title)
    for (const s of d.body.slices) addCandidate(out, s.id, s.label)
    return out
  }
  if (d.body.kind === 'quadrant') {
    const out: Candidate[] = []
    addCandidate(out, 'title', d.body.title)
    addCandidate(out, 'x-axis-near', d.body.xAxis?.near)
    addCandidate(out, 'x-axis-far', d.body.xAxis?.far)
    addCandidate(out, 'y-axis-near', d.body.yAxis?.near)
    addCandidate(out, 'y-axis-far', d.body.yAxis?.far)
    d.body.quadrants.forEach((label, index) => addCandidate(out, `quadrant-${index + 1}`, label))
    d.body.points.forEach((p, index) => addCandidate(out, `point-${index}`, p.label))
    return out
  }
  if (d.body.kind === 'gantt') {
    // Issue #26 WS10: gantt tasks/sections as stable click-mappable regions.
    // Region ids prefer the Mermaid task id (the durable handle agents use in
    // after/until/click) over the parse-order internal id.
    const out: Candidate[] = []
    for (const s of d.body.sections) {
      addCandidate(out, s.id, s.label)
      for (const t of s.tasks) addCandidate(out, t.taskId ?? t.id, t.label)
    }
    return out
  }
  return []
}
