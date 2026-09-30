import { afterAll, describe, expect, test } from 'bun:test'
import { asJourney, mutate, parseRegisteredMermaid, serializeMermaid, verifyMermaid } from '../agent/index.ts'
import { parseJourneyDiagram } from '../journey/parser.ts'
import { startUpstreamMermaid } from './helpers/upstream-mermaid.ts'

const source = 'journey\n  A: 5: Me; B: 3: Me'

// One long-lived pinned-Mermaid child serves every probe in this file.
const upstream = startUpstreamMermaid()
afterAll(() => upstream.close())

describe('Journey semicolon statements are a diagnosed Agentic extension', () => {
  test('pinned Mermaid 11.16 rejects a joined task line that both local parsers retain', async () => {
    const verdict = await upstream.parse(source)
    expect({ ok: verdict.ok, error: verdict.ok ? '' : verdict.error }).toEqual({ ok: false, error: expect.stringContaining('Parse error') })

    expect(parseJourneyDiagram(source.split('\n')).sections[0]!.tasks.map(task => task.text)).toEqual(['A', 'B'])
    const parsed = parseRegisteredMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(asJourney(parsed.value)?.body.sections[0]!.tasks.map(task => task.text)).toEqual(['A', 'B'])
    expect(verifyMermaid(parsed.value).warnings).toContainEqual(expect.objectContaining({
      code: 'UNSUPPORTED_SYNTAX',
      syntax: 'journey_semicolon_statement_extension',
      line: 2,
    }))
  })

  test('serialization and mutation replace the extension with portable newlines', async () => {
    const parsed = parseRegisteredMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const serialized = serializeMermaid(parsed.value)
    expect(serialized).toContain('A: 5: Me\n    B: 3: Me')
    expect((await upstream.parse(serialized)).ok).toBe(true)
    expect(verifyMermaid(serialized).warnings).not.toContainEqual(expect.objectContaining({ syntax: 'journey_semicolon_statement_extension' }))

    const changed = mutate(parsed.value, { kind: 'set_task_score', sectionIndex: 0, taskIndex: 1, score: 4 })
    expect(changed.ok).toBe(true)
    if (!changed.ok) return
    const changedSource = serializeMermaid(changed.value)
    expect(changedSource).toContain('B: 4: Me')
    expect((await upstream.parse(changedSource)).ok).toBe(true)
  })

  test('trailing statement terminators are diagnosed, but block-description text is not', () => {
    const terminated = verifyMermaid('journey\n  A: 5: Me;')
    expect(terminated.warnings).toContainEqual(expect.objectContaining({
      code: 'UNSUPPORTED_SYNTAX', syntax: 'journey_semicolon_statement_extension', line: 2,
    }))
    const block = verifyMermaid('journey\n  accDescr {A; B}\n  Task: 3: Me')
    expect(block.warnings).not.toContainEqual(expect.objectContaining({ syntax: 'journey_semicolon_statement_extension' }))
  })

  test.each(['accTitle', 'accDescr'])('semicolon inside inline %s is portable text', async directive => {
    const inline = `journey\n  ${directive}: A; B\n  Task: 3: Me`
    expect((await upstream.parse(inline)).ok).toBe(true)
    expect(verifyMermaid(inline).warnings).not.toContainEqual(expect.objectContaining({
      syntax: 'journey_semicolon_statement_extension',
    }))
    const rendered = parseJourneyDiagram(inline.split('\n'))
    expect(rendered.sections[0]!.tasks.map(task => task.text)).toEqual(['Task'])
    expect(directive === 'accTitle' ? rendered.accessibilityTitle : rendered.accessibilityDescription).toBe('A; B')
  })

  test.each([
    ['same-line', 'accDescr {hello}'],
    ['closing-line', 'accDescr {\n    hello\n  }'],
  ])('semicolon inside %s block suffix is portable text', async (_placement, block) => {
    const input = `journey\n  ${block} accTitle: A; B\n  Task: 3: Me`
    expect((await upstream.parse(input)).ok).toBe(true)
    expect(verifyMermaid(input).warnings).not.toContainEqual(expect.objectContaining({
      syntax: 'journey_semicolon_statement_extension',
    }))
    expect(parseJourneyDiagram(input.split('\n')).sections[0]!.tasks.map(task => task.text)).toEqual(['Task'])
  })

  test('semicolon inside an inline accDescr block suffix is portable text', async () => {
    const input = 'journey\n  accDescr {hello} accDescr: A; B\n  Task: 3: Me'
    expect((await upstream.parse(input)).ok).toBe(true)
    expect(verifyMermaid(input).warnings).not.toContainEqual(expect.objectContaining({
      syntax: 'journey_semicolon_statement_extension',
    }))
    expect(parseJourneyDiagram(input.split('\n')).sections[0]!.tasks.map(task => task.text)).toEqual(['Task'])
  })

  test.each([
    ['leading comment', '%% hi\njourney\n  A: 5: Me; B: 3: Me', 3],
    ['init directive', '%%{init: {"theme":"default"}}%%\njourney\n  A: 5: Me; B: 3: Me', 3],
    ['frontmatter', '---\ntitle: Example\n---\njourney\n  A: 5: Me; B: 3: Me', 5],
    ['in-body blank and comment', 'journey\n\n  %% body comment\n  A: 5: Me; B: 3: Me', 4],
  ])('warning uses authored physical line with %s', (_name, input, line) => {
    const parsed = parseRegisteredMermaid(input)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    for (const target of [input, parsed.value]) {
      expect(verifyMermaid(target).warnings).toContainEqual(expect.objectContaining({
        code: 'UNSUPPORTED_SYNTAX', syntax: 'journey_semicolon_statement_extension', line,
      }))
    }
  })
})
