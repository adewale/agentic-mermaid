import { describe, expect, test } from 'bun:test'
import mermaid from 'mermaid'
import { parseRegisteredMermaid } from '../agent/parse.ts'
import { serializeMermaid } from '../agent/serialize.ts'
import { asSequence } from '../agent/types.ts'
import { mutate } from '../agent/mutate.ts'
import { verifyMermaid } from '../agent/verify.ts'
import { renderMermaidSVG } from '../index.ts'
import { parseSequenceDiagram } from '../sequence/parser.ts'
import { parseSequenceBlockContinuation, parseSequenceBlockOpener } from '../sequence/block-keywords.ts'
import type { Block } from '../sequence/types.ts'

const CRITICAL = `sequenceDiagram
critical Establish a connection
  Service->>DB: connect
option Network timeout
  Service->>Service: log timeout
option Credentials rejected
  Service->>Service: log rejection
end
Service->>DB: after
`

const EXPECTED_BLOCK: Block = {
  type: 'critical', label: 'Establish a connection', startIndex: 0, endIndex: 2,
  dividers: [{ index: 1, label: 'Network timeout' }, { index: 2, label: 'Credentials rejected' }],
}

describe('Sequence critical/option keyword boundary', () => {
  test.each([
    ['a stray end', 'A->>B: before\nend'],
    ['an unclosed block', 'alt choice\nA->>B: inside'],
    ['a continuation for the wrong owner', 'alt choice\nA->>B: inside\nand another\nB->>A: after\nend'],
    ['a branch outside any block', 'A->>B: before\nelse alternative'],
  ])('rejects %s instead of drawing a different control flow', (_name, body) => {
    const source = `sequenceDiagram\n${body}\n`
    expect(() => renderMermaidSVG(source)).toThrow('SEQUENCE_BLOCK_BOUNDARY')
    const parsed = parseRegisteredMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    expect(parsed.value.body.kind).toBe('opaque')
    expect(serializeMermaid(parsed.value)).toBe(source)
    expect(verifyMermaid(source).warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax: 'sequence_block_boundary' }))
  })

  test('keeps nested unmodeled statements byte-for-byte while editing the following message', () => {
    const block = '  alt outer\n    loop nested\n      A->>B: inside\n      %% preserved note\n      future B keep-this\n    end\n  else alternate\n    B->>A: fallback\n  end'
    const parsed = parseRegisteredMermaid(`sequenceDiagram\n${block}\n  A->>B: after\n`)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    const diagram = asSequence(parsed.value)
    expect(diagram).not.toBeNull()
    if (!diagram) throw new Error(`Expected sequence, got ${parsed.value.body.kind}`)
    expect(diagram.body.messages.map(message => message.text)).toEqual(['after'])
    const edited = mutate(diagram, { kind: 'set_message_text', index: 0, text: 'edited' })
    expect(edited.ok).toBe(true)
    if (!edited.ok) throw new Error(JSON.stringify(edited.error))
    const serialized = serializeMermaid(edited.value)
    expect(serialized).toContain(`${block}\n  A->>B: edited`)
    const reloaded = parseRegisteredMermaid(serialized)
    expect(reloaded.ok).toBe(true)
    if (!reloaded.ok) throw new Error(JSON.stringify(reloaded.error))
    expect(asSequence(reloaded.value)?.body.messages.map(message => message.text)).toEqual(['edited'])
    expect(() => renderMermaidSVG(serialized)).toThrow('SEQUENCE_UNSUPPORTED_STATEMENT')
  })

  test('does not silently replace an unknown autonumber argument with default numbering', () => {
    const source = 'sequenceDiagram\nautonumber bananas\nA->>B: message\n'
    expect(() => renderMermaidSVG(source)).toThrow('SEQUENCE_UNSUPPORTED_STATEMENT')
    const parsed = parseRegisteredMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    expect(serializeMermaid(parsed.value)).toContain('autonumber bananas')
  })

  test('retains unmodeled participant metadata while projecting known identity and editing a message', () => {
    const declaration = '  participant A@{type: database, alias: Orders, future: keep-me}'
    const source = `sequenceDiagram\n${declaration}\n  A->>B: before\n`
    const parsed = parseRegisteredMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    const diagram = asSequence(parsed.value)
    if (!diagram) throw new Error(`Expected sequence, got ${parsed.value.body.kind}`)
    expect(diagram.body.participants[0]).toMatchObject({ id: 'A', label: 'Orders', kind: 'database' })
    const edited = mutate(diagram, { kind: 'set_message_text', index: 0, text: 'after' })
    expect(edited.ok).toBe(true)
    if (!edited.ok) throw new Error(JSON.stringify(edited.error))
    const serialized = serializeMermaid(edited.value)
    expect(serialized).toContain(`${declaration}\n  A->>B: after`)
    expect(parseSequenceDiagram(serialized.split('\n')).actors[0]).toMatchObject({ id: 'A', label: 'Orders', type: 'database' })
    expect(verifyMermaid(serialized).warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax: 'sequence_participant_metadata', line: 2 }))
    expect(mutate(edited.value, { kind: 'remove_participant', id: 'A' })).toMatchObject({ ok: false, error: { code: 'INVALID_OP' } })
  })

  test('native parser gives options to the critical block, not phantom opt blocks', () => {
    const diagram = parseSequenceDiagram(CRITICAL.split('\n'))
    expect(diagram.messages.map(message => message.label)).toEqual(['connect', 'log timeout', 'log rejection', 'after'])
    expect(diagram.blocks).toEqual([EXPECTED_BLOCK])
    const svg = renderMermaidSVG(CRITICAL)
    expect(svg).toContain('data-type="critical"')
    expect(svg).toContain('[Network timeout]')
    expect(svg).not.toContain('data-type="opt"')
  })

  test('packed separators preserve the same critical branches', () => {
    const packed = CRITICAL.split('\n').join('; ')
    expect(parseSequenceDiagram([packed]).blocks).toEqual([EXPECTED_BLOCK])
  })

  test('the pinned Mermaid DB identifies critical options, not opt openers', async () => {
    mermaid.initialize({ startOnLoad: false })
    const upstream = await mermaid.mermaidAPI.getDiagramFromText(CRITICAL)
    const db = upstream.db as unknown as {
      LINETYPE: { CRITICAL_START: number; SOLID: number; CRITICAL_OPTION: number; CRITICAL_END: number }
      getMessages(): Array<{ type: number; message: string }>
    }
    const kinds = db.getMessages().map(message => message.type)
    expect(kinds).toEqual([
      db.LINETYPE.CRITICAL_START, db.LINETYPE.SOLID, db.LINETYPE.CRITICAL_OPTION,
      db.LINETYPE.SOLID, db.LINETYPE.CRITICAL_OPTION, db.LINETYPE.SOLID,
      db.LINETYPE.CRITICAL_END, db.LINETYPE.SOLID,
    ])
  })

  test('opt and option have distinct lexical identities', () => {
    expect(parseSequenceBlockOpener('opt Optional')).toEqual({ type: 'opt', label: 'Optional' })
    expect(parseSequenceBlockOpener('option Recovery')).toBeNull()
    expect(parseSequenceBlockContinuation('option Recovery')).toEqual({ type: 'option', label: 'Recovery' })
    expect(parseSequenceBlockOpener('optional')).toBeNull()
    expect(parseSequenceBlockContinuation('optionally')).toBeNull()
    expect(parseSequenceBlockOpener('par_over Parallel overlap')).toEqual({ type: 'par_over', label: 'Parallel overlap' })
    expect(parseSequenceBlockOpener('opt(foo)')).toEqual({ type: 'opt', label: '(foo)' })
    expect(parseSequenceBlockOpener('critical:C')).toEqual({ type: 'critical', label: ':C' })
    expect(parseSequenceBlockOpener('par|label')).toEqual({ type: 'par', label: '|label' })
    expect(parseSequenceBlockOpener('par_over|label')).toEqual({ type: 'par_over', label: '|label' })
    expect(parseSequenceBlockContinuation('option:retry')).toEqual({ type: 'option', label: ':retry' })
    expect(parseSequenceBlockContinuation('option(retry)')).toEqual({ type: 'option', label: '(retry)' })
    expect(parseSequenceBlockOpener('option_retry')).toBeNull()
    expect(parseSequenceBlockContinuation('option_retry')).toBeNull()
    expect(parseSequenceBlockContinuation('option2')).toBeNull()
  })

  test('punctuation-adjacent labels retain native blocks and upstream token types', async () => {
    const source = 'sequenceDiagram\ncritical:C\nA->>B: request\noption:retry\nA->>B: retry\nend\nopt(foo)\nA->>B: after\nend\npar|label\nA->>B: first\nand:second\nA->>B: second\nend\n'
    const native = parseSequenceDiagram(source.split('\n'))
    expect(native.blocks).toEqual([
      { type: 'critical', label: ':C', startIndex: 0, endIndex: 1, dividers: [{ index: 1, label: ':retry' }] },
      { type: 'opt', label: '(foo)', startIndex: 2, endIndex: 2, dividers: [] },
      { type: 'par', label: '|label', startIndex: 3, endIndex: 4, dividers: [{ index: 4, label: ':second' }] },
    ])
    const upstream = await mermaid.mermaidAPI.getDiagramFromText(source)
    const db = upstream.db as unknown as {
      LINETYPE: { CRITICAL_START: number; CRITICAL_OPTION: number; CRITICAL_END: number; OPT_START: number; OPT_END: number; PAR_START: number; PAR_AND: number; PAR_END: number; SOLID: number }
      getMessages(): Array<{ type: number }>
    }
    expect(db.getMessages().map(message => message.type)).toEqual([
      db.LINETYPE.CRITICAL_START, db.LINETYPE.SOLID, db.LINETYPE.CRITICAL_OPTION,
      db.LINETYPE.SOLID, db.LINETYPE.CRITICAL_END, db.LINETYPE.OPT_START,
      db.LINETYPE.SOLID, db.LINETYPE.OPT_END,
      db.LINETYPE.PAR_START, db.LINETYPE.SOLID, db.LINETYPE.PAR_AND,
      db.LINETYPE.SOLID, db.LINETYPE.PAR_END,
    ])
    const agent = parseRegisteredMermaid(source)
    expect(agent.ok).toBe(true)
    if (agent.ok) {
      const serialized = serializeMermaid(agent.value)
      expect(serialized).toContain('option:retry')
      expect(serialized).toContain('par|label')
      expect(serialized).toContain('and:second')
    }
  })

  test('par_over retains its legacy native suffix without inserting whitespace', async () => {
    for (const [opener, expected] of [
      ['par_over|label', '_over|label'],
      ['par_over:label', '_over:label'],
      ['par_over    label', '_over    label'],
      ['par_over', '_over'],
    ] as const) {
      const source = `sequenceDiagram\n${opener}\nA->>B: work\nend\n`
      expect(parseSequenceDiagram(source.split('\n')).blocks[0]?.label).toBe(expected)
      const agent = parseRegisteredMermaid(source)
      expect(agent.ok).toBe(true)
      if (agent.ok) expect(serializeMermaid(agent.value)).toContain(opener)
    }
    const upstream = await mermaid.mermaidAPI.getDiagramFromText('sequenceDiagram\npar_over|label\nA->>B: work\nend\n')
    const db = upstream.db as unknown as {
      LINETYPE: { PAR_OVER_START: number }
      getMessages(): Array<{ type: number }>
    }
    expect(db.getMessages()[0]?.type).toBe(db.LINETYPE.PAR_OVER_START)
  })

  test('agent keeps the critical block lossless while later messages stay structured', () => {
    const parsed = parseRegisteredMermaid(CRITICAL)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const body = asSequence(parsed.value)?.body
    expect(body?.statements.map(statement => statement.kind)).toEqual(['opaque-block', 'message'])
    const opaque = body?.statements[0]
    expect(opaque?.kind).toBe('opaque-block')
    if (opaque?.kind !== 'opaque-block') return
    const authoredBlockLines = CRITICAL.trimEnd().split('\n').slice(1, -1)
    expect(opaque.lines).toEqual(authoredBlockLines)
    const serialized = serializeMermaid(parsed.value)
    expect(serialized).toContain(authoredBlockLines.join('\n'))
    expect(parseSequenceDiagram(serialized.trimEnd().split('\n')).blocks[0]?.type).toBe('critical')
  })
})
