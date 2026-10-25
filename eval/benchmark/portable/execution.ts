import { fork, spawn, type ChildProcess } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { portableDirectory, readJson } from './artifacts.ts'
import type { PortableArtifact, PortableJob, PortableWorkerResult, Replica } from './protocol.ts'
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
  if (result.protocol !== 'portable-svg-processes-v1' || result.caseId !== job.testCase.id || result.mode !== job.mode || result.round !== job.round || result.replica !== job.replica || result.sample !== job.sample || !['passed', 'partial', 'failed', 'blocked'].includes(result.status))
    throw Error('Worker evidence does not match the declared job')
  return result
}
function writeJob(job: PortableJob) {
  const path = job.resultFile + '.job.json'
  writeFileSync(path, JSON.stringify(job), { flag: 'wx' })
  return path
}
function assertExit(result: PortableWorkerResult, code: number | null, signal: NodeJS.Signals | null) {
  assertPortableRunning()
  if (signal || code !== (result.status === 'blocked' ? 2 : 0)) throw Error(`Worker lifecycle failed after reporting${result.status}: exit${code}, signal${signal}`)
}
export async function runSerialJob(job: PortableJob, node: string, observer?: string): Promise<PortableWorkerResult> {
  assertPortableRunning()
  const file = writeJob(job),
    resource = job.resultFile + '.resources.txt',
    args = ['--expose-gc', join(portableDirectory, 'worker.mjs'), file]
  const child = spawn(observer ?? node, observer ? ['-f', '%U\n%S\n%M', '-o', resource, '--', node, ...args] : args, { detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] })
  active.add(child)
  let diagnostics = ''
  child.stdout?.on('data', () => {})
  child.stderr?.on('data', data => {
    diagnostics = (diagnostics + String(data)).slice(-2000)
  })
  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    const timeout = setTimeout(() => {
      kill(child)
      reject(Error('Fresh worker exceeded60seconds'))
    }, 60_000)
    child.once('error', error => {
      clearTimeout(timeout)
      active.delete(child)
      reject(error)
    })
    child.once('close', (code, signal) => {
      clearTimeout(timeout)
      active.delete(child)
      resolve({ code, signal })
    })
  })
  assertPortableRunning()
  if (!existsSync(job.resultFile)) throw Error('Fresh worker failed without completed evidence: ' + diagnostics)
  const result = validateResult(job, readJson(job.resultFile))
  assertExit(result, exit.code, exit.signal)
  if (observer) {
    const values = readFileSync(resource, 'utf8').trim().split('\n').map(Number)
    if (exit.code !== 0 || values.length !== 3 || values.some(value => !Number.isFinite(value) || value < 0)) throw Error('Invalid GNU time child evidence')
    result.resource = { userSeconds: values[0]!, systemSeconds: values[1]!, peakRssBytes: values[2]! * 1024, scope: 'Whole fresh process, including import, driver, GC and post-snapshot qualification; not an API-only allocation peak.' }
    writeFileSync(job.resultFile, JSON.stringify(result) + '\n')
  }
  return result
}
/** Imports may overlap; all timed API calls wait behind a complete idle barrier. */
export async function runFirstUseBatch(jobs: PortableJob[], node: string, concurrency: number): Promise<PortableWorkerResult[]> {
  const results: PortableWorkerResult[] = []
  for (let start = 0; start < jobs.length; start += concurrency) {
    assertPortableRunning()
    const selected = jobs.slice(start, start + concurrency)
    const prepared = selected.map(job => {
      const file = writeJob(job),
        child = fork(join(portableDirectory, 'worker.mjs'), [file], { execPath: node, execArgv: ['--expose-gc'], silent: true, detached: process.platform !== 'win32' })
      active.add(child)
      let diagnostics = '',
        ready = false
      child.stdout?.on('data', () => {})
      child.stderr?.on('data', data => {
        diagnostics = (diagnostics + String(data)).slice(-2000)
      })
      let resolveReady!: () => void, rejectReady!: (error: Error) => void
      const readiness = new Promise<void>((resolve, reject) => {
        resolveReady = resolve
        rejectReady = reject
      })
      // Attach rejection handling immediately while the rest of the batch starts.
      void readiness.catch(() => {})
      let timeout = setTimeout(() => {
        kill(child)
        rejectReady(Error('First-use import barrier timed out'))
      }, 60_000)
      child.once('message', message => {
        if ((message as { phase?: string })?.phase === 'ready') {
          clearTimeout(timeout)
          ready = true
          resolveReady()
        } else rejectReady(Error('Invalid first-use barrier'))
      })
      let exit: { code: number | null; signal: NodeJS.Signals | null }
      const completion = new Promise<void>((resolve, reject) => {
        child.once('error', reject)
        child.once('close', (code, signal) => {
          exit = { code, signal }
          clearTimeout(timeout)
          active.delete(child)
          if (!ready) rejectReady(Error('Worker exited before the first-use barrier: ' + diagnostics))
          if (signal || code === null || code > 2) reject(Error('First-use worker failed: ' + diagnostics))
          else resolve()
        })
      })
      void completion.catch(() => {})
      return {
        child,
        job,
        readiness,
        completion,
        get exit() {
          return exit
        },
        startDeadline() {
          timeout = setTimeout(() => kill(child), 60_000)
        },
      }
    })
    try {
      await Promise.all(prepared.map(item => item.readiness))
      for (const item of prepared) {
        assertPortableRunning()
        const started = performance.now()
        item.startDeadline()
        item.child.send({ phase: 'start' })
        await item.completion
        const result = validateResult(item.job, readJson(item.job.resultFile))
        assertExit(result, item.exit.code, item.exit.signal)
        appendFileSync(join(dirname(item.job.resultFile), 'barrier-order.jsonl'), JSON.stringify({ resultFile: item.job.resultFile, apiStartedAfterAllImportsReady: true, apiWindow: result.apiWindow ?? null, completeWallMs: performance.now() - started }) + '\n')
        results.push(result)
      }
    } catch (error) {
      for (const item of prepared) kill(item.child)
      await Promise.allSettled(prepared.map(item => item.completion))
      assertPortableRunning()
      throw error
    }
  }
  return results
}

/** All timed scheduling lives beside the execution boundary, independently of reporting. */
export async function measurePortableProject(artifact: PortableArtifact, testCases: PortableCase[], options: PortableOptions, directory: string, retain: (result: PortableWorkerResult) => void) {
  const raw = join(directory, 'raw')
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
      resultFile: join(raw, stem + '.json'),
      fullEvidence: mode === 'warm' && round === 1,
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
        for (const result of await runFirstUseBatch(jobs, options.node, options.preparationConcurrency)) retain(result)
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
