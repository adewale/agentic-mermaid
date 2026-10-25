import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseOptions } from '../unified/run.ts'
import { benchmarkSuites } from '../unified/suites.ts'

test('artifact release scope and unavailable target peer protocols keep their actual target identity', () => {
  const directory = mkdtempSync(join(tmpdir(), 'am-suite-target-'))
  try {
    const driver = join(directory, 'driver'),
      target = join(directory, 'target')
    for (const path of ['src/__tests__', 'docs/project', 'eval/benchmark', 'eval/mermaid-upstream-suite-bench']) mkdirSync(join(driver, path), { recursive: true })
    mkdirSync(target)
    writeFileSync(join(driver, 'package.json'), JSON.stringify({ scripts: { 'bench:release:browser': 'bun run eval/benchmark/release-browser-bench.ts' } }))
    writeFileSync(join(driver, 'docs/project/upstream-mermaid-policy.json'), JSON.stringify({ pin: { version: 'fixture', commit: 'fixture' } }))
    writeFileSync(join(driver, 'eval/mermaid-upstream-suite-bench/manifest.json'), JSON.stringify({ upstream: { revision: 'fixture' } }))
    writeFileSync(join(driver, 'eval/benchmark/qualify-peer-performance.ts'), 'throw new Error("Driver protocol must never substitute for the target")')
    const options = { ...parseOptions([]), harnessRoot: driver, root: target }
    const suites = benchmarkSuites(options)
    expect(suites.find(suite => suite.id === 'release:browser')?.target).toBe('candidate')
    const peer = suites.find(suite => suite.id === 'peers:qualify')!
    expect(peer.cwd).toBe(target)
    expect(peer.source).toBe(join(target, 'eval/benchmark/qualify-peer-performance.ts'))
    expect(peer.command).toContain(target)
    expect(peer.command).not.toContain(join(driver, 'eval/benchmark/qualify-peer-performance.ts'))
    expect(peer.prerequisites.some(reason => reason.includes('Selected target checkout lacks'))).toBe(true)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
