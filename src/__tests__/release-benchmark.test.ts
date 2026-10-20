// Exercise the publication decision and scorecard math with controlled worker
// observations. Registry and browser failures are controlled in subprocess probes.
import { describe, expect, test } from 'bun:test'
import { chmodSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { layoutComparisons, layoutCoverage, releaseBenchArgs, report, strictLayoutHealthy, type EngineRun, type Group, type Input } from '../../eval/benchmark/release-bench.ts'
import { browserDiagnosticsOptions, browserScorecard, renderPass, type BrowserSample } from '../../eval/benchmark/release-browser-bench.ts'
import { browserMemoryDiagnostics, sharedMemoryInputs } from '../../eval/benchmark/browser-memory.ts'
import { bezelEngine } from '../../eval/benchmark/bezel.ts'
import type { Page } from 'playwright'
import { browserPerformanceOptions, configureAgenticEngines } from '../../eval/benchmark/browser-config.ts'
import type { Engine } from '../../eval/benchmark/release-browser-bench.ts'
import { layoutRenderOptions, missingSvgLabels, renderAgentEdit, agentEditCase } from '../../eval/benchmark/release-bench-fidelity.ts'
import { releaseBenchCases } from '../../eval/benchmark/release-bench-cases.ts'
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
    memory: new Map([['corpus', { perInput: [], inputIds: inputs.map(input => input.id), passAllocatedBytes: 100, passPeakHeapBytes: 100, retainedGrowthBytes: 0, peakRssBytes: 100 }]]),
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
  test('layout arms pair independently and preserve the external ELK comparison', () => {
    const inputs = [input('flow')]
    const plans = layoutComparisons([run('baseline', inputs), run('candidate', inputs)], ['elk', 'agentic', 'agentic-with-elk'], 'normal')
    expect(plans.map(plan => plan.name)).toEqual(['elk-aa', 'agentic', 'agentic-with-elk', 'external-baseline'])
    for (const plan of plans) {
      expect(plan.engines).toHaveLength(2)
      expect(plan.engines.every(engine => engine.consumeReceipt && engine.layoutCache === 'normal')).toBe(true)
      expect(plan.engines[1]!.entry).toBe('/unused/index.js')
    }
    expect(plans[1]!.engines[0]!.layoutMode).toBe('elk')
    expect(plans[1]!.engines[1]!.layoutMode).toBe('agentic')
    expect(plans[2]!.advisory).toBe(false)
    expect(plans[3]!.engines[0]!.layoutMode).toBeUndefined()
  })

  test('strict declines are retained and advisory; new internal errors still fail', () => {
    const inputs = [input('flow'), input('compound')]
    const before = run('elk', inputs), after = run('agentic', inputs)
    after.results.get('compound')!.svg = { ok: false, error: 'unsupported groups', code: 'GRAPH_LAYOUT_UNSUPPORTED', category: 'unsupported' }
    after.results.get('compound')!.validSvg = false
    expect(strictLayoutHealthy(inputs, [before, after], 1)).toBe(true)
    expect(layoutCoverage(inputs, after).statuses).toContainEqual({ id: 'compound', family: 'flowchart', status: 'unsupported' })
    expect(decision(inputs, before, after).ok).toBe(false)
    after.results.get('compound')!.svg = { ok: false, error: 'internal solver error', category: 'error' }
    expect(strictLayoutHealthy(inputs, [before, after], 1)).toBe(false)
  })

  test('layout CLI rejects unknown, duplicate and unpaired cache controls', () => {
    expect(releaseBenchArgs(['--layout-modes', 'elk,agentic,agentic-with-elk', '--layout-cache', 'off']).get('layout-cache')).toBe('off')
    expect(() => releaseBenchArgs(['--layout-modes', 'auto'])).toThrow('--layout-modes')
    expect(() => releaseBenchArgs(['--layout-modes', 'elk,elk'])).toThrow('--layout-modes')
    expect(() => releaseBenchArgs(['--layout-cache', 'normal'])).toThrow('--layout-cache')
    expect(() => releaseBenchArgs(['--layout-modes', 'elk', '--layout-cache', 'infinite'])).toThrow('--layout-cache')
    expect(layoutRenderOptions('agentic-with-elk')?.graphLayout).toEqual({ backend: 'agentic', fallback: 'elk' })
    expect(layoutRenderOptions()).toBeUndefined()
  })

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

  test.each([0.5, 2])('ELK A/A rejects a %s× timing difference in either direction', factor => {
    const inputs = [input('flow'), input('cyclic', 'scaling')]
    const before = run('elk-reference', inputs), after = run('elk-aa', inputs)
    for (const row of after.results.values()) { row.samplesMs = [[factor, factor, factor]]; row.mediansMs = [factor] }
    const groups: Group[] = [{ name: 'corpus', inputs: [inputs[0]!], budgetMs: 1000 }]
    expect(report(inputs, groups, [before, after], 1, true).ok).toBe(false)
    if (factor < 1) expect(report(inputs, groups, [before, after], 1).ok).toBe(true)
  })

  test('ELK A/A cannot pass when the two workers draw different output', () => {
    const inputs = [input('flow')], before = run('elk-reference', inputs), after = run('elk-aa', inputs)
    expect(report(inputs, [], [before, after], 1, true).ok).toBe(true)
    after.results.get('flow')!.svg = { ok: true, output: '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>' }
    expect(report(inputs, [], [before, after], 1, true).ok).toBe(false)
  })

  test('a missing baseline memory observation is incomplete even when timings succeeded', () => {
    const inputs = [input('flow')], before = run('baseline', inputs), after = run('candidate', inputs)
    before.memory.clear()
    expect(decision(inputs, before, after).ok).toBe(false)
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

test('browser pass warms only the requested prefix and still attempts every measured input', async () => {
  const calls: string[] = []
  const inputs = Array.from({ length: 35 }, (_, i) => ({ id: `case${i}`, source: `source${i}` }))
  const host = globalThis as unknown as Record<string, unknown>
  const priorDocument = host.document, priorApi = host.benchmarkApi, priorCache = host.AGENTIC_MERMAID_ELK_CACHE, priorExperiments = host.AGENTIC_MERMAID_EXPERIMENTS
  host.document = { querySelectorAll: () => [] }
  host.benchmarkApi = { renderMermaidSVG(source: string) {
    calls.push(source)
    if (source === 'source32') throw new Error('unsupported')
    return '<svg/>'
  } }
  const page = {
    goto: async () => {}, addScriptTag: async () => {},
    evaluate: async (fn: (arg: unknown) => unknown, arg: unknown) => fn(arg),
  } as unknown as Page
  try {
    const rows = await renderPass(page, { label: 'candidate', name: 'agentic-mermaid', version: 'test', root: '/unused',
      kind: 'agentic', bundle: 'test.js', global: 'benchmarkApi', experiments: 'indexed-layout', identity: { integrity: 'test' } }, 'http://localhost', inputs, 1, 30)
    expect(host.AGENTIC_MERMAID_EXPERIMENTS).toBe('indexed-layout')
    expect(calls).toEqual([...inputs.slice(0, 30), ...inputs].map(input => input.source))
    expect(rows.map(row => row.id)).toEqual(inputs.map(input => input.id))
    expect(rows[32]?.ok).toBe(false)
    expect(rows.filter(row => row.ok)).toHaveLength(34)
  } finally {
    for (const [key, value] of [['document', priorDocument], ['benchmarkApi', priorApi], ['AGENTIC_MERMAID_ELK_CACHE', priorCache], ['AGENTIC_MERMAID_EXPERIMENTS', priorExperiments]] as const) {
      if (value === undefined) delete host[key]
      else host[key] = value
    }
  }
})

test.each([
  { label: 'artifact defaults', options: new Map<string, string>(), expected: undefined, elkCache: 'off' },
  { label: 'same explicit features', options: new Map([['features', 'text-spans,indexed-layout'], ['elk-cache', 'on']]), expected: 'text-spans,indexed-layout', elkCache: 'on' },
  { label: 'explicit legacy paths', options: new Map([['features', '']]), expected: '', elkCache: 'off' },
] as const)('browser startup preserves $label on both agentic engines without configuring peers', async ({ options, expected, elkCache }) => {
  const performance = browserPerformanceOptions(options)
  const engines = (['candidate', 'baseline', 'pele', 'mermaid'] as const).map(label => ({
    label, name: label, version: 'test', root: '/unused', kind: label === 'candidate' || label === 'baseline' ? 'agentic' : label,
    bundle: 'test.js', global: 'browserConfigurationApi', identity: { integrity: 'test' },
    ...(label === 'candidate' || label === 'baseline' ? { experiments: 'stale' } : {}),
  }) satisfies Engine)
  configureAgenticEngines(engines, performance.features)
  const host = globalThis as unknown as Record<string, unknown>
  const prior = new Map(['document', 'browserConfigurationApi', 'AGENTIC_MERMAID_EXPERIMENTS', 'AGENTIC_MERMAID_ELK_CACHE'].map(key => [key, host[key]]))
  host.document = { querySelectorAll: () => [] }
  host.browserConfigurationApi = { renderMermaidSVG: () => '<svg/>', render: () => '<svg/>', initialize: () => {} }
  const startup: Array<{ engine: string; hasOverride: boolean; features: unknown; cache: unknown }> = []
  try {
    for (const engine of engines) {
      const page = {
        // Real navigation creates a fresh global. Seed a stale override here
        // to catch accidental preservation or conversion to an empty list.
        goto: async () => { host.AGENTIC_MERMAID_EXPERIMENTS = 'stale' },
        evaluate: async (fn: (arg: unknown) => unknown, arg: unknown) => fn(arg),
        addScriptTag: async () => { startup.push({ engine: engine.label, hasOverride: Object.hasOwn(host, 'AGENTIC_MERMAID_EXPERIMENTS'), features: host.AGENTIC_MERMAID_EXPERIMENTS, cache: host.AGENTIC_MERMAID_ELK_CACHE }) },
      } as unknown as Page
      expect((await renderPass(page, engine, 'http://localhost', [{ id: 'one', source: 'flowchart LR\n A-->B' }], 1, 0, performance.elkCache))[0]?.ok).toBe(true)
    }
    expect(startup).toEqual(engines.map(engine => ({ engine: engine.label,
      hasOverride: engine.kind === 'agentic' && expected !== undefined,
      features: engine.kind === 'agentic' ? expected : undefined, cache: elkCache === 'on' ? '1' : '0' })))
  } finally {
    for (const [key, value] of prior) {
      if (value === undefined) delete host[key]
      else host[key] = value
    }
  }
})

test('browser performance options reject invalid cache policies and feature lists before startup', () => {
  for (const value of ['warm', '0', '']) expect(() => browserPerformanceOptions(new Map([['elk-cache', value]]))).toThrow('--elk-cache')
  for (const value of ['unknown', 'text-spans,text-spans', 'text-spans,']) expect(() => browserPerformanceOptions(new Map([['features', value]]))).toThrow('feature selection')
})

test('optional Dart comparator validates complete byte identity and memory arguments before any installation', () => {
  const dir = temp.dir(), bundle = join(dir, 'dart.js'), bytes = Buffer.from('globalThis.mermaidDartRender = () => "<svg/>"')
  writeFileSync(bundle, bytes)
  const sha = createHash('sha256').update(bytes).digest('hex')
  const options = new Map([['dart-bundle', bundle], ['dart-sha256', sha], ['dart-revision', 'mermaid-v0.3.1@f53b343b'], ['memory-passes', '1']])
  const result = browserDiagnosticsOptions(options)
  expect(result.memoryPasses).toBe(1)
  expect(result.dart?.bytes).toEqual(bytes)
  expect(result.dart?.revision).toBe('mermaid-v0.3.1@f53b343b')
  expect(browserDiagnosticsOptions(new Map())).toEqual({ memoryPasses: 0 })
  for (const passes of ['-1', '1.2', 'NaN', 'Infinity', '', ' ', '0x1', '1e2']) expect(() => browserDiagnosticsOptions(new Map([['memory-passes', passes]]))).toThrow('nonnegative integer')
  expect(() => browserDiagnosticsOptions(new Map([['dart-bundle', bundle]]))).toThrow('together')
  expect(() => browserDiagnosticsOptions(new Map([...options, ['dart-sha256', '0'.repeat(64)]]))).toThrow('SHA-256 mismatch')
  expect(() => browserDiagnosticsOptions(new Map([...options, ['dart-revision', 'revision\nwrong']]))).toThrow('printable revision')
})

test.each(['dart', 'bezel'] as const)('%s browser comparator calls its function export and preserves renderer failures', async kind => {
  const host = globalThis as unknown as Record<string, unknown>
  const priorDocument = host.document, priorDart = host.mermaidDartRender, priorCache = host.AGENTIC_MERMAID_ELK_CACHE, priorFeatures = host.AGENTIC_MERMAID_EXPERIMENTS
  const calls: string[] = []
  host.document = { querySelectorAll: () => [] }
  host.mermaidDartRender = (source: string) => { calls.push(source); if (source === 'unsupported') throw new Error('Dart unsupported'); return '<svg/>' }
  const page = { goto: async () => {}, addScriptTag: async () => {}, evaluate: async (fn: (arg: unknown) => unknown, arg: unknown) => fn(arg) } as unknown as Page
  try {
    const rows = await renderPass(page, { label: kind, name: kind, version: 'test', root: '/unused', kind, bundle: 'test.js', global: 'mermaidDartRender', identity: { integrity: 'test' } }, 'http://localhost', [{ id: 'ok', source: 'supported' }, { id: 'bad', source: 'unsupported' }], 1, 0)
    expect(calls).toEqual(['supported', 'unsupported'])
    expect(rows[0]?.ok).toBe(true)
    expect(rows[1]?.ok).toBe(false)
    expect(rows[1]?.error).toContain('Dart unsupported')
  } finally {
    for (const [key, value] of [['document', priorDocument], ['mermaidDartRender', priorDart], ['AGENTIC_MERMAID_ELK_CACHE', priorCache], ['AGENTIC_MERMAID_EXPERIMENTS', priorFeatures]] as const) {
      if (value === undefined) delete host[key]
      else host[key] = value
    }
  }
})

test('Bezel comparator refuses changed wrapper bytes before browser startup', () => {
  const root = temp.dir(), bytes = Buffer.from('globalThis.bezelRender = () => "<svg/>"')
  writeFileSync(join(root, 'bezel.js'), bytes)
  writeFileSync(join(root, 'manifest.json'), JSON.stringify({ version: '0.2.18', revision: 'b'.repeat(40), bundleSha256: createHash('sha256').update(bytes).digest('hex') }))
  expect(bezelEngine(root)).toMatchObject({ kind: 'bezel', global: 'bezelRender', identity: { revision: 'b'.repeat(40) } })
  writeFileSync(join(root, 'bezel.js'), 'changed')
  expect(() => bezelEngine(root)).toThrow('SHA-256 mismatch')
})

test('browser memory population pairs all rounds and engines before deduplicating sources', () => {
  const inputs = [{ id: 'a', source: 'same source' }, { id: 'alias', source: 'same source' }, { id: 'failed', source: 'bad' }, { id: 'missing', source: 'missing round' }, { id: 'extra', source: 'distinct source' }]
  const samples: BrowserSample[] = []
  for (const engine of ['candidate', 'dart']) for (const round of [1, 2]) for (const input of inputs) {
    if (engine === 'candidate' && round === 2 && input.id === 'missing') continue
    samples.push({ engine, round, id: input.id, ms: 1, ok: !(engine === 'dart' && round === 2 && input.id === 'failed') })
  }
  // A duplicated successful row cannot replace a missing round.
  samples.push({ engine: 'candidate', round: 1, id: 'missing', ms: 1, ok: true })
  expect(sharedMemoryInputs(inputs, samples, ['candidate', 'dart'], 2)).toEqual([
    { id: 'a', source: 'same source', occurrenceIds: ['a', 'alias'] },
    { id: 'extra', source: 'distinct source', occurrenceIds: ['extra'] },
  ])
})

test('an empty common browser memory population is explicitly incomplete without launching a browser', async () => {
  const result = await browserMemoryDiagnostics({ engines: [], origin: 'http://unused.invalid', inputs: [], rounds: 3, passes: 1, out: '/unused', executablePath: '/unused/chromium' })
  expect(result.status).toBe('incomplete')
  expect(result.error).toContain('No distinct source succeeded')
  expect(result.runs).toEqual([])
})

test('agent workload completes a verified edit and renders the original and added labels', () => {
  const svg = renderAgentEdit(api, agentEditCase.source)
  expect(missingSvgLabels(svg, agentEditCase.expectedSvgLabels)).toEqual([])
  const dropsEdits = Object.create(api) as typeof api
  Object.defineProperty(dropsEdits, 'mutate', { value: (diagram: unknown) => ({ ok: true, value: diagram }) })
  expect(() => renderAgentEdit(dropsEdits, agentEditCase.source)).toThrow('requested or preserved facts were lost')
})

test.each(releaseBenchCases().filter(input => input.id.includes('cyclic-labelled')).flatMap(input =>
  (['elk', 'agentic'] as const).map(backend => ({ input, backend, id: input.id }))))('frozen labelled workload $id retains exact renderer-owned labels with $backend', ({ input, backend }) => {
  expect(input.expectedSvgLabels!.length).toBeGreaterThan(0)
  const svg = api.renderMermaidSVG(input.source, { graphLayout: { backend } })
  expect(missingSvgLabels(svg, input.expectedSvgLabels)).toEqual([])
  if (input.id === 'requirement:cyclic-labelled-relations') expect(missingSvgLabels(svg.replace('bench suite', ''), input.expectedSvgLabels)).toContain('Doc Ref: bench suite')
})

test.each(['off', 'normal'] as const)('consumed %s-cache worker forwards selection, serializes the full receipt and retains typed declines', async layoutCache => {
  const directory = temp.dir(), entry = join(directory, 'index.js'), job = join(directory, 'job.json'), result = join(directory, 'result.json')
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ type: 'module' }))
  writeFileSync(entry, `
    if (process.env.AGENTIC_MERMAID_EXPERIMENTS !== process.env.AM_EXPECT_LAYOUT_EXPERIMENTS
      || process.env.AGENTIC_MERMAID_ELK_CACHE !== process.env.AM_EXPECT_ELK_CACHE) throw new Error('asymmetric startup cache policy')
    const originalFrom = Buffer.from
    let expected, encoded = false, prior
    Buffer.from = function(value, ...args) {
      if (value === expected) encoded = true
      return Reflect.apply(originalFrom, Buffer, [value, ...args])
    }
    function render(source, options, text) {
      if (options?.graphLayout?.backend !== 'agentic' || options.graphLayout.fallback !== 'none'
        || typeof options.onConfigDiagnostic !== 'function') throw new Error('selection or diagnostic policy was dropped')
      if (prior && !prior.consumed) throw new Error('receipt was not completely consumed')
      if (source === 'unsupported') {
        const error = new Error('unsupported fixture')
        error.code = 'GRAPH_LAYOUT_UNSUPPORTED'
        throw error
      }
      expected = text ? 'terminal ✓' : '<svg xmlns="http://www.w3.org/2000/svg"><text>✓</text></svg>'
      encoded = false
      const state = prior = { consumed: false }
      return { output: expected, receipt: {
        layoutDecisions: [{ requested: 'agentic', fallback: 'none', selected: 'agentic',
          attempts: [{ backend: 'agentic', outcome: 'selected' }], implementation: 'fixture' }],
        get consumption() {
          if (!encoded) throw new Error('output UTF-8 was not encoded before receipt consumption')
          state.consumed = true
          return 'complete'
        },
      } }
    }
    export function renderMermaidSVG() { throw new Error('plain rendering was used') }
    export function renderMermaidASCII() { throw new Error('plain rendering was used') }
    export let declinedPixelCalls = 0
    export function renderMermaidSVGWithReceipt(source, options) {
      if (source === 'unsupported') declinedPixelCalls++
      const value = render(source, options, false)
      return { svg: value.output, receipt: value.receipt }
    }
    export function renderMermaidASCIIWithReceipt(source, options) {
      const value = render(source, options, true)
      return { text: value.output, receipt: value.receipt }
    }
  `)
  writeFileSync(join(directory, 'agent.js'), `
    import { declinedPixelCalls } from './index.js'
    export function layoutMermaidWithReceipt(source, options) {
      if (declinedPixelCalls !== 3) throw new Error('quality ran before all timed samples')
      if (source !== 'supported' || !options.debug || options.graphLayout.backend !== 'agentic') throw new Error('wrong quality request')
      return { layout: {}, receipt: { layoutDecisions: [{ requested: 'agentic', selected: 'agentic' }] } }
    }
    export function measureQuality() { return { edgeCrossings: 0, minimumLabelClearance: Infinity } }
  `)
  writeFileSync(job, JSON.stringify({ entry, mode: 'time', layoutMode: 'agentic', layoutCache, consumeReceipt: true, collectQuality: true, reps: 1,
    inputs: [{ id: 'ok', family: 'flowchart', source: 'supported' }, { id: 'declined', family: 'flowchart', source: 'unsupported' }] }))
  const child = Bun.spawn(['node', '--no-warnings', join(import.meta.dir, '../../eval/benchmark/release-bench-worker.ts'), job, result], {
    stdout: 'ignore', stderr: 'pipe', timeout: 15_000, killSignal: 'SIGKILL',
    env: { ...process.env, AGENTIC_MERMAID_EXPERIMENTS: 'indexed-layout', AGENTIC_MERMAID_ELK_CACHE: 'wrong',
      AM_EXPECT_LAYOUT_EXPERIMENTS: layoutCache === 'normal' ? 'text-spans,position-cache' : 'text-spans', AM_EXPECT_ELK_CACHE: layoutCache === 'normal' ? '1' : '0' },
  })
  const [status, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
  expect(stderr).toBe('')
  expect(status).toBe(0)
  const output = JSON.parse(readFileSync(result, 'utf8'))
  expect(output.results[0].svg.ok).toBe(true)
  expect(output.results[0].deterministic).toBe(true)
  expect(output.results[0].layout.decisions[0].selected).toBe('agentic')
  expect(output.results[0].layout.receipt.bytes).toBeGreaterThan(0)
  expect(output.results[0].asciiLayout.decisions[0].selected).toBe('agentic')
  expect(output.results[0].quality).toMatchObject({ status: 'measured', scope: 'separate-public-layout-after-timing',
    metrics: { edgeCrossings: 0, minimumLabelClearance: { unavailable: 'non-finite metric', value: 'Infinity' } } })
  expect(output.results[1].svg).toMatchObject({ ok: false, code: 'GRAPH_LAYOUT_UNSUPPORTED', category: 'unsupported' })
  expect(output.results[1].layout).toBeUndefined()
  expect(output.results[1].quality.status).toBe('unavailable')
}, 20000)

test('the agent benchmark forwards its selected render policy through verification and final rendering', () => {
  const options = layoutRenderOptions('agentic')!
  let verifiedOptions: unknown, finalSource: string | undefined
  const observed = Object.create(api) as typeof api
  Object.defineProperty(observed, 'verifyMermaid', { value: (diagram: Parameters<typeof api.verifyMermaid>[0], verifyOptions: Parameters<typeof api.verifyMermaid>[1]) => {
    verifiedOptions = verifyOptions?.renderOptions
    return api.verifyMermaid(diagram, verifyOptions)
  } })
  const svg = renderAgentEdit(observed, agentEditCase.source, options, source => {
    finalSource = source
    return api.renderMermaidSVG(source, options)
  })
  expect(verifiedOptions).toBe(options)
  expect(finalSource).toContain('Cache')
  expect(missingSvgLabels(svg, agentEditCase.expectedSvgLabels)).toEqual([])
})

test('baseline resolution survives a changed latest tag across CLI retries', async () => {
  const dir = temp.dir(), lock = join(dir, 'baseline.json'), registry = join(dir, 'registry.json'), npm = join(dir, 'npm')
  writeFileSync(npm, '#!/bin/sh\ncat "$FAKE_REGISTRY"\n')
  chmodSync(npm, 0o755)
  const integrity = 'sha512-YWJjZA=='
  writeFileSync(registry, JSON.stringify({ version: '0.4.1', 'dist.integrity': integrity }))
  const invoke = async () => {
    const proc = Bun.spawn([process.execPath, join(import.meta.dir, '../../eval/benchmark/release-baseline.ts'), 'latest', lock], {
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, FAKE_REGISTRY: registry },
      stdout: 'ignore', stderr: 'pipe', timeout: 10_000, killSignal: 'SIGKILL',
    })
    const [status, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()])
    return { status, stderr }
  }
  expect(await invoke()).toEqual({ status: 0, stderr: '' })
  writeFileSync(registry, JSON.stringify({ version: '0.4.2', 'dist.integrity': 'sha512-ZWZnaA==' }))
  expect(await invoke()).toEqual({ status: 0, stderr: '' })
  expect(JSON.parse(readFileSync(lock, 'utf8'))).toEqual({ requested: 'latest', version: '0.4.1', integrity })
})


test('failed editor benchmark reruns invalidate a previous completed report', async () => {
  const out = temp.dir(), site = temp.dir(), report = join(out, 'editor-preview.json')
  writeFileSync(report, JSON.stringify({ status: 'completed', samples: ['stale-run'] }))
  const proc = Bun.spawn([process.execPath, join(import.meta.dir, '../../eval/benchmark/editor-preview-bench.ts'), '--site', site, '--out', out, '--executable', join(site, 'nonexistent-chromium')], {
    stdout: 'ignore', stderr: 'ignore', timeout: 10_000, killSignal: 'SIGKILL',
  })
  expect(await proc.exited).not.toBe(0)
  const failed = JSON.parse(readFileSync(report, 'utf8'))
  expect(failed.status).toBe('failed')
  expect(failed.error).toContain('nonexistent-chromium')
  expect(failed).not.toHaveProperty('samples')
})
