import { describe, expect, test } from 'bun:test'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'
import { parseRegisteredMermaid } from '../agent/parse.ts'
import { serializeMermaid } from '../agent/serialize.ts'
import { renderMermaidSVG } from '../index.ts'
import { normalizeMermaidSource } from '../mermaid-source.ts'
import {
  parseAccessibilityDirective,
  scanAccessibilityDirectives,
} from '../shared/accessibility-directives.ts'

function withAccessibility(source: string): string {
  const lines = source.split(/\r?\n/)
  lines.splice(1, 0,
    '  accTitle Universal title',
    '  accDescr {',
    '    First line',
    '    Second line',
    '  }')
  return lines.join('\n')
}

describe('universal accessibility grammar authority', () => {
  test('one colon rule and one block/suffix rule own recognition', () => {
    for (const line of ['accTitle: Compact', 'accTitle Spaced']) {
      expect(parseAccessibilityDirective([line], 0)).toEqual({
        title: true,
        form: 'inline',
        value: line.endsWith('Compact') ? 'Compact' : 'Spaced',
        endIndex: 0,
      })
    }
    const source = ['mindmap', '  accDescr {', '    Details', '  } root((Root))']
    expect(scanAccessibilityDirectives(source)).toEqual({
      familyLines: ['mindmap', '  root((Root))'],
      accessibility: { descr: 'Details' },
    })
  })

  test('an unclosed block remains family-visible and lossless', () => {
    const source = ['flowchart LR', '  accDescr {', '    never closes', '  A --> B']
    const extracted = scanAccessibilityDirectives(source)
    expect(extracted.familyLines).toEqual(source)
    expect(extracted.unclosedIndex).toBe(1)
  })

  test('empty reserved directives remain family-visible for fail-closed family policy', () => {
    for (const line of ['accTitle:', 'accDescr:', 'accTitle', 'accDescr']) {
      expect(parseAccessibilityDirective([line], 0), line).toBeNull()
      expect(scanAccessibilityDirectives([line]).familyLines, line).toEqual([line])
    }
  })

  test('every built-in family preserves and renders the same accessibility envelope', () => {
    for (const family of BUILTIN_FAMILY_METADATA) {
      const source = withAccessibility(family.example)
      const normalized = normalizeMermaidSource(source)
      expect(normalized.accessibility, family.id).toEqual({
        title: 'Universal title',
        descr: 'First line\nSecond line',
      })
      expect(normalized.familyText, family.id).not.toMatch(/accTitle|accDescr/)

      const parsed = parseRegisteredMermaid(source)
      expect(parsed.ok, family.id).toBe(true)
      if (!parsed.ok) continue
      const canonical = serializeMermaid(parsed.value)
      expect(canonical, family.id).toContain('accTitle')
      expect(canonical, family.id).toContain('accDescr')

      const canonicalNormalized = normalizeMermaidSource(canonical)
      expect(canonicalNormalized.accessibility, family.id).toEqual(normalized.accessibility)
      const reparsed = parseRegisteredMermaid(canonical)
      expect(reparsed.ok, family.id).toBe(true)
      if (!reparsed.ok) continue
      expect(serializeMermaid(reparsed.value), family.id).toBe(canonical)

      const svg = renderMermaidSVG(canonical)
      expect(svg, family.id).toContain('Universal title')
      expect(svg, family.id).toContain('First line\nSecond line')
    }
  })
})
