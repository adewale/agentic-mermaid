// ============================================================================
// Mermaid v11.3+ flowchart typed-shape vocabulary (repo #44).
//
// THE one normalization table: every documented `@{ shape: ... }` short name
// and alias (upstream shape table, https://mermaid.js.org/syntax/flowchart.html,
// verified 2026-07-10) maps to
//   - a canonical short name (the id upstream's own docs lead with), and
//   - a rendering geometry drawn from the existing NodeShape enum, flagged
//     `exact` when the geometry IS the documented symbol (the legacy bracket
//     syntax draws the same thing) or approximate when it is the nearest
//     existing renderer (announced by verify's Tier-3
//     `flowchart_shape_substitution` lint — never silent, never UNKNOWN_SHAPE).
//
// Consumers: the render parser (consumeMetadataNode), the agent serializer
// (renderFlowchart re-emits the AUTHORED spelling), the structured/opaque
// gate (flowchart-unsupported.ts), verify's substitution lint, and the
// set_shape/add_node mutation ops. Nothing else may hand-encode these names.
// ============================================================================

import type { NodeShape } from './types.ts'

export interface FlowchartV11Shape {
  /** Documented aliases (the canonical short name is the record key). */
  aliases: readonly string[]
  /** Existing renderer geometry this shape draws with. */
  geometry: NodeShape
  /** True when the geometry is the documented symbol itself; false = nearest
   *  existing geometry, announced by the substitution lint. */
  exact: boolean
  /** Human name used in diagnostics (upstream's semantic name). */
  description: string
}

export const FLOWCHART_V11_SHAPES: Readonly<Record<string, FlowchartV11Shape>> = {
  // ---- exact: the legacy bracket syntax draws the same symbol -------------
  'rect': { aliases: ['proc', 'process', 'rectangle'], geometry: 'rectangle', exact: true, description: 'Process' },
  'rounded': { aliases: ['event'], geometry: 'rounded', exact: true, description: 'Event' },
  'stadium': { aliases: ['pill', 'terminal'], geometry: 'stadium', exact: true, description: 'Terminal point' },
  'cyl': { aliases: ['cylinder', 'database', 'db'], geometry: 'cylinder', exact: true, description: 'Database' },
  'diam': { aliases: ['decision', 'diamond', 'question'], geometry: 'diamond', exact: true, description: 'Decision' },
  'hex': { aliases: ['hexagon', 'prepare'], geometry: 'hexagon', exact: true, description: 'Prepare conditional' },
  'lean-r': { aliases: ['in-out', 'lean-right'], geometry: 'lean-r', exact: true, description: 'Data input/output' },
  'lean-l': { aliases: ['lean-left', 'out-in'], geometry: 'lean-l', exact: true, description: 'Data output/input' },
  'trap-b': { aliases: ['priority', 'trapezoid', 'trapezoid-bottom'], geometry: 'trapezoid', exact: true, description: 'Priority action' },
  'trap-t': { aliases: ['inv-trapezoid', 'manual', 'trapezoid-top'], geometry: 'trapezoid-alt', exact: true, description: 'Manual operation' },
  'circle': { aliases: ['circ'], geometry: 'circle', exact: true, description: 'Start' },
  'dbl-circ': { aliases: ['double-circle'], geometry: 'doublecircle', exact: true, description: 'Stop' },
  'fr-rect': { aliases: ['framed-rectangle', 'subproc', 'subprocess', 'subroutine'], geometry: 'subroutine', exact: true, description: 'Subprocess' },
  'odd': { aliases: [], geometry: 'asymmetric', exact: true, description: 'Odd' },

  // ---- semantic geometries: renderer keys on canonical semanticShape ----------
  'bang': { aliases: [], geometry: 'circle', exact: true, description: 'Bang' },
  'notch-rect': { aliases: ['card', 'notched-rectangle'], geometry: 'rectangle', exact: true, description: 'Card' },
  'cloud': { aliases: [], geometry: 'rounded', exact: true, description: 'Cloud' },
  'hourglass': { aliases: ['collate'], geometry: 'diamond', exact: true, description: 'Collate' },
  'bolt': { aliases: ['com-link', 'lightning-bolt'], geometry: 'rectangle', exact: true, description: 'Com link' },
  'brace': { aliases: ['brace-l', 'comment'], geometry: 'rectangle', exact: true, description: 'Comment' },
  'brace-r': { aliases: [], geometry: 'rectangle', exact: true, description: 'Comment right' },
  'braces': { aliases: [], geometry: 'rectangle', exact: true, description: 'Comment both' },
  'datastore': { aliases: ['data-store'], geometry: 'cylinder', exact: true, description: 'Data store' },
  'delay': { aliases: ['half-rounded-rectangle'], geometry: 'rounded', exact: true, description: 'Delay' },
  'h-cyl': { aliases: ['das', 'horizontal-cylinder'], geometry: 'cylinder', exact: true, description: 'Direct access storage' },
  'lin-cyl': { aliases: ['disk', 'lined-cylinder'], geometry: 'cylinder', exact: true, description: 'Disk storage' },
  'curv-trap': { aliases: ['curved-trapezoid', 'display'], geometry: 'rounded', exact: true, description: 'Display' },
  'div-rect': { aliases: ['div-proc', 'divided-process', 'divided-rectangle'], geometry: 'rectangle', exact: true, description: 'Divided process' },
  'doc': { aliases: ['document'], geometry: 'rectangle', exact: true, description: 'Document' },
  'tri': { aliases: ['extract', 'triangle'], geometry: 'trapezoid', exact: true, description: 'Extract' },
  'fork': { aliases: ['join'], geometry: 'rectangle', exact: true, description: 'Fork/join' },
  'win-pane': { aliases: ['internal-storage', 'window-pane'], geometry: 'rectangle', exact: true, description: 'Internal storage' },
  'f-circ': { aliases: ['filled-circle', 'junction'], geometry: 'circle', exact: true, description: 'Junction' },
  'lin-doc': { aliases: ['lined-document'], geometry: 'rectangle', exact: true, description: 'Lined document' },
  'lin-rect': { aliases: ['lin-proc', 'lined-process', 'lined-rectangle', 'shaded-process'], geometry: 'subroutine', exact: true, description: 'Lined/shaded process' },
  'notch-pent': { aliases: ['loop-limit', 'notched-pentagon'], geometry: 'hexagon', exact: true, description: 'Loop limit' },
  'flip-tri': { aliases: ['flipped-triangle', 'manual-file'], geometry: 'trapezoid-alt', exact: true, description: 'Manual file' },
  'sl-rect': { aliases: ['manual-input', 'sloped-rectangle'], geometry: 'lean-r', exact: true, description: 'Manual input' },
  'docs': { aliases: ['documents', 'st-doc', 'stacked-document'], geometry: 'rectangle', exact: true, description: 'Multi-document' },
  'st-rect': { aliases: ['processes', 'procs', 'stacked-rectangle'], geometry: 'rectangle', exact: true, description: 'Multi-process' },
  'flag': { aliases: ['paper-tape'], geometry: 'rectangle', exact: true, description: 'Paper tape' },
  'sm-circ': { aliases: ['small-circle', 'start'], geometry: 'circle', exact: true, description: 'Start (small)' },
  'fr-circ': { aliases: ['framed-circle', 'stop'], geometry: 'doublecircle', exact: true, description: 'Stop (framed)' },
  'bow-rect': { aliases: ['bow-tie-rectangle', 'stored-data'], geometry: 'cylinder', exact: true, description: 'Stored data' },
  'cross-circ': { aliases: ['crossed-circle', 'summary'], geometry: 'circle', exact: true, description: 'Summary' },
  'tag-doc': { aliases: ['tagged-document'], geometry: 'rectangle', exact: true, description: 'Tagged document' },
  'tag-rect': { aliases: ['tag-proc', 'tagged-process', 'tagged-rectangle'], geometry: 'rectangle', exact: true, description: 'Tagged process' },
  'text': { aliases: [], geometry: 'rectangle', exact: true, description: 'Text block' },
}

export interface NormalizedV11Shape {
  /** Canonical short name (the FLOWCHART_V11_SHAPES key). */
  canonical: string
  geometry: NodeShape
  exact: boolean
  description: string
}

// alias (and canonical) → canonical, built once from the single table.
const ALIAS_TO_CANONICAL: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>()
  for (const [canonical, entry] of Object.entries(FLOWCHART_V11_SHAPES)) {
    map.set(canonical, canonical)
    for (const alias of entry.aliases) map.set(alias, canonical)
  }
  return map
})()

/** Normalize a documented v11 shape name or alias; null for anything else. */
export function normalizeV11Shape(name: string): NormalizedV11Shape | null {
  const canonical = ALIAS_TO_CANONICAL.get(name.trim().toLowerCase())
  if (!canonical) return null
  const entry = FLOWCHART_V11_SHAPES[canonical]!
  return { canonical, geometry: entry.geometry, exact: entry.exact, description: entry.description }
}

/** Every accepted v11 spelling (canonical names + aliases), sorted — the
 *  op-schema enum vocabulary for set_shape/add_node beyond NodeShape. */
export function flowchartV11ShapeNames(): string[] {
  return [...ALIAS_TO_CANONICAL.keys()].sort()
}
