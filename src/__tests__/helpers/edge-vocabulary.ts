// Shared flowchart edge-syntax vocabulary for property generators (issue #37).
//
// Issue #37 asks the property-test generators to stop sampling only the plain
// solid arrow `-->` and instead exercise the *wider* edge-syntax vocabulary the
// parser supports, so the existing layout oracles (outline, port, hitch, rubric)
// run across every line style, direction, and marker — not just one operator.
//
// Each form's parsed shape (style/markers) is asserted by a coverage test so the
// generators provably sample real, distinct edges rather than forms the parser
// silently collapses. Metadata here matches the parser's actual output.

import type { EdgeMarker, EdgeStyle } from '../../types.ts'

export interface EdgeForm {
  /** Human-readable name, used in coverage-test failure messages. */
  name: string
  /** The Mermaid edge operator, e.g. `-.->`. */
  op: string
  style: EdgeStyle
  startMarker?: EdgeMarker
  endMarker?: EdgeMarker
  /** Whether a `|label|` pipe label is valid after this operator. */
  allowsPipeLabel: boolean
}

// Solid / dotted / thick line styles × uni- and bi-directional × arrow / circle /
// cross markers, plus no-arrowhead links and the invisible link. All confirmed to
// parse to the metadata below and to keep endpoints on the shape outline.
export const EDGE_FORMS: readonly EdgeForm[] = [
  { name: 'solid arrow', op: '-->', style: 'solid', endMarker: 'arrow', allowsPipeLabel: true },
  { name: 'dotted arrow', op: '-.->', style: 'dotted', endMarker: 'arrow', allowsPipeLabel: true },
  { name: 'thick arrow', op: '==>', style: 'thick', endMarker: 'arrow', allowsPipeLabel: true },
  { name: 'solid bidirectional', op: '<-->', style: 'solid', startMarker: 'arrow', endMarker: 'arrow', allowsPipeLabel: true },
  { name: 'dotted bidirectional', op: '<-.->', style: 'dotted', startMarker: 'arrow', endMarker: 'arrow', allowsPipeLabel: true },
  { name: 'thick bidirectional', op: '<==>', style: 'thick', startMarker: 'arrow', endMarker: 'arrow', allowsPipeLabel: true },
  { name: 'circle endpoint', op: '--o', style: 'solid', endMarker: 'circle', allowsPipeLabel: false },
  { name: 'cross endpoint', op: '--x', style: 'solid', endMarker: 'cross', allowsPipeLabel: false },
  { name: 'circle-to-circle', op: 'o--o', style: 'solid', startMarker: 'circle', endMarker: 'circle', allowsPipeLabel: false },
  { name: 'cross-to-cross', op: 'x--x', style: 'solid', startMarker: 'cross', endMarker: 'cross', allowsPipeLabel: false },
  { name: 'open solid link', op: '---', style: 'solid', allowsPipeLabel: false },
  { name: 'open dotted link', op: '-.-', style: 'dotted', allowsPipeLabel: false },
  { name: 'open thick link', op: '===', style: 'thick', allowsPipeLabel: false },
  { name: 'invisible link', op: '~~~', style: 'invisible', allowsPipeLabel: false },
]

/** Render one edge line `A op B`, attaching a `|label|` only where the form allows it. */
export function renderEdgeLine(a: string, b: string, form: EdgeForm, label = ''): string {
  const pipe = label && form.allowsPipeLabel ? `|${label}|` : ''
  return `${a} ${form.op}${pipe} ${b}`
}
