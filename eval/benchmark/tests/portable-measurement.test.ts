import { afterEach, expect, test } from 'bun:test'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { portableSummary } from '../portable/report.ts'
import { calibrate } from '../portable/statistics.ts'
import { modelCost, processCpuCost } from '../portable/costs.ts'
import { resetPortableCancellation, runFirstUseBatch, runSerialJob, terminatePortableWorkers } from '../portable/execution.ts'
import { portableDirectory } from '../portable/artifacts.ts'
import { parsePortableOptions } from '../portable/run.ts'
import { readProjectBenchmarkRecord } from '../portable/project-records.ts'
import { pathToFileURL } from 'node:url'
import type { PortableJob, PortableWorkerResult } from '../portable/protocol.ts'

const directories: string[] = []
afterEach(() => {
  resetPortableCancellation()
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true })
})
const stableRounds = () => Array.from({ length: 5 }, (_, index) => ({ round: index + 1, A0: Array(31).fill(10) as number[], A1: Array(31).fill(10) as number[], B: Array(31).fill(10) as number[] }))
test('sampling and independent A/A noise govern calibration rather than successful process exit', () => {
  expect(calibrate(stableRounds(), 31).status).toBe('calibrated')
  expect(calibrate(stableRounds().slice(0, 3), 31).status).toBe('uncalibrated')
  const missing = stableRounds()
  missing[2]!.A1.pop()
  expect(calibrate(missing, 31).status).toBe('uncalibrated')
  const duplicate = stableRounds()
  duplicate[4]!.round = 1
  expect(calibrate(duplicate, 31).status).toBe('uncalibrated')
  const noisy = stableRounds()
  noisy[1]!.A1 = Array(31).fill(20) as number[]
  expect(calibrate(noisy, 31).status).toBe('uncalibrated')
})
test('missing provider evidence and censored zero CPU counters never become free observed work', () => {
  expect(modelCost().dollars).toBeNull()
  const censored = processCpuCost(0, 0, 1)
  expect(censored.status).toBe('below-counter-resolution')
  expect(censored.dollars).toBeNull()
  expect(censored.upperDollars).toBeGreaterThan(0)
  expect(() => processCpuCost(-1, 0)).toThrow()
  expect(
    modelCost({ provider: 'fixture-provider', model: 'fixture-model', transcript: 'observed-transcript', measuredAt: '2026-10-25T00:00:00Z', inputTokens: 1000, outputTokens: 500, price: { observedAt: '2026-10-25T00:00:00Z', source: 'dated fixture price', inputPerMillionUsd: 2, outputPerMillionUsd: 4 } }).dollars,
  ).toBe(0.004)
})
test('portable CLI keeps insufficient sampling explicit and rejects ambiguous selection', () => {
  const options = parsePortableOptions(['--project', 'owner/tool', '--artifact-root', '/tmp/tool', '--rounds', '1'])
  expect(options.rounds).toBe(1)
  expect(options.samples).toBe(31)
  expect(() => parsePortableOptions(['--project', 'owner/tool', '--project', 'other/tool', '--artifact-root', '/tmp/tool'])).toThrow('Duplicate')
  expect(() => parsePortableOptions(['--project', 'owner/tool', '--artifact-root', '/tmp/tool', '--cohort', 'family,family'])).toThrow('repeated')
})
test('prepared fresh processes execute first-use API windows serially', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'portable-api-barrier-'))
  directories.push(directory)
  const root = join(directory, 'api')
  mkdirSync(root)
  writeFileSync(join(root, 'package.json'), '{"name":"portable-barrier-fixture","version":"1.0.0","type":"module"}')
  const entry = join(root, 'index.mjs')
  writeFileSync(entry, 'export function render(){Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20);return {svg:\'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><text x="1" y="20">Visible</text></svg>\'}}')
  const node = execFileSync(process.env.NODE_BIN ?? 'node', ['-p', 'process.execPath'], { encoding: 'utf8' }).trim()
  const jobs: PortableJob[] = [0, 1].map(sample => ({
    artifact: { project: 'fixture/api', root, entry, version: '1.0.0', adapter: 'pele' },
    testCase: { id: 'fixture:barrier', family: 'flowchart', cohort: 'adversarial', source: 'flowchart LR\nA[Visible]', expected: { accept: true, labels: ['Visible'] } },
    mode: 'cold',
    samples: 1,
    round: 1,
    replica: 'B',
    sample,
    resultFile: join(directory, `sample-${sample}.json`),
  }))
  const results = await runFirstUseBatch(jobs, node, 2)
  expect(results).toHaveLength(2)
  expect(results.every(result => result.apiWindow && result.tracks['first-use']?.length === 1)).toBe(true)
  expect(BigInt(results[1]!.apiWindow!.startNs) >= BigInt(results[0]!.apiWindow!.endNs)).toBe(true)
  expect(results.every(result => result.tracks['first-use']![0]! >= 18)).toBe(true)
  expect(readdirSync(directory)).toEqual(['api'])
}, 30_000)

function workerFixture(body: string) {
  const directory = mkdtempSync(join(tmpdir(), 'portable-worker-invariant-'))
  directories.push(directory)
  const entry = join(directory, 'index.mjs')
  writeFileSync(join(directory, 'package.json'), '{"name":"portable-invariant-fixture","version":"1.0.0","type":"module"}')
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><text x="1" y="20">Visible</text></svg>'
  writeFileSync(entry, `const good=${JSON.stringify(svg)};let calls=0;${body}`)
  const node = execFileSync(process.env.NODE_BIN ?? 'node', ['-p', 'process.execPath'], { encoding: 'utf8' }).trim()
  const job = (mode: PortableJob['mode'], suffix: string = mode): PortableJob => ({
    artifact: { project: 'fixture/api', root: directory, entry, version: '1.0.0', adapter: 'pele' },
    testCase: { id: 'fixture:invariant', family: 'flowchart', cohort: 'adversarial', source: 'flowchart LR\nA[Visible]', expected: { accept: true, labels: ['Visible'] } },
    mode,
    samples: 2,
    minSampleMs: 0,
    round: 1,
    replica: 'B',
    sample: 0,
    resultFile: join(directory, suffix + '.json'),
    fullEvidence: true,
  })
  return { node, job, directory }
}
test('a failed memory-measured call is not hidden by later successful qualification', async () => {
  const f = workerFixture('export function render(){if(++calls===1)throw Error("first-call fault");return {svg:good}}')
  const result = await runSerialJob(f.job('memory'), f.node)
  expect(result.status).toBe('failed')
  expect(result.error).toContain('Memory-measured invocation')
  expect(result.outputBytes).toBe(0)
})
test('retention captures intermediate faults and warm timing rejects transient bad SVG', async () => {
  const retention = workerFixture('export function render(){if(++calls===17)throw Error("middle fault");return {svg:good}}')
  const resource = await runSerialJob(retention.job('retention'), retention.node)
  expect(resource.status).toBe('failed')
  expect(resource.error).toContain('Retention invocation17')
  const warm = workerFixture('export function render(){return {svg:++calls===2?good.replace("Visible","Wrong"):good}}')
  expect((await runSerialJob(warm.job('warm'), warm.node)).status).toBe('failed')
})
test('a valid result followed by failed worker cleanup never qualifies', async () => {
  const f = workerFixture('export function render(){setImmediate(()=>{process.exitCode=1});return {svg:good}}')
  await expect(runSerialJob(f.job('warm'), f.node)).rejects.toThrow('lifecycle')
  await expect(runFirstUseBatch([f.job('cold')], f.node, 1)).rejects.toThrow('lifecycle')
})
test('cancellation aborts the current worker and latches against subsequent launches', async () => {
  const f = workerFixture('export async function render(){await new Promise(resolve=>setTimeout(resolve,2000));return {svg:good}}')
  const timer = setTimeout(terminatePortableWorkers, 80)
  try {
    await expect(runSerialJob(f.job('warm'), f.node)).rejects.toThrow('cancelled')
    await expect(runSerialJob(f.job('cold', 'not-launched'), f.node)).rejects.toThrow('cancelled')
  } finally {
    clearTimeout(timer)
  }
})
test('the direct worker entry rejects CI before reading a job or loading a target', () => {
  const f = workerFixture('export function render(){return {svg:good}}')
  const result = spawnSync(f.node, [join(portableDirectory, 'worker.mjs'), join(f.directory, 'does-not-exist.json')], { encoding: 'utf8', env: { ...process.env, CI: 'true' }, timeout: 10_000 })
  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain('Benchmarks are excluded from CI')
})

test('missing execution never becomes a vacuous acceptance or semantic pass', () => {
  const summary = portableSummary([{ id: 'unexecuted', family: 'flowchart', cohort: 'family', source: 'flowchart LR\nA', expected: { accept: true, labels: ['A'] } }], [], { rounds: 5, samples: 31, coldSamples: 20, maximumControlSpread: 0.25 })
  expect(summary.status).toBe('uncalibrated')
  expect(summary.cases[0]!.acceptanceMatches).toBe(false)
  expect(summary.cases[0]!.semanticComplete).toBe(false)
  expect(summary.timing.every(row => !row.semanticComplete && row.calibration.status === 'uncalibrated')).toBe(true)
  expect(summary.counts.completeSemanticCases).toBe(0)
})

test('duplicated fresh-process identities cannot replace missing samples', () => {
  const cases = [{ id: 'identity-grid', family: 'flowchart', cohort: 'family' as const, source: 'flowchart LR\nA', expected: { accept: true, labels: ['A'] } }]
  const results: PortableWorkerResult[] = []
  for (let round = 1; round <= 5; round++)
    for (const replica of ['A0', 'A1', 'B'] as const)
      for (const mode of ['warm', 'cold'] as const)
        for (let sample = 0; sample < (mode === 'cold' ? 20 : 1); sample++)
          results.push({ protocol: 'portable-svg-processes-v1', caseId: 'identity-grid', family: 'flowchart', mode, round, replica, sample, status: 'passed', importMs: 1, tracks: mode === 'cold' ? { 'first-use': [1] } : { 'warm-repeat': Array(31).fill(1), 'warm-new-source': Array(31).fill(1) }, outputBytes: 40, qualification: { accepted: true, passed: true, semanticComplete: true, checks: [], unmeasuredScopes: [], scope: 'fixture declared criteria' }, prelude: [], runtime: { executable: '/fixture/node', node: '24', platform: 'linux', arch: 'x64' } })
  const settings = { rounds: 5, samples: 31, coldSamples: 20, maximumControlSpread: 0.25 }
  expect(portableSummary(cases, results, settings).status).toBe('measured')
  expect(() => portableSummary(cases, [{ ...results[0]!, protocol: 'portable-svg-processes-v2' }, ...results.slice(1)], settings)).toThrow('protocol')
  const first = results.find(result => result.mode === 'cold')!
  const missing = results.findIndex(result => result.mode === 'cold' && result.sample === 19)
  results[missing] = { ...first }
  const incomplete = portableSummary(cases, results, settings)
  expect(incomplete.status).toBe('uncalibrated')
  expect(incomplete.cases[0]!.acceptanceMatches).toBe(false)
  expect(incomplete.cases[0]!.semanticComplete).toBe(false)
})


test('dedicated result pipe retains large Unicode errors despite renderer stdout noise', async () => {
  const f = workerFixture('export function render(){console.log("unrelated renderer output");throw Error("λ漢".repeat(40000)+"error-end")}')
  const result = await runSerialJob(f.job('cold'), f.node)
  expect(result.status).toBe('failed')
  const payload = JSON.stringify(result)
  expect(payload).toContain('λ漢λ漢')
  expect(payload).toContain('error-end')
  expect(payload).not.toContain('\ufffd')
  expect(readdirSync(f.directory).sort()).toEqual(['index.mjs', 'package.json'])
})

test('resource counters use a terminal observer frame without per-worker files', async () => {
  const f = workerFixture('export function render(){return {svg:good}}')
  const observer = join(f.directory, 'observer.mjs')
  writeFileSync(observer, `#!/usr/bin/env node
import{spawn}from'node:child_process';const args=process.argv.slice(2),at=args.indexOf('--')+1;const child=spawn(args[at],args.slice(at+1),{stdio:['inherit','inherit','inherit','inherit']});child.once('close',code=>{process.stderr.write('renderer diagnostic\\nTRIDENT_RESOURCE 0.25 0.5 2048\\n');process.exitCode=code??1})`)
  chmodSync(observer, 0o755)
  const result = await runSerialJob(f.job('memory'), f.node, observer)
  expect(result.resource).toMatchObject({ userSeconds: .25, systemSeconds: .5, peakRssBytes: 2097152 })
  expect(readdirSync(f.directory).sort()).toEqual(['index.mjs', 'observer.mjs', 'package.json'])
  writeFileSync(observer, readFileSync(observer, 'utf8').replace('0.25 0.5 2048', 'NaN 0.5 2048'))
  await expect(runSerialJob(f.job('memory', 'bad-observer'), f.node, observer)).rejects.toThrow('GNU time')
})

test('an import failure retains its terminal blocked payload without first-use credit', async () => {
  const f = workerFixture('throw Error("backend-unavailable-at-import")')
  await expect(runFirstUseBatch([f.job('cold')], f.node, 1)).rejects.toThrow('blocked before readiness')
  const evidence = JSON.parse(readFileSync(join(f.directory, 'cold.json.failure.json'), 'utf8'))
  expect(evidence.result.status).toBe('blocked')
  expect(evidence.result.error).toContain('backend-unavailable-at-import')
  expect(evidence.result.apiWindow).toBeUndefined()
  expect(evidence.result.tracks).toEqual({})
})

test('a later cold worker cleanup failure does not lose earlier completed worker evidence', async () => {
  const f = workerFixture('export function render(source){if(source.includes("cleanup-failure"))setImmediate(()=>{process.exitCode=1});return {svg:good}}')
  const first = f.job('cold', 'first'), second = { ...f.job('cold', 'second'), sample: 1, testCase: { ...f.job('cold').testCase, source: 'flowchart LR\nA[Visible]\n%% cleanup-failure' } }
  const retained: PortableWorkerResult[] = []
  await expect(runFirstUseBatch([first, second], f.node, 2, result => retained.push(result))).rejects.toThrow('lifecycle')
  expect(retained).toHaveLength(1)
  expect(retained[0]).toMatchObject({ sample: 0, status: 'partial' })
  expect(retained[0]!.tracks['first-use']).toHaveLength(1)
  expect(existsSync(join(f.directory, 'second.json.failure.json'))).toBe(true)
})

test('unserializable jobs are rejected before any serial or batch worker can be left alive', async () => {
  const f = workerFixture('export function render(){return {svg:good}}')
  const invalid = { ...f.job('cold'), testCase: { ...f.job('cold').testCase, renderOptions: { invalid: 1n } } }
  await expect(runSerialJob(invalid as any, f.node)).rejects.toThrow()
  expect(() => resetPortableCancellation()).not.toThrow()
  await expect(runFirstUseBatch([f.job('cold', 'valid'), invalid as any], f.node, 2)).rejects.toThrow()
  expect(() => resetPortableCancellation()).not.toThrow()
  expect(readdirSync(f.directory).sort()).toEqual(['index.mjs', 'package.json'])
})

test('a family whose canonical source the renderer rejects is unsupported and none of its cases run', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'portable-family-support-'))
  directories.push(directory)
  const tool = join(directory, 'tool'), calls = join(directory, 'calls.txt')
  mkdirSync(tool)
  writeFileSync(join(tool, 'package.json'), '{"name":"family-support-fixture","version":"1.0.0","type":"module"}')
  writeFileSync(join(tool, 'index.mjs'), `import{appendFileSync}from'node:fs';export function render(source){appendFileSync(${JSON.stringify(calls)},source.split('\\n')[0]+'\\n');if(!source.startsWith('flowchart'))throw Error('Invalid mermaid header');return{svg:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><text>Alpha Beta Gamma</text></svg>'}}`)
  // The compiled kit measures without Git; the source runner requires committed protocol files.
  const kit = join(directory, 'kit')
  execFileSync(process.execPath, [join(portableDirectory, 'build.ts'), '--out', kit], { stdio: 'ignore' })
  const { runPortable } = await import(pathToFileURL(join(kit, 'run.mjs')).href)
  const options = parsePortableOptions(['--project', 'fixture/family-support', '--artifact-root', tool, '--entry', 'index.mjs', '--cohort', 'family', '--rounds', '1', '--samples', '1', '--cold-samples', '1', '--min-sample-ms', '0', '--preparation-concurrency', '1', '--out', join(directory, 'out'), '--records', join(directory, 'records'), '--allow-partial'])
  const report = await runPortable({ ...options, observer: undefined })
  if (!('summary' in report)) throw Error('Expected a measured report')
  const families: string[] = report.summary.familyTimings.map((row: { family: string }) => row.family)
  expect(report.summary.counts.unsupportedFamilies).toEqual(families.filter((family: string) => family !== 'flowchart'))
  expect(report.summary.status).not.toBe('failed')
  // Each rejected family's source reached the renderer once, as its probe; no measured case ran.
  const rejectedCalls = readFileSync(calls, 'utf8').split('\n').filter(line => line && !line.startsWith('flowchart'))
  expect(rejectedCalls).toHaveLength(families.length - 1)
  const record = readProjectBenchmarkRecord(join(report.evidenceDirectory, 'result.json.gz'))
  const pie = record.observations.filter(row => row.family === 'pie')
  expect(pie.map(row => [row.operation, row.status])).toEqual([['family-support', 'unsupported'], ['render', 'unsupported']])
  expect(pie[1]!.detail).toContain('Invalid mermaid header')
  expect(record.observations.filter(row => row.family === 'flowchart' && row.operation === 'family-support').map(row => row.status)).toEqual(['passed'])
}, 60_000)
