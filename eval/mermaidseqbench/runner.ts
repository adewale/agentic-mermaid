// MermaidSeqBench runner.
//   bun run eval/mermaidseqbench/runner.ts
//
// Loads the IBM MermaidSeqBench dataset (132 human-verified sequence diagrams)
// and runs each expected_output through our agent verify-after-parse path.
// Reports: parse rate, structured-vs-opaque split, verify rate, round-trip
// stability rate. This is the "single decisive number" the spec calls for.

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { asSequence } from '../../src/agent/types.ts'
import { runParseVerifyRoundtrip } from '../shared/run-bench.ts'

const DATA = join(import.meta.dir, 'data.csv')

// --- Minimal CSV parser (handles quoted multi-line fields, "" escapes) ----

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += c
    } else {
      if (c === '"') inQuotes = true
      else if (c === ',') { row.push(field); field = '' }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
      else if (c === '\r') { /* skip */ }
      else field += c
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }
  return rows
}

export interface BenchRow { title: string; desc: string; prompt: string; expected: string }

export function loadDataset(path: string = DATA): BenchRow[] {
  const rows = parseCsv(readFileSync(path, 'utf8'))
  const header = rows[0]!
  const idx = (name: string) => header.indexOf(name)
  const ti = idx('nl_task_title'), di = idx('nl_task_desc')
  const pi = idx('input_prompt'), ei = idx('expected_output')
  return rows.slice(1).filter(r => r[ei]?.trim()).map(r => ({
    title: r[ti] ?? '', desc: r[di] ?? '', prompt: r[pi] ?? '', expected: r[ei]!.trim(),
  }))
}

export interface Counts {
  total: number
  parseOk: number
  structured: number
  opaque: number
  verifyOk: number
  roundTripStable: number
  parseErrors: string[]
}

export function runBench(rows: BenchRow[]): Counts {
  // Loop 9 M9: delegate the parse-verify-roundtrip pass to the shared
  // helper; thread the per-row "structured vs opaque" tally via the extra
  // hook.
  type Extra = { structured: number; opaque: number }
  const r = runParseVerifyRoundtrip<Extra>(
    rows.map(row => ({ source: row.expected, label: row.title })),
    {
      initial: { structured: 0, opaque: 0 },
      extra: (_row, d, acc) => {
        if (d.body.kind === 'opaque') acc.opaque++
        else if (asSequence(d)) acc.structured++
      },
    },
  )
  return {
    total: r.counts.total,
    parseOk: r.counts.parseOk,
    structured: r.extra.structured,
    opaque: r.extra.opaque,
    verifyOk: r.counts.verifyOk,
    roundTripStable: r.counts.roundTripStable,
    parseErrors: r.counts.parseErrors,
  }
}

if (import.meta.main) {
  if (!existsSync(DATA)) {
    console.error(`Dataset not found at ${DATA}.`)
    console.error('Download with: curl -sSL -o eval/mermaidseqbench/data.csv "https://huggingface.co/datasets/ibm-research/MermaidSeqBench/resolve/main/data.csv?download=true"')
    process.exit(1)
  }
  const rows = loadDataset()
  console.log(`Loaded ${rows.length} samples from MermaidSeqBench.`)
  const c = runBench(rows)
  const pct = (n: number) => `${((n / c.total) * 100).toFixed(1)}%`
  console.log('')
  console.log(`Parse success:        ${c.parseOk}/${c.total}  (${pct(c.parseOk)})`)
  console.log(`  Structured sequence: ${c.structured}/${c.total}  (${pct(c.structured)})`)
  console.log(`  Opaque (lossless):   ${c.opaque}/${c.total}  (${pct(c.opaque)})`)
  console.log(`Verify ok:            ${c.verifyOk}/${c.total}  (${pct(c.verifyOk)})`)
  console.log(`Round-trip stable:    ${c.roundTripStable}/${c.total}  (${pct(c.roundTripStable)})`)
  if (c.parseErrors.length) {
    console.log('')
    console.log(`Parse errors (${c.parseErrors.length}):`)
    for (const e of c.parseErrors.slice(0, 10)) console.log('  - ' + e.slice(0, 120))
    if (c.parseErrors.length > 10) console.log(`  ... and ${c.parseErrors.length - 10} more`)
  }
}
