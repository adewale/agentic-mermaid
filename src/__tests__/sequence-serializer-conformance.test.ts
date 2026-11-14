/**
 * Sequence serializer → RENDERER-parser conformance guard (P3 pattern, scoped
 * to the constructs this elevation added: box segments, indexed inserts,
 * moves, participant relabels).
 *
 * The fidelity contract: any form the agent serializer emits after a
 * SUCCEEDING op must re-parse through the renderer's parser
 * (src/sequence/parser.ts) to the same structure the op promised. This is the
 * seam where the audit found silent-loss bugs in four families
 * (flowchart-parser-conformance.test.ts is the pattern being extended).
 */
import { afterAll, beforeAll, describe, test, expect } from 'bun:test'
import { parseSequenceDiagram } from '../sequence/parser.ts'
import { parseRegisteredMermaid as parseMermaid } from '../agent/parse.ts'
import { serializeMermaid } from '../agent/serialize.ts'
import { mutate } from '../agent/mutate.ts'
import { asSequence } from '../agent/types.ts'
import { renderMermaidASCII, renderMermaidSVG } from '../agent/index.ts'
import { verifyMermaid } from '../agent/verify.ts'
import { describeMermaidFacts } from '../agent/facts.ts'
import { startUpstreamMermaid } from './helpers/upstream-mermaid.ts'
import { projectEntityMarkers } from '../shared/mermaid-entity-display.ts'
import type { SequenceValidDiagram, SequenceMutationOp } from '../agent/types.ts'

function sequence(src: string): SequenceValidDiagram {
  const r = parseMermaid(src)
  if (!r.ok) throw new Error('parse: ' + JSON.stringify(r.error))
  const s = asSequence(r.value)
  if (!s) throw new Error('not a structured sequence body')
  return s
}

function apply(d: SequenceValidDiagram, op: SequenceMutationOp): SequenceValidDiagram {
  const r = mutate(d, op)
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`)
  return r.value
}

/** Re-parse serialized agent output through the RENDERER parser. */
function renderParse(source: string) {
  const lines = source.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('%%'))
  return parseSequenceDiagram(lines)
}

const BOXED = `sequenceDiagram
  box Aqua Team A
    participant A as Alice
    participant B as Bob
  end
  A->>B: one
  B-->>A: two`

describe('sequence serializer → renderer-parser conformance (new constructs)', () => {
  test.each([
    'sequenceDiagram A->>B: first',
    'sequenceDiagram participant A as Alice\nA->>B: first',
    'sequenceDiagram A->>B: first; B-->>A: second',
  ])('inline header content reads as on its own line, through typed parse and serialization: %s', source => {
    const parsed = parseMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    expect(parsed.value.body.kind).toBe('sequence')
    const serialized = serializeMermaid(parsed.value)
    expect(renderParse(serialized)).toEqual(renderParse(source.replace(/^sequenceDiagram /, 'sequenceDiagram\n')))
    const reloaded = parseMermaid(serialized)
    expect(reloaded.ok).toBe(true)
    if (!reloaded.ok) throw new Error(JSON.stringify(reloaded.error))
    expect(serializeMermaid(reloaded.value)).toBe(serialized)
  })

  test('boxed body: serialize keeps the box parseable by the renderer', () => {
    const d = sequence(BOXED)
    const rendered = renderParse(serializeMermaid(d))
    expect(rendered.boxes).toHaveLength(1)
    expect(rendered.boxes![0]!.label).toBe('Team A')
    expect(rendered.boxes![0]!.color).toBe('Aqua')
    expect(rendered.boxes![0]!.actorIds).toEqual(['A', 'B'])
    expect(rendered.messages.map(m => m.label)).toEqual(['one', 'two'])
  })

  test('ops on a boxed body keep renderer-visible structure consistent', () => {
    let d = sequence(BOXED)
    d = apply(d, { kind: 'add_message', from: 'B', to: 'A', text: 'mid', index: 1 })
    d = apply(d, { kind: 'move_message', from: 2, to: 0 })
    d = apply(d, { kind: 'set_participant_label', id: 'A', label: 'Alicia' })
    const rendered = renderParse(serializeMermaid(d))
    // Top-level messages in the mutated order, all visible to the renderer
    expect(rendered.messages.map(m => m.label)).toEqual(d.body.messages.map(m => m.text))
    // The relabel is what the renderer will draw
    expect(rendered.actors.find(a => a.id === 'A')!.label).toBe('Alicia')
    // Box intact
    expect(rendered.boxes).toHaveLength(1)
    expect(rendered.boxes![0]!.actorIds).toContain('A')
  })

  test('set_participant_label survives renderer parse for adversarial labels', () => {
    const labels = ['Retry (up to 3x)', 'a as b', 'x -> y', 'Bob & Carol', '50% done']
    for (const label of labels) {
      const d = apply(sequence('sequenceDiagram\n  A->>B: hi'), { kind: 'set_participant_label', id: 'A', label })
      const rendered = renderParse(serializeMermaid(d))
      expect(rendered.actors.find(a => a.id === 'A')!.label).toBe(label)
      expect(rendered.messages).toHaveLength(1)
    }
  })

  test('indexed insert and move keep renderer message order equal to body order', () => {
    const src = 'sequenceDiagram\n  A->>B: m0\n  B->>A: m1\n  A->>B: m2'
    let d = sequence(src)
    d = apply(d, { kind: 'add_message', from: 'A', to: 'B', text: 'mNew', index: 0 })
    d = apply(d, { kind: 'move_message', from: 3, to: 1 })
    const rendered = renderParse(serializeMermaid(d))
    expect(rendered.messages.map(m => m.label)).toEqual(d.body.messages.map(m => m.text))
    // Idempotence: a second serialize of the re-parsed agent body is stable
    const again = sequence(serializeMermaid(d))
    expect(serializeMermaid(again)).toBe(serializeMermaid(d))
  })
})


describe('sequence identities survive portable structured writing', () => {
  let upstream: ReturnType<typeof startUpstreamMermaid>
  beforeAll(() => { upstream = startUpstreamMermaid() })
  afterAll(async () => { await upstream.close() })

  test.each([
    '%% keep the authored identity\nsequenceDiagram\nactor :',
    'sequenceDiagram participant > as h',
    'sequenceDiagram\nparticipant <',
    'sequenceDiagram\nactor @',
    'sequenceDiagram\nparticipant :@',
    'sequenceDiagram\nparticipant >@{ "type": "database", "alias": "Store" }',
  ])('damaged or unportable declarations require repair before typed admission: %s', async source => {
    expect(await upstream.accepts(source)).toBe(false)
    const parsed = parseMermaid(source)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error).toContainEqual(expect.objectContaining({ code: 'PARSE_FAILED', message: expect.stringContaining('Sequence participant ID') }))
    expect(await upstream.publicAccepts('sequenceDiagram\nparticipant Control as Valid')).toBe(true)
  })

  test.each([
    'sequenceDiagram\nJ->%:',
    'sequenceDiagram\ne->right of:',
    'sequenceDiagram\ne->right of Bob: reply',
    'sequenceDiagram\nleft of->e:',
    'sequenceDiagram J->accDescr:',
    'sequenceDiagram\nalt retry\nJ->>accTitle: reply\nend',
    'sequenceDiagram\nlink >: @http:',
  ])('unwritable identities retain authored source and native drawing: %s', async source => {
    expect(await upstream.accepts(source)).toBe(false)
    const parsed = parseMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    expect(parsed.value.body.kind).toBe('opaque')
    expect(serializeMermaid(parsed.value)).toBe(source + '\n')
    expect(renderMermaidSVG(parsed.value)).toBe(renderMermaidSVG(source))
    expect(renderMermaidASCII(parsed.value)).toBe(renderMermaidASCII(source))
    const edited = mutate(parsed.value, { kind: 'add_participant', id: 'Safe' })
    expect(edited.ok).toBe(false)
    if (!edited.ok) expect(edited.error.code).toBe('INVALID_OP')
  })

  test('declaration boundaries and literal comment text cannot change the emitted message', async () => {
    for (const source of ['sequenceDiagram\nparticipant b\n@{->b:', 'sequenceDiagram\nloop\nb->e:%%\nend']) {
      const parsed = sequence(source)
      const written = serializeMermaid(parsed)
      const result = await upstream.parse(written)
      expect(result.ok, written).toBe(true)
      if (!result.ok || !result.sequence) throw new Error('Expected portable messages')
      const messages = result.sequence.messages.filter(message => message.from !== undefined && message.to !== undefined)
      expect(messages.map(({ from, to, message }) => ({ from, to, text: projectEntityMarkers(message) }))).toEqual(source.includes('participant')
        ? [{ from: '@{', to: 'b', text: '' }]
        : [{ from: 'b', to: 'e', text: '%%' }])
      expect(serializeMermaid(sequence(written))).toBe(written)
    }
  })

  test.each([
    'participant b',
    'participant b\n%% preserved comment',
    'participant b\nactivate b',
    'participant b\nactivate b\ndeactivate b',
    'participant b\ndestroy b',
  ])('metadata message boundaries survive insertion after %s', async prefix => {
    const source = `sequenceDiagram\n${prefix}\nA->>b: existing`
    expect(await upstream.accepts(source), source).toBe(true)
    const edited = apply(sequence(source), { kind: 'add_message', from: '@{', to: 'b', text: 'inserted', index: 0 })
    const written = serializeMermaid(edited)
    const result = await upstream.parse(written)
    expect(result.ok, written).toBe(true)
    if (!result.ok || !result.sequence) throw new Error('Expected portable messages')
    const expected = [
      { from: '@{', to: 'b', text: 'inserted' },
      { from: 'A', to: 'b', text: 'existing' },
    ]
    expect(result.sequence.messages.filter(message => message.from !== undefined && message.to !== undefined)
      .map(({ from, to, message }) => ({ from, to, text: projectEntityMarkers(message) }))).toEqual(expected)
    expect(renderParse(written).messages.map(({ from, to, label }) => ({ from, to, text: label }))).toEqual(expected)
    expect(serializeMermaid(sequence(written))).toBe(written)
  })

  test.each([
    'participant b;',
    'participant b\nactivate b;',
    'participant b;\n\n%% preserved comment',
    'activate b;',
  ])('metadata message boundaries survive preserved fragment source after %s', async prefix => {
    const source = `sequenceDiagram\nloop retry\n${prefix}\n@{->>b: preserved\nend`
    expect(await upstream.accepts(source), source).toBe(true)
    const parsed = sequence(source)
    expect(parsed.body.statements[0]!.kind).toBe('opaque-block')
    for (const diagram of [parsed, apply(parsed, { kind: 'add_participant', id: 'Control' })]) {
      const written = serializeMermaid(diagram)
      const result = await upstream.parse(written)
      expect(result.ok, written).toBe(true)
      if (!result.ok || !result.sequence) throw new Error('Expected portable preserved message')
      const expected = [{ from: '@{', to: 'b', text: 'preserved' }]
      expect(result.sequence.messages.filter(message => message.from !== undefined && message.to !== undefined)
        .map(({ from, to, message }) => ({ from, to, text: projectEntityMarkers(message) }))).toEqual(expected)
      expect(renderParse(written).messages.map(({ from, to, label }) => ({ from, to, text: label }))).toEqual(expected)
      if (prefix.includes('\n\n')) expect(written).toContain('\n\n%% preserved comment')
      expect(serializeMermaid(sequence(written))).toBe(written)
    }
  })

  test('declarations, message references and aliases retain their distinct identity grammars', async () => {
    const source = `sequenceDiagram
participant % as Percent
actor accDescr as @: <>
participant participant
participant a+b
accDescr->>@: request
link @: Menu @ https://example.com
@->>A@B: reply
alt retry
A@B->>accDescr1: retry
end
A@B->>title:done
link title:Menu @ https://example.com/title
links title:{"":"http:"}`
    const parsed = sequence(source)
    const written = serializeMermaid(parsed)
    const result = await upstream.parse(written)
    expect(result.ok).toBe(true)
    if (!result.ok || !result.sequence) throw new Error('upstream rejected portable Sequence identities')
    const expectedIds = ['%', 'accDescr', 'participant', 'a+b', '@', 'A@B', 'accDescr1', 'title']
    expect(parsed.body.participants.map(participant => participant.id)).toEqual(expectedIds)
    expect(sequence(written).body.participants.map(participant => participant.id)).toEqual(expectedIds)
    expect(result.sequence.actors.map(actor => actor.name)).toEqual(expectedIds)
    expect(result.sequence.actors.find(actor => actor.name === 'accDescr')!.description).toBe('@: <>')
    expect(result.sequence.actors.find(actor => actor.name === '@')!.links).toEqual({ Menu: 'https://example.com' })
    expect(result.sequence.actors.find(actor => actor.name === 'title')!.links).toEqual({ Menu: 'https://example.com/title', '': 'http:' })
    expect(result.sequence.messages.filter(message => message.from).map(message => [message.from, message.to]))
      .toEqual([['accDescr', '@'], ['@', 'A@B'], ['A@B', 'accDescr1'], ['A@B', 'title']])
    expect(renderMermaidSVG(written)).toBe(renderMermaidSVG(parsed))
    expect(renderMermaidSVG(parsed)).toBe(renderMermaidSVG(source))
  })

  const invalidOps: SequenceMutationOp[] = [
    { kind: 'add_participant', id: '>', label: 'Name' },
    { kind: 'add_participant', id: '@', participantKind: 'actor' },
    { kind: 'add_message', from: 'A', to: 'accDescr', text: 'reply' },
    { kind: 'add_message', from: '%', to: 'A', text: 'request' },
    { kind: 'add_message', from: 'participant', to: 'A', text: 'request' },
    { kind: 'add_fragment_message', fragmentIndex: 0, from: 'A', to: 'accTitle', text: 'reply' },
    { kind: 'add_fragment_message', fragmentIndex: 0, from: 'A', to: 'a+b', text: 'reply' },
    { kind: 'set_participant_label', id: '@', label: 'Renamed' },
  ]
  test.each(invalidOps)('typed edits refuse identities that their target syntax cannot preserve: %j', op => {
    const parsed = sequence('sequenceDiagram\nA->>@: before\nalt retry\n@->>A: again\nend')
    const before = serializeMermaid(parsed)
    const result = mutate(parsed, op)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INVALID_OP')
    expect(serializeMermaid(parsed)).toBe(before)
  })

  test('typed edits keep legal punctuation in labels and declaration-only IDs', async () => {
    let parsed = sequence('sequenceDiagram\nA->>@: before')
    parsed = apply(parsed, { kind: 'add_participant', id: 'accDescr', label: ': < > @' })
    parsed = apply(parsed, { kind: 'add_message', from: 'accDescr', to: '@', text: 'after' })
    parsed = apply(parsed, { kind: 'add_message', from: '@', to: 'title', text: 'after' })
    parsed = apply(parsed, { kind: 'set_participant_label', id: 'A', label: ': < > @' })
    const written = serializeMermaid(parsed)
    expect(await upstream.accepts(written)).toBe(true)
    expect(sequence(written).body.participants).toEqual(parsed.body.participants)
    expect(sequence(written).body.messages.map(({ from, to, text }) => ({ from, to, text })))
      .toEqual(parsed.body.messages.map(({ from, to, text }) => ({ from, to, text })))
  })
})


// `create`/`destroy` are typed statements: ordinary lifecycle diagrams parse
// with no preserved segment, verify reads them without UNSUPPORTED_SYNTAX,
// they write back byte-for-byte, and Mermaid binds each directive to the same
// message ours draws it at. Typed edits keep that binding or are refused.
describe('sequence create/destroy are typed statements', () => {
  let upstream: ReturnType<typeof startUpstreamMermaid>
  beforeAll(() => { upstream = startUpstreamMermaid() })
  afterAll(async () => { await upstream.close() })

  /** Each created/destroyed participant and the message (from, to, text) it
   * binds to, by the renderer's parser and by pinned Mermaid. */
  async function bindings(source: string) {
    const rendered = renderParse(source)
    const ours = Object.fromEntries(rendered.actors.flatMap(actor => [
      ...(actor.createMessageIndex === undefined ? [] : [[`create ${actor.id}`, rendered.messages[actor.createMessageIndex]!]] as const),
      ...(actor.destroyMessageIndex === undefined ? [] : [[`destroy ${actor.id}`, rendered.messages[actor.destroyMessageIndex]!]] as const),
    ]).map(([key, m]) => [key, [m.from, m.to, m.label]]))
    const parsed = await upstream.parse(source)
    if (!parsed.ok || !parsed.sequence) return { ours, mermaid: parsed.ok ? 'no sequence' : parsed.error }
    const { messages, created, destroyed } = parsed.sequence
    const at = (index: number) => [messages[index]!.from, messages[index]!.to, projectEntityMarkers(messages[index]!.message)]
    const mermaid = Object.fromEntries([
      ...Object.entries(created).map(([id, index]) => [`create ${id}`, at(index)]),
      ...Object.entries(destroyed).map(([id, index]) => [`destroy ${id}`, at(index)]),
    ])
    return { ours, mermaid }
  }

  test.each([
    ['a destroyed receiver', 'participant A\n  participant B\n  A->>B: hi\n  destroy B\n  A->>B: bye', ['destroy B']],
    ['the Mermaid documentation example', 'Alice->>Bob: Hello Bob, how are you ?\n  Bob->>Alice: Fine, thank you. And you?\n  create participant Carl\n  Alice->>Carl: Hi Carl!\n  create actor D as Donald\n  Carl->>D: Hi!\n  destroy Carl\n  Alice-xCarl: We are too many\n  destroy Bob\n  Bob->>Alice: I agree', ['create Carl', 'create D', 'destroy Carl', 'destroy Bob']],
    ['a destroyed sender and self-message', 'A->>B: hi\n  destroy A\n  A-)B: leaving\n  destroy B\n  B->>B: done', ['destroy A', 'destroy B']],
    ['two participants destroyed by one message', 'A->>B: hi\n  destroy B\n  destroy A\n  A<<->>B: both', ['destroy A', 'destroy B']],
    ['a created participant with a wrapped alias', 'A->>B: hi\n  create participant C as wrap: A long created name\n  B->>+C: start\n  C-->>-B: done', ['create C']],
  ] as const)('%s parses typed, verifies and writes back unchanged', async (_name, body, directives) => {
    const source = `sequenceDiagram\n  ${body}\n`
    const parsed = sequence(source)
    expect(parsed.body.statements.filter(statement => statement.kind === 'opaque-block')).toEqual([])
    expect(parsed.body.statements.flatMap(statement => statement.kind === 'create' ? [`create ${statement.id}`] : statement.kind === 'destroy' ? [`destroy ${statement.actorId}`] : []).sort()).toEqual([...directives].sort())
    expect(verifyMermaid(source).warnings.filter(warning => warning.code === 'UNSUPPORTED_SYNTAX')).toEqual([])
    expect(describeMermaidFacts(parsed).filter(fact => /^(create|destroy) /.test(fact)).map(fact => `${fact.split(' ')[0]} ${fact.split(' ').at(fact.startsWith('create') ? 2 : 1)}`).sort()).toEqual([...directives].sort())
    const written = serializeMermaid(parsed)
    expect(written).toBe(source)
    const { ours, mermaid } = await bindings(written)
    expect(Object.keys(ours).sort()).toEqual([...directives].sort())
    expect(mermaid).toEqual(ours)
  })

  const SOURCE = 'sequenceDiagram\n  Alice->>Bob: Hello\n  create participant Carl\n  Alice->>Carl: Hi Carl!\n  create actor D as Donald\n  Carl->>D: Hi!\n  destroy Carl\n  Alice-xCarl: We are too many\n  destroy Bob\n  Bob->>Alice: I agree\n'
  test.each([
    ['relabels a created participant on its create line', { kind: 'set_participant_label', id: 'D', label: 'Daisy' }, '  create actor D as Daisy\n'],
    ['relabels a participant created without an alias', { kind: 'set_participant_label', id: 'Carl', label: 'Carlos' }, '  create participant Carl as Carlos\n'],
    ['removes a destroyed participant with its directive', { kind: 'remove_participant', id: 'Bob' }, '  Alice-xCarl: We are too many\n'],
    ['edits the destroying message', { kind: 'set_message_text', index: 3, text: 'Goodbye' }, '  destroy Carl\n  Alice-xCarl: Goodbye\n'],
  ] as const)('a typed edit %s and keeps every binding Mermaid reads', async (_name, op, line) => {
    const written = serializeMermaid(apply(sequence(SOURCE), op as SequenceMutationOp))
    expect(written).toContain(line)
    expect(written.includes('destroy Bob')).toBe(op.kind !== 'remove_participant')
    const { ours, mermaid } = await bindings(written)
    expect(mermaid).toEqual(ours)
    expect(sequence(written).body.statements.filter(statement => statement.kind === 'opaque-block')).toEqual([])
  })

  test.each([
    ['separates a destroy from its message', { kind: 'add_message', index: 3, from: 'Alice', to: 'D', text: 'interject' }, 'destroy Carl'],
    ['removes the message that creates a participant', { kind: 'remove_participant', id: 'Carl' }, '"create" is not received by "D"'],
  ] as const)('a typed edit that %s is refused', (_name, op, problem) => {
    const parsed = sequence(SOURCE)
    const result = mutate(parsed, op as SequenceMutationOp)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toEqual({ code: 'INVALID_OP', message: expect.stringContaining(problem) })
    expect(serializeMermaid(parsed)).toBe(SOURCE)
  })

  test('a lifecycle directive inside a preserved fragment is named by the opaque warning', () => {
    const source = 'sequenceDiagram\n  A->>B: hi\n  alt done\n    destroy B\n    A->>B: bye\n  end\n'
    expect(sequence(source).body.statements.map(statement => statement.kind)).toEqual(['message', 'opaque-block'])
    expect(verifyMermaid(source).warnings).toContainEqual(expect.objectContaining({
      code: 'UNSUPPORTED_SYNTAX', syntax: 'sequence_opaque_segment', message: expect.stringContaining('(alt fragment, destroy)'),
    }))
  })
})
