import { beforeAll, describe, expect, test } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'
import { renderedTextReady, measureRenderedText } from './helpers/rendered-text.ts'

beforeAll(() => renderedTextReady())
const title = ['First authored title line', 'Second authored title line', 'Third authored title line', 'Fourth authored title line', 'Fifth authored title line'].join('\n')
const bodies = {
  pie: 'pie\n "n0" : 1\n "n1" : 2',
  sankey: 'sankey-beta\n n0,nsink,1',
  architecture: 'architecture-beta\n group ng(cloud)[G]\n service ns0(server)[S0] in ng\n service ns1(server)[S1] in ng\n ns0:R -- L:ns1',
  gantt: 'gantt\n dateFormat YYYY-MM-DD\n Work :a, 2024-01-01, 10d',
  radar: 'radar-beta\n axis a["A"], b["B"], c["C"]\n curve value{1,2,3}',
}

describe('prepared family text preserves authored display and allocated bounds', () => {
  for (const [family, body] of Object.entries(bodies)) {
    test(`${family} reserves a complete five-line frontmatter title above chart content`, () => {
      const svg = renderMermaidSVG(`---\ntitle: ${JSON.stringify(title)}\n---\n${body}`)
      const census = measureRenderedText(svg)
      const heading = census.texts.find(t => t.content.includes('First authored'))!
      expect(heading).toBeDefined()
      expect(heading.content).toContain('Fifth authored title line')
      const headingElement = [...svg.matchAll(/<text\b[^>]*>[\s\S]*?<\/text>/g)].find(m => m[0].includes('First authored'))![0]
      expect(headingElement.match(/<tspan\b/g)).toHaveLength(5)
      expect(heading.offCanvasPixels).toBe(0)
      expect(heading.pixels).toBeGreaterThan(0)
      const other = census.texts.filter(t => t !== heading && t.pixels > 0 && t.box)
      expect(other.length).toBeGreaterThan(0)
      for (const text of other) expect(text.box!.y).toBeGreaterThan(heading.box!.y + heading.box!.height)
    }, 60_000)
  }

  for (const [family, body] of Object.entries(bodies)) {
    for (const [name, heading] of [
      ['long token', 'antidisestablishmentarianism'.repeat(4)],
      ['graphemes', '漢字ひらがな e\u0301 👩🏽‍💻 👨‍👩‍👧‍👦'],
    ] as const) {
      test(`${family} contains ${name} titles with resolved weight and tracking`, () => {
        const svg = renderMermaidSVG(`---\ntitle: ${JSON.stringify(heading)}\n---\n${body}`, {
          style: { roles: { group: { fontSize: 22, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase' } } },
        })
        const text = measureRenderedText(svg).texts.find(t => t.content.replace(/\s/g, '').includes(heading.toUpperCase().replace(/\s/g, '').slice(0, 12)))!
        expect(text).toBeDefined()
        expect(text.offCanvasPixels).toBe(0)
        expect(text.pixels).toBeGreaterThan(0)
      }, 60_000)
    }
  }

  test('architecture multiline group headers reserve their full band above services', () => {
    const svg = renderMermaidSVG('architecture-beta\n group g(cloud)["First<br/>Second<br/>Third<br/>Fourth<br/>Fifth"]\n service a(server)[Below heading] in g')
    const text = measureRenderedText(svg).texts
    const header = text.find(t => t.content.includes('First'))!
    const service = text.find(t => t.content === 'Below heading')!
    expect(header.offCanvasPixels).toBe(0)
    expect(header.content).toContain('Fifth')
    expect(service.box!.y).toBeGreaterThan(header.box!.y + header.box!.height)
  })

  test('quadrant half-axis labels retain every wrapped line and reserve its gutter', () => {
    const near = 'A very detailed low effort description that cannot fit in only two lines while retaining every word'
    const far = 'An equally detailed high effort description that also retains its complete authored ending'
    const svg = renderMermaidSVG(`quadrantChart\n x-axis ${near} --> ${far}\n y-axis Small --> Large\n A: [0.3,0.6]`)
    const census = measureRenderedText(svg)
    const axis = census.texts.find(text => text.content.startsWith('A very detailed'))!
    expect(axis.content.replace(/[\s-]/g, '')).toBe(near.replace(/[\s-]/g, ''))
    expect(axis.content).not.toContain('…')
    expect(axis.offCanvasPixels).toBe(0)
    expect(census.texts.find(text => text.content.startsWith('An equally'))!.content.replace(/[\s-]/g, '')).toBe(far.replace(/[\s-]/g, ''))
  })

  test('quadrant capitalization is applied before word wrapping, once', () => {
    const word = 'pneumonoultramicroscopicsilicovolcanoconiosis'.repeat(3)
    const svg = renderMermaidSVG(`---\ntitle: ${JSON.stringify(word)}\n---\nquadrantChart\n A: [0.3,0.6]`, { style: { roles: { group: { textTransform: 'capitalize' } } } })
    const text = measureRenderedText(svg).texts.find(t => t.content.startsWith('Pneumonoultra'))!.content
    expect(text.replace(/[\s-]/g, '')).toBe('P' + word.slice(1))
  })

  for (const family of ['gantt', 'radar'] as const) {
    for (const label of [
      '漢字ひらがな'.repeat(8),
      'e\u0301👩🏽‍💻'.repeat(12),
      'antidisestablishmentarianism'.repeat(4),
      '<i>Literal</i>  whitespace & entity-like &#35; text repeated repeatedly',
    ]) {
      test(`${family} retains wrapped literal graphemes under weight and tracking: ${label.slice(0, 16)}`, () => {
        const body = family === 'gantt'
          ? `gantt\n dateFormat YYYY-MM-DD\n ${label} :a, 2024-01-01, 10d`
          : `radar-beta\n axis a["${label}"], b["B"], c["C"]\n curve value{1,2,3}`
        const svg = renderMermaidSVG(body, { style: { roles: {
          node: { fontSize: 20, fontWeight: 800, letterSpacing: 2 },
          edge: { fontSize: 20, fontWeight: 800, letterSpacing: 2 },
        } } })
        const chart = measureRenderedText(svg)
        const displayed = chart.texts.map(t => t.content).join('')
        expect(displayed.replace(/[\s-]/g, '')).toContain(label.replace('&#35;', '#').replace(/[\s-]/g, ''))
        expect(chart.texts.filter(t => t.offCanvasPixels > 0).map(t => t.content)).toEqual([])
      }, 60_000)
    }
  }

  for (const family of ['gantt', 'radar'] as const) {
    test(`${family} wraps literal tags without multiplying formatting delimiters`, () => {
      const label = '<b>This is a very long label that describes the work in detail</b>'
      const body = family === 'gantt'
        ? `gantt\n dateFormat YYYY-MM-DD\n ${label} :a, 2024-01-01, 10d`
        : `radar-beta\n axis a["${label}"], b["B"], c["C"]\n curve value{1,2,3}`
      const text = measureRenderedText(renderMermaidSVG(body)).texts.map(t => t.content).join(' ')
      expect(text.match(/<b>/g)).toHaveLength(1)
      expect(text.match(/<\/b>/g)).toHaveLength(1)
      expect(text.replace(/\s+/g, ' ')).toContain('work in detail</b>')
    })
  }
})
