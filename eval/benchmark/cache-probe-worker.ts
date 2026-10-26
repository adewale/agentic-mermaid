import './ci-policy-enforce.ts'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
// This evaluator-only alias is resolved by the diagnostic source bundler.
// @ts-ignore -- deliberately absent from production module resolution
import { renderMermaidSVGWithReceipt } from '@layout-probe/source'
import { cacheProbeSnapshot, cacheObservationSnapshot, withCacheProbeObservations } from './cache-probe-state.ts'
import type { BenchInput } from './release-bench-types.ts'

const job = JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as { inputs: BenchInput[]; backend: 'agentic' | 'elk'; observeCaches?: boolean; out: string }
const collect = () => {
  const phases = []
  for (const phase of ['fill', 'second-pass', 'third-pass']) {
    const canonicalBefore = job.observeCaches ? cacheObservationSnapshot() : null
    const before = cacheProbeSnapshot(), svg = createHash('sha256'), receipts = createHash('sha256')
    let bytes = 0
    const outcomes = []
    for (const input of job.inputs) {
      try {
        const artifact = renderMermaidSVGWithReceipt(input.source, { graphLayout: { backend: job.backend, fallback: 'none' }, onConfigDiagnostic: () => {} })
        const encoded = Buffer.from(artifact.svg, 'utf8'), receipt = JSON.stringify(artifact.receipt)
        bytes += encoded.length; svg.update(encoded); receipts.update(receipt)
        outcomes.push({ id: input.id, ok: true })
      } catch (error) { outcomes.push({ id: input.id, ok: false, error: String(error) }) }
    }
    const after = cacheProbeSnapshot()
    phases.push({ phase, before, after, canonicalBefore, canonicalAfter: job.observeCaches ? cacheObservationSnapshot() : null,
      bytes, svgSha256: svg.digest('hex'), receiptSha256: receipts.digest('hex'), outcomes })
  }
  return phases
}
const phases = job.observeCaches ? withCacheProbeObservations(collect) : collect()
writeFileSync(job.out, `${JSON.stringify({ protocol: 'source-cache-layer-counts@1', runtime: { bun: Bun.version, node: process.versions.node }, phases,
  limitations: 'Source-only evaluator instrumentation. No timing, allocation, peak or release-benchmark claim. Source/control output equivalence is checked by the parent.' }, null, 2)}\n`)
