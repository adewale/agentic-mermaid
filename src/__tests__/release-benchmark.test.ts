// Exercise the publication decision and scorecard math with controlled worker
// observations. No clocks, npm registry or browser launch in these tests.
import { describe, expect, test } from 'bun:test'
import { chmodSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { report, type EngineRun, type Group, type Input } from '../../eval/benchmark/release-bench.ts'
import { browserDiagnosticsOptions, browserScorecard, renderPass, type BrowserSample } from '../../eval/benchmark/release-browser-bench.ts'
import { browserMemoryDiagnostics, sharedMemoryInputs } from '../../eval/benchmark/browser-memory.ts'
import type { Page } from 'playwright'
import { browserPerformanceOptions, configureAgenticEngines } from '../../eval/benchmark/browser-config.ts'
import type { Engine } from '../../eval/benchmark/release-browser-bench.ts'
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

test('Dart browser comparator calls its function export and preserves renderer failures', async () => {
  const host = globalThis as unknown as Record<string, unknown>
  const priorDocument = host.document, priorDart = host.mermaidDartRender, priorCache = host.AGENTIC_MERMAID_ELK_CACHE, priorFeatures = host.AGENTIC_MERMAID_EXPERIMENTS
  const calls: string[] = []
  host.document = { querySelectorAll: () => [] }
  host.mermaidDartRender = (source: string) => { calls.push(source); if (source === 'unsupported') throw new Error('Dart unsupported'); return '<svg/>' }
  const page = { goto: async () => {}, addScriptTag: async () => {}, evaluate: async (fn: (arg: unknown) => unknown, arg: unknown) => fn(arg) } as unknown as Page
  try {
    const rows = await renderPass(page, { label: 'dart', name: 'mermaid-dart', version: 'test', root: '/unused', kind: 'dart', bundle: 'dart.js', global: 'mermaidDartRender', identity: { integrity: 'test' } }, 'http://localhost', [{ id: 'ok', source: 'supported' }, { id: 'bad', source: 'unsupported' }], 1, 0)
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
