// Phase E: corpus of 271 example diagrams mined from mermaid-js's own
// syntax docs. CI gate per family: parse rate, verify rate, round-trip
// stability rate. This is the cross-family analogue of the MermaidSeqBench
// gate — but built from the source-of-truth project itself.

import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runParseVerifyRoundtrip } from '../../eval/shared/run-bench.ts'
import { countStructuralElements } from '../../eval/shared/structural-count.ts'
import { parseRegisteredMermaid as parseMermaid, serializeMermaid, verifyMermaid } from '../agent/index.ts'
import { isDrop } from '../agent/structural-count.ts'

const CORPUS_PATH = join(import.meta.dir, '..', '..', 'eval', 'mermaid-docs-corpus', 'corpus.json')
const DIVERGENCES_PATH = join(import.meta.dir, '..', '..', 'eval', 'mermaid-docs-corpus', 'divergences.json')
const PROVENANCE_PATH = join(import.meta.dir, '..', '..', 'eval', 'mermaid-docs-corpus', 'provenance.json')

interface CorpusEntry {
  family: string
  source: string
  origin: string
  index: number
}
interface CorpusDivergence {
  id: string
  family: string
  origin: string
  indices: number[]
  reason: string
  expectedWarningCodes: string[]
  upstreamBehavior: string
  notes?: string
}

function loadCorpus(): CorpusEntry[] {
  if (!existsSync(CORPUS_PATH)) return []
  return JSON.parse(readFileSync(CORPUS_PATH, 'utf8'))
}

function loadDivergences(): CorpusDivergence[] {
  if (!existsSync(DIVERGENCES_PATH)) return []
  return JSON.parse(readFileSync(DIVERGENCES_PATH, 'utf8'))
}

const corpus = loadCorpus()
const divergences = loadDivergences()

function corpusKey(entry: Pick<CorpusEntry, 'family' | 'origin' | 'index'>): string {
  return `${entry.family}:${entry.origin}#${entry.index}`
}

const divergenceKeys = new Set(divergences.flatMap(d => d.indices.map(index => corpusKey({ family: d.family, origin: d.origin, index }))))

describe('mermaid-js legacy docs corpus (271 examples, 12 families)', () => {
  test('corpus is present with the expected family coverage', () => {
    expect(corpus.length).toBe(271)
    expect(new Set(corpus.map(entry => entry.family))).toEqual(new Set(Object.keys(expected)))
  })

  test('records exact upstream provenance and the real imbalanced distribution', () => {
    const provenance = JSON.parse(readFileSync(PROVENANCE_PATH, 'utf8')) as {
      upstream: { repository: string; revision: string }
      entries: number
      familyCounts: Record<string, number>
      scope: string
      companions: string[]
    }
    const actualCounts = Object.fromEntries([...new Set(corpus.map(entry => entry.family))].sort().map(family => [family, corpus.filter(entry => entry.family === family).length]))
    expect(provenance.upstream).toEqual({
      repository: 'https://github.com/mermaid-js/mermaid',
      revision: 'a2d9686451df7c4644a3eeca20535bbd4c5776b0',
    })
    expect(provenance.entries).toBe(corpus.length)
    expect(provenance.familyCounts).toEqual(actualCounts)
    expect(provenance.scope).toContain('not the complete registered-family inventory')
    expect(provenance.companions.length).toBeGreaterThanOrEqual(3)
  })

  // Per-family parse rate. mermaid-js's docs use some constructs we don't
  // model or intentionally warn on.
  // The gate is set per-family from the observed-correct baseline; regressions
  // cause CI failure.
  // Floors observed from the docs-corpus baseline. Regression-only — if a
  // future change drops a rate below floor, the test fails with the full
  // rate report so it's obvious what changed.
  //
  // BUILD-19 — state diagrams now own a dedicated StateBody IR. BUILD-20
  // tightened nested pseudostate endpoint projection, so the docs examples now
  // parse, verify, and round-trip at 100%. Floors stay at the observed green
  // baseline to catch regressions.
  const expected: Record<string, { minParse: number; minVerify: number; minRoundTrip: number }> = {
    flowchart: { minParse: 1.0, minVerify: 1.0, minRoundTrip: 1.0 },
    state: { minParse: 1.0, minVerify: 1.0, minRoundTrip: 1.0 },
    sequence: { minParse: 1.0, minVerify: 1.0, minRoundTrip: 1.0 },
    class: { minParse: 1.0, minVerify: 1.0, minRoundTrip: 1.0 },
    er: { minParse: 1.0, minVerify: 1.0, minRoundTrip: 1.0 },
    timeline: { minParse: 1.0, minVerify: 1.0, minRoundTrip: 1.0 },
    journey: { minParse: 1.0, minVerify: 1.0, minRoundTrip: 1.0 },
    xychart: { minParse: 1.0, minVerify: 1.0, minRoundTrip: 1.0 },
    // Align directives (upstream v11.16.0) parse, verify, round-trip, and now
    // constrain geometry; all official examples remain green.
    architecture: { minParse: 1.0, minVerify: 1.0, minRoundTrip: 1.0 },
    pie: { minParse: 1.0, minVerify: 1.0, minRoundTrip: 1.0 },
    quadrant: { minParse: 1.0, minVerify: 1.0, minRoundTrip: 1.0 },
    // Gantt entries were appended from syntax/gantt.md (11 unique examples,
    // deduped — the docs repeat each rendered example) alongside the upstream
    // test-suite bench in eval/mermaid-gantt-bench/. Two explicit verify failures:
    // one docs entry is a directive-only fragment (no tasks → EMPTY_DIAGRAM,
    // rendered as an explicit empty template), and one ends a task with an
    // inline `%% not yet official` comment that even upstream only "renders"
    // via its wall-clock fallback (ledger entry e9 in the gantt bench) — ours
    // reports UNRESOLVABLE_SCHEDULE by name. Same honest-fragment class as the
    // lossless-fragment contract; round-trip stays lossless for both.
    gantt: { minParse: 1.0, minVerify: 9 / 11, minRoundTrip: 1.0 },
  }

  test.skipIf(divergences.length === 0)('divergence entries preserve their declared source behavior', () => {
    for (const d of divergences) {
      for (const index of d.indices) {
        const entry = corpus.find(e => e.family === d.family && e.origin === d.origin && e.index === index)
        expect({ id: d.id, index, present: Boolean(entry) }).toEqual({ id: d.id, index, present: true })
        if (!entry) continue
        const parsed = parseMermaid(entry.source)
        expect({ id: d.id, index, parsed: parsed.ok }).toEqual({ id: d.id, index, parsed: true })
        if (!parsed.ok) continue
        const verify = verifyMermaid(parsed.value)
        for (const code of d.expectedWarningCodes) {
          expect({ id: d.id, index, code, present: verify.warnings.some(w => w.code === code) }).toEqual({ id: d.id, index, code, present: true })
        }
        const s1 = serializeMermaid(parsed.value)
        const reparsed = parseMermaid(s1)
        expect({ id: d.id, index, reparsed: reparsed.ok }).toEqual({ id: d.id, index, reparsed: true })
        if (reparsed.ok) expect(serializeMermaid(reparsed.value)).toBe(s1)
      }
    }
  })

  test('non-Gantt docs-corpus divergences cannot be unledgered', () => {
    for (const entry of corpus.filter(e => e.family !== 'gantt')) {
      const parsed = parseMermaid(entry.source)
      const key = corpusKey(entry)
      if (!parsed.ok) {
        expect({ key, ledgered: divergenceKeys.has(key), reason: 'parse' }).toEqual({ key, ledgered: true, reason: 'parse' })
        continue
      }
      const verify = verifyMermaid(parsed.value)
      const s1 = serializeMermaid(parsed.value)
      const reparsed = parseMermaid(s1)
      const stable = reparsed.ok && serializeMermaid(reparsed.value) === s1
      if (!verify.ok || !stable) {
        expect({ key, ledgered: divergenceKeys.has(key), verifyOk: verify.ok, stable }).toEqual({ key, ledgered: true, verifyOk: verify.ok, stable })
      }
    }
  })

  // Faithfulness count-oracle (Loop 17: "100% parse success is not
  // faithfulness"). Round-trip byte-stability proves serialize∘parse is
  // idempotent; it does NOT prove parse preserved the source's content. This
  // gate asserts the structured {nodes, edges, groups} tally survives a
  // parse → serialize → re-parse cycle for EVERY renderable family, so a
  // silently-dropped relationship (the ER `}o` class of bug) fails CI even
  // when the bytes round-trip cleanly. Opaque bodies (no structured arrays)
  // are covered by the round-trip-stability gate and skipped here.
  test('faithfulness: structured element counts survive round-trip (all families)', () => {
    const drops: Array<{ key: string; before: unknown; after: unknown }> = []
    for (const entry of corpus) {
      const p1 = parseMermaid(entry.source)
      if (!p1.ok) continue // parse-rate floors above own parse failures
      const before = countStructuralElements(p1.value)
      if (!before) continue // opaque — round-trip-stability gate owns it
      let after: ReturnType<typeof countStructuralElements> = null
      try {
        const p2 = parseMermaid(serializeMermaid(p1.value))
        if (p2.ok) after = countStructuralElements(p2.value)
      } catch {
        /* falls through to drop record */
      }
      // Route through the one tested verdict (faithfulnessWarning) so all three
      // differential gates share identical drop semantics. `before` is non-null
      // here; a null `after` is reported as total loss by the helper.
      if (isDrop(before, after)) {
        drops.push({ key: corpusKey(entry), before, after })
      }
    }
    expect(drops).toEqual([])
  })

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
        parse: `${parseOk}/${N} (${((parseOk / N) * 100).toFixed(0)}%)`,
        verify: `${verifyOk}/${N} (${((verifyOk / N) * 100).toFixed(0)}%)`,
        roundTrip: `${roundTripOk}/${N} (${((roundTripOk / N) * 100).toFixed(0)}%)`,
      }
      // Gantt documentation includes an empty fragment and raw themeCSS that
      // the public security boundary rejects. Check each verdict
      // independently so an improvement cannot hide another example regressing.
      if (family === 'gantt') {
        const rejected: Record<string, 'EMPTY_DIAGRAM' | 'RENDER_FAILED'> = {
          'gantt:syntax/gantt.md#6': 'EMPTY_DIAGRAM',
          'gantt:syntax/gantt.md#10': 'RENDER_FAILED',
        }
        expect(entries.filter(entry => corpusKey(entry) in rejected)).toHaveLength(2)
        for (const entry of entries) {
          const result = verifyMermaid(entry.source)
          const warning = rejected[corpusKey(entry)]
          expect({ key: corpusKey(entry), ok: result.ok }).toEqual({ key: corpusKey(entry), ok: warning === undefined })
          if (warning) expect(result.warnings.map(value => value.code)).toContain(warning)
          if (corpusKey(entry) === 'gantt:syntax/gantt.md#10') {
            expect(result.warnings).toContainEqual(expect.objectContaining({
              code: 'RENDER_FAILED', reason: expect.stringContaining('Raw Mermaid themeCSS is not allowed'), origin: 'config',
            }))
          }
        }
      }
      // Floor each all-green rate at the expected minimum to catch regressions.
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
