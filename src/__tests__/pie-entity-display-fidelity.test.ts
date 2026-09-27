import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { decodeHTML, decodeXML } from 'entities'
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
  { sourceLabel: 'A#92;rB', display: 'A\\rB', xml: 'A\\rB' },
  { sourceLabel: 'A#92;#35;B', display: 'A\\#B', xml: 'A\\#B' },
  { sourceLabel: 'A#92;XB', display: 'A\\XB', xml: 'A\\XB' },
  { sourceLabel: 'A#nbsp;B', display: 'A\u00a0B', xml: 'A\u00a0B' },
  { sourceLabel: 'A#unknown;B', display: 'A&unknown;B', xml: 'A&amp;unknown;B' },
  { sourceLabel: 'A#constructor;B', display: 'A&constructor;B', xml: 'A&amp;constructor;B' },
  { sourceLabel: 'A#__proto__;B', display: 'A&__proto__;B', xml: 'A&amp;__proto__;B' },
] as const

function legendXml(source: string): string {
  const svg = renderMermaidSVG(source)
  const match = svg.match(/class="pie-legend-text"[^>]*>([^<]*)<\/text>/)
  if (!match) throw new Error('Pie legend text was not rendered')
  return match[1]!
}

function titleXml(source: string): string {
  const match = renderMermaidSVG(source).match(/class="pie-title"[^>]*>([^<]*)<\/text>/)
  if (!match) throw new Error('Pie title was not rendered')
  return match[1]!
}

test('Pie title entities follow pinned Mermaid visible text while source and agent title stay authored', async () => {
  for (const { sourceTitle, display, xml } of [
    { sourceTitle: 'A#65;B', display: 'AAB', xml: 'AAB' },
    { sourceTitle: 'A#copy;B', display: 'A©B', xml: 'A©B' },
    { sourceTitle: 'A&#65;B', display: 'A&AB', xml: 'A&amp;AB' },
    { sourceTitle: 'A#92;rB', display: 'A\\rB', xml: 'A\\rB' },
  ] as const) {
    for (const inline of [false, true]) {
      const source = inline
        ? `pie title ${sourceTitle}\n  "X" : 1\n`
        : `pie\n  title ${sourceTitle}\n  "X" : 1\n`
      const chart = parsePieChart(source.trim().split('\n'))
      expect(chart.title).toBe(sourceTitle)
      expect(chart.displayTitle).toBe(display)
      expect(titleXml(source)).toBe(xml)
      expect(renderMermaidASCII(source, { colorMode: 'none' })).toStartWith(`${display}\n`)
      for (const colorMode of ['none', 'html'] as const) {
        const meta = renderMermaidASCIIWithMeta(source, { colorMode })
        expect(meta.regions.find(region => region.id === 'title')?.projectedText).toBe(display)
      }
      expect(await renderMermaidSVGAsync(source)).toBe(renderMermaidSVG(source))
      const agent = parseRegisteredMermaid(source)
      expect(agent.ok).toBe(true)
      if (!agent.ok) continue
      const serialized = serializeMermaid(agent.value)
      expect(serialized).toContain(`title ${sourceTitle}`)
      if (!inline) expect(serialized).toBe(source)
      const changed = mutate(agent.value, { kind: 'set_slice_value', label: 'X', value: 2 })
      expect(changed.ok).toBe(true)
      if (changed.ok) expect(decodeXML(titleXml(serializeMermaid(changed.value)))).toBe(display)
    }
  }
})

test('Pie title entity projection cannot inject markup or terminal controls', () => {
  const source = 'pie\n  title A#60;script#62;B\n  "X" : 1\n'
  expect(parsePieChart(source.trim().split('\n')).displayTitle).toBe('A<script>B')
  expect(titleXml(source)).toBe('A&lt;script&gt;B')
  expect(renderMermaidASCII(source, { colorMode: 'html' })).not.toContain('<script>')
  for (const code of ['7', '9', '10', '13', '27', '127', '129']) {
    const bad = `pie\n  title A#${code};B\n  "X" : 1\n`
    expect(() => renderMermaidSVG(bad)).toThrow(/Pie entity projects a terminal control character/)
    for (const colorMode of ['none', 'ansi16', 'ansi256', 'truecolor', 'html'] as const) {
      expect(() => renderMermaidASCII(bad, { colorMode })).toThrow(/Pie entity projects a terminal control character/)
    }
  }
})

test('entity-encoded Pie directive grammar does not consume authored title entities or split inline title spans', () => {
  for (const [source, authoredTitle, visible] of [
    ['pie title A#65;B\n  "X" : 1\n', 'A#65;B', 'AAB'],
    ['pie title A;B\n  "X" : 1\n', 'A;B', 'A;B'],
    ['pie&#32;title A&#65;B\n  "X" : 1\n', 'A&#65;B', 'A&AB'],
    ['pie\n  t&#105;tle A&#65;B\n  "X" : 1\n', 'A&#65;B', 'A&AB'],
    ['pie title &#32;X\n  "X" : 1\n', '&#32;X', '& X'],
    ['pie\n  title &#32;X\n  "X" : 1\n', '&#32;X', '& X'],
  ] as const) {
    const agent = parseRegisteredMermaid(source)
    expect(agent.ok).toBe(true)
    if (!agent.ok) continue
    expect(agent.value.body.kind).toBe('pie')
    if (agent.value.body.kind === 'pie') expect(agent.value.body.title).toBe(authoredTitle)
    expect(serializeMermaid(agent.value)).toContain(`title ${authoredTitle}`)
    expect(decodeXML(titleXml(source))).toBe(visible)
    const firstLineLength = source.indexOf('\n')
    if (source.startsWith('pie title') || source.startsWith('pie&#32;title')) {
      expect(agent.value.source.spans?.preserved.header.end.offset).toBe(firstLineLength)
      expect(agent.value.source.spans?.preserved.body.start.offset).toBe(firstLineLength + 1)
    }
  }
})

test('pinned Mermaid Pie DB and SVG entity cleanup witness title display independently', () => {
  for (const [sourceTitle, expectedMarker, expectedDisplay] of [
    ['A#65;B', 'Aﬂ°°65¶ßB', 'AAB'],
    ['A&#65;B', 'A&ﬂ°°65¶ßB', 'A&AB'],
    ['A#copy;B', 'Aﬂ°copy¶ßB', 'A©B'],
    ['&#32;X', '&ﬂ°°32¶ßX', '& X'],
  ] as const) {
    const source = `pie\n  title ${sourceTitle}\n  "X" : 1\n`
    const script = `
      import DOMPurify from 'dompurify'
      DOMPurify.addHook = () => {}
      DOMPurify.sanitize = text => text
      const { default: mermaid } = await import('mermaid')
      mermaid.initialize({ startOnLoad: false })
      const diagram = await mermaid.mermaidAPI.getDiagramFromText(${JSON.stringify(source)})
      process.stdout.write(JSON.stringify(diagram.db.getDiagramTitle()))
    `
    const probe = Bun.spawnSync({ cmd: [process.execPath, '-e', script], cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' })
    expect(probe.exitCode).toBe(0)
    const marker = JSON.parse(new TextDecoder().decode(probe.stdout)) as string
    expect(marker).toBe(expectedMarker)
    const finalReference = marker.replaceAll('ﬂ°°', '&#').replaceAll('ﬂ°', '&').replaceAll('¶ß', ';')
    expect(decodeHTML(finalReference)).toBe(expectedDisplay)
    expect(decodeXML(titleXml(source))).toBe(expectedDisplay)
  }
})

test('reviewed Pie title before/after visuals use the same production source', () => {
  const source = 'pie showData\n  title A#65;B\n  "X" : 1\n  "Y" : 2\n'
  const asset = (which: 'before' | 'after') => readFileSync(
    join(import.meta.dir, `../../docs/pr-assets/issue-248-pie-title-entity-${which}.svg`), 'utf8')
  expect(asset('before')).toContain('>A#65;B</text>')
  expect(asset('after')).toBe(renderMermaidSVG(source))
  expect(asset('after')).toContain('>AAB</text>')
})

test('Pie inline showData title keeps authored entity spelling and an entity-created tag stays literal', () => {
  const inline = 'pie showData title A#65;B\n  "X" : 1\n'
  const parsed = parseRegisteredMermaid(inline)
  expect(parsed.ok).toBe(true)
  if (parsed.ok && parsed.value.body.kind === 'pie') {
    expect(parsed.value.body.title).toBe('A#65;B')
    expect(serializeMermaid(parsed.value)).toContain('title A#65;B')
  }
  expect(titleXml(inline)).toBe('AAB')
  const markup = 'pie\n  title A#60;br#62;B\n  "X" : 1\n'
  expect(parsePieChart(markup.trim().split('\n')).displayTitle).toBe('A<br>B')
  expect(titleXml(markup)).toBe('A&lt;br&gt;B')
  expect(renderMermaidASCII(markup, { colorMode: 'none' })).toStartWith('A<br>B\n')
  expect(renderMermaidASCIIWithMeta(markup, { colorMode: 'none' }).regions[0]?.projectedText).toBe('A<br>B')
  const mixed = 'pie\n  title A#65;<b>B</b>\n  "X" : 1\n'
  expect(titleXml(mixed)).toBe('AA&lt;b&gt;B&lt;/b&gt;')
  expect(renderMermaidASCII(mixed, { colorMode: 'none' })).toStartWith('AA<b>B</b>\n')
})

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
  for (const sourceLabel of [
    'A#7;B', 'A#9;B', 'A#10;B', 'A#13;B', 'A#127;B', 'A#129;B',
  ]) {
    const source = `pie\n  "${sourceLabel}" : 1\n`
    const diagnostic = /Pie entity (?:projects|projection creates) a terminal control character/
    expect(() => renderMermaidSVG(source)).toThrow(diagnostic)
    for (const colorMode of ['none', 'ansi16', 'html'] as const) {
      expect(() => renderMermaidASCII(source, { colorMode })).toThrow(diagnostic)
    }
  }
})

test('entity-created backslashes remain printable after the source escape pass', () => {
  for (const [sourceLabel, visible] of [
    ['A#92;nB', 'A\\nB'],
    ['A#92;rB', 'A\\rB'],
    ['A#92;tB', 'A\\tB'],
    ['A#92;#114;B', 'A\\rB'],
  ] as const) {
    const source = `pie\n  "${sourceLabel}" : 1\n`
    const entry = parsePieChart(source.trim().split('\n')).entries[0]!
    expect(entry.displayLabel).toBe(visible)
    expect(decodeXML(legendXml(source))).toStartWith(visible)
    for (const colorMode of ['none', 'ansi16', 'html'] as const) {
      const rendered = renderMermaidASCII(source, { colorMode })
      expect(rendered).toContain(visible)
      expect(renderMermaidASCIIWithMeta(source, { colorMode }).regions[0]?.projectedText).toBe(visible)
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

test('a pre-existing authored escape remains accepted beside printable entity text', () => {
  const source = 'pie\n  "A\\nB&#35;" : 1\n'
  const entry = parsePieChart(source.trim().split('\n')).entries[0]!
  expect(entry.label).toBe('A\nB&#35;')
  expect(entry.displayLabel).toBe('A\nB&#')
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
