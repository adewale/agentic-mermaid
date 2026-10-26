import { describe, expect, test } from 'bun:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { qualifyOutput, withReferenceLabels } from '../unified/qualification.ts'
import type { UnifiedWorkload } from '../unified/types.ts'

const workload = (labels: string[]): UnifiedWorkload => ({ id: 'authored-output-admission', family: 'flowchart', source: 'flowchart LR', features: [], provenance: 'independently authored qualification examples', expectedLabels: labels })
const svgDocument = (body: string, canvas = 'viewBox="0 0 100 100"') => `<svg xmlns="http://www.w3.org/2000/svg" ${canvas}>${body}</svg>`
describe('benchmark output admission at reader-facing text', () => {
  test('admits literal authored labels inside decorated visible text runs', () => {
    const svg = svgDocument('<text>Free (60.0%)</text><text>alt [isWell]</text><text>Uses [HTTPS]</text><text>C1</text>')
    expect(qualifyOutput(workload(['Free', 'isWell', 'HTTPS', 'C1']), svg, 'svg').ok).toBe(true)
  })
  test('does not infer an authored identity from a longer identifier', () => {
    expect(qualifyOutput(workload(['C1']), svgDocument('<text>C10</text>'), 'svg').ok).toBe(false)
    expect(qualifyOutput(workload(['Node 1']), 'Node 12', 'terminal').ok).toBe(false)
  })
  test('metadata, source echoes and attributes do not substitute for visible labels', () => {
    const svg = svgDocument('<metadata><text>Cache</text></metadata><!-- <text>Cache</text> --><defs><text>Cache</text></defs><text>Database</text>', 'viewBox="0 0 100 100" data-label="Cache"')
    expect(qualifyOutput(workload(['Cache']), svg, 'svg').ok).toBe(false)
  })
  test('keeps interleaved values and separate text runs outside generic matching', () => {
    expect(qualifyOutput(workload(['ash (60.0%)']), svgDocument('<text>ash [60] (60.0%)</text>'), 'svg').ok).toBe(false)
    expect(qualifyOutput(workload(['First Second']), svgDocument('<text>First</text><text>Second</text>'), 'svg').ok).toBe(false)
    expect(qualifyOutput(workload(['First Second']), '│ First │\n│ Second │', 'terminal').ok).toBe(false)
  })
  test('reads escaped literal angle brackets and positioned line breaks', () => {
    const svg = svgDocument('<text>&lt;Customer&gt;</text><text><tspan x="0" y="10">First</tspan><tspan x="0" y="20">Second</tspan></text>')
    expect(qualifyOutput(workload(['<Customer>', 'First Second']), svg, 'svg').ok).toBe(true)
  })
  test('accepts a declared empty SVG envelope but never supplies a missing label', () => {
    expect(qualifyOutput(workload([]), '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>', 'svg').ok).toBe(true)
    expect(qualifyOutput(workload(['A']), '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>', 'svg').ok).toBe(false)
    expect(qualifyOutput(workload([]), '<s:svg xmlns:s="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>', 'svg').ok).toBe(true)
  })
  test('rejects malformed XML, unescaped CSS URLs and foreign or absent SVG namespaces', () => {
    expect(qualifyOutput(workload(['A']), svgDocument('<style>@import url("https://example.test/font?a=1&b=2");</style><text>A</text>'), 'svg').ok).toBe(false)
    expect(qualifyOutput(workload(['A']), svgDocument('<text>A'), 'svg').ok).toBe(false)
    expect(qualifyOutput(workload(['A']), svgDocument('<text>&unknown;</text>'), 'svg').ok).toBe(false)
    expect(qualifyOutput(workload(['A']), '<svg viewBox="0 0 10 10"><text>A</text></svg>', 'svg').ok).toBe(false)
    expect(qualifyOutput(workload(['A']), '<svg xmlns="http://www.w3.org/1999/xhtml" viewBox="0 0 10 10"><text>A</text></svg>', 'svg').ok).toBe(false)
    expect(qualifyOutput(workload(['A']), svgDocument('<style>@import url("https://example.test/font?a=1&amp;b=2");</style><text>A</text>'), 'svg').ok).toBe(true)
  })
  test('requires a positive finite viewBox or explicit dimensions', () => {
    for (const canvas of ['', 'viewBox="0 0 0 10"', 'viewBox="0 0 Infinity 10"', 'width="100%" height="100%"', 'width="10junk" height="10"']) expect(qualifyOutput(workload(['A']), svgDocument('<text>A</text>', canvas), 'svg').ok).toBe(false)
    expect(qualifyOutput(workload(['A']), svgDocument('<text>A</text>', 'width="10px" height="20"'), 'svg').ok).toBe(true)
    expect(qualifyOutput(workload(['A']), svgDocument('<text>A</text>', 'viewBox="-10 -10 20 20" width="100%" height="100%"'), 'svg').ok).toBe(true)
  })
})

test('source code fallbacks never qualify as rendered SVG or terminal diagrams', () => {
  const source = 'flowchart LR\nA[Start] --> B[End]'
  const w = { ...workload(['Start', 'End']), source }
  expect(qualifyOutput(w, '┌────────────────────────────┐\n│ flowchart LR               │\n│ A[Start] --> B[End]         │\n└────────────────────────────┘', 'terminal').ok).toBe(false)
  expect(qualifyOutput(w, svgDocument('<text>flowchart LR</text><text>A[Start] --&gt; B[End]</text>'), 'svg').ok).toBe(false)
  expect(qualifyOutput(w, svgDocument('<metadata>flowchart LR A[Start] --&gt; B[End]</metadata><text>Start</text><text>End</text>'), 'svg').ok).toBe(true)
  expect(qualifyOutput(w, source, 'source').ok).toBe(true)
})

test('community labels refuse to load without the pinned Mermaid source, instead of passing cases unchecked', async () => {
  const workload = { id: 'labelled', family: 'flowchart', source: 'flowchart LR\nA[Alpha]', features: [], provenance: 'authored refusal fixture' }
  await expect(withReferenceLabels([workload], { root: process.cwd(), upstreamDir: join(tmpdir(), 'no-mermaid-source-checkout') })).rejects.toThrow('Reference labels need the pinned Mermaid source checkout')
})
