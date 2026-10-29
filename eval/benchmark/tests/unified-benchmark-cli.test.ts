import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { writeBenchmarkDocument } from 'trident/portable/project-records.ts'
import { parseOptions, testCounts } from '../unified/run.ts'
import { benchmarkSuites } from '../unified/suites.ts'

describe('unified benchmark CLI preflight', () => {
  test('advance-from admits a recorded target from both plain and compressed reports before checking the new candidate', async () => {
    const { main } = await import('../unified/community-campaign.ts')
    const directory = mkdtempSync(join(tmpdir(), 'trident-advance-document-'))
    try {
      for (const encoding of ['plain', 'compressed']) {
        const original = join(directory, encoding); mkdirSync(original)
        const archive = join(original, 'original-archive.bin'), bytes = Buffer.from('retained archive bytes')
        writeFileSync(archive, bytes)
        writeFileSync(join(original, 'invocation.json'), JSON.stringify({ root: original, packageRoot: join(original, 'package'), candidateTarball: archive, candidateSha256: createHash('sha256').update(bytes).digest('hex') }))
        const report = { targetRevision: 'retained-target-revision' }, path = join(original, 'report.json')
        if (encoding === 'plain') writeFileSync(path, JSON.stringify(report))
        else writeBenchmarkDocument(path, report)
        await expect(main(['--prepare-only', '--advance-from', original, '--out', join(original, 'new-run')])).rejects.toThrow('A target advance requires --package-root, --candidate-tarball and --candidate-sha256')
      }
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
  test('sums independent owning-process summaries while retaining ordinary single summaries', () => {
    expect(testCounts('\n 8 pass\n 0 fail\n 12 expect() calls\n')).toEqual({ passed: 8, failed: 0, skipped: 0, assertions: 12 })
    expect(testCounts('\u001b[32m\n 8 pass\n 0 fail\n 12 expect() calls\n\u001b[0m\n 3 pass\n 1 fail\n 2 skip\n 9 expect() calls\n')).toEqual({ passed: 11, failed: 1, skipped: 2, assertions: 21 })
    expect(testCounts('A process started without reporting any completed tests')).toBeUndefined()
  })
  test('rejects invalid execution requests before any suite can launch', () => {
    expect(() => parseOptions(['--profile', 'quick'])).toThrow('--profile')
    expect(() => parseOptions(['--rounds', '0'])).toThrow('--rounds')
    expect(() => parseOptions(['--timeout-ms', 'NaN'])).toThrow('--timeout-ms')
    expect(() => parseOptions(['--rounds', '3', '--rounds', '4'])).toThrow('Duplicate')
    expect(() => parseOptions(['--suites', 'family,,invocation'])).toThrow('--suites')
    expect(() => parseOptions(['--unknown', 'value'])).toThrow('Invalid option')
    expect(() => parseOptions(['--out'])).toThrow('Invalid option')
    expect(() => parseOptions(['--baseline', '/tmp/base', '--baseline-npm', 'latest'])).toThrow('not both')
    expect(() => parseOptions(['--baseline-lock', '/tmp/lock.json', '--baseline-tarball', '/tmp/base.tgz'])).toThrow('not both')
  })
  test('retains different target, installed artifact and output roots', () => {
    const options = parseOptions(['--target', '/tmp/source candidate', '--package-root', '/tmp/installed package', '--out', '/tmp/evidence', '--ownership-site', '/tmp/frozen ownership pair', '--profile', 'full', '--suites', 'family,invocation'])
    expect(options.root).toBe(resolve('/tmp/source candidate'))
    expect(options.packageRoot).toBe(resolve('/tmp/installed package'))
    expect(options.out).toBe(resolve('/tmp/evidence'))
    expect(options.ownershipSite).toBe(resolve('/tmp/frozen ownership pair'))
    expect(options.harnessRoot).not.toBe(options.root)
    expect(options.rounds).toBe(3)
    expect(options.selected).toEqual(['family', 'invocation'])
  })
  test('binds artifact digests to tarball requests rather than source paths', () => {
    expect(() => parseOptions(['--candidate-sha256', 'a'.repeat(64)])).toThrow('requires its tarball')
    expect(() => parseOptions(['--baseline-tarball', '/tmp/package.tgz', '--baseline-sha256', 'A'.repeat(64)])).toThrow('lowercase SHA-256')
    const options = parseOptions(['--candidate-tarball', '/tmp/package.tgz', '--candidate-sha256', 'a'.repeat(64)])
    expect(options.candidateTarball).toBe('/tmp/package.tgz')
    expect(options.candidateSha256).toBe('a'.repeat(64))
  })
  test('Dave measures the supplied artifact without rebuilding the driver checkout', () => {
    const options = parseOptions(['--candidate-tarball', '/tmp/candidate.tgz', '--candidate-sha256', 'a'.repeat(64)])
    const dave = benchmarkSuites(options).find(suite => suite.id === 'dave')!
    expect(dave.command?.slice(0, 3)).toEqual(['bun', 'run', 'eval/benchmark/release-browser-bench.ts'])
    expect(dave.command).toContain('/tmp/candidate.tgz')
    expect(dave.command).toContain('a'.repeat(64))
    expect(dave.command?.slice(dave.command.indexOf('--warmup'), dave.command.indexOf('--warmup') + 2)).toEqual(['--warmup', '30'])
  })
})

describe('unified suite execution lifecycle', () => {

  test('records the replay controls actually passed to each child without retaining unrelated environment values', async () => {
    const { runUnified } = await import('../unified/run.ts')
    const directory = mkdtempSync(join(tmpdir(), 'am-unified-replay-controls-'))
    const saved = { AM_FC_SEED: process.env.AM_FC_SEED, AM_FC_NUM_RUNS: process.env.AM_FC_NUM_RUNS, AM_BENCH_TEST_SECRET: process.env.AM_BENCH_TEST_SECRET }
    try {
      for (const path of ['src/__tests__', 'docs/project', 'eval/mermaid-upstream-suite-bench']) mkdirSync(join(directory, path), { recursive: true })
      writeFileSync(join(directory, 'docs/project/upstream-mermaid-policy.json'), JSON.stringify({ pin: { version: 'fixture', commit: 'fixture' } }))
      writeFileSync(join(directory, 'eval/mermaid-upstream-suite-bench/manifest.json'), JSON.stringify({ upstream: { revision: 'fixture' } }))
      writeFileSync(join(directory, 'package.json'), JSON.stringify({ scripts: { 'bench:replay-fixture': 'bun run child.ts' } }))
      writeFileSync(join(directory, 'child.ts'), 'import{writeFileSync}from"node:fs";writeFileSync(process.env.AM_BENCH_SUITE_OUT+"/child-environment.json",JSON.stringify({AM_FC_SEED:process.env.AM_FC_SEED??null,AM_FC_NUM_RUNS:process.env.AM_FC_NUM_RUNS??null}))')
      const cases: Array<{ name: string; seed: string | undefined; runs: string | undefined; expected: Record<string, string> }> = [
        { name: 'default', seed: undefined, runs: undefined, expected: { AM_FC_SEED: '7' } },
        { name: 'explicit', seed: '17', runs: '300', expected: { AM_FC_SEED: '17', AM_FC_NUM_RUNS: '300' } },
        { name: 'finder', seed: 'random', runs: undefined, expected: { AM_FC_SEED: 'random' } },
      ]
      for (const fixture of cases) {
        delete process.env.AM_FC_SEED
        delete process.env.AM_FC_NUM_RUNS
        if (fixture.seed !== undefined) process.env.AM_FC_SEED = fixture.seed
        if (fixture.runs !== undefined) process.env.AM_FC_NUM_RUNS = fixture.runs
        process.env.AM_BENCH_TEST_SECRET = 'unrelated-value-must-stay-out-of-receipts'
        const options = parseOptions(['--out', join(directory, fixture.name), '--suites', 'replay-fixture', '--timeout-ms', '5000'])
        const report = await runUnified({ ...options, harnessRoot: directory, root: directory })
        const execution = report.suites.find(suite => suite.id === 'replay-fixture')!
        expect(execution.status).toBe('passed')
        expect(execution.environment).toEqual(fixture.expected)
        const observed = JSON.parse(readFileSync(join(options.out, 'replay-fixture/child-environment.json'), 'utf8'))
        expect(observed).toEqual({ ...fixture.expected, AM_FC_NUM_RUNS: fixture.runs ?? null })
        expect(execution.environment).not.toHaveProperty('AM_BENCH_TEST_SECRET')
      }
    } finally {
      for (const key of ['AM_FC_SEED', 'AM_FC_NUM_RUNS', 'AM_BENCH_TEST_SECRET'] as const) {
        const value = saved[key]
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      rmSync(directory, { recursive: true, force: true })
    }
  })
  test('continues after a timeout and retains both failures and later evidence', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readlinkSync, rmSync, existsSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { runUnified } = await import('../unified/run.ts')
    const directory = mkdtempSync(join(tmpdir(), 'am-unified-lifecycle-'))
    const detachedPid = join(directory, 'detached.pid')
    const ownedProcesses = async () => {
      const { execFileSync } = await import('node:child_process')
      return execFileSync('ps', ['-eo', 'pid=,stat=,args='], { encoding: 'utf8' }).split('\n').filter(line => {
        const fields = /^\s*(\d+)\s+(\S+)\s+/.exec(line)
        if (!fields || fields[2]!.startsWith('Z')) return false
        if (line.includes(directory)) return true
        try { return readlinkSync('/proc/' + fields[1] + '/cwd') === directory } catch { return false }
      })
    }
    try {
      for (const path of ['src/__tests__', 'docs/project', 'eval/mermaid-upstream-suite-bench', 'eval/agent-usage']) mkdirSync(join(directory, path), { recursive: true })
      writeFileSync(join(directory, 'docs/project/upstream-mermaid-policy.json'), JSON.stringify({ pin: { version: 'fixture', commit: 'fixture' } }))
      writeFileSync(join(directory, 'eval/mermaid-upstream-suite-bench/manifest.json'), JSON.stringify({ upstream: { revision: 'fixture' } }))
      writeFileSync(join(directory, 'package.json'), JSON.stringify({ scripts: { 'bench:slow-fixture': 'bun run slow.ts', 'bench:after-fixture': 'bun run after.ts', 'bench:incomplete-fixture': 'bun run incomplete.ts', 'bench:uncalibrated-fixture': 'bun run uncalibrated.ts', 'bench:plain-failure-fixture': 'bun run plain-failure.ts', 'bench:compressed-failure-fixture': 'bun run compressed-failure.ts' } }))
      writeFileSync(join(directory, 'eval/agent-usage/live.ts'), 'throw new Error("blocked provider must never launch")\n')
      writeFileSync(join(directory, 'grandchild.ts'), 'setInterval(() => {}, 1000)\n')
      writeFileSync(
        join(directory, 'slow.ts'),
        process.platform === 'linux'
          ? `import{spawn}from'node:child_process';import{writeFileSync}from'node:fs';const child=spawn(process.execPath,['run',${JSON.stringify(join(directory, 'grandchild.ts'))}],{detached:true,stdio:'ignore'});writeFileSync(${JSON.stringify(detachedPid)},String(child.pid));setInterval(()=>{},1000)\n`
          : 'setInterval(() => {}, 1000)\n',
      )
      writeFileSync(join(directory, 'incomplete.ts'), 'import{writeFileSync}from"node:fs";writeFileSync(process.env.AM_BENCH_SUITE_OUT+"/qualification-status.json",JSON.stringify({status:"incomplete"}))\n')
      writeFileSync(join(directory, 'uncalibrated.ts'), 'import{writeFileSync}from"node:fs";writeFileSync(process.env.AM_BENCH_SUITE_OUT+"/qualification-status.json",JSON.stringify({status:"uncalibrated",complete:true}))\n')
      writeFileSync(join(directory, 'after.ts'), 'console.log("later suite completed")\n')
      writeFileSync(join(directory, 'plain-failure.ts'), 'import{writeFileSync}from"node:fs";writeFileSync(process.env.AM_BENCH_SUITE_OUT+"/report.json",JSON.stringify({status:"failed"}))')
      const documents = fileURLToPath(new URL(import.meta.resolve('trident/portable/project-records.ts')))
      writeFileSync(join(directory, 'compressed-failure.ts'), `import{writeBenchmarkDocument}from${JSON.stringify(documents)};writeBenchmarkDocument(process.env.AM_BENCH_SUITE_OUT+"/report.json",{status:"failed"})`)
      const options = parseOptions(['--out', join(directory, 'evidence'), '--suites', 'slow-fixture,agent-live,incomplete-fixture,uncalibrated-fixture,plain-failure-fixture,compressed-failure-fixture,after-fixture', '--timeout-ms', '800'])
      const report = await runUnified({ ...options, harnessRoot: directory, root: directory })
      const slow = report.suites.find(suite => suite.id === 'slow-fixture')!
      const after = report.suites.find(suite => suite.id === 'after-fixture')!
      expect(report.status).toBe('failed')
      expect(slow.status).toBe('failed')
      expect(slow.timedOut).toBe(true)
      if (process.platform === 'linux') {
        const pid = Number(readFileSync(detachedPid, 'utf8'))
        let state: string | undefined
        try {
          const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
          state = stat.slice(stat.lastIndexOf(')') + 2).split(/\s+/)[0]
        } catch {}
        expect(state === undefined || state === 'Z').toBe(true)
      }
      expect(after.status).toBe('passed')
      const unavailable = report.suites.find(suite => suite.id === 'agent-live')!
      expect(unavailable.status).toBe('blocked')
      expect(unavailable.elapsedMs).toBeUndefined()
      expect(unavailable.result?.observations).toEqual([])
      const incomplete = report.suites.find(suite => suite.id === 'incomplete-fixture')!
      expect(incomplete.exitCode).toBe(0)
      expect(incomplete.status).toBe('blocked')
      expect(incomplete.result?.gaps.join(' ')).toContain('declares incomplete')
      const uncalibrated = report.suites.find(suite => suite.id === 'uncalibrated-fixture')!
      expect(uncalibrated.exitCode).toBe(0)
      expect(uncalibrated.status).toBe('blocked')
      expect(uncalibrated.result?.gaps.join(' ')).toContain('declares uncalibrated')
      for (const id of ['plain-failure-fixture', 'compressed-failure-fixture']) {
        const failed = report.suites.find(suite => suite.id === id)!
        expect(failed.exitCode).toBe(0)
        expect(failed.status).toBe('failed')
        expect(failed.result?.gaps.join(' ')).toContain('declares failed qualification')
      }
      expect(readFileSync(join(options.out, after.log!), 'utf8')).toContain('later suite completed')
      expect(existsSync(join(options.out, 'report.json'))).toBe(true)
      const cancelling = runUnified({ ...options, harnessRoot: directory, root: directory, out: join(directory, 'cancelled'), timeoutMs: 5000, selected: ['slow-fixture', 'after-fixture'] })
      process.emit('SIGTERM')
      const cancelled = await cancelling
      if (process.platform === 'linux') {
        await new Promise(resolve => setTimeout(resolve, 500))
        expect(await ownedProcesses()).toEqual([])
      }
      expect(cancelled.suites.find(suite => suite.id === 'slow-fixture')?.status).toBe('failed')
      expect(cancelled.suites.find(suite => suite.id === 'after-fixture')?.status).toBe('blocked')
      expect(cancelled.suites.find(suite => suite.id === 'after-fixture')?.elapsedMs).toBeUndefined()
      expect(cancelled.suites.find(suite => suite.id === 'after-fixture')?.result?.gaps.join(' ')).toContain('SIGTERM')
    } finally {
      if (process.platform === 'linux') {
        for (const line of await ownedProcesses()) {
          try { process.kill(Number(line.trim().split(/\s+/)[0]), 'SIGKILL') } catch {}
        }
      }
      try {
        process.kill(Number(readFileSync(detachedPid, 'utf8')), 'SIGKILL')
      } catch {}
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
