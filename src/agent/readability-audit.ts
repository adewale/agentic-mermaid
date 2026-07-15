// Readability audit over the public RenderedLayout.
//
// "Readable" here means every text element can actually be read: its glyphs are
// neither occluded by foreign geometry nor clipped off the canvas. This is the
// invariant the before/after fan-out screenshots violated — the "yes" label
// rendered as a clipped "es" because a node box was drawn over it.
//
// Three codes, all family-agnostic (they read only the rendered geometry/text):
//   • LABEL_OCCLUDED — a text element overlaps foreign geometry that hides its
//     glyphs: an edge-label pill over a non-incident node or another edge label,
//     or a LABELLED node's box overlapped by another node.
//   • LABEL_CLIPPED  — a text element extends beyond the diagram bounds.
//   • LABEL_LINE_OVERLONG — a label line runs past the comfortable reading
//     measure (READABLE_MAX_CHARS): readable but tiring, and a signal to rewrap
//     (idea #12). Reported with the offending line length so an agent can act.
//
// A small overlap tolerance (TOL) ignores grazes — a 1px touch is not a
// readability defect, an occluded glyph is.

import type { RenderedLayout, RenderedLayoutNode } from './types.ts'
import { measureMultilineText } from '../text-metrics.ts'
import { resolveRenderStyle } from '../styles.ts'
import { longestLineChars, READABLE_MAX_CHARS } from '../shared/readability.ts'

export type ReadabilityFinding =
  | { code: 'LABEL_OCCLUDED'; element: string; by: string }
  | { code: 'LABEL_CLIPPED'; element: string }
  | { code: 'LABEL_LINE_OVERLONG'; element: string; chars: number }

interface Box { x: number; y: number; w: number; h: number }

const TOL = 2 // an overlap must exceed this on BOTH axes to count (ignore grazes)
const PILL_PAD = 8
const BOUNDS_TOL = 1

// Node-LABEL occlusion is only meaningful where a node's `label` is drawn as
// glyphs inside its box — the node-link families. Chart families render a node's
// `label` as axis/series metadata (a bar's category lives on the x-axis, not on
// the bar), so two marks sharing a column is not a text-occlusion. This is a
// category rule about rendering models, not a per-diagram exception; EDGE-label
// checks below still run for every family.
const NODE_LINK_KINDS = new Set(['flowchart', 'state', 'class', 'er', 'architecture'])

const overlaps = (a: Box, b: Box): boolean =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > TOL &&
  Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > TOL

const nodeBox = (n: RenderedLayoutNode): Box => ({ x: n.x, y: n.y, w: n.w, h: n.h })
const hasText = (label: string | undefined): boolean => !!label && label.trim().length > 0

export function auditReadability(layout: RenderedLayout): ReadabilityFinding[] {
  const style = resolveRenderStyle({})
  const findings: ReadabilityFinding[] = []
  const within = (b: Box): boolean =>
    b.x >= -BOUNDS_TOL && b.y >= -BOUNDS_TOL &&
    b.x + b.w <= layout.bounds.w + BOUNDS_TOL && b.y + b.h <= layout.bounds.h + BOUNDS_TOL

  // Edge labels: pill must be in-bounds and clear of non-incident nodes and
  // other edge labels.
  const labelBoxes: Array<{ id: string; box: Box }> = []
  for (const e of layout.edges) {
    if (!e.label) continue
    const m = measureMultilineText(e.label.text, style.edgeLabelFontSize, style.edgeLabelFontWeight)
    const box: Box = { x: e.label.x - (m.width + 2 * PILL_PAD) / 2, y: e.label.y - (m.height + 2 * PILL_PAD) / 2, w: m.width + 2 * PILL_PAD, h: m.height + 2 * PILL_PAD }
    if (!within(box)) findings.push({ code: 'LABEL_CLIPPED', element: e.id })
    for (const n of layout.nodes) {
      if (n.id === e.from || n.id === e.to) continue
      if (overlaps(box, nodeBox(n))) { findings.push({ code: 'LABEL_OCCLUDED', element: e.id, by: n.id }); break }
    }
    for (const other of labelBoxes) {
      if (overlaps(box, other.box)) { findings.push({ code: 'LABEL_OCCLUDED', element: e.id, by: other.id }); break }
    }
    labelBoxes.push({ id: e.id, box })
  }

  // Node labels: a labelled node's box must be in-bounds and not overlapped by
  // another node (which would draw over its text). We only consider nodes whose
  // box actually FITS the rendered label — i.e. the text is drawn as glyphs
  // inside the box. This exempts marks whose `label` is metadata rendered
  // elsewhere (a chart bar's category lives on the axis, not on the bar), by the
  // principled "is text drawn here" test rather than a per-family exception.
  const labelFitsBox = (n: RenderedLayoutNode): boolean => {
    const m = measureMultilineText(n.label!, style.nodeLabelFontSize, style.nodeLabelFontWeight)
    return n.w + 1 >= m.width && n.h + 1 >= m.height
  }
  for (const n of NODE_LINK_KINDS.has(layout.kind) ? layout.nodes : []) {
    if (!hasText(n.label) || !labelFitsBox(n)) continue
    const box = nodeBox(n)
    if (!within(box)) findings.push({ code: 'LABEL_CLIPPED', element: n.id })
    for (const other of layout.nodes) {
      if (other.id === n.id) continue
      if (overlaps(box, nodeBox(other))) { findings.push({ code: 'LABEL_OCCLUDED', element: n.id, by: other.id }); break }
    }
  }

  // Overlong lines: a label line past the comfortable reading measure is
  // readable but tiring, and a signal to rewrap. Node labels are only drawn as
  // glyphs for the node-link families (a chart node's label is axis metadata);
  // edge labels are drawn as pills for every family.
  for (const n of NODE_LINK_KINDS.has(layout.kind) ? layout.nodes : []) {
    if (!hasText(n.label)) continue
    const chars = longestLineChars(n.label!)
    if (chars > READABLE_MAX_CHARS) findings.push({ code: 'LABEL_LINE_OVERLONG', element: n.id, chars })
  }
  for (const e of layout.edges) {
    if (!e.label) continue
    const chars = longestLineChars(e.label.text)
    if (chars > READABLE_MAX_CHARS) findings.push({ code: 'LABEL_LINE_OVERLONG', element: e.id, chars })
  }

  return findings
}
