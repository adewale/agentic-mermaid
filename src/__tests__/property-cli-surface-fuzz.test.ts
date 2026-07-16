// Property fuzz for the CLI package surface a consumer actually drives through
// the `am` bin: the argv parser and the `am batch --jsonl` line handler. The
// engine parsers are fuzzed by property-crash-freedom.test.ts; this file closes
// the gap that the *CLI contract* (arg parsing + per-line batch robustness) had
// no generated-input coverage. Seed is pinned globally (fc-seed.preload.ts).
import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'

import { parseArgs, runBatchLine, renderMarkdownBlocks, FLAG_SPECS } from '../cli/index.ts'

const NUM_RUNS = 300

// Characters that tend to trip tokenizers / JSON parsers (mirrors the set in
// property-crash-freedom.test.ts so both suites probe the same rough edges).
const SPECIAL_CHARS = [
  '[', ']', '{', '}', '(', ')', '<', '>', '|', ':', ';', '-', '=',
  '.', ',', '!', '?', '@', '#', '$', '%', '^', '&', '*', '+', '~',
  '`', '"', "'", '\\', '/', '\n', '\r', '\t', ' ',
  '\0', '￿', '​', 'é', '☃',
]
const specialCharStringArb = fc
  .array(fc.constantFrom(...SPECIAL_CHARS), { maxLength: 60 })
  .map(chars => chars.join(''))

const flagNames = Object.keys(FLAG_SPECS)

/** argv tokens: real flags (bare + `=value`), `--` short-circuits, and junk. */
const argTokenArb = fc.oneof(
  fc.constantFrom(...flagNames).map(f => `--${f}`),
  fc.constantFrom(...flagNames).chain(f => fc.string({ maxLength: 12 }).map(v => `--${f}=${v}`)),
  fc.constantFrom('render', 'verify', 'mutate', 'batch', 'capabilities', 'llms-txt', 'describe'),
  fc.string({ maxLength: 16 }),
  specialCharStringArb,
)
const argvArb = fc.array(argTokenArb, { maxLength: 12 })

// ===========================================================================
// parseArgs — a total function: arg parsing must never throw and must always
// return a well-formed { command?, positional, flags } record.
// ===========================================================================

describe('cli-surface fuzz: parseArgs', () => {
  it('is total — never throws and returns a well-formed shape for any argv', () => {
    fc.assert(
      fc.property(argvArb, (argv) => {
        const parsed = parseArgs(argv)
        expect(Array.isArray(parsed.positional)).toBe(true)
        expect(typeof parsed.flags).toBe('object')
        expect(parsed.flags).not.toBeNull()
        // command is the first non-`--` token, or absent.
        expect(parsed.command === undefined || typeof parsed.command === 'string').toBe(true)
        // every flag value is a string or the boolean `true` (never other types).
        for (const v of Object.values(parsed.flags)) {
          expect(typeof v === 'string' || v === true).toBe(true)
        }
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it('binds `--flag=value` verbatim when trailing junk is positional', () => {
    // Positional tokens (no `--` prefix) never touch `flags`, so the bound value
    // must survive them. (parseArgs is last-write-wins, so junk that *re-sets*
    // the same flag legitimately overrides it — not tested here.)
    const positionalNoiseArb = fc.array(fc.string({ maxLength: 12 }).filter(s => !s.startsWith('--')), { maxLength: 6 })
    fc.assert(
      fc.property(
        fc.constantFrom(...flagNames),
        fc.string({ maxLength: 20 }).filter(v => !v.includes('=')),
        positionalNoiseArb,
        (flag, value, noise) => {
          const parsed = parseArgs([`--${flag}=${value}`, ...noise])
          expect(parsed.flags[flag]).toBe(value)
        },
      ),
      { numRuns: NUM_RUNS },
    )
  })
})

// ===========================================================================
// runBatchLine — the `am batch --jsonl` per-line handler. Its documented
// contract is: malformed lines surface a structured error but never throw
// (so one bad line can't abort the stream).
// ===========================================================================

const batchLineArb = fc.oneof(
  fc.string({ maxLength: 120 }),
  specialCharStringArb,
  // Structured-but-arbitrary JSON payloads, incl. missing/garbage `op`.
  fc.record({
    op: fc.oneof(fc.constantFrom('render', 'verify', 'parse', 'serialize', 'mutate'), fc.string({ maxLength: 8 })),
    source: fc.oneof(fc.string({ maxLength: 80 }), specialCharStringArb),
  }, { requiredKeys: [] }).map(o => JSON.stringify(o)),
  // Valid op + syntactically-plausible-but-random flowchart source.
  fc.record({
    op: fc.constant('render'),
    source: fc.constantFrom('flowchart TD', 'sequenceDiagram', 'stateDiagram-v2').chain(
      h => fc.string({ maxLength: 60 }).map(b => `${h}\n${b}`),
    ),
  }).map(o => JSON.stringify(o)),
)

describe('cli-surface fuzz: runBatchLine', () => {
  it('never throws and always returns a tagged {ok} result', () => {
    fc.assert(
      fc.property(batchLineArb, fc.integer({ min: 0, max: 999 }), (line, idx) => {
        const out = runBatchLine(line, idx)
        expect(out).toBeDefined()
        expect(typeof out.ok).toBe('boolean')
        // A failed line must carry a structured error code — never a bare throw
        // or an unlabeled failure.
        if (!out.ok) {
          expect(typeof out.error?.code).toBe('string')
          expect((out.error?.code ?? '').length).toBeGreaterThan(0)
          expect(out.error?.code).not.toBe('INTERNAL')
        }
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it('classifies malformed current-op envelopes as invalid payload/options', () => {
    for (const op of ['render', 'verify', 'parse', 'serialize', 'mutate']) {
      expect(runBatchLine(JSON.stringify({ op }))).toMatchObject({
        ok: false,
        error: { code: 'INVALID_PAYLOAD' },
      })
    }
    for (const options of [
      1, [], null, { suppress: 1 }, { suppress: ['NOT_A_WARNING'] },
      { labelCharCap: '40' }, { labelCharCap: 0 }, { unknown: true },
    ]) {
      expect(runBatchLine(JSON.stringify({
        op: 'verify',
        source: 'flowchart TD\n  A --> B',
        options,
      }))).toMatchObject({ ok: false, error: { code: 'INVALID_OPTIONS' } })
    }
  })

  it('honours -- as an argv option terminator', () => {
    expect(parseArgs(['render', '--', '--looks-like-a-flag'])).toEqual({
      command: 'render',
      positional: ['--looks-like-a-flag'],
      flags: {},
      errors: [],
    })
  })

  it('batch mutate preserves verify diagnostics on rejected commits', () => {
    const result = runBatchLine(JSON.stringify({
      op: 'mutate',
      source: 'flowchart TD\n  A[Only]',
      mutation: { kind: 'remove_node', id: 'A' },
    }))
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'VERIFY_FAILED', details: [{ code: 'EMPTY_DIAGRAM' }] },
      verify: { ok: false, warnings: [{ code: 'EMPTY_DIAGRAM' }] },
    })
  })

  it('batch mutate requires exactly one well-shaped singular or plural op field', () => {
    const source = 'flowchart TD\n  A --> B'
    const mutation = { kind: 'set_label', target: 'A', label: 'Changed' }
    for (const payload of [
      { op: 'mutate', source },
      { op: 'mutate', source, mutation, mutations: [mutation] },
      { op: 'mutate', source, mutations: 'not-an-array' },
      { op: 'mutate', source, mutations: [] },
    ]) {
      expect(runBatchLine(JSON.stringify(payload))).toMatchObject({
        ok: false,
        error: { code: 'INVALID_OP' },
      })
    }
    expect(runBatchLine(JSON.stringify({ op: 'mutate', source, mutation }))).toMatchObject({ ok: true })
    expect(runBatchLine(JSON.stringify({ op: 'mutate', source, mutations: [mutation] }))).toMatchObject({ ok: true })
  })

  it('batch verify projects a rejected verdict at the top-level envelope', () => {
    expect(runBatchLine(JSON.stringify({
      op: 'verify',
      source: 'flowchart TD',
    }))).toMatchObject({
      ok: false,
      error: { code: 'VERIFY_FAILED', details: [{ code: 'EMPTY_DIAGRAM' }] },
      verify: { ok: false, warnings: [{ code: 'EMPTY_DIAGRAM' }] },
    })
  })
})

// ===========================================================================
// renderMarkdownBlocks — `am render-markdown`. Skips invalid diagrams, never
// aborts the file; a malformed doc must still yield a per-block array.
// ===========================================================================

describe('cli-surface fuzz: renderMarkdownBlocks', () => {
  it('never throws and returns one tagged result per fenced block', () => {
    const mdArb = fc.oneof(
      fc.string({ maxLength: 200 }),
      specialCharStringArb,
      fc.string({ maxLength: 80 }).map(body => '```mermaid\n' + body + '\n```'),
    )
    fc.assert(
      fc.property(mdArb, fc.constantFrom('svg', 'ascii' as const), (md, format) => {
        const blocks = renderMarkdownBlocks(md, format)
        expect(Array.isArray(blocks)).toBe(true)
        for (const b of blocks) {
          expect(typeof b.ok).toBe('boolean')
        }
      }),
      { numRuns: NUM_RUNS },
    )
  })
})
