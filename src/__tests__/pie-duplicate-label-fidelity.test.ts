import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseRegisteredMermaid, serializeMermaid, verifyMermaid } from '../agent/index.ts'
import { renderMermaidSVG } from '../index.ts'
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
    .map(match => [match[1]!, Number(match[2])])
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

test('Pie label identity is case-sensitive and uses authored spelling before display normalization', () => {
  const distinct = `pie\n  "A" : 1\n  "a" : 2\n  "A<br>B" : 3\n  "A<br/>B" : 4`
  expect(upstreamSections(distinct)).toEqual([['A', 1], ['a', 2], ['A<br>B', 3], ['A<br/>B', 4]])
  const chart = parsePieChart(distinct.split('\n'))
  expect(chart.entries.map(entry => entry.value)).toEqual([1, 2, 3, 4])
  expect(chart.hasDuplicateSourceLabels).toBeUndefined()
  expect(drawnSlices(distinct).map(entry => entry[1])).toEqual([1, 2, 3, 4])
  const parsed = parseRegisteredMermaid(distinct)
  expect(parsed.ok).toBe(true)
  if (parsed.ok) expect(parsed.value.body.kind).toBe('opaque') // normalized labels collide for typed label-based mutation
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
