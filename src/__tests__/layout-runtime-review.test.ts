// Controlled private-cache and stub-worker fixtures; no product measurements.
import { expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { cacheProbeLayers, instrumentCacheSource } from '../../eval/benchmark/cache-churn-source.ts'
import { cacheProbeEvent, cacheProbeSnapshot, cacheObservationSnapshot, withCacheProbeObservations } from '../../eval/benchmark/cache-probe-state.ts'
import { WeightedLru } from '../experimental/weighted-lru.ts'
import { runtimeDifferentialPlans, differentialArgs } from '../../eval/benchmark/layout-runtime-differential.ts'
import { layoutCacheEnvironment, layoutRenderOptions } from '../../eval/benchmark/release-bench-fidelity.ts'
import { measureLayoutComparisons, report, type Input, type MeasurementWorker } from '../../eval/benchmark/release-bench.ts'
import { churnRatios } from '../../eval/benchmark/layout-cache-churn.ts'
import { useTempDirs } from './helpers/temp-dir.ts'
import { useTestChildren } from './helpers/test-child.ts'

const temporary = useTempDirs()
const runChild = useTestChildren(10_000)
const artifact = (name: string) => ({ directory: `/${name}`, entry: `/${name}/dist/index.js`, version: '0.4.2', sha256: name, files: [] })

test.each(['off', 'normal'] as const)('pre-selector main ELK omits backend options and retains receipt/cache policy: %s', async cache => {
  const plans = runtimeDifferentialPlans(artifact('old-native'), artifact('candidate'), cache, false, artifact('main-elk'))
  const main = plans.filter(plan => plan.name.startsWith('main-elk-'))
  expect(main).toHaveLength(2)
  for (const plan of main) {
    const reference = plan.engines[0]!
    expect(reference.entry).toBe('/main-elk/dist/index.js')
    expect(reference).not.toHaveProperty('layoutMode')
    expect(layoutRenderOptions(reference.layoutMode)).toBeUndefined()
    expect(reference.consumeReceipt).toBe(true)
    expect(reference.layoutCache).toBe(cache)
  }
  expect(layoutCacheEnvironment(cache)).toEqual({ AGENTIC_MERMAID_ELK_CACHE: cache === 'normal' ? '1' : '0',
    AGENTIC_MERMAID_EXPERIMENTS: cache === 'normal' ? 'text-spans,position-cache' : 'text-spans' })
  expect(plans.find(plan => plan.name === 'native23-aa')!.engines.every(engine => engine.layoutMode === 'agentic')).toBe(true)
  expect(plans.find(plan => plan.name === 'candidate-elk-native24')!.engines.map(engine => engine.layoutMode)).toEqual(['elk', 'agentic'])
  const dir = temporary.dir(), entry = join(dir, 'main.mjs'), job = join(dir, 'job.json'), out = join(dir, 'out.json')
  writeFileSync(entry, `
    function checked(options) {
      if (!options || 'graphLayout' in options || typeof options.onConfigDiagnostic !== 'function') throw Error('unsupported selector');
      if (process.env.AGENTIC_MERMAID_ELK_CACHE !== ${JSON.stringify(cache === 'normal' ? '1' : '0')}
          || process.env.AGENTIC_MERMAID_EXPERIMENTS !== ${JSON.stringify(cache === 'normal' ? 'text-spans,position-cache' : 'text-spans')}) throw Error('wrong cache policy');
      return { checked: true };
    }
    export const renderMermaidSVGWithReceipt = (source, options) => ({svg:'<svg xmlns="http://www.w3.org/2000/svg"><text>main</text></svg>', receipt:checked(options)});
    export const renderMermaidASCIIWithReceipt = (source, options) => ({text:'main', receipt:checked(options)});
  `)
  writeFileSync(job, JSON.stringify({ entry, mode: 'time', reps: 1, consumeReceipt: true, layoutCache: cache,
    layoutMode: main[0]!.engines[0]!.layoutMode, inputs: [{ id: 'main-selector', source: 'unused', family: 'flowchart', expectedSvgLabels: ['main'] }] }))
  const child = await runChild('node', ['--no-warnings', resolve('eval/benchmark/release-bench-worker.ts'), job, out])
  expect({ status: child.status, stderr: child.stderr }).toEqual({ status: 0, stderr: '' })
  const result = JSON.parse(readFileSync(out, 'utf8'))
  expect(result.firstRender.ok).toBe(true)
  expect(result.results[0].svg.ok).toBe(true)
  expect(result.results[0].ascii.ok).toBe(true)
  expect(result.cacheEnvironment).toEqual(layoutCacheEnvironment(cache))
})

test('a new-native timeout cannot erase old-native A/A or get retried on a smaller population', () => {
  const inputs: Input[] = [{ id: 'official', family: 'flowchart', source: 'unused', kind: 'corpus' },
    { id: 'edit', family: 'flowchart', source: 'unused', kind: 'workflow', workflow: 'edit-flowchart' }]
  const groups = inputs.map(input => ({ name: input.id, inputs: [input], budgetMs: 1000 }))
  const plans = runtimeDifferentialPlans(artifact('native23'), artifact('native24'), 'normal')
  const launches: Array<{ arm: string; mode: string; ids: string[] }> = []
  const execute: MeasurementWorker = (engine, mode, group) => {
    launches.push({ arm: engine.label, mode, ids: group.inputs.map(input => input.id) })
    if (mode === 'memory') return { perInput: [], passAllocatedBytes: 1, passPeakHeapBytes: 1, settledHeapBytes: 1, retainedHeapBytes: 1, retainedGrowthBytes: 0, peakRssBytes: 1 }
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
  const result = { perInput: [], passAllocatedBytes: 100, passPeakHeapBytes: 1, settledHeapBytes: 1, retainedHeapBytes: 1, retainedGrowthBytes: 0, peakRssBytes: 1 }
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
  const DiagnosticLru = new Function('cacheProbeEvent', `${script}\nreturn WeightedLru`)((owner: object, layer: string, event: string, weight: number, entries: number, key?: string) => {
    events.push(event); cacheProbeEvent(owner, layer, event, weight, entries, key)
  }) as typeof WeightedLru
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
  const counter = cacheProbeSnapshot().find(value => value.layer === 'weighted:2:10')!
  expect(counter.distinctGetKeys).toBe(4)
  expect(counter.distinctSetKeys).toBe(3) // Oversized retention was rejected.
  expect(counter.getKeySha256.every(value => /^[a-f0-9]{64}$/.test(value))).toBe(true)
  expect(() => instrumentCacheSource(original.replace('const found = this.#entries.get(key)', 'const changed = this.#entries.get(key)'), false, '/unused')).toThrow('exactly one')
})

test('ELK churn counters bind the actual owner residency policy rather than the old key budget', () => {
  const source = readFileSync(new URL('../elk-instance.ts', import.meta.url), 'utf8')
  expect(cacheProbeLayers(source)['weighted:64:8388608']).toContain('estimated residency')
  expect(cacheProbeLayers(source)['weighted:64:1048576']).toBeUndefined()
  expect(() => cacheProbeLayers(source.replace('const ELK_CACHE_MAX_RESIDENCY = 8 * 1024 * 1024', 'const ELK_CACHE_MAX_RESIDENCY = 1024 * 1024'))).toThrow('owner or residency policy')
  expect(() => cacheProbeLayers(source.replace('estimatedResidency(result, ELK_CACHE_MAX_RESIDENCY)', 'key.length'))).toThrow('owner or residency policy')
})

test('canonical cache replay stays separate from private cardinality and restores its observer on failure', () => {
  const symbol = Symbol.for('agentic-mermaid.performance-observer.v1')
  const host = globalThis as unknown as Record<symbol, unknown>
  const previous = Object.getOwnPropertyDescriptor(host, symbol)
  const enclosing = () => {}
  const before = cacheObservationSnapshot(), privateBefore = cacheProbeSnapshot()
  Object.defineProperty(host, symbol, { configurable: true, writable: true, value: enclosing })
  try {
    expect(() => withCacheProbeObservations(() => {
      const observe = host[symbol] as (event: object) => void
      observe({ version: 1, kind: 'scope', owner: 'graphical' })
      observe({ version: 1, kind: 'cache', owner: 'elk-layout', outcome: 'hit' })
      throw new Error('controlled replay failure')
    })).toThrow('controlled replay failure')
    expect(host[symbol]).toBe(enclosing)
    const after = cacheObservationSnapshot()
    expect(after.observed).toBe(true)
    expect(after.graphicalScopes).toBe(before.graphicalScopes + 1)
    expect(after.events['elk-layout:hit']).toBe((before.events['elk-layout:hit'] ?? 0) + 1)
    expect(cacheProbeSnapshot()).toEqual(privateBefore)
  } finally {
    if (previous) Object.defineProperty(host, symbol, previous)
    else delete host[symbol]
  }
})


test('native private cache instrumentation preserves updates and weighted eviction', () => {
  const original = readFileSync(new URL('../layout/agentic-producer-core.ts', import.meta.url), 'utf8')
  const transformed = instrumentCacheSource(original, true, '/unused/diagnostic-state.ts')
  const compile = (source: string) => {
    const declaration = source.match(/class NativeResults<T> \{[\s\S]*?\n\}/)?.[0]
    if (!declaration) throw new Error('Expected the private native cache class exactly')
    const script = new Bun.Transpiler({ loader: 'ts' }).transformSync(declaration)
    return new Function('cacheProbeEvent', `${script}\nreturn NativeResults`)(cacheProbeEvent) as new (capacity: number) => { get(key: string): number | undefined; set(key: string, value: number, weight: number): void }
  }
  const Control = compile(original), Diagnostic = compile(transformed)
  const outcomes = [new Control(10), new Diagnostic(10)].map(cache => {
    cache.set('a', 1, 4); cache.set('b', 2, 4)
    const first = cache.get('a')
    cache.set('c', 3, 4)
    const evicted = cache.get('b'), retained = cache.get('c')
    cache.set('oversized', 4, 11)
    const rejected = cache.get('oversized')
    cache.set('a', 9, 1)
    return [first, evicted, retained, rejected, cache.get('a')]
  })
  expect(outcomes).toEqual([[1, undefined, 3, undefined, 9], [1, undefined, 3, undefined, 9]])
  const counter = cacheProbeSnapshot().find(value => value.layer === 'native:10')!
  expect(counter.events.evict).toBe(1)
  expect(counter.events.rejected).toBe(1)
  expect(counter.distinctGetKeys).toBe(4)
  expect(counter.distinctSetKeys).toBe(3)
})

test.each([
  ['weighted', '../experimental/weighted-lru.ts', false],
  ['native', '../layout/agentic-producer-core.ts', true],
] as const)('private %s cache source probes reject missing, duplicated and stale anchors', (_name, path, native) => {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const anchor = 'const found = this.#entries.get(key)'
  expect(() => instrumentCacheSource(source.replace(anchor, 'const changed = this.#entries.get(key)'), native, '/unused')).toThrow('exactly one')
  expect(() => instrumentCacheSource(`${source}\n// ${anchor}`, native, '/unused')).toThrow('exactly one')
  expect(() => instrumentCacheSource(source.replaceAll('this.#', 'this.'), native, '/unused')).toThrow('exactly one')
})
