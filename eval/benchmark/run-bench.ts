// Loop 12 M3: benchmark harness.
//
// Measures OUR renderer on the mermaid-docs corpus across output formats.
// Competitor numbers (mmdc / termaid / mmd-cli) are recorded separately in
// RESULTS.md — some measured live in this sandbox, some assessed from
// architecture. This script only measures OURS (no competitor dependency).
//
//   bun run eval/benchmark/run-bench.ts

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { renderMermaidSVG, renderMermaidASCII } from '../../src/index.ts'
import { parseMermaid } from '../../src/agent/parse.ts'

const CORPUS = join(import.meta.dir, '..', 'mermaid-docs-corpus', 'corpus.json')

interface Row { family: string; source: string }
interface Stat { n: number; p50: number; p90: number; max: number }

function pct(xs: number[], p: number): number {
  const s = xs.slice().sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0
}
function stat(xs: number[]): Stat {
  return { n: xs.length, p50: +pct(xs, 0.5).toFixed(3), p90: +pct(xs, 0.9).toFixed(3), max: +Math.max(...xs).toFixed(3) }
}

export interface BenchResult {
  samples: number
  parseOkRate: number
  svgMs: Stat
  asciiMs: Stat
  svgBytes: Stat
}

export function runBenchmark(rows: Row[]): BenchResult {
  // Warm-up so we measure steady-state, not first-call JIT.
  for (const r of rows.slice(0, 5)) { try { renderMermaidSVG(r.source) } catch { /* ignore */ } }

  const svgMs: number[] = []
  const asciiMs: number[] = []
  const svgBytes: number[] = []
  let parseOk = 0
  for (const r of rows) {
    if (parseMermaid(r.source).ok) parseOk++
    try {
      let t = performance.now(); const svg = renderMermaidSVG(r.source); svgMs.push(performance.now() - t)
      svgBytes.push(svg.length)
    } catch { /* render failure — excluded from timing */ }
    try {
      const t = performance.now(); renderMermaidASCII(r.source); asciiMs.push(performance.now() - t)
    } catch { /* ignore */ }
  }
  return {
    samples: rows.length,
    parseOkRate: +(parseOk / rows.length).toFixed(3),
    svgMs: stat(svgMs),
    asciiMs: stat(asciiMs),
    svgBytes: stat(svgBytes),
  }
}

export function loadCorpus(): Row[] {
  if (!existsSync(CORPUS)) return []
  return JSON.parse(readFileSync(CORPUS, 'utf8')) as Row[]
}

if (import.meta.main) {
  const rows = loadCorpus()
  if (rows.length === 0) { console.error('corpus not found at', CORPUS); process.exit(1) }
  const r = runBenchmark(rows)
  console.log(JSON.stringify(r, null, 2))
}
