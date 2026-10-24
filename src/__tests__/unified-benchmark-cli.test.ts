import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { parseOptions, testCounts } from '../../eval/benchmark/unified/run.ts'
import { benchmarkSuites } from '../../eval/benchmark/unified/suites.ts'

describe('unified benchmark CLI preflight', () => {
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
  test('continues after a timeout and retains both failures and later evidence', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { runUnified } = await import('../../eval/benchmark/unified/run.ts')
    const directory = mkdtempSync(join(tmpdir(), 'am-unified-lifecycle-'))
    try {
      for (const path of ['src/__tests__', 'docs/project', 'eval/mermaid-upstream-suite-bench', 'eval/agent-usage']) mkdirSync(join(directory, path), { recursive: true })
      writeFileSync(join(directory, 'docs/project/upstream-mermaid-policy.json'), JSON.stringify({ pin: { version: 'fixture', commit: 'fixture' } }))
      writeFileSync(join(directory, 'eval/mermaid-upstream-suite-bench/manifest.json'), JSON.stringify({ upstream: { revision: 'fixture' } }))
      writeFileSync(join(directory, 'package.json'), JSON.stringify({ scripts: { 'bench:slow-fixture': 'bun run slow.ts', 'bench:after-fixture': 'bun run after.ts', 'bench:incomplete-fixture': 'bun run incomplete.ts' } }))
      writeFileSync(join(directory, 'eval/agent-usage/live.ts'), 'throw new Error("blocked provider must never launch")\n')
      writeFileSync(join(directory, 'slow.ts'), 'setInterval(() => {}, 1000)\n')
      writeFileSync(join(directory, 'incomplete.ts'), 'import{writeFileSync}from"node:fs";writeFileSync(process.env.AM_BENCH_SUITE_OUT+"/report.json",JSON.stringify({status:"incomplete"}))\n')
      writeFileSync(join(directory, 'after.ts'), 'console.log("later suite completed")\n')
      const options = parseOptions(['--out', join(directory, 'evidence'), '--suites', 'slow-fixture,agent-live,incomplete-fixture,after-fixture', '--timeout-ms', '300'])
      const report = await runUnified({ ...options, harnessRoot: directory, root: directory })
      const slow = report.suites.find(suite => suite.id === 'slow-fixture')!
      const after = report.suites.find(suite => suite.id === 'after-fixture')!
      expect(report.status).toBe('failed')
      expect(slow.status).toBe('failed')
      expect(slow.timedOut).toBe(true)
      expect(after.status).toBe('passed')
      const unavailable = report.suites.find(suite => suite.id === 'agent-live')!
      expect(unavailable.status).toBe('blocked')
      expect(unavailable.elapsedMs).toBeUndefined()
      expect(unavailable.result?.observations).toEqual([])
      const incomplete = report.suites.find(suite => suite.id === 'incomplete-fixture')!
      expect(incomplete.exitCode).toBe(0)
      expect(incomplete.status).toBe('blocked')
      expect(incomplete.result?.gaps.join(' ')).toContain('declares incomplete')
      expect(readFileSync(join(options.out, after.log!), 'utf8')).toContain('later suite completed')
      expect(existsSync(join(options.out, 'report.json'))).toBe(true)
      const cancelling = runUnified({ ...options, harnessRoot: directory, root: directory, out: join(directory, 'cancelled'), timeoutMs: 5000, selected: ['slow-fixture', 'after-fixture'] })
      process.emit('SIGTERM')
      const cancelled = await cancelling
      expect(cancelled.suites.find(suite => suite.id === 'slow-fixture')?.status).toBe('failed')
      expect(cancelled.suites.find(suite => suite.id === 'after-fixture')?.status).toBe('blocked')
      expect(cancelled.suites.find(suite => suite.id === 'after-fixture')?.elapsedMs).toBeUndefined()
      expect(cancelled.suites.find(suite => suite.id === 'after-fixture')?.result?.gaps.join(' ')).toContain('SIGTERM')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
