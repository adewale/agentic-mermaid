/**
 * Integration tests for class diagrams — end-to-end parse → layout → render.
 */
import { describe, it, expect } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'
import { parseClassDiagram } from '../class/parser.ts'
import { layoutClassDiagram } from '../class/layout.ts'
import { DefaultBackend, getFamily } from '../agent/index.ts'

function lowerPublicClass(positioned: ReturnType<typeof layoutClassDiagram>) {
  return getFamily('class')!.lowerScene!({ positioned, colors: { bg: '#ffffff', fg: '#111111', embedFontImport: false },
    resolved: { renderOptions: {} } })
}

describe('public Class lowering observations', () => {
  it('captures annotation before independent class-name metadata and retains their authored values', () => {
    const positioned = layoutClassDiagram(parseClassDiagram(['classDiagram', 'class A']))
    const cls = positioned.classes[0]!
    const reads: string[] = []
    let names = 0
    Object.defineProperties(cls, {
      annotation: { enumerable: true, configurable: true, get() { reads.push('annotation'); return 'interface' } },
      className: { enumerable: true, configurable: true, get() {
        reads.push('className')
        return ++names <= 2 ? 'first' : 'second'
      } },
    })
    const svg = DefaultBackend.render(lowerPublicClass(positioned), { seed: 0 })
    expect(reads.slice(0, 6)).toEqual(['annotation', 'annotation', 'className', 'className', 'className', 'className'])
    expect(svg).toContain('class="class-node first"')
    expect(svg).toContain('data-class="second"')
    expect(svg).toContain('data-annotation="interface"')
    expect(Object.isFrozen(cls)).toBe(false)
  })

  it('reports the annotation getter failure before a competing class-name getter failure', () => {
    const positioned = layoutClassDiagram(parseClassDiagram(['classDiagram', 'class A']))
    Object.defineProperties(positioned.classes[0]!, {
      annotation: { enumerable: true, get() { throw new Error('authored annotation failure') } },
      className: { enumerable: true, get() { throw new Error('later class-name failure') } },
    })
    expect(() => lowerPublicClass(positioned)).toThrow('authored annotation failure')
  })

  it('reads member appearance before a competing authored-text getter failure', () => {
    const positioned = layoutClassDiagram(parseClassDiagram(['classDiagram', 'class A {', '+id: int', '}']))
    const member = positioned.classes[0]!.attributes[0]!
    Object.defineProperties(member, {
      isAbstract: { enumerable: true, get() { throw new Error('authored abstract appearance failure') } },
      sourceText: { enumerable: true, get() { throw new Error('later member text failure') } },
    })
    expect(() => lowerPublicClass(positioned)).toThrow('authored abstract appearance failure')
  })

  it('retains the later visibility glyph for independent prepared-text fidelity rejection', () => {
    const positioned = layoutClassDiagram(parseClassDiagram(['classDiagram', 'class A {', '+id: int', '}']))
    const member = positioned.classes[0]!.attributes[0]!
    const reads: string[] = []
    Object.defineProperty(member, 'visibility', { enumerable: true, configurable: true, get() {
      const glyph = reads.length === 5 ? '-' : '+'
      reads.push(glyph)
      return glyph
    } })
    const scene = lowerPublicClass(positioned)
    expect(reads).toEqual(['+', '+', '+', '+', '+', '-'])
    expect(() => DefaultBackend.render(scene, { seed: 0 })).toThrow('retained prepared text differs from actual SVG')
    expect(Object.isFrozen(member)).toBe(false)
  })

  it('captures a relationship lexical label before later cardinality observation', () => {
    const positioned = layoutClassDiagram(parseClassDiagram(['classDiagram', 'A --> B : semantic']))
    const rel = positioned.relationships[0]!
    let labels = 0
    Object.defineProperty(rel, 'label', { enumerable: true, configurable: true, get() {
      return ++labels === 6 ? 'Lexical & <label>' : 'semantic'
    } })
    const svg = DefaultBackend.render(lowerPublicClass(positioned), { seed: 0 })
    expect(svg).toContain('data-label="Lexical &amp; &lt;label&gt;"')
    expect(svg).toContain('aria-label="A to B: semantic"')
    expect(Object.isFrozen(rel)).toBe(false)
  })
})

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
    const lastClassBox = svg.lastIndexOf('<g class="class"')
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
