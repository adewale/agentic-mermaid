import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { baselineMeasurementContext } from '../unified/baseline-measurement-context.ts'
import { runRetainedSuite } from '../unified/retained-suite.ts'

test('an unrelated tool pin preserves an admitted artifact clock while worker changes invalidate it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'baseline-context-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  let measured = 0
  try {
    mkdirSync(join(root, 'eval/benchmark'), { recursive: true })
    symlinkSync(join(process.cwd(), 'node_modules'), join(root, 'node_modules'), 'dir')
    writeFileSync(join(root, 'eval/benchmark/package.json'), '{"name":"fixture","dependencies":{}}\n')
    writeFileSync(join(root, 'eval/benchmark/tool-versions.json'), '{"pele":"1.9.0"}\n')
    writeFileSync(join(root, 'eval/benchmark/tool-versions.ts'), 'import pins from "./tool-versions.json"; export const admit=pins;\n')
    writeFileSync(join(root, 'worker.ts'), 'import {admit} from "./eval/benchmark/tool-versions.ts"; export function work(){return 1}\n')
    git('init', '-q'); git('config', 'user.name', 'Benchmark fixture'); git('config', 'user.email', 'benchmark@example.invalid')
    git('add', 'eval', 'worker.ts'); git('commit', '-qm', 'Initial worker and admission pins')
    const run = () => runRetainedSuite({
      out: join(root, 'out'), records: join(root, 'records'),
      identity: () => JSON.parse(JSON.stringify({ project: 'mermaid-js/mermaid', lane: 'fixture', protocol: baselineMeasurementContext(root, process.env.NODE_BIN ?? 'node', ['worker.ts']), artifact: { version: '12.2.0', bytes: 'unchanged-shipped-artifact' }, measurement: { rounds: 5 } })),
      measure: async () => { measured++; return { id: 'fixture', status: 'passed', startedAt: '2026-10-25T00:00:00Z', finishedAt: '2026-10-25T00:00:01Z', gaps: [], observations: [{ suite: 'fixture', surface: 'public-api', runtime: 'node', family: 'flowchart', caseId: 'authored', operation: 'parse', format: 'json', mode: 'first-result', status: 'passed', samplesMs: [2] }] } },
    })
    const first = await run()
    writeFileSync(join(root, 'eval/benchmark/tool-versions.json'), '{"pele":"1.10.0"}\n')
    git('add', 'eval/benchmark/tool-versions.json'); git('commit', '-qm', 'Only another tool release changed')
    expect(await run()).toEqual(first)
    expect(measured).toBe(1)
    writeFileSync(join(root, 'worker.ts'), 'import {admit} from "./eval/benchmark/tool-versions.ts"; export function work(){return 2}\n')
    git('add', 'worker.ts'); git('commit', '-qm', 'Actual measured worker changed')
    await run()
    expect(measured).toBe(2)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
