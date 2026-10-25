import assert from 'node:assert/strict'
import { Session } from 'node:inspector/promises'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, statfsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { consumePeerOutput, inspectPeerSemantics } from './peer-tracks.ts'
import { missingSvgLabels } from './release-bench-fidelity.ts'
import { releaseBenchCases } from './release-bench-cases.ts'

const job = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const report = { diagnostic: true, comparative: false, status: 'starting', mode: job.mode, consumer: job.consumer, sourceRevision: job.sourceRevision, archiveSha256: job.archiveSha256, runtime: process.versions, execPath: process.execPath, execArgv: process.execArgv, settings: { elkCache: process.env.AGENTIC_MERMAID_ELK_CACHE, sceneAssertions: process.env.AGENTIC_MERMAID_SCENE_ASSERTIONS, experiments: process.env.AGENTIC_MERMAID_EXPERIMENTS ?? null }, warm: [], diagnostics: [], observations: [], profileComplete: false, errors: [] }
const sha = value => createHash('sha256').update(value).digest('hex')
const reserve = () => { for (const path of [job.reserveRoot, job.packageRoot]) { const stats = statfsSync(path); assert.ok(stats.bavail * stats.bsize >= 80 * 1024 * 1024, `${path}: reserve below80MiB`) } }
const verify = () => { for (const [file, binding] of Object.entries(job.members)) { const bytes = readFileSync(join(job.packageRoot, file)); assert.equal(bytes.length, binding.bytes, file); assert.equal(sha(bytes), binding.sha256, file) } }
let session, profilerActive = false, lastValue, lastConsumed, activeAttempt
try {
  assert.equal(process.versions.node, '24.19.0')
  assert.equal(process.env.AGENTIC_MERMAID_ELK_CACHE, '0')
  assert.equal(process.env.AGENTIC_MERMAID_SCENE_ASSERTIONS, '0')
  assert.equal(process.env.AGENTIC_MERMAID_EXPERIMENTS, undefined)
  assert.equal(typeof globalThis.gc, 'function')
  assert.ok(['cpu', 'allocation'].includes(job.mode))
  assert.ok(['svg-utf8', 'receipt-json-utf8'].includes(job.consumer))
  reserve(); verify()
  const fixture = releaseBenchCases().find(input => input.id === 'sequence:20-participants-300-messages')
  assert.ok(fixture)
  assert.equal(fixture.source, job.source)
  assert.deepEqual(fixture.expectedSvgLabels, job.expectedSvgLabels)
  report.fixture = { ...fixture, semanticAdapter: 'existing seq20 Sequence arrow grammar only; not peer cohort enrollment' }
  const api = await import(pathToFileURL(join(job.packageRoot, 'dist/index.js')).href)
  const render = job.consumer === 'svg-utf8' ? () => api.renderMermaidSVG(fixture.source) : () => api.renderMermaidSVGWithReceipt(fixture.source, {})
  const warm = Array.from({ length: 51 }, (_, index) => ({ ordinal: index + 1, domain: 'warmup' }))
  const variants = Array.from({ length: job.mode === 'cpu' ? 51 : 16 }, (_, index) => ({ ordinal: index + 1, domain: job.mode === 'cpu' ? 'profile-cpu' : 'profile-allocation' }))
  report.inputs = [...warm, ...variants, ...[1, 2].map(ordinal => ({ ordinal, domain: 'diagnostic' }))]
  const check = svg => {
    const missing = missingSvgLabels(svg, fixture.expectedSvgLabels)
    const semantic = inspectPeerSemantics(svg, { id: 'seq20', source: fixture.source, expected: fixture.expectedSvgLabels }, true)
    assert.deepEqual(missing, [])
    assert.equal(semantic.ok, true, JSON.stringify(semantic))
    return { missing, semantic }
  }
  const invoke = attempt => { activeAttempt = attempt; lastValue = render(); lastConsumed = consumePeerOutput(lastValue, job.consumer); return lastConsumed }
  const witness = () => ({ svg: lastConsumed.svg, ...(job.consumer === 'receipt-json-utf8' ? { recordJson: JSON.stringify(lastValue) } : {}), bytes: lastConsumed.bytes, checksum: lastConsumed.checksum })
  const diagnostic = ordinal => {
    const attempt = { ordinal, domain: 'diagnostic' }, events = []
    const key = Symbol.for('agentic-mermaid.performance-observer.v1'), previous = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: event => events.push({ ...event }) })
    try { const consumed = invoke(attempt); report.diagnostics.push({ ...attempt, events, ...check(consumed.svg), witness: witness() }) }
    finally { if (previous) Object.defineProperty(globalThis, key, previous); else delete globalThis[key] }
  }
  diagnostic(1)
  for (const attempt of warm) { const consumed = invoke(attempt); report.warm.push({ ...attempt, bytes: consumed.bytes, checksum: consumed.checksum, status: 'ok', ...check(consumed.svg) }) }
  const byteCounts = new Uint32Array(variants.length), checksums = new Uint32Array(variants.length)
  let attempted = 0, completed = 0
  lastValue = undefined; lastConsumed = undefined; delete globalThis.__peerTrackSink; globalThis.gc(); reserve()
  session = new Session(); session.connect()
  report.profiler = job.mode === 'cpu' ? { interval: 100 } : { samplingInterval: 32768, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true }
  if (job.mode === 'cpu') { await session.post('Profiler.enable'); await session.post('Profiler.setSamplingInterval', report.profiler); await session.post('Profiler.start') }
  else await session.post('HeapProfiler.startSampling', report.profiler)
  profilerActive = true
  try {
    for (let index = 0; index < variants.length; index++) { attempted++; const consumed = invoke(variants[index]); byteCounts[index] = consumed.bytes; checksums[index] = consumed.checksum; completed++ }
  } finally {
    const { profile } = await session.post(job.mode === 'cpu' ? 'Profiler.stop' : 'HeapProfiler.stopSampling')
    profilerActive = false; session.disconnect(); session = undefined
    const json = JSON.stringify(profile)
    writeFileSync(job.profile, json)
    report.rawProfileBytes = Buffer.byteLength(json)
    report.profileComplete = completed === variants.length
    report.attempted = attempted; report.completed = completed
    report.observations = variants.map((attempt, index) => ({ ...attempt, status: index < completed ? 'ok' : index < attempted ? 'error' : 'not-attempted', ...(index < completed ? { bytes: byteCounts[index], checksum: checksums[index] } : {}) }))
    assert.ok(report.rawProfileBytes <= 64 * 1024 * 1024, 'raw profile exceeds64MiB; preserved without replacement')
  }
  report.finalProfileWitness = witness()
  report.finalProfileValidation = check(lastConsumed.svg)
  diagnostic(2)
  verify(); reserve()
  report.status = 'completed'
} catch (error) { report.status = 'failed'; report.errors.push({ name: error.name, message: error.message, stack: error.stack, attempt: activeAttempt }) }
finally {
  if (session) { if (profilerActive) try { const { profile } = await session.post(job.mode === 'cpu' ? 'Profiler.stop' : 'HeapProfiler.stopSampling'); writeFileSync(job.profile, JSON.stringify(profile)) } catch (error) { report.errors.push({ message: String(error) }) }; session.disconnect() }
  writeFileSync(job.result, JSON.stringify(report, null, 2))
}
console.log(JSON.stringify({ status: report.status, mode: job.mode, consumer: job.consumer, warm: report.warm.length, attempted: report.attempted, completed: report.completed, diagnostics: report.diagnostics.length, errors: report.errors }))
if (report.status !== 'completed') process.exitCode = 1
