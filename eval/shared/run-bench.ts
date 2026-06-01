// ============================================================================
// runParseVerifyRoundtrip — shared parse-verify-serialize-reparse loop.
//
// Loop 9 M9. The mermaid-docs-corpus test and the MermaidSeqBench runner had
// near-identical loops: for each row, parse → verify → serialize → re-parse →
// compare. The shape is generic; family-specific tallies (e.g. "structured
// sequence" in seqbench) live in the caller via the optional `extra` hook.
// ============================================================================

import { parseMermaid } from '../../src/agent/parse.ts'
import { serializeMermaid } from '../../src/agent/serialize.ts'
import { verifyMermaid } from '../../src/agent/verify.ts'
import type { ValidDiagram } from '../../src/agent/types.ts'

export interface RoundtripRow {
  source: string
  /** Optional label for error messages. */
  label?: string
}

export interface RoundtripCounts {
  total: number
  parseOk: number
  verifyOk: number
  roundTripStable: number
  parseErrors: string[]
}

export interface RoundtripOptions<R = unknown> {
  /** Per-row hook for caller-specific tallies (e.g. "is sequence structured"). */
  extra?: (row: RoundtripRow, diagram: ValidDiagram, acc: R) => void
  /** Initial extra-state. */
  initial?: R
}

export interface RoundtripResult<R> {
  counts: RoundtripCounts
  extra: R
}

export function runParseVerifyRoundtrip<R = undefined>(
  rows: RoundtripRow[],
  opts: RoundtripOptions<R> = {},
): RoundtripResult<R> {
  const counts: RoundtripCounts = {
    total: rows.length, parseOk: 0, verifyOk: 0, roundTripStable: 0, parseErrors: [],
  }
  const extra = (opts.initial ?? undefined) as R
  for (const r of rows) {
    const p1 = parseMermaid(r.source)
    if (!p1.ok) {
      counts.parseErrors.push((r.label ?? '') + ': ' + JSON.stringify(p1.error[0]))
      continue
    }
    counts.parseOk++
    if (verifyMermaid(p1.value).ok) counts.verifyOk++
    if (opts.extra) opts.extra(r, p1.value, extra)
    try {
      const s1 = serializeMermaid(p1.value)
      const p2 = parseMermaid(s1)
      if (p2.ok && serializeMermaid(p2.value) === s1) counts.roundTripStable++
    } catch {
      // Round-trip threw — don't count as stable; counts.roundTripStable stays.
    }
  }
  return { counts, extra }
}
