import { afterAll, beforeAll, expect, test } from 'bun:test'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { inspectQuantitativePaint } from '../fidelity/paint-values.ts'
import type { MeaningExpectation } from '../fidelity/meaning.ts'
import type { PaintCheck } from '../fidelity/paint.ts'

let browser: any
beforeAll(async () => { const require = createRequire(join(process.cwd(), 'eval/benchmark/package.json')); browser = await require('playwright').chromium.launch({ headless: true, executablePath: process.env.AM_CHROMIUM_EXECUTABLE ?? '/usr/bin/chromium' }) })
afterAll(async () => { await browser?.close() })
async function inspect(svg: string, family: string, expected: MeaningExpectation): Promise<PaintCheck[]> {
  const page = await browser.newPage()
  try { await page.setContent(svg); return await page.evaluate(inspectQuantitativePaint, { family, expected }) }
  finally { await page.close() }
}

test('pie weights bind actual wedge areas to authored legend labels instead of trusting correct native numbers', async () => {
  const fixture = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120"><path d="M50 50 L50 10 A40 40 0 0 1 90 50 Z" fill="red"/><path d="M50 50 L90 50 A40 40 0 1 1 50 10 Z" fill="blue"/><rect x="120" y="20" width="12" height="12" fill="red"/><text x="140" y="31">Alpha</text><rect x="120" y="45" width="12" height="12" fill="blue"/><text x="140" y="56">Beta</text></svg>'
  const expected = { labels: ['Alpha', 'Beta'], facts: { slices: [{ label: 'Alpha', value: 1 }, { label: 'Beta', value: 3 }] } }
  expect((await inspect(fixture, 'pie', expected))[0]?.status).toBe('passed')
  const swapped = fixture.replace('>Alpha<', '>Swap<').replace('>Beta<', '>Alpha<').replace('>Swap<', '>Beta<')
  expect((await inspect(swapped, 'pie', expected))[0]?.status).toBe('failed')
  expect((await inspect(fixture.replace('>Alpha<', '>Alpha (25.0%)<').replace('>Beta<', '>Beta (75.0%)<'), 'pie', expected))[0]?.status).toBe('passed')
  expect((await inspect(fixture.replace('>Alpha<', '>Alpha (75.0%)<').replace('>Beta<', '>Beta (25.0%)<'), 'pie', expected))[0]?.status).toBe('failed')
  // Pinned Mermaid pieRenderer.ts public showData legend: `${label} [${value}]`.
  expect((await inspect(fixture.replace('>Alpha<', '>Alpha [1]<').replace('>Beta<', '>Beta [3]<'), 'pie', expected))[0]?.status).toBe('passed')
  expect((await inspect(fixture.replace('>Alpha<', '>Alpha [3]<').replace('>Beta<', '>Beta [1]<'), 'pie', expected))[0]?.status).toBe('failed')
  expect((await inspect(fixture.replace('<svg ', '<svg opacity="0" '), 'pie', expected))[0]?.status).not.toBe('passed')
  expect((await inspect(fixture.replace('<path ', '<path style="clip-path:inset(99%)" '), 'pie', expected))[0]?.status).toBe('unavailable')
})

test('bar positions must encode independently authored values even when every expected label and bar remains', async () => {
  const fixture = '<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220"><text x="10" y="180">0</text><text x="10" y="20">10</text><text x="80" y="200">One</text><text x="140" y="200">Two</text><rect x="70" y="132" width="20" height="48"/><rect x="130" y="68" width="20" height="112"/></svg>'
  const expected = { labels: ['One', 'Two'], facts: { 'x-categories': ['One', 'Two'], 'y-range': [0, 10], series: [{ kind: 'bar', values: [3, 7] }] } }
  expect((await inspect(fixture, 'xychart', expected))[0]?.status).toBe('passed')
  expect((await inspect(fixture.replace('y="68"', 'y="132"').replace('height="112"', 'height="48"'), 'xychart', expected))[0]?.status).toBe('failed')
  expect((await inspect(fixture.replace('height="112"', 'height="12"'), 'xychart', expected))[0]?.status).toBe('failed')
})

test('packet fields preserve actual owned width and bit order, not just field names', async () => {
  const fixture = '<svg xmlns="http://www.w3.org/2000/svg" width="220" height="70"><g><rect x="5" y="10" width="60" height="30" fill="white" stroke="black"/><text x="10" y="30" font-size="10">Header</text></g><g><rect x="70" y="10" width="100" height="30" fill="white" stroke="black"/><text x="80" y="30" font-size="10">Payload</text></g></svg>'
  const expected = { labels: ['Header', 'Payload'], facts: { fields: [{ label: 'Header', start: 0, end: 2 }, { label: 'Payload', start: 3, end: 7 }] } }
  expect((await inspect(fixture, 'packet', expected))[0]?.status).toBe('passed')
  const swapped = fixture.replace('>Header<', '>Swap<').replace('>Payload<', '>Header<').replace('>Swap<', '>Payload<')
  expect((await inspect(swapped, 'packet', expected))[0]?.status).toBe('failed')
})

test('quadrant coordinates come from uniquely owned dots in four distinct actual regions', async () => {
  const fixture = '<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220"><rect x="0" y="0" width="100" height="100" fill="pink"/><rect x="100" y="0" width="100" height="100" fill="cyan"/><rect x="0" y="100" width="100" height="100" fill="yellow"/><rect x="100" y="100" width="100" height="100" fill="green"/><circle cx="40" cy="40" r="3"/><text x="48" y="44">Alpha</text></svg>'
  const expected = { labels: ['Alpha'], facts: { points: [{ label: 'Alpha', x: .2, y: .8 }] } }
  expect((await inspect(fixture, 'quadrant', expected))[0]?.status).toBe('passed')
  expect((await inspect(fixture.replace('cx="40"', 'cx="50"'), 'quadrant', expected))[0]?.status).toBe('failed')
  expect((await inspect(fixture.replace('x="100"', 'x="0"'), 'quadrant', expected))[0]?.status).not.toBe('passed')
})

test('treemap sibling areas and gantt durations reject wrong geometry even with retained labels', async () => {
  const fixture = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="100"><g><rect x="5" y="5" width="140" height="40" fill="pink"/><text x="10" y="25">Alpha</text></g><g><rect x="150" y="5" width="60" height="40" fill="cyan"/><text x="155" y="25">Beta</text></g></svg>'
  const expected = { labels: ['Alpha', 'Beta'], nodes: [{ id: 'Root/Alpha', label: 'Alpha' }, { id: 'Root/Beta', label: 'Beta' }], facts: { values: [{ id: 'Root/Alpha', value: 7 }, { id: 'Root/Beta', value: 3 }] } }
  expect((await inspect(fixture, 'treemap', expected))[0]?.status).toBe('passed')
  expect((await inspect(fixture.replace('width="140"', 'width="60"'), 'treemap', expected))[0]?.status).toBe('failed')
  const gantt = { labels: ['Alpha', 'Beta'], facts: { tasks: [{ id: 'A', label: 'Alpha', end: '7d' }, { id: 'B', label: 'Beta', end: '3d' }] } }
  expect((await inspect(fixture, 'gantt', gantt))[0]?.status).toBe('passed')
  expect((await inspect(fixture.replace('width="140"', 'width="60"'), 'gantt', gantt))[0]?.status).toBe('failed')
})

test('weighted Sankey edges require bounded owned endpoints and distinct weighted paint', async () => {
  const fixture = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="140"><g><rect x="5" y="5" width="20" height="100"/><text x="7" y="55" fill="white">A</text></g><g><rect x="180" y="5" width="20" height="40"/><text x="185" y="25" fill="white">B</text></g><g><rect x="180" y="65" width="20" height="40"/><text x="185" y="85" fill="white">C</text></g><path class="sankey-link" d="M25 25 C80 25 120 25 180 25" fill="none" stroke="red" stroke-width="8"/><path class="sankey-link" d="M25 85 C80 85 120 85 180 85" fill="none" stroke="blue" stroke-width="2"/></svg>'
  const expected = { labels: ['A', 'B', 'C'], nodes: ['A', 'B', 'C'].map(id => ({ id, label: id })), facts: { links: [{ source: 'A', target: 'B', value: 8 }, { source: 'A', target: 'C', value: 2 }] } }
  expect((await inspect(fixture, 'sankey', expected))[0]?.status).toBe('passed')
  expect((await inspect(fixture.replace('stroke-width="8"', 'stroke-width="2"'), 'sankey', expected))[0]?.status).toBe('failed')
  expect((await inspect(fixture.replace('M25 25', 'M50 25'), 'sankey', expected))[0]?.status).toBe('unavailable')
})

test('journey relative scores observe actual task-owned glyph order', async () => {
  const fixture = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="130"><text x="50" y="120" text-anchor="middle">Build</text><text x="180" y="120" text-anchor="middle">Ship</text><circle cx="50" cy="30" r="10"/><circle cx="180" cy="70" r="10"/></svg>'
  const expected = { labels: ['Build', 'Ship'], facts: { tasks: [{ label: 'Build', score: 4 }, { label: 'Ship', score: 2 }] } }
  expect((await inspect(fixture, 'journey', expected))[0]?.status).toBe('passed')
  expect((await inspect(fixture.replace('cy="30"', 'cy="90"'), 'journey', expected))[0]?.status).toBe('failed')
})

test('radar values measure drawn curve intersections rather than retained legend or model values', async () => {
  const fixture = '<svg xmlns="http://www.w3.org/2000/svg" width="220" height="200"><circle cx="100" cy="100" r="50" fill="none" stroke="gray"/><path class="radar-area" d="M100 50 L150 100 L100 150 L50 100 Z" fill="pink"/><text x="100" y="40" text-anchor="middle">Top</text><text x="160" y="104" text-anchor="middle">Right</text><text x="100" y="170" text-anchor="middle">Bottom</text><text x="40" y="104" text-anchor="middle">Left</text></svg>'
  const expected = { labels: ['Top', 'Right', 'Bottom', 'Left'], facts: { axes: ['Top', 'Right', 'Bottom', 'Left'].map(id => ({ id, label: id })), curves: [{ id: 'now', label: 'Current', values: [5, 5, 5, 5] }], range: [0, 5] } }
  expect((await inspect(fixture, 'radar', expected))[0]?.status).toBe('passed')
  expect((await inspect(fixture.replace('M100 50', 'M100 80'), 'radar', expected))[0]?.status).toBe('failed')
})
