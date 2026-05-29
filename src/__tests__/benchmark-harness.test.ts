// Loop 12 M3: the benchmark harness produces numbers for OUR tool.
// Does NOT gate on any competitor being installed.

import { describe, test, expect } from 'bun:test'
import { runBenchmark, loadCorpus } from '../../eval/benchmark/run-bench.ts'

describe('benchmark harness', () => {
  test('produces finite metrics for our renderer over the corpus', () => {
    const rows = loadCorpus()
    expect(rows.length).toBeGreaterThan(200)
    const r = runBenchmark(rows)
    expect(r.samples).toBe(rows.length)
    expect(r.parseOkRate).toBeGreaterThan(0.9)
    for (const s of [r.svgMs, r.asciiMs, r.svgBytes]) {
      expect(s.n).toBeGreaterThan(100)
      expect(Number.isFinite(s.p50)).toBe(true)
      expect(Number.isFinite(s.p90)).toBe(true)
      expect(s.p90).toBeGreaterThanOrEqual(s.p50)
    }
  })

  test('ASCII render is faster than SVG render (sanity)', () => {
    const r = runBenchmark(loadCorpus())
    expect(r.asciiMs.p50).toBeLessThan(r.svgMs.p50)
  })

  test('RESULTS.md exists and records the competitor assessment', () => {
    const { readFileSync, existsSync } = require('node:fs') as typeof import('node:fs')
    const { join } = require('node:path') as typeof import('node:path')
    const path = join(import.meta.dir, '..', '..', 'eval', 'benchmark', 'RESULTS.md')
    expect(existsSync(path)).toBe(true)
    const md = readFileSync(path, 'utf8')
    for (const tool of ['mmdc', 'termaid', 'mmd-cli']) expect(md).toContain(tool)
  })
})
