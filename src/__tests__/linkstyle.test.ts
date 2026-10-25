import { describe, it, expect } from 'bun:test'
import { parseMermaid } from '../parser.ts'
import { renderMermaidSVG } from '../index.ts'
import { parseRegisteredMermaid, serializeMermaid } from '../agent/index.ts'
import { scanSvgStartTags } from '../svg-structure.ts'

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
    const edges = [...svg.matchAll(/<polyline class="edge"[^>]*>/g)].map(([tag]) => tag)
    expect(edges).toHaveLength(1)
    expect(edges[0]).toContain('stroke="#ff0000"')
  })

  it('applies linkStyle stroke-width to SVG edge', () => {
    const svg = renderMermaidSVG('graph TD\n  A --> B\n  linkStyle 0 stroke-width:3px')
    const edge = [...svg.matchAll(/<polyline class="edge"[^>]*>/g)].map(([tag]) => tag)
    expect(edge).toHaveLength(1)
    expect(edge[0]).toContain('stroke-width="3px"')
  })

  it('applies linkStyle default to all edges', () => {
    const svg = renderMermaidSVG('graph TD\n  A --> B\n  B --> C\n  linkStyle default stroke:#00ff00')
    const edges = [...svg.matchAll(/<polyline class="edge"[^>]*>/g)].map(([tag]) => tag)
    expect(edges).toHaveLength(2)
    for (const edge of edges) expect(edge).toContain('stroke="#00ff00"')
  })

  it('index-specific linkStyle overrides default', () => {
    const svg = renderMermaidSVG(
      'graph TD\n  A --> B\n  B --> C\n  linkStyle default stroke:#888\n  linkStyle 0 stroke:#ff0000'
    )
    const strokes = Object.fromEntries([...svg.matchAll(/<polyline class="edge"[^>]*>/g)].map(([tag]) => {
      const attribute = (name: string) => new RegExp(` ${name}="([^"]+)"`).exec(tag)?.[1]
      return [`${attribute('data-from')}->${attribute('data-to')}`, attribute('stroke')]
    }))
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

  it.each([
    ['hyphen and encoded digits', 'var(--a-b)', 'var(--a2db)'],
    ['underscore and encoded digits', 'var(--a_b)', 'var(--a5fb)'],
    ['delimiter-bearing variable names', 'var(--color-61-62)', 'var(--color_61_62)'],
    ['near-limit variable names', `var(--${'a'.repeat(225)}b)`, `var(--${'a'.repeat(225)}c)`],
    ['legacy hex and named colors', '#ff0000', 'red'],
  ])('keeps %s marker resources and endpoint colors distinct in either edge order', (_name, first, second) => {
    for (const colors of [[first!, second!], [second!, first!]]) {
      const svg = renderMermaidSVG(`flowchart LR\nA<-->B<-->C\nlinkStyle 0 stroke:${colors[0]}\nlinkStyle 1 stroke:${colors[1]}`)
      const tags = scanSvgStartTags(svg)
      const attributes = (tag: typeof tags[number]) => new Map(tag.attributes.map(attribute => [attribute.name, attribute.value]))
      const markers = tags.filter(tag => tag.name === 'marker')
      const byId = new Map(markers.map(tag => [attributes(tag).get('id'), tag]))
      expect(byId.size).toBe(markers.length)
      const legacySuffixes: Readonly<Record<string, string>> = { '#ff0000': '23ff0000', red: 'red' }
      for (const [index, color] of colors.entries()) {
        const edge = tags.find(tag => attributes(tag).get('class') === 'edge' && attributes(tag).get('data-from') === (index === 0 ? 'A' : 'B'))!
        const edgeAttributes = attributes(edge)
        expect(edgeAttributes.get('stroke')).toBe(color)
        for (const end of ['start', 'end'] as const) {
          const reference = edgeAttributes.get(`marker-${end}`)!
          const id = reference.match(/^url\(#([^)]*)\)$/)![1]!
          const marker = byId.get(id)!
          expect(marker).toBeDefined()
          const artwork = scanSvgStartTags(svg.slice(marker.end, svg.indexOf('</marker>', marker.end)))[0]!
          expect(attributes(artwork).get('fill')).toBe(color)
          expect(attributes(artwork).get('stroke')).toBe(color)
          if (legacySuffixes[color]) expect(id).toBe(`arrowhead${end === 'start' ? '-start' : ''}-${legacySuffixes[color]}`)
        }
      }
    }
  })

  it('resolves fixed-width circle, cross and arrow endpoints to their intended colored resources', () => {
    // The 222-character names reached exactly 256 characters with the
    // previous circlehead-start-<suffix>-fixed resource naming scheme.
    for (const [circle, cross] of [['var(--a-b)', 'var(--a2db)'], [`var(--${'a'.repeat(221)}b)`, `var(--${'a'.repeat(221)}c)`]]) {
      const svg = renderMermaidSVG(`flowchart LR\nA o--o B\nB x--x C\nC<-->D\nlinkStyle 0 stroke:${circle},stroke-width:2px\nlinkStyle 1 stroke:${cross},stroke-width:3px\nlinkStyle 2 stroke:#f00,stroke-width:4px`)
      const tags = scanSvgStartTags(svg)
      const attributes = (tag: typeof tags[number]) => new Map(tag.attributes.map(attribute => [attribute.name, attribute.value]))
      const markers = tags.filter(tag => tag.name === 'marker')
      const byId = new Map(markers.map(tag => [attributes(tag).get('id'), tag]))
      expect(byId.size).toBe(markers.length)
      for (const marker of markers) expect(attributes(marker).get('id')!.length).toBeLessThanOrEqual(256)
      for (const [from, color, prefix] of [['A', circle, 'circlehead'], ['B', cross, 'crosshead'], ['C', '#f00', 'arrowhead']]) {
        const edge = tags.find(tag => attributes(tag).get('class') === 'edge' && attributes(tag).get('data-from') === from)!
        expect(attributes(edge).get('stroke')).toBe(color)
        for (const end of ['start', 'end'] as const) {
          const id = attributes(edge).get(`marker-${end}`)!.match(/^url\(#([^)]*)\)$/)![1]!
          const marker = byId.get(id)!
          expect(id).toStartWith(`${prefix}${end === 'start' ? '-start' : ''}-`)
          expect(id).toEndWith('-fixed')
          expect(attributes(marker).get('markerUnits')).toBe('userSpaceOnUse')
          const artwork = scanSvgStartTags(svg.slice(marker.end, svg.indexOf('</marker>', marker.end)))
          expect(artwork.length).toBeGreaterThan(0)
          for (const shape of artwork) expect(attributes(shape).get('stroke')).toBe(color)
          if (color === '#f00') expect(id).toBe(`arrowhead${end === 'start' ? '-start' : ''}-23f00-fixed`)
        }
      }
    }
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
