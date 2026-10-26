import { StringDecoder } from 'node:string_decoder'
import { fork, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { portableDirectory } from './artifacts.ts'
import { PORTABLE_MEASUREMENT_PROTOCOL, type PortableArtifact, type PortableJob, type PortableWorkerResult, type Replica } from './protocol.ts'
import type { PortableCase } from './cohorts.ts'
import type { PortableOptions } from './run.ts'

const active = new Set<ChildProcess>()
let cancelled = false
export class PortableCancelled extends Error {
  constructor() {
    super('Portable benchmark cancelled; no completed record is published')
    this.name = 'PortableCancelled'
  }
}
export function resetPortableCancellation() {
  if (active.size) throw Error('A portable campaign is already active')
  cancelled = false
}
export function assertPortableRunning() {
  if (cancelled) throw new PortableCancelled()
}
function kill(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return
  try {
    if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL')
    else child.kill('SIGKILL')
  } catch {}
}
export function terminatePortableWorkers() {
  cancelled = true
  for (const child of active) kill(child)
}
function validateResult(job: PortableJob, result: PortableWorkerResult) {
  if (result.protocol !== PORTABLE_MEASUREMENT_PROTOCOL || result.caseId !== job.testCase.id || result.mode !== job.mode || result.round !== job.round || result.replica !== job.replica || result.sample !== job.sample || !['passed', 'partial', 'failed', 'blocked'].includes(result.status))
    throw Error('Worker evidence does not match the declared job')
  return result
}
function failureEvidence(job: PortableJob, error: unknown, diagnostics: string, result?: PortableWorkerResult) {
  const file = job.diagnosticFile ?? (job.resultFile ? job.resultFile + '.failure.json' : undefined)
  if (!file || existsSync(file)) return
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify({ job, error: String(error), diagnostics, result }) + '\n', { flag: 'wx' })
  } catch (failure) { if (error instanceof Error) error.message += '; Could not retain worker diagnostic: ' + String(failure) }
}
function assertExit(result: PortableWorkerResult, code: number | null, signal: NodeJS.Signals | null) {
  assertPortableRunning()
  if (signal || code !== (result.status === 'blocked' ? 2 : 0)) throw Error(`Worker lifecycle failed after reporting${result.status}: exit${code}, signal${signal}`)
}
export async function runSerialJob(job: PortableJob, node: string, observer?: string): Promise<PortableWorkerResult> {
  assertPortableRunning()
  const input = JSON.stringify(job)
  const args = ['--expose-gc', join(portableDirectory, 'worker.mjs'), '--stdio']
  // GNU time writes its counters after the child exits. Frame that final stderr
  // suffix rather than reopening a Node socket through /dev/fd (which fails on
  // Linux). The worker's result still has its own descriptor, independent of
  // renderer stdout/stderr. No resource files are needed.
  const child = spawn(observer ?? node, observer ? ['-f', '\nTRIDENT_RESOURCE %U %S %M', '--', node, ...args] : args, { detached: process.platform !== 'win32', stdio: ['pipe', 'ignore', 'pipe', 'pipe'] })
  active.add(child)
  const decoder = new StringDecoder('utf8')
  let diagnostics = '', payload = '', payloadBytes = 0, transportError: Error | undefined
  child.stderr?.on('data', data => { diagnostics = (diagnostics + String(data)).slice(-2000) })
  child.stdio[3]?.on('data', (data: Buffer) => { payload += decoder.write(data); payloadBytes += data.length; if (payloadBytes > 64 * 1024 * 1024) { transportError = Error('Worker evidence exceeded64MiB'); kill(child) } })
  child.stdin?.on('error', error => { transportError ??= error })
  child.stdin?.end(input)
  let result: PortableWorkerResult | undefined
  try {
    const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      const timeout = setTimeout(() => { kill(child); reject(Error('Fresh worker exceeded60seconds')) }, 60_000)
      child.once('error', error => { clearTimeout(timeout); active.delete(child); reject(error) })
      child.once('close', (code, signal) => { clearTimeout(timeout); active.delete(child); resolve({ code, signal }) })
    })
    assertPortableRunning()
    if (transportError) throw transportError
    payload += decoder.end()
    if (!payload) throw Error('Fresh worker failed without completed evidence: ' + diagnostics)
    result = validateResult(job, JSON.parse(payload))
    assertExit(result, exit.code, exit.signal)
    if (observer) {
      const counters = /\nTRIDENT_RESOURCE ([^\s]+) ([^\s]+) ([^\s]+)\n$/.exec(diagnostics)
      const values = counters?.slice(1).map(Number)
      if (exit.code !== 0 || !values || values.some(value => !Number.isFinite(value) || value < 0)) throw Error('Invalid GNU time child evidence')
      result.resource = { userSeconds: values[0]!, systemSeconds: values[1]!, peakRssBytes: values[2]! * 1024, scope: 'Whole fresh process, including import, driver, GC and post-snapshot qualification; not an API-only allocation peak.' }
    }
    return result
  } catch (error) { failureEvidence(job, error, diagnostics, result); throw error }
}
/** Imports may overlap; all timed API calls wait behind a complete idle barrier.
 * Dedicated IPC carries jobs/results; successful workers create no disk files. */
export async function runFirstUseBatch(jobs: PortableJob[], node: string, concurrency: number, retain?: (result: PortableWorkerResult) => void): Promise<PortableWorkerResult[]> {
  assertPortableRunning()
  // Validate the entire wire batch before starting any process.
  const wireJobs = jobs.map(job => JSON.parse(JSON.stringify(job)) as PortableJob)
  const results: PortableWorkerResult[] = []
  for (let start = 0; start < wireJobs.length; start += concurrency) {
    assertPortableRunning()
    const launched: ChildProcess[] = []
    const prepare = (job: PortableJob) => {
      const child = fork(join(portableDirectory, 'worker.mjs'), ['--ipc'], { execPath: node, execArgv: ['--expose-gc'], detached: process.platform !== 'win32', stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
      active.add(child); launched.push(child)
      let diagnostics = '', ready = false, started = false, result: PortableWorkerResult | undefined, transportError: Error | undefined
      child.stderr?.on('data', data => { diagnostics = (diagnostics + String(data)).slice(-2000) })
      let resolveReady!: () => void, rejectReady!: (error: Error) => void
      const readiness = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject })
      void readiness.catch(() => {})
      let timeout = setTimeout(() => { kill(child); rejectReady(Error('First-use import barrier timed out')) }, 60_000)
      child.on('message', message => {
        const value = message as { phase?: string; result?: PortableWorkerResult }
        try {
          if (value?.phase === 'ready' && !ready && !started) { clearTimeout(timeout); ready = true; resolveReady() }
          else if (value?.phase === 'result' && !result && value.result) {
            result = validateResult(job, value.result)
            if (!started) {
              if (result.status !== 'blocked' || result.apiWindow || Object.keys(result.tracks).length) throw Error('First-use evidence arrived before its API start')
              rejectReady(Error('First-use worker blocked before readiness: ' + result.error))
            }
          } else throw Error('Invalid first-use worker message')
        } catch (error) { transportError = error as Error; rejectReady(transportError); kill(child) }
      })
      let exit!: { code: number | null; signal: NodeJS.Signals | null }
      const completion = new Promise<void>((resolve, reject) => {
        child.once('error', error => { clearTimeout(timeout); active.delete(child); rejectReady(error); reject(error) })
        child.once('close', (code, signal) => {
          exit = { code, signal }; clearTimeout(timeout); active.delete(child)
          if (!ready) rejectReady(Error('Worker exited before the first-use barrier: ' + diagnostics))
          if (transportError || signal || code === null || code > 2) reject(transportError ?? Error('First-use worker failed: ' + diagnostics))
          else resolve()
        })
      })
      void completion.catch(() => {})
      try { child.send({ phase: 'job', job }, error => { if (error) { transportError = error; rejectReady(error); kill(child) } }) } catch (error) { transportError = error as Error; rejectReady(transportError); kill(child) }
      return { child, job, readiness, completion, get result() { return result }, get exit() { return exit }, get diagnostics() { return diagnostics }, get started() { return started }, start() { started = true; timeout = setTimeout(() => kill(child), 60_000); child.send({ phase: 'start' }) } }
    }
    let prepared: ReturnType<typeof prepare>[]
    try { prepared = wireJobs.slice(start, start + concurrency).map(prepare) }
    catch (error) {
      await Promise.all(launched.map(child => new Promise<void>(resolve => { if (child.exitCode !== null || child.signalCode !== null) resolve(); else { child.once('close', () => resolve()); kill(child) } })))
      throw error
    }
    try {
      await Promise.all(prepared.map(item => item.readiness))
      for (const item of prepared) {
        assertPortableRunning(); item.start(); await item.completion
        if (!item.result) throw Error('First-use worker exited without completed evidence')
        const result = validateResult(item.job, item.result)
        assertExit(result, item.exit.code, item.exit.signal)
        results.push(result); retain?.(result)
      }
    } catch (error) {
      for (const item of prepared) kill(item.child)
      await Promise.allSettled(prepared.map(item => item.completion))
      for (const item of prepared) if (!item.started || !item.result || item.exit?.signal || item.exit?.code !== (item.result.status === 'blocked' ? 2 : 0)) failureEvidence(item.job, error, item.diagnostics, item.result)
      assertPortableRunning(); throw error
    }
  }
  return results
}

/** All timed scheduling lives beside the execution boundary, independently of reporting. */
export async function measurePortableProject(artifact: PortableArtifact, testCases: PortableCase[], options: PortableOptions, directory: string, retain: (result: PortableWorkerResult) => void) {
  const makeJob = (testCase: PortableCase, round: number, replica: Replica, mode: PortableJob['mode'], sample: number): PortableJob => {
    const stem = `${testCase.id.replaceAll(':', '_')}-${mode}-r${round}-${replica}-${sample}`
    return {
      artifact,
      testCase,
      mode,
      samples: options.samples,
      minSampleMs: options.minSampleMs,
      round,
      replica,
      sample,
      diagnosticFile: join(directory, 'failures', stem + '.json'),
      fullEvidence: mode === 'warm' && round === 1 && replica === 'B',
      ...(mode === 'warm' && round === 1 && replica === 'B' ? { svgFile: join(directory, 'svg', testCase.id.replaceAll(':', '_') + '.svg') } : {}),
    }
  }
  const order = (round: number, index: number) => {
    const values: Replica[] = ['A0', 'A1', 'B']
    const offset = (round + index) % values.length
    return [...values.slice(offset), ...values.slice(0, offset)]
  }
  for (let round = 1; round <= options.rounds; round++)
    for (const [index, testCase] of testCases.entries()) {
      for (const replica of order(round, index)) retain(await runSerialJob(makeJob(testCase, round, replica, 'warm', 0), options.node))
      console.log(JSON.stringify({ phase: 'warm', project: options.project, round, caseId: testCase.id, completedCasesInRound: index + 1 }))
    }
  for (let round = 1; round <= options.rounds; round++)
    for (const [index, testCase] of testCases.entries()) {
      for (const replica of order(round, index)) {
        const jobs = Array.from({ length: options.coldSamples }, (_, sample) => makeJob(testCase, round, replica, 'cold', sample))
        await runFirstUseBatch(jobs, options.node, options.preparationConcurrency, retain)
      }
      console.log(JSON.stringify({ phase: 'first-use', project: options.project, round, caseId: testCase.id, completedCasesInRound: index + 1 }))
    }
  const observer = options.observer
  for (let round = 1; round <= options.rounds; round++)
    for (const testCase of testCases) {
      const modes: PortableJob['mode'][] = round % 2 ? ['baseline', 'memory'] : ['memory', 'baseline']
      for (const mode of modes) retain(await runSerialJob(makeJob(testCase, round, 'B', mode, 0), options.node, observer))
      if (testCase.cohort === 'scaling' && testCase.family === 'flowchart' && testCase.scale === 8) retain(await runSerialJob(makeJob(testCase, round, 'B', 'retention', 0), options.node, observer))
      console.log(JSON.stringify({ phase: 'memory', project: options.project, round, caseId: testCase.id }))
    }
}
