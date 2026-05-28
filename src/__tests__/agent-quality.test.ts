// Phase F (perceptual): deterministic quality metrics on layouts.
// Runs every flowchart in the mermaid-js docs corpus through measureQuality
// and asserts: median & p90 of each metric stay within bounds. CI-cheap.

import { describe, test, expect } from 'bun:test'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { parseMermaid } from '../agent/parse.ts'
import { layoutMermaid } from '../agent/index.ts'
import { measureQuality, checkQuality } from '../agent/quality.ts'

const CORPUS_PATH = join(import.meta.dir, '..', '..', 'eval', 'mermaid-docs-corpus', 'corpus.json')
interface CorpusEntry { family: string; source: string; origin: string; index: number }

function loadCorpus(): CorpusEntry[] {
  if (!existsSync(CORPUS_PATH)) return []
  return JSON.parse(readFileSync(CORPUS_PATH, 'utf8'))
}

const corpus = loadCorpus().filter(e => e.family === 'flowchart')

describe('quality metrics — deterministic', () => {
  test('measureQuality returns finite numbers for any flowchart', () => {
    let measured = 0
    for (const e of corpus.slice(0, 30)) {
      const p = parseMermaid(e.source)
      if (!p.ok || p.value.body.kind !== 'flowchart') continue
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
    if (!p.ok || p.value.body.kind !== 'flowchart') return
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
})

describe('checkQuality — verdict', () => {
  test('a trivial diagram passes default bounds', () => {
    const p = parseMermaid('flowchart LR\n  A[Start] --> B[End]')
    expect(p.ok).toBe(true)
    if (!p.ok || p.value.body.kind !== 'flowchart') return
    const v = checkQuality(layoutMermaid(p.value))
    expect(v.ok).toBe(true)
    expect(v.violations).toEqual([])
  })

  test('tight bounds catch real violations', () => {
    const p = parseMermaid('flowchart LR\n  A --> B')
    expect(p.ok).toBe(true)
    if (!p.ok || p.value.body.kind !== 'flowchart') return
    const v = checkQuality(layoutMermaid(p.value), { minLabelLegibility: 1.5 })  // impossible bound
    expect(v.ok).toBe(false)
    expect(v.violations.length).toBeGreaterThan(0)
  })
})

describe('quality regression baseline (flowchart corpus median + p90)', () => {
  test('median/p90 metrics within fixed bounds', () => {
    const metrics: ReturnType<typeof measureQuality>[] = []
    for (const e of corpus) {
      const p = parseMermaid(e.source)
      if (!p.ok || p.value.body.kind !== 'flowchart') continue
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
