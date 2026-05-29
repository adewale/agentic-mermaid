// Loop 11 M2 (#7254/#7255 + #7349): SVG accessibility (title/desc/ARIA) and
// the structured AX tree from describeMermaid({format:'json'}).

import { describe, test, expect } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'
import { describeMermaidSource, describeMermaidTree } from '../agent/describe.ts'
import { parseMermaid } from '../agent/parse.ts'

describe('#7254/#7255 SVG accessibility', () => {
  test('accTitle → <title>, accDescr → <desc>, role + aria-labelledby on root', () => {
    const svg = renderMermaidSVG('flowchart TD\n accTitle: Login Flow\n accDescr: How a user logs in\n A[Start] --> B[End]')
    expect(svg).toContain('<title id="svg-title">Login Flow</title>')
    expect(svg).toContain('<desc id="svg-desc">How a user logs in</desc>')
    expect(svg).toContain('role="img"')
    expect(svg).toContain('aria-labelledby="svg-title svg-desc"')
  })

  test('accDescr block form is captured', () => {
    const svg = renderMermaidSVG('flowchart TD\n accTitle: T\n accDescr {\n   multi line\n   description\n }\n A --> B')
    expect(svg).toContain('<title id="svg-title">T</title>')
    expect(svg).toContain('multi line description')
  })

  test('diagram without acc directives emits no <title>/<desc> (back-compat)', () => {
    const svg = renderMermaidSVG('flowchart TD\n A --> B')
    expect(svg).not.toContain('<title')
    expect(svg).not.toContain('aria-labelledby')
  })

  test('title text is XML-escaped', () => {
    const svg = renderMermaidSVG('flowchart TD\n accTitle: A < B & C\n A --> B')
    expect(svg).toContain('A &lt; B &amp; C')
  })

  test('acc title/desc ids carry the idPrefix (collision-free with other diagrams)', () => {
    const svg = renderMermaidSVG('flowchart TD\n accTitle: X\n A --> B', { idPrefix: 'd3-' })
    expect(svg).toContain('<title id="d3-svg-title">X</title>')
    expect(svg).toContain('aria-labelledby="d3-svg-title"')
  })
})

describe('#7349 AX tree — describeMermaid({format:json})', () => {
  test('flowchart: every node + edge in the tree', () => {
    const tree = describeMermaidTree(parseMermaidOk('flowchart TD\n A[Start] --> B[Mid]\n B --> C[End]'))
    expect(tree.kind).toBe('flowchart')
    expect(tree.nodes.map(n => n.id).sort()).toEqual(['A', 'B', 'C'])
    expect(tree.nodes.find(n => n.id === 'A')!.label).toBe('Start')
    expect(tree.edges).toEqual([
      { from: 'A', to: 'B', label: undefined },
      { from: 'B', to: 'C', label: undefined },
    ])
    expect(tree.entryPoints).toEqual(['A'])
    expect(tree.sinks).toEqual(['C'])
  })

  test('json format is valid JSON with the tree shape', () => {
    const json = describeMermaidSource('flowchart TD\n A --> B', { format: 'json' })
    const parsed = JSON.parse(json)
    expect(parsed.kind).toBe('flowchart')
    expect(Array.isArray(parsed.nodes)).toBe(true)
    expect(Array.isArray(parsed.edges)).toBe(true)
  })

  test('sequence: participants → nodes, messages → edges', () => {
    const tree = describeMermaidTree(parseMermaidOk('sequenceDiagram\n Alice->>Bob: Hi\n Bob-->>Alice: Hello'))
    expect(tree.nodes.map(n => n.id).sort()).toEqual(['Alice', 'Bob'])
    expect(tree.edges.length).toBe(2)
    expect(tree.edges[0]!.label).toBe('Hi')
  })

  test('class: classes → nodes, relations → edges', () => {
    const tree = describeMermaidTree(parseMermaidOk('classDiagram\n class A\n class B\n A <|-- B'))
    expect(tree.nodes.map(n => n.id).sort()).toEqual(['A', 'B'])
    expect(tree.edges.length).toBe(1)
  })

  test('unparseable source → json error envelope, not a throw', () => {
    const json = describeMermaidSource('not a diagram', { format: 'json' })
    const parsed = JSON.parse(json)
    expect(parsed.error).toBeDefined()
    expect(parsed.nodes).toEqual([])
  })
})

function parseMermaidOk(src: string) {
  const r = parseMermaid(src)
  if (!r.ok) throw new Error('parse failed')
  return r.value
}
