// ============================================================================
// Typography seam: the one place every built-in family asks for a text size.
//
// Each family still states its own default, and classifies the text it sizes
// into a tier. Today the seam returns that default unchanged, so output is
// byte-identical; the typography options under evaluation replace this
// function (see eval/typography-lab) rather than editing family code.
//
// Authored sizes (family config keys, Style roles, per-element styles) are
// applied by the families after this call and are never passed through it.
// ============================================================================

/** The kind of text being sized, shared by every family. */
export type TextTier =
  /** Diagram titles. */
  | 'title'
  /** Group, subgraph, section and period headers; legend headings. */
  | 'heading'
  /** Primary labels: nodes, actors, tasks, services, entity and class names. */
  | 'body'
  /** Secondary text: edge and message labels, members, attributes,
   * cardinalities, axis ticks, legend items, data labels, notes. */
  | 'detail'
  /** Glyph-like marks sized to their shape, not to the text scale: icon
   * fallbacks, menu dots, key markers, ring ticks. */
  | 'mark'

/** The size for text of `tier` whose family default is `fallback` pixels. */
export function typeSize(_tier: TextTier, fallback: number): number {
  return fallback
}
