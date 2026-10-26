import { afterAll, beforeAll, expect, test } from 'bun:test'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { inspectFidelityPaint, type PaintEvidence, type PaintInput } from '../fidelity/paint.ts'
import type { MeaningExpectation } from '../fidelity/meaning.ts'

let browser: any
beforeAll(async () => {
  const require = createRequire(join(process.cwd(), 'eval/benchmark/package.json'))
  browser = await require('playwright').chromium.launch({ headless: true, executablePath: process.env.AM_CHROMIUM_EXECUTABLE ?? '/usr/bin/chromium' })
})
afterAll(async () => { await browser?.close() })
const expected = { labels: ['Alpha', 'Beta'], nodes: [{ id: 'A', label: 'Alpha' }, { id: 'B', label: 'Beta' }], edges: [{ source: 'A', target: 'B', directed: true }] }
const fixture = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="80" viewBox="0 0 240 80"><defs><marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6 Z"/></marker></defs><g class="node"><rect x="10" y="10" width="60" height="30" fill="white" stroke="black"/><text x="14" y="30">Alpha</text></g><g class="node"><rect x="150" y="10" width="60" height="30" fill="white" stroke="black"/><text x="154" y="30">Beta</text></g><g class="edge"><path d="M70 25 L150 25" fill="none" stroke="black" marker-end="url(#arrow)"/></g></svg>`
async function inspect(svg: string, expectation: MeaningExpectation = expected, options: Pick<PaintInput, 'paint'> & { family?: string } = {}): Promise<PaintEvidence> {
  const page = await browser.newPage()
  try { await page.setContent(svg); return await page.evaluate(inspectFidelityPaint, { family: options.family ?? 'flowchart', expected: expectation, paint: options.paint }) as PaintEvidence }
  finally { await page.close() }
}

test('actual painted endpoints and multiplicity are independent of correct labels and model expectations', async () => {
  expect((await inspect(fixture)).passed).toBe(true)
  const reversed = await inspect(fixture.replace('M70 25 L150 25', 'M150 25 L70 25'))
  expect(reversed.checks.find(item => item.criterion === 'visible-authored-labels')?.status).toBe('passed')
  expect(reversed.checks.find(item => item.criterion === 'painted-relationships')?.status).toBe('failed')
  const duplicate = await inspect(fixture.replace('</svg>', '<g class="edge"><path d="M70 25 L150 25" fill="none" stroke="black" marker-end="url(#arrow)"/></g></svg>'))
  expect(duplicate.checks.find(item => item.criterion === 'painted-relationships')?.status).toBe('failed')
  const hidden = await inspect(fixture.replace('stroke="black" marker-end', 'stroke="none" marker-end'))
  expect(hidden.checks.find(item => item.criterion === 'painted-relationships')?.status).toBe('failed')
  for (const hiddenPaint of ['stroke="black" stroke-opacity="0"', 'stroke="transparent"']) {
    const invisible = await inspect(fixture.replace('stroke="black" marker-end', hiddenPaint + ' marker-end'))
    expect(invisible.checks.find(item => item.criterion === 'painted-relationships')?.status).toBe('failed')
  }
  const detached = await inspect(fixture.replace('M70 25 L150 25', 'M87 25 L133 25'))
  expect(detached.checks.find(item => item.criterion === 'painted-relationships')?.status).toBe('failed')
  const invented = await inspect(fixture, { ...expected, edges: [] })
  expect(invented.checks.find(item => item.criterion === 'painted-relationships')?.status).toBe('failed')
})

test('browser paint rejects hidden and clipped authored labels, not just missing SVG text', async () => {
  const hidden = await inspect(fixture.replace('x="154" y="30"', 'x="154" y="30" opacity="0"'))
  expect(hidden.checks.find(item => item.criterion === 'visible-authored-labels')?.status).toBe('failed')
  const clipped = await inspect(fixture.replace('viewBox="0 0 240 80"', 'viewBox="0 0 100 80"'))
  expect(clipped.checks.find(item => item.criterion === 'labels-within-canvas')?.status).toBe('failed')
  const selfClipped = await inspect(fixture.replace('</defs>', '<clipPath id="tiny"><rect x="0" y="0" width="1" height="1"/></clipPath></defs>').replace('x="154" y="30"', 'x="154" y="30" clip-path="url(#tiny)"'))
  const html = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="80"><rect x="1" y="1" width="220" height="70" fill="white"/><foreignObject x="10" y="10" width="200" height="50"><div xmlns="http://www.w3.org/1999/xhtml" style="width:150px;white-space:nowrap;overflow-x:hidden;overflow-y:visible">A long authored label</div></foreignObject></svg>'
  expect((await inspect(html, { labels: ['A long authored label'] })).passed).toBe(true)
  const htmlClipped = await inspect(html.replace('width:150px', 'width:20px'), { labels: ['A long authored label'] })
  expect(htmlClipped.checks.find(item => item.criterion === 'unclipped-authored-labels')?.status).toBe('failed')
  expect(selfClipped.checks.find(item => item.criterion === 'unclipped-authored-labels')?.status).toBe('failed')
  const wrapped = fixture.replaceAll('width="60" height="30"', 'width="60" height="50"').replace('>Alpha</text>', '><tspan>Alpha</tspan><tspan x="14" dy="15">Beta</tspan></text>')
  const multiline = await inspect(wrapped, { ...expected, labels: ['Alpha Beta', 'Beta'], nodes: [{ id: 'A', label: 'Alpha Beta' }, { id: 'B', label: 'Beta' }] })
  expect(multiline.passed).toBe(true)
})

test('failed image decoding earns no paint credit and unsupported ownership remains unavailable', async () => {
  const broken = 'data:image/png;base64,invalid'
  const badImage = await inspect(fixture.replace('</svg>', `<image href="${broken}" width="20" height="20"/></svg>`), expected, { paint: { images: [{ href: broken, count: 1 }] } })
  expect(badImage.checks.find(item => item.criterion === 'embedded-images')?.status).toBe('failed')
  const red = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=='
  const retained = fixture.replace('</svg>', `<image href="${red}" x="100" y="50" width="20" height="20"/></svg>`)
  expect((await inspect(retained, expected, { paint: { images: [{ href: red, count: 1 }] } })).passed).toBe(true)
  const omitted = await inspect(fixture, expected, { paint: { images: [{ href: red, count: 1 }] } })
  expect(omitted.checks.find(item => item.criterion === 'embedded-images')?.status).toBe('failed')
  const hiddenImage = await inspect(retained.replace('x="100" y="50" width="20"', 'x="100" y="50" opacity="0" width="20"'), expected, { paint: { images: [{ href: red, count: 1 }] } })
  expect(hiddenImage.checks.find(item => item.criterion === 'embedded-images')?.status).toBe('failed')
  const ambiguous = await inspect(fixture.replace('</svg>', '<g><rect x="10" y="50" width="60" height="25"/><text x="14" y="68">Alpha</text></g></svg>'))
  expect(ambiguous.checks.find(item => item.criterion === 'painted-node-ownership')?.status).toBe('unavailable')
  expect(ambiguous.passed).toBe(false)
  const mask = await inspect(fixture.replace('x="154" y="30"', 'x="154" y="30" style="mask-image:linear-gradient(black,transparent)"'))
  expect(mask.checks.find(item => item.criterion === 'unclipped-authored-labels')?.status).toBe('unavailable')
})

test('every relationship label belongs to its actual owned route, even when all endpoints and text counts are correct', async () => {
  const shape = (x: number, label: string) => `<g><rect x="${x}" y="50" width="60" height="40" fill="white" stroke="black"/><text x="${x + 5}" y="75">${label}</text></g>`
  const defs = fixture.slice(fixture.indexOf('<defs>'), fixture.indexOf('</defs>') + 7)
  const drawing = `<svg xmlns="http://www.w3.org/2000/svg" width="330" height="130">${defs}${shape(10, 'Alpha')}${shape(130, 'Beta')}${shape(250, 'Gamma')}<g class="edge"><path d="M70 70 L130 70" fill="none" stroke="black" marker-end="url(#arrow)"/></g><g class="edge"><path d="M190 70 L250 70" fill="none" stroke="black" marker-end="url(#arrow)"/></g><text x="80" y="65">send</text><text x="200" y="65">reply</text></svg>`
  const authored = { labels: ['Alpha', 'Beta', 'Gamma', 'send', 'reply'], nodes: [{ id: 'A', label: 'Alpha' }, { id: 'B', label: 'Beta' }, { id: 'C', label: 'Gamma' }], edges: [{ source: 'A', target: 'B', directed: true, label: 'send' }, { source: 'B', target: 'C', directed: true, label: 'reply' }] }
  const valid = await inspect(drawing, authored)
  expect(valid.passed).toBe(true)
  const swapped = await inspect(drawing.replace('>send</text>', '>temporary</text>').replace('>reply</text>', '>send</text>').replace('>temporary</text>', '>reply</text>'), authored)
  expect(swapped.checks.find(item => item.criterion === 'painted-relationships')?.status).toBe('passed')
  expect(swapped.checks.find(item => item.criterion === 'painted-relationship-label-counts')?.status).toBe('passed')
  expect(swapped.checks.find(item => item.criterion === 'painted-relationship-label-ownership')?.status).toBe('failed')
})

test('marker ownership distinguishes inheritance, composition and inline arrowheads without classifying decorations as directed arrows', async () => {
  const base = fixture.replace('orient="auto"', 'orient="auto-start-reverse"').replace('fill="none" stroke="black" marker-end', 'fill="none" stroke="black" marker-start')
  const inheritance = base.replace('M0 0 L6 3 L0 6 Z', 'M0 0 L6 3 L0 6 Z" fill="white" stroke="black')
  expect((await inspect(inheritance, { ...expected, edges: [{ source: 'A', target: 'B', directed: true, startMarker: 'triangle', endMarker: 'none' }] }, { family: 'class' })).passed).toBe(true)
  const composition = base.replace('M0 0 L6 3 L0 6 Z', 'M0 3 L3 0 L6 3 L3 6 Z')
  expect((await inspect(composition, { ...expected, edges: [{ source: 'A', target: 'B', directed: false, startMarker: 'diamond', endMarker: 'none' }] }, { family: 'class' })).passed).toBe(true)
  const actualInline = fixture.replace('class="edge"', 'class="pele-edge"').replace('<path d="M70 25 L150 25" fill="none" stroke="black" marker-end="url(#arrow)"/>', '<path d="M70 25 L142 25" fill="none" stroke="black"/><path class="pele-marker" d="M150 25 L142 21 L142 29 Z" fill="black" stroke="none"/>')
  expect((await inspect(actualInline)).passed).toBe(true)
  const wrong = await inspect(actualInline.replace('M150 25 L142 21 L142 29 Z', 'M142 25 L150 21 L150 29 Z'))
  expect(wrong.checks.find(item => item.criterion === 'painted-relationships')?.status).toBe('failed')
})

test('requested font size is checked on every authored text run rather than one convenient element', async () => {
  const configured = fixture.replace('viewBox="0 0 240 80"', 'viewBox="0 0 240 80" style="font-size:14px"')
  expect((await inspect(configured, expected, { paint: { fontSize: 14 } })).passed).toBe(true)
  const wrong = await inspect(configured.replace('x="154" y="30"', 'x="154" y="30" font-size="24"'), expected, { paint: { fontSize: 14 } })
  expect(wrong.checks.find(item => item.criterion === 'computed-authored-font-size')?.status).toBe('failed')
})

test('barbed four-vertex arrows are concave directional heads rather than convex cardinality diamonds', async () => {
  const barb = fixture.replace('M0 0 L6 3 L0 6 Z', 'M6 3 L0 6 L2 3 L0 0 Z')
  expect((await inspect(barb, expected, { family: 'state' })).checks.find(item => item.criterion === 'painted-relationships')?.status).toBe('passed')
  expect((await inspect(barb.replace('M6 3 L0 6 L2 3 L0 0 Z', 'M0 3 L6 6 L4 3 L6 0 Z'), expected, { family: 'state' })).checks.find(item => item.criterion === 'painted-relationships')?.status).toBe('failed')
})

test('actual sequence messages exclude painted actor lifelines and nested outlines retain node ownership', async () => {
  const sequence = fixture.replace('height="80" viewBox="0 0 240 80"', 'height="100" viewBox="0 0 240 100"').replace('<g class="edge"><path d="M70 25 L150 25" fill="none" stroke="black" marker-end="url(#arrow)"/></g>', '<line class="lifeline" x1="40" y1="40" x2="40" y2="95" stroke="black"/><line class="lifeline" x1="180" y1="40" x2="180" y2="95" stroke="black"/><g class="message"><line x1="40" y1="60" x2="180" y2="60" stroke="black" marker-end="url(#arrow)"/></g>')
  expect((await inspect(sequence, expected, { family: 'sequence' })).checks.find(item => item.criterion === 'painted-relationships')?.status).toBe('passed')
  const nested = fixture.replace(/(<rect\b[^>]*\/>)/g, '<g class="outer-path">$1</g>')
  expect((await inspect(nested, expected, { family: 'class' })).checks.find(item => item.criterion === 'painted-node-ownership')?.status).toBe('passed')
})

test('rich foreignObject leaves remain actual authored text and logical tree groups do not imply enclosure', async () => {
  const rich = fixture.replace('<text x="14" y="30">Alpha</text>', '<foreignObject x="14" y="14" width="52" height="22"><div xmlns="http://www.w3.org/1999/xhtml"><span><b>Alpha</b></span></div></foreignObject>')
  expect((await inspect(rich, expected, { family: 'eventmodeling' })).checks.find(item => item.criterion === 'visible-authored-labels')?.status).toBe('passed')
  const hierarchy = await inspect(fixture, { ...expected, groups: [{ id: 'A', label: 'Alpha', members: ['B'] }] }, { family: 'mindmap' })
  expect(hierarchy.checks.find(item => item.criterion === 'painted-group:A')?.status).toBe('unavailable')
})

test('C4 person relationships can attach to the actual compound head rather than an unrelated body rectangle', async () => {
  const compound = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="110"><defs><marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6 Z"/></marker></defs><g class="node c4-person"><g class="basic label-container"><rect x="10" y="50" width="60" height="30"/><circle cx="40" cy="35" r="20"/></g><text x="14" y="70" fill="white">Alpha</text></g><g class="node"><rect x="150" y="10" width="60" height="30"/><text x="154" y="30" fill="white">Beta</text></g><g class="edge"><path d="M60 35 L150 25" fill="none" stroke="black" marker-end="url(#arrow)"/></g></svg>'
  expect((await inspect(compound, expected, { family: 'c4' })).checks.find(item => item.criterion === 'painted-relationships')?.status).toBe('passed')
  expect((await inspect(compound.replace('<circle cx="40" cy="35" r="20"/>', ''), expected, { family: 'c4' })).checks.find(item => item.criterion === 'painted-relationships')?.status).toBe('failed')
})
