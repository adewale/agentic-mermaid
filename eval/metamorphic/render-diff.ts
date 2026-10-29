// GraphicsFuzz-style render-and-diff (Move 3): Donaldson et al. (OOPSLA 2017)
// test a renderer with no output oracle by generating SEMANTICALLY-EQUIVALENT
// input variants, rendering them, and diffing the outputs — any discrepancy is a
// bug. Our equivalent transform is node-id RELABELING (ids carry no geometric
// meaning), so the rendered geometry must be byte-identical up to the rename.
// On a mismatch, ddmin reduces the source to a minimal repro (the "reduce" half).

import { parseRegisteredMermaid as parseMermaid, layoutMermaid } from '../../src/agent/index.ts'
import type { RenderedLayout } from '../../src/agent/types.ts'

/**
 * A geometry signature that is invariant under node-id renaming: node boxes and
 * edge polylines, sorted so the ids/order don't appear. Two equivalent diagrams
 * must produce the same signature.
 */
export function geometrySignature(source: string): string | null {
  const p = parseMermaid(source)
  if (!p.ok) return null
  let layout
  try { layout = layoutMermaid(p.value) } catch { return null }
  return layoutGeometrySignature(layout)
}

/** Ignore floating arithmetic residue, retaining geometry to one nanopixel.
 * Same-glyph label permutations can sum widths in a different order; exact
 * public coordinates expose that residue where integer projections hid it. */
export function layoutGeometrySignature(layout: RenderedLayout): string {
  const coordinate = (n: number): number => Number(n.toFixed(9))
  const nodes = layout.nodes.map(n => `${coordinate(n.x)},${coordinate(n.y)},${coordinate(n.w)},${coordinate(n.h)}`).sort().join('|')
  const edges = layout.edges.map(e => e.path.map(pt => `${coordinate(pt[0])},${coordinate(pt[1])}`).join(';')).sort().join('|')
  const b = layout.bounds
  return `${coordinate(b.w)}x${coordinate(b.h)}#${nodes}#${edges}`
}

/** Whether two sources render to identical geometry (the metamorphic relation). */
export function geometryEquivalent(a: string, b: string): boolean {
  const sa = geometrySignature(a)
  const sb = geometrySignature(b)
  return sa !== null && sa === sb
}
