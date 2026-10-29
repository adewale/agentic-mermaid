// Phase F (perceptual): deterministic quality metrics on layouts.
// Runs every flowchart in the mermaid-js docs corpus through measureQuality
// and asserts: median & p90 of each metric stay within bounds. CI-cheap.

import { describe, test, expect } from 'bun:test'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { parseRegisteredMermaid as parseMermaid } from '../agent/parse.ts'
import { layoutMermaid } from '../agent/index.ts'
import { measureQuality, checkQuality } from '../agent/quality.ts'
import { toFinite, type RenderedLayout } from '../agent/types.ts'
import { validateStyleSpec } from '../scene/style-spec.ts'

const CORPUS_PATH = join(import.meta.dir, '..', '..', 'eval', 'mermaid-docs-corpus', 'corpus.json')
interface CorpusEntry { family: string; source: string; origin: string; index: number }

function loadCorpus(): CorpusEntry[] {
  if (!existsSync(CORPUS_PATH)) return []
  return JSON.parse(readFileSync(CORPUS_PATH, 'utf8'))
}

const corpus = loadCorpus().filter(e => e.family === 'flowchart')

test('raw route geometry counts actual turns, ignores zero segments and hidden routes across families', () => {
  const f = toFinite
  const layout: RenderedLayout = { version: 1, kind: 'class', nodes: [], groups: [], bounds: { w: f(100), h: f(50) }, edges: [
    { id: 'visible', from: 'a', to: 'b', path: [[f(0), f(0)], [f(10), f(0)], [f(10), f(0)], [f(20), f(0)], [f(20), f(10)], [f(30), f(10)]] },
    { id: 'hidden', from: 'a', to: 'b', visibility: 'hidden', path: [[f(0), f(0)], [f(50), f(0)], [f(50), f(50)]] },
  ] }
  expect(measureQuality(layout).routeGeometry).toEqual({ bends: 2, length: 40, area: 5000 })
})

const GENERATED_FLOWCHART_CORPUS = [
  { nodeCount: 20, layers: 5, rows: 4 },
  { nodeCount: 50, layers: 10, rows: 5 },
  { nodeCount: 100, layers: 10, rows: 10 },
] as const

function generatedLayeredFlowchart({ nodeCount, layers, rows }: typeof GENERATED_FLOWCHART_CORPUS[number]): string {
  if (layers * rows !== nodeCount) throw new Error(`invalid generated corpus dimensions for ${nodeCount}`)
  const id = (layer: number, row: number) => `N${layer}_${row}`
  const lines = ['flowchart LR']
  for (let layer = 0; layer < layers; layer++) {
    for (let row = 0; row < rows; row++) {
      lines.push(`  ${id(layer, row)}[Node ${layer + 1}.${row + 1}]`)
    }
  }
  for (let layer = 0; layer < layers - 1; layer++) {
    for (let row = 0; row < rows; row++) {
      lines.push(`  ${id(layer, row)} --> ${id(layer + 1, row)}`)
      if ((layer + row) % 3 === 0) lines.push(`  ${id(layer, row)} -.-> ${id(layer + 1, (row + 1) % rows)}`)
    }
  }
  return lines.join('\n')
}

function f(n: number) { return toFinite(n) }

describe('quality metrics — deterministic', () => {
  test('measureQuality returns finite numbers for any flowchart', () => {
    let measured = 0
    for (const e of corpus.slice(0, 30)) {
      const p = parseMermaid(e.source)
      if (!p.ok || p.value.kind !== 'flowchart') continue
      const layout = layoutMermaid(p.value)
      if (layout.nodes.length === 0) continue
      const m = measureQuality(layout)
      expect(Number.isFinite(m.whitespaceBalance)).toBe(true)
      expect(Number.isFinite(m.labelLegibility)).toBe(true)
      expect(m.edgeCrossings).toBeGreaterThanOrEqual(0)
      expect(m.nodeCount).toBe(layout.nodes.length)
      measured++
    }
    expect(measured).toBeGreaterThan(10)
  })

  test('XY quality measures painted point labels and chart chrome without adding semantic nodes', () => {
    const source = '---\nconfig:\n xyChart:\n  showDataLabel: true\n---\nxychart-beta\n title Revenue\n x-axis Month [A,B]\n y-axis Amount 0 --> 10\n bar Sales [8,2]\n line Trend [10 "Top",0 "Bottom"]'
    const parsed = parseMermaid(source)
    if (!parsed.ok) throw new Error('XY fixture did not parse')
    const layout = layoutMermaid(parsed.value)
    expect(layout.nodes).toHaveLength(4)
    const ids = new Set(layout.labels?.map(label => label.id))
    for (const id of ['title', 'axis:x:title', 'axis:y:title', 'legend:label:0', 'legend:label:1', 'point-label:0:0', 'point-label:0:1', 'data-label:0']) expect(ids.has(id)).toBe(true)
    const top = layout.labels!.find(label => label.text === 'Top')!
    expect(top.bounds).toBeDefined()
    const good = measureQuality(layout)
    expect(good.labelLegibility).toBe(1)
    expect(good.labelMeasurement.measuredLabels).toBe(layout.labels!.length)
    expect(good.labelMeasurement.unmeasuredLabels).toBe(0)
    const clipped = structuredClone(layout)
    clipped.labels!.find(label => label.text === 'Top')!.bounds!.y = f(-20)
    expect(measureQuality(clipped).labelLegibility).toBeLessThan(1)
    const unmeasured = structuredClone(layout)
    delete unmeasured.labels!.find(label => label.text === 'Top')!.bounds
    expect(measureQuality(unmeasured).labelMeasurement.unmeasuredLabels).toBe(1)
    expect(checkQuality(unmeasured).ranked.some(violation => violation.message.includes('unmeasured'))).toBe(true)
  })

  test('repeated calls produce identical metrics (determinism)', () => {
    const p = parseMermaid('flowchart TD\n  A[Start] --> B{Check}\n  B -->|yes| C[Done]\n  B -->|no| A')
    expect(p.ok && p.value.kind).toBe('flowchart')
    if (!p.ok) return
    const a = measureQuality(layoutMermaid(p.value))
    const b = measureQuality(layoutMermaid(p.value))
    expect(a).toEqual(b)
  })

  test('reports shared parallel and opposing ink separately from proper crossings', () => {
    const forward: RenderedLayout['edges'][number] = { id: 'ab', from: 'a', to: 'b', path: [[f(0), f(0)], [f(100), f(0)]] }
    const reverse: RenderedLayout['edges'][number] = { id: 'cd', from: 'c', to: 'd', path: [[f(90), f(0)], [f(10), f(0)]] }
    const layout: RenderedLayout = { version: 1, kind: 'flowchart', nodes: [], groups: [], edges: [forward, reverse], bounds: { w: f(200), h: f(100) } }
    expect(measureQuality(layout)).toMatchObject({ edgeCrossings: 0, routeOverlaps: { parallel: 0, opposing: 1 } })
    expect(measureQuality({ ...layout, edges: [forward, { ...forward, id: 'ab2' }] }).routeOverlaps).toEqual({ parallel: 1, opposing: 0 })
    expect(measureQuality({ ...layout, edges: [forward, { ...reverse, visibility: 'hidden' }] }).routeOverlaps).toEqual({ parallel: 0, opposing: 0 })
    expect(measureQuality({ ...layout, edges: [forward, { ...reverse, path: [[f(200), f(0)], [f(100), f(0)]] }] }).routeOverlaps).toEqual({ parallel: 0, opposing: 0 })
  })

  test('crossings = 0 on a trivial linear graph', () => {
    const p = parseMermaid('flowchart LR\n  A --> B --> C')
    expect(p.ok).toBe(true)
    if (!p.ok || p.value.body.kind !== 'flowchart') return
    const m = measureQuality(layoutMermaid(p.value))
    expect(m.edgeCrossings).toBe(0)
  })

  // upstream: mermaid-js/mermaid#1984 — massive whitespace above/below large graphs (detection)
  test('whitespace balance is in 0..1', () => {
    const p = parseMermaid('flowchart LR\n  A --> B --> C\n  A --> C')
    expect(p.ok).toBe(true)
    if (!p.ok || p.value.body.kind !== 'flowchart') return
    const m = measureQuality(layoutMermaid(p.value))
    expect(m.whitespaceBalance).toBeGreaterThanOrEqual(0)
    expect(m.whitespaceBalance).toBeLessThanOrEqual(1)
  })

  test('labelLegibility = 1 when all labels fit', () => {
    const p = parseMermaid('flowchart LR\n  A[hi] --> B[ok]')
    expect(p.ok).toBe(true)
    if (!p.ok || p.value.body.kind !== 'flowchart') return
    const m = measureQuality(layoutMermaid(p.value))
    expect(m.labelLegibility).toBe(1)
  })

  test('measures multiline and styled labels from retained geometry', () => {
    const p = parseMermaid('flowchart LR\nA["first line<br/>second line<br/>third line"] --> B[Done]')
    expect(p.ok).toBe(true)
    if (!p.ok) return
    const layout = layoutMermaid(p.value, { style: { roles: { node: { fontSize: 24, letterSpacing: 2 } } } })
    const metrics = measureQuality(layout)
    expect(metrics.labelLegibility).toBe(1)
    expect(metrics.labelMeasurement).toEqual({ measuredNodes: 2, unmeasuredNodes: 0, hiddenNodes: 0, semanticNodes: 0, measuredEdges: 0, unmeasuredEdges: 0, measuredLabels: 0, unmeasuredLabels: 0, hiddenLabels: 0, semanticLabels: 0 })
    expect(checkQuality(layout).ranked.map(item => item.metric)).not.toContain('labelLegibility')
  })

  test('reports missing label geometry instead of guessing a fit', () => {
    const layout: RenderedLayout = {
      version: 1, kind: 'flowchart', groups: [],
      edges: [{ id: 'A->B', from: 'A', to: 'B', path: [[f(100), f(20)], [f(200), f(20)]], label: { x: f(150), y: f(20), text: 'short' } }],
      nodes: [{ id: 'A', x: f(0), y: f(0), w: f(100), h: f(40), shape: 'rectangle', label: 'short' }],
      bounds: { w: f(200), h: f(100) },
    }
    expect(measureQuality(layout).labelMeasurement.unmeasuredNodes).toBe(1)
    expect(measureQuality(layout).labelMeasurement.unmeasuredEdges).toBe(1)
    expect(checkQuality(layout).ranked.some(item => item.metric === 'labelLegibility' && item.message.includes('unmeasured'))).toBe(true)
    expect(checkQuality(layout).ranked.some(item => item.metric === 'labelEdgeProximity' && item.message.includes('unmeasured'))).toBe(true)
  })

  test('labelEdgeProximity includes label-to-label box overlap', () => {
    const layout: RenderedLayout = {
      version: 1,
      kind: 'flowchart',
      nodes: [],
      groups: [],
      edges: [
        { id: 'A->B', from: 'A', to: 'B', path: [[f(0), f(0)], [f(100), f(0)]], label: { x: f(80), y: f(50), text: 'first', bounds: { x: f(50), y: f(40), w: f(60), h: f(20) } } },
        { id: 'C->D', from: 'C', to: 'D', path: [[f(0), f(100)], [f(100), f(100)]], label: { x: f(80), y: f(50), text: 'second', bounds: { x: f(50), y: f(40), w: f(60), h: f(20) } } },
      ],
      bounds: { w: f(160), h: f(120) },
    }
    const m = measureQuality(layout)
    expect(m.labelEdgeProximity).toBe(0)
    const v = checkQuality(layout, { whitespaceBand: [0, 1] })
    expect(v.ok).toBe(false)
    expect(v.ranked.map(item => item.message)).toContain('edge-label clearance 0px < min 4px')
  })

  test('labelEdgeProximity includes label-to-unrelated-edge path overlap', () => {
    const layout: RenderedLayout = {
      version: 1,
      kind: 'flowchart',
      nodes: [],
      groups: [],
      edges: [
        { id: 'A->B', from: 'A', to: 'B', path: [[f(0), f(50)], [f(100), f(50)]], label: { x: f(50), y: f(50), text: 'i', bounds: { x: f(20), y: f(40), w: f(60), h: f(20) } } },
        { id: 'C->D', from: 'C', to: 'D', path: [[f(75), f(0)], [f(75), f(100)]] },
      ],
      bounds: { w: f(120), h: f(120) },
    }
    const m = measureQuality(layout)
    expect(m.labelEdgeProximity).toBe(0)
    const v = checkQuality(layout, { whitespaceBand: [0, 1] })
    expect(v.ok).toBe(false)
    expect(v.ranked.map(item => item.message)).toContain('edge-label clearance 0px < min 4px')
  })

  test("labelEdgeProximity ignores the label's own edge path", () => {
    const layout: RenderedLayout = {
      version: 1,
      kind: 'flowchart',
      nodes: [],
      groups: [],
      edges: [
        { id: 'A->B', from: 'A', to: 'B', path: [[f(0), f(50)], [f(100), f(50)]], label: { x: f(50), y: f(50), text: 'own route', bounds: { x: f(20), y: f(40), w: f(60), h: f(20) } } },
      ],
      bounds: { w: f(120), h: f(120) },
    }
    const m = measureQuality(layout)
    expect(m.labelEdgeProximity).toBe(Infinity)
    const v = checkQuality(layout, { whitespaceBand: [0, 1] })
    expect(v.ok).toBe(true)
  })

  test('measures contrast, nearest-node spacing, and element density', () => {
    const layout: RenderedLayout = {
      version: 1,
      kind: 'flowchart',
      nodes: [
        { id: 'A', x: f(0), y: f(0), w: f(20), h: f(20), shape: 'rectangle', label: 'A' },
        { id: 'B', x: f(25), y: f(0), w: f(20), h: f(20), shape: 'rectangle', label: 'B' },
      ],
      groups: [],
      edges: [],
      bounds: { w: f(1_000), h: f(1_000) },
    }
    const colors = { foreground: '#777777', background: '#ffffff' }
    const metrics = measureQuality(layout, colors)
    expect(metrics.minimumNodeSpacing).toBe(5)
    expect(metrics.elementDensity).toBeCloseTo(0.02)
    expect(metrics.minimumTextContrast).not.toBeNull()
    if (metrics.minimumTextContrast !== null) expect(metrics.minimumTextContrast).toBeCloseTo(4.478, 2)

    const verdict = checkQuality(layout, {
      whitespaceBand: [0, 1],
      aspectBand: [0.2, 5],
      elementDensityBand: [0.1, 6],
    }, colors)
    expect(verdict.ranked.map(violation => violation.metric)).toEqual(expect.arrayContaining([
      'minimumNodeSpacing', 'elementDensity', 'minimumTextContrast',
    ]))
  })

  test('fails closed for unresolved paints instead of silently dropping them', () => {
    const p = parseMermaid('flowchart LR\n  A --> B')
    expect(p.ok).toBe(true)
    if (!p.ok) return
    const layout = layoutMermaid(p.value)
    expect(measureQuality(layout, { foreground: 'var(--fg)' }).minimumTextContrast).toBeNull()
    expect(measureQuality(layout, { surfaces: ['var(--surface)'] }).minimumTextContrast).toBeNull()
    expect(checkQuality(layout, {}, { foreground: 'var(--fg)' }).ranked)
      .toContainEqual(expect.objectContaining({ metric: 'minimumTextContrast' }))
  })

  test('composites alpha colors before calculating contrast', () => {
    const p = parseMermaid('flowchart LR\n  A --> B')
    expect(p.ok).toBe(true)
    if (!p.ok) return
    const layout = layoutMermaid(p.value)
    for (const foreground of ['rgba(255,255,255,0)', 'rgba(255 255 255 / 0)', '#ffffff00']) {
      expect(measureQuality(layout, { foreground, background: '#000000' }).minimumTextContrast).toBeCloseTo(1, 6)
    }
    expect(measureQuality(layout, {
      background: '#ffffff',
      textPairs: [{ foreground: '#ffffff', background: 'rgba(0 0 0 / 50%)' }],
    }).minimumTextContrast).toBeCloseTo(3.98, 2)
  })

  test('resolves concrete CSS colors accepted by public StyleSpec', () => {
    const p = parseMermaid('flowchart LR\n  A --> B')
    expect(p.ok).toBe(true)
    if (!p.ok) return
    const layout = layoutMermaid(p.value)
    const cases = [
      { foreground: 'black', background: 'white', expected: 21 },
      { foreground: 'transparent', background: 'white', expected: 1 },
      { foreground: 'hsl(0 0% 0%)', background: 'hsl(0 0% 100%)', expected: 21 },
      { foreground: 'rgb(0% 0% 0%)', background: 'rgb(100% 100% 100%)', expected: 21 },
    ]
    for (const { foreground, background, expected } of cases) {
      expect(validateStyleSpec({ colors: { fg: foreground, bg: background } })).toEqual([])
      expect(measureQuality(layout, { foreground, background }).minimumTextContrast).toBeCloseTo(expected, 6)
    }
  })

  test('ignores intentional XY bar/line containment when measuring spacing', () => {
    const p = parseMermaid('xychart-beta\n  x-axis [A, B, C]\n  bar [3, 5, 4]\n  line [4, 2, 6]')
    expect(p.ok).toBe(true)
    if (!p.ok) return
    expect(measureQuality(layoutMermaid(p.value)).minimumNodeSpacing).toBeGreaterThan(0)
  })

  test('ignores intentional same-category XY series adjacency and overlays', () => {
    for (const source of [
      'xychart-beta\n  x-axis [A, B]\n  bar X [1, 2]\n  bar Y [2, 1]',
      'xychart-beta\n  x-axis [A, B, C]\n  line X [1, 2, 3]\n  line Y [1, 2, 3]',
    ]) {
      const p = parseMermaid(source)
      expect(p.ok).toBe(true)
      if (!p.ok) continue
      const layout = layoutMermaid(p.value)
      expect(measureQuality(layout).minimumNodeSpacing).toBeGreaterThan(0)
      expect(checkQuality(layout).ranked.map(violation => violation.metric)).not.toContain('minimumNodeSpacing')
    }
  })

  test('ignores intentional same-vertex Radar curve overlays', () => {
    const p = parseMermaid('radar-beta\n  axis a, b, c\n  curve x{1, 2, 3}\n  curve y{1, 2, 3}\n  max 3')
    expect(p.ok).toBe(true)
    if (!p.ok) return
    const layout = layoutMermaid(p.value)
    expect(measureQuality(layout).minimumNodeSpacing).toBeGreaterThan(0)
    expect(checkQuality(layout, { minNodeSpacing: 0.1 }).ranked.map(violation => violation.metric))
      .not.toContain('minimumNodeSpacing')
  })

  test('treats coincident quadrant coordinates as data overlays while measuring distinct nearby points', () => {
    const parsed = parseMermaid('quadrantChart\nA: [0.5, 0.5]\nB: [0.5, 0.5]\nC: [0.8, 0.8]')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const layout = layoutMermaid(parsed.value)
    expect(measureQuality(layout).minimumNodeSpacing).toBeGreaterThan(8)
    expect(checkQuality(layout).ranked).toEqual([])
    expect(checkQuality(layout, { whitespaceBand: [0.05, 0.55] }).ranked.some(item => item.metric === 'whitespaceBalance')).toBe(true)
    expect(layout.nodes.map(node => node.dataPosition)).toEqual([{ x: f(0.5), y: f(0.5) }, { x: f(0.5), y: f(0.5) }, { x: f(0.8), y: f(0.8) }])
    const nearby = { ...layout, nodes: layout.nodes.slice(0, 2).map((node, index) => ({ ...node, dataPosition: { x: f(0.5 + index * 0.0001), y: f(0.5) } })) }
    expect(measureQuality(nearby).minimumNodeSpacing).toBe(0)
  })

  test('measures XY cross-category and Radar near-but-distinct mark collisions', () => {
    const mark = (id: string, x: number): RenderedLayout['nodes'][number] => ({
      id, x: toFinite(x), y: toFinite(0), w: toFinite(10), h: toFinite(10),
      shape: 'mark', role: 'mark',
    })
    const layout = (kind: 'xychart' | 'radar', nodes: RenderedLayout['nodes']): RenderedLayout => ({
      version: 1, kind, nodes, edges: [], groups: [], bounds: { w: toFinite(20), h: toFinite(10) },
    })

    expect(measureQuality(layout('xychart', [
      mark('bar#0:pt#0', 0),
      mark('line#0:pt#1', 0),
    ])).minimumNodeSpacing).toBe(0)
    expect(measureQuality(layout('radar', [
      mark('dot:first:0', 0),
      mark('dot:second:0', 5),
    ])).minimumNodeSpacing).toBe(0)
  })

  test('measures spacing correctly in a 10,000-node edge-free layout', () => {
    const nodes = Array.from({ length: 10_000 }, (_, index) => ({
      id: `N${index}`, x: f((index % 100) * 20), y: f(Math.floor(index / 100) * 20),
      w: f(10), h: f(10), shape: 'rectangle', label: '',
    }))
    const layout: RenderedLayout = {
      version: 1, kind: 'flowchart', nodes, groups: [], edges: [], bounds: { w: f(2_000), h: f(2_000) },
    }
    expect(measureQuality(layout).minimumNodeSpacing).toBe(10)
  })
})

describe('quality metrics — generated large flowchart corpora', () => {
  for (const entry of GENERATED_FLOWCHART_CORPUS) {
    // upstream: mermaid-js/mermaid#1984 / #3262 — scale-collapse whitespace + over-wide aspect
    test(`${entry.nodeCount} nodes keeps aspect and whitespace measurable`, () => {
      const p = parseMermaid(generatedLayeredFlowchart(entry))
      expect(p.ok).toBe(true)
      if (!p.ok || p.value.kind !== 'flowchart') return

      const layout = layoutMermaid(p.value)
      const m = measureQuality(layout)
      expect(m.nodeCount).toBe(entry.nodeCount)
      expect(Number.isFinite(m.aspectRatio)).toBe(true)
      expect(m.aspectRatio).toBeGreaterThan(0.1)
      expect(m.aspectRatio).toBeLessThan(10)
      expect(Number.isFinite(m.whitespaceBalance)).toBe(true)
      expect(m.whitespaceBalance).toBeGreaterThan(0.005)
      expect(m.whitespaceBalance).toBeLessThan(0.8)
    })
  }
})

describe('checkQuality — verdict', () => {
  test('a trivial diagram passes default bounds', () => {
    const p = parseMermaid('flowchart LR\n  A[Start] --> B[End]')
    expect(p.ok).toBe(true)
    if (!p.ok || p.value.body.kind !== 'flowchart') return
    const v = checkQuality(layoutMermaid(p.value))
    expect(v.ok).toBe(true)
    expect(v.ranked.map(item => item.message)).toEqual([])
  })

  test('tight bounds catch real violations', () => {
    const p = parseMermaid('flowchart LR\n  A --> B')
    expect(p.ok).toBe(true)
    if (!p.ok || p.value.body.kind !== 'flowchart') return
    const v = checkQuality(layoutMermaid(p.value), { minLabelLegibility: 1.5 })  // impossible bound
    expect(v.ok).toBe(false)
    expect(v.ranked.map(item => item.message).length).toBeGreaterThan(0)
  })
})

describe('quality on non-flowchart families (Phase D)', () => {
  test('sequence produces a real layout (not empty)', () => {
    const p = parseMermaid(`sequenceDiagram
  participant A
  participant B
  A->>B: hi`)
    expect(p.ok).toBe(true)
    if (!p.ok) return
    const layout = layoutMermaid(p.value)
    expect(layout.nodes.length).toBe(2)
    expect(layout.edges.length).toBe(1)
    expect(layout.bounds.w).toBeGreaterThan(0)
  })

  test('timeline produces a real layout (not empty)', () => {
    const p = parseMermaid(`timeline
  title T
  2020 : event1
  2021 : event2`)
    expect(p.ok).toBe(true)
    if (!p.ok) return
    const layout = layoutMermaid(p.value)
    expect(layout.nodes.length).toBeGreaterThan(0)
    expect(layout.bounds.w).toBeGreaterThan(0)
  })

  test('sequence quality metrics within bounds', () => {
    const p = parseMermaid(`sequenceDiagram
  participant Alice
  participant Bob
  Alice->>Bob: Hi
  Bob-->>Alice: Hello`)
    expect(p.ok).toBe(true)
    if (!p.ok) return
    const m = measureQuality(layoutMermaid(p.value))
    expect(m.edgeCrossings).toBe(0)
    expect(m.nodeCount).toBe(2)
    expect(m.edgeCount).toBe(2)
  })

  test('timeline quality: each event becomes a node', () => {
    const p = parseMermaid(`timeline
  2020 : a : b : c
  2021 : d`)
    expect(p.ok).toBe(true)
    if (!p.ok) return
    const layout = layoutMermaid(p.value)
    // 2 period labels + 4 events = 6 nodes
    expect(layout.nodes.length).toBe(6)
  })
})

describe('quality regression baseline (flowchart corpus median + p90)', () => {
  test('median/p90 metrics within fixed bounds', () => {
    const metrics: ReturnType<typeof measureQuality>[] = []
    for (const e of corpus) {
      const p = parseMermaid(e.source)
      if (!p.ok || p.value.kind !== 'flowchart') continue
      const layout = layoutMermaid(p.value)
      if (layout.nodes.length === 0) continue
      metrics.push(measureQuality(layout))
    }
    expect(metrics.length).toBeGreaterThan(80)
    const p50 = (xs: number[]) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length * 0.5)]!
    const p90 = (xs: number[]) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length * 0.9)]!
    const summary = {
      n: metrics.length,
      medianCrossings: p50(metrics.map(m => m.edgeCrossings)),
      p90Crossings: p90(metrics.map(m => m.edgeCrossings)),
      medianLegibility: p50(metrics.map(m => m.labelLegibility)),
      medianWhitespace: p50(metrics.map(m => m.whitespaceBalance)),
    }
    // Baseline floors observed from this corpus. Regression-only.
    // Observed at 399c5873: median 0, p90 0, max 1 crossing over 111 diagrams.
    expect(summary.medianCrossings).toBeLessThanOrEqual(2)
    expect(summary.p90Crossings).toBeLessThanOrEqual(1)
    expect(summary.medianLegibility).toBeGreaterThanOrEqual(0.3)  // mermaid docs use long labels; relaxed
    expect(summary.medianWhitespace).toBeGreaterThan(0)
    expect(summary.medianWhitespace).toBeLessThan(0.99)
  })
})
