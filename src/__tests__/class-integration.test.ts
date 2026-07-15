/**
 * Integration tests for class diagrams — end-to-end parse → layout → render.
 */
import { describe, it, expect } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'

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
    // Inheritance uses a hollow triangle marker
    expect(svg).toContain('cls-inherit')
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
    expect(svg).toContain('cls-composition')
  })

  it('renders aggregation with hollow diamond', () => {
    const svg = renderMermaidSVG(`classDiagram
      University o-- Department`)
    expect(svg).toContain('cls-aggregation')
  })

  it('renders dependency with dashed line', () => {
    const svg = renderMermaidSVG(`classDiagram
      Service ..> Repository`)
    expect(svg).toContain('stroke-dasharray')
    expect(svg).toContain('cls-arrow')
  })

  it('renders realization with dashed line and triangle', () => {
    const svg = renderMermaidSVG(`classDiagram
      Bird ..|> Flyable`)
    expect(svg).toContain('stroke-dasharray')
    expect(svg).toContain('cls-inherit')
  })

  it('renders relationship labels', () => {
    const svg = renderMermaidSVG(`classDiagram
      Customer --> Order : places`)
    expect(svg).toContain('places')
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
