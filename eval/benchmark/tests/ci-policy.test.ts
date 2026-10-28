import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// sample-bench.ts imports Agentic source, so it can only start inside that checkout.
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
