/**
 * Comprehensive tests for class diagram arrow directions.
 *
 * Ensures all relationship types have correctly oriented arrows:
 * - Inheritance/Realization: hollow triangles point toward parent/interface
 * - Association/Dependency: filled arrows point from source to target
 * - Composition/Aggregation: diamonds are omnidirectional
 */

import { describe, test, expect } from 'bun:test'
import { renderMermaidASCII, renderMermaidASCIIWithReceipt } from '../ascii/index.ts'
import { terminalDocumentOf, type TerminalMarker } from '../ascii/terminal-document.ts'

function drawnRelationships(source: string, expected: Array<[string, string]>, end: 'start' | 'end', marker: TerminalMarker['shape'], direction: TerminalMarker['direction'], dashed = false): string {
  const result = renderMermaidASCIIWithReceipt(source, { colorMode: 'none' })
  const document = terminalDocumentOf(result)!
  const edges = document.regions().filter(region => region.kind === 'edge')
  expect(edges.map(edge => [edge.from, edge.to]).sort()).toEqual([...expected].sort())
  for (const id of new Set(expected.flat())) expect(result.text, id).toContain(id)
  for (const edge of edges) {
    expect(edge.ports, edge.id).toHaveLength(2)
    const port = edge.ports!.find(port => port.end === end)!
    const cell = document.cell(port.x, port.y)!
    expect(cell.marker, edge.id).toMatchObject({ shape: marker, direction })
    expect(cell.owners.some(owner => owner.kind === 'edge' && owner.id === edge.id), edge.id).toBe(true)
    expect(cell.glyph.trim(), edge.id).not.toBe('')
    const shaft = [...document.entries()].filter(([, , cell]) => cell.stroke && cell.owners.some(owner => owner.kind === 'edge' && owner.id === edge.id))
    expect(shaft.length, edge.id).toBeGreaterThan(0)
    expect(shaft.some(([, , cell]) => cell.stroke?.style === 'dashed'), edge.id).toBe(dashed)
  }
  return result.text
}

describe('Class Diagram Arrow Directions', () => {

  // ============================================================================
  // INHERITANCE (<|--)
  // ============================================================================

  describe('Inheritance (<|--)', () => {
    test('parent above child - triangle points UP toward parent', () => {
      const diagram = `classDiagram
        Animal <|-- Dog`
      const result = renderMermaidASCII(diagram)

      // Should contain upward triangle
      expect(result).toContain('△')
      expect(result).not.toContain('▽')

      // Parent should be above child
      const lines = result.split('\n')
      const animalLine = lines.findIndex(l => l.includes('Animal'))
      const dogLine = lines.findIndex(l => l.includes('Dog'))
      expect(animalLine).toBeLessThan(dogLine)
    })

    test('multiple inheritance creates separate arrows', () => {
      const diagram = `classDiagram
        Animal <|-- Dog
        Animal <|-- Cat
        Dog <|-- Puppy`
      const result = drawnRelationships(diagram, [['Animal', 'Dog'], ['Animal', 'Cat'], ['Dog', 'Puppy']], 'start', 'open-arrow', 'T')

      // Animal should be at top, then Dog/Cat, then Puppy
      const lines = result.split('\n')
      const animalLine = lines.findIndex(l => l.includes('Animal'))
      const dogLine = lines.findIndex(l => l.includes('Dog'))
      const catLine = lines.findIndex(l => l.includes('Cat'))
      const puppyLine = lines.findIndex(l => l.includes('Puppy'))

      expect(animalLine).toBeLessThan(dogLine)
      expect(animalLine).toBeLessThan(catLine)
      expect(dogLine).toBeLessThan(puppyLine)
    })

    test('multi-level inheritance - all triangles point UP', () => {
      const diagram = `classDiagram
        Animal <|-- Mammal
        Mammal <|-- Dog`
      const result = renderMermaidASCII(diagram)

      // Verify ordering: Animal > Mammal > Dog (top to bottom)
      const lines = result.split('\n')
      const animalLine = lines.findIndex(l => l.includes('Animal'))
      const mammalLine = lines.findIndex(l => l.includes('Mammal'))
      const dogLine = lines.findIndex(l => l.includes('Dog'))

      expect(animalLine).toBeLessThan(mammalLine)
      expect(mammalLine).toBeLessThan(dogLine)

      // All triangles should point up
      expect(result.match(/△/g)?.length).toBe(2)
    })

    test('multiple inheritance from same parent', () => {
      const diagram = `classDiagram
        Animal <|-- Dog
        Animal <|-- Cat`
      const result = renderMermaidASCII(diagram)

      // Animal should be above both children
      const lines = result.split('\n')
      const animalLine = lines.findIndex(l => l.includes('Animal'))
      const dogLine = lines.findIndex(l => l.includes('Dog'))
      const catLine = lines.findIndex(l => l.includes('Cat'))

      expect(animalLine).toBeLessThan(dogLine)
      expect(animalLine).toBeLessThan(catLine)

      // Should have at least one triangle pointing up (may merge visually)
      expect(result).toContain('△')
    })

    test('ASCII mode uses ^ for upward triangle', () => {
      const diagram = `classDiagram
        Animal <|-- Dog`
      const result = renderMermaidASCII(diagram, { useAscii: true })

      expect(result).toContain('^')
      expect(result).not.toContain('v')
    })
  })

  // ============================================================================
  // ASSOCIATION (-->)
  // ============================================================================

  describe('Association (-->)', () => {
    test('source above target - arrow points DOWN', () => {
      const diagram = `classDiagram
        Person --> Address`
      const result = renderMermaidASCII(diagram)

      // Should contain downward arrow
      expect(result).toContain('▼')
      expect(result).not.toContain('▲')

      // Person should be above Address
      const lines = result.split('\n')
      const personLine = lines.findIndex(l => l.includes('Person'))
      const addressLine = lines.findIndex(l => l.includes('Address'))
      expect(personLine).toBeLessThan(addressLine)
    })

    test('multiple associations from same source', () => {
      const diagram = `classDiagram
        Person --> Address
        Person --> Phone`
      const result = drawnRelationships(diagram, [['Person', 'Address'], ['Person', 'Phone']], 'end', 'triangle', 'B')

      // Person should be above both targets
      const lines = result.split('\n')
      const personLine = lines.findIndex(l => l.includes('Person'))
      const addressLine = lines.findIndex(l => l.includes('Address'))
      const phoneLine = lines.findIndex(l => l.includes('Phone'))

      expect(personLine).toBeLessThan(addressLine)
      expect(personLine).toBeLessThan(phoneLine)
    })

    test('chain of associations', () => {
      const diagram = `classDiagram
        A --> B
        B --> C`
      const result = renderMermaidASCII(diagram)

      // A > B > C ordering
      const lines = result.split('\n')
      const aLine = lines.findIndex(l => l.includes('│ A │'))
      const bLine = lines.findIndex(l => l.includes('│ B │'))
      const cLine = lines.findIndex(l => l.includes('│ C │'))

      expect(aLine).toBeLessThan(bLine)
      expect(bLine).toBeLessThan(cLine)

      // Both arrows point down
      expect(result.match(/▼/g)?.length).toBe(2)
    })

    test('ASCII mode uses v for downward arrow', () => {
      const diagram = `classDiagram
        Person --> Address`
      const result = renderMermaidASCII(diagram, { useAscii: true })

      expect(result).toContain('v')
      expect(result).not.toContain('^')
    })
  })

  // ============================================================================
  // DEPENDENCY (..>)
  // ============================================================================

  describe('Dependency (..>)', () => {
    test('source above target - arrow points DOWN', () => {
      const diagram = `classDiagram
        Client ..> Server`
      const result = renderMermaidASCII(diagram)

      expect(result).toContain('▼')
      expect(result).not.toContain('▲')

      const lines = result.split('\n')
      const clientLine = lines.findIndex(l => l.includes('Client'))
      const serverLine = lines.findIndex(l => l.includes('Server'))
      expect(clientLine).toBeLessThan(serverLine)
    })

    test('multiple dependencies', () => {
      const diagram = `classDiagram
        Client ..> Server
        Client ..> Database`
      const result = drawnRelationships(diagram, [['Client', 'Server'], ['Client', 'Database']], 'end', 'triangle', 'B', true)

      const lines = result.split('\n')
      const clientLine = lines.findIndex(l => l.includes('Client'))
      const serverLine = lines.findIndex(l => l.includes('Server'))
      const dbLine = lines.findIndex(l => l.includes('Database'))

      expect(clientLine).toBeLessThan(serverLine)
      expect(clientLine).toBeLessThan(dbLine)
    })

    test('ASCII mode uses v for downward arrow', () => {
      const diagram = `classDiagram
        Client ..> Server`
      const result = renderMermaidASCII(diagram, { useAscii: true })

      // "Server" itself contains a `v`, so locate the arrowhead: the row just
      // above the Server box's top border, in the dotted connector's column.
      const lines = result.split('\n')
      const serverTop = lines.findIndex(l => l.includes('| Server |')) - 1
      const arrowRow = lines[serverTop - 1]!
      const connectorCol = lines[serverTop - 2]!.indexOf(':')
      expect(connectorCol).toBeGreaterThan(0)
      expect({ row: arrowRow.trim(), col: arrowRow.indexOf('v') }).toEqual({ row: 'v', col: connectorCol })
    })
  })

  // ============================================================================
  // REALIZATION (..|>)
  // ============================================================================

  describe('Realization (..|>)', () => {
    test('interface above implementation - triangle points UP', () => {
      // Circle ..|> Shape means "Circle implements Shape"
      // Shape (interface/parent) should be placed ABOVE Circle (implementation/child)
      const diagram = `classDiagram
        Circle ..|> Shape`
      const result = renderMermaidASCII(diagram)

      // Shape (interface) should be above Circle (implementation)
      const lines = result.split('\n')
      const shapeLine = lines.findIndex(l => l.includes('Shape'))
      const circleLine = lines.findIndex(l => l.includes('Circle'))
      expect(shapeLine).toBeLessThan(circleLine)
      expect(result).toContain('△')
    })

    test('realization with <|.. syntax (marker at from end)', () => {
      // Shape <|.. Circle means "Circle implements Shape" (same as Circle ..|> Shape)
      const diagram = `classDiagram
        Shape <|.. Circle`
      const result = renderMermaidASCII(diagram)

      // Shape (interface) should be above Circle (implementation)
      const lines = result.split('\n')
      const shapeLine = lines.findIndex(l => l.includes('Shape'))
      const circleLine = lines.findIndex(l => l.includes('Circle'))
      expect(shapeLine).toBeLessThan(circleLine)
      expect(result).toContain('△')
    })

    test('multiple implementations', () => {
      // Circle and Square both implement Shape
      const diagram = `classDiagram
        Circle ..|> Shape
        Square ..|> Shape`
      const result = renderMermaidASCII(diagram)

      // Shape (interface) above both implementations
      const lines = result.split('\n')
      const shapeLine = lines.findIndex(l => l.includes('Shape'))
      const circleLine = lines.findIndex(l => l.includes('Circle'))
      const squareLine = lines.findIndex(l => l.includes('Square'))

      expect(shapeLine).toBeLessThan(circleLine)
      expect(shapeLine).toBeLessThan(squareLine)
      // At least one triangle (may merge visually if same connection point)
      expect(result).toContain('△')
    })
  })

  // ============================================================================
  // COMPOSITION & AGGREGATION (omnidirectional diamonds)
  // ============================================================================

  describe('Composition (*--) and Aggregation (o--)', () => {
    test('composition - diamond is omnidirectional', () => {
      const diagram = `classDiagram
        Car *-- Engine`
      const result = renderMermaidASCII(diagram)

      // Should contain filled diamond
      expect(result).toContain('◆')
    })

    test('aggregation - hollow diamond is omnidirectional', () => {
      const diagram = `classDiagram
        Team o-- Player`
      const result = renderMermaidASCII(diagram)

      // Should contain hollow diamond
      expect(result).toContain('◇')
    })
  })

  // ============================================================================
  // MIXED SCENARIOS
  // ============================================================================

  describe('Mixed Relationship Scenarios', () => {
    test('all 6 relationship types together', () => {
      const diagram = `classDiagram
        A <|-- B : inheritance
        C *-- D : composition
        E o-- F : aggregation
        G --> H : association
        I ..> J : dependency
        K ..|> L : realization`
      const result = renderMermaidASCII(diagram)

      // Upward triangles for inheritance and realization
      expect(result.match(/△/g)?.length).toBe(2)

      // Downward arrows for association and dependency
      expect(result.match(/▼/g)?.length).toBe(2)

      // Diamonds for composition and aggregation
      expect(result).toContain('◆')
      expect(result).toContain('◇')
    })

    test('inheritance with association - different arrow directions', () => {
      const diagram = `classDiagram
        Animal <|-- Dog
        Dog --> Food`
      const result = renderMermaidASCII(diagram)

      // Should have both up triangle (inheritance) and down arrow (association)
      expect(result).toContain('△')
      expect(result).toContain('▼')
    })

    test('circular reference creates valid layout', () => {
      const diagram = `classDiagram
        A --> B
        B --> C
        C ..> A`
      const result = renderMermaidASCII(diagram)

      // Cycles may create mixed arrow directions (up and down) to avoid overlaps
      // Just verify arrows are present and classes are rendered
      const hasUpArrow = result.includes('▲')
      const hasDownArrow = result.includes('▼')
      expect(hasUpArrow || hasDownArrow).toBe(true)
      // Reciprocal face demand can widen the cards; their complete labels
      // remain inside their own borders.
      expect(result).toMatch(/│ A +│/)
      expect(result).toMatch(/│ B +│/)
      expect(result).toMatch(/│ C +│/)
    })
  })

  // ============================================================================
  // ASCII vs UNICODE CONSISTENCY
  // ============================================================================

  describe('ASCII and Unicode Mode Consistency', () => {
    test('same diagram produces consistent layouts in both modes', () => {
      const diagram = `classDiagram
        Animal <|-- Dog
        Person --> Address`

      const unicode = renderMermaidASCII(diagram)
      const ascii = renderMermaidASCII(diagram, { useAscii: true })

      // Both should have same node ordering
      const unicodeLines = unicode.split('\n')
      const asciiLines = ascii.split('\n')

      for (const lines of [unicodeLines, asciiLines]) {
        const positions = ['Animal', 'Dog', 'Person', 'Address'].map(id => lines.findIndex(line => line.includes(id)))
        for (const position of positions) expect(position).toBeGreaterThanOrEqual(0)
        expect(positions[0]!).toBeLessThan(positions[1]!)
        expect(positions[2]!).toBeLessThan(positions[3]!)
      }
      const order = (lines: string[]) => lines.flatMap(line => ['Animal', 'Dog', 'Person', 'Address'].filter(id => line.includes(id)))
      expect(order(asciiLines)).toEqual(order(unicodeLines))

      // Unicode has △ and ▼, ASCII has ^ and v
      expect(unicode).toContain('△')
      expect(unicode).toContain('▼')
      expect(ascii).toContain('^')
      expect(ascii).toContain('v')
    })
  })

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe('Edge Cases', () => {
    test('single inheritance relationship', () => {
      const diagram = `classDiagram
        A <|-- B`
      const result = renderMermaidASCII(diagram)

      expect(result).toContain('△')
      const lines = result.split('\n')
      const aLine = lines.findIndex(l => l.includes('│ A │'))
      const bLine = lines.findIndex(l => l.includes('│ B │'))
      expect(aLine).toBeLessThan(bLine)
    })

    test('classes with members maintain arrow directions', () => {
      const diagram = `classDiagram
        class Animal {
          +String name
          +eat() void
        }
        class Dog {
          +bark() void
        }
        Animal <|-- Dog`
      const result = renderMermaidASCII(diagram)

      expect(result).toContain('△')
      const lines = result.split('\n')
      const animalLine = lines.findIndex(l => l.includes('Animal'))
      const dogLine = lines.findIndex(l => l.includes('Dog'))
      expect(animalLine).toBeLessThan(dogLine)
    })
  })
})
