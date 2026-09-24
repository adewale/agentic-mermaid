import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseRegisteredMermaid } from '../agent/parse.ts'
import { renderMermaidPNG } from '../agent/png.ts'
import { serializeMermaid } from '../agent/serialize.ts'
import { asSequence } from '../agent/types.ts'
import { renderMermaidSVG } from '../index.ts'
import { parseSequenceDiagram } from '../sequence/parser.ts'
import { splitSequenceStatementLines } from '../sequence/statements.ts'

const MULTILINE = `sequenceDiagram
  participant A as Alice
  participant B as Bob
  A->>B: hello
  B-->>A: reply`
const ONE_LINE = 'sequenceDiagram; participant A as Alice; participant B as Bob; A->>B: hello; B-->>A: reply;'

describe('Sequence newline and semicolon statement equivalence', () => {
  test('native parser keeps participants, messages, and SVG endpoints', () => {
    const expected = parseSequenceDiagram(MULTILINE.split('\n').map(line => line.trim()))
    const actual = parseSequenceDiagram([ONE_LINE])
    expect(actual).toEqual(expected)

    const svg = renderMermaidSVG(ONE_LINE)
    expect(svg).toContain('data-from="A"')
    expect(svg).toContain('data-to="B"')
    expect(svg).toContain('data-from="B"')
    expect(svg).toContain('data-to="A"')
  })

  test('body-line separators agree across render and agent projections', () => {
    const source = 'sequenceDiagram\n  A->>B: first; B-->>A: second;'
    const native = parseSequenceDiagram(source.split('\n').map(line => line.trim()))
    expect(native.messages.map(message => message.label)).toEqual(['first', 'second'])

    const agent = parseRegisteredMermaid(source)
    expect(agent.ok).toBe(true)
    if (!agent.ok) return
    const sequence = asSequence(agent.value)
    expect(sequence).not.toBeNull()
    if (!sequence) return
    expect(sequence.body.messages.map(message => message.text)).toEqual(['first', 'second'])
    const serialized = serializeMermaid(sequence)
    expect(parseSequenceDiagram(serialized.trimEnd().split('\n').map(line => line.trim())).messages.map(message => message.label)).toEqual(['first', 'second'])
  })

  test('Mermaid hash entities keep their terminator semicolons inside labels', () => {
    const source = 'sequenceDiagram; A->>B: I #9829; you!; B->>A: #59; yes;'
    const expectedLabels = ['I #9829; you!', '#59; yes']
    expect(parseSequenceDiagram([source]).messages.map(message => message.label)).toEqual(expectedLabels)
    const agent = parseRegisteredMermaid(source)
    expect(agent.ok).toBe(true)
    if (agent.ok) expect(asSequence(agent.value)?.body.messages.map(message => message.text)).toEqual(expectedLabels)
  })

  test('block boundaries and continuations have the same message order', () => {
    const source = 'sequenceDiagram; alt yes; A->>B: one; else no; B-->>A: two; end; A->>B: three;'
    const native = parseSequenceDiagram([source])
    expect(native.messages.map(message => message.label)).toEqual(['one', 'two', 'three'])
    expect(native.blocks).toMatchObject([{ type: 'alt', label: 'yes', dividers: [{ label: 'no' }] }])
    const agent = parseRegisteredMermaid(source)
    expect(agent.ok).toBe(true)
    if (agent.ok) {
      const sequence = asSequence(agent.value)
      expect(sequence?.body.statements.map(statement => statement.kind)).toEqual(['fragment', 'message'])
    }
  })

  test('opaque note between packed messages survives agent serialization', () => {
    const source = 'sequenceDiagram; A->>B: first; Note right of B: keep this; B-->>A: second;'
    const parsed = parseRegisteredMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const sequence = asSequence(parsed.value)
    expect(sequence).not.toBeNull()
    if (!sequence) return
    expect(sequence.body.statements.map(statement => statement.kind)).toEqual(['message', 'opaque-block', 'message'])
    const serialized = serializeMermaid(sequence)
    expect(serialized).toContain('Note right of B: keep this')
    const native = parseSequenceDiagram(serialized.trimEnd().split('\n').map(line => line.trim()))
    expect(native.messages.map(message => message.label)).toEqual(['first', 'second'])
    expect(native.notes.map(note => note.text)).toEqual(['keep this'])
  })

  test('comments and upstream hex block arguments consume the physical line', () => {
    expect(splitSequenceStatementLines(['%% comment; not a message', 'rect #ff0000; A->>B: hi; end;'])).toEqual([
      '%% comment; not a message', 'rect #ff0000; A->>B: hi; end;',
    ])
  })

  test('a comment after a delimiter consumes the rest of its physical line', () => {
    const source = 'sequenceDiagram\n  A->>B: one; %% comment; B->>A: ghost\n  B->>A: two'
    expect(parseSequenceDiagram(source.split('\n').map(line => line.trim())).messages.map(message => message.label)).toEqual(['one', 'two'])
    const agent = parseRegisteredMermaid(source)
    expect(agent.ok).toBe(true)
    if (agent.ok) expect(asSequence(agent.value)?.body.messages.map(message => message.text)).toEqual(['one', 'two'])
  })

  test('multiline accessibility description keeps its literal semicolon', () => {
    const parsed = parseSequenceDiagram(['sequenceDiagram', 'accTitle: First; second', 'accDescr {', 'first; second', '}', 'A->>B: hi'])
    expect(parsed.accessibilityTitle).toBe('First; second')
    expect(parsed.accessibilityDescription).toBe('first; second')
    expect(parsed.messages.map(message => message.label)).toEqual(['hi'])
    const oneLine = parseSequenceDiagram(['sequenceDiagram', 'accDescr: First; second', 'A->>B: hi'])
    expect(oneLine.accessibilityDescription).toBe('First; second')
  })

  test('packed accessibility directives are extracted before Sequence parsing', () => {
    const source = 'sequenceDiagram; accTitle: Hello; world'
    const native = parseSequenceDiagram([source])
    expect(native.accessibilityTitle).toBe('Hello; world')
    expect(renderMermaidSVG(source)).toContain('>Hello; world</title>')
    const agent = parseRegisteredMermaid(source)
    expect(agent.ok).toBe(true)
    if (agent.ok) expect(agent.value.meta.accessibility.title).toBe('Hello; world')

    expect(parseSequenceDiagram(['sequenceDiagram; accTitle First; second']).accessibilityTitle).toBe('First; second')
    expect(parseSequenceDiagram(['sequenceDiagram', 'accDescr: {', 'first; second', '}', 'A->>B: hi']).accessibilityDescription).toBe('first; second')
  })

  test('a packed accessibility block keeps inner semicolons and resumes after the closing brace', () => {
    const source = 'sequenceDiagram; accDescr { first; second }; A->>B: hi'
    const native = parseSequenceDiagram([source])
    expect(native.accessibilityDescription).toBe('first; second')
    expect(native.messages.map(message => message.label)).toEqual(['hi'])
    const agent = parseRegisteredMermaid(source)
    expect(agent.ok).toBe(true)
    if (agent.ok) {
      expect(agent.value.meta.accessibility.descr).toBe('first; second')
      expect(asSequence(agent.value)?.body.messages.map(message => message.text)).toEqual(['hi'])
    }
  })

  test('single-percent and hash comments stop later packed statements', () => {
    for (const marker of ['% comment', '# comment']) {
      const source = `sequenceDiagram\nA->>B: one; ${marker}; B->>A: ghost\nB->>A: two`
      expect(parseSequenceDiagram(source.split('\n')).messages.map(message => message.label)).toEqual(['one', 'two'])
      const agent = parseRegisteredMermaid(source)
      expect(agent.ok).toBe(true)
      if (agent.ok) expect(asSequence(agent.value)?.body.messages.map(message => message.text)).toEqual(['one', 'two'])
    }
    expect(parseSequenceDiagram(['sequenceDiagram', 'A->>B: one # comment; B->>A: ghost']).messages.map(message => message.label)).toEqual(['one'])
    const note = parseSequenceDiagram(['sequenceDiagram', 'Note right of A: keep # comment; A->>B: ghost'])
    expect(note.notes.map(value => value.text)).toEqual(['keep'])
    expect(note.messages).toHaveLength(0)
    const participant = parseSequenceDiagram(['sequenceDiagram', 'participant A as Alice # comment; A->>B: ghost', 'A->>B: real'])
    expect(participant.actors.find(actor => actor.id === 'A')?.label).toBe('Alice')
    expect(participant.messages.map(message => message.label)).toEqual(['real'])
    const rect = parseSequenceDiagram(['sequenceDiagram', 'rect # comment; A->>B: ghost', 'end', 'A->>B: real'])
    expect(rect.messages.map(message => message.label)).toEqual(['real'])
  })

  test('participant metadata retains a semicolon inside its JSON-like alias', () => {
    const source = 'sequenceDiagram\nparticipant A@{ "alias": "A; B" }; A->>B: hi'
    const native = parseSequenceDiagram(source.split('\n').map(line => line.trim()))
    expect(native.actors.find(actor => actor.id === 'A')?.label).toBe('A; B')
    expect(native.messages.map(message => message.label)).toEqual(['hi'])
    const agent = parseRegisteredMermaid(source)
    expect(agent.ok).toBe(true)
    if (agent.ok) expect(asSequence(agent.value)?.body.participants.find(actor => actor.id === 'A')?.label).toBe('A; B')
  })

  test('the reviewer-facing after SVG and PNG match the production renderer', () => {
    const asset = (name: string): string => join(import.meta.dir, '..', '..', 'docs', 'pr-assets', name)
    const source = readFileSync(asset('issue-264-separator.mmd'), 'utf8')
    expect(renderMermaidSVG(source, { embedFontImport: false })).toBe(readFileSync(asset('issue-264-separator-after.svg'), 'utf8'))
    expect(Buffer.from(renderMermaidPNG(source, { scale: 1 }))).toEqual(readFileSync(asset('issue-264-separator-after.png')))
  })
})
