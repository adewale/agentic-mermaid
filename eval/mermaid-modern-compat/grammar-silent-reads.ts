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
  /** `source` as a JSON string with blank and invisible characters escaped. */
  spelled: string
  /** Mermaid's error on the reduced source. */
  mermaid: string
  ours: ReturnType<typeof ourReading>
  verify: string[]
  /** Reduced inputs of this family that reduced to the same source. */
  occurrences: number
  original: string
  originalVerify: string[]
}

/**
 * A source as a JSON string that shows every character: JSON escapes control
 * characters but leaves NBSP, U+2028 or a BOM raw, and a silent read often
 * turns on exactly such a character.
 */
export const spellSource = (source: string): string => JSON.stringify(source).replace(/[\u007f-\u00a0\u00ad\u2000-\u200f\u2028-\u202f\u205f-\u206f\u3000\ufeff]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)

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
 * budget of distinct checks runs out. Verify lays a diagram out, so a check
 * can cost a tenth of a second; the cheap conditions go first. Deterministic
 * for deterministic engines. A reduction can slip to a different silent read;
 * the caller keeps the original.
 */
export async function reduceSilentRead(family: string, source: string, referenceAccepts: (source: string) => Promise<boolean>, budget = 150): Promise<string> {
  return reduceGrammarWitness(source, async candidate => readsAsFamily(family, inspectAgenticGrammar(family, candidate, { observe: false })) && !(await referenceAccepts(candidate)) && !announces(verifyCodes(candidate)), budget)
}

/** The same bounded line/code-point reducer, with the owning contract as its
 * predicate. A writer or meaning failure must not shrink to a silent read. */
export async function reduceGrammarWitness(source: string, predicate: (source: string) => Promise<boolean>, budget = 150): Promise<string> {
  let current = source
  const checked = new Map<string, boolean>()
  const holds = async (candidate: string): Promise<boolean> => {
    const known = checked.get(candidate)
    if (known !== undefined) return known
    if (budget <= 0) return false
    budget--
    const retained = await predicate(candidate)
    checked.set(candidate, retained)
    return retained
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
