// Loop 10 M1 (#81): Mermaid classDef assignments emitted as SVG CSS classes
// so external stylesheets can target semantic node classes.

import { describe, test, expect } from 'bun:test'
import { renderMermaidSVG, renderMermaidASCII } from '../index.ts'
import { applyOps } from '../agent/core.ts'
import { parseMermaid } from '../parser.ts'
import { resolveNodeInlineStyle, resolveEdgeInlineStyle } from '../color-resolver.ts'

function nodeG(svg: string, id: string): string | undefined {
  return svg.split('\n').find(l => l.includes(`data-id="${id}"`))?.trim()
}

describe('#81 external CSS class emission', () => {
  test('accumulated node and edge classes retain paint and identities through mutation and both renderers', () => {
    const source = 'flowchart LR\nA:::warm e1@--> B\nclassDef warm fill:#ff0000,color:#ffffff\nclassDef cool stroke:#0000ff,stroke-width:3px\nclass A cool\nclass A warm\nclass e1 warm\nclass e1 cool'
    const graph = parseMermaid(source)
    expect(graph.classAssignments.get('A')).toBe('warm cool warm')
    expect(resolveNodeInlineStyle('A', graph)).toEqual({ fill: '#ff0000', color: '#ffffff', stroke: '#0000ff', 'stroke-width': '3px' })
    expect(resolveEdgeInlineStyle(0, graph)).toMatchObject({ fill: '#ff0000', stroke: '#0000ff' })
    const changed = applyOps({ source, ops: [{ kind: 'rename_node', from: 'A', to: 'Renamed' }] })
    expect(changed.ok).toBe(true)
    if (!changed.ok) return
    const serialized = changed.source
    expect(parseMermaid(serialized).classAssignments.get('Renamed')).toBe('warm cool warm')
    expect(nodeG(renderMermaidSVG(serialized), 'Renamed')).toContain('class="node warm cool warm"')
    expect(renderMermaidSVG(serialized)).toContain('#ff0000')
    const terminal = renderMermaidASCII(serialized, { colorMode: 'html' })
    expect(terminal).toContain('#0000ff')
    expect(terminal).toContain('Renamed')
    expect(terminal).toContain('B')
  })

  test('assigned class appears in the node group class attribute', () => {
    const svg = renderMermaidSVG('flowchart TD\n  A --> B\n  classDef hot fill:#f00\n  class A hot')
    expect(nodeG(svg, 'A')).toContain('class="node hot"')
  })

  test('unassigned node keeps only the structural class', () => {
    const svg = renderMermaidSVG('flowchart TD\n  A --> B\n  classDef hot fill:#f00\n  class A hot')
    expect(nodeG(svg, 'B')).toContain('class="node"')
    expect(nodeG(svg, 'B')).not.toContain('hot')
  })

  test('structural "node" class always comes first', () => {
    const svg = renderMermaidSVG('flowchart TD\n  A\n  classDef warn stroke:#ff0\n  class A warn')
    const a = nodeG(svg, 'A')!
    const m = a.match(/class="([^"]+)"/)!
    expect(m[1]!.split(' ')[0]).toBe('node')
  })

  test('data-* attributes still present (agent inspection hooks intact)', () => {
    const svg = renderMermaidSVG('flowchart TD\n  A\n  classDef hot fill:#f00\n  class A hot')
    const a = nodeG(svg, 'A')!
    expect(a).toContain('data-id="A"')
    expect(a).toContain('data-shape=')
  })

  test('classDef inline styling still renders (not broken by class emission)', () => {
    const svg = renderMermaidSVG('flowchart TD\n  A\n  classDef hot fill:#ff0000\n  class A hot')
    // The fill should still be applied to the shape (inline style path).
    expect(svg).toContain('#ff0000')
  })

  test('state ::: shorthand applies the class without leaking colons into text', () => {
    const svg = renderMermaidSVG('stateDiagram-v2\n  A : Alpha\n  A:::hot\n  classDef hot fill:#ff0000')
    expect(nodeG(svg, 'A')).toContain('class="node hot"')
    expect(svg).toContain('Alpha')
    expect(svg).not.toContain('::hot')
  })

  test('hyphenated class names survive intact in the class attribute', () => {
    const svg = renderMermaidSVG('flowchart TD\n  A:::my-class\n  classDef my-class fill:#0f0')
    // hyphen is a valid CSS ident char, so it survives
    expect(nodeG(svg, 'A')).toContain('class="node my-class"')
  })

  test('class names with invalid CSS chars are refused before they reach the class attribute', () => {
    // The parser and the typed op both refuse them, so the renderer's own
    // sanitizer (renderer.test.ts) is defence in depth, not the first line.
    for (const source of ['flowchart TD\n  A:::my.class', 'flowchart TD\n  A\n  class A a/b']) {
      expect(() => renderMermaidSVG(source)).toThrow(/Invalid flowchart statement/)
    }
    const op = applyOps({ source: 'flowchart TD\n  A --> B', ops: [{ kind: 'set_node_class', id: 'A', className: 'x"y' }] })
    expect(op).toMatchObject({ ok: false, error: { code: 'INVALID_OP' } })
  })
})
