// Exercise the publication decision and scorecard math with controlled worker
// observations. No clocks, npm registry or browser launch in these tests.
import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { report, type EngineRun, type Group, type Input } from '../../eval/benchmark/release-bench.ts'
import { browserScorecard, type BrowserSample } from '../../eval/benchmark/release-browser-bench.ts'
import { missingSvgLabels, renderAgentEdit, agentEditCase } from '../../eval/benchmark/release-bench-fidelity.ts'
import * as api from '../agent/index.ts'
import { useTempDirs } from './helpers/temp-dir.ts'

const temp = useTempDirs()
const input = (id: string, kind: Input['kind'] = 'corpus', family = 'flowchart'): Input => ({ id, kind, family, source: 'flowchart LR\n A --> B' })
function run(label: string, inputs: Input[]): EngineRun {
  return {
    label, entry: '/unused/index.js', version: '0.0.0', identity: { kind: 'directory', requested: '/unused' },
    importMs: [1], firstRenderMs: [1], firstRender: { ok: true, bytes: 1, sha256: 'cold' }, coldDeterministic: true,
    results: new Map(inputs.map(input => [input.id, {
      svg: { ok: true, output: '<svg xmlns="http://www.w3.org/2000/svg"/>' },
      ascii: { ok: true, bytes: 1, sha256: 'ascii' }, validSvg: true, deterministic: true,
      mediansMs: [1], samplesMs: [[1, 1, 1]], missingSvgLabels: [],
    }])),
    memory: new Map([['corpus', { perInput: [], inputIds: inputs.map(input => input.id), passAllocatedBytes: 100, passPeakHeapBytes: 100, settledHeapBytes: 100, retainedHeapBytes: 100, retainedGrowthBytes: 0, peakRssBytes: 100 }]]),
    failures: new Map(),
  }
}
function decision(inputs: Input[], before: EngineRun, after: EngineRun) {
  const groups: Group[] = [{ name: 'corpus', inputs: inputs.filter(input => input.kind === 'corpus'), budgetMs: 1000 }]
  return report(inputs, groups, [before, after], 1)
}
function reject(engine: EngineRun, id: string) {
  const row = engine.results.get(id)!
  row.svg = { ok: false, error: 'unsupported' }
  row.ascii.ok = false
  row.validSvg = false
}

describe('release publication decisions', () => {
  test('complete equal observations pass; a partial baseline cannot pass on the remaining intersection', () => {
    const inputs = [input('flow'), input('sequence', 'scaling', 'sequence')]
    const before = run('baseline', inputs), after = run('candidate', inputs)
    expect(decision(inputs, before, after).ok).toBe(true)
    before.results.delete('sequence')
    before.failures.set('time:sequence', 'worker timeout')
    const result = decision(inputs, before, after)
    expect(result.ok).toBe(false)
    expect(result.summary.checks.find(check => check.name === 'Every required baseline measurement completes')?.ok).toBe(false)
  })

  test('a missing baseline memory observation is incomplete even when timings succeeded', () => {
    const inputs = [input('flow')], before = run('baseline', inputs), after = run('candidate', inputs)
    before.memory.clear()
    expect(decision(inputs, before, after).ok).toBe(false)
  })

  test.each(['baseline', 'candidate'] as const)('missing absolute heap observations fail existing %s completeness checks', side => {
    const inputs = [input('flow')],
      before = run('baseline', inputs),
      after = run('candidate', inputs)
    const engine = side === 'baseline' ? before : after
    const memory = engine.memory.get('corpus')!
    for (const key of ['settledHeapBytes', 'retainedHeapBytes'] as const) {
      const original = memory[key]
      for (const invalid of [undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1]) {
        Object.assign(memory, { [key]: invalid })
        const result = decision(inputs, before, after)
        expect(result.ok).toBe(false)
        expect(result.summary.checks.find(check => check.name === 'Required matched corpus memory measurements complete')?.ok).toBe(false)
        expect(result.summary.checks.find(check => check.name === (side === 'baseline' ? 'Every required baseline measurement completes' : 'Every candidate measurement completes'))?.ok).toBe(false)
      }
      memory[key] = original
    }
    expect(decision(inputs, before, after).ok).toBe(true)
  })

  test('a newly enrolled workload must succeed even when both versions reject it', () => {
    const inputs = [input('flow'), input('new-family', 'scaling', 'c4')]
    const before = run('baseline', inputs), after = run('candidate', inputs)
    reject(before, 'new-family')
    reject(after, 'new-family')
    const result = decision(inputs, before, after)
    expect(result.ok).toBe(false)
    expect(result.summary.checks.find(check => check.name === 'Every scaling and agent workflow succeeds')?.ok).toBe(false)
  })

  test('family regression is caught when the corpus improves overall', () => {
    const inputs = [input('big'), input('small', 'corpus', 'sequence')]
    const before = run('baseline', inputs), after = run('candidate', inputs)
    before.results.get('big')!.samplesMs = [[100, 100, 100]]
    after.results.get('big')!.samplesMs = [[80, 80, 80]]
    after.results.get('small')!.samplesMs = [[2, 2, 2]]
    const result = decision(inputs, before, after)
    expect(result.summary.pairedCorpus.candidateOverBaseline).toBeLessThan(1)
    expect(result.summary.checks.find(check => check.name.startsWith('Each compared family'))?.ok).toBe(false)
    expect(result.ok).toBe(false)
  })

  test('corpus aggregation retains elapsed work hidden by independent per-input medians', () => {
    const inputs = [input('a'), input('b'), input('c')]
    const before = run('baseline', inputs), after = run('candidate', inputs)
    inputs.forEach((input, index) => { after.results.get(input.id)!.samplesMs = [[0, 1, 2].map(i => i === index ? 100 : 1)] })
    const result = decision(inputs, before, after)
    expect(result.summary.pairedCorpus.baselineMs).toEqual([3])
    expect(result.summary.pairedCorpus.candidateMs).toEqual([102])
    expect(result.ok).toBe(false)
  })

  test('speed ratios pair rounds instead of dividing unrelated medians', () => {
    const inputs = [input('flow')], before = run('baseline', inputs), after = run('candidate', inputs)
    before.results.get('flow')!.mediansMs = [1, 100, 101]
    before.results.get('flow')!.samplesMs = [[1], [100], [101]]
    after.results.get('flow')!.mediansMs = [2, 99, 300]
    after.results.get('flow')!.samplesMs = [[2], [99], [300]]
    const result = report(inputs, [{ name: 'corpus', inputs, budgetMs: 1000 }], [before, after], 3)
    // Paired ratios are 2, 0.99, and 2.97. Dividing the independent medians
    // (99/100) would incorrectly report an improvement.
    expect(result.summary.pairedCorpus.candidateOverBaseline).toBe(2)
    expect(result.ok).toBe(false)
  })

  test('missing authored text fails despite deterministic, parseable SVG', () => {
    const inputs = [input('flow')], before = run('baseline', inputs), after = run('candidate', inputs)
    after.results.get('flow')!.missingSvgLabels = missingSvgLabels('<svg><text>Node 10</text></svg>', ['Node 1'])
    expect(decision(inputs, before, after).ok).toBe(false)
    expect(missingSvgLabels('<svg><text>A &amp; <tspan>B</tspan></text></svg>', ['A & B'])).toEqual([])
  })
})

test('browser rejection changes coverage but never improves the shared-success speed ratio', () => {
  const samples: BrowserSample[] = [
    { engine: 'candidate', round: 1, id: 'a', ok: true, ms: 10 },
    { engine: 'candidate', round: 1, id: 'b', ok: false, ms: 0.001, error: 'MermaidFamilyDetectionError: Unrecognized Mermaid header: "agentflow-beta"' },
    { engine: 'pele', round: 1, id: 'a', ok: true, ms: 1 },
    { engine: 'pele', round: 1, id: 'b', ok: true, ms: 100 },
  ]
  const result = browserScorecard(samples, ['candidate', 'pele'], 1, 2)
  expect(result.engines[0]!.accepted).toBe(1)
  expect(result.engines[0]!.failures[0]!.category).toBe('unsupported')
  expect(result.matched[0]!.inputIds).toEqual(['a'])
  expect(result.matched[0]!.medianRatio).toBe(10)
})

test('agent workload completes a verified edit and renders the original and added labels', () => {
  const svg = renderAgentEdit(api, agentEditCase.source)
  expect(missingSvgLabels(svg, agentEditCase.expectedSvgLabels)).toEqual([])
  const dropsEdits = Object.create(api) as typeof api
  Object.defineProperty(dropsEdits, 'mutate', { value: (diagram: unknown) => ({ ok: true, value: diagram }) })
  expect(() => renderAgentEdit(dropsEdits, agentEditCase.source)).toThrow('requested or preserved facts were lost')
})

test('baseline resolution survives a changed latest tag across CLI retries', () => {
  const dir = temp.dir(), lock = join(dir, 'baseline.json'), registry = join(dir, 'registry.json'), npm = join(dir, 'npm')
  writeFileSync(npm, '#!/bin/sh\ncat "$FAKE_REGISTRY"\n')
  chmodSync(npm, 0o755)
  const integrity = 'sha512-YWJjZA=='
  writeFileSync(registry, JSON.stringify({ version: '0.4.1', 'dist.integrity': integrity }))
  const invoke = () => spawnSync(process.execPath, [join(import.meta.dir, '../../eval/benchmark/release-baseline.ts'), 'latest', lock], { encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, FAKE_REGISTRY: registry } })
  expect(invoke().status).toBe(0)
  writeFileSync(registry, JSON.stringify({ version: '0.4.2', 'dist.integrity': 'sha512-ZWZnaA==' }))
  expect(invoke().status).toBe(0)
  expect(JSON.parse(readFileSync(lock, 'utf8'))).toEqual({ requested: 'latest', version: '0.4.1', integrity })
})

test('browser comparisons require one observation for every input in every paired round', () => {
  const rows: BrowserSample[] = [
    { engine: 'candidate', round: 1, id: 'a', ok: true, ms: 2 },
    { engine: 'candidate', round: 2, id: 'a', ok: true, ms: 99 },
    { engine: 'candidate', round: 3, id: 'a', ok: true, ms: 300 },
    { engine: 'pele', round: 1, id: 'a', ok: true, ms: 1 },
    { engine: 'pele', round: 2, id: 'a', ok: true, ms: 100 },
    { engine: 'pele', round: 3, id: 'a', ok: true, ms: 101 },
  ]
  const score = (samples: BrowserSample[], population = 1) => browserScorecard(samples, ['candidate', 'pele'], 3, population)
  expect(score(rows).engines.every(engine => engine.complete)).toBe(true)
  expect(score(rows).matched[0]!.medianRatio).toBe(2)
  // Preserve the success count while replacing round two by a second round
  // one; counting receipts used to accept this incomplete population.
  const duplicated = rows.map((row, i) => i === 1 ? { ...rows[0]! } : row)
  for (const incomplete of [duplicated, rows.filter((_, i) => i !== 1), [...rows, { ...rows[0]! }]]) {
    const result = score(incomplete)
    expect(result.engines[0]!.complete).toBe(false)
    expect(result.matched[0]!.inputIds).toEqual([])
    expect(result.matched[0]!.medianRatio).toBeUndefined()
  }
  // A complete surviving input cannot stand in for an entirely missing one.
  expect(score(rows, 2).matched[0]!.medianRatio).toBeUndefined()
  const missingComparator = score(rows.filter((_, i) => i !== 4))
  expect(missingComparator.engines[1]!.complete).toBe(false)
  expect(missingComparator.matched[0]!.medianRatio).toBeUndefined()
})

test.each([
  ['stable complete output', 0, '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><text>Keep</text></svg>', 'ok'],
  ['empty output after the first call', 2, '', 'error'],
  ['missing text during a measured sample', 3, '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><text>Other</text></svg>', 'lost-labels'],
  ['malformed SVG carrying the expected text', 1, '<svg><text>Keep</text>', 'error'],
] as const)('peer worker validates %s outside timing', (_name, changeAt, replacement, status) => {
  const dir = temp.dir(), entry = join(dir, 'renderer.mjs'), job = join(dir, 'job.json'), out = join(dir, 'samples.jsonl')
  writeFileSync(entry, `let calls = 0; export function renderMermaidSVG() { return ++calls >= ${changeAt || 'Infinity'} ? ${JSON.stringify(replacement)} : '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><text>Keep</text></svg>' }`)
  writeFileSync(job, JSON.stringify({ peer: 'agentic', output: 'svg', entry,
    timing: { warmCalls: 1, warmupMs: 0, samples: 3, minSampleMs: 0, maxCaseMs: 100 },
    workloads: [{ id: 'owned-text', source: 'fixture', expected: ['Keep'] }],
  }))
  writeFileSync(out, '')
  const child = spawnSync('node', ['--expose-gc', join(import.meta.dir, '../../eval/benchmark/peer-bench.ts'), '--child', '--job', job, '--out', out], {
    cwd: join(import.meta.dir, '../..'), encoding: 'utf8', timeout: 10000,
  })
  expect({ status: child.status, stderr: child.stderr }).toEqual({ status: 0, stderr: '' })
  const observations = readFileSync(out, 'utf8').trim().split('\n').map(line => JSON.parse(line))
  const end = observations.find(row => row.type === 'end')
  for (const key of ['rssBytes', 'peakRssBytes', 'settledHeapBytes']) expect(end[key]).toBeGreaterThan(0)
  const result = observations.find(row => row.type === 'result')
  expect(result.status).toBe(status)
  if (status === 'ok') expect(result.samplesMs).toHaveLength(3)
  else expect(result.medianMs).toBeUndefined()
})

test('release memory worker retains absolute post-GC heap observations', () => {
  const dir = temp.dir(),
    entry = join(dir, 'renderer.mjs'),
    job = join(dir, 'job.json'),
    out = join(dir, 'memory.json')
  writeFileSync(entry, 'export function renderMermaidSVG() { return "<svg/>" }')
  writeFileSync(job, JSON.stringify({ entry, mode: 'memory', reps: 1, inputs: [input('fixture')] }))
  const child = spawnSync('node', ['--expose-gc', join(import.meta.dir, '../../eval/benchmark/release-bench-worker.ts'), job, out], { encoding: 'utf8', timeout: 10000 })
  expect({ status: child.status, stderr: child.stderr }).toEqual({ status: 0, stderr: '' })
  const memory = JSON.parse(readFileSync(out, 'utf8'))
  expect(memory.settledHeapBytes).toBeGreaterThan(0)
  expect(memory.retainedHeapBytes).toBeGreaterThan(0)
  expect(memory.retainedGrowthBytes).toBe(Math.max(0, memory.retainedHeapBytes - memory.settledHeapBytes))
})

test('peer artifact mismatch fails before installation and retains explicit incomplete evidence', () => {
  const dir = temp.dir(), tarball = join(dir, 'candidate.tgz'), reportPath = join(dir, 'report.json')
  writeFileSync(tarball, 'different bytes')
  const bin = temp.dir(), npm = join(bin, 'npm'), installed = join(dir, 'npm-called')
  writeFileSync(npm, '#!/bin/sh\n: > "$INSTALL_RECEIPT"\nexit 99\n')
  chmodSync(npm, 0o755)
  const invoke = () => spawnSync(process.execPath, [join(import.meta.dir, '../../eval/benchmark/peer-bench.ts'),
    '--peers', 'agentic', '--workloads', 'flow5', '--candidate-tarball', tarball,
    '--candidate-sha256', '0'.repeat(64), '--elk-cache', 'on', '--json', reportPath, '--markdown', join(dir, 'report.md'),
  ], { cwd: join(import.meta.dir, '../..'), encoding: 'utf8', timeout: 10000, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, INSTALL_RECEIPT: installed, APL_NO_CENTER: '1' } })
  expect(invoke().status).not.toBe(0)
  expect(existsSync(installed)).toBe(false)
  const report = JSON.parse(readFileSync(reportPath, 'utf8'))
  expect(report.status).toBe('failed')
  expect(report.error).toContain('Candidate tarball SHA-256')
  expect(report.policy).toMatchObject({ elkCache: 'on', sceneAssertions: 'off', aplEnvironment: { APL_NO_CENTER: '1' } })
  const originalRaw = readFileSync(report.rawSamples, 'utf8')
  const receipts = originalRaw.trim().split('\n').map(line => JSON.parse(line))
  expect(receipts[0].status).toBe('started')
  expect(receipts.at(-1)).toMatchObject({ status: 'failed', error: report.error })
  expect(invoke().status).not.toBe(0)
  expect(JSON.parse(readFileSync(reportPath, 'utf8')).rawSamples).not.toBe(report.rawSamples)
  expect(readFileSync(report.rawSamples, 'utf8')).toBe(originalRaw)
})
