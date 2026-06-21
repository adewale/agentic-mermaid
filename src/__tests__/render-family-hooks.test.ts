import { describe, expect, test } from 'bun:test'
import { renderMermaidASCII, renderMermaidSVG } from '../index.ts'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'
import { getFamily } from '../render-family-hooks.ts'

const MINIMAL_DIAGRAMS = [
  ['flowchart', 'graph TD\n  A[Start] --> B[End]'],
  ['state', 'stateDiagram-v2\n  [*] --> Still'],
  ['sequence', 'sequenceDiagram\n  participant A\n  participant B\n  A->>B: Hi'],
  ['timeline', 'timeline\n  title History\n  2024 : Start'],
  ['class', 'classDiagram\n  Animal <|-- Dog\n  class Animal\n  class Dog'],
  ['er', 'erDiagram\n  CUSTOMER ||--o{ ORDER : places'],
  ['journey', 'journey\n  title Trip\n  section Buy\n    Browse: 5: Me'],
  ['architecture', 'architecture-beta\n  group api(cloud)[API]\n  service web(server)[Web] in api'],
  ['xychart', 'xychart-beta\n  title "Sales"\n  x-axis [Jan, Feb]\n  bar [1, 2]'],
  ['pie', 'pie\n  title Pets\n  "Dogs" : 60\n  "Cats" : 40'],
  ['quadrant', 'quadrantChart\n  title Priorities\n  x-axis Low --> High\n  y-axis Low --> High\n  quadrant-1 Plan\n  quadrant-2 Invest\n  quadrant-3 Ignore\n  quadrant-4 Monitor\n  Item: [0.2, 0.8]'],
  ['gantt', 'gantt\n  dateFormat YYYY-MM-DD\n  title Plan\n  section Work\n  Task :a1, 2024-01-01, 1d'],
] as const

describe('render FamilyPlugin hooks', () => {
  test('all built-in families expose layout, SVG, and ASCII hooks', () => {
    for (const { id } of BUILTIN_FAMILY_METADATA) {
      const family = getFamily(id)
      expect(family?.layout, id).toBeDefined()
      expect(family?.renderSvg, id).toBeDefined()
      expect(family?.renderAscii, id).toBeDefined()
    }
  })

  for (const [id, source] of MINIMAL_DIAGRAMS) {
    test(`${id} renders through public SVG and ASCII dispatch`, () => {
      const svg = renderMermaidSVG(source, { embedFontImport: false })
      expect(svg).toContain('<svg')
      expect(svg).toContain('</svg>')

      const ascii = renderMermaidASCII(source, { colorMode: 'none' })
      expect(ascii.trim().length).toBeGreaterThan(0)
    })
  }
})
