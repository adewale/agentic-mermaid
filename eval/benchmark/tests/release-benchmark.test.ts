// Exercise the publication decision and scorecard math with controlled worker
// observations. Registry and browser failures are controlled in subprocess probes.
import { describe, expect, test } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { createHash } from 'node:crypto'
import { report, type EngineRun, type Group, type Input } from '../release-bench.ts'
import { browserDiagnosticsOptions, browserScorecard, renderPass, type BrowserSample } from '../release-browser-bench.ts'
import { browserMemoryDiagnostics, sharedMemoryInputs } from '../browser-memory.ts'
import { bezelEngine } from '../bezel.ts'
import type { Page } from 'playwright'
import { browserPerformanceOptions, configureAgenticEngines } from '../browser-config.ts'
import type { Engine } from '../release-browser-bench.ts'
import { missingSvgLabels, renderAgentEdit, agentEditCase } from '../release-bench-fidelity.ts'
import * as api from '../../../src/agent/index.ts'
import { useTempDirs } from './helpers/temp-dir.ts'
import { useTestChildren } from './helpers/test-child.ts'
import { linuxRssHighWater } from '../release-memory.ts'
import { frozenRuntimePolicy, installedNpmPackagePin, inspectAgenticRuntime, assertMatchedAgenticRuntimes, assertHistoricalAgenticRuntimes, assertNormalizedNpmRuntimes, type RuntimeReceipt } from '../release-baseline.ts'

const temp = useTempDirs()
const runChild = useTestChildren(10_000)
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
    after.memory.get('corpus')!.rss = {
      workerStart: { phase: 'after-static-imports-before-job-and-package-loading', currentRssBytes: 1024, maxRssBytes: 2048, linuxVmHwmBytes: null, linuxVmHwmUnavailableReason: 'not-linux' },
      beforeMemoryWork: { phase: 'after-package-imports-before-memory-warmup', currentRssBytes: 2048, maxRssBytes: 4096, linuxVmHwmBytes: null, linuxVmHwmUnavailableReason: 'not-linux' },
      afterMemoryWork: { phase: 'after-memory-measurement-and-final-gc', currentRssBytes: 1024, maxRssBytes: 4096, linuxVmHwmBytes: null, linuxVmHwmUnavailableReason: 'not-linux' },
    }
    const diagnosticReport = decision(inputs, before, after)
    expect(diagnosticReport.ok).toBe(true)
    expect(diagnosticReport.markdown).toContain('Linux current-mm VmHWM | not recorded | not-linux |')
    expect(diagnosticReport.markdown).toContain('process-lifetime peak RSS (getrusage)')
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

  test('declared field prefixes allow either complete display form without matching another value', () => {
    const expected = ['Requirement 1']
    expect(missingSvgLabels('<svg><text>Requirement 1</text></svg>', expected, ['Text: '])).toEqual([])
    expect(missingSvgLabels('<svg><text>Text: Requirement 1</text></svg>', expected, ['Text: '])).toEqual([])
    expect(missingSvgLabels('<svg><text>Text: Requirement 10</text></svg>', expected, ['Text: '])).toEqual(expected)
    expect(missingSvgLabels('<svg><text>Other: Requirement 1</text></svg>', expected, ['Text: '])).toEqual(expected)
    expect(missingSvgLabels('<svg><text>Text: Requirement 1</text></svg>', expected)).toEqual(expected)
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
  const priorDocument = host.document, priorApi = host.benchmarkApi, priorCache = host.AGENTIC_MERMAID_ELK_CACHE, priorExperiments = host.AGENTIC_MERMAID_EXPERIMENTS, priorAssertions = host.AGENTIC_MERMAID_SCENE_ASSERTIONS
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
    for (const [key, value] of [['document', priorDocument], ['benchmarkApi', priorApi], ['AGENTIC_MERMAID_ELK_CACHE', priorCache], ['AGENTIC_MERMAID_EXPERIMENTS', priorExperiments], ['AGENTIC_MERMAID_SCENE_ASSERTIONS', priorAssertions]] as const) {
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
  const prior = new Map(['document', 'browserConfigurationApi', 'AGENTIC_MERMAID_EXPERIMENTS', 'AGENTIC_MERMAID_ELK_CACHE', 'AGENTIC_MERMAID_SCENE_ASSERTIONS'].map(key => [key, host[key]]))
  host.document = { querySelectorAll: () => [] }
  host.browserConfigurationApi = { renderMermaidSVG: () => '<svg/>', render: () => '<svg/>', initialize: () => {} }
  const startup: Array<{ engine: string; hasOverride: boolean; features: unknown; cache: unknown; assertions: unknown }> = []
  try {
    for (const engine of engines) {
      const page = {
        // Real navigation creates a fresh global. Seed a stale override here
        // to catch accidental preservation or conversion to an empty list.
        goto: async () => { host.AGENTIC_MERMAID_EXPERIMENTS = 'stale'; host.AGENTIC_MERMAID_SCENE_ASSERTIONS = '1' },
        evaluate: async (fn: (arg: unknown) => unknown, arg: unknown) => fn(arg),
        addScriptTag: async () => { startup.push({ engine: engine.label, hasOverride: Object.hasOwn(host, 'AGENTIC_MERMAID_EXPERIMENTS'), features: host.AGENTIC_MERMAID_EXPERIMENTS, cache: host.AGENTIC_MERMAID_ELK_CACHE, assertions: host.AGENTIC_MERMAID_SCENE_ASSERTIONS }) },
      } as unknown as Page
      expect((await renderPass(page, engine, 'http://localhost', [{ id: 'one', source: 'flowchart LR\n A-->B' }], 1, 0, performance.elkCache))[0]?.ok).toBe(true)
    }
    expect(startup).toEqual(engines.map(engine => ({ engine: engine.label,
      hasOverride: engine.kind === 'agentic' && expected !== undefined,
      features: engine.kind === 'agentic' ? expected : undefined, cache: elkCache === 'on' ? '1' : '0', assertions: '0' })))
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

test.each([false, true])('installed npm identity follows the exact module root (aliased prefix=%s)', alias => {
  const dir = temp.dir(), physical = join(dir, 'physical'), logical = alias ? join(dir, 'alias', 'deep', 'consumer') : physical
  const root = join(physical, 'node_modules', 'example-peer'), nested = join(root, 'node_modules', 'example-peer')
  mkdirSync(nested, { recursive: true })
  if (alias) { mkdirSync(join(dir, 'alias', 'deep'), { recursive: true }); symlinkSync(physical, logical, 'dir') }
  for (const path of [root, nested]) writeFileSync(join(path, 'package.json'), JSON.stringify({ name: 'example-peer', version: '1.2.3' }))
  const integrity = `sha512-${Buffer.alloc(64, 0x61).toString('base64')}`, nestedIntegrity = `sha512-${Buffer.alloc(64, 0x62).toString('base64')}`
  const key = relative(logical, realpathSync(root)).split('\\').join('/')
  const nestedKey = relative(logical, realpathSync(nested)).split('\\').join('/')
  const lockPath = join(logical, 'node_modules/.package-lock.json')
  const packages = { [key]: { version: '1.2.3', integrity }, [nestedKey]: { version: '1.2.3', integrity: nestedIntegrity } }
  writeFileSync(lockPath, JSON.stringify({ packages }))
  expect(installedNpmPackagePin(logical, join(logical, 'node_modules/example-peer'), 'example-peer', '1.2.3')).toEqual({ version: '1.2.3', integrity, packageRoot: realpathSync(root), lockKey: key })
  expect(() => installedNpmPackagePin(logical, root, 'example-peer', '2.0.0')).toThrow('name/version differs')
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'other-peer', version: '1.2.3' }))
  expect(() => installedNpmPackagePin(logical, root, 'example-peer', '1.2.3')).toThrow('name/version differs')
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'example-peer' }))
  expect(() => installedNpmPackagePin(logical, root, 'example-peer', undefined as unknown as string)).toThrow('name/version differs')
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'example-peer', version: '1.2.3' }))
  writeFileSync(lockPath, JSON.stringify({ packages: { [key]: { version: '1.2.3' } } }))
  expect(() => installedNpmPackagePin(logical, root, 'example-peer', '1.2.3')).toThrow('SHA-512 identity')
  writeFileSync(lockPath, JSON.stringify({ packages: { [key]: { version: '2.0.0', integrity } } }))
  expect(() => installedNpmPackagePin(logical, root, 'example-peer', '1.2.3')).toThrow('version/SHA-512 identity')
  writeFileSync(lockPath, JSON.stringify({ packages: { [key]: { name: 'other-peer', version: '1.2.3', integrity } } }))
  expect(() => installedNpmPackagePin(logical, root, 'example-peer', '1.2.3')).toThrow('name/version/SHA-512 identity')
  writeFileSync(lockPath, JSON.stringify({ packages: { [key]: { name: 'example-peer', version: '1.2.3', integrity } } }))
  expect(installedNpmPackagePin(logical, root, 'example-peer', '1.2.3').integrity).toBe(integrity)
  // Exact 64-byte canonical identities are required. The changed padding bits
  // below decode to the same bytes but are not their canonical base64 spelling.
  const invalidIntegrities = [
    'sha512-YWJjZA==', `sha512-${Buffer.alloc(63).toString('base64')}`, `sha512-${Buffer.alloc(65).toString('base64')}`,
    integrity.slice(0, -2), `${integrity}=`, `${integrity.slice(0, -3)}R==`,
    integrity.replace('sha512-', 'sha256-'), integrity.replace('sha512-', 'sha512-!'), `${integrity.slice(0, 12)} ${integrity.slice(12)}`,
  ]
  for (const invalid of invalidIntegrities) {
    writeFileSync(lockPath, JSON.stringify({ packages: { [key]: { version: '1.2.3', integrity: invalid } } }))
    expect(() => installedNpmPackagePin(logical, root, 'example-peer', '1.2.3')).toThrow('SHA-512 identity')
  }
  writeFileSync(lockPath, JSON.stringify({ packages: { [key]: { version: '1.2.3', integrity }, [`${key}/.`]: { version: '1.2.3', integrity } } }))
  expect(() => installedNpmPackagePin(logical, root, 'example-peer', '1.2.3')).toThrow('found 2')
  writeFileSync(lockPath, JSON.stringify({ packages: { [nestedKey]: { version: '1.2.3', integrity } } }))
  expect(() => installedNpmPackagePin(logical, root, 'example-peer', '1.2.3')).toThrow('found 0')
  if (alias) {
    const other = join(dir, 'peer')
    mkdirSync(other)
    writeFileSync(join(other, 'package.json'), JSON.stringify({ name: 'example-peer', version: '1.2.3' }))
    symlinkSync(root, join(dir, 'alias', 'deep', 'peer'), 'dir')
    writeFileSync(lockPath, JSON.stringify({ packages: { '../peer': { version: '1.2.3', integrity } } }))
    expect(() => installedNpmPackagePin(logical, root, 'example-peer', '1.2.3')).toThrow('ambiguous installed npm lock path')
  }
  const mermaidRoot = join(logical, 'node_modules/agentic-mermaid'), evidence = join(dir, 'evidence')
  mkdirSync(mermaidRoot)
  writeFileSync(join(mermaidRoot, 'package.json'), JSON.stringify({ name: 'agentic-mermaid', version: '1.0.0', dependencies: { 'example-peer': '1.2.3' } }))
  let requestedRoot = mermaidRoot
  if (!alias) {
    // A direct module alias may sit below an unrelated consumer's npm lock.
    const unrelated = join(dir, 'unrelated')
    mkdirSync(join(unrelated, 'node_modules'), { recursive: true })
    writeFileSync(join(unrelated, 'node_modules/.package-lock.json'), JSON.stringify({ packages: {} }))
    requestedRoot = join(unrelated, 'module-alias')
    symlinkSync(mermaidRoot, requestedRoot, 'dir')
  }
  const policy = { source: dir, roots: ['example-peer'], overrides: { 'example-peer': '1.2.3' }, packages: { 'example-peer': { version: '1.2.3', integrity } } }
  writeFileSync(lockPath, JSON.stringify({ packages }))
  expect(inspectAgenticRuntime(requestedRoot, policy, evidence, 'matched').graph)
    .toEqual([{ name: 'example-peer', version: '1.2.3', integrity, dependencies: [] }])
  for (const [label, pin] of [
    ['missing', undefined], ['missing-integrity', { version: '1.2.3' }],
    ['malformed-integrity', { version: '1.2.3', integrity: 'not-a-digest' }],
    ['wrong-version', { version: '2.0.0', integrity }],
  ] as const) {
    const rejectedLock = JSON.stringify({ packages: { [nestedKey]: packages[nestedKey], ...(pin ? { [key]: pin } : {}) } })
    writeFileSync(lockPath, rejectedLock)
    expect(() => inspectAgenticRuntime(requestedRoot, policy, evidence, label)).toThrow()
    expect(JSON.parse(readFileSync(join(evidence, `${label}.runtime.json`), 'utf8')).graph)
      .toEqual([{ name: 'example-peer', version: '1.2.3', integrity: null, dependencies: [] }])
    expect(readFileSync(join(evidence, `${label}.installed-package-lock.json`), 'utf8')).toBe(rejectedLock)
  }
})

test('baseline resolution survives a changed latest tag across CLI retries', async () => {
  const dir = temp.dir(), lock = join(dir, 'baseline.json'), registry = join(dir, 'registry.json'), npm = join(dir, 'npm')
  writeFileSync(npm, '#!/bin/sh\ncat "$FAKE_REGISTRY"\n')
  chmodSync(npm, 0o755)
  const integrity = 'sha512-YWJjZA=='
  writeFileSync(registry, JSON.stringify({ version: '0.4.1', 'dist.integrity': integrity }))
  const invoke = async () => {
    const proc = Bun.spawn([process.execPath, join(import.meta.dir, '../release-baseline.ts'), 'latest', lock], {
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

test('archive acquisition pins the frozen runtime closure without changing shipped bytes', async () => {
  const physical = temp.dir(), dir = join(temp.dir(), 'aliased-root')
  symlinkSync(physical, dir, 'dir')
  const source = join(dir, 'source'), evidence = join(dir, 'evidence'), prefix = join(dir, 'consumer')
  mkdirSync(source)
  const archives = new Map<string, Buffer>()
  const pack = async (name: string, version: string, dependencies: Record<string, string> = {}) => {
    const root = join(dir, `${name}-${version}`), pkg = join(root, 'package'), path = join(root, 'package.tgz')
    mkdirSync(pkg, { recursive: true })
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name, version, dependencies }))
    if (name === 'agentic-mermaid') {
      mkdirSync(join(pkg, 'dist'))
      writeFileSync(join(pkg, 'dist/index.js'), "throw Error('BENCHMARK_WORKER_STARTED')")
    }
    // Fixture setup owns external processes too: keep tar and its pipes
    // under the same child deadline and cleanup as acquisition.
    const packed = await runChild('tar', ['-czf', path, '-C', root, 'package'])
    expect({ status: packed.status, stderr: packed.stderr }).toEqual({ status: 0, stderr: '' })
    const bytes = readFileSync(path), integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`
    archives.set(`/${name}-${version}.tgz`, bytes)
    return { path, integrity, dependencies }
  }
  const leaf = await pack('runtime-leaf', '1.0.0'), elk = await pack('elkjs', '0.11.0', { 'runtime-leaf': '^1.0.0' }), yaml = await pack('yaml', '2.9.0')
  await pack('runtime-leaf', '1.1.0'); await pack('elkjs', '0.11.1'); await pack('yaml', '2.9.1')
  const dependencies = { elkjs: '^0.11.0', yaml: '^2.9.0' }, archive = await pack('agentic-mermaid', '0.0.0', dependencies)
  writeFileSync(join(source, 'package.json'), JSON.stringify({ name: 'agentic-mermaid', version: '0.0.0', dependencies }))
  writeFileSync(join(source, 'bun.lock'), JSON.stringify({ packages: {
    elkjs: ['elkjs@0.11.0', '', { dependencies: elk.dependencies }, elk.integrity],
    yaml: ['yaml@2.9.0', '', {}, yaml.integrity],
    'runtime-leaf': ['runtime-leaf@1.0.0', '', {}, leaf.integrity],
  } }))
  const requested: string[] = []
  const registry = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch(request) {
    const path = new URL(request.url).pathname
    requested.push(path)
    const bytes = archives.get(path)
    if (bytes) return new Response(new Uint8Array(bytes), { headers: { 'content-type': 'application/octet-stream' } })
    const name = path.slice(1), versions = Object.fromEntries([...archives].filter(([key]) => key.startsWith(`/${name}-`)).map(([key, value]) => {
      const version = key.slice(name.length + 2, -4)
      return [version, { name, version, dependencies: name === 'elkjs' && version === '0.11.0' ? { 'runtime-leaf': '^1.0.0' } : {}, dist: { tarball: `${new URL(request.url).origin}${key}`, integrity: `sha512-${createHash('sha512').update(value).digest('base64')}` } }]
    }))
    return Response.json({ name, versions, 'dist-tags': { latest: Object.keys(versions).at(-1) } })
  } })
  try {
    const child = await runChild(process.execPath, [join(import.meta.dir, '../release-baseline.ts'), '--install', archive.path,
      '--prefix', prefix, '--runtime-source', source, '--out', evidence, '--label', 'candidate', '--expected-integrity', archive.integrity], {
      env: { ...process.env, npm_config_registry: `http://127.0.0.1:${registry.port}`, npm_config_cache: join(dir, 'npm-cache') },
    })
    expect({ status: child.status, stderr: child.stderr }).toEqual({ status: 0, stderr: '' })
    const policy = frozenRuntimePolicy(source), receipt = inspectAgenticRuntime(join(prefix, 'node_modules/agentic-mermaid'), policy, evidence, 'checked')
    expect(policy.overrides).toEqual({ elkjs: '0.11.0', 'runtime-leaf': '1.0.0', yaml: '2.9.0' })
    expect(receipt.graph.map(({ name, version, integrity }) => [name, version, integrity])).toEqual([
      ['elkjs', '0.11.0', elk.integrity], ['runtime-leaf', '1.0.0', leaf.integrity], ['yaml', '2.9.0', yaml.integrity],
    ])
    expect(JSON.parse(readFileSync(join(evidence, 'candidate.install-package.json'), 'utf8'))).toEqual({ private: true, overrides: { elkjs: '0.11.0', 'runtime-leaf': '1.0.0', yaml: '2.9.0' } })
    expect(receipt.locks.map(lock => lock.source)).toEqual(['source.bun.lock', 'package-lock.json', 'installed-package-lock.json'])
    expect(new Uint8Array(readFileSync(archive.path))).toEqual(new Uint8Array(archives.get('/agentic-mermaid-0.0.0.tgz')!))
    expect(requested.filter(path => path.endsWith('.tgz')).sort()).toEqual(['/elkjs-0.11.0.tgz', '/runtime-leaf-1.0.0.tgz', '/yaml-2.9.0.tgz'])
    // A legitimate older npm release omits a root added by current source.
    // Strict comparison must keep rejecting it; only explicit normalization
    // may project compatible roots, retaining the original archive and policy.
    const legacy = await pack('agentic-mermaid', '0.0.2', { elkjs: '^0.11.0' })
    const unknownRoot = await pack('agentic-mermaid', '0.0.3', { 'runtime-leaf': '^1.0.0' })
    const incompatible = await pack('agentic-mermaid', '0.0.4', { yaml: '^3.0.0' })
    const nonsemver = await pack('agentic-mermaid', '0.0.5', { yaml: 'latest' })
    const localRange = await pack('agentic-mermaid', '0.0.6', { yaml: 'file:/must-not-read-local-package' })
    const aliasRange = await pack('agentic-mermaid', '0.0.7', { yaml: 'npm:yaml@2.9.0' })
    const leadingZero = await pack('agentic-mermaid', '0.0.8', { yaml: '02.9.0' })
    const strictLegacy = await runChild(process.execPath, [join(import.meta.dir, '../release-baseline.ts'), '--install', legacy.path,
      '--prefix', join(dir, 'strict-legacy'), '--runtime-source', source, '--out', join(evidence, 'strict-legacy'), '--expected-integrity', legacy.integrity], {
      env: { ...process.env, npm_config_registry: `http://127.0.0.1:${registry.port}`, npm_config_cache: join(dir, 'npm-cache') },
    })
    expect(strictLegacy.status).not.toBe(0)
    expect(strictLegacy.stderr).toContain('declared runtime roots differ from frozen policy')
    const normalize = async (version: string, integrity: string, label: string) => runChild(process.execPath, ['-e', `
      import { installNormalizedNpmBaseline, frozenRuntimePolicy } from './eval/benchmark/release-baseline.ts'
      const acquired = installNormalizedNpmBaseline(${JSON.stringify({ requested: 'latest', version, integrity })},
        ${JSON.stringify(join(dir, label))}, frozenRuntimePolicy(${JSON.stringify(source)}), ${JSON.stringify(join(evidence, label))}, 'baseline')
      console.log(JSON.stringify(acquired))
    `], { cwd: join(import.meta.dir, '../../..'), env: { ...process.env, npm_config_registry: `http://127.0.0.1:${registry.port}`, npm_config_cache: join(dir, 'npm-cache') } })
    const normalized = await normalize('0.0.2', legacy.integrity, 'normalized-legacy')
    expect({ status: normalized.status, stderr: normalized.stderr }).toEqual({ status: 0, stderr: '' })
    const legacyReceipt = JSON.parse(normalized.stdout).runtime as RuntimeReceipt
    expect(legacyReceipt.policy).toMatchObject({ roots: ['elkjs'], packages: { elkjs: policy.packages.elkjs, 'runtime-leaf': policy.packages['runtime-leaf'] },
      normalization: { mode: 'normalized-npm-compound', basis: 'current-frozen-source-projected-to-verified-npm-roots', originalFrozenBaseline: false,
        sourceRoots: ['elkjs', 'yaml'], declaredRanges: { elkjs: '^0.11.0' }, archive: { name: 'agentic-mermaid', version: '0.0.2', integrity: legacy.integrity } } })
    expect(legacyReceipt.policy.packages.yaml).toBeUndefined()
    expect(legacyReceipt.policy.overrides).toEqual(policy.overrides)
    const retained = join(evidence, 'normalized-legacy')
    expect(readFileSync(join(retained, 'baseline.npm-archive/package.tgz'))).toEqual(readFileSync(legacy.path))
    expect(JSON.parse(readFileSync(join(retained, 'baseline.original-package.json'), 'utf8'))).toEqual({ name: 'agentic-mermaid', version: '0.0.2', dependencies: { elkjs: '^0.11.0' } })
    expect(legacyReceipt.graph).toEqual(receipt.graph.filter(row => row.name !== 'yaml'))
    expect(assertNormalizedNpmRuntimes(legacyReceipt, receipt)).toMatchObject({ mode: 'normalized-npm-compound', isolatedProductionGain: false,
      originalFrozenBaseline: false, baselineOnly: { roots: [], packages: [] }, candidateOnly: { roots: ['yaml'], packages: [{ name: 'yaml' }] } })
    expect(() => assertMatchedAgenticRuntimes([legacyReceipt, receipt])).toThrow('graphs differ')
    for (const [version, artifact, message] of [
      ['0.0.3', unknownRoot, /unknown current runtime root runtime-leaf/],
      ['0.0.4', incompatible, /does not admit frozen 2.9.0/],
      ['0.0.5', nonsemver, /does not admit frozen 2.9.0/],
      ['0.0.6', localRange, /does not admit frozen 2.9.0|npm install failed/],
      ['0.0.7', aliasRange, /does not admit frozen 2.9.0|npm install failed/],
      ['0.0.8', leadingZero, /does not admit frozen 2.9.0|npm install failed/],
    ] as const) {
      const rejected = await normalize(version, artifact.integrity, `rejected-${version}`)
      expect({ version, status: rejected.status }).not.toEqual({ version, status: 0 })
      expect(rejected.stderr).toMatch(message)
      expect(rejected.stderr).not.toContain('BENCHMARK_WORKER_STARTED')
      if (['0.0.3', '0.0.4', '0.0.5'].includes(version)) {
        const rejectedOut = join(evidence, `rejected-${version}`)
        expect(Object.values(JSON.parse(readFileSync(join(rejectedOut, 'baseline.installed-package-lock.json'), 'utf8')).packages))
          .toContainEqual(expect.objectContaining({ version, integrity: artifact.integrity }))
        expect(JSON.parse(readFileSync(join(rejectedOut, 'baseline.normalization-source-policy.json'), 'utf8'))).toEqual(policy)
      }
    }
    const corruptArchive = await normalize('0.0.2', elk.integrity, 'wrong-original-sri')
    expect(corruptArchive.status).not.toBe(0)
    expect(corruptArchive.stderr).toContain('original npm archive integrity differs from the locked baseline')
    expect(existsSync(join(dir, 'wrong-original-sri/package.json'))).toBe(false)
    const incompatibleLock = join(dir, 'incompatible-npm.json')
    writeFileSync(incompatibleLock, JSON.stringify({ requested: 'latest', version: '0.0.4', integrity: incompatible.integrity }))
    const nodeAcquisitionFiles = ['candidate.package-lock.json', 'candidate.installed-package-lock.json', 'candidate.runtime-policy.json']
    const nodeAcquisition = nodeAcquisitionFiles.map(file => readFileSync(join(evidence, file)))
    for (const [entry, baselineFlags] of [
      ['release-bench.ts', ['--baseline-npm', 'latest', '--baseline-lock', incompatibleLock]],
      ['release-browser-bench.ts', ['--baseline-lock', incompatibleLock, '--executable', '/must-not-launch-chromium']],
    ] as const) {
      const rejected = await runChild(process.execPath, [join(import.meta.dir, '..', entry), '--candidate-tarball', archive.path,
        '--candidate-sha256', createHash('sha256').update(readFileSync(archive.path)).digest('hex'), '--runtime-source', source,
        '--runtime-comparison', 'normalized-npm-compound', '--out', evidence, ...baselineFlags], {
        env: { ...process.env, npm_config_registry: `http://127.0.0.1:${registry.port}`, npm_config_cache: join(dir, 'npm-cache') },
      })
      expect(rejected.status).not.toBe(0)
      expect(rejected.stderr).toContain('npm baseline range yaml@^3.0.0 is unsupported or does not admit frozen 2.9.0')
      expect(rejected.stderr).not.toContain('BENCHMARK_WORKER_STARTED')
      expect(rejected.stderr).not.toContain('must-not-launch-chromium')
    }
    nodeAcquisitionFiles.forEach((file, index) => expect(readFileSync(join(evidence, file))).toEqual(nodeAcquisition[index]!))
    expect(Object.values(JSON.parse(readFileSync(join(evidence, 'browser-acquisition/candidate.installed-package-lock.json'), 'utf8')).packages))
      .toContainEqual(expect.objectContaining({ version: '0.0.0', integrity: archive.integrity }))
    const installed = join(prefix, 'node_modules/.package-lock.json')
    const lock = JSON.parse(readFileSync(installed, 'utf8')) as { packages: Record<string, { version: string; integrity: string }> }
    const yamlPin = Object.values(lock.packages).find(entry => entry.version === '2.9.0')!
    yamlPin.integrity = elk.integrity
    writeFileSync(installed, JSON.stringify(lock))
    expect(() => inspectAgenticRuntime(join(prefix, 'node_modules/agentic-mermaid'), policy, evidence, 'mismatch')).toThrow('version/integrity')
    expect(JSON.parse(readFileSync(join(evidence, 'mismatch.runtime.json'), 'utf8')).graph.find((row: { name: string }) => row.name === 'yaml').integrity).toBe(elk.integrity)
    expect(() => assertMatchedAgenticRuntimes([receipt, { ...receipt, graph: receipt.graph.slice(1) }])).toThrow('refusing to start benchmark workers or timing')
    // A registry can return a valid archive under the expected version while
    // its SRI differs from the frozen source. Every timing entry point must
    // reject that installed graph before importing the renderer or Chromium.
    const frozen = JSON.parse(readFileSync(join(source, 'bun.lock'), 'utf8'))
    frozen.packages.yaml[3] = elk.integrity
    writeFileSync(join(source, 'bun.lock'), JSON.stringify(frozen))
    const sha256 = createHash('sha256').update(readFileSync(archive.path)).digest('hex')
    for (const [entry, extra] of [
      ['release-bench.ts', ['--case', 'flowchart:tree-300']],
      ['release-browser-bench.ts', ['--executable', '/must-not-launch-chromium']],
      ['peer-bench.ts', ['--peers', 'agentic', '--workloads', 'flow5', '--json', join(evidence, 'peer.json'), '--markdown', join(evidence, 'peer.md')]],
    ] as const) {
      const report = join(evidence, entry), flags = entry === 'peer-bench.ts' ? [] : ['--out', report]
      const failed = await runChild(process.execPath, [join(import.meta.dir, '..', entry), '--candidate-tarball', archive.path,
        '--candidate-sha256', sha256, '--runtime-source', source, ...flags, ...extra], {
        env: { ...process.env, npm_config_registry: `http://127.0.0.1:${registry.port}`, npm_config_cache: join(dir, 'npm-cache') },
      })
      expect(failed.status).not.toBe(0)
      expect(failed.stderr).toContain('runtime dependency yaml@2.9.0 differs from frozen version/integrity 2.9.0')
      expect(failed.stderr).not.toContain('BENCHMARK_WORKER_STARTED')
      expect(failed.stderr).not.toContain('must-not-launch-chromium')
      expect(JSON.parse(readFileSync(entry === 'peer-bench.ts' ? join(evidence, 'peer.json') : join(report, entry === 'release-bench.ts' ? 'report.json' : 'browser-report.json'), 'utf8')).status).toBe('failed')
    }
    // The baseline must pass first. A candidate-only graph mismatch still
    // prevents A/A1 from starting, rather than being discovered after controls.
    frozen.packages.yaml[3] = yaml.integrity
    writeFileSync(join(source, 'bun.lock'), JSON.stringify(frozen))
    const extraRuntime = await pack('runtime-extra', '1.0.0')
    const badCandidate = await pack('agentic-mermaid', '0.0.1', { ...dependencies, 'runtime-extra': '^1.0.0' })
    const qualificationOut = join(evidence, 'qualification'), candidateSha = createHash('sha256').update(readFileSync(badCandidate.path)).digest('hex')
    const failed = await runChild(process.execPath, [join(import.meta.dir, '../qualify-peer-performance.ts'),
      '--baseline-tarball', archive.path, '--baseline-sha256', sha256, '--candidate-tarball', badCandidate.path, '--candidate-sha256', candidateSha,
      '--runtime-source', source, '--out', qualificationOut, '--quick', '--rounds', '1'], {
      env: { ...process.env, npm_config_registry: `http://127.0.0.1:${registry.port}`, npm_config_cache: join(dir, 'npm-cache') },
    })
    expect(failed.status).not.toBe(0)
    expect(failed.stderr).toContain('candidate: runtime dependency runtime-extra@1.0.0 differs from frozen version/integrity (unlocked)')
    expect(JSON.parse(readFileSync(join(qualificationOut, 'acquisition/baseline.runtime.json'), 'utf8')).graph).toEqual(receipt.graph)
    expect(JSON.parse(readFileSync(join(qualificationOut, 'acquisition/candidate.runtime.json'), 'utf8')).graph.some((entry: { name: string }) => entry.name === 'runtime-extra')).toBe(true)
    expect(JSON.parse(readFileSync(join(qualificationOut, 'qualification-status.json'), 'utf8'))).toMatchObject({ status: 'incomplete', complete: false, steps: [] })
    expect(existsSync(join(qualificationOut, 'aa-1.json'))).toBe(false)
    const candidateSource = join(dir, 'candidate-source'), historicalOut = join(evidence, 'historical')
    mkdirSync(candidateSource)
    writeFileSync(join(candidateSource, 'package.json'), JSON.stringify({ name: 'agentic-mermaid', version: '0.0.1', dependencies: badCandidate.dependencies }))
    writeFileSync(join(candidateSource, 'bun.lock'), JSON.stringify({ packages: { ...frozen.packages, 'runtime-extra': ['runtime-extra@1.0.0', '', {}, extraRuntime.integrity] } }))
    yamlPin.integrity = yaml.integrity
    writeFileSync(installed, JSON.stringify(lock))
    const historical = await runChild(process.execPath, [join(import.meta.dir, '../release-baseline.ts'), '--install', badCandidate.path,
      '--prefix', join(dir, 'historical-consumer'), '--runtime-source', candidateSource, '--out', historicalOut, '--label', 'candidate',
      '--expected-integrity', badCandidate.integrity, '--compare-root', join(prefix, 'node_modules/agentic-mermaid'), '--compare-runtime-source', source,
      '--runtime-comparison', 'historical-compound'], {
      env: { ...process.env, npm_config_registry: `http://127.0.0.1:${registry.port}`, npm_config_cache: join(dir, 'npm-cache') },
    })
    expect({ status: historical.status, stderr: historical.stderr }).toEqual({ status: 0, stderr: '' })
    expect(JSON.parse(readFileSync(join(historicalOut, 'candidate.runtime-comparison.json'), 'utf8'))).toMatchObject({
      mode: 'historical-compound', isolatedProductionGain: false, baselineOnly: { roots: [], packages: [] },
      candidateOnly: { roots: ['runtime-extra'], packages: [{ name: 'runtime-extra', version: '1.0.0', integrity: extraRuntime.integrity }] },
    })
  } finally { registry.stop(true) }
}, 30_000)

test('normalized npm mode cannot weaken a Git or tarball comparison', async () => {
  for (const [entry, required] of [['release-bench.ts', '--baseline-npm'], ['release-browser-bench.ts', '--baseline-lock']] as const) {
    const rejected = await runChild(process.execPath, [join(import.meta.dir, '..', entry), '--runtime-comparison', 'normalized-npm-compound',
      '--baseline-tarball', '/must-not-read-baseline.tgz', '--baseline-sha256', '0'.repeat(64)])
    expect(rejected.status).not.toBe(0)
    expect(rejected.stderr).toContain(`Normalized npm comparison requires ${required}`)
    expect(rejected.stderr).not.toContain('ENOENT')
  }
})

test('historical runtime comparisons allow attributed roots while retaining strict shared identities and edges', () => {
  const shared = { name: 'elkjs', version: '0.11.0', integrity: 'sha512-YWJjZA==', dependencies: [] as string[] }
  const receipt = (side: 'old' | 'new'): RuntimeReceipt => ({
    policy: { source: `/${side}`, roots: ['elkjs', `${side}-root`], overrides: {}, packages: {} }, integritySource: 'npm-installed-lock', locks: [],
    graph: [shared, { name: `${side}-leaf`, version: '1.0.0', integrity: 'sha512-ZWZnaA==', dependencies: [] },
      { name: `${side}-root`, version: '1.0.0', integrity: 'sha512-aWprbA==', dependencies: ['elkjs@0.11.0', `${side}-leaf@1.0.0`] }],
  })
  const baseline = receipt('old'), candidate = receipt('new')
  const comparison = assertHistoricalAgenticRuntimes(baseline, candidate)
  expect(comparison).toMatchObject({ mode: 'historical-compound', isolatedProductionGain: false, sharedPackages: ['elkjs'], baselineOnly: { roots: ['old-root'] }, candidateOnly: { roots: ['new-root'] } })
  expect(comparison.baselineOnly.packages.map(row => row.name)).toEqual(['old-leaf', 'old-root'])
  expect(comparison.candidateOnly.packages.map(row => row.name)).toEqual(['new-leaf', 'new-root'])
  expect(comparison.candidateOnly.closure.map(row => row.name)).toEqual(['elkjs', 'new-leaf', 'new-root'])
  expect(() => assertMatchedAgenticRuntimes([baseline, candidate])).toThrow('graphs differ')
  for (const changed of [{ version: '0.11.1' }, { integrity: 'sha512-bW5vcA==' }, { dependencies: ['new-leaf@1.0.0'] }]) {
    const drift = { ...candidate, graph: candidate.graph.map(row => row.name === 'elkjs' ? { ...row, ...changed } : row) }
    expect(() => assertHistoricalAgenticRuntimes(baseline, drift)).toThrow('Historical shared runtime version/integrity/edges differ for elkjs')
  }
  expect(() => assertHistoricalAgenticRuntimes(baseline, { ...candidate, graph: [...candidate.graph, { name: 'orphan', version: '1.0.0', integrity: 'sha512-cXJzdA==', dependencies: [] }] })).toThrow('not attributable to an exclusive declared root')
  const unknown = { ...baseline, graph: baseline.graph.map(row => ({ ...row, integrity: null })) }
  expect(() => assertHistoricalAgenticRuntimes(unknown, unknown)).toThrow('require verified SHA-512 integrity')
})

test('directory runtime drift is rejected before the release worker or timing starts', async () => {
  const source = temp.dir(), out = temp.dir(), dependencies = { elkjs: '^0.11.0', yaml: '^2.9.0' }
  writeFileSync(join(source, 'package.json'), JSON.stringify({ name: 'agentic-mermaid', version: '0.0.0', dependencies }))
  writeFileSync(join(source, 'bun.lock'), JSON.stringify({ packages: {
    elkjs: ['elkjs@0.11.0', '', {}, 'sha512-YWJjZA=='], yaml: ['yaml@2.9.0', '', {}, 'sha512-ZWZnaA=='],
  } }))
  mkdirSync(join(source, 'dist'))
  const workerCalled = join(source, 'worker-called')
  writeFileSync(join(source, 'dist/index.js'), `require('node:fs').writeFileSync(${JSON.stringify(workerCalled)}, 'called'); throw Error('must not load')`)
  for (const [name, version] of [['elkjs', '0.11.1'], ['yaml', '2.9.1']]) {
    mkdirSync(join(source, 'node_modules', name!), { recursive: true })
    writeFileSync(join(source, 'node_modules', name!, 'package.json'), JSON.stringify({ name, version }))
  }
  const child = await runChild(process.execPath, [join(import.meta.dir, '../release-bench.ts'), '--baseline', source, '--candidate', source, '--case', 'flowchart:tree-300', '--out', out])
  expect(child.status).not.toBe(0)
  expect(child.stderr).toContain('runtime dependency elkjs@0.11.1 differs from frozen version/integrity 0.11.0')
  expect(existsSync(workerCalled)).toBe(false)
  expect(JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'))).toMatchObject({ status: 'failed', ok: false })
  expect(readFileSync(join(out, 'samples.jsonl'), 'utf8')).not.toContain('"mode":"time"')
})

test('Bun directory preflight compares its own fetched identity and fails closed without provenance', () => {
  const policySource = temp.dir(), installed = temp.dir(), out = temp.dir()
  const pkg = { name: 'agentic-mermaid', version: '0.0.0', dependencies: { elkjs: '^0.11.0' } }
  const locked = (integrity: string) => JSON.stringify({ packages: { elkjs: ['elkjs@0.11.0', '', {}, integrity] } })
  for (const root of [policySource, installed]) writeFileSync(join(root, 'package.json'), JSON.stringify(pkg))
  writeFileSync(join(policySource, 'bun.lock'), locked('sha512-YWJjZA=='))
  writeFileSync(join(installed, 'bun.lock'), locked('sha512-ZWZnaA=='))
  mkdirSync(join(installed, 'node_modules/elkjs'), { recursive: true })
  writeFileSync(join(installed, 'node_modules/elkjs/package.json'), JSON.stringify({ name: 'elkjs', version: '0.11.0' }))
  const policy = frozenRuntimePolicy(policySource)
  expect(() => inspectAgenticRuntime(installed, policy, out, 'wrong-sri')).toThrow('version/integrity')
  expect(JSON.parse(readFileSync(join(out, 'wrong-sri.runtime.json'), 'utf8'))).toMatchObject({ integritySource: 'frozen-bun-lock', graph: [{ name: 'elkjs', version: '0.11.0', integrity: 'sha512-ZWZnaA==' }] })
  writeFileSync(join(installed, 'bun.lock'), locked('sha512-YWJjZA=='))
  expect(inspectAgenticRuntime(installed, policy, out, 'matched').graph).toEqual([{ name: 'elkjs', version: '0.11.0', integrity: 'sha512-YWJjZA==', dependencies: [] }])
  unlinkSync(join(installed, 'bun.lock'))
  expect(() => inspectAgenticRuntime(installed, policy, out, 'unknown')).toThrow('runtime integrity is unknown')
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
] as const)('peer worker validates %s outside timing', async (_name, changeAt, replacement, status) => {
  const dir = temp.dir(), entry = join(dir, 'renderer.mjs'), job = join(dir, 'job.json'), out = join(dir, 'samples.jsonl')
  writeFileSync(entry, `let calls = 0; export function renderMermaidSVG() { return ++calls >= ${changeAt || 'Infinity'} ? ${JSON.stringify(replacement)} : '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><text>Keep</text></svg>' }`)
  writeFileSync(job, JSON.stringify({ peer: 'agentic', output: 'svg', entry,
    timing: { warmCalls: 1, warmupMs: 0, samples: 3, minSampleMs: 0, maxCaseMs: 100 },
    workloads: [{ id: 'owned-text', source: 'fixture', expected: ['Keep'] }],
  }))
  writeFileSync(out, '')
  const child = await runChild('node', ['--expose-gc', join(import.meta.dir, '../peer-bench.ts'), '--child', '--job', job, '--out', out], {
    cwd: join(import.meta.dir, '../../..'),
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

test('release memory worker separates post-GC heap and phased resident-memory observations', async () => {
  const dir = temp.dir(),
    entry = join(dir, 'renderer.mjs'),
    job = join(dir, 'job.json'),
    out = join(dir, 'memory.json')
  // Package import and rendering change only the RSS probes in this child.
  // Distinct sentinels prove checkpoint order without a large allocation.
  writeFileSync(entry, `
    process.memoryUsage.rss = () => 123456;
    const resourceUsage = process.resourceUsage;
    process.resourceUsage = () => ({ ...resourceUsage(), maxRSS: 789 });
    export function renderMermaidSVG() {
      process.memoryUsage.rss = () => 234567;
      return "<svg/>";
    }
  `)
  writeFileSync(job, JSON.stringify({ entry, mode: 'memory', reps: 1, inputs: [input('fixture')] }))
  const child = await runChild('node', ['--expose-gc', join(import.meta.dir, '../release-bench-worker.ts'), job, out])
  expect({ status: child.status, stderr: child.stderr }).toEqual({ status: 0, stderr: '' })
  const memory = JSON.parse(readFileSync(out, 'utf8'))
  expect(memory.settledHeapBytes).toBeGreaterThan(0)
  expect(memory.retainedHeapBytes).toBeGreaterThan(0)
  expect(memory.retainedGrowthBytes).toBe(Math.max(0, memory.retainedHeapBytes - memory.settledHeapBytes))
  expect(memory.peakRssBytes).toBe(789 * 1024)
  expect(memory.rss.workerStart.currentRssBytes).not.toBe(123456)
  expect(memory.rss.workerStart.currentRssBytes).not.toBe(234567)
  expect(memory.rss.workerStart.maxRssBytes).not.toBe(789 * 1024)
  expect(memory.rss.beforeMemoryWork.currentRssBytes).toBe(123456)
  expect(memory.rss.afterMemoryWork.currentRssBytes).toBe(234567)
  expect(memory.rss.beforeMemoryWork.maxRssBytes).toBe(789 * 1024)
  expect(memory.rss.afterMemoryWork.maxRssBytes).toBe(789 * 1024)
  const phases = {
    workerStart: 'after-static-imports-before-job-and-package-loading',
    beforeMemoryWork: 'after-package-imports-before-memory-warmup',
    afterMemoryWork: 'after-memory-measurement-and-final-gc',
  }
  for (const [key, phase] of Object.entries(phases)) {
    const checkpoint = memory.rss[key]
    expect(checkpoint.phase).toBe(phase)
    expect(checkpoint.currentRssBytes).toBeGreaterThan(0)
    expect(checkpoint.maxRssBytes).toBeGreaterThan(0)
    if (checkpoint.linuxVmHwmBytes === null) expect(typeof checkpoint.linuxVmHwmUnavailableReason).toBe('string')
    else {
      expect(checkpoint.linuxVmHwmBytes).toBeGreaterThan(0)
      expect(checkpoint.linuxVmHwmUnavailableReason).toBeNull()
    }
  }
})

test('peer artifact mismatch fails before installation and retains explicit incomplete evidence', async () => {
  const dir = temp.dir(), tarball = join(dir, 'candidate.tgz'), reportPath = join(dir, 'report.json')
  writeFileSync(tarball, 'different bytes')
  const bin = temp.dir(), npm = join(bin, 'npm'), installed = join(dir, 'npm-called')
  writeFileSync(npm, '#!/bin/sh\n: > "$INSTALL_RECEIPT"\nexit 99\n')
  chmodSync(npm, 0o755)
  const invoke = () => runChild(process.execPath, [join(import.meta.dir, '../peer-bench.ts'),
    '--peers', 'agentic', '--workloads', 'flow5', '--candidate-tarball', tarball,
    '--candidate-sha256', '0'.repeat(64), '--elk-cache', 'on', '--json', reportPath, '--markdown', join(dir, 'report.md'),
  ], { cwd: join(import.meta.dir, '../../..'), env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, INSTALL_RECEIPT: installed, APL_NO_CENTER: '1' } })
  expect((await invoke()).status).not.toBe(0)
  expect(existsSync(installed)).toBe(false)
  const report = JSON.parse(readFileSync(reportPath, 'utf8'))
  expect(report.status).toBe('failed')
  expect(report.error).toContain('Candidate tarball SHA-256')
  expect(report.policy).toMatchObject({ elkCache: 'on', sceneAssertions: 'off', aplEnvironment: { APL_NO_CENTER: '1' } })
  const originalRaw = readFileSync(report.rawSamples, 'utf8')
  const receipts = originalRaw.trim().split('\n').map(line => JSON.parse(line))
  expect(receipts[0].status).toBe('started')
  expect(receipts.at(-1)).toMatchObject({ status: 'failed', error: report.error })
  expect((await invoke()).status).not.toBe(0)
  expect(JSON.parse(readFileSync(reportPath, 'utf8')).rawSamples).not.toBe(report.rawSamples)
  expect(readFileSync(report.rawSamples, 'utf8')).toBe(originalRaw)
})

test('failed editor benchmark reruns invalidate a previous completed report', async () => {
  const out = temp.dir(), site = temp.dir(), report = join(out, 'editor-preview.json')
  writeFileSync(report, JSON.stringify({ status: 'completed', samples: ['stale-run'] }))
  const proc = Bun.spawn([process.execPath, join(import.meta.dir, '../editor-preview-bench.ts'), '--site', site, '--out', out, '--executable', join(site, 'nonexistent-chromium')], {
    stdout: 'ignore', stderr: 'ignore', timeout: 10_000, killSignal: 'SIGKILL',
  })
  expect(await proc.exited).not.toBe(0)
  const failed = JSON.parse(readFileSync(report, 'utf8'))
  expect(failed.status).toBe('failed')
  expect(failed.error).toContain('nonexistent-chromium')
  expect(failed).not.toHaveProperty('samples')
})


test('Linux RSS high-water observations preserve units and explicit portability failures', () => {
  expect(linuxRssHighWater('linux', () => 'Name:\tnode\nVmRSS:\t128 kB\nVmHWM:\t256 kB\n')).toEqual({ linuxVmHwmBytes: 262144, linuxVmHwmUnavailableReason: null })
  expect(linuxRssHighWater('darwin', () => { throw new Error('must not read procfs') })).toEqual({ linuxVmHwmBytes: null, linuxVmHwmUnavailableReason: 'not-linux' })
  expect(linuxRssHighWater('linux', () => { throw new Error('permission denied') })).toEqual({ linuxVmHwmBytes: null, linuxVmHwmUnavailableReason: 'proc-self-status-unreadable' })
  for (const status of ['VmRSS: 128 kB\n', 'VmHWM: -1 kB\n', 'VmHWM: 2 MB\n', 'VmHWM: NaN kB\n']) {
    expect(linuxRssHighWater('linux', () => status)).toEqual({ linuxVmHwmBytes: null, linuxVmHwmUnavailableReason: 'proc-self-status-vmhwm-missing-or-invalid' })
  }
  expect(linuxRssHighWater('linux', () => 'VmHWM: 9007199254740992 kB\n')).toEqual({ linuxVmHwmBytes: null, linuxVmHwmUnavailableReason: 'proc-self-status-vmhwm-out-of-range' })
})
