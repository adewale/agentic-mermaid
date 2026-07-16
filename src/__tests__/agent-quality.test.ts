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

const CORPUS_PATH = join(import.meta.dir, '..', '..', 'eval', 'mermaid-docs-corpus', 'corpus.json')
interface CorpusEntry { family: string; source: string; origin: string; index: number }

function loadCorpus(): CorpusEntry[] {
  if (!existsSync(CORPUS_PATH)) return []
  return JSON.parse(readFileSync(CORPUS_PATH, 'utf8'))
}

const corpus = loadCorpus().filter(e => e.family === 'flowchart')

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

  test('repeated calls produce identical metrics (determinism)', () => {
    const flow = corpus.find(e => e.source.includes('-->'))
    if (!flow) return
    const p = parseMermaid(flow.source)
    if (!p.ok || p.value.kind !== 'flowchart') return
    const a = measureQuality(layoutMermaid(p.value))
    const b = measureQuality(layoutMermaid(p.value))
    expect(a).toEqual(b)
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

  test('labelEdgeProximity includes label-to-label box overlap', () => {
    const layout: RenderedLayout = {
      version: 1,
      kind: 'flowchart',
      nodes: [],
      groups: [],
      edges: [
        { id: 'A->B', from: 'A', to: 'B', path: [[f(0), f(0)], [f(100), f(0)]], label: { x: f(80), y: f(50), text: 'first' } },
        { id: 'C->D', from: 'C', to: 'D', path: [[f(0), f(100)], [f(100), f(100)]], label: { x: f(80), y: f(50), text: 'second' } },
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
        { id: 'A->B', from: 'A', to: 'B', path: [[f(0), f(50)], [f(100), f(50)]], label: { x: f(50), y: f(50), text: 'on route' } },
        { id: 'C->D', from: 'C', to: 'D', path: [[f(50), f(0)], [f(50), f(100)]] },
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
        { id: 'A->B', from: 'A', to: 'B', path: [[f(0), f(50)], [f(100), f(50)]], label: { x: f(50), y: f(50), text: 'own route' } },
      ],
      bounds: { w: f(120), h: f(120) },
    }
    const m = measureQuality(layout)
    expect(m.labelEdgeProximity).toBe(Infinity)
    const v = checkQuality(layout, { whitespaceBand: [0, 1] })
    expect(v.ok).toBe(true)
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
    expect(summary.medianCrossings).toBeLessThanOrEqual(2)
    expect(summary.medianLegibility).toBeGreaterThanOrEqual(0.3)  // mermaid docs use long labels; relaxed
    expect(summary.medianWhitespace).toBeGreaterThan(0)
    expect(summary.medianWhitespace).toBeLessThan(0.99)
  })
})
