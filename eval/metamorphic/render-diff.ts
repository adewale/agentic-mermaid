// GraphicsFuzz-style render-and-diff (Move 3): Donaldson et al. (OOPSLA 2017)
// test a renderer with no output oracle by generating SEMANTICALLY-EQUIVALENT
// input variants, rendering them, and diffing the outputs — any discrepancy is a
// bug. Our equivalent transform is node-id RELABELING (ids carry no geometric
// meaning), so the rendered geometry must be byte-identical up to the rename.
// On a mismatch, ddmin reduces the source to a minimal repro (the "reduce" half).

import { parseMermaid, layoutMermaid } from '../../src/agent/index.ts'

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
  const nodes = layout.nodes.map(n => `${n.x},${n.y},${n.w},${n.h}`).sort().join('|')
  const edges = layout.edges.map(e => e.path.map(pt => `${pt[0]},${pt[1]}`).join(';')).sort().join('|')
  const b = layout.bounds
  return `${b.w}x${b.h}#${nodes}#${edges}`
}

/** Whether two sources render to identical geometry (the metamorphic relation). */
export function geometryEquivalent(a: string, b: string): boolean {
  const sa = geometrySignature(a)
  const sb = geometrySignature(b)
  return sa !== null && sa === sb
}
