// ============================================================================
// StyleBackend interface + DefaultBackend + backend registry (SPEC §3.2).
//
// A backend consumes a SceneDoc and produces the SVG document string. The
// DefaultBackend is the Agentic Mermaid crisp renderer: it emits each mark's
// construction-time crisp serialization verbatim, so its output is
// byte-identical to the pre-IR string renderers (svg-equivalence.test.ts is
// the corpus-wide gate). Styled backends (rough/hybrid) redraw shape and
// connector marks from their semantic fields and re-derive the document shell
// from PreludeMark parameters; they never dispatch on diagram family.
// ============================================================================

import type { SceneDoc, SceneNode } from './ir.ts'

export interface StyleBackendContext {
  /** User-supplied deterministic re-roll seed (RenderOptions.seed). */
  seed: number
}

export interface StyleBackend {
  id: string
  /** Serialize one top-level mark (recursing through groups). */
  drawNode(node: SceneNode, ctx: StyleBackendContext): string
  /** Serialize the whole document. */
  render(doc: SceneDoc, ctx: StyleBackendContext): string
}

/** Recompose a group from (possibly restyled) child serializations using the
 *  group's own indent/join rules. Shared by all backends so wrapper semantics
 *  (classes, data-*, ARIA) stay identical across styles. */
export function composeGroup(
  open: string,
  close: string,
  join: string,
  children: Array<{ serialized: string; indent: number }>,
): string {
  const pad = (s: string, n: number) => (n <= 0 || s === '' ? s : ' '.repeat(n) + s.replace(/\n/g, '\n' + ' '.repeat(n)))
  return [open, ...children.map(c => pad(c.serialized, c.indent)), close].join(join)
}

export const DefaultBackend: StyleBackend = {
  id: 'default',
  drawNode(node: SceneNode): string {
    return node.crisp
  },
  render(doc: SceneDoc): string {
    return doc.parts.map(part => part.crisp).join('\n')
  },
}

const BACKENDS = new Map<string, StyleBackend>([[DefaultBackend.id, DefaultBackend]])

export function registerBackend(backend: StyleBackend): void {
  BACKENDS.set(backend.id, backend)
}

export function getBackend(id: string): StyleBackend | undefined {
  return BACKENDS.get(id)
}
