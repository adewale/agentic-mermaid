// Property fuzz for the CLI package surface a consumer actually drives through
// the `am` bin: the argv parser and the `am batch --jsonl` line handler. The
// engine parsers are fuzzed by property-crash-freedom.test.ts; this file closes
// the gap that the *CLI contract* (arg parsing + per-line batch robustness) had
// no generated-input coverage. Seed is pinned globally (fc-seed.preload.ts).
import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'
import { fcParameters } from './helpers/fc-parameters.ts'

import { parseArgs, runBatchLine, renderMarkdownBlocks, FLAG_SPECS } from '../cli/index.ts'
import { extractMermaidFences } from '../cli/markdown-fences.ts'
import { BOOLEAN_FLAGS } from '../cli/args.ts'
import { renderMermaidASCII, renderMermaidSVG } from '../index.ts'

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
        expect(parsed.errors.every(error => typeof error === 'string')).toBe(true)
      }),
      fcParameters({ numRuns: NUM_RUNS }),
    )
  })

  // argv values are arbitrary OS strings; `=` inside a value is data (the
  // name ends at the first `=`).
  const argValueArb = fc.string({ unit: 'grapheme', maxLength: 20 })

  it('binds `--flag=value` verbatim when trailing junk is positional', () => {
    // Positional tokens (no `--` prefix) never touch `flags`, so the bound value
    // must survive them.
    const positionalNoiseArb = fc.array(fc.string({ unit: 'grapheme', maxLength: 12 }).filter(s => !s.startsWith('--')), { maxLength: 6 })
    fc.assert(
      fc.property(fc.constantFrom(...flagNames), argValueArb, positionalNoiseArb, (flag, value, noise) => {
        const parsed = parseArgs([`--${flag}=${value}`, ...noise])
        expect(parsed.flags[flag]).toBe(value)
      }),
      fcParameters({ numRuns: NUM_RUNS }),
    )
  })

  it('a repeated flag keeps its first value and is reported exactly once per repeat', () => {
    fc.assert(
      fc.property(fc.constantFrom(...flagNames), fc.array(argValueArb, { minLength: 2, maxLength: 4 }), (flag, values) => {
        const parsed = parseArgs(values.map(value => `--${flag}=${value}`))
        expect(parsed.flags[flag]).toBe(values[0])
        expect(parsed.errors.filter(error => error === `Flag --${flag} may be supplied only once.`)).toHaveLength(values.length - 1)
      }),
      fcParameters({ numRuns: NUM_RUNS }),
    )
  })

  it('a value given to a boolean flag is reported, and only boolean flags report it', () => {
    fc.assert(
      fc.property(fc.constantFrom(...flagNames), argValueArb, (flag, value) => {
        const parsed = parseArgs([`--${flag}=${value}`])
        expect(parsed.errors).toEqual(BOOLEAN_FLAGS.has(flag) ? [`Flag --${flag} does not accept a value.`] : [])
      }),
      fcParameters({ numRuns: NUM_RUNS }),
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
      fcParameters({ numRuns: NUM_RUNS }),
    )
  })

  it('a valid render line returns exactly what the library renders for that line', () => {
    const labelArb = fc.string({ unit: 'grapheme', minLength: 1, maxLength: 8 }).filter(label => /^[\p{L}\p{N} ]+$/u.test(label) && label.trim() === label)
    const sourceArb = fc.array(labelArb, { minLength: 1, maxLength: 4 })
      .map(labels => `flowchart LR\n${labels.map((label, i) => `  n${i}["${label}"]${i > 0 ? `\n  n${i - 1} --> n${i}` : ''}`).join('\n')}`)
    fc.assert(
      fc.property(sourceArb, fc.integer({ min: 0, max: 999 }), fc.constantFrom('svg', 'ascii', 'unicode'), (source, idx, format) => {
        const out = runBatchLine(JSON.stringify({ op: 'render', source, options: { format } }), idx)
        expect(out).toMatchObject({ ok: true, op: 'render' })
        const expected = format === 'svg'
          ? renderMermaidSVG(source, { idPrefix: `d${idx}-` })
          : renderMermaidASCII(source, { useAscii: format === 'ascii' })
        expect((out as { data: Record<string, unknown> }).data[format]).toBe(expected)
      }),
      fcParameters({ numRuns: 40 }),
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

  it('batch mutate preserves empty diagnostics on intentional removal', () => {
    const result = runBatchLine(JSON.stringify({
      op: 'mutate',
      source: 'flowchart TD\n  A[Only]',
      mutation: { kind: 'remove_node', id: 'A' },
    }))
    expect(result).toMatchObject({
      ok: true,
      data: { source: 'flowchart TD\n', verify: { ok: false, warnings: [{ code: 'EMPTY_DIAGRAM' }] } },
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
  it('never throws and returns tagged results for arbitrary markdown', () => {
    const mdArb = fc.oneof(
      fc.string({ maxLength: 200 }),
      specialCharStringArb,
    )
    fc.assert(
      fc.property(mdArb, fc.constantFrom('svg', 'ascii' as const), (md, format) => {
        const blocks = renderMarkdownBlocks(md, format)
        expect(Array.isArray(blocks)).toBe(true)
        for (const b of blocks) {
          expect(typeof b.ok).toBe('boolean')
        }
      }),
      fcParameters({ numRuns: NUM_RUNS }),
    )
  })

  it('returns exactly one tagged result for a single fenced block, whatever its body', () => {
    // A body without a backtick can neither close the fence early nor open
    // another, so the document holds exactly one mermaid block.
    const fencedArb = fc.string({ maxLength: 80 })
      .filter(body => !body.includes('`'))
      .map(body => '```mermaid\n' + body + '\n```')
    fc.assert(
      fc.property(fencedArb, fc.constantFrom('svg', 'ascii' as const), (md, format) => {
        const blocks = renderMarkdownBlocks(md, format)
        expect({ md, tags: blocks.map(b => typeof b.ok) }).toEqual({ md, tags: ['boolean'] })
      }),
      fcParameters({ numRuns: NUM_RUNS }),
    )
  })

  it('extracts exactly the CommonMark mermaid fences of composed documents, with content and opening line', () => {
    // Documents are composed from segments whose CommonMark reading is known by
    // construction: mermaid fences (either fence character, length 3-5, any
    // info-string casing or attributes, 0-3 columns of indentation, closing
    // fences longer than or as long as the opening one), other fences whose
    // bodies hold mermaid-fence lines, indented code and HTML comments holding
    // a mermaid fence, and prose. Each segment may sit in a block quote, a
    // list item, or one nested in the other. The expected blocks come from the
    // segment model, never from the scanner.
    type Segment = { lines: readonly string[]; fence?: { body: readonly string[]; indent: number } }
    type Container = 'quote' | '-' | '*' | '1.' | '10)'
    const prefixedBody = (lines: readonly string[]) =>
      fc.array(fc.tuple(fc.constantFrom(...lines), fc.integer({ min: 0, max: 5 })), { maxLength: 5 })
        .map(entries => entries.map(([line, indent]) => (line === '' ? '' : ' '.repeat(indent) + line)))
    const mermaidFence = fc.record({
      char: fc.constantFrom('`', '~'),
      length: fc.integer({ min: 3, max: 5 }),
      indent: fc.integer({ min: 0, max: 3 }),
      info: fc.constantFrom('mermaid', 'Mermaid', 'MERMAID', ' mermaid', 'mermaid title="x"', 'mermaid\t{init}'),
      closeLength: fc.integer({ min: 0, max: 2 }),
      closeIndent: fc.integer({ min: 0, max: 3 }),
      closeTrail: fc.constantFrom('', '  '),
      // Lines that look like block syntax but are content inside a fence: a
      // fence of the other character, a shorter run of the same character, a
      // fence opener carrying an info string, container and HTML markers.
      body: prefixedBody(['flowchart TD', 'A --> B', '', 'A["``"] --> B', '``', '~~', '```mermaid', '> quoted', '- dash', '<!--', '%% note']),
    }).map(f => ({
      ...f,
      body: [...f.body, ...(f.length > 3 ? [f.char.repeat(f.length - 1)] : []), f.char === '`' ? '~~~' : '```'],
    }))
    const segment = (closed: boolean): fc.Arbitrary<Segment> => fc.oneof(
      mermaidFence.map(f => ({
        lines: [
          ' '.repeat(f.indent) + f.char.repeat(f.length) + f.info,
          ...f.body,
          ...(closed ? [' '.repeat(f.closeIndent) + f.char.repeat(f.length + f.closeLength) + f.closeTrail] : []),
        ],
        fence: { body: f.body, indent: f.indent },
      })),
      fc.record({ fence: fc.constantFrom('```', '~~~', '````'), info: fc.constantFrom('', 'js', 'mermaidx', 'text mermaid') })
        .map(({ fence, info }) => ({ lines: [fence + info, '```mermaid', 'A --> B', '~~~mermaid', fence] })),
      fc.constant({ lines: ['    ```mermaid', '    A --> B', '    ```'] }),
      // An HTML comment ends at the first line containing `-->`, so its fence
      // body must avoid flowchart arrows.
      fc.constant({ lines: ['<!--', '```mermaid', 'A --- B', '```', '-->'] }),
      fc.constantFrom({ lines: ['Prose with ``` inside.'] }, { lines: ['# Heading'] }),
    )
    const wrap = (lines: readonly string[], container: Container): { lines: readonly string[]; shift: number } => {
      if (container === 'quote') return { lines: lines.map(line => (line === '' ? '>' : `> ${line}`)), shift: 0 }
      const indent = (line: string) => (line === '' ? '' : ' '.repeat(container.length + 1) + line)
      // A marker shares the first line only when that line is unindented, so
      // the item's content column stays marker width + 1.
      if (!/^\s/.test(lines[0]!)) return { lines: [`${container} ${lines[0]}`, ...lines.slice(1).map(indent)], shift: 0 }
      return { lines: [`${container} item`, ...lines.map(indent)], shift: 1 }
    }
    const containers = fc.array(fc.constantFrom<Container>('quote', '-', '*', '1.', '10)'), { maxLength: 2 })
    const doc = fc.record({
      parts: fc.array(fc.tuple(segment(true), containers), { maxLength: 6 }),
      last: fc.option(fc.tuple(segment(false), containers)),
      newline: fc.constantFrom('\n', '\r\n'),
      trailingNewline: fc.boolean(),
    })
    fc.assert(
      fc.property(doc, ({ parts, last, newline, trailingNewline }) => {
        const lines: string[] = []
        const expected: Array<{ source: string; line: number }> = []
        for (const [index, [seg, nest]] of [...parts, ...(last ? [last] : [])].entries()) {
          if (index > 0) lines.push('', 'Separator paragraph.', '')
          let wrapped = { lines: seg.lines, shift: 0 }
          for (const container of nest) {
            const next = wrap(wrapped.lines, container)
            wrapped = { lines: next.lines, shift: wrapped.shift + next.shift }
          }
          if (seg.fence) {
            const { body, indent } = seg.fence
            const strip = (line: string) => line.slice(Math.min(indent, /^ */.exec(line)![0].length))
            expected.push({ source: body.map(strip).join('\n'), line: lines.length + wrapped.shift + 1 })
          }
          lines.push(...wrapped.lines)
        }
        const md = lines.join(newline) + (trailingNewline ? newline : '')
        expect({ md, blocks: extractMermaidFences(md) }).toEqual({ md, blocks: expected })
      }),
      fcParameters({ numRuns: 2000 }),
    )
  })
})
