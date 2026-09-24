import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import mermaid from 'mermaid'
import { asTimeline, parseRegisteredMermaid, serializeMermaid, verifyMermaid } from '../agent/index.ts'
import { renderMermaidSVGAsync } from '../browser-lazy.ts'
import { renderMermaidSVG } from '../index.ts'
import { parseTimelineDiagram } from '../timeline/parser.ts'

const source = (header: string) => `${header}\n  2020 : Launch`

describe('Timeline header-direction admission', () => {
  test('pinned Mermaid treats a non-LR/TD header token as a period, not a direction', async () => {
    mermaid.initialize({ startOnLoad: false })
    const upstream = await mermaid.mermaidAPI.getDiagramFromText(source('timeline TB'))
    const db = upstream.db as unknown as { getTasks(): Array<{ task: string }> }
    expect(db.getTasks().map(task => task.task.trim())).toEqual(['TB', '2020'])
  })

  test('unsupported direction-like and arbitrary suffixes are preserved but diagnosed, never rendered as LR', () => {
    for (const header of ['timeline TB', 'timeline BT', 'timeline RL', 'timeline EXTRA', 'timeline TD EXTRA', 'timeline; EXTRA', 'timeline ; EXTRA', 'timeline%{note}']) {
      const input = source(header)
      const parsed = parseRegisteredMermaid(input)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) continue
      expect(parsed.value.body.kind).toBe('opaque')
      expect(asTimeline(parsed.value)).toBeNull()
      expect(serializeMermaid(parsed.value)).toBe(`${input}\n`)

      const verified = verifyMermaid(parsed.value)
      expect(verified.ok).toBe(false)
      expect(verified.warnings).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax: 'timeline_header_direction' }),
        expect.objectContaining({ code: 'RENDER_FAILED' }),
      ]))
      expect(verified.warnings.some(warning => warning.code === 'RENDER_FAILED' && warning.reason.includes('Unsupported timeline header suffix'))).toBe(true)
      expect(verifyMermaid(input).ok).toBe(false)
      expect(() => parseTimelineDiagram(input.split('\n').map(line => line.trim()))).toThrow(/Unsupported timeline header/)
      expect(() => renderMermaidSVG(input)).toThrow(/Unsupported timeline header/)
    }
  })

  test('entity-encoded family whitespace gets the same specific diagnosis without a misleading wrapper-relative line', () => {
    const encoded = source('timeline&#32;TB')
    const parsed = parseRegisteredMermaid(encoded)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(serializeMermaid(parsed.value)).toBe(`${encoded}\n`)
    const warning = verifyMermaid(encoded).warnings.find(item => item.code === 'UNSUPPORTED_SYNTAX' && item.syntax === 'timeline_header_direction')
    expect(warning).toBeDefined()
    expect(warning).not.toHaveProperty('line')

    const wrapped = `---\ntitle: Roadmap\n---\n${source('timeline TB')}`
    const wrappedWarning = verifyMermaid(wrapped).warnings.find(item => item.code === 'UNSUPPORTED_SYNTAX' && item.syntax === 'timeline_header_direction')
    expect(wrappedWarning).toBeDefined()
    expect(wrappedWarning).not.toHaveProperty('line')
  })

  test('pinned Mermaid inline header comments keep their direction and authored bytes', async () => {
    mermaid.initialize({ startOnLoad: false })
    for (const [header, direction] of [
      ['timeline TD # note', 'TD'], ['timeline TD#note', 'TD'],
      ['timeline TD %note', 'TD'], ['timeline TD%note', 'TD'],
      ['timeline TD %% note', 'TD'], ['timeline LR # note', 'LR'],
      ['timeline#note', 'LR'], ['timeline%note', 'LR'],
    ] as const) {
      const input = source(header)
      const upstream = await mermaid.mermaidAPI.getDiagramFromText(input)
      expect((upstream.db as unknown as { getDirection(): string }).getDirection()).toBe(direction)
      expect(parseTimelineDiagram(input.split('\n').map(line => line.trim())).direction ?? 'LR').toBe(direction)
      expect(renderMermaidSVG(input)).toContain('Launch')

      const parsed = parseRegisteredMermaid(input)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) continue
      expect(parsed.value.body.kind).toBe('opaque')
      expect(serializeMermaid(parsed.value)).toBe(`${input}\n`)
      expect(verifyMermaid(parsed.value).ok).toBe(true)
      expect(verifyMermaid(parsed.value).warnings).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ syntax: 'timeline_header_direction' }),
      ]))
    }
  })

  test('bare, LR, and TD headers retain their modeled meaning', () => {
    for (const [header, direction] of [['timeline', undefined], ['timeline LR', 'LR'], ['timeline TD', 'TD'], ['timeline td', 'TD']] as const) {
      const input = source(header)
      const parsed = parseRegisteredMermaid(input)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) continue
      expect(asTimeline(parsed.value)?.body.direction).toBe(direction)
      expect(parseTimelineDiagram(input.split('\n').map(line => line.trim())).direction).toBe(direction)
      expect(renderMermaidSVG(input)).toContain('Launch')
    }
  })

  test('the reviewed baseline is the old silent horizontal render, not a fabricated after image', () => {
    const before = readFileSync(new URL('../../docs/pr-assets/issue-248-timeline-direction-before.svg', import.meta.url), 'utf8')
    expect(before).toContain('Launch')
    expect(before).toContain('2020')
    expect(before).not.toContain('TB')
    expect(() => renderMermaidSVG(source('timeline TB'), { embedFontImport: false })).toThrow(/Unsupported timeline header/)
  })

  test('the lazy browser route rejects unsupported suffixes with the same Timeline diagnosis', async () => {
    for (const header of ['timeline TB', 'timeline EXTRA', 'timeline; EXTRA', 'timeline%{note}']) {
      await expect(renderMermaidSVGAsync(source(header))).rejects.toThrow(/Unsupported timeline header suffix/)
    }
    expect(await renderMermaidSVGAsync(source('timeline TD'))).toContain('Launch')
    expect(await renderMermaidSVGAsync(source('timeline TD#note'))).toContain('Launch')
    expect(await renderMermaidSVGAsync(source('timeline%note'))).toContain('Launch')
  })
})
