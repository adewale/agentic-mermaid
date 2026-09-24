import { describe, expect, test } from 'bun:test'
import mermaid from 'mermaid'
import { asTimeline, parseRegisteredMermaid, serializeMermaid, verifyMermaid } from '../agent/index.ts'
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
    for (const header of ['timeline TB', 'timeline BT', 'timeline RL', 'timeline EXTRA', 'timeline TD EXTRA']) {
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
      expect(() => parseTimelineDiagram(input.split('\n').map(line => line.trim()))).toThrow(/Unsupported timeline header/)
      expect(() => renderMermaidSVG(input)).toThrow(/Unsupported timeline header/)
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
})
