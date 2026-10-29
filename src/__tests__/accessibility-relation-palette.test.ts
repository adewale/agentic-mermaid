import { describe, expect, test } from 'bun:test'
import { layoutMermaid, parseRegisteredMermaid as parseMermaid } from '../agent/index.ts'
import { countStructuralElements } from '../agent/structural-count.ts'
import { renderMermaidSVG } from '../index.ts'
import { BUILTIN_PALETTE_DEFINITIONS } from '../palette-catalog.ts'
import * as marks from '../scene/marks.ts'
import { sceneNodeSerialization } from '../scene/serialization.ts'
import { contrastRatio } from '../shared/color-math.ts'
import { resolveColors } from '../theme.ts'
import { METAMORPHIC_FAMILIES } from './helpers/metamorphic-families.ts'

function attr(element: string, name: string): string {
  return element.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? ''
}

describe('typed relation accessibility', () => {
  test('registry-enrolls every relation-bearing family with one inspectable ARIA object per typed relation', () => {
    const enrolled: string[] = []
    for (const entry of Object.values(METAMORPHIC_FAMILIES)) {
      const source = entry.build(Math.max(2, entry.kRange[0]), 'rel')
      const parsed = parseMermaid(source)
      expect(parsed.ok, entry.family).toBe(true)
      if (!parsed.ok) continue
      const expected = layoutMermaid(parsed.value)
        .edges.map(edge => `${edge.from}->${edge.to}`)
        .sort()
      const authored = countStructuralElements(parsed.value)
      expect(authored, entry.family).not.toBeNull()
      expect(expected.length, `${entry.family} retains authored relations`).toBe(authored!.edges)
      if (expected.length === 0) continue
      enrolled.push(entry.family)

      const svg = renderMermaidSVG(source, { embedFontImport: false })
      const relations = [...svg.matchAll(/<[^>]+aria-roledescription="relation"[^>]*>/g)].map(match => match[0])
      expect(relations.map(element => `${attr(element, 'data-from')}->${attr(element, 'data-to')}`).sort(), entry.family).toEqual(expected)
      for (const relation of relations) {
        expect(relation, entry.family).toMatch(/role="graphics-symbol"/)
        expect(relation, entry.family).toMatch(/aria-label="[^"]+ to [^"]+/)
      }
    }
    expect(enrolled.length).toBeGreaterThan(0)
  })

  test('writes the typed relation model as escaped SVG attributes', () => {
    const edge = marks.connector({
      id: 'edge', role: 'edge', lineStyle: 'solid', paint: {},
      geometry: { kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
      identity: { id: 'edge', from: 'API&UI', to: 'DB' },
      labels: [{ text: 'reads & writes' }],
    })
    expect(edge.accessibility).toEqual({
      label: 'API&UI to DB: reads & writes',
      role: 'graphics-symbol',
      roleDescription: 'relation',
      relation: { from: 'API&UI', to: 'DB', label: 'reads & writes' },
    })
    const svg = sceneNodeSerialization(edge)
    expect(svg).toContain(' data-from="API&amp;UI" data-to="DB"')
    expect(svg).toContain(' role="graphics-symbol" aria-roledescription="relation" aria-label="API&amp;UI to DB: reads &amp; writes"')
  })
})

describe('all built-in palette WCAG contract', () => {
  for (const { inputName: name, colors: theme } of BUILTIN_PALETTE_DEFINITIONS) {
    test(`${name} keeps text AA and relation graphics at 3:1`, () => {
      const colors = resolveColors(theme)
      expect(contrastRatio(colors.text, colors.bg), `${name} primary`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(colors.textSec, colors.bg), `${name} secondary`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(colors.textSec, colors.groupHdr), `${name} group header`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(colors.textMuted, colors.bg), `${name} muted`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(colors.textFaint, colors.bg), `${name} faint`).toBeGreaterThanOrEqual(3)
      expect(contrastRatio(colors.line, colors.bg), `${name} relation line`).toBeGreaterThanOrEqual(3)
      expect(contrastRatio(colors.arrow, colors.bg), `${name} relation marker`).toBeGreaterThanOrEqual(3)
    })
  }

  test('the resolved SVG uses the checked palette colors on text and relations', () => {
    for (const { inputName: name, colors: palette } of BUILTIN_PALETTE_DEFINITIONS) {
      const svg = renderMermaidSVG('flowchart LR\n  A -- calls --> B', {
        ...palette,
        embedFontImport: false,
      })
      const colors = resolveColors(palette)
      const edge = svg.match(/<polyline[^>]*data-role="edge"[^>]*>/)?.[0]
      const nodeGroup = svg.match(/<g class="node"[^>]*>[\s\S]*?<\/g>/)?.[0]
      const nodeLabel = nodeGroup?.match(/<text[^>]*>/)?.[0]
      expect(edge, name).toContain(`stroke="${colors.line}"`)
      expect(nodeLabel, name).toContain(`fill="${colors.text}"`)
    }
  })
})
