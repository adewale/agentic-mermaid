import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import type { PreparedCommunity } from './community-types.ts'
import type { BenchmarkObservation, UnifiedRunOptions, UnifiedWorkload } from './types.ts'
import { assertCommunityNotInterrupted, trackCommunityProcess } from './community-process.ts'

/** Native worker API clocks stay separate from cold CLI process clocks. */
export async function runExternalCommunity(prepared: PreparedCommunity, workloads: UnifiedWorkload[], output: string, round: number, options: UnifiedRunOptions): Promise<BenchmarkObservation[]> {
  const rows: BenchmarkObservation[] = [],
    root = join(options.out, 'community-raw')
  mkdirSync(root, { recursive: true })
  for (const core of [true, false]) {
    const selected = workloads.filter(w => w.features.includes('core-graph-batch') === core)
    if (!selected.length) continue
    const name = prepared.node.id.replace(/[^a-z0-9._-]/gi, '_') + `-${output}-r${round}-${core ? 'core' : 'features'}`,
      artifact = prepared.artifact!,
      results = new Map<string, Record<string, unknown>>(),
      attempts: unknown[] = []
    let remaining = selected,
      lastDetail: string | undefined
    for (let attempt = 1; remaining.length && attempt <= 8; attempt++) {
      lastDetail = undefined
      const stem = name + `-a${attempt}`,
        job = join(root, stem + '.job.json'),
        result = join(root, stem + '.jsonl')
      if (existsSync(result)) unlinkSync(result)
      writeFileSync(job, JSON.stringify({ output, coverageOnly: !core && (options.communityCoverageOnce ?? true), timing: { warmCalls: core ? 3 : 1, warmupMs: core ? 50 : 0, minSampleMs: core ? 10 : 0, maxCaseMs: 10_000, samples: core ? 5 : 3 }, workloads: remaining.map(w => ({ id: w.id, source: w.source, expected: w.expectedLabels ?? [] })) }))
      const command = artifact.kind === 'python' ? [artifact.python ?? artifact.executable!, join(dirname(fileURLToPath(import.meta.url)), 'community-python-worker.py'), job, result] : [artifact.executable!, job, result]
      let text = '',
        stderr = '',
        progressCount = 0,
        lastProgress = performance.now(),
        timedOut = false
      const readProgress = () => {
        if (!existsSync(result)) return
        const lines = readFileSync(result, 'utf8').split('\n')
        // The last line may still be in flight. Only newline-complete records count.
        lines.pop()
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const value = JSON.parse(line) as Record<string, unknown>
            if (remaining.some(workload => workload.id === value.workload)) results.set(value.workload as string, { ...value, workerAttempt: attempt })
          } catch {
            /* A malformed completed record cannot qualify a case. */
          }
        }
        const count = remaining.filter(workload => results.has(workload.id)).length
        if (count !== progressCount) {
          progressCount = count
          lastProgress = performance.now()
        }
      }
      assertCommunityNotInterrupted()
      const child = spawn(command[0]!, command.slice(1), { detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] })
      trackCommunityProcess(child)
      child.stdout?.on('data', chunk => {
        text = (text + String(chunk)).slice(-2_000_000)
      })
      child.stderr?.on('data', chunk => {
        stderr = (stderr + String(chunk)).slice(-2_000_000)
      })
      const monitor = setInterval(() => {
        readProgress()
        const limit = progressCount === remaining.length ? 10_000 : progressCount ? 30_000 : 120_000
        if (performance.now() - lastProgress <= limit) return
        timedOut = true
        lastDetail = `External worker made no completed-case progress for ${limit}ms`
        try {
          if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL')
          else child.kill('SIGKILL')
        } catch {}
      }, 100)
      const code = await new Promise<number | null>(done => {
        child.once('error', error => {
          lastDetail = String(error)
        })
        child.once('close', done)
      })
      clearInterval(monitor)
      readProgress()
      writeFileSync(join(root, stem + '.log'), text + stderr)
      attempts.push({ attempt, code, timedOut, completedCases: progressCount, detail: lastDetail })
      const unresolved = remaining.filter(workload => !results.has(workload.id))
      if (!unresolved.length) {
        remaining = []
        break
      }
      if (code === 0) {
        lastDetail ??= 'Worker exited without reporting all cases'
        remaining = unresolved
        break
      }
      // Workers process the supplied inputs in order; retain completed JSONL and
      // assign the stopped current case before restarting untouched cases.
      const stopped = unresolved[0]!
      results.set(stopped.id, { status: 'error', detail: lastDetail ?? `Worker stopped during this case (exit ${code}): ${stderr.slice(-1500)}`, workerAttempt: attempt })
      remaining = unresolved.slice(1)
    }
    writeFileSync(join(root, name + '-attempts.json'), JSON.stringify(attempts, null, 2))
    for (const w of selected) {
      const r = results.get(w.id),
        status = r?.status === 'ok' || r?.status === 'passed' ? 'passed' : r?.status === 'unsupported' ? 'unsupported' : r ? 'failed' : 'blocked'
      rows.push({
        suite: 'community',
        surface: artifact.kind === 'python' ? 'python:public-api' : 'native:in-process-api',
        runtime: artifact.runtime ?? artifact.kind,
        family: w.family,
        caseId: w.id,
        operation: 'render',
        format: output,
        mode: core ? 'core-api-repeat' : (options.communityCoverageOnce ?? true) ? 'feature-corpus-qualification' : 'feature-corpus-attempt',
        status,
        samplesMs: !core && (options.communityCoverageOnce ?? true) ? undefined : r?.samplesMs as number[] | undefined,
        bytes: r?.outputBytes as number | undefined,
        detail: (r?.detail as string | undefined) ?? lastDetail ?? (remaining.length ? 'External worker restart limit exhausted; completed rows are retained' : undefined),
        metrics: {
          implementation: prepared.node.id,
          version: artifact.version,
          round,
          workerAttempt: (r?.workerAttempt as number) ?? null,
          firstMs: (r?.firstMs as number) ?? null,
          qualification: w.expectedLabels?.length ? 'declared-labels' : 'artifact-envelope-only',
          boundary: 'native public API; executable startup excluded',
        },
      })
    }
  }
  return rows
}
