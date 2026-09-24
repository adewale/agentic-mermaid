import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import mermaid from 'mermaid'
import { parseRegisteredMermaid } from '../agent/parse.ts'
import { renderMermaidPNG } from '../agent/png.ts'
import { serializeMermaid } from '../agent/serialize.ts'
import { asSequence } from '../agent/types.ts'
import { verifyMermaid } from '../agent/verify.ts'
import { renderMermaidSVG } from '../index.ts'
import { parseSequenceDiagram } from '../sequence/parser.ts'
import type { Block } from '../sequence/types.ts'

const asset = (name: string): string => join(import.meta.dir, '..', '..', 'docs', 'pr-assets', name)
const SOURCE = readFileSync(asset('issue-264-rect-color.mmd'), 'utf8')

describe('Sequence rect background color', () => {
  test('pinned Mermaid owns the two rect colors as background events', async () => {
    mermaid.initialize({ startOnLoad: false })
    const upstream = await mermaid.mermaidAPI.getDiagramFromText(SOURCE)
    const db = upstream.db as unknown as {
      LINETYPE: { RECT_START: number; RECT_END: number }
      getMessages(): Array<{ type: number; message: string }>
    }
    const rects = db.getMessages().filter(message =>
      message.type === db.LINETYPE.RECT_START || message.type === db.LINETYPE.RECT_END)
    expect(rects.map(message => [message.type, message.message])).toEqual([
      [db.LINETYPE.RECT_START, 'rgb(191, 223, 255)'],
      [db.LINETYPE.RECT_START, 'rgba(0, 0, 255, .1)'],
      [db.LINETYPE.RECT_END, ''],
      [db.LINETYPE.RECT_END, ''],
    ])
  })

  test('native parse separates paint from label, including packed statements', () => {
    const expected: Block[] = [
      { type: 'rect', label: '', color: 'rgba(0, 0, 255, .1)', startIndex: 2, endIndex: 2, dividers: [] },
      { type: 'rect', label: '', color: 'rgb(191, 223, 255)', startIndex: 1, endIndex: 3, dividers: [] },
    ]
    expect(parseSequenceDiagram(SOURCE.split('\n')).blocks).toEqual(expected)
    expect(parseSequenceDiagram([SOURCE.trim().split('\n').join('; ')]).blocks).toEqual(expected)
  })

  test('SVG paints nested rects outer-first with no synthetic fragment headers', () => {
    const svg = renderMermaidSVG(SOURCE)
    const outer = svg.indexOf('fill="rgb(191, 223, 255)"')
    const inner = svg.indexOf('fill="rgba(0, 0, 255, .1)"')
    expect(outer).toBeGreaterThan(0)
    expect(inner).toBeGreaterThan(outer)
    expect(svg).not.toContain('>rect [rgb(191, 223, 255)]<')
    expect(svg).not.toContain('>rect [rgba(0, 0, 255, .1)]<')
    expect(svg).not.toContain('data-label="rgb(191, 223, 255)"')
    expect(svg).not.toContain('data-label="rgba(0, 0, 255, .1)"')
  })

  test('nested opaque rect cannot cover a parent alt frame, divider, or label', () => {
    const source = 'sequenceDiagram\nparticipant A\nparticipant B\nalt x\nA->>B: before\nelse y\nrect red\nA->>B: inside\nend\nA->>B: after\nend'
    const svg = renderMermaidSVG(source)
    const rectPaint = svg.indexOf('fill="red"')
    const frame = svg.indexOf('data-id="block:alt#0:frame"')
    const divider = svg.indexOf('data-id="block:alt#0:divider#0"')
    expect(rectPaint).toBeGreaterThan(0)
    expect(frame).toBeGreaterThan(rectPaint)
    expect(divider).toBeGreaterThan(rectPaint)
    expect(svg).toContain('class="sequence-block-frame-overlay"')
    expect(svg).toContain('[y]')
  })

  test('agent serialization preserves both authored color statements losslessly', () => {
    const parsed = parseRegisteredMermaid(SOURCE)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const body = asSequence(parsed.value)?.body
    expect(body?.statements.map(statement => statement.kind)).toEqual(['participant', 'participant', 'message', 'opaque-block', 'message'])
    const serialized = serializeMermaid(parsed.value)
    expect(serialized).toContain('rect rgb(191, 223, 255)')
    expect(serialized).toContain('rect rgba(0, 0, 255, .1)')
    expect(parseSequenceDiagram(serialized.trimEnd().split('\n')).blocks).toEqual(
      parseSequenceDiagram(SOURCE.split('\n')).blocks,
    )
  })

  test('invalid or fetching paints fail explicitly before entering SVG', () => {
    for (const paint of ['rgb(1a, 2, 3)', 'rgba(0, 0, 255, 2)', 'constructor', 'url(https://bad.test/a)', 'rgb(1, 2, 3)" onload="alert(1)', 'rgb(1,2,3)\u2028onload=alert(1)', 'rgb(1,2,3)\u2029onload=alert(1)']) {
      const source = `sequenceDiagram\nrect ${paint}\nA->>B: inside\nend`
      expect(() => parseSequenceDiagram(source.split('\n'))).toThrow('SEQUENCE_RECT_COLOR_UNSUPPORTED')
      expect(() => renderMermaidSVG(source)).toThrow('SEQUENCE_RECT_COLOR_UNSUPPORTED')
      expect(verifyMermaid(source).warnings).toContainEqual(expect.objectContaining({
        code: 'RENDER_FAILED',
        reason: expect.stringContaining('SEQUENCE_RECT_COLOR_UNSUPPORTED'),
      }))
    }
  })

  test('bare rect and hash-comment rect use a default background, not a synthetic header', async () => {
    mermaid.initialize({ startOnLoad: false })
    for (const opener of ['rect', 'rect # comment', 'rect #ff0000']) {
      const source = `sequenceDiagram\n${opener}\nA->>B: inside\nend`
      const upstream = await mermaid.mermaidAPI.getDiagramFromText(source)
      const db = upstream.db as unknown as {
        LINETYPE: { RECT_START: number }
        getMessages(): Array<{ type: number; message: string }>
      }
      expect(db.getMessages().find(message => message.type === db.LINETYPE.RECT_START)?.message).toBe('')
      expect(parseSequenceDiagram(source.split('\n')).blocks[0]).toEqual({
        type: 'rect', label: '', startIndex: 0, endIndex: 0, dividers: [],
      })
      const svg = renderMermaidSVG(source)
      expect(svg).toContain('data-type="rect"')
      expect(svg).toContain('fill="rgba(128, 128, 128, 0.5)"')
      expect(svg).not.toContain('>rect [')
    }
  })

  test('an explicit rect color wins over group style, while bare rect honors that style', () => {
    const style = { formatVersion: 1 as const, roles: { group: { fillColor: '#ff00ff' } } }
    const bare = renderMermaidSVG('sequenceDiagram\nrect\nA->>B: inside\nend', { style })
    const explicit = renderMermaidSVG('sequenceDiagram\nrect rgb(1, 2, 3)\nA->>B: inside\nend', { style })
    expect(bare).toContain('fill="#ff00ff"')
    expect(explicit).toContain('fill="rgb(1, 2, 3)"')
    expect(explicit).not.toContain('fill="#ff00ff"')
  })

  test('reviewer-facing after SVG and PNG match the production renderer', () => {
    expect(renderMermaidSVG(SOURCE, { embedFontImport: false })).toBe(readFileSync(asset('issue-264-rect-color-after.svg'), 'utf8'))
    expect(Buffer.from(renderMermaidPNG(SOURCE, { scale: 1 }))).toEqual(readFileSync(asset('issue-264-rect-color-after.png')))
  })
})
