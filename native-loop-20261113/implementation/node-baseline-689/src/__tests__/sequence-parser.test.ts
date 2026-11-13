/**
 * Tests for the sequence diagram parser.
 *
 * Covers: participants, actors, messages (solid/dashed, filled/open arrows),
 * activation/deactivation, blocks (loop/alt/opt/par), notes, auto-created actors.
 */
import { afterAll, beforeAll, describe, it, expect } from 'bun:test'
import { parseSequenceDiagram, readSequenceStatements } from '../sequence/parser.ts'
import { parseSequenceBody, renderSequence, sequenceUnsupportedSyntaxWarnings } from '../agent/sequence-body.ts'
import { parseRegisteredMermaid, asSequence, mutate, serializeMermaid } from '../agent/index.ts'
import { renderMermaidSVG } from '../index.ts'
import { verifyMermaid } from '../agent/verify.ts'
import { layoutSequenceDiagram } from '../sequence/layout.ts'
import { startUpstreamMermaid } from './helpers/upstream-mermaid.ts'

/** Helper to parse — preprocesses text the same way index.ts does */
function parse(text: string) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('%%'))
  return parseSequenceDiagram(lines)
}

describe('Sequence text wrapping controls', () => {
  it('separates controls from source text before decoding literal entities', () => {
    const diagram = parse('sequenceDiagram\nA->>B:wrap: Wrapped\nA->>B:nowrap: Unwrapped\nA->>B: #119;rap#58; Literal\nNote over A: :wrap: Note text')
    expect(diagram.messages.map(message => [message.label, message.wrap])).toEqual([
      ['Wrapped', true], ['Unwrapped', false], ['wrap: Literal', undefined],
    ])
    expect(diagram.notes[0]).toMatchObject({ text: 'Note text', wrap: true })
    for (const [payload, text, wrap] of [['wrap:nowrap: text', 'nowrap: text', true], ['WRAP: text', 'WRAP: text', undefined], [':nowrap: text', 'text', false]] as const) {
      const message = parse(`sequenceDiagram\nA->>B: ${payload}`).messages[0]!
      expect([message.label, message.wrap]).toEqual([text, wrap])
    }
  })

  it('preserves control fields through edits and protects directive-like literal typed text', () => {
    const parsed = parseRegisteredMermaid('sequenceDiagram\nA->>B:wrap: Original\nB->>A: Other')
    if (!parsed.ok) throw new Error('parse failed')
    const edited = mutate(parsed.value, { kind: 'set_message_text', index: 0, text: 'nowrap: literal payload' })
    if (!edited.ok) throw new Error('edit failed')
    const literal = mutate(edited.value, { kind: 'set_message_text', index: 1, text: ':wrap: literal payload' })
    if (!literal.ok) throw new Error('edit failed')
    const written = serializeMermaid(literal.value)
    expect(parse(written).messages.map(message => [message.label, message.wrap])).toEqual([
      ['nowrap: literal payload', true], [':wrap: literal payload', undefined],
    ])
    const unwrapped = mutate(literal.value, { kind: 'set_message_wrap', index: 0, wrap: false })
    if (!unwrapped.ok) throw new Error('wrap edit failed')
    expect(parse(serializeMermaid(unwrapped.value)).messages[0]).toMatchObject({ label: 'nowrap: literal payload', wrap: false })
    expect(parseRegisteredMermaid(written)).toMatchObject({ ok: true, value: { body: { messages: [{ text: 'nowrap: literal payload', wrap: true }, { text: ':wrap: literal payload' }] } } })
  })

  it('uses wrap and nowrap in measured message and note geometry without altering payloads', () => {
    const text = 'The reviewer needs enough detail to understand this complete message and its context'
    const wrapped = layoutSequenceDiagram(parse(`sequenceDiagram\nA->>B:wrap: ${text}\nNote over B:wrap: ${text}`))
    const unwrapped = layoutSequenceDiagram(parse(`sequenceDiagram\nA->>B:nowrap: ${text}\nNote over B:nowrap: ${text}`))
    expect(wrapped.messages[0]!.labelPosition.block!.lines.length).toBeGreaterThan(1)
    expect(unwrapped.messages[0]!.labelPosition.block!.lines).toEqual([text])
    expect(wrapped.notes[0]!.block!.lines.length).toBeGreaterThan(1)
    expect(unwrapped.notes[0]!.block!.lines).toEqual([text])
    expect(wrapped.messages[0]!.label).toBe(text)
    expect(wrapped.notes[0]!.text).toBe(text)
  })

  it('edits fragment message wrapping independently of literal text', () => {
    const parsed = parseRegisteredMermaid('sequenceDiagram\nloop Work\nA->>B:wrap: Original\nend')
    if (!parsed.ok) throw new Error('parse failed')
    const unwrapped = mutate(parsed.value, { kind: 'set_fragment_message_wrap', fragmentIndex: 0, index: 0, wrap: false })
    if (!unwrapped.ok) throw new Error('wrap edit failed')
    const edited = mutate(unwrapped.value, { kind: 'set_fragment_message_text', fragmentIndex: 0, index: 0, text: 'wrap: literal' })
    if (!edited.ok) throw new Error('text edit failed')
    expect(parse(serializeMermaid(edited.value)).messages[0]).toMatchObject({ label: 'wrap: literal', wrap: false })
    const inherited = mutate(edited.value, { kind: 'set_fragment_message_wrap', fragmentIndex: 0, index: 0, wrap: null })
    if (!inherited.ok) throw new Error('wrap reset failed')
    const message = parse(serializeMermaid(inherited.value)).messages[0]!
    expect([message.label, message.wrap]).toEqual(['wrap: literal', undefined])
  })

  it('keeps controls on aliases, boxes and fragment captions through edits and layout', () => {
    const text = 'A long caption that explains the complete interaction and the people who take part in it'
    const source = `sequenceDiagram\nbox transparent wrap: ${text}\nparticipant A as wrap: ${text}\nend\nparticipant B as nowrap: ${text}\nalt wrap: ${text}\nA->>B: work\nelse nowrap: ${text}\nB->>A: done\nend`
    const native = parse(source)
    expect(native.actors.map(actor => [actor.label, actor.wrap])).toEqual([[text, true], [text, false]])
    expect(native.boxes?.[0]).toMatchObject({ label: text, wrap: true })
    expect(parse('sequenceDiagram\nrect wrap: rgb(240, 240, 240)\nA->>B: work\nend').blocks[0]).toMatchObject({ type: 'rect', color: 'rgb(240, 240, 240)' })
    expect(native.blocks[0]).toMatchObject({ label: text, wrap: true, dividers: [{ label: text, wrap: false }] })
    const positioned = layoutSequenceDiagram(native)
    expect(positioned.actors[0]!.labelPosition.block!.lines.length).toBeGreaterThan(1)
    expect(positioned.actors[1]!.labelPosition.block!.lines).toEqual([text])
    expect(positioned.boxes[0]!.block!.lines.length).toBeGreaterThan(1)
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw new Error('parse failed')
    const alias = mutate(parsed.value, { kind: 'set_participant_label', id: 'A', label: 'nowrap: literal alias' })
    if (!alias.ok) throw new Error('alias edit failed')
    const caption = mutate(alias.value, { kind: 'set_fragment_label', index: 0, label: 'nowrap: literal caption' })
    if (!caption.ok) throw new Error('caption edit failed')
    const reread = parse(serializeMermaid(caption.value))
    expect(reread.actors[0]).toMatchObject({ label: 'nowrap: literal alias', wrap: true })
    expect(reread.blocks[0]).toMatchObject({ label: 'nowrap: literal caption', wrap: true, dividers: [{ label: text, wrap: false }] })
  })
})

// ============================================================================
// Actor / Participant declarations
// ============================================================================

describe('parseSequenceDiagram – actors', () => {
  let upstream: ReturnType<typeof startUpstreamMermaid>
  beforeAll(() => { upstream = startUpstreamMermaid() })
  afterAll(() => upstream.close())
  it.each(['participant :@', 'participant A@', 'participant A,B@{ "type": "database" }', 'create participant :@'])('refuses damaged declaration identities without inventing a participant: %s', declaration => {
    const source = `sequenceDiagram\n${declaration}`
    expect(() => parse(source)).toThrow('Sequence participant ID')
    expect(readSequenceStatements([declaration]).issues).toContainEqual({ syntax: 'sequence_participant_id', line: 0, message: expect.stringContaining('Sequence participant ID') })
    expect(() => parseSequenceBody([declaration])).toThrow('Sequence participant ID')
    expect(() => renderSequence({ kind: 'sequence', participants: [], messages: [], statements: [{ kind: 'opaque-block', lines: [declaration] }] })).toThrow('Sequence participant ID')
  })

  it.each([
    ['participant note:0 as Authored', 'note:0', 'Authored', 'participant'],
    ['actor B:start as Named', 'B:start', 'Named', 'actor'],
    ['participant title:C@{ "type": "control", "alias": "Control" }', 'title:C', 'Control', 'control'],
    ['create participant item:0 as Created', 'item:0', 'Created', 'participant'],
  ] as const)('preserves clear native colon IDs but refuses a typed body that cannot write them: %s', (declaration, id, label, type) => {
    const source = `sequenceDiagram\n${declaration}\nparticipant A as Before\nA->>B: Unchanged`
    expect(parse(source).actors[0]).toEqual({ id, label, type })
    expect(sequenceUnsupportedSyntaxWarnings(source)).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax: 'sequence_participant_id_extension', line: 2 }))
    const parsed = parseRegisteredMermaid(source)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error).toContainEqual(expect.objectContaining({ code: 'PARSE_FAILED', message: expect.stringContaining('rename this ID and its references') }))
    expect(() => parseSequenceBody([declaration])).toThrow('Typed editing and serialization require a portable ID')
    expect(() => renderSequence({ kind: 'sequence', participants: [], messages: [], statements: [{ kind: 'opaque-block', lines: [declaration] }] })).toThrow('Typed editing and serialization require a portable ID')
    expect(verifyMermaid(source).warnings).toContainEqual(expect.objectContaining({ code: 'RENDER_FAILED', origin: 'source', reason: expect.stringContaining('Typed editing and serialization require a portable ID') }))
  })

  it.each(['A+B', 'A/B', 'A\\B', 'A(B)', 'create)', '$', '資料'])('keeps valid punctuation and Unicode declaration IDs: %s', id => {
    const source = `sequenceDiagram\nparticipant ${id} as Label :@`
    expect(parse(source).actors).toEqual([{ id, label: 'Label :@', type: 'participant' }])
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    expect(parse(serializeMermaid(parsed.value)).actors).toEqual([{ id, label: 'Label :@', type: 'participant' }])
  })

  it.each([['create)', true], ['destroy)', true], ['actor)', true], ['loop)', false], ['end)', true], ['right of)', true]] as const)('keeps keyword-prefixed message ID %s source-only', async (id, sender) => {
    // A leading loop) is already a block opener, not a native message.
    for (const [from, to] of sender ? [['A', id], [id, 'A']] : [['A', id]]) {
      const source = `sequenceDiagram\n${from}<<->>${to}: Message`
      expect(await upstream.publicAccepts(source)).toBe(false)
      expect(parse(source).messages).toMatchObject([{ from, to, label: 'Message' }])
      const parsed = parseRegisteredMermaid(source)
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
      expect(parsed.value.body.kind).toBe('opaque')
      expect(serializeMermaid(parsed.value)).toBe(source + '\n')
      expect(verifyMermaid(source).warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax: 'sequence_message_id_extension' }))
      expect(mutate(parsed.value, { kind: 'add_participant', id: 'Other' }).ok).toBe(false)
    }
    const control = `sequenceDiagram\nA->>created): Message`
    expect(await upstream.publicAccepts(control)).toBe(true)
    expect(parseRegisteredMermaid(control).ok).toBe(true)
  })

  it.each([
    ['#35;', 'ﬂ°°35¶ß'], ['A#58;B', 'Aﬂ°°58¶ßB'],
    ['A#64;B', 'Aﬂ°°64¶ßB'], ['A#59;B', 'Aﬂ°°59¶ßB'],
  ])('keeps entity-coded IDs and their message endpoints when relabeling: %s', async (id, referenceId) => {
    const source = `sequenceDiagram\nparticipant ${id} as wrap: Original\n${id}->>B: Message`
    const parsed = parseRegisteredMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    const sequence = asSequence(parsed.value)!
    expect(sequence.body.participants.map(participant => participant.id)).toEqual([id, 'B'])
    expect(sequence.body.messages).toMatchObject([{ from: id, to: 'B', text: 'Message' }])
    const edited = mutate(sequence, { kind: 'set_participant_label', id, label: 'Updated' })
    if (!edited.ok) throw new Error(JSON.stringify(edited.error))
    const written = serializeMermaid(edited.value)
    const rendered = parse(written)
    expect(rendered.actors).toEqual([{ id, label: 'Updated', type: 'participant', wrap: true }, { id: 'B', label: 'B', type: 'participant' }])
    expect(rendered.messages).toMatchObject([{ from: id, to: 'B', label: 'Message' }])
    for (const [candidate, label] of [[source, 'Original'], [written, 'Updated']]) {
      const reference = await upstream.parse(candidate!)
      expect(reference.ok).toBe(true)
      if (!reference.ok || !reference.sequence) throw new Error('Pinned Sequence reference rejected entity-coded identity')
      expect(reference.sequence.actors.map(actor => actor.name)).toEqual([referenceId, 'B'])
      expect(reference.sequence.actors[0]!.description).toBe(label!)
      expect(reference.sequence.messages).toMatchObject([{ from: referenceId, to: 'B', message: 'Message' }])
      const wrapping = await upstream.project(candidate!, diagram => [...diagram.db.getActors().values()].map(actor => actor.wrap))
      expect(wrapping).toEqual({ ok: true, value: [true, false] })
    }
  })

  it('keeps entity-bearing multiword ACTOR tokens and explicit message wrapping through edits', async () => {
    const source = 'sequenceDiagram\nFirst #35; Person->>Second Person: nowrap: before'
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok || parsed.value.body.kind !== 'sequence') throw new Error('Expected structured Sequence')
    expect(parsed.value.body.participants.map(actor => actor.id)).toEqual(['First #35; Person', 'Second Person'])
    expect(parsed.value.body.messages).toMatchObject([{ from: 'First #35; Person', to: 'Second Person', text: 'before', wrap: false }])
    const edited = mutate(parsed.value, { kind: 'set_message_text', index: 0, text: 'wrap: literal' })
    if (!edited.ok) throw new Error(edited.error.message)
    const written = serializeMermaid(edited.value)
    const reference = await upstream.parse(written)
    expect(reference.ok).toBe(true)
    if (!reference.ok || !reference.sequence) throw new Error('Pinned reference rejected complete ACTOR tokens')
    expect(reference.sequence.actors.map(actor => actor.name)).toEqual(['First ﬂ°°35¶ß Person', 'Second Person'])
    expect(reference.sequence.messages).toMatchObject([{ from: 'First ﬂ°°35¶ß Person', to: 'Second Person', message: 'wrap: literal' }])
    const wrapping = await upstream.project(written, diagram => diagram.db.getMessages().find((message: any) => message.from).wrap)
    expect(wrapping).toEqual({ ok: true, value: false })
    const added = mutate(edited.value, { kind: 'add_participant', id: 'New #35; Person' })
    if (!added.ok || added.value.body.kind !== 'sequence') throw new Error('Expected a bare identity-preserving declaration')
    expect(added.value.body.participants.at(-1)).toMatchObject({ id: 'New #35; Person', label: 'New # Person' })
    const addedSource = serializeMermaid(added.value)
    const addedReference = await upstream.parse(addedSource)
    if (!addedReference.ok || !addedReference.sequence) throw new Error('Pinned reference rejected the bare declaration')
    expect(addedReference.sequence.actors.map(actor => actor.name)).toEqual(['First ﬂ°°35¶ß Person', 'Second Person', 'New ﬂ°°35¶ß Person'])
    const reloaded = parseRegisteredMermaid(addedSource)
    expect(reloaded.ok && reloaded.value.body).toEqual(added.value.body)
    const before = serializeMermaid(edited.value)
    expect(mutate(edited.value, { kind: 'set_participant_label', id: 'Second Person', label: 'Lost alias' }).ok).toBe(false)
    expect(serializeMermaid(edited.value)).toBe(before)
    expect(await upstream.publicAccepts('sequenceDiagram\nControl->>Other: valid')).toBe(true)
  })

  it.each([':@', '#hash', 'A#B', 'note:0'])('typed participant additions refuse declaration delimiters before creating identity %s', id => {
    const parsed = parseRegisteredMermaid('sequenceDiagram\nparticipant A')
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    const sequence = asSequence(parsed.value)!
    expect(mutate(sequence, { kind: 'add_participant', id })).toMatchObject({ ok: false, error: { code: 'INVALID_OP', message: expect.stringContaining('Sequence participant ID') } })
    const draft = structuredClone(sequence)
    draft.body.participants[0]!.id = id
    expect(() => serializeMermaid(draft)).toThrow('Sequence participant ID')
  })

  it('refuses to relabel a message-only ID that cannot be declared, without changing the message', () => {
    const parsed = parseRegisteredMermaid('sequenceDiagram\nA@->>B: Hello')
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    const sequence = asSequence(parsed.value)!
    expect(mutate(sequence, { kind: 'set_participant_label', id: 'A@', label: 'Alias' })).toMatchObject({ ok: false, error: { code: 'INVALID_OP', message: expect.stringContaining('Sequence participant ID') } })
    expect(sequence.body.messages).toMatchObject([{ from: 'A@', to: 'B', text: 'Hello' }])
  })

  it.each(['', ' ', '\t'])('reads participant metadata after separator %j', separator => {
    const source = `sequenceDiagram\nparticipant Harry${separator}@{ "type": "database", "alias": "Orders" }\nHarry->>Harry: Save`
    expect(() => parse(source)).not.toThrow()
    const diagram = parse(source)
    expect(diagram.actors).toEqual([expect.objectContaining({ id: 'Harry', label: 'Orders', type: 'database' })])
    expect(diagram.messages).toEqual([expect.objectContaining({ from: 'Harry', to: 'Harry', label: 'Save' })])
  })

  it('parses participant declarations', () => {
    const d = parse(`sequenceDiagram
      participant A as Alice
      participant B as Bob
      A->>B: Hello`)
    expect(d.actors).toHaveLength(2)
    expect(d.actors[0]!.id).toBe('A')
    expect(d.actors[0]!.label).toBe('Alice')
    expect(d.actors[0]!.type).toBe('participant')
  })

  it('keeps the actor and label when as is immediately followed by alias text', () => {
    const source = 'sequenceDiagram\n  participant X_AutoPublishable asAAAAAAAAAAAAA:AAAAAAAAAAAAA'
    const expected = [{ id: 'X_AutoPublishable', label: 'AAAAAAAAAAAAA:AAAAAAAAAAAAA', type: 'participant' as const }]
    expect(parse(source).actors).toEqual(expected)
    const parsed = parseRegisteredMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    const sequence = asSequence(parsed.value)
    expect(sequence).not.toBeNull()
    if (!sequence) throw new Error(`Expected sequence, got ${parsed.value.body.kind}`)
    expect(sequence.body.participants).toEqual([{ id: 'X_AutoPublishable', label: 'AAAAAAAAAAAAA:AAAAAAAAAAAAA', kind: 'participant' }])
    const edited = mutate(sequence, { kind: 'set_participant_label', id: 'X_AutoPublishable', label: 'Updated' })
    expect(edited.ok).toBe(true)
    if (!edited.ok) throw new Error(JSON.stringify(edited.error))
    expect(parse(serializeMermaid(edited.value)).actors).toEqual([{ ...expected[0]!, label: 'Updated' }])
    const svg = renderMermaidSVG(source)
    expect(svg).toContain('data-id="X_AutoPublishable"')
    expect(svg).toContain('AAAAAAAAAAAAA:AAAAAAAAAAAAA')
    expect(verifyMermaid(source).warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax: 'sequence_unspaced_alias', line: 2 }))
    const canonical = serializeMermaid(sequence)
    expect(canonical).toContain('participant X_AutoPublishable as AAAAAAAAAAAAA:AAAAAAAAAAAAA')
    expect(parse(canonical).actors).toEqual(expected)
    expect(verifyMermaid(canonical).warnings.map(warning => warning.code === 'UNSUPPORTED_SYNTAX' ? warning.syntax : warning.code)).not.toContain('sequence_unspaced_alias')
  })

  it('parses actor declarations (stick figures)', () => {
    const d = parse(`sequenceDiagram
      actor U as User
      participant S as System
      U->>S: Click`)
    expect(d.actors[0]!.type).toBe('actor')
    expect(d.actors[1]!.type).toBe('participant')
  })

  it('auto-creates participants from messages', () => {
    const d = parse(`sequenceDiagram
      Alice->>Bob: Hello`)
    expect(d.actors).toHaveLength(2)
    expect(d.actors[0]!.id).toBe('Alice')
    expect(d.actors[0]!.label).toBe('Alice')
    expect(d.actors[0]!.type).toBe('participant')
  })

  it('does not duplicate declared actors when also used in messages', () => {
    const d = parse(`sequenceDiagram
      participant A as Alice
      A->>B: Hello
      B->>A: Hi`)
    expect(d.actors).toHaveLength(2)
    expect(d.actors[0]!.label).toBe('Alice')
    expect(d.actors[1]!.id).toBe('B')
  })

  it('participant without alias uses id as label', () => {
    const d = parse(`sequenceDiagram
      participant Server
      Server->>Server: Ping`)
    expect(d.actors[0]!.label).toBe('Server')
  })
})

// ============================================================================
// Messages
// ============================================================================

describe('parseSequenceDiagram – messages', () => {
  it('parses solid arrow message: A->>B', () => {
    const d = parse(`sequenceDiagram
      A->>B: Hello`)
    expect(d.messages).toHaveLength(1)
    expect(d.messages[0]!.from).toBe('A')
    expect(d.messages[0]!.to).toBe('B')
    expect(d.messages[0]!.label).toBe('Hello')
    expect(d.messages[0]!.lineStyle).toBe('solid')
    expect(d.messages[0]!.endHead).toBe('filled')
  })

  it('parses dashed arrow message: A-->>B', () => {
    const d = parse(`sequenceDiagram
      A-->>B: Response`)
    expect(d.messages[0]!.lineStyle).toBe('dashed')
    expect(d.messages[0]!.endHead).toBe('filled')
  })

  it('parses open arrow message: A-)B', () => {
    const d = parse(`sequenceDiagram
      A-)B: Async`)
    expect(d.messages[0]!.endHead).toBe('open')
    expect(d.messages[0]!.lineStyle).toBe('solid')
  })

  it('parses multiple messages in order', () => {
    const d = parse(`sequenceDiagram
      A->>B: First
      B->>C: Second
      C->>A: Third`)
    expect(d.messages).toHaveLength(3)
    expect(d.messages[0]!.label).toBe('First')
    expect(d.messages[1]!.label).toBe('Second')
    expect(d.messages[2]!.label).toBe('Third')
  })

  it('preserves standalone activate/deactivate commands in source order', () => {
    const d = parse(`sequenceDiagram
  participant A
  activate A
  A->>A: work
  deactivate A`)
    expect(d.activationEvents).toEqual([
      { actorId: 'A', kind: 'activate', messageIndex: 0 },
      { actorId: 'A', kind: 'deactivate', messageIndex: 1 },
    ])
  })

  it('parses activation marker (+)', () => {
    const d = parse(`sequenceDiagram
      A->>+B: Activate`)
    expect(d.messages[0]!.activate).toBe(true)
  })

  it('parses deactivation marker (-)', () => {
    const d = parse(`sequenceDiagram
      B-->>-A: Deactivate`)
    expect(d.messages[0]!.deactivate).toBe(true)
  })
})

// ============================================================================
// Blocks (loop, alt, opt, par)
// ============================================================================

describe('parseSequenceDiagram – blocks', () => {
  it('parses loop block', () => {
    const d = parse(`sequenceDiagram
      A->>B: Start
      loop Every 5s
        A->>B: Ping
      end
      A->>B: Done`)
    expect(d.blocks).toHaveLength(1)
    expect(d.blocks[0]!.type).toBe('loop')
    expect(d.blocks[0]!.label).toBe('Every 5s')
    expect(d.blocks[0]!.startIndex).toBe(1) // second message
  })

  it('parses alt/else block', () => {
    const d = parse(`sequenceDiagram
      A->>B: Request
      alt Success
        B->>A: 200 OK
      else Failure
        B->>A: 500 Error
      end`)
    expect(d.blocks).toHaveLength(1)
    expect(d.blocks[0]!.type).toBe('alt')
    expect(d.blocks[0]!.label).toBe('Success')
    expect(d.blocks[0]!.dividers).toHaveLength(1)
    expect(d.blocks[0]!.dividers[0]!.label).toBe('Failure')
  })

  it('parses opt block', () => {
    const d = parse(`sequenceDiagram
      opt Extra logging
        A->>Logger: Log
      end`)
    expect(d.blocks[0]!.type).toBe('opt')
  })

  it('parses par block with and dividers', () => {
    const d = parse(`sequenceDiagram
      par Task A
        A->>B: Do A
      and Task B
        A->>C: Do B
      end`)
    expect(d.blocks[0]!.type).toBe('par')
    expect(d.blocks[0]!.dividers).toHaveLength(1)
    expect(d.blocks[0]!.dividers[0]!.label).toBe('Task B')
  })
})

// ============================================================================
// Notes
// ============================================================================

describe('parseSequenceDiagram – notes', () => {
  it('parses "Note left of" note', () => {
    const d = parse(`sequenceDiagram
      A->>B: Hello
      Note left of A: Important note`)
    expect(d.notes).toHaveLength(1)
    expect(d.notes[0]!.position).toBe('left')
    expect(d.notes[0]!.actorIds).toEqual(['A'])
    expect(d.notes[0]!.text).toBe('Important note')
  })

  it('parses "Note right of" note', () => {
    const d = parse(`sequenceDiagram
      Note right of B: Side note
      A->>B: Hello`)
    expect(d.notes[0]!.position).toBe('right')
  })

  it('parses "Note over" spanning multiple actors', () => {
    const d = parse(`sequenceDiagram
      Note over A,B: Shared note
      A->>B: Hello`)
    expect(d.notes[0]!.position).toBe('over')
    expect(d.notes[0]!.actorIds).toEqual(['A', 'B'])
  })
})

// ============================================================================
// Full diagram
// ============================================================================

describe('parseSequenceDiagram – full diagram', () => {
  it('parses a complete authentication flow', () => {
    const d = parse(`sequenceDiagram
      participant C as Client
      participant S as Server
      participant DB as Database
      C->>S: POST /login
      S->>DB: SELECT user
      alt User found
        DB-->>S: User record
        S-->>C: 200 OK + token
      else Not found
        DB-->>S: null
        S-->>C: 401 Unauthorized
      end`)

    expect(d.actors).toHaveLength(3)
    expect(d.messages).toHaveLength(6)
    expect(d.blocks).toHaveLength(1)
    expect(d.blocks[0]!.type).toBe('alt')
    expect(d.blocks[0]!.dividers).toHaveLength(1)
  })
})
