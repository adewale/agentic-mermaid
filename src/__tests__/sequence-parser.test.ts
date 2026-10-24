/**
 * Tests for the sequence diagram parser.
 *
 * Covers: participants, actors, messages (solid/dashed, filled/open arrows),
 * activation/deactivation, blocks (loop/alt/opt/par), notes, auto-created actors.
 */
import { describe, it, expect } from 'bun:test'
import { parseSequenceDiagram, readSequenceStatements } from '../sequence/parser.ts'
import { parseSequenceBody, renderSequence, sequenceUnsupportedSyntaxWarnings } from '../agent/sequence-body.ts'
import { parseRegisteredMermaid, asSequence, mutate, serializeMermaid } from '../agent/index.ts'
import { renderMermaidSVG } from '../index.ts'
import { verifyMermaid } from '../agent/verify.ts'

/** Helper to parse — preprocesses text the same way index.ts does */
function parse(text: string) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('%%'))
  return parseSequenceDiagram(lines)
}

// ============================================================================
// Actor / Participant declarations
// ============================================================================

describe('parseSequenceDiagram – actors', () => {
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

  it.each(['A+B', 'A/B', 'A\\B', 'A(B)', '$', '資料'])('keeps valid punctuation and Unicode declaration IDs: %s', id => {
    const source = `sequenceDiagram\nparticipant ${id} as Label :@`
    expect(parse(source).actors).toEqual([{ id, label: 'Label :@', type: 'participant' }])
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    expect(parse(serializeMermaid(parsed.value)).actors).toEqual([{ id, label: 'Label :@', type: 'participant' }])
  })

  it.each(['#35;', 'A#58;B', 'A#64;B', 'A#59;B'])('keeps entity-coded IDs and their message endpoints when relabeling: %s', id => {
    const source = `sequenceDiagram\nparticipant ${id} as Original\n${id}->>B: Message`
    const parsed = parseRegisteredMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    const sequence = asSequence(parsed.value)!
    expect(sequence.body.participants.map(participant => participant.id)).toEqual([id, 'B'])
    expect(sequence.body.messages).toMatchObject([{ from: id, to: 'B', text: 'Message' }])
    const edited = mutate(sequence, { kind: 'set_participant_label', id, label: 'Updated' })
    if (!edited.ok) throw new Error(JSON.stringify(edited.error))
    const rendered = parse(serializeMermaid(edited.value))
    expect(rendered.actors).toEqual([{ id, label: 'Updated', type: 'participant' }, { id: 'B', label: 'B', type: 'participant' }])
    expect(rendered.messages).toMatchObject([{ from: id, to: 'B', label: 'Message' }])
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
