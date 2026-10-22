// Controlled observations only: no renderer, build or measurement subprocess.
import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { instrumentCacheSource } from '../../eval/benchmark/cache-churn-source.ts'
import { WeightedLru } from '../experimental/weighted-lru.ts'
import { runtimeDifferentialPlans, differentialArgs } from '../../eval/benchmark/layout-runtime-differential.ts'
import { measureLayoutComparisons, report, type Input, type MeasurementWorker } from '../../eval/benchmark/release-bench.ts'
import { churnRatios } from '../../eval/benchmark/layout-cache-churn.ts'
import { useTempDirs } from './helpers/temp-dir.ts'

const temporary = useTempDirs()
const artifact = (name: string) => ({ directory: `/${name}`, entry: `/${name}/dist/index.js`, version: '0.4.2', sha256: name, files: [] })

test('a new-native timeout cannot erase old-native A/A or get retried on a smaller population', () => {
  const inputs: Input[] = [{ id: 'official', family: 'flowchart', source: 'unused', kind: 'corpus' },
    { id: 'edit', family: 'flowchart', source: 'unused', kind: 'workflow', workflow: 'edit-flowchart' }]
  const groups = inputs.map(input => ({ name: input.id, inputs: [input], budgetMs: 1000 }))
  const plans = runtimeDifferentialPlans(artifact('native23'), artifact('native24'), 'normal')
  const launches: Array<{ arm: string; mode: string; ids: string[] }> = []
  const execute: MeasurementWorker = (engine, mode, group) => {
    launches.push({ arm: engine.label, mode, ids: group.inputs.map(input => input.id) })
    if (mode === 'memory') return { perInput: [], passAllocatedBytes: 1, passPeakHeapBytes: 1, retainedGrowthBytes: 0, peakRssBytes: 1 }
    if (engine.label === 'native24') {
      engine.failures.set(`time:${group.name}`, 'controlled timeout; no result written')
      return undefined
    }
    return { node: 'controlled', importMs: 1, firstRenderMs: 1, firstRender: { ok: true, sha256: 'cold', bytes: 1 },
      results: group.inputs.map(input => ({ id: input.id, svg: { ok: true, output: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>' },
        ascii: { ok: true, sha256: 'ascii', bytes: 1 }, deterministic: true, ms: 1, samplesMs: Array(25).fill(1), missingSvgLabels: [] })) }
  }
  const pairs = measureLayoutComparisons(temporary.dir(), plans, groups, 3, 25, Date.now() + 1000, execute, true)
  const aa = pairs.find(pair => pair.name === 'native23-aa')!, changed = pairs.find(pair => pair.name === 'native23-native24')!
  expect(launches.filter(row => row.arm === 'native24' && row.mode === 'time')).toEqual([{ arm: 'native24', mode: 'time', ids: ['official', 'edit'] }])
  for (const label of ['native23-reference', 'native23-aa', 'candidate-elk']) {
    expect(launches.filter(row => row.arm === label && row.mode === 'time')).toHaveLength(3)
    for (const row of launches.filter(row => row.arm === label && row.mode === 'time')) expect(row.ids).toEqual(['official', 'edit'])
  }
  expect(aa.runs.every(engine => !engine.failures.size)).toBe(true)
  expect(aa.runs.every(engine => engine.entry === '/native23/dist/index.js')).toBe(true)
  expect(aa.runs.every(engine => engine.layoutMode === 'agentic')).toBe(true)
  expect(changed.runs[1]!.failures.get('time:batched-time')).toContain('controlled timeout')
  expect(changed.runs[1]!.failures.get('time:official')).toContain('controlled timeout')
  expect(changed.runs[1]!.failures.get('time:edit')).toContain('controlled timeout')
  expect(report(inputs, groups, changed.runs, 3).ok).toBe(false)
  expect(changed.runs[1]!.memory.size).toBe(0)
})

test('full review parameters cannot silently increase the bound or shrink rounds/repetitions', () => {
  const args = ['--baseline', '/old', '--out', '/out', '--layout-cache', 'off']
  expect(differentialArgs(args).get('layout-cache')).toBe('off')
  for (const [name, value] of [['budget-ms', '600000'], ['rounds', '1'], ['reps', '15']]) {
    expect(() => differentialArgs([...args, `--${name}`, value!])).toThrow('fixed')
  }
})

test('cache memory summaries preserve a missing/failed round instead of filling it from another round', () => {
  const result = { perInput: [], passAllocatedBytes: 100, passPeakHeapBytes: 1, retainedGrowthBytes: 0, peakRssBytes: 1 }
  const rows = [
    { population: 129, round: 1, arm: 'old', status: 'ok', result },
    { population: 129, round: 1, arm: 'new', status: 'ok', result: { ...result, passAllocatedBytes: 50 } },
    { population: 129, round: 2, arm: 'old', status: 'ok', result },
    { population: 129, round: 2, arm: 'new', status: 'worker-failed', failure: 'timeout' },
    { population: 129, round: 3, arm: 'old', status: 'ok', result },
    { population: 129, round: 3, arm: 'new', status: 'ok', result: { ...result, passAllocatedBytes: 75 } },
  ]
  expect(churnRatios(rows, 129, 'new', 'old', 'passAllocatedBytes')).toEqual({ rounds: [0.5, null, 0.75], validRounds: 2, complete: false, median: 0.75 })
})

test('private cache counters retain weighted eviction behavior and fail closed on source drift', () => {
  const original = readFileSync(new URL('../experimental/weighted-lru.ts', import.meta.url), 'utf8')
  const transformed = instrumentCacheSource(original, false, '/unused/diagnostic-state.ts')
  const script = new Bun.Transpiler({ loader: 'ts' }).transformSync(transformed.replace(/^import[^\n]*\n/, '').replace('export class WeightedLru', 'class WeightedLru'))
  const events: string[] = []
  const DiagnosticLru = new Function('cacheProbeEvent', `${script}\nreturn WeightedLru`)((_owner: object, _layer: string, event: string) => events.push(event)) as typeof WeightedLru
  const control = new WeightedLru<string, number>(2, 10), diagnostic = new DiagnosticLru<string, number>(2, 10)
  for (const cache of [control, diagnostic]) {
    cache.set('a', 1, 4); cache.set('b', 2, 4)
    expect(cache.get('a')).toBe(1) // Promote a; capacity eviction must remove b.
    cache.set('c', 3, 4)
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('c')).toBe(3)
    cache.set('oversized', 4, 11)
    expect(cache.get('oversized')).toBeUndefined()
    cache.clear()
    expect(cache.get('a')).toBeUndefined()
  }
  expect(events.filter(event => event === 'hit')).toHaveLength(2)
  expect(events.filter(event => event === 'miss')).toHaveLength(3)
  expect(events.filter(event => event === 'evict')).toHaveLength(1)
  expect(events.filter(event => event === 'rejected')).toHaveLength(1)
  expect(() => instrumentCacheSource(original.replace('const found = this.entries.get(key)', 'const changed = this.entries.get(key)'), false, '/unused')).toThrow('exactly one')
})
