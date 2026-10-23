import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { GCProfiler, getHeapStatistics } from 'node:v8'
import { fixtures, sourceFor } from './fixtures.mjs'

const job = JSON.parse(readFileSync(process.argv[2], 'utf8'))
if (!['0', '1'].includes(process.env.AGENTIC_MERMAID_ELK_CACHE)) throw Error('Explicit cache policy required')
const hash = x => createHash('sha256').update(x).digest('hex')
const median = xs => { const a = [...xs].sort((a,b) => a-b); return a.length % 2 ? a[a.length >> 1] : (a[(a.length >> 1)-1]+a[a.length >> 1])/2 }
const startedAt = new Date().toISOString()
const importStart = performance.now()
const api = await import(pathToFileURL(join(job.packageRoot, 'dist/index.js')).href)
const importMs = performance.now() - importStart
let sink = 0
const encode = new TextEncoder()
const call = (source, endpoint) => {
  try {
    const value = endpoint === 'svg' ? api.renderMermaidSVG(source) : api.renderMermaidSVGWithReceipt(source)
    const text = endpoint === 'svg' ? value : value.svg
    // Match maintained consumedCase: encode SVG and serialize full receipt.
    const encoded = encode.encode(text)
    const receiptText = endpoint === 'receipt' ? JSON.stringify(value.receipt) : undefined
    sink = (sink + encoded.length + (encoded[encoded.length - 1] ?? 0) + (receiptText?.length ?? 0)) >>> 0
    return { ok: true, text, encoded, receiptText }
  } catch (error) {
    // Refusals are recorded and compared; never counted as render speedups.
    return { ok: false, error: { name: error?.name, message: String(error?.message ?? error), code: error?.code } }
  }
}
function fingerprint(result, endpoint) {
  if (!result.ok) return { ok: false, error: result.error, sha256: hash(JSON.stringify(result.error)) }
  const out = { ok: true, bytes: result.encoded.length, sha256: hash(result.encoded) }
  const svg = result.text
  if (typeof svg !== 'string' || !svg.includes('<svg')) throw Error('Missing SVG in successful public output')
  out.svgSha256 = hash(Buffer.from(svg, 'utf8'))
  if (endpoint === 'receipt') {
    const receipt = JSON.parse(result.receiptText)
    if (!receipt || typeof receipt.requestDigest !== 'string') throw Error('Missing public receipt')
    out.receiptSha256 = hash(result.receiptText)
    out.receiptBytes = Buffer.byteLength(result.receiptText)
  }
  return out
}
// Maintained eval/benchmark/bench-stats.ts allocationProbe estimator, copied
// without a source-package import so only packed code is under measurement.
async function allocated(run) {
  if (typeof GCProfiler !== 'function' || typeof global.gc !== 'function') throw Error('Allocation mode needs Node GCProfiler and --expose-gc')
  global.gc()
  const profiler = new GCProfiler()
  const start = getHeapStatistics().used_heap_size
  profiler.start()
  await run()
  const end = getHeapStatistics().used_heap_size
  const statistics = profiler.stop()?.statistics ?? []
  let bytes = 0, previous = start
  for (const gc of statistics) { bytes += Math.max(0, gc.beforeGC.heapStatistics.usedHeapSize - previous); previous = gc.afterGC.heapStatistics.usedHeapSize }
  return { bytes: bytes + Math.max(0, end - previous), gcCount: statistics.length, startUsedHeap: start, endUsedHeap: end }
}
const selectedFixtures = job.caseIds === undefined ? fixtures : fixtures.filter(fixture => job.caseIds.includes(fixture.id))
const rows = []
for (const fixture of selectedFixtures) for (const endpoint of ['svg', 'receipt']) for (const regime of job.regimes) {
  if (regime === 'new-source' && fixture.variant === false) continue
  const row = { id: `${fixture.id}/${endpoint}/${regime}`, fixture: fixture.id, endpoint, regime, samples: [] }
  try {
    const source = sourceFor(fixture, 'oracle')
    row.oracle = fingerprint(call(source, endpoint), endpoint)
    row.oracleAgain = fingerprint(call(source, endpoint), endpoint)
    row.deterministic = JSON.stringify(row.oracle) === JSON.stringify(row.oracleAgain)
    if (!row.deterministic) throw Error('Untimed public output is nondeterministic')
    if (!row.oracle.ok) { row.status = 'refusal'; rows.push(row); continue }
    // Warmups have disjoint tokens from oracle/timed/allocation samples. A label
    // token changes the model even in cache-on mode; comments alone would not.
    const warmStart = performance.now()
    let warm = 0
    while (warm < job.warmupCalls || performance.now() - warmStart < job.warmupMs) {
      const token = regime === 'repeat' ? 'repeat' : `w${endpoint[0]}${String(warm).padStart(6, '0')}`
      const result = call(sourceFor(fixture, token), endpoint)
      if (!result.ok) throw Error(`Warmup refused: ${JSON.stringify(result.error)}`)
      warm++
    }
    row.warmupCalls = warm
    if (job.mode === 'time') {
      for (let sample = 0; sample < job.samples; sample++) {
        const token = regime === 'repeat' ? 'repeat' : `t${endpoint[0]}${String(sample).padStart(6, '0')}`
        const measuredSource = sourceFor(fixture, token)
        const start = performance.now()
        const result = call(measuredSource, endpoint)
        const ms = performance.now() - start
        // The complete output/receipt hashes are outside the clock.
        const output = fingerprint(result, endpoint)
        if (!output.ok) throw Error(`Timed render refused: ${JSON.stringify(output.error)}`)
        row.samples.push({ sample, token, ms, output })
      }
      row.medianMs = median(row.samples.map(x => x.ms))
    } else {
      for (let sample = 0; sample < job.allocationSamples; sample++) {
        const token = regime === 'repeat' ? 'repeat' : `a${endpoint[0]}${String(sample).padStart(6, '0')}`
        const measuredSource = sourceFor(fixture, token)
        let result
        const observation = await allocated(() => { result = call(measuredSource, endpoint) })
        const output = fingerprint(result, endpoint)
        if (!output.ok) throw Error(`Allocation render refused: ${JSON.stringify(output.error)}`)
        row.samples.push({ sample, token, ...observation, output })
        result = undefined
      }
      row.medianAllocatedBytes = median(row.samples.map(x => x.bytes))
    }
    row.finalOracle = fingerprint(call(source, endpoint), endpoint)
    if (JSON.stringify(row.oracle) !== JSON.stringify(row.finalOracle)) throw Error('Output changed after churn')
    row.status = 'ok'
  } catch (error) { row.status = 'failure'; row.error = String(error?.stack ?? error) }
  rows.push(row)
}
writeFileSync(job.out, JSON.stringify({ schemaVersion: 1, startedAt, finishedAt: new Date().toISOString(), job, runtime: process.versions, cache: process.env.AGENTIC_MERMAID_ELK_CACHE, assertions: process.env.AGENTIC_MERMAID_SCENE_ASSERTIONS, experiments: process.env.AGENTIC_MERMAID_EXPERIMENTS ?? '(absent: production defaults)', importMs, sink, maxRssKiB: process.resourceUsage().maxRSS, finalMemory: process.memoryUsage(), rows }, null, 2))
if (rows.some(row => row.status === 'failure')) process.exitCode = 1
