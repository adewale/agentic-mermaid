import { expect, test } from 'bun:test'
import { qualifyOutput } from '../unified/qualification.ts'

const source = 'flowchart TD\nA[Start] --> B[End]'
const workload = (labels: string[], authoredSource = source) => ({
  id: 'authored-svg-text-admission',
  family: 'flowchart',
  source: authoredSource,
  features: [],
  provenance: 'independently authored SVG qualification counterexamples',
  expectedLabels: labels,
})
const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">${body}</svg>`

test('inert metadata and unused definitions do not satisfy authored labels', () => {
  for (const container of ['metadata', 'defs', 'title', 'desc']) {
    const result = qualifyOutput(workload(['Start', 'End']), svg(`<${container}><text>Start</text><text>End</text></${container}><path d="M0 0L100 0"/>`), 'svg')
    expect(result.ok).toBe(false)
    expect(result.findings).toContain('Missing authored label: Start')
    expect(result.findings).toContain('Missing authored label: End')
  }
})

test('actual SVG namespaces admit prefixed text and reject foreign lookalikes', () => {
  const qualified = '<s:svg xmlns:s="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><s:text>Start</s:text><s:text>End</s:text></s:svg>'
  expect(qualifyOutput(workload(['Start', 'End']), qualified, 'svg').ok).toBe(true)
  const fake = svg('<n:text xmlns:n="urn:not-svg">Start</n:text><n:text xmlns:n="urn:not-svg">End</n:text>')
  expect(qualifyOutput(workload(['Start', 'End']), fake, 'svg').ok).toBe(false)
})

test('decorations retain whole authored tokens without admitting prefix collisions', () => {
  expect(qualifyOutput(workload(['Free'], 'flowchart TD\nA[Free]'), svg('<text>Free(60)</text>'), 'svg').ok).toBe(true)
  expect(qualifyOutput(workload(['label'], 'flowchart TD\nA[label]'), svg('<text>alt[label]</text>'), 'svg').ok).toBe(true)
  expect(qualifyOutput(workload(['Uses'], 'flowchart TD\nA[Uses]'), svg('<text>Uses[HTTPS]</text>'), 'svg').ok).toBe(true)
  expect(qualifyOutput(workload(['C1'], 'flowchart TD\nA[C1]'), svg('<text>C10</text>'), 'svg').ok).toBe(false)
})

test('line-positioned tspans preserve words without joining unrelated text elements', () => {
  const labelWorkload = workload(['Read Write'], 'flowchart TD\nA[Read Write]')
  expect(qualifyOutput(labelWorkload, svg('<text><tspan x="0" y="0">Read</tspan><tspan x="0" dy="12">Write</tspan></text>'), 'svg').ok).toBe(true)
  expect(qualifyOutput(labelWorkload, svg('<text>Read</text><text>Write</text>'), 'svg').ok).toBe(false)
})

test('namespace support never admits a prefixed source-echo fallback', () => {
  const echoed = '<s:svg xmlns:s="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><s:text>flowchart TD\nA[Start] --&gt; B[End]</s:text></s:svg>'
  const result = qualifyOutput(workload(['Start', 'End']), echoed, 'svg')
  expect(result.ok).toBe(false)
  expect(result.findings.some(finding => /source/i.test(finding))).toBe(true)
})

test('reads XHTML foreign-object lines and literal CDATA without another entity decoding pass', () => {
  const customer = workload(['Customer Balance'], 'flowchart TD\nA[Customer Balance]')
  expect(qualifyOutput(customer, svg('<foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><span>Customer</span><br/><span>Balance</span></div></foreignObject>'), 'svg').ok).toBe(true)
  expect(qualifyOutput(workload(['<literal>'], 'flowchart TD\nA["<literal>"]'), svg('<text><![CDATA[<literal>]]></text>'), 'svg').ok).toBe(true)
  const encoded = svg('<text>&amp;lt;literal&amp;gt;</text>')
  expect(qualifyOutput(workload(['&lt;literal&gt;'], 'flowchart TD\nA["&lt;literal&gt;"]'), encoded, 'svg').ok).toBe(true)
  expect(qualifyOutput(workload(['<literal>'], 'flowchart TD\nA["<literal>"]'), encoded, 'svg').ok).toBe(false)
})
