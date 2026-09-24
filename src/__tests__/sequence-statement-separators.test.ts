import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseRegisteredMermaid } from '../agent/parse.ts'
import { mutate } from '../agent/mutate.ts'
import { renderMermaidPNG } from '../agent/png.ts'
import { serializeMermaid } from '../agent/serialize.ts'
import { asSequence } from '../agent/types.ts'
import { verifyMermaid } from '../agent/verify.ts'
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

  test('entity-heavy input stays bounded at the lexical boundary', () => {
    const bodyLine = `A->>B: ${'#59;'.repeat(16_000)}`
    const source = `sequenceDiagram\n${bodyLine}`
    expect(Buffer.byteLength(source)).toBeLessThan(64 * 1024)
    const started = performance.now()
    expect(splitSequenceStatementLines(source.split('\n'))).toEqual(['sequenceDiagram', bodyLine])
    expect(parseRegisteredMermaid(source).ok).toBe(true)
    // A growing-prefix/suffix copy at every entity took seconds through the
    // public parser even below the hosted 64 KiB input limit.
    expect(performance.now() - started).toBeLessThan(1_000)
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

  test('agent serialization preserves a packed comment without reviving following ghost statements', () => {
    const source = 'sequenceDiagram\nA->>B: one; %% important; B->>A: ghost\nB->>A: two'
    const parsed = parseRegisteredMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.meta.comments).toEqual([{ text: 'important; B->>A: ghost', line: 2 }])
    expect(parsed.value.meta.droppedComments).toBeUndefined()
    expect(verifyMermaid(parsed.value).warnings.some(warning => warning.code === 'COMMENT_DROPPED')).toBe(false)
    const serialized = serializeMermaid(parsed.value)
    expect(serialized).toContain('%% important; B->>A: ghost')
    expect(parseSequenceDiagram(serialized.trimEnd().split('\n')).messages.map(message => message.label)).toEqual(['one', 'two'])
  })

  test('a packed comment preserved in an opaque block does not raise a false loss warning', () => {
    const source = 'sequenceDiagram\nalt yes; %% important\nA->>B: hi\nend'
    const parsed = parseRegisteredMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.meta.comments).toEqual([{ text: 'important', line: 2 }])
    expect(serializeMermaid(parsed.value)).toContain('%% important')
    expect(parsed.value.meta.droppedComments).toBeUndefined()
    expect(verifyMermaid(parsed.value).warnings.some(warning => warning.code === 'COMMENT_DROPPED')).toBe(false)
  })

  test('accessibility block text is not confused with a later preserved packed comment', () => {
    const source = 'sequenceDiagram\naccDescr {\n%% literal\n}\nA->>B: one; %% real comment'
    const parsed = parseRegisteredMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.meta.comments).toEqual([{ text: 'real comment', line: 5 }])
    expect(parsed.value.meta.droppedComments).toBeUndefined()
    expect(serializeMermaid(parsed.value)).toContain('%% real comment')
    const suffix = parseRegisteredMermaid('sequenceDiagram\naccDescr {x}; %% important\nA->>B: hi')
    expect(suffix.ok).toBe(true)
    if (suffix.ok) {
      expect(suffix.value.meta.comments).toEqual([{ text: 'important', line: 2 }])
      expect(serializeMermaid(suffix.value)).toContain('%% important')
      expect(suffix.value.meta.droppedComments).toBeUndefined()
    }
  })

  test('comment-only segments remain nonsemantic for verification and participant removal', () => {
    const onlyComment = parseRegisteredMermaid('sequenceDiagram\n%% only a comment')
    expect(onlyComment.ok).toBe(true)
    if (!onlyComment.ok) return
    expect(serializeMermaid(onlyComment.value)).toContain('%% only a comment')
    const warnings = verifyMermaid(onlyComment.value).warnings
    expect(warnings.some(warning => warning.code === 'EMPTY_DIAGRAM')).toBe(true)
    expect(warnings.some(warning => warning.code === 'UNSUPPORTED_SYNTAX')).toBe(false)

    const named = parseRegisteredMermaid('sequenceDiagram\nparticipant A\n%% A is mentioned in a comment')
    expect(named.ok).toBe(true)
    if (!named.ok) return
    const body = asSequence(named.value)
    expect(body).not.toBeNull()
    if (body) expect(mutate(body, { kind: 'remove_participant', id: 'A' }).ok).toBe(true)
  })

  test('a large packed Sequence keeps its trailing comment without quadratic diffing', () => {
    const source = `sequenceDiagram\n${Array(1024).fill('A->>B: hi').join('; ')}; %% tail`
    const parsed = parseRegisteredMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(asSequence(parsed.value)?.body.messages).toHaveLength(1024)
    expect(serializeMermaid(parsed.value)).toContain('%% tail')
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
    const noteAgent = parseRegisteredMermaid('sequenceDiagram\nNote right of A: keep # comment; A->>B: ghost')
    expect(noteAgent.ok).toBe(true)
    if (noteAgent.ok) expect(serializeMermaid(noteAgent.value)).toContain('# comment; A->>B: ghost')
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
