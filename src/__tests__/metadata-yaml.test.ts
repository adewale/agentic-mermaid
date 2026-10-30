// `@{…}` metadata and frontmatter share one YAML reader
// (src/shared/metadata-yaml.ts). The oracle is pinned upstream Mermaid,
// which reads all three with js-yaml's JSON_SCHEMA behind a lexer that
// decides where a `@{…}` block ends.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import fc from 'fast-check'
import { fcParameters } from './helpers/fc-parameters.ts'
import { parseRegisteredMermaid, serializeMermaid, verifyMermaid } from '../agent/index.ts'
import { renderMermaidSVG } from '../index.ts'
import { mermaidFirstLine } from '../mermaid-source-wrapper.ts'
import { normalizeMermaidSource } from '../mermaid-source.ts'
import { parseMermaid } from '../parser.ts'
import { parseSequenceDiagram } from '../sequence/parser.ts'
import { splitSequenceStatementLines } from '../sequence/statements.ts'
import { toEntityMarkers } from '../shared/mermaid-entities.ts'
import { coalesceFlowchartLines } from '../flowchart-lexer.ts'
import {
  metadataText,
  parseMetadataBody,
  protectMetadataEntities,
  quoteMetadataString,
  readMetadataBlock,
} from '../shared/metadata-yaml.ts'
import { scanMetadataBlock } from '../shared/metadata-block-scan.ts'
import { parseMermaidYaml, stringifyMermaidYaml } from '../shared/mermaid-yaml.ts'
import { startUpstreamMermaid, type UpstreamMermaid } from './helpers/upstream-mermaid.ts'

describe('parseMermaidYaml resolves plain scalars as js-yaml JSON_SCHEMA does', () => {
  test('numbers, booleans and null, including js-yaml\'s `0b` and signed hex forms', () => {
    const cases: Array<[string, unknown]> = [
      ['0b11', 3], ['1_000', '1_000'], ['-0x1F', -31], ['0o17', 15], ['+12', 12], ['00_1', '00_1'], ['0_1', '0_1'], ['1_000.5', '1_000.5'],
      ['1_0', '1_0'], ['0b1_0', '0b1_0'], ['1e999', '1e999'], ['9'.repeat(400), '9'.repeat(400)],
      ['1e5', 100000], ['.5e3', 500], ['1.', 1], ['+.inf', Number.POSITIVE_INFINITY], ['True', true], ['FALSE', false],
      ['~', null], ['Null', null], ['-.5', '-.5'], ['1_', '1_'], ['0x_', '0x_'], ['0B1', '0B1'], ['yes', 'yes'],
    ]
    expect(cases.map(([scalar]) => {
      const parsed = parseMermaidYaml(`v: ${scalar}`)
      return [scalar, parsed.ok ? (parsed.value as { v: unknown }).v : parsed.message]
    })).toEqual(cases)
    expect(Number.isNaN((parseMermaidYaml('v: .NaN') as { value: { v: number } }).value.v)).toBe(true)
  })

  test('errors and unknown tags fail; a writer quotes every string that would not read back', () => {
    for (const bad of ['a: [unclosed', 'a: 1\na: 2', 'a: !foo x', 'a: b: c', 'a: |#c\n  x', 'a: !!int 1_0', 'a: !!float 1e999', `a: !!int ${'9'.repeat(400)}`]) {
      expect({ bad, ok: parseMermaidYaml(bad).ok }).toEqual({ bad, ok: false })
    }
    // js-yaml takes a `#` straight after `,` or a quoted scalar as a comment.
    expect(parseMermaidYaml('{\na: x,#c\n}')).toEqual({ ok: true, value: { a: 'x' } })
    expect(parseMermaidYaml('a: "x"#c')).toEqual({ ok: true, value: { a: 'x' } })
    const strings = fc.array(fc.constantFrom('0b1', '1_0', '-0x1', 'true', 'Null', '~', '.inf', '1e3', 'a', ' ', ':', '#', '"', "'", '\\', '\n', '\r', '\t'), { maxLength: 5 })
      .map(parts => parts.join(''))
    fc.assert(fc.property(strings, text => {
      const parsed = parseMermaidYaml(stringifyMermaidYaml({ title: text }))
      expect({ text, read: parsed.ok ? (parsed.value as { title: unknown }).title : parsed.message }).toEqual({ text, read: text })
    }), fcParameters({ numRuns: 300 }))
  })

  test('a string whose first line is only spaces survives the YAML writer', () => {
    const parsed = parseMermaidYaml(stringifyMermaidYaml({ title: ' \n' }))
    expect(parsed).toEqual({ ok: true, value: { title: ' \n' } })
  })
})

describe('frontmatter whitespace survives authored and canonical wrappers', () => {
  test.each([' \n', '\t\n', '\n', 'a\n\n', 'a\n \n', '  \ntext', 'a\n b', 'literal &amp; #10;'])('quoted string %j', title => {
    const source = `---\ntitle: ${JSON.stringify(title)}\n---\nflowchart TD\n  A --> B\n`
    const parsed = parseRegisteredMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.meta.frontmatter?.title).toBe(title)
    expect(serializeMermaid(parsed.value)).toBe(source)
    const canonical = serializeMermaid(parsed.value, { wrapper: 'canonical' })
    const reread = parseRegisteredMermaid(canonical)
    expect(reread.ok).toBe(true)
    if (reread.ok) expect(reread.value.meta.frontmatter?.title).toBe(title)
    expect(parseMermaidYaml(stringifyMermaidYaml({ title }))).toEqual({ ok: true, value: { title } })
  })

  test.each([
    ['---\n---\n', {}],
    ['\uFEFF\r\n  ---\r\na: 1\r\n  ---\r\n', { a: 1 }],
    ['---\n      title: Template\n      ---\n', { title: 'Template' }],
    ["---\ntitle: X\n  ---\n", { title: "X" }],
    ["\ufeff\r\n---\r\ntitle: X\r\n  ---\r\n", { title: "X" }],
    ["---\ntitle: \"foo: |\n  bar\"\n  ---\n", { title: "foo: | bar" }],
    ["---\ntitle: 'foo: >+\n  bar'\n  ---\n", { title: "foo: >+ bar" }],
    ['---\ntitle: "foo\n  x: |\n    bar"\n    ---\n', { title: 'foo x: | bar' }],
    ["---\ntitle: 'foo\n  x: >+\n    bar'\n    ---\n", { title: 'foo x: >+ bar' }],
    ['---\nconfig: { custom: "foo\n  x: |\n    bar" }\n    ---\n', { custom: 'foo x: | bar' }],
    ["---\nconfig: { custom: 'foo\n  x: >+\n    bar' }\n    ---\n", { custom: 'foo x: >+ bar' }],
    ['---\nconfig: { items: [{ custom: "foo\n  x: |\n    bar" }] }\n    ---\n', { items: [{ custom: 'foo x: | bar' }] }],
    ['---\nconfig: { custom: "foo \\"quoted\\"\n  x: |\n    bar" }\n    ---\n', { custom: 'foo "quoted" x: | bar' }],
    ["---\nconfig: { custom: 'foo ''quoted''\n  x: >+\n    bar' }\n    ---\n", { custom: "foo 'quoted' x: >+ bar" }],
    ['---\nconfig: {"custom":"foo\n  x: |\n    bar"}\n    ---\n', { custom: 'foo x: | bar' }],
    ['---\nconfig: { custom: &a "foo\n  x: |\n    bar" }\n    ---\n', { custom: 'foo x: | bar' }],
    ["---\nconfig: { custom: [!!str 'foo\n  x: >+\n    bar'] }\n    ---\n", { custom: ['foo x: >+ bar'] }],
    ['---\nconfig: { custom: [&a !!str "foo\n  x: |\n    bar", *a] }\n    ---\n', { custom: ['foo x: | bar', 'foo x: | bar'] }],
    ['---\nconfig: { custom: [!<tag:yaml.org,2002:str> "foo\n  x: |\n    bar"] }\n    ---\n', { custom: ['foo x: | bar'] }],
    ['---\nconfig: {? "foo\n  x: |\n    bar": value}\n    ---\n', { 'foo x: | bar': 'value' }],
    ['---\nconfig: {? &a !!str "foo\n  x: |\n    bar": value}\n    ---\n', { 'foo x: | bar': 'value' }],
    ["---\nconfig: { first: &a don't, second: !!str plain\"quote }\ntitle: |\n  ---\n  after\n---\n", { first: "don't", second: 'plain"quote', title: '---\nafter\n' }],
    ["---\nconfig: { custom: don't }\ntitle: |\n  ---\n  after\n---\n", { custom: "don't", title: '---\nafter\n' }],
    ['---\nconfig: { custom: plain"quote }\ntitle: |\n  ---\n  after\n---\n', { custom: 'plain"quote', title: '---\nafter\n' }],
    ['---\nconfig: { custom: "closed" } # pretend: "open\ntitle: |\n  ---\n  after\n---\n', { custom: 'closed', title: '---\nafter\n' }],
    ['---\nconfig:\n  custom: "closed" # pretend: "open\ntitle: |\n  ---\n  after\n---\n', { custom: 'closed', title: '---\nafter\n' }],
    ['  ---\ntitle: |\n  ---\n  after\n---\n', { title: '---\nafter\n' }],
    ['---\nconfig:\n  themeCSS: |+\n    before\n    ---\n    after\n\n---\n', { themeCSS: 'before\n---\nafter\n\n' }],
    ['---\nconfig:\n  items:\n    - text: |\n        line\n      flag: yes\n      ---\n', { items: [{ text: 'line\n', flag: 'yes' }] }],
    ['---\nconfig:\n  items:\n    - |\n      ---\n      line\n---\n', { items: ['---\nline\n'] }],
  ])('wrapper boundary reads empty and retains supported indented documents: %j', (wrapper, frontmatter) => {
    const source = wrapper as string + 'flowchart TD\n  A --> B\n'
    expect(mermaidFirstLine(source)).toBe('flowchart td')
    expect(normalizeMermaidSource(source).frontmatter).toEqual(frontmatter)
    const parsed = parseRegisteredMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    // Adjacent delimiters have no YAML content line and cannot be written as Mermaid.
    expect(serializeMermaid(parsed.value)).toBe(wrapper === '---\n---\n' ? 'flowchart TD\n  A --> B\n' : source)
    const span = parsed.value.source.spans!.preserved.frontmatter!
    expect(source.slice(span.start.offset, span.end.offset)).toBe(wrapper)
    const canonical = serializeMermaid(parsed.value, { wrapper: 'canonical' })
    expect(normalizeMermaidSource(canonical).frontmatter).toEqual(frontmatter)
  })

  test.each([
    ['title: |+\n  a\n\n', 'a\n\n'],
    ['title: |+\n  a\n   \n', 'a\n \n'],
    ['title: |+\n\n', '\n'],
    ['title: |\n  before\n  ---\n  after\n', 'before\n---\nafter\n'],
  ])('authored block %j keeps its content through the wrapper', (yaml, title) => {
    for (const [indent, newline] of [['', '\n'], ['  ', '\r\n']]) {
      const source = `\uFEFF\n${indent}---\n${yaml!.replace(/^(?=.)/gm, indent!)}${indent}---\n\n  flowchart TD\n    A --> B\n`.replaceAll('\n', newline!)
      const normalized = normalizeMermaidSource(source)
      expect(normalized.frontmatter.title).toBe(title)
      expect(normalized.firstLine).toBe('flowchart td')
      expect(mermaidFirstLine(source)).toBe('flowchart td')
      const parsed = parseRegisteredMermaid(source)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) continue
      const wrapper = source.slice(0, source.indexOf('  flowchart TD'))
      expect(parsed.value.meta.wrapperSource).toBe(wrapper)
      const spans = parsed.value.source.spans!.preserved
      expect(source.slice(spans.frontmatter!.start.offset, spans.frontmatter!.end.offset)).toBe(wrapper.slice(0, -newline!.length))
      expect(source.slice(spans.header.start.offset, spans.header.end.offset)).toBe('flowchart TD')
      expect(serializeMermaid(parsed.value)).toBe(wrapper + 'flowchart TD\n  A --> B\n')
      const reread = parseRegisteredMermaid(serializeMermaid(parsed.value, { wrapper: 'canonical' }))
      expect(reread.ok).toBe(true)
      if (reread.ok) expect(reread.value.meta.frontmatter?.title).toBe(title)
    }
  })
})

// Pinned Mermaid bundles js-yaml in one dist chunk that exports exactly
// `JSON_SCHEMA` and `load`: the reader upstream runs on `@{}` and frontmatter.
const JS_YAML_DIR = join(import.meta.dir, '..', '..', 'node_modules', 'mermaid', 'dist', 'chunks', 'mermaid.core')
const jsYamlChunk = readdirSync(JS_YAML_DIR)
  .find(name => name.endsWith('.mjs') && /export \{\s*JSON_SCHEMA,\s*load\s*\}/.test(readFileSync(join(JS_YAML_DIR, name), 'utf8')))
const jsYaml = (await import(join(JS_YAML_DIR, jsYamlChunk!))) as { JSON_SCHEMA: unknown; load(text: string, options: { schema: unknown }): unknown }
const upstreamYaml = (text: string) => {
  try {
    return { ok: true, value: JSON.stringify(jsYaml.load(text, { schema: jsYaml.JSON_SCHEMA }) ?? null) }
  } catch {
    return { ok: false }
  }
}
const ourYaml = (text: string) => {
  const parsed = parseMermaidYaml(text)
  return parsed.ok ? { ok: true, value: JSON.stringify(parsed.value ?? null) } : { ok: false }
}

describe('parseMermaidYaml agrees with pinned upstream\'s js-yaml', () => {
  // Block documents whose values mix scalar resolution, comments, flow
  // collections, block scalars, anchors, tags, and quoted scalars that span
  // lines at any indentation (js-yaml ignores it; the yaml package does not).
  const VALUES = [
    'x', '0b1', '1_0', '1e999', 'True', '~', '-.5', 'a #c', 'x,#y', '', '"q"', '"t\\tx"', '" m\n  n "', '" m\nn\n"', '"a\\"b"',
    "'it''s'", "'m\n n'", "'u", '{a: 1}', '[1, 2]', '{: x}', '|\n  lit\n', '>-\n  fold\n  ed\n', '"x"#c', 'a: b', '- x',
    '&a x', '*a', '!!str 1', '? a', '\t', 'x \t y', '"\\x41"', "'\\'",
  ]
  const documentArb = fc.array(
    fc.record({ indent: fc.constantFrom('', '  ', '    '), key: fc.constantFrom('a', 'b', 'title', 'config', '"k"'), value: fc.constantFrom(...VALUES) }),
    { minLength: 1, maxLength: 5 },
  ).map(entries => entries.map(({ indent, key, value }) => `${indent}${key}: ${value}`).join('\n'))

  test('same acceptance and the same value for generated documents', () => {
    let accepted = 0
    fc.assert(fc.property(documentArb, text => {
      const theirs = upstreamYaml(text)
      expect({ text, ours: ourYaml(text) }).toEqual({ text, ours: theirs })
      if (theirs.ok) accepted++
    }), fcParameters({ numRuns: 1000 }))
    expect(accepted).toBeGreaterThan(0)
  })

  test('the Gantt docs example: a multi-line themeCSS closes its quote under the key', () => {
    const text = 'config:\n  themeCSS: " a {}\n    b {}\n  "\n  gantt:\n    useWidth: 400'
    expect(ourYaml(text)).toEqual(upstreamYaml(text))
    expect(parseMermaidYaml(text)).toEqual({ ok: true, value: { config: { themeCSS: ' a {} b {} ', gantt: { useWidth: 400 } } } })
  })

  // A quoted scalar left open by a missing quote runs into later lines, where
  // js-yaml lets a following key's quote close it and reads on. We refuse the
  // open quote, and honour YAML's \" escape inside double quotes
  // (docs/project/divergences.md).
  test('an open quoted scalar is refused; an escaped quote stays inside its scalar', () => {
    expect(parseMermaidYaml('title: "unclosed\n"k": v')).toMatchObject({ ok: false, message: expect.stringContaining('Missing closing "quote') })
    expect(parseMermaidYaml('  title: "a\\"\n  b: "q"')).toEqual({ ok: true, value: { title: 'a"', b: 'q' } })
  })
})

describe('scanMetadataBlock delimits a block by the family\'s upstream lexer', () => {
  test('flowchart: `"` is the only quote and has no escapes; `}` ends the block; `^` is an error', () => {
    const scan = (text: string) => scanMetadataBlock(text, text.indexOf('{'), 'flowchart')
    expect(scan('A@{ label: "a}b" } x')).toEqual({ kind: 'closed', body: ' label: "a}b" ', end: 17 })
    expect(scan("A@{ label: 'a}b' }")).toEqual({ kind: 'closed', body: " label: 'a", end: 13 })
    expect(scan('A@{ label: "a\\"b" }')).toEqual({ kind: 'unclosed' })
    expect(scan('A@{ label: "a\n    b" }')).toEqual({ kind: 'closed', body: ' label: "a<br/>b" ', end: 21 })
    expect(scan('A@{ label: a^b }')).toEqual({ kind: 'invalid', message: 'unquoted "^" in @{} metadata' })
    expect(scan('A@{ label: "a^b" }').kind).toBe('closed')
  })

  test('sequence: the first `}` ends the block, quoted or not; the body is trimmed and not empty', () => {
    const scan = (text: string) => scanMetadataBlock(text, text.indexOf('{'), 'sequence')
    expect(scan('participant A@{ "alias": "a}b" }')).toEqual({ kind: 'closed', body: '"alias": "a', end: 27 })
    expect(scan('participant A@{ }')).toEqual({ kind: 'closed', body: '', end: 16 })
    expect(scan('participant A@{}')).toEqual({ kind: 'invalid', message: 'empty @{} participant metadata' })
  })

  test('a multi-line flowchart block is joined with its line breaks and indentation', () => {
    expect(coalesceFlowchartLines(['A@{', '  shape: rect', '  label: "x"', '}', 'A --> B']))
      .toEqual([
        {
          text: 'A@{\n  shape: rect\n  label: "x"\n}',
          line: 0,
          joined: [{ at: 4, line: 1, col: 0 }, { at: 18, line: 2, col: 0 }, { at: 31, line: 3, col: 0 }],
        },
        { text: 'A --> B', line: 4 },
      ])
  })
})

test('metadata entity protection stays proportional when one private-use candidate dominates', () => {
  const alphabet = Array.from({ length: 0x1900 }, (_, index) => String.fromCharCode(0xe000 + index)).join('')
  for (const heavy of ['\uE000', '\uF8FF']) {
    const value = alphabet + heavy.repeat(256) + '#x;'.repeat(1024)
    const source = `value: "${value}"`
    const protectedBody = protectMetadataEntities(source)
    expect(protectedBody.restore(protectedBody.text)).toBe(source)
    expect(protectedBody.sourceOffset(protectedBody.text.length)).toBe(source.length)
    expect(protectedBody.text.length).toBeLessThanOrEqual(source.length * 2)
    const parsed = parseMetadataBody(source, 'flowchart')
    expect(parsed.ok ? parsed.entries.get('value') : parsed.message).toBe(value)
  }
})

describe('quoteMetadataString', () => {
  test('writes a scalar both lexers leave intact and YAML reads back', () => {
    const text = fc.array(fc.constantFrom('a', ' ', '"', "'", '\\', 't', 'x41', '}', '^', ';', '#35;', '\n', '\t', '\u0085', '\u2028', ':', ','), { maxLength: 8 })
      .map(parts => parts.join(''))
    fc.assert(fc.property(text, value => {
      const line = `A@{ label: ${quoteMetadataString(value)} }`
      const read = readMetadataBlock(line, line.indexOf('{'), 'flowchart')
      expect({ value, read: read.ok ? { end: read.end, label: read.entries.get('label') } : read.message })
        .toEqual({ value, read: { end: line.length - 1, label: value } })
    }), fcParameters({ numRuns: 300 }))
  })
})

// ---------------------------------------------------------------------------
// Against pinned upstream
// ---------------------------------------------------------------------------

describe('pinned upstream Mermaid reads @{} metadata as we do', () => {
  let upstream: UpstreamMermaid
  beforeAll(() => {
    upstream = startUpstreamMermaid()
  })
  afterAll(() => upstream.close())

  // Value spellings that exercise both lexers and YAML: quotes, escapes, `}`,
  // `^`, entity codes, comments, flow indicators, scalar resolution, and a
  // line break (a multi-line block is block YAML upstream).
  const PIECES = ['"', "'", '\\', 't', 'x41', 'a', ' ', '}', '{', ';', '^', '#35;', '#', ',', ':', '[', ']', '-', '.', '5', '_', '0b1', 'true', '\n  ']
  const valueArb = fc.array(fc.constantFrom(...PIECES), { minLength: 1, maxLength: 7 }).map(parts => parts.join(''))

  type Outcome = { accepted: string | undefined } | { rejected: true }

  /** Upstream DB text in marker form, or its rejection. */
  const upstreamOutcome = (parsed: Awaited<ReturnType<UpstreamMermaid['parse']>>, text: (p: Extract<typeof parsed, { ok: true }>) => string | undefined): Outcome =>
    parsed.ok ? (() => {
      const value = text(parsed)
      // The parser DB retains entity markers, whereas our render models
      // project display text and deliberately refuse terminal controls.
      const control = [...(value ?? '').matchAll(/ﬂ°°(\d+)¶ß/g)].some(match => {
        const code = Number(match[1])
        return code > 0 && code < 32 || [127, 129, 141, 143, 144, 157].includes(code)
      }) || /ﬂ°(?:Tab|NewLine)¶ß/.test(value ?? '')
      return control ? { rejected: true } : { accepted: value }
    })() : { rejected: true }


  /** Our outcome: acceptance is the whole renderer parser's (text after a
   * block is a statement too); the value is the shared reader's, in
   * upstream's marker form. */
  function ourOutcome(parses: () => unknown, line: string, grammar: 'flowchart' | 'sequence', key: string): Outcome {
    try { parses() } catch { return { rejected: true } }
    const read = readMetadataBlock(line, line.indexOf('{'), grammar)
    return { accepted: read.ok ? toEntityMarkers(metadataText(read.entries.get(key)) ?? 'A') : `unread: ${read.message}` }
  }

  // Once an unquoted `}` has closed the block, the lines after it are new
  // flowchart statements (`\{ }`, say): the flowchart grammar's business,
  // not this reader's.
  const flowchartValueArb = valueArb.filter(value => {
    const statement = `A@{ label: ${value} }`
    const block = scanMetadataBlock(statement, 2, 'flowchart')
    return block.kind !== 'closed' || !statement.slice(block.end + 1).includes('\n')
  })

  test('flowchart node `@{ label }`: same acceptance and the same label', async () => {
    let accepted = 0
    await fc.assert(fc.asyncProperty(flowchartValueArb, async value => {
      const source = `flowchart TD\n  A@{ label: ${value} }`
      const theirs = upstreamOutcome(await upstream.parse(source), p => p.flowchart?.vertices.find(v => v.id === 'A')?.text)
      const line = coalesceFlowchartLines(source.split('\n'))[1]!.text
      const ours = ourOutcome(() => parseMermaid(source), line, 'flowchart', 'label')
      expect({ source, ours }).toEqual({ source, ours: theirs })
      if ('accepted' in theirs) accepted++
    }), fcParameters({ numRuns: 200 }))
    expect(accepted).toBeGreaterThan(0)
  }, 60_000)

  // After the block's first `}` a `;` starts another statement, which is the
  // sequence grammar's business, not this reader's; a `#` starts a comment,
  // which the shared statement splitter models.
  const sequenceValueArb = valueArb.filter(value => !value.includes('\n') && !/}.*;/.test(value))

  test('sequence participant `@{ alias }`: same acceptance and the same alias', async () => {
    let accepted = 0
    await fc.assert(fc.asyncProperty(sequenceValueArb, async value => {
      const source = `sequenceDiagram\n  participant A@{ alias: ${value} }`
      const theirs = upstreamOutcome(await upstream.parse(source), p => p.sequence?.actors.find(a => a.name === 'A')?.description)
      const line = splitSequenceStatementLines([source.split('\n')[1]!])[0]!.trim()
      const ours = ourOutcome(() => parseSequenceDiagram(source.split('\n')), line, 'sequence', 'alias')
      expect({ source, ours }).toEqual({ source, ours: theirs })
      if ('accepted' in theirs) accepted++
    }), fcParameters({ numRuns: 200, examples: [['#5;"']] }))
    expect(accepted).toBeGreaterThan(0)
  }, 60_000)

  // BUG-24: the flowchart parser, renderer and typed body read `@{}` through
  // the shared reader, so YAML escapes work and what upstream rejects fails.
  test('BUG-24: flowchart `@{ label }` YAML escapes and rejections match upstream', async () => {
    const cases: Array<{ metadata: string; label?: string }> = [
      { metadata: 'label: "t\\tx\\x41"', label: 't\txA' },
      { metadata: "label: 'it''s'", label: "it's" },
      { metadata: 'label: "a}b;c"', label: 'a}b;c' },
      { metadata: 'label: "a\\u0041\\/b"', label: 'aA/b' },
      { metadata: 'label: 12', label: '12' },
      { metadata: 'label: 1_0', label: '1_0' },
      { metadata: 'label: 0b1_0', label: '0b1_0' },
      { metadata: 'label: 1e999', label: '1e999' },
      { metadata: "label: 'a}b;c'" },
      { metadata: "label: 'x\\'y'" },
      { metadata: 'label: "a\\qb"' },
      { metadata: 'label: a^b' },
      { metadata: 'label: "x", label: "y"' },
    ]
    for (const { metadata, label } of cases) {
      const source = `flowchart TD\n  A@{ ${metadata} } --> B`
      const parsed = await upstream.parse(source)
      const upstreamLabel = parsed.ok ? parsed.flowchart?.vertices.find(v => v.id === 'A')?.text : undefined
      let rendererLabel: string | undefined
      try { rendererLabel = parseMermaid(source).nodes.get('A')?.label } catch { rendererLabel = undefined }
      const agent = parseRegisteredMermaid(source)
      const typed = agent.ok && agent.value.body.kind === 'flowchart' ? agent.value.body.graph.nodes.get('A')?.label : undefined
      expect({ source, upstreamLabel, rendererLabel, typed, agentError: !agent.ok })
        .toEqual({ source, upstreamLabel: label, rendererLabel: label, typed: label, agentError: label === undefined })
      if (agent.ok && label !== undefined) {
        const reparsed = await upstream.parse(serializeMermaid(agent.value))
        expect(reparsed.ok && reparsed.flowchart?.vertices.find(vertex => vertex.id === 'A')?.text).toBe(label)
      }
    }
  })

  test('BUG-24: a typed label round-trips through `@{ label }` and upstream reads it back', async () => {
    const parsed = parseRegisteredMermaid('flowchart TD\n  A@{ shape: delay, label: "x" }')
    if (!parsed.ok || parsed.value.body.kind !== 'flowchart') throw new Error('fixture must parse as a typed flowchart')
    for (const label of ['t\tx', 'a}b;c', 'q"u\\o\'te', 'x41 ^ #35', 'line\nbreak', '1_0', '1e999']) {
      const node = parsed.value.body.graph.nodes.get('A')!
      parsed.value.body.graph.nodes.set('A', { ...node, label })
      const serialized = serializeMermaid(parsed.value)
      const reparsed = parseRegisteredMermaid(serialized)
      const ours = reparsed.ok && reparsed.value.body.kind === 'flowchart' ? reparsed.value.body.graph.nodes.get('A')?.label : undefined
      const theirs = await upstream.parse(serialized)
      expect({ serialized, ours, upstream: theirs.ok })
        .toEqual({ serialized, ours: label, upstream: true })
    }
  })

  test('BUG-24: sequence `@{}` accepts YAML escapes and rejects what upstream rejects', async () => {
    const cases: Array<{ metadata: string; label?: string }> = [
      { metadata: '"alias": "t\\tx\\x41"', label: 't\txA' },
      { metadata: "alias: 'it''s'", label: "it's" },
      { metadata: 'alias: x y', label: 'x y' },
      { metadata: 'alias: 1_0', label: '1_0' },
      { metadata: 'alias: 0b1_0', label: '0b1_0' },
      { metadata: 'alias: 1e999', label: '1e999' },
      { metadata: '"type": "database", alias: "Q"', label: 'Q' },
      { metadata: "'alias': 'x\\'y'" },
      { metadata: '"type": "database", alias: "a}b"' },
      { metadata: 'alias: "x", alias: "y"' },
      { metadata: '' },
    ]
    for (const { metadata, label } of cases) {
      const source = `sequenceDiagram\n  participant B@{${metadata ? ` ${metadata} ` : ''}}\n  B->>B: m`
      const parsed = await upstream.parse(source)
      const upstreamLabel = parsed.ok ? parsed.sequence?.actors.find(a => a.name === 'B')?.description : undefined
      let rendererLabel: string | undefined
      try { rendererLabel = parseSequenceDiagram(source.split('\n')).actors.find(a => a.id === 'B')?.label } catch { rendererLabel = undefined }
      let rendered = true
      try { renderMermaidSVG(source) } catch { rendered = false }
      expect({ source, upstreamLabel, rendererLabel, rendered })
        .toEqual({ source, upstreamLabel: label, rendererLabel: label, rendered: label !== undefined })
      if (label !== undefined) {
        const agent = parseRegisteredMermaid(source)
        if (!agent.ok) throw new Error(JSON.stringify(agent.error))
        const reparsed = await upstream.parse(serializeMermaid(agent.value))
        expect(reparsed.ok && reparsed.sequence?.actors.find(actor => actor.name === 'B')?.description).toBe(label)
      }
    }
  })

  test('the corrected multi-line form is valid upstream; the comma form is not typed as its shape', async () => {
    const valid = 'flowchart TD\n  A@{\n    shape: delay\n    label: "Wait"\n  }\n  A --> B'
    expect((await upstream.parse(valid)).ok).toBe(true)
    expect(parseMermaid(valid).nodes.get('A')).toMatchObject({ label: 'Wait', semanticShape: 'delay' })
    // Block YAML reads `delay,` (comma included), a shape upstream rejects.
    const comma = valid.replace('shape: delay', 'shape: delay,')
    expect(await upstream.parse(comma)).toEqual({ ok: false, error: 'No such shape: delay,.' })
    expect(parseMermaid(comma).nodes.get('A')?.semanticShape).toBeUndefined()
  })

  // BUG-28: upstream's `extractFrontMatter` throws on YAML it cannot load and
  // reads any other non-mapping document as empty metadata.
  test('BUG-28: frontmatter upstream rejects is rejected; a non-mapping document is empty metadata', async () => {
    const cases: Array<{ yaml: string; frontmatter?: Record<string, unknown> }> = [
      { yaml: 'title: [unclosed' },
      { yaml: 'title: a: b: c' },
      { yaml: 'title: x\ntitle: y' },
      { yaml: ': x' },
      { yaml: 'title: !foo x' },
      { yaml: '- a\n- b', frontmatter: {} },
      { yaml: 'just text', frontmatter: {} },
      { yaml: '~', frontmatter: {} },
      { yaml: 'title: Sales', frontmatter: { title: 'Sales' } },
      { yaml: 'title: 1_0', frontmatter: { title: '1_0' } },
      { yaml: 'title: 1e999', frontmatter: { title: '1e999' } },
    ]
    for (const { yaml, frontmatter } of cases) {
      const source = `---\n${yaml}\n---\nflowchart TD\n  A --> B`
      const parsed = await upstream.parse(source)
      let ours: unknown
      try { ours = normalizeMermaidSource(source).frontmatter } catch (error) { ours = error instanceof Error ? 'rejected' : error }
      let rendered = true
      try { renderMermaidSVG(source) } catch { rendered = false }
      // The agent API reports the rejection rather than throwing it.
      const typed = parseRegisteredMermaid(source)
      expect({ yaml, upstream: parsed.ok, ours, rendered, typed: typed.ok || typed.error[0]?.code, verified: verifyMermaid(source).ok })
        .toEqual({ yaml, upstream: frontmatter !== undefined, ours: frontmatter ?? 'rejected', rendered: frontmatter !== undefined, typed: frontmatter !== undefined || 'INVALID_FRONTMATTER', verified: frontmatter !== undefined })
    }
    expect(() => normalizeMermaidSource('---\ntitle: [unclosed\n---\nflowchart TD\n  A')).toThrow('Mermaid frontmatter is not valid YAML')
  })

  // BUG-14: upstream's `addActor` names the actor with a truthy metadata
  // alias unless `as` gives a text other than the id.
  test('BUG-14: a metadata alias wins over an `as` that repeats the id, in the renderer and the typed body', async () => {
    const declarations = [
      'participant B@{ "alias": "Y" } as B',
      'participant B@{ "alias": "Y" } as  B ',
      'actor B@{ "alias": "Y" } as B',
      'participant B@{ "alias": "Y" } as Z',
      'participant B@{ "alias": "Y" } as b',
      'participant B@{ "alias": "Y" }',
      'participant B@{ "alias": "" } as B',
      'participant B@{ "alias": 5 }',
      'participant B@{ "alias": true } as B',
      'participant B as X\n  participant B@{ "alias": "Y" }',
      'participant B@{ "alias": "Y" }\n  participant B as B',
    ]
    for (const declaration of declarations) {
      const source = `sequenceDiagram\n  ${declaration}\n  B->>B: m`
      const parsed = await upstream.parse(source)
      const upstreamLabel = parsed.ok ? parsed.sequence?.actors.find(a => a.name === 'B')?.description : parsed.error
      const rendererLabel = parseSequenceDiagram(source.split('\n')).actors.find(a => a.id === 'B')?.label
      const agent = parseRegisteredMermaid(source)
      const typed = agent.ok && agent.value.body.kind === 'sequence'
        ? agent.value.body.participants.find(p => p.id === 'B')?.label
        : undefined
      expect({ declaration, rendererLabel, typed }).toEqual({ declaration, rendererLabel: upstreamLabel, typed: upstreamLabel })
    }
  })
})
