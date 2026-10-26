import { expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runFidelityCampaign } from '../fidelity/run.ts'
import { runMermaidFidelitySuite } from '../unified/fidelity-suite.ts'

for (const [boundary, invoke] of [['direct campaign', runFidelityCampaign], ['native worker bridge', runMermaidFidelitySuite]] as const) {
  test(`peer-only selection skips ${boundary} before reference, executable and output preparation`, async () => {
    const directory = join(tmpdir(), 'unselected-core-fidelity-' + crypto.randomUUID())
    const result = await invoke({ root: directory, out: join(directory, 'out'), referenceDir: join(directory, 'absent-reference'), mermaidDir: join(directory, 'absent-source'), nodeExecutable: join(directory, 'absent-node'), executable: join(directory, 'absent-browser'), communityProjects: ['marco-orru/mermaid-ascii'], profile: 'full', rounds: 1 })
    expect(result.status).toBe('not-applicable')
    expect(result.observations).toEqual([])
    expect(existsSync(directory)).toBe(false)
  })
}
