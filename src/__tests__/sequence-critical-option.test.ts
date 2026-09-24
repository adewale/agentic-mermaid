import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import mermaid from 'mermaid'
import { parseRegisteredMermaid } from '../agent/parse.ts'
import { renderMermaidPNG } from '../agent/png.ts'
import { serializeMermaid } from '../agent/serialize.ts'
import { asSequence } from '../agent/types.ts'
import { renderMermaidSVG } from '../index.ts'
import { parseSequenceDiagram } from '../sequence/parser.ts'
import { parseSequenceBlockContinuation, parseSequenceBlockOpener } from '../sequence/block-keywords.ts'
import type { Block } from '../sequence/types.ts'

const asset = (name: string): string => join(import.meta.dir, '..', '..', 'docs', 'pr-assets', name)
const CRITICAL = readFileSync(asset('issue-264-critical-option.mmd'), 'utf8')

const EXPECTED_BLOCK: Block = {
  type: 'critical', label: 'Establish a connection', startIndex: 0, endIndex: 2,
  dividers: [{ index: 1, label: 'Network timeout' }, { index: 2, label: 'Credentials rejected' }],
}

describe('Sequence critical/option keyword boundary', () => {
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
  })

  test('agent keeps the critical block lossless while later messages stay mutable', () => {
    const parsed = parseRegisteredMermaid(CRITICAL)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const body = asSequence(parsed.value)?.body
    expect(body?.statements.map(statement => statement.kind)).toEqual(['opaque-block', 'message'])
    expect(serializeMermaid(parsed.value)).toContain('option Credentials rejected')
    expect(parseSequenceDiagram(serializeMermaid(parsed.value).trimEnd().split('\n')).blocks[0]?.type).toBe('critical')
  })

  test('reviewer-facing after SVG and PNG match the production renderer', () => {
    expect(renderMermaidSVG(CRITICAL, { embedFontImport: false })).toBe(readFileSync(asset('issue-264-critical-option-after.svg'), 'utf8'))
    expect(Buffer.from(renderMermaidPNG(CRITICAL, { scale: 1 }))).toEqual(readFileSync(asset('issue-264-critical-option-after.png')))
  })
})
