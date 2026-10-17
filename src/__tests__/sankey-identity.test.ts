import { describe, expect, test } from 'bun:test'
import { layoutMermaid, parseRegisteredMermaid } from '../agent/index.ts'
import { renderMermaidASCIIWithMeta } from '../ascii/meta.ts'
import { renderMermaidSVG } from '../index.ts'
import { layoutSankeyDiagram } from '../sankey/layout.ts'
import { parseSankeyDiagram } from '../sankey/parser.ts'
import { decodedSvgAttributeValue, scanSvgStartTags } from '../svg-structure.ts'

interface ExpectedLink {
  id: string
  from: string
  to: string
}

const cases: Array<{ name: string; source: string; links: ExpectedLink[]; title?: { text: string; id: string } }> = [
  {
    name: 'authored whitespace stays distinct beside duplicate and generated-looking names',
    source: 'sankey-beta\n"A\nB",X,1\n"A B",Y,2\n"A\tB",Z,3\n"A\rB",CR,4\n"A\tB",Z,5\n"link:A\tB->Z",Other,6\n"A\n\nB",Blank,7',
    links: [
      { id: 'link:A\nB->X', from: 'A\nB', to: 'X' },
      { id: 'link:A B->Y', from: 'A B', to: 'Y' },
      { id: 'link:A\tB->Z#1', from: 'A\tB', to: 'Z' },
      { id: 'link:A\rB->CR', from: 'A\rB', to: 'CR' },
      { id: 'link:A\tB->Z#1#1', from: 'A\tB', to: 'Z' },
      { id: 'link:link:A\tB->Z->Other', from: 'link:A\tB->Z', to: 'Other' },
      { id: 'link:A\n\nB->Blank', from: 'A\n\nB', to: 'Blank' },
    ],
  },

  {
    name: 'ordinary titles retain their established identity',
    source: 'sankey-beta\nA,B,1',
    title: { text: 'Caption', id: 'title' },
    links: [{ id: 'link:A->B', from: 'A', to: 'B' }],
  },
  {
    name: 'titles cannot impersonate authored title or generated-looking title nodes',
    source: 'sankey-beta\ntitle,B,1\ntitle#1,C,2',
    title: { text: 'Caption', id: 'title#2' },
    links: [
      { id: 'link:title->B', from: 'title', to: 'B' },
      { id: 'link:title#1->C', from: 'title#1', to: 'C' },
    ],
  },
  {
    name: 'ordinary and parallel links retain established readable IDs',
    source: 'sankey-beta\nA,B,1\nA,B,2\nB,C,3',
    links: [
      { id: 'link:A->B', from: 'A', to: 'B' },
      { id: 'link:A->B#1', from: 'A', to: 'B' },
      { id: 'link:B->C', from: 'B', to: 'C' },
    ],
  },
  {
    name: 'authored hash suffixes cannot impersonate duplicate occurrences',
    source: 'sankey-beta\nA,B,1\nA,B,2\nA,B#1,3',
    links: [
      { id: 'link:A->B', from: 'A', to: 'B' },
      { id: 'link:A->B#1', from: 'A', to: 'B' },
      { id: 'link:A->B#1#1', from: 'A', to: 'B#1' },
    ],
  },
  {
    name: 'literal arrows do not alias endpoint pairs or their occurrences',
    source: 'sankey-beta\nA->B,C,1\nA,B->C,2\nA->B,C,3\nA,B->C,4',
    links: [
      { id: 'link:A->B->C', from: 'A->B', to: 'C' },
      { id: 'link:A->B->C#1', from: 'A', to: 'B->C' },
      { id: 'link:A->B->C#1#1', from: 'A->B', to: 'C' },
      { id: 'link:A->B->C#1#2', from: 'A', to: 'B->C' },
    ],
  },
  {
    name: 'authored generated-looking names are reserved, including later rows',
    source: 'sankey-beta\nA,B,1\nA,B,2\nlink:A->B,X,3\nlink:A->B#1,Y,4\nsankey-link-1,sankey-gradient-1,5\nsankey-node-1,Z,6',
    links: [
      { id: 'link:A->B#2', from: 'A', to: 'B' },
      { id: 'link:A->B#1#1', from: 'A', to: 'B' },
      { id: 'link:link:A->B->X', from: 'link:A->B', to: 'X' },
      { id: 'link:link:A->B#1->Y', from: 'link:A->B#1', to: 'Y' },
      { id: 'link:sankey-link-1->sankey-gradient-1', from: 'sankey-link-1', to: 'sankey-gradient-1' },
      { id: 'link:sankey-node-1->Z', from: 'sankey-node-1', to: 'Z' },
    ],
  },
  {
    name: 'quoted, Unicode and hash-bearing labels retain exact endpoints',
    source: 'sankey-beta\n"A""#界",B->C,1\n"A""#界",B->C,2\n"A""#界->B",C,3',
    links: [
      { id: 'link:A"#界->B->C', from: 'A"#界', to: 'B->C' },
      { id: 'link:A"#界->B->C#1', from: 'A"#界', to: 'B->C' },
      { id: 'link:A"#界->B->C#2', from: 'A"#界->B', to: 'C' },
    ],
  },
]

describe('Sankey source identities correspond across graphical and terminal projections', () => {
  test.each(cases)('$name', ({ source, links, title }) => {
    const renderedSource = title ? `---\ntitle: ${title.text}\n---\n${source}` : source
    const parsed = parseRegisteredMermaid(renderedSource)
    if (!parsed.ok) throw new Error('parse failed')
    const diagram = parseSankeyDiagram(source.split('\n'), title ? { title: title.text } : {})
    const chart = layoutSankeyDiagram(diagram)
    expect(chart.links.map(link => ({ id: link.id, from: link.source, to: link.target }))).toEqual(links)
    expect(new Set([...diagram.nodes, ...chart.links.map(link => link.id)]).size).toBe(diagram.nodes.length + links.length)

    // Bounded mark identities resolve their own endpoints independently of
    // authored source names that happen to resemble marks or resources.
    expect(new Set([...chart.nodes.map(node => node.id), ...chart.links.map(link => link.sceneId)]).size).toBe(chart.nodes.length + links.length)
    for (const link of chart.links) {
      expect(chart.nodes.find(node => node.id === link.sourceId)?.label).toBe(link.source)
      expect(chart.nodes.find(node => node.id === link.targetId)?.label).toBe(link.target)
    }

    const layout = layoutMermaid(parsed.value, { regions: true })
    expect(layout.edges.map(({ id, from, to }) => ({ id, from, to }))).toEqual(links)
    const edgeRegions = layout.regions!.filter(region => region.kind === 'edge')
    expect(edgeRegions.map(region => ({ id: region.id, elementId: region.elementId }))).toEqual(links.map(link => ({ id: `edge:${link.id}`, elementId: link.id })))
    expect(new Set(layout.regions!.map(region => region.id)).size).toBe(layout.regions!.length)
    if (title) {
      expect(chart.title?.text).toBe(title.text)
      expect(layout.nodes.find(node => node.label === title.text)?.id).toBe(title.id)
    }

    for (const style of [undefined, 'hand-drawn'] as const) {
      const svg = renderMermaidSVG(renderedSource, { embedFontImport: false, ...(style ? { style } : {}) })
      const tags = scanSvgStartTags(svg)
      const svgEdges = tags.filter(tag => decodedSvgAttributeValue(tag, 'data-role') === 'edge')
      expect(svgEdges.map(tag => ({
        id: decodedSvgAttributeValue(tag, 'data-id'),
        from: decodedSvgAttributeValue(tag, 'data-from'),
        to: decodedSvgAttributeValue(tag, 'data-to'),
      }))).toEqual(links)
      const semanticIds = tags.flatMap(tag => decodedSvgAttributeValue(tag, 'data-id') ?? [])
      expect(new Set(semanticIds).size).toBe(semanticIds.length)
      if (title) {
        const titleTag = tags.find(tag => decodedSvgAttributeValue(tag, 'data-role') === 'title')
        expect(titleTag && decodedSvgAttributeValue(titleTag, 'data-id')).toBe(title.id)
      }
    }

    for (const useAscii of [false, true]) for (const colorMode of ['none', 'ansi16', 'ansi256', 'truecolor', 'html'] as const) {
      const terminal = renderMermaidASCIIWithMeta(renderedSource, { useAscii, colorMode })
      expect(terminal.warnings.filter(warning => [
        'ASCII_RENDER_FAILED', 'TERMINAL_OWNERSHIP_UNAVAILABLE', 'TERMINAL_TEXT_COLLISION',
        'TERMINAL_ROUTE_OVERLAP', 'TERMINAL_GEOMETRY_COLLISION',
      ].includes(warning.code))).toEqual([])
      const edges = terminal.regions.filter(region => region.kind === 'edge')
      // Adjacency sections group source rows; correspondence is by identity,
      // rather than the graphical renderer's global authored drawing order.
      expect(edges).toHaveLength(links.length)
      for (const link of links) expect(edges.map(({ id, from, to }) => ({ id, from, to }))).toContainEqual(link)
      expect(new Set(terminal.regions.map(region => region.id)).size).toBe(terminal.regions.length)
      if (title) expect(terminal.regions.find(region => region.kind === 'label' && region.id === title.id)?.projectedText).toBe(title.text)
      for (const edge of edges) {
        expect(edge.ownedCellSpans!.length).toBeGreaterThan(0)
        expect(terminal.regions.find(region => region.kind === 'node' && region.id === edge.from)).toBeDefined()
        expect(terminal.regions.find(region => region.kind === 'node' && region.id === edge.to)).toBeDefined()
      }
    }
  })
})
