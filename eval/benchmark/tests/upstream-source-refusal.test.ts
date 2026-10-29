import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runReferenceScoreSuite } from '../unified/reference-score.ts'
import { runUpstreamTestScoreSuite } from '../unified/upstream-test-score.ts'

test('lanes that score against Mermaid upstream refuse to run without its pinned source checkout', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'trident-no-upstream-'))
  const saved = process.env.MERMAID_UPSTREAM_DIR
  process.env.MERMAID_UPSTREAM_DIR = join(directory, 'missing-mermaid-checkout')
  try {
    const options = { root: process.cwd(), harnessRoot: process.cwd(), out: join(directory, 'out'), profile: 'smoke' as const, rounds: 1, mermaidDir: process.env.MERMAID_UPSTREAM_DIR }
    await expect(runReferenceScoreSuite(options)).rejects.toThrow('pinned Mermaid source checkout')
    await expect(runUpstreamTestScoreSuite(options)).rejects.toThrow('pinned Mermaid source checkout')
  } finally {
    if (saved === undefined) delete process.env.MERMAID_UPSTREAM_DIR
    else process.env.MERMAID_UPSTREAM_DIR = saved
    rmSync(directory, { recursive: true, force: true })
  }
})
