import { describe, expect, it } from 'bun:test'

import { renderMermaidSVG } from '../index.ts'
import { THEMES } from '../theme.ts'
import { parseSequenceDiagram } from '../sequence/parser.ts'
import { layoutSequenceDiagram } from '../sequence/layout.ts'
import { renderSequenceSvg } from '../sequence/renderer.ts'
import { parseClassDiagram } from '../class/parser.ts'
import { layoutClassDiagramSync } from '../class/layout.ts'
import { renderClassSvg } from '../class/renderer.ts'
import { parseErDiagram } from '../er/parser.ts'
import { layoutErDiagramSync } from '../er/layout.ts'
import { renderErSvg } from '../er/renderer.ts'
import { renderMermaidASCII } from '../ascii/index.ts'

const themeCases = [
  ['timeline', `timeline\n  title Release plan\n  section Now\n    2026 : Ship`, 'timeline-period'],
  ['xychart', `xychart-beta\n  title Sales\n  x-axis [A, B]\n  bar [1, 2]`, 'xychart-bar'],
  ['sequence', `sequenceDiagram\n  participant A\n  participant B\n  A->>B: Hello`, 'class="message"'],
  ['class', `classDiagram\n  Animal <|-- Dog\n  class Animal {\n    +eat() void\n  }`, 'class="class-node"'],
  ['er', `erDiagram\n  CUSTOMER ||--o{ ORDER : places`, 'class="entity"'],
] as const

describe('TODO coverage – theme rendering across diagram families', () => {
  for (const [name, source, marker] of themeCases) {
    it(`${name} renders with light and dark enriched palettes`, () => {
      for (const theme of [THEMES['github-light'], THEMES['github-dark']]) {
        const svg = renderMermaidSVG(source, theme)
        expect(svg).toContain(`--bg:${theme.bg}`)
        expect(svg).toContain(`--fg:${theme.fg}`)
        expect(svg).toContain(marker)
        expect(svg).not.toContain('NaN')
      }
    })
  }
})

describe('TODO coverage – SVG structural snapshots', () => {
  it('timeline and xychart emit stable semantic SVG markers', () => {
    expect(renderMermaidSVG(themeCases[0][1])).toContain('class="timeline-period"')
    expect(renderMermaidSVG(themeCases[1][1])).toContain('data-xychart-colors')
  })

  it('older diagram families emit stable semantic SVG markers', () => {
    expect(renderMermaidSVG('graph TD\n  A[Start] --> B[End]')).toContain('class="node" data-id="A"')
    expect(renderMermaidSVG(themeCases[2][1])).toContain('class="actor" data-id="A"')
    expect(renderMermaidSVG(themeCases[3][1])).toContain('class="class-relationship"')
    expect(renderMermaidSVG(themeCases[4][1])).toContain('class="er-relationship"')
  })
})

describe('TODO coverage – sequence renderer and ASCII regressions', () => {
  it('renders semantic sequence SVG components directly', () => {
    const parsed = parseSequenceDiagram(['sequenceDiagram', 'participant A as Alice', 'participant B as Bob', 'A->>B: Hello'])
    const positioned = layoutSequenceDiagram(parsed)
    const svg = renderSequenceSvg(positioned, THEMES['github-light'])
    expect(svg).toContain('class="actor" data-id="A"')
    expect(svg).toContain('class="message" data-from="A" data-to="B"')
    expect(svg).toContain('Hello')
  })

  it('renders sequence ASCII including notes before the first message', () => {
    const ascii = renderMermaidASCII(`sequenceDiagram
      participant A as Alice
      participant B as Bob
      Note over A,B: context
      A->>B: Hello`)
    expect(ascii).toContain('context')
    expect(ascii).toContain('Hello')
  })
})

describe('TODO coverage – class and ER layout/renderer units', () => {
  it('lays out class nodes and relationships with finite positive dimensions', () => {
    const positioned = layoutClassDiagramSync(parseClassDiagram(['classDiagram', 'Animal <|-- Dog', 'class Animal', 'class Dog']))
    expect(positioned.classes).toHaveLength(2)
    expect(positioned.relationships).toHaveLength(1)
    for (const cls of positioned.classes) {
      expect(Number.isFinite(cls.x)).toBe(true)
      expect(cls.width).toBeGreaterThan(0)
      expect(cls.height).toBeGreaterThan(0)
    }
  })

  it('renders class SVG compartments and relationship markers directly', () => {
    const positioned = layoutClassDiagramSync(parseClassDiagram(['classDiagram', 'Animal <|-- Dog', 'class Animal {', '+eat() void', '}']))
    const svg = renderClassSvg(positioned, THEMES['github-light'])
    expect(svg).toContain('class="class-node"')
    expect(svg).toContain('marker-start="url(#cls-inherit)"')
    expect(svg).toContain('eat()')
  })

  it('lays out ER entities and relationships with finite positive dimensions', () => {
    const positioned = layoutErDiagramSync(parseErDiagram(['erDiagram', 'CUSTOMER ||--o{ ORDER : places']))
    expect(positioned.entities).toHaveLength(2)
    expect(positioned.relationships).toHaveLength(1)
    for (const entity of positioned.entities) {
      expect(Number.isFinite(entity.x)).toBe(true)
      expect(entity.width).toBeGreaterThan(0)
      expect(entity.height).toBeGreaterThan(0)
    }
  })

  it('renders ER SVG entities, attributes, relationships, and labels directly', () => {
    const positioned = layoutErDiagramSync(parseErDiagram([
      'erDiagram',
      'CUSTOMER ||--o{ ORDER : places',
      'CUSTOMER {',
      'string id PK "primary key"',
      '}',
    ]))
    const svg = renderErSvg(positioned, THEMES['github-light'])
    expect(svg).toContain('class="entity" data-id="CUSTOMER"')
    expect(svg).toContain('class="er-relationship"')
    expect(svg).toContain('places')
    expect(svg).toContain('primary key')
  })
})

describe('TODO coverage – accessibility for sequence, class, and ER', () => {
  it('routes sequence accTitle and accDescr into SVG accessibility metadata', () => {
    const svg = renderMermaidSVG(`sequenceDiagram
      accTitle: Auth exchange
      accDescr: Alice asks Bob to authenticate
      participant A as Alice
      participant B as Bob
      A->>B: Login`)
    expect(svg).toContain('role="img"')
    expect(svg).toContain('<title id="seq-')
    expect(svg).toContain('Auth exchange</title>')
    expect(svg).toContain('Alice asks Bob to authenticate</desc>')
  })

  it('routes class accTitle and multiline accDescr into SVG accessibility metadata', () => {
    const svg = renderMermaidSVG(`classDiagram
      accTitle: Domain model
      accDescr {
        Classes and inheritance
      }
      Animal <|-- Dog`)
    expect(svg).toContain('role="img"')
    expect(svg).toContain('Domain model</title>')
    expect(svg).toContain('Classes and inheritance</desc>')
  })

  it('routes ER accTitle and accDescr into SVG accessibility metadata', () => {
    const svg = renderMermaidSVG(`erDiagram
      accTitle: Customer orders
      accDescr: Customer order relationship
      CUSTOMER ||--o{ ORDER : places`)
    expect(svg).toContain('role="img"')
    expect(svg).toContain('Customer orders</title>')
    expect(svg).toContain('Customer order relationship</desc>')
  })
})
