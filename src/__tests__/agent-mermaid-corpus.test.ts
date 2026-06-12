// Phase E: corpus of 258 example diagrams mined from mermaid-js's own
// syntax docs. CI gate per family: parse rate, verify rate, round-trip
// stability rate. This is the cross-family analogue of the MermaidSeqBench
// gate — but built from the source-of-truth project itself.

import { describe, test, expect } from 'bun:test'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { runParseVerifyRoundtrip } from '../../eval/shared/run-bench.ts'

const CORPUS_PATH = join(import.meta.dir, '..', '..', 'eval', 'mermaid-docs-corpus', 'corpus.json')

interface CorpusEntry { family: string; source: string; origin: string; index: number }

function loadCorpus(): CorpusEntry[] {
  if (!existsSync(CORPUS_PATH)) return []
  return JSON.parse(readFileSync(CORPUS_PATH, 'utf8'))
}

const corpus = loadCorpus()

describe('mermaid-js docs corpus (258 examples, 10 families)', () => {
  test('corpus is present', () => {
    expect(corpus.length).toBeGreaterThan(200)
  })

  // Per-family parse rate. mermaid-js's docs use some constructs we don't
  // model (e.g., direction inside subgraphs, advanced class syntax). The gate
  // is set per-family from the observed-correct baseline; regressions cause
  // CI failure.
  // Floors observed from the 247-sample baseline. Regression-only — if a
  // future change drops a rate below floor, the test fails with the full
  // rate report so it's obvious what changed.
  //
  // BUILD-19 — state diagrams now own a dedicated StateBody IR. The modeled
  // subset (simple states/transitions/`[*]`/composites/direction) round-trips
  // structurally; everything else (`<<fork>>`/`<<choice>>`/notes/`--`/
  // `classDef`) falls back to a lossless opaque body. Round-trip jumped 5% →
  // 100% (all 20 samples stable). Verify 80% (4 dense/composite samples emit
  // advisory geometric/structural warnings from the graph projection — non-
  // fatal). Floors raised to lock in the improvement.
  const expected: Record<string, { minParse: number; minVerify: number; minRoundTrip: number }> = {
    flowchart:    { minParse: 1.00, minVerify: 1.00, minRoundTrip: 0.95 },
    state:        { minParse: 1.00, minVerify: 0.80, minRoundTrip: 1.00 },
    sequence:     { minParse: 1.00, minVerify: 1.00, minRoundTrip: 1.00 },
    class:        { minParse: 1.00, minVerify: 1.00, minRoundTrip: 1.00 },
    er:           { minParse: 1.00, minVerify: 1.00, minRoundTrip: 1.00 },
    timeline:     { minParse: 1.00, minVerify: 1.00, minRoundTrip: 1.00 },
    journey:      { minParse: 1.00, minVerify: 1.00, minRoundTrip: 1.00 },
    xychart:      { minParse: 1.00, minVerify: 1.00, minRoundTrip: 1.00 },
    architecture: { minParse: 1.00, minVerify: 1.00, minRoundTrip: 1.00 },
    // Gantt entries were appended from syntax/gantt.md (11 unique examples,
    // deduped — the docs repeat each rendered example) alongside the upstream
    // test-suite bench in eval/mermaid-gantt-bench/. Verify floor 0.80 (9/11):
    // one docs entry is a directive-only fragment (no tasks → EMPTY_DIAGRAM,
    // correct since rendering throws GANTT_EMPTY), and one ends a task with an
    // inline `%% not yet official` comment that even upstream only "renders"
    // via its wall-clock fallback (ledger entry e9 in the gantt bench) — ours
    // reports UNRESOLVABLE_SCHEDULE by name. Same honest-fragment class as the
    // state-family floor; round-trip stays lossless for both.
    gantt:        { minParse: 1.00, minVerify: 0.80, minRoundTrip: 1.00 },
  }

  for (const family of Object.keys(expected)) {
    const entries = corpus.filter(e => e.family === family)
    if (entries.length === 0) continue

    test(`${family}: ${entries.length} examples — parse / verify / round-trip rates`, () => {
      // Loop 9 M9: shared parse-verify-roundtrip helper. Counts identical.
      const { counts } = runParseVerifyRoundtrip(entries.map(e => ({ source: e.source, label: e.origin })))
      const parseOk = counts.parseOk
      const verifyOk = counts.verifyOk
      const roundTripOk = counts.roundTripStable
      const N = entries.length
      const ex = expected[family]!
      // Report as helpful failure message
      const summary = {
        family,
        N,
        parse: `${parseOk}/${N} (${(parseOk / N * 100).toFixed(0)}%)`,
        verify: `${verifyOk}/${N} (${(verifyOk / N * 100).toFixed(0)}%)`,
        roundTrip: `${roundTripOk}/${N} (${(roundTripOk / N * 100).toFixed(0)}%)`,
      }
      // Floor each rate at the expected minimum to catch regressions.
      const checks = {
        parseFloor: parseOk / N >= ex.minParse,
        verifyFloor: verifyOk / N >= ex.minVerify,
        roundTripFloor: roundTripOk / N >= ex.minRoundTrip,
      }
      expect({ ...summary, checks }).toEqual({
        ...summary,
        checks: { parseFloor: true, verifyFloor: true, roundTripFloor: true },
      })
    })
  }
})
