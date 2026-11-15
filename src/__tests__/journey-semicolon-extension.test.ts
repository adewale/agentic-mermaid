import { afterAll, describe, expect, test } from 'bun:test'
import { asJourney, mutate, parseRegisteredMermaid, serializeMermaid, verifyMermaid } from '../agent/index.ts'
import { parseJourneyDiagram } from '../journey/parser.ts'
import { startUpstreamMermaid } from './helpers/upstream-mermaid.ts'
import { renderMermaidSVG } from '../index.ts'
import { renderMermaidASCII } from '../ascii/index.ts'

const source = 'journey\n  A: 5: Me; B: 3: Me'

// One long-lived pinned-Mermaid child serves every probe in this file.
const upstream = startUpstreamMermaid()
afterAll(() => upstream.close())

describe('Journey semicolon statements are a diagnosed Agentic extension', () => {
  test.each([
    { authored: '&#37;&#37;Task', text: '%%Task', actor: 'Alice', expectedActor: 'Alice' },
    { authored: '&#116;itle T', text: 'title T', actor: 'Actor', expectedActor: 'Actor' },
    { authored: 'Task', text: 'Task', actor: 'A&#44;B', expectedActor: 'A,B' },
    { authored: 'A&#58;B', text: 'A:B', actor: 'A&#58;B', expectedActor: 'A:B' },
    { authored: 'A&#42;B&#42;C', text: 'A*B*C', actor: '&lt;b&gt;Alice&lt;/b&gt;', expectedActor: '<b>Alice</b>' },
    { authored: '&amp;lt;b&amp;gt;A&amp;lt;/b&amp;gt;', text: '&lt;b&gt;A&lt;/b&gt;', actor: '&amp;#44;', expectedActor: '&#44;' },
    { authored: '&#64258;°°35&#182;ß', text: 'ﬂ°°35¶ß', actor: 'Alice', expectedActor: 'Alice' },
    { authored: '#116;itle #58;#32;', text: 'title : ', actor: 'A#44;B', expectedActor: 'A,B' },
    { authored: 'A&#92;nB', text: 'A\\nB', actor: '&#32;Alice&#32;', expectedActor: ' Alice ' },
    { authored: '&lt;br&gt;', text: '<br>', actor: '&#42;X&#42;', expectedActor: '*X*' },
  ])('entity-produced syntax remains literal: $authored / $actor', async ({ authored, text, actor, expectedActor }) => {
    const input = `journey\n${authored}: 3: ${actor}`
    const parsed = parseRegisteredMermaid(input)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.body).toMatchObject({ kind: 'journey', sections: [{ tasks: [{ text, score: 3, actors: [expectedActor] }] }] })
    expect(parsed.value.body).not.toHaveProperty('title')
    const written = serializeMermaid(parsed.value)
    const sameText = mutate(parsed.value, { kind: 'set_task_text', sectionIndex: 0, taskIndex: 0, text })
    expect(sameText.ok).toBe(true)
    if (!sameText.ok) return
    const sameActor = mutate(sameText.value, { kind: 'set_task_actors', sectionIndex: 0, taskIndex: 0, actors: [expectedActor] })
    expect(sameActor.ok).toBe(true)
    if (!sameActor.ok) return
    expect(serializeMermaid(sameActor.value)).toBe(written)
    const renamed = mutate(sameActor.value, { kind: 'rename_actor', from: expectedActor, to: expectedActor })
    expect(renamed.ok).toBe(true)
    if (!renamed.ok) return
    expect(serializeMermaid(renamed.value)).toBe(written)
    expect((await upstream.parse(written)).ok).toBe(true)
    const again = parseRegisteredMermaid(written)
    expect(again.ok && again.value.body).toMatchObject({ kind: 'journey', sections: [{ tasks: [{ text, score: 3, actors: [expectedActor] }] }] })
    const ascii = renderMermaidASCII(input)
    expect(ascii).toContain(text.trimEnd())
    expect(ascii).toContain(`by ${expectedActor.trimEnd()}`)
    expect(renderMermaidASCII(written)).toBe(ascii)
    expect(renderMermaidSVG(written)).toBe(renderMermaidSVG(input))
  })

  test('typed literal delimiters and keyword prefixes are escaped by the writer', async () => {
    const parsed = parseRegisteredMermaid('journey\nTask: 3: Alice')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const diagram = asJourney(parsed.value)
    expect(diagram).toBeDefined()
    if (!diagram) return
    const task = diagram.body.sections[0]!.tasks[0]!
    task.text = 'title Pick: one; two'
    task.actors = ['A,B', 'style A:#']
    const written = serializeMermaid(diagram)
    expect((await upstream.parse(written)).ok).toBe(true)
    const again = parseRegisteredMermaid(written)
    expect(again.ok && again.value.body).toMatchObject({ kind: 'journey', sections: [{ tasks: [{ text: 'title Pick: one; two', actors: ['A,B', 'style A:#'] }] }] })
  })

  test('literal encoded tags remain distinct from real formatting through an unrelated edit', async () => {
    const input = 'journey\nsection A&#58;B\n&lt;b&gt;literal&lt;/b&gt; and **bold**: 3: &lt;b&gt;Alice&lt;/b&gt;'
    const parsed = parseRegisteredMermaid(input)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.body).toMatchObject({ kind: 'journey', sections: [{ label: 'A:B', tasks: [{ text: '<b>literal</b> and <b>bold</b>', actors: ['<b>Alice</b>'] }] }] })
    const edited = mutate(parsed.value, { kind: 'set_task_score', sectionIndex: 0, taskIndex: 0, score: 4 })
    expect(edited.ok).toBe(true)
    if (!edited.ok) return
    const written = serializeMermaid(edited.value)
    expect(serializeMermaid(JSON.parse(JSON.stringify(edited.value)))).toBe(written)
    const restatedText = mutate(edited.value, { kind: 'set_task_text', sectionIndex: 0, taskIndex: 0, text: '<b>literal</b> and <b>bold</b>' })
    expect(restatedText.ok).toBe(true)
    if (!restatedText.ok) return
    const restatedActors = mutate(restatedText.value, { kind: 'set_task_actors', sectionIndex: 0, taskIndex: 0, actors: ['<b>Alice</b>'] })
    expect(restatedActors.ok).toBe(true)
    if (!restatedActors.ok) return
    expect(serializeMermaid(restatedActors.value)).toBe(written)
    expect((await upstream.parse(written)).ok).toBe(true)
    const ascii = renderMermaidASCII(written)
    expect(ascii).toContain('<b>literal</b> and bold')
    expect(ascii).toContain('by <b>Alice</b>')
    const svg = renderMermaidSVG(written)
    expect(svg).toContain('&lt;b&gt;literal&lt;/b&gt;')
    expect(svg).toContain('&lt;b&gt;Alice&lt;/b&gt;')
  })

  test.each([
    { authored: '&mp;', text: '&mp;' },
    { authored: 'Me&amp;', text: 'Me&' },
    { authored: '&amp;amp;', text: '&amp;' },
    { authored: '&amp;amp;amp;', text: '&amp;amp;' },
    { authored: '&#59;', text: ';' },
    { authored: '&#35;', text: '#' },
  ])('entity text $authored preserves its meaning through portable writing', async ({ authored, text }) => {
    const source = `journey\n  title ${authored}\n  section ${authored}\n  ${authored}: 3: ${authored}`
    const parsed = parseRegisteredMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const canonical = serializeMermaid(parsed.value)
    expect((await upstream.parse(canonical)).ok).toBe(true)
    const expected = {
      title: text, section: text, task: text, actors: [text],
    }
    for (const value of [source, canonical]) {
      const native = parseJourneyDiagram(value.trimEnd().split('\n'))
      expect({ title: native.title, section: native.sections[0]!.label, task: native.sections[0]!.tasks[0]!.text, actors: native.sections[0]!.tasks[0]!.actors }).toEqual(expected)
    }
    const reparsed = parseRegisteredMermaid(canonical)
    expect(reparsed.ok && reparsed.value.body).toEqual(parsed.value.body)
    expect(renderMermaidSVG(canonical)).toBe(renderMermaidSVG(source))
    const terminal = renderMermaidASCII(source)
    expect(terminal).toContain(`by ${text}`)
    expect(renderMermaidASCII(canonical)).toBe(terminal)
    expect(verifyMermaid(source).warnings).toContainEqual(expect.objectContaining({
      code: 'UNSUPPORTED_SYNTAX', syntax: 'journey_entity_semicolon', line: 4,
    }))
    expect(verifyMermaid(canonical).warnings).not.toContainEqual(expect.objectContaining({ syntax: 'journey_entity_semicolon' }))
  })

  test('Mermaid entity semicolons remain text beside real statement separators', async () => {
    const input = 'journey\n  #59;: 3: #amp;mp#59;; Next: 4: Me'
    const native = parseJourneyDiagram(input.split('\n'))
    expect(native.sections[0]!.tasks.map(task => ({ text: task.text, actors: task.actors }))).toEqual([
      { text: ';', actors: ['&mp;'] }, { text: 'Next', actors: ['Me'] },
    ])
    const parsed = parseRegisteredMermaid(input)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect((await upstream.parse(serializeMermaid(parsed.value))).ok).toBe(true)
  })

  test('entity normalization leaves wrapped titles, configuration and accessibility intact', () => {
    const source = '---\ntitle: "Wrapped &amp;amp;"\nconfig:\n  journey:\n    titleColor: "#123456"\n---\n%%{init: {"journey":{"taskFontFamily":"A&amp;B"}}}%%\njourney\naccTitle: Accessible &amp;amp;\nTask: 3: Me&amp;'
    const parsed = parseRegisteredMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const canonical = serializeMermaid(parsed.value)
    expect(canonical).toContain('title: "Wrapped &amp;amp;"')
    expect(canonical).toContain('"taskFontFamily":"A&amp;B"')
    const svg = renderMermaidSVG(source)
    expect(svg).toContain('Wrapped &amp;amp;</text>')
    expect(svg).toContain('Accessible &amp;amp;</title>')
    expect(svg).toMatch(/class="journey-title"[^>]*fill="#123456"/)
    expect(renderMermaidSVG(canonical)).toBe(svg)
    expect(renderMermaidASCII(canonical)).toBe(renderMermaidASCII(source))
  })

  test('pinned Mermaid rejects a joined task line that both local parsers retain', async () => {
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
