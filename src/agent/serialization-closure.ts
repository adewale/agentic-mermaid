// ============================================================================
// Serialization closure: a typed diagram may be published only when the
// Mermaid written for it reads back as the same diagram. Typed edits and
// untrusted payloads share this check, so a value the writer cannot hold
// (comment or directive markers, statement separators, line terminators) is
// refused with the facts it would change instead of being silently altered.
// verify's CONTENT_DROPPED_ON_ROUNDTRIP lint reports the same difference for
// a diagram it is given.
// ============================================================================

import { describeMermaidFacts } from './facts.ts'
import type { ParsedDiagram } from './types.ts'

const SHOWN = 3

/** The facts of `intended` that `reread` (the parse of the source written for
 * it) loses and the facts it gains; both empty when they state the same
 * diagram. Throws when the facts of `intended` cannot be read. */
export function serializationFactDrift(intended: ParsedDiagram, reread: ParsedDiagram): { lost: string[]; gained: string[] } {
  const expected = describeMermaidFacts(intended)
  const actual = describeMermaidFacts(reread)
  const have = new Set(actual)
  const want = new Set(expected)
  return { lost: expected.filter(fact => !have.has(fact)), gained: actual.filter(fact => !want.has(fact)) }
}

/** The lost and gained facts in words, a few of each. */
export function describeFactDrift({ lost, gained }: { lost: readonly string[]; gained: readonly string[] }): string {
  const list = (facts: readonly string[]) => facts.slice(0, SHOWN).map(fact => JSON.stringify(fact)).join(', ') + (facts.length > SHOWN ? ` and ${facts.length - SHOWN} more` : '')
  return [lost.length ? `loses ${list(lost)}` : '', gained.length ? `gains ${list(gained)}` : ''].filter(Boolean).join(' and ')
}

/** Why `reread` (the parse of the source written for `intended`) does not
 * state the same facts as `intended`, or undefined when it does. */
export function serializationDrift(intended: ParsedDiagram, reread: ParsedDiagram): string | undefined {
  let drift: { lost: string[]; gained: string[] }
  try {
    drift = serializationFactDrift(intended, reread)
  } catch (error) {
    return `its facts cannot be read (${error instanceof Error ? error.message : String(error)})`
  }
  if (!drift.lost.length && !drift.gained.length) return undefined
  return `re-reading the written Mermaid ${describeFactDrift(drift)}`
}
