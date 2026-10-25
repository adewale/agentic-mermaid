import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { assertBenchmarkExecutionAllowed } from '../ci-policy.ts'

test('CI execution is rejected even when the generic indicator is explicitly false', () => {
  expect(() => assertBenchmarkExecutionAllowed({ CI: 'true' })).toThrow('excluded from CI')
  expect(() => assertBenchmarkExecutionAllowed({ CI: 'false', GITHUB_ACTIONS: 'true' })).toThrow('GITHUB_ACTIONS')
  expect(() => assertBenchmarkExecutionAllowed({ CI: '0', BUILDKITE: 'true' })).toThrow('BUILDKITE')
  expect(() => assertBenchmarkExecutionAllowed({ CI: 'false' })).not.toThrow()
  expect(() => assertBenchmarkExecutionAllowed({})).not.toThrow()
})

test('a directly invoked legacy benchmark refuses CI before doing work', () => {
  const result = spawnSync(process.execPath, [resolve(import.meta.dir, '../sample-bench.ts')], {
    encoding: 'utf8', timeout: 10_000, env: { ...process.env, CI: 'true' },
  })
  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain('Benchmarks are excluded from CI')
  expect(result.stdout).toBe('')
})
