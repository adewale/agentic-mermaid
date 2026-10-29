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
  test('malformed records after multiline CSV report their physical source row', () => {
    for (const ending of ['\n', '\r', '\r\n']) {
      const source = ['sankey-beta', '"A\nB",C,1', 'D,E,2,extra'].join(ending)
      expect(() => renderMermaidSVG(source)).toThrow('Sankey row 4 has 4 columns')
    }
  })

  test('a payload CR beside CRLF stays distinct in source and target identities', () => {
    const source = 'sankey-beta\n"A""&amp;\r\r\nB","T&amp;amp;\r\r\nU",1\n"A""&amp;\r\nB","T&amp;amp;\r\nU",2\n"A""&amp;\r\r\r\nB","T&amp;amp;\r\r\r\nU",3'
    const pairs = [
      { from: 'A"&\r\nB', to: 'T&amp;\r\nU' },
      { from: 'A"&\nB', to: 'T&amp;\nU' },
      { from: 'A"&\r\r\nB', to: 'T&amp;\r\r\nU' },
    ]
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw new Error('parse failed')
    const layout = layoutMermaid(parsed.value)
    expect(layout.edges.map(({ from, to }) => ({ from, to }))).toEqual(pairs)
    expect(layout.nodes).toHaveLength(6)
    const tags = scanSvgStartTags(renderMermaidSVG(source, { embedFontImport: false }))
    expect(tags.filter(tag => decodedSvgAttributeValue(tag, 'data-role') === 'edge').map(tag => ({
      from: decodedSvgAttributeValue(tag, 'data-from'),
      to: decodedSvgAttributeValue(tag, 'data-to'),
    }))).toEqual(pairs)
    for (const input of [source, parsed.value]) {
      const terminal = renderMermaidASCIIWithMeta(input, { colorMode: 'none' })
      expect(terminal.warnings).not.toContainEqual(expect.objectContaining({ code: 'ASCII_RENDER_FAILED' }))
      const edges = terminal.regions.filter(region => region.kind === 'edge')
      expect(edges).toHaveLength(pairs.length)
      for (const pair of pairs) expect(edges.map(({ from, to }) => ({ from, to }))).toContainEqual(pair)
    }
  })

  test('structural CR and encoded wrappers keep quoted CSV identities across projections', () => {
    const links = [
      { id: 'link:A"&\rB->&amp;', from: 'A"&\rB', to: '&amp;' },
      { id: 'link:A"&\nB->Other', from: 'A"&\nB', to: 'Other' },
      { id: 'link:A"&\nB->Third', from: 'A"&\nB', to: 'Third' },
    ]
    for (const ending of ['\n', '\r', '\r\n']) {
      const source = [
        '---', 'title: Wrapped &amp; CSV', '---',
        '%%{init: {}}%%', 'sankey-beta', '%% ignored "',
        'accDescr {', 'ignored "', '}',
        '"A""&amp;\rB",&amp;amp;,1',
        '"A""&amp;\nB",Other,2',
        '"A""&amp;\r\nB",Third,3',
      ].join(ending)
      const parsed = parseRegisteredMermaid(source)
      if (!parsed.ok) throw new Error('parse failed')
      expect(layoutMermaid(parsed.value).edges.map(({ id, from, to }) => ({ id, from, to }))).toEqual(links)
      for (const renderedSource of [source, source.replace(/^---(?:\r\n?|\n)/, '&#45;&#45;&#45;&#10;')]) {
        const tags = scanSvgStartTags(renderMermaidSVG(renderedSource, { embedFontImport: false }))
        expect(tags.filter(tag => decodedSvgAttributeValue(tag, 'data-role') === 'edge').map(tag => ({
          id: decodedSvgAttributeValue(tag, 'data-id'),
          from: decodedSvgAttributeValue(tag, 'data-from'),
          to: decodedSvgAttributeValue(tag, 'data-to'),
        }))).toEqual(links)
        for (const input of [renderedSource, ...(renderedSource === source ? [parsed.value] : [])]) {
          const terminal = renderMermaidASCIIWithMeta(input, { colorMode: 'none' })
          expect(terminal.warnings).not.toContainEqual(expect.objectContaining({ code: 'ASCII_RENDER_FAILED' }))
          const edges = terminal.regions.filter(region => region.kind === 'edge')
          expect(edges).toHaveLength(links.length)
          for (const link of links) expect(edges.map(({ id, from, to }) => ({ id, from, to }))).toContainEqual(link)
        }
      }
    }
  })

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
