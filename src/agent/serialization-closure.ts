// ============================================================================
// Serialization closure: a typed diagram may be published only when the
// Mermaid written for it reads back as the same diagram. Typed edits and
// untrusted payloads share this check, so a value the writer cannot hold
// (comment or directive markers, statement separators, line terminators) is
// refused with the facts it would change instead of being silently altered.
// ============================================================================

import { describeMermaidFacts } from './facts.ts'
import type { ParsedDiagram } from './types.ts'

const SHOWN = 3

/** Why `reread` (the parse of the source written for `intended`) does not
 * state the same facts as `intended`, or undefined when it does. */
export function serializationDrift(intended: ParsedDiagram, reread: ParsedDiagram): string | undefined {
  let expected: string[]
  try {
    expected = describeMermaidFacts(intended)
  } catch (error) {
    return `its facts cannot be read (${error instanceof Error ? error.message : String(error)})`
  }
  const actual = describeMermaidFacts(reread)
  const have = new Set(actual)
  const want = new Set(expected)
  const lost = expected.filter(fact => !have.has(fact))
  const gained = actual.filter(fact => !want.has(fact))
  if (!lost.length && !gained.length) return undefined
  const list = (facts: string[]) => facts.slice(0, SHOWN).map(fact => JSON.stringify(fact)).join(', ') + (facts.length > SHOWN ? ` and ${facts.length - SHOWN} more` : '')
  const parts = [lost.length ? `loses ${list(lost)}` : '', gained.length ? `gains ${list(gained)}` : ''].filter(Boolean)
  return `re-reading the written Mermaid ${parts.join(' and ')}`
}
