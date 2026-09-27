import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { decodeXML } from 'entities'
import { mutate, parseRegisteredMermaid, renderMermaidWithActions, serializeMermaid, verifyMermaid } from '../agent/index.ts'
import { renderMermaidASCII, renderMermaidSVG } from '../index.ts'
import { renderMermaidASCIIWithMeta } from '../ascii/meta.ts'
import { renderMermaidSVGAsync } from '../browser-lazy.ts'
import { parsePieChart } from '../pie/parser.ts'

const source = `pie showData
  "Alpha" : 10
  "Beta" : 20
  "Alpha" : 30
`

function upstreamSections(sourceText: string): Array<[string, number]> {
  const script = `
    import DOMPurify from 'dompurify'
    DOMPurify.addHook = () => {}
    DOMPurify.sanitize = text => text
    const { default: mermaid } = await import('mermaid')
    mermaid.initialize({ startOnLoad: false })
    const diagram = await mermaid.mermaidAPI.getDiagramFromText(${JSON.stringify(sourceText)})
    process.stdout.write(JSON.stringify([...diagram.db.getSections()]))
  `
  const probe = Bun.spawnSync({ cmd: [process.execPath, '-e', script], cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' })
  expect(probe.exitCode).toBe(0)
  return JSON.parse(new TextDecoder().decode(probe.stdout)) as Array<[string, number]>
}

function slicesInSvg(svg: string): Array<[string, number]> {
  return [...svg.matchAll(/data-label="([^"]+)" data-value="([^"]+)"/g)]
    .map(match => [decodeXML(match[1]!), Number(match[2])])
}

function drawnSlices(sourceText: string): Array<[string, number]> {
  return slicesInSvg(renderMermaidSVG(sourceText))
}

test('pinned Mermaid Pie DB keeps the first value of a duplicate label', () => {
  expect(upstreamSections(source)).toEqual([['Alpha', 10], ['Beta', 20]])
  const chart = parsePieChart(source.trim().split('\n'))
  expect(chart.entries).toEqual([{ label: 'Alpha', value: 10 }, { label: 'Beta', value: 20 }])
  expect(chart.hasDuplicateSourceLabels).toBe(true)
  expect(drawnSlices(source)).toEqual([['Alpha', 10], ['Beta', 20]])
})

test('duplicate source remains verbatim and diagnosed instead of mutating an ambiguous label', () => {
  const parsed = parseRegisteredMermaid(source)
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) return
  expect(parsed.value.body.kind).toBe('opaque')
  expect(serializeMermaid(parsed.value).trimEnd()).toBe(source.trimEnd())
  expect(verifyMermaid(parsed.value).warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax: 'pie_opaque' }))
})

test('Pie label identity is case-sensitive and preserves distinct literal br spellings', () => {
  const distinct = `pie\n  "A" : 1\n  "a" : 2\n  "A<br>B" : 3\n  "A<br/>B" : 4`
  expect(upstreamSections(distinct)).toEqual([['A', 1], ['a', 2], ['A<br>B', 3], ['A<br/>B', 4]])
  const chart = parsePieChart(distinct.split('\n'))
  expect(chart.entries.map(entry => entry.value)).toEqual([1, 2, 3, 4])
  expect(chart.hasDuplicateSourceLabels).toBeUndefined()
  expect(drawnSlices(distinct).map(entry => entry[1])).toEqual([1, 2, 3, 4])
  const parsed = parseRegisteredMermaid(distinct)
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) return
  expect(parsed.value.body.kind).toBe('pie')
  const changed = mutate(parsed.value, { kind: 'set_slice_value', label: 'A<br/>B', value: 5 })
  expect(changed.ok).toBe(true)
  if (changed.ok) expect(drawnSlices(serializeMermaid(changed.value))).toEqual([
    ['A', 1], ['a', 2], ['A<br>B', 3], ['A<br/>B', 5],
  ])
})

test('pinned Mermaid consumes escapes before arbitrary label characters for first-wins identity', () => {
  const duplicate = `pie showData\n  "A\\B" : 1\n  "AB" : 2`
  expect(upstreamSections(duplicate)).toEqual([['AB', 1]])
  expect(parsePieChart(duplicate.split('\n'))).toMatchObject({
    entries: [{ label: 'AB', value: 1 }], hasDuplicateSourceLabels: true,
  })
  expect(drawnSlices(duplicate)).toEqual([['AB', 1]])
  const parsed = parseRegisteredMermaid(duplicate)
  expect(parsed.ok).toBe(true)
  if (parsed.ok) expect(parsed.value.body.kind).toBe('opaque')

  const distinct = `pie\n  "A\\\\B" : 1\n  "A\\B" : 2`
  expect(upstreamSections(distinct)).toEqual([['A\\B', 1], ['AB', 2]])
  const chart = parsePieChart(distinct.split('\n'))
  expect(chart.entries).toEqual([{ label: 'A\\B', value: 1 }, { label: 'AB', value: 2 }])
  expect(chart.hasDuplicateSourceLabels).toBeUndefined()
})

test('pinned Mermaid converts escaped controls before Pie label identity while agent source stays lossless', () => {
  const escaped = `pie\n  "A\\nB" : 1\n`
  expect(upstreamSections(escaped)).toEqual([['A\nB', 1]])
  expect(parsePieChart(escaped.split('\n')).entries).toEqual([{ label: 'A\nB', value: 1 }])
  const parsed = parseRegisteredMermaid(escaped)
  expect(parsed.ok).toBe(true)
  if (parsed.ok) {
    expect(parsed.value.body.kind).toBe('opaque')
    expect(serializeMermaid(parsed.value)).toBe(escaped)
  }
})

test('entity spelling remains part of the upstream Pie key through public render and typed mutation', () => {
  const encoded = `pie showData\n  "A&amp;B" : 1\n  "A&B" : 2\n`
  const sections: Array<[string, number]> = [['A&amp;B', 1], ['A&B', 2]]
  expect(upstreamSections(encoded)).toEqual(sections)
  expect(parsePieChart(encoded.trim().split('\n')).entries).toEqual(sections.map(([label, value]) => ({ label, value })))
  expect(drawnSlices(encoded)).toEqual(sections)
  const parsed = parseRegisteredMermaid(encoded)
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) return
  expect(parsed.value.body.kind).toBe('pie')
  expect(parsePieChart(serializeMermaid(parsed.value).trim().split('\n')).entries)
    .toEqual(sections.map(([label, value]) => ({ label, value })))
  const changed = mutate(parsed.value, { kind: 'set_slice_value', label: 'A&B', value: 3 })
  expect(changed.ok).toBe(true)
  if (changed.ok) expect(drawnSlices(serializeMermaid(changed.value))).toEqual([['A&amp;B', 1], ['A&B', 3]])
})

test('browser-lazy Pie SVG keeps first-wins and entity-distinct identity', async () => {
  const encoded = 'pie showData\n  "A&amp;B" : 1\n  "A&B" : 2\n'
  const cases: Array<[string, Array<[string, number]>]> = [
    [encoded, [['A&amp;B', 1], ['A&B', 2]]],
    [source, [['Alpha', 10], ['Beta', 20]]],
  ]
  for (const [input, expected] of cases) {
    const lazy = await renderMermaidSVGAsync(input)
    expect(lazy).toBe(renderMermaidSVG(input))
    expect(slicesInSvg(lazy)).toEqual(expected)
  }
})

test('Pie terminal, width, HTML and metadata projections keep entity-distinct rows', () => {
  const encoded = `pie showData\n  "A&amp;B" : 1\n  "A&B" : 2\n`
  for (const options of [{ colorMode: 'none' as const },
    { colorMode: 'none' as const, useAscii: true },
    { colorMode: 'none' as const, targetWidth: 60 }]) {
    const rows = renderMermaidASCII(encoded, options).split('\n')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toStartWith('A&amp;B  ')
    expect(rows[1]).toStartWith('A&B  ')
    expect(rows[0]).toContain('33.3%  [1]')
    expect(rows[1]).toContain('66.7%  [2]')
  }
  const htmlRows = renderMermaidASCII(encoded, { colorMode: 'html' }).split('\n')
  expect(htmlRows[0]).toStartWith('A&amp;amp;B  ')
  expect(htmlRows[1]).toStartWith('A&amp;B  ')
  const meta = renderMermaidASCIIWithMeta(encoded, { colorMode: 'none' })
  expect(meta.regions.map(region => [region.id, region.projectedText, region.canvasRow]))
    .toEqual([['slice-0', 'A&amp;B', 0], ['slice-1', 'A&B', 1]])
  const htmlMeta = renderMermaidASCIIWithMeta(encoded, { colorMode: 'html' })
  expect(htmlMeta.ascii).toBe(htmlRows.join('\n'))
  expect(htmlMeta.regions.map(region => [region.id, region.projectedText, region.canvasRow]))
    .toEqual([['slice-0', 'A&amp;B', 0], ['slice-1', 'A&B', 1]])
  const configDiagnostics: string[] = []
  renderMermaidASCIIWithMeta(encoded, {
    colorMode: 'html', mermaidConfig: { pie: { unknownField: true } },
    onConfigDiagnostic: diagnostic => configDiagnostics.push(diagnostic.field),
  })
  expect(configDiagnostics).toEqual(['pie.unknownField'])
  const withActions = renderMermaidWithActions(encoded, { format: 'ascii', options: { colorMode: 'none' } })
  expect(typeof withActions.output).toBe('string')
  if (typeof withActions.output === 'string') expect(withActions.output.split('\n')).toHaveLength(2)
})

test('Pie grammar entities remain decoded while section-label entity spelling remains authored', () => {
  for (const encoded of ['pie&#32;showData\n  "A" : 1', 'pie\n  "A" &#58; 1', 'pie\n  "A" : &#49;']) {
    expect(drawnSlices(encoded)).toEqual([['A', 1]])
    expect(renderMermaidASCII(encoded, { colorMode: 'none' })).toContain('A  ')
  }
  for (const label of ['A&quot;B']) {
    const encoded = `pie\n  "${label}" : 1`
    expect(upstreamSections(encoded)).toEqual([[label, 1]])
    expect(drawnSlices(encoded)).toEqual([[label, 1]])
    expect(renderMermaidASCII(encoded, { colorMode: 'none' })).toStartWith(`${label}  `)
  }
})

test('numeric entity spelling collides with Mermaid’s pre-parser marker in first-wins identity', () => {
  const source = 'pie\n  "A&#35;B" : 1\n  "A&ﬂ°°35¶ßB" : 2\n'
  expect(upstreamSections(source)).toEqual([['A&ﬂ°°35¶ßB', 1]])
  expect(parsePieChart(source.trim().split('\n'))).toMatchObject({
    entries: [{ label: 'A&#35;B', value: 1 }], hasDuplicateSourceLabels: true,
  })
  expect(drawnSlices(source)).toEqual([['A&#35;B', 1]])
  const parsed = parseRegisteredMermaid(source)
  expect(parsed.ok).toBe(true)
  if (parsed.ok) {
    expect(parsed.value.body.kind).toBe('opaque')
    expect(serializeMermaid(parsed.value)).toBe(source)
  }
  const escaped = 'pie\n  "A#\\35;B" : 1\n  "Aﬂ°°35¶ßB" : 2\n'
  expect(upstreamSections(escaped)).toEqual([['A#35;B', 1], ['Aﬂ°°35¶ßB', 2]])
  expect(parsePieChart(escaped.trim().split('\n')).entries).toEqual([
    { label: 'A#35;B', value: 1 }, { label: 'Aﬂ°°35¶ßB', displayLabel: 'A#B', value: 2 },
  ])
  expect(drawnSlices(escaped)).toEqual([['A#35;B', 1], ['Aﬂ°°35¶ßB', 2]])
  expect(renderMermaidASCII(escaped, { colorMode: 'none' })).toContain('A#B  ')
  expect(renderMermaidASCIIWithMeta(escaped, { colorMode: 'none' }).regions.map(region => region.projectedText))
    .toEqual(['A#35;B', 'A#B'])
  const prepass = 'pie\n  "styleX:#35;" : 1\n  "styleX:#35" : 2\n'
  expect(upstreamSections(prepass)).toEqual([['styleX:#35', 1]])
  expect(parsePieChart(prepass.trim().split('\n'))).toMatchObject({ hasDuplicateSourceLabels: true })
  expect(drawnSlices(prepass)).toHaveLength(1)
  const separated = 'pie\n  "style:x#;\u2028classDef:x#;" : 1\n  "style:x#\u2028classDef:x#" : 2\n'
  expect(upstreamSections(separated)).toEqual([['style:x#\u2028classDef:x#', 1]])
  expect(parsePieChart(separated.trim().split('\n'))).toMatchObject({
    entries: [{ label: 'style:x#;\u2028classDef:x#;', value: 1 }],
    hasDuplicateSourceLabels: true,
  })
})

test('Pie entity prepass stays bounded on repeated style/hash candidates', () => {
  for (const label of ['style:foo#'.repeat(1500), `style:foo#;${'style:foo#'.repeat(1500)}`]) {
    const started = performance.now()
    expect(parsePieChart(['pie', `"${label}" : 1`]).entries).toHaveLength(1)
    expect(performance.now() - started).toBeLessThan(250)
  }
})

test('XML-disallowed escaped controls receive a Pie-level diagnosis before Scene validation', () => {
  for (const control of ['0', 'b', 'f', 'v']) {
    const input = `pie\n  "A\\${control}B" : 1\n`
    expect(upstreamSections(input)).toHaveLength(1)
    expect(() => parsePieChart(input.trim().split('\n'))).toThrow(/Pie slice label contains an XML-disallowed control character/)
    expect(() => renderMermaidSVG(input)).toThrow(/Pie slice label contains an XML-disallowed control character/)
    const parsed = parseRegisteredMermaid(input)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) continue
    expect(parsed.value.body.kind).toBe('opaque')
    expect(serializeMermaid(parsed.value)).toBe(input)
    expect(verifyMermaid(parsed.value).warnings).toContainEqual(expect.objectContaining({ code: 'RENDER_FAILED' }))
  }
})

test('invalid duplicate values still fail before first-wins suppression', () => {
  expect(() => parsePieChart(['pie', '"A" : 1', '"A" : -1'])).toThrow(/invalid value/)
})

test('reviewer-facing before and after SVGs show the authentic slice change', () => {
  const asset = (which: 'before' | 'after') => readFileSync(
    join(import.meta.dir, `../../docs/pr-assets/issue-248-pie-duplicate-label-${which}.svg`), 'utf8')
  expect(slicesInSvg(asset('before'))).toEqual([['Alpha', 10], ['Beta', 20], ['Alpha', 30]])
  expect(asset('after')).toBe(renderMermaidSVG(source))
  expect(slicesInSvg(asset('after'))).toEqual([['Alpha', 10], ['Beta', 20]])
})
