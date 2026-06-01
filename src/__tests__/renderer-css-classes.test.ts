// Loop 10 M1 (#81): Mermaid classDef assignments emitted as SVG CSS classes
// so external stylesheets can target semantic node classes.

import { describe, test, expect } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'

function nodeG(svg: string, id: string): string | undefined {
  return svg.split('\n').find(l => l.includes(`data-id="${id}"`))?.trim()
}

describe('#81 external CSS class emission', () => {
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

  test('class names with invalid CSS chars are sanitized', () => {
    // ::: shorthand class with a dotted/odd name — must not break the class attr.
    const svg = renderMermaidSVG('flowchart TD\n  A:::my-class\n  classDef my-class fill:#0f0')
    const a = nodeG(svg, 'A')
    // hyphen is a valid CSS ident char, so it survives
    expect(a).toContain('my-class')
    // and the attribute is still well-formed (no stray quotes)
    expect(a).toMatch(/class="[A-Za-z0-9 _-]+"/)
  })
})
