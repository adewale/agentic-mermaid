import { describe, it, expect } from 'bun:test'
import { parseMermaid } from '../parser.ts'
import { renderMermaidSVG } from '../index.ts'
import { parseRegisteredMermaid, serializeMermaid } from '../agent/index.ts'

describe('linkStyle – parser', () => {
  it('parses linkStyle with single index', () => {
    const g = parseMermaid('graph TD\n  A --> B\n  linkStyle 0 stroke:#ff0000,stroke-width:2px')
    expect(g.linkStyles.get(0)).toEqual({ stroke: '#ff0000', 'stroke-width': '2px' })
  })

  it('parses linkStyle with comma-separated indices', () => {
    const g = parseMermaid('graph TD\n  A --> B\n  B --> C\n  linkStyle 0,1 stroke:#00ff00')
    expect(g.linkStyles.get(0)).toEqual({ stroke: '#00ff00' })
    expect(g.linkStyles.get(1)).toEqual({ stroke: '#00ff00' })
  })

  it('parses linkStyle default', () => {
    const g = parseMermaid('graph TD\n  A --> B\n  linkStyle default stroke:#888888,stroke-width:3px')
    expect(g.linkStyles.get('default')).toEqual({ stroke: '#888888', 'stroke-width': '3px' })
  })

  it('later linkStyle overrides earlier for same index', () => {
    const g = parseMermaid('graph TD\n  A --> B\n  linkStyle 0 stroke:#ff0000\n  linkStyle 0 stroke:#00ff00')
    expect(g.linkStyles.get(0)).toEqual({ stroke: '#00ff00' })
  })

  // BUG-36: upstream's `updateLink` rejects an index past the links defined
  // above the linkStyle line. Ours reads it and verify reports it (parser.test.ts):
  // an index naming a link defined later styles that link, one naming no
  // link styles nothing, and the typed serializer writes only an index that
  // names a link, after the links.
  it('BUG-36: a linkStyle before its link styles it; one naming no link is not written back', () => {
    expect(parseMermaid('graph TD\n  linkStyle 0 stroke:#ff0000\n  A --> B').linkStyles.get(0)).toEqual({ stroke: '#ff0000' })
    const parsed = parseRegisteredMermaid('flowchart TD\n  A --> B\n  linkStyle 0,99 stroke:#ff0000')
    expect(parsed.ok && serializeMermaid(parsed.value)).toBe('flowchart TD\n  A --> B\n  linkStyle 0 stroke:#ff0000\n')
  })

  it('strips trailing semicolons from style values', () => {
    const g = parseMermaid('graph TD\n  A --> B\n  linkStyle 0 stroke:#ff0000,stroke-width:4px;')
    expect(g.linkStyles.get(0)).toEqual({ stroke: '#ff0000', 'stroke-width': '4px' })
  })
})

describe('linkStyle – state diagram parser', () => {
  it('parses linkStyle in state diagrams', () => {
    const g = parseMermaid('stateDiagram-v2\n  A --> B\n  linkStyle 0 stroke:#ff0000')
    expect(g.linkStyles.get(0)).toEqual({ stroke: '#ff0000' })
  })

  it('parses linkStyle default in state diagrams', () => {
    const g = parseMermaid('stateDiagram-v2\n  A --> B\n  B --> C\n  linkStyle default stroke:#888')
    expect(g.linkStyles.get('default')).toEqual({ stroke: '#888' })
  })
})

describe('linkStyle – SVG integration', () => {
  it('applies linkStyle stroke color to SVG edge', () => {
    const svg = renderMermaidSVG('graph TD\n  A --> B\n  linkStyle 0 stroke:#ff0000')
    expect(svg).toContain('stroke="#ff0000"')
  })

  it('applies linkStyle stroke-width to SVG edge', () => {
    const svg = renderMermaidSVG('graph TD\n  A --> B\n  linkStyle 0 stroke-width:3px')
    expect(svg).toContain('stroke-width="3px"')
  })

  it('applies linkStyle default to all edges', () => {
    const svg = renderMermaidSVG('graph TD\n  A --> B\n  B --> C\n  linkStyle default stroke:#00ff00')
    const matches = svg.match(/stroke="#00ff00"/g)
    expect(matches).not.toBeNull()
    expect(matches!.length).toBeGreaterThanOrEqual(2)
  })

  it('index-specific linkStyle overrides default', () => {
    const svg = renderMermaidSVG(
      'graph TD\n  A --> B\n  B --> C\n  linkStyle default stroke:#888\n  linkStyle 0 stroke:#ff0000'
    )
    const strokes = Object.fromEntries(
      [...svg.matchAll(/<polyline class="edge" data-from="(\w+)" data-to="(\w+)"[^>]* stroke="([^"]+)"/g)]
        .map(([, from, to, stroke]) => [`${from}->${to}`, stroke]),
    )
    expect(strokes).toEqual({ 'A->B': '#ff0000', 'B->C': '#888' })
  })

  it('arrowhead color matches custom stroke color', () => {
    const svg = renderMermaidSVG('graph TD\n  A --> B\n  linkStyle 0 stroke:#ff0000')
    // Should have a color-specific marker def (# is hex-encoded to "23")
    expect(svg).toContain('id="arrowhead-23ff0000"')
    expect(svg).toContain('fill="#ff0000"')
    // Edge should reference the colored marker
    expect(svg).toContain('marker-end="url(#arrowhead-23ff0000)"')
  })

  it('rejects XSS injection in stroke value, naming the directive and the value', () => {
    expect(() => renderMermaidSVG('graph TD\n  A --> B\n  linkStyle 0 stroke:red" onmouseover="alert(1)'))
      .toThrow('linkStyle 0: stroke "red\\" onmouseover=\\"alert(1)" is not a CSS color — expected')
  })

  it('trailing semicolons do not leak into SVG attributes', () => {
    const svg = renderMermaidSVG('graph TD\n  A --> B\n  linkStyle 0 stroke:#ff0000,stroke-width:4px;')
    expect(svg).toContain('stroke-width="4px"')
    expect(svg).not.toContain('stroke-width="4px;"')
  })
})
