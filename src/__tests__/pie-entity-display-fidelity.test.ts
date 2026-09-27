import { expect, test } from 'bun:test'
import { decodeXML } from 'entities'
import { mutate, parseRegisteredMermaid, serializeMermaid } from '../agent/index.ts'
import { renderMermaidASCII, renderMermaidSVG } from '../index.ts'
import { renderMermaidSVGAsync } from '../browser-lazy.ts'
import { renderMermaidASCIIWithMeta } from '../ascii/meta.ts'
import { parsePieChart } from '../pie/parser.ts'

const cases = [
  { sourceLabel: 'A&#35;B', display: 'A&#B', xml: 'A&amp;#B' },
  { sourceLabel: 'A&#65;B', display: 'A&AB', xml: 'A&amp;AB' },
  { sourceLabel: 'A&#128;B', display: 'A&€B', xml: 'A&amp;€B' },
  { sourceLabel: 'A&#x23;B', display: 'A&&x23;B', xml: 'A&amp;&amp;x23;B' },
  { sourceLabel: 'A&#amp;B', display: 'A&&B', xml: 'A&amp;&amp;B' },
  { sourceLabel: 'A&amp;B', display: 'A&amp;B', xml: 'A&amp;amp;B' },
  { sourceLabel: 'A#copy;B', display: 'A©B', xml: 'A©B' },
  { sourceLabel: 'A#nbsp;B', display: 'A\u00a0B', xml: 'A\u00a0B' },
  { sourceLabel: 'A#unknown;B', display: 'A&unknown;B', xml: 'A&amp;unknown;B' },
] as const

function legendXml(source: string): string {
  const svg = renderMermaidSVG(source)
  const match = svg.match(/class="pie-legend-text"[^>]*>([^<]*)<\/text>/)
  if (!match) throw new Error('Pie legend text was not rendered')
  return match[1]!
}

test('Pie entity display matches pinned Mermaid browser text while preserving authored section identity', async () => {
  for (const { sourceLabel, display, xml } of cases) {
    const source = `pie\n  "${sourceLabel}" : 1\n`
    const parsed = parsePieChart(source.trim().split('\n'))
    expect(parsed.entries[0]!.label).toBe(sourceLabel)
    expect(parsed.entries[0]!.displayLabel ?? sourceLabel).toBe(display)
    expect(legendXml(source)).toStartWith(`${xml} (100.0%)`)
    const terminal = renderMermaidASCII(source, { colorMode: 'none' })
    expect(terminal).toStartWith(`${display}  `)
    const meta = renderMermaidASCIIWithMeta(source, { colorMode: 'none' })
    expect(meta.regions.map(region => [region.id, region.projectedText]))
      .toEqual([['slice-0', display]])
    const htmlMeta = renderMermaidASCIIWithMeta(source, { colorMode: 'html' })
    expect(htmlMeta.regions.map(region => [region.id, region.projectedText]))
      .toEqual([['slice-0', display]])
    expect(await renderMermaidSVGAsync(source)).toBe(renderMermaidSVG(source))

    const agent = parseRegisteredMermaid(source)
    expect(agent.ok).toBe(true)
    if (!agent.ok) continue
    expect(agent.value.body.kind).toBe('pie')
    expect(serializeMermaid(agent.value)).toBe(source)
    const changed = mutate(agent.value, { kind: 'set_slice_value', label: sourceLabel, value: 2 })
    expect(changed.ok).toBe(true)
    if (changed.ok) expect(decodeXML(legendXml(serializeMermaid(changed.value)))).toStartWith(display)
  }
})

test('Pie entity display transformation does not replace section keys or merge different spellings', () => {
  const source = 'pie\n  "A&#35;B" : 1\n  "A&#B" : 2\n'
  const entries = parsePieChart(source.trim().split('\n')).entries
  expect(entries.map(entry => [entry.label, entry.displayLabel ?? entry.label, entry.value]))
    .toEqual([['A&#35;B', 'A&#B', 1], ['A&#B', 'A&#B', 2]])
  const svg = renderMermaidSVG(source)
  expect([...svg.matchAll(/data-label="([^"]+)" data-value="([^"]+)"/g)].map(match => [decodeXML(match[1]!), Number(match[2])]))
    .toEqual([['A&#35;B', 1], ['A&#B', 2]])
  const regions = renderMermaidASCIIWithMeta(source, { colorMode: 'none' }).regions
  expect(regions.map(region => [region.id, region.projectedText, region.canvasRow]))
    .toEqual([['slice-0', 'A&#B', 0], ['slice-1', 'A&#B', 1]])
})

test('Pie style/classDef prepass changes visible text only where pinned Mermaid strips the semicolon', () => {
  for (const prefix of ['styleX', 'classDefX']) {
    const source = `pie\n  "${prefix}:#35;" : 1\n`
    const entry = parsePieChart(source.trim().split('\n')).entries[0]!
    expect(entry.label).toBe(`${prefix}:#35;`)
    expect(entry.displayLabel).toBe(`${prefix}:#35`)
    expect(renderMermaidASCII(source, { colorMode: 'none' })).toStartWith(`${prefix}:#35  `)
  }
})

test('projected terminal controls are diagnosed before SVG or terminal output', () => {
  for (const ref of ['#7;', '#9;', '#10;', '#13;', '#127;', '#129;']) {
    const source = `pie\n  "A${ref}B" : 1\n`
    expect(() => renderMermaidSVG(source)).toThrow(/Pie entity projects a terminal control character/)
    for (const colorMode of ['none', 'ansi16', 'html'] as const) {
      expect(() => renderMermaidASCII(source, { colorMode })).toThrow(/Pie entity projects a terminal control character/)
    }
  }
})

test('entity-produced tag lookalikes remain literal Pie legend and metadata text', () => {
  for (const [sourceLabel, visible] of [
    ['A#60;br#62;B', 'A<br>B'],
    ['A#60;b#62;X#60;/b#62;B', 'A<b>X</b>B'],
    ['A&#60;b>B', 'A&<b>B'],
  ] as const) {
    const source = `pie\n  "${sourceLabel}" : 1\n`
    const svg = renderMermaidSVG(source)
    expect(svg).not.toContain('<tspan font-weight="bold">')
    expect(decodeXML(legendXml(source))).toStartWith(visible)
    expect(renderMermaidASCII(source, { colorMode: 'none' })).toStartWith(visible)
    expect(renderMermaidASCIIWithMeta(source, { colorMode: 'none' }).regions[0]?.projectedText).toBe(visible)
  }
})

test('an escaped marker is source text, not a newly authored entity', () => {
  const source = 'pie\n  "A#\\35;B" : 1\n'
  const entry = parsePieChart(source.trim().split('\n')).entries[0]!
  expect(entry).toEqual({ label: 'A#35;B', value: 1 })
  expect(decodeXML(legendXml(source))).toStartWith('A#35;B')
  expect(renderMermaidASCIIWithMeta(source, { colorMode: 'none' }).regions[0]?.projectedText).toBe('A#35;B')
})

test('projected Pie entity text remains escaped in SVG and HTML terminal output', () => {
  const source = 'pie\n  "A&#60;img src=x onerror=alert(1)&#62;B" : 1\n'
  const svg = renderMermaidSVG(source)
  expect(svg).not.toContain('<img')
  expect(svg).toContain('A&amp;&lt;img src=x onerror=alert(1)&amp;&gt;B')
  const html = renderMermaidASCII(source, { colorMode: 'html' })
  expect(html).not.toContain('<img')
  expect(html).toContain('A&amp;&lt;img src=x onerror=alert(1)&amp;&gt;B')
})
