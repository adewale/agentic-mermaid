import { describe, expect, test } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'
import { scanSvgStartTags } from '../svg-structure.ts'

const LINK_FORMS = [
  'link Alice: Dashboard @ https://example.com/alice',
  'links Alice: {"Dashboard": "https://example.com/alice"}',
] as const

describe('Sequence actor menu native glyph allocation', () => {
  for (const style of ['crisp', 'watercolor', 'excalidraw'] as const) {
    test.each([...LINK_FORMS])(`${style} preserves the prepared ellipsis for %s`, link => {
      const svg = renderMermaidSVG(`sequenceDiagram
        participant Alice
        participant Bob
        ${link}
        Alice->>Bob: Hello`, { style, embedFontImport: false })
      const menus = svg.match(/<text\b[^>]*class="sequence-actor-menu"[^>]*>[\s\S]*?<\/text>/g) ?? []
      expect(menus).toHaveLength(1)
      const menu = menus[0]!
      const tags = scanSvgStartTags(menu)
      const attrs = (index: number) => new Map(tags[index]!.attributes.map(attribute => [attribute.name, attribute.value]))
      const text = attrs(0)
      // The Unicode symbol uses the actual fallback glyph advance. The
      // document-wide compatibility fitter must never squeeze it to the
      // deterministic ASCII-style width estimate.
      expect(text.get('data-prepared-text')).toBe('true')
      expect(text.get('font-weight')).toBe('400')
      expect(menu).not.toContain('textLength=')
      expect(menu).not.toContain('lengthAdjust=')
      expect(tags.map(tag => tag.name)).toEqual(['text', 'tspan'])
      const glyph = attrs(1)
      expect(glyph.get('data-text-fragment')).toBe('true')
      expect(glyph.get('text-anchor')).toBe('middle')
      expect(glyph.get('x')).toBe(text.get('x'))
      expect(glyph.get('y')).toBe(text.get('y'))
      expect(menu.replace(/<[^>]*>/g, '')).toBe('⋯')
    })
  }
})
