import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { assertBenchmarkExecutionAllowed } from '../ci-policy.ts'
import { MERMAID_ORACLE_PIN, mermaidOracleDirectory } from '../portable/mermaid-oracle.ts'

test('CI execution is rejected even when the generic indicator is explicitly false', () => {
  const local = { mermaidOracle: false }
  expect(() => assertBenchmarkExecutionAllowed({ CI: 'true' }, local)).toThrow('excluded from CI')
  expect(() => assertBenchmarkExecutionAllowed({ CI: 'false', GITHUB_ACTIONS: 'true' }, local)).toThrow('GITHUB_ACTIONS')
  expect(() => assertBenchmarkExecutionAllowed({ CI: '0', BUILDKITE: 'true' }, local)).toThrow('BUILDKITE')
  expect(() => assertBenchmarkExecutionAllowed({ CI: 'false' }, local)).not.toThrow()
  expect(() => assertBenchmarkExecutionAllowed({}, local)).not.toThrow()
})

test('a benchmark run refuses without exactly the pinned Mermaid oracle, and runs with it', () => {
  const directory = mkdtempSync(join(tmpdir(), 'trident-oracle-'))
  try {
    expect(() => assertBenchmarkExecutionAllowed({ MERMAID_REFERENCE_DIR: directory })).toThrow('no install exists')
    // Another Mermaid release is not the oracle, even with every package present.
    writeFileSync(join(directory, 'package.json'), '{}')
    for (const [name, version] of [['mermaid', '11.12.0'], ['@mermaid-js/parser', MERMAID_ORACLE_PIN.parser], ['jsdom', MERMAID_ORACLE_PIN.dom]] as const) {
      mkdirSync(join(directory, 'node_modules', name), { recursive: true })
      writeFileSync(join(directory, 'node_modules', name, 'package.json'), JSON.stringify({ name, version, main: 'index.js' }))
    }
    expect(() => assertBenchmarkExecutionAllowed({ MERMAID_REFERENCE_DIR: directory })).toThrow(`found mermaid 11.12.0`)
    const installed = { MERMAID_REFERENCE_DIR: mermaidOracleDirectory() }
    expect(() => assertBenchmarkExecutionAllowed(installed)).not.toThrow()
    expect(installed).toMatchObject({ TRIDENT_MERMAID_ORACLE: `${MERMAID_ORACLE_PIN.version} ${resolve(installed.MERMAID_REFERENCE_DIR)}` })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('a directly invoked legacy benchmark refuses CI, or a missing oracle, before doing work', () => {
  const run = (env: Record<string, string>) => spawnSync(process.execPath, [resolve(import.meta.dir, '../sample-bench.ts')], { encoding: 'utf8', timeout: 10_000, env: { ...process.env, ...env } })
  const ci = run({ CI: 'true' })
  expect(ci.status).not.toBe(0)
  expect(ci.stderr).toContain('Benchmarks are excluded from CI')
  expect(ci.stdout).toBe('')
  const directory = mkdtempSync(join(tmpdir(), 'trident-no-oracle-'))
  try {
    const missing = run({ MERMAID_REFERENCE_DIR: directory, TRIDENT_MERMAID_ORACLE: '' })
    expect(missing.status).not.toBe(0)
    expect(missing.stderr).toContain('needs the pinned Mermaid oracle')
    expect(missing.stdout).toBe('')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
