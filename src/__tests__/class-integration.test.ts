/**
 * Integration tests for class diagrams — end-to-end parse → layout → render.
 */
import { describe, it, expect } from 'bun:test'
import { renderMermaidSVG, renderMermaidSVGWithReceipt } from '../index.ts'
import { parseClassDiagram } from '../class/parser.ts'
import { layoutClassDiagram } from '../class/layout.ts'

// Every class SVG defines all marker ids in <defs>, so marker assertions must
// read the drawn relationship element's own marker reference.
function relationshipTag(svg: string): string {
  const tag = svg.match(/<polyline class="class-relationship"[^>]*>/)?.[0]
  if (!tag) throw new Error('no class-relationship element in SVG')
  return tag
}

describe('renderMermaidSVG – class diagrams', () => {
  it('renders a basic class diagram to valid SVG', () => {
    const svg = renderMermaidSVG(`classDiagram
      class Animal {
        +String name
        +eat() void
      }`)
    expect(svg).toContain('<svg')
    expect(svg).toContain('</svg>')
    expect(svg).toContain('Animal')
    expect(svg).toContain('name')
    expect(svg).toContain('eat')
  })

  it('renders ::: styled class identities without a phantom member', () => {
    const svg = renderMermaidSVG(`classDiagram
      class Account
      Account:::highlight`)
    expect(svg).toContain('Account')
    expect(svg).not.toContain('::highlight')
  })

  it('renders class with annotation', () => {
    const svg = renderMermaidSVG(`classDiagram
      class Flyable {
        <<interface>>
        +fly() void
      }`)
    expect(svg).toContain('interface')
    expect(svg).toContain('Flyable')
    expect(svg).toContain('fly')
  })

  it('renders inheritance relationship with triangle marker', () => {
    const svg = renderMermaidSVG(`classDiagram
      Animal <|-- Dog`)
    expect(svg).toContain('Animal')
    expect(svg).toContain('Dog')
    // Inheritance uses a hollow triangle marker at the parent end
    expect(relationshipTag(svg)).toContain('marker-start="url(#cls-inherit)"')
  })

  it('repaints endpoint markers after class boxes so node fills cannot occlude them', () => {
    const svg = renderMermaidSVG(`classDiagram
      Account <|-- Savings
      Account o-- Transaction`)
    const classBoxes = [...svg.matchAll(/<g class="class-node(?: [^"]*)?"[^>]*>/g)].map(match => match.index)
    expect(classBoxes).toHaveLength(3)
    const lastClassBox = Math.max(...classBoxes)
    const overlays = [...svg.matchAll(/class="class-marker-overlay"/g)].map(match => match.index)

    expect(svg).toMatch(/<marker id="cls-inherit"[^>]*overflow="visible"/)
    expect(svg).toMatch(/<marker id="cls-aggregation"[^>]*viewBox="0 0 14 12"[^>]*overflow="hidden"/)
    expect(overlays).toHaveLength(2)
    expect(overlays.every(index => index > lastClassBox)).toBe(true)
    expect(svg).toMatch(/class="class-marker-overlay"[^>]*stroke-opacity="0"[^>]*marker-start="url\(#cls-inherit\)"/)
  })

  it('renders composition with filled diamond', () => {
    const svg = renderMermaidSVG(`classDiagram
      Car *-- Engine`)
    expect(relationshipTag(svg)).toContain('marker-start="url(#cls-composition)"')
  })

  it('renders aggregation with hollow diamond', () => {
    const svg = renderMermaidSVG(`classDiagram
      University o-- Department`)
    expect(relationshipTag(svg)).toContain('marker-start="url(#cls-aggregation)"')
  })

  it('renders dependency with dashed line', () => {
    const svg = renderMermaidSVG(`classDiagram
      Service ..> Repository`)
    expect(relationshipTag(svg)).toContain('stroke-dasharray')
    expect(relationshipTag(svg)).toContain('marker-end="url(#cls-arrow)"')
  })

  it('renders realization with dashed line and triangle', () => {
    const svg = renderMermaidSVG(`classDiagram
      Bird ..|> Flyable`)
    expect(relationshipTag(svg)).toContain('stroke-dasharray')
    expect(relationshipTag(svg)).toContain('marker-end="url(#cls-inherit)"')
  })

  it('renders relationship labels', () => {
    const svg = renderMermaidSVG(`classDiagram
      Customer --> Order : places`)
    expect(svg).toContain('places')
  })

  it.each(['</b>', '<b>', '<i></i>'])('retains formatting-only relationship source without inventing painted geometry: %s', label => {
    const source = `classDiagram\nclass A {\n+f(</b>) int\n}\nA <|-- B : ${label}`
    const positioned = layoutClassDiagram(parseClassDiagram(source.split('\n')))
    const relationship = positioned.relationships[0]!
    expect(relationship.label).toBe(label)
    expect(relationship.labelBlock?.prepared.source).toBe(label)
    expect(relationship.labelBlock?.text).toBe('')
    expect(relationship.labelPosition).toBeUndefined()
    const svg = renderMermaidSVG(source)
    // Members use literal display even when relationship text is formatting.
    expect(svg).toContain('&lt;/b&gt;')
    expect(relationshipTag(svg)).toContain('marker-start="url(#cls-inherit)"')
  })

  it('keeps unknown tag-like relationship text visible and measured', () => {
    const source = 'classDiagram\nA --> B : </c>'
    const relationship = layoutClassDiagram(parseClassDiagram(source.split('\n'))).relationships[0]!
    expect(relationship.labelBlock?.text).toBe('</c>')
    expect(relationship.labelPosition).toBeDefined()
    expect(renderMermaidSVG(source)).toContain('&lt;/c&gt;')
  })

  it('renders class compartments with divider lines', () => {
    const svg = renderMermaidSVG(`classDiagram
      class Animal {
        +String name
        +eat() void
      }`)
    // Should have horizontal divider lines between compartments
    const lines = svg.match(/<line /g) ?? []
    // At least 2 dividers (header-attrs, attrs-methods)
    expect(lines.length).toBeGreaterThanOrEqual(2)
  })

  it('renders with dark colors', () => {
    const svg = renderMermaidSVG(`classDiagram
      class A {
        +x int
      }`, { bg: '#18181B', fg: '#FAFAFA' })
    expect(svg).toContain('--bg:#18181B')
  })

  it('renders a complete class hierarchy', () => {
    const svg = renderMermaidSVG(`classDiagram
      class Animal {
        <<abstract>>
        +String name
        +eat() void
      }
      class Dog {
        +String breed
        +bark() void
      }
      class Cat {
        +bool isIndoor
        +meow() void
      }
      Animal <|-- Dog
      Animal <|-- Cat`)
    expect(svg).toContain('Animal')
    expect(svg).toContain('Dog')
    expect(svg).toContain('Cat')
    expect(svg).toContain('abstract')
  })
})

describe('Class default paint cascade', () => {
  const body = (svg: string, id: string): string => {
    const group = [...svg.matchAll(/<g\b([^>]*)>([\s\S]*?)<\/g>/g)].find(m => m[1]!.includes(`data-id="${id}"`) && /class="class-node(?: |")/.test(m[1]!))
    if (!group) throw new Error('Missing real Class card ' + id)
    return group[2]!
  }
  const attr = (tag: string, name: string): string | undefined => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1]
  const paint = (svg: string, id: string) => {
    const group = body(svg, id), rect = /<rect\b[^>]*>/.exec(group)![0], texts = [...group.matchAll(/<text\b[^>]*>/g)].map(m => m[0])
    return { fill: attr(rect, 'fill'), stroke: attr(rect, 'stroke'), width: attr(rect, 'stroke-width'), text: texts.map(t => attr(t, 'fill')) }
  }
  const literal = 'classDiagram\nclass Animal:::pink\nclass Mineral\nclassDef default fill:#f96,color:red\nclassDef pink color:#f9f'
  it.each(['agentic', 'elk'] as const)('retains the literal default fill and named text override with %s', backend => {
    const options = { graphLayout: { backend, fallback: 'none' as const } }, model = parseClassDiagram(literal.split('\n')), before = structuredClone(model)
    const positioned = layoutClassDiagram(model, options)
    expect(model).toEqual(before)
    expect(positioned.classes.map(c => c.inlineStyle)).toEqual([{ fill: '#f96', color: '#f9f' }, { fill: '#f96', color: 'red' }])
    const svg = renderMermaidSVG(literal, options)
    expect(paint(svg, 'Animal').fill).toBe('#f96')
    expect(paint(svg, 'Animal').text).toEqual(['#f9f'])
    expect(paint(svg, 'Mineral').fill).toBe('#f96')
    expect(paint(svg, 'Mineral').text).toEqual(['red'])
  })
  it.each(['agentic', 'elk'] as const)('uses the last assigned class then inline paint without losing defaults with %s', backend => {
    const source = `classDiagram
class Animal {
 +String name
 +run()
}
class Mineral
classDef default fill:#f96,color:red,stroke:#111,stroke-width:6
classDef pink color:#f9f,stroke-width:4
classDef blue color:blue
class Animal pink
class Animal blue
style Animal fill:#afa,stroke-width:2`
    const options = { graphLayout: { backend, fallback: 'none' as const } }, model = parseClassDiagram(source.split('\n')), before = structuredClone(model)
    expect(model.classes[0]!.className).toBe('blue')
    const positioned = layoutClassDiagram(model, options), svg = renderMermaidSVG(source, options)
    expect(model).toEqual(before)
    expect(positioned.classes[0]!.inlineStyle).toEqual({ fill: '#afa', color: 'blue', stroke: '#111', 'stroke-width': '2' })
    expect(paint(svg, 'Animal')).toEqual({ fill: '#afa', stroke: '#111', width: '2', text: ['blue', 'blue', 'blue'] })
    expect(paint(svg, 'Mineral')).toEqual({ fill: '#f96', stroke: '#111', width: '6', text: ['red'] })
  })
  it('measures the same inherited border widths used by Native SVG paint', async () => {
    const { spyOn } = await import('bun:test'), producer = await import('../layout/agentic-layered.ts'), original = producer.layoutAgenticGraph
    const calls: Array<Array<[string, number | undefined]>> = []
    const spy = spyOn(producer, 'layoutAgenticGraph').mockImplementation(input => {
      calls.push(input.nodes.map(node => [node.id, node.paintStrokeWidth]))
      return original(input)
    })
    const source = 'classDiagram\nclass A:::thin\nclass B\nA --> B\nclassDef default fill:#f96,color:red,stroke-width:6\nclassDef thin stroke-width:2'
    try {
      const svg = renderMermaidSVG(source, { graphLayout: { backend: 'agentic', fallback: 'none' } })
      expect(calls).toEqual([[['A', 2], ['B', 6]]])
      expect(paint(svg, 'A').width).toBe('2')
      expect(paint(svg, 'B').width).toBe('6')
    } finally { spy.mockRestore() }
  })
})

describe('Class authored border dash paint', () => {
  const shapePaints = (svg: string, id: string) => {
    const group = [...svg.matchAll(/<g\b([^>]*)>([\s\S]*?)<\/g>/g)].find(m => m[1]!.includes(`data-id="${id}"`) && /class="class-node(?: |")/.test(m[1]!))
    if (!group) throw new Error('Missing Class card ' + id)
    return [...group[2]!.matchAll(/<(rect|path|line)\b([^>]*)>/g)].map(m => ({ kind: m[1]!, dash: /\bstroke-dasharray="([^"]*)"/.exec(m[2]!)?.[1] }))
  }
  it.each(['agentic', 'elk'] as const)('paints the exact Mineral inline dash on every border part with %s', backend => {
    const source = 'classDiagram\nclass Animal\nclass Mineral\nstyle Animal fill:#f9f,stroke:#333,stroke-width:4px\nstyle Mineral fill:#bbf,stroke:#f66,stroke-width:2px,color:#fff,stroke-dasharray: 5 5'
    const model = parseClassDiagram(source.split('\n')), before = structuredClone(model), options = { graphLayout: { backend, fallback: 'none' as const } }
    const placed = layoutClassDiagram(model, options)
    expect(model).toEqual(before)
    expect(placed.classes.find(c => c.id === 'Mineral')!.inlineStyle?.['stroke-dasharray']).toBe('5 5')
    const rendered = renderMermaidSVGWithReceipt(source, options), svg = rendered.svg
    expect(rendered.receipt.layoutCertification?.status).toBe('passed')
    expect(shapePaints(svg, 'Mineral')).toEqual([{ kind: 'rect', dash: '5 5' }, { kind: 'path', dash: '5 5' }, { kind: 'line', dash: '5 5' }, { kind: 'line', dash: '5 5' }])
    expect(shapePaints(svg, 'Animal').map(s => s.dash)).toEqual([undefined, undefined, undefined, undefined])
  })
  it.each(['agentic', 'elk'] as const)('paints inherited dash defaults, named overrides and inline overrides with %s', backend => {
    const source = 'classDiagram\nclass BaseCard\nclass NamedCard:::custom\nclass InlineCard:::custom\nclassDef default stroke-dasharray:2 3\nclassDef custom stroke-dasharray:6 4\nstyle InlineCard stroke-dasharray:1 2'
    const rendered = renderMermaidSVGWithReceipt(source, { graphLayout: { backend, fallback: 'none' } }), svg = rendered.svg
    expect(rendered.receipt.layoutCertification?.status).toBe('passed')
    for (const [id, expected] of [['BaseCard', '2 3'], ['NamedCard', '6 4'], ['InlineCard', '1 2']]) expect(shapePaints(svg, id!).map(s => s.dash)).toEqual([expected, expected, expected, expected])
  })
})
