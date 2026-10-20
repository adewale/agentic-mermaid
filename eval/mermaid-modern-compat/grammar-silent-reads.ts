import { verifyMermaid } from '../../src/agent/core.ts'
import { type AgenticGrammarResult, inspectAgenticGrammar } from './grammar-agentic.ts'

/**
 * A silent read: the pinned Mermaid grammar rejects the source, ours reads it
 * as the same family (natively, or as a structured typed body), and verify
 * names no problem with the source. Under the project's input policy a
 * generous read is fine only when verify says Mermaid rejects it
 * (UNSUPPORTED_SYNTAX), or when verify refuses the source outright with a
 * source finding. Geometry findings do not announce a misread.
 */
const ANNOUNCING_CODES = new Set(['UNSUPPORTED_SYNTAX', 'EMPTY_DIAGRAM', 'UNRESOLVABLE_SCHEDULE', 'RENDER_FAILED'])
export const SILENT_READ_DEFINITION = `Pinned Mermaid rejects; ours reads the family natively or as a structured body; verify reports none of ${[...ANNOUNCING_CODES].join(', ')}.`

export interface SilentReadExample {
  family: string
  /** The corpus or mutation input whose reduction this is. */
  id: string
  parent?: string
  seed: number
  /** Reduced source; still a silent read. */
  source: string
  /** Mermaid's error on the reduced source. */
  mermaid: string
  ours: ReturnType<typeof ourReading>
  verify: string[]
  /** Reduced inputs of this family that reduced to the same source. */
  occurrences: number
  original: string
  originalVerify: string[]
}

export function readsAsFamily(family: string, agentic: AgenticGrammarResult): boolean {
  return agentic.native.status === 'accepted' || (agentic.envelope.representation === 'structured' && agentic.envelope.family === family)
}

/** Verify's finding codes, in order. A throw is a finding too, never a reason to stop the run. */
export function verifyCodes(source: string): string[] {
  try {
    return [...new Set(verifyMermaid(source).warnings.map(warning => warning.code))]
  } catch (error) {
    return [`THREW: ${String(error instanceof Error ? error.message : error).slice(0, 200)}`]
  }
}

export const announces = (codes: readonly string[]): boolean => codes.some(code => ANNOUNCING_CODES.has(code))

/**
 * Shrink a silent read while it stays one: first whole lines, then code
 * points, each at halving chunk sizes, until a pass removes nothing or the
 * budget of checks runs out. Deterministic for deterministic engines. A
 * reduction can slip to a different silent read; the caller keeps the original.
 */
export async function reduceSilentRead(family: string, source: string, referenceAccepts: (source: string) => Promise<boolean>, budget = 300): Promise<string> {
  let current = source
  const holds = async (candidate: string): Promise<boolean> => {
    if (budget <= 0) return false
    budget--
    if (!readsAsFamily(family, inspectAgenticGrammar(family, candidate, { observe: false }))) return false
    if (await referenceAccepts(candidate)) return false
    return !announces(verifyCodes(candidate))
  }
  for (const [split, separator] of [[(text: string) => text.split('\n'), '\n'] as const, [(text: string) => Array.from(text), ''] as const]) {
    for (let changed = true; changed && budget > 0; ) {
      changed = false
      let parts = split(current)
      for (let size = Math.max(1, parts.length >> 1); size >= 1 && budget > 0; size >>= 1) {
        for (let at = 0; at < parts.length && budget > 0; ) {
          const next = [...parts.slice(0, at), ...parts.slice(at + size)]
          const candidate = next.join(separator)
          if (next.length && (await holds(candidate))) {
            parts = next
            current = candidate
            changed = true
          } else at += size
        }
      }
    }
  }
  return current
}

/** What ours read: its own Mermaid writing of a structured body, else the native parser's selected semantics. */
export function ourReading(family: string, source: string): { native: string; envelope: string; read: string } {
  const agentic = inspectAgenticGrammar(family, source)
  const semantic = agentic.native.observation.semantic?.value
  const read = agentic.serialized ?? (semantic === undefined ? '(no selected semantics)' : JSON.stringify(semantic))
  return { native: agentic.native.status, envelope: agentic.envelope.status === 'accepted' ? `${agentic.envelope.family} ${agentic.envelope.representation}` : 'rejected', read: read.length > 1200 ? `${read.slice(0, 1200)}…` : read }
}
