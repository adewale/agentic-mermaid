import './ci-policy-enforce.ts'
// Diagnostic phase costs complement packed end-to-end release measurements.
// Times are inclusive: layout contains ELK, and Scene contains lowering and
// admission. Depth/parent metadata preserve actual nesting; do not sum them.
import { writeFileSync } from 'node:fs'
import { renderMermaidSVGWithReceipt } from '../../src/index.ts'
import { clearElkLayoutCache } from '../../src/elk-instance.ts'
import { withRenderStageObserver, type RenderStageSample } from '../../src/render-stages.ts'
import { officialCorpusInventory } from '../shared/official-fences.ts'

// Existing corpus CLI remains: [rounds=3] [output.json]. The optional micro
// selector uses the original public receipt cases, never post-layout stand-ins.
const argv = process.argv.slice(2)
const microIndex = argv.indexOf('--micro-workloads')
const positional = microIndex < 0 ? argv : argv.filter((_value, index) => index !== microIndex && index !== microIndex + 1)

type MicroSample = {
  id: string; round: number; ok: boolean; totalMs?: number
  stages: RenderStageSample[]; phase?: string; error?: string
}

async function runMicroDiagnostic(): Promise<void> {
  const rounds = Number(positional[0] ?? 3)
  const samples: MicroSample[] = []
  const preparations: Array<Record<string, unknown>> = []
  const configuration = {
    elkCache: process.env.AGENTIC_MERMAID_ELK_CACHE ?? '(default)',
    sceneAssertions: process.env.AGENTIC_MERMAID_SCENE_ASSERTIONS ?? '(default)',
    nodeOptions: process.env.NODE_OPTIONS ?? null,
    bunOptions: process.env.BUN_OPTIONS ?? null,
    flags: Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('APL_') || key.startsWith('AM_FC_'))),
  }
  let selected: string[] = []
  let actualSceneAssertions: boolean | undefined
  let error: string | undefined
  const errorText = (value: unknown): string => value instanceof Error ? value.stack ?? String(value) : String(value)
  try {
    if (!Number.isSafeInteger(rounds) || rounds < 1) throw new Error('Provide a positive round count')
    if (argv.filter(value => value === '--micro-workloads').length !== 1 || positional.length > 2) throw new Error('Provide one --micro-workloads all|comma-separated-IDs selector')
    const { sceneAssertionsEnabled } = await import('../../src/scene/assertions.ts')
    actualSceneAssertions = sceneAssertionsEnabled()
    if (configuration.elkCache !== '0' || configuration.sceneAssertions !== '0' || actualSceneAssertions
      || configuration.nodeOptions !== null || configuration.bunOptions !== null || Object.keys(configuration.flags).length) {
      throw new Error('Micro stage diagnostics require cache/assertions0 and scrubbed NODE_OPTIONS/BUN_OPTIONS/APL/AM_FC before startup')
    }
    const { MICRO_WORKLOADS, microCases } = await import('./micro-bench-cases.ts')
    const selection = argv[microIndex + 1]
    selected = selection === 'all' ? Object.keys(MICRO_WORKLOADS) : selection?.split(',') ?? []
    if (!selected.length || new Set(selected).size !== selected.length || selected.some(id => !Object.hasOwn(MICRO_WORKLOADS, id))) {
      throw new Error('Micro selector must name unique existing MICRO_WORKLOADS IDs, or all')
    }
    const cases = microCases()
    const ready = new Map<string, { call: () => unknown; consume: (value: unknown) => void; beforeCall?: () => void; check?: (value: unknown) => boolean }>()
    const failures = new Map<string, string>()
    for (const id of selected) {
      const source = MICRO_WORKLOADS[id as keyof typeof MICRO_WORKLOADS]
      const preparation: Record<string, unknown> = { id, source, case: `render:svg-receipt-${id}`, ok: false }
      preparations.push(preparation)
      let phase = 'setup'
      const start = performance.now()
      try {
        const entry = cases.find(entry => entry.id === preparation.case)
        if (!entry) throw new Error('Selected original public receipt case is unavailable')
        const prepared = await entry.setup()
        preparation.setupMs = performance.now() - start
        if (typeof prepared === 'function' || typeof prepared.call !== 'function' || typeof prepared.consume !== 'function'
          || prepared.input !== source || prepared.evidence === undefined) throw new Error('Original complete public input/evidence/consumer is unavailable')
        const { call, consume, beforeCall } = prepared
        preparation.input = prepared.input
        preparation.evidence = prepared.evidence
        phase = 'warmup-render'
        beforeCall?.()
        clearElkLayoutCache()
        const warmStart = performance.now()
        const reference = call()
        preparation.warmupCallMs = performance.now() - warmStart
        phase = 'warmup-consumer'
        if (entry.check && !entry.check(reference)) throw new Error('Original reference check failed')
        consume(reference)
        preparation.referenceArtifact = reference
        preparation.warmupCalls = 1
        preparation.ok = true
        ready.set(id, { call, consume, beforeCall, check: entry.check })
      } catch (value) {
        preparation.ok = false
        preparation.phase = phase
        preparation.error = errorText(value)
        preparation.preparationMs = performance.now() - start
        failures.set(id, errorText(value))
      }
    }
    for (let round = 1; round <= rounds; round++) for (const id of selected) {
      const prepared = ready.get(id)
      const stages: RenderStageSample[] = []
      const sample: MicroSample = { id, round, ok: false, stages }
      samples.push(sample)
      if (!prepared) { sample.phase = 'preparation'; sample.error = failures.get(id) ?? 'Selected case was not prepared'; continue }
      let phase = 'preparation'
      try {
        prepared.beforeCall?.()
        clearElkLayoutCache()
        phase = 'render'
        const start = performance.now()
        let artifact: unknown
        try { artifact = withRenderStageObserver(value => stages.push(value), prepared.call) }
        finally { sample.totalMs = performance.now() - start }
        phase = 'consumer'
        if (prepared.check && !prepared.check(artifact)) throw new Error('Original full-return check failed')
        prepared.consume(artifact)
        phase = 'observer'
        if (!stages.some(value => value.stage === 'layout') || !stages.some(value => value.stage === 'svg-security')) {
          throw new Error('Actual full public layout/security stages were not observed; check the bundled source/observer graph')
        }
        sample.ok = true
      } catch (value) { sample.phase = phase; sample.error = errorText(value) }
    }
  } catch (value) { error = errorText(value) }
  const complete = !error && selected.length > 0 && preparations.length === selected.length
    && preparations.every(value => value.ok === true) && samples.length === selected.length * rounds && samples.every(value => value.ok)
  const output = {
    diagnostic: true, complete, population: 'original MICRO_WORKLOADS public secured SVG+receipt', selected, rounds,
    runtime: process.versions, executable: process.execPath, execArgv: process.execArgv,
    configuration: { ...configuration, actualSceneAssertions },
    timings: 'Full observed public call before consumer; inclusive stages with actual depth/parent, never sum nested costs',
    warmup: 'Each original case.setup performs its public reference/consumer preparation; one additional unobserved warm/reference call per selected input is retained. No minimum-duration warmup added.',
    limitations: 'Source diagnostic with observer clock/object overhead; layout includes nested ELK. Not a mathematical lower bound on unobserved peer APIs, installed-package latency, or a subtraction of independent public/post samples.',
    preparations, samples, ...(error ? { error } : {}),
  }
  if (positional[1]) writeFileSync(positional[1], `${JSON.stringify(output)}\n`)
  console.log(JSON.stringify(positional[1] ? { complete, selected, rounds, successfulCalls: samples.filter(value => value.ok).length, configuration: output.configuration, timings: output.timings, ...(error ? { error } : {}) } : output, null, 2))
  if (!complete) process.exitCode = 1
}

if (microIndex >= 0) await runMicroDiagnostic()
else {
  const rounds = Number(positional[0] ?? 3)
  if (!Number.isSafeInteger(rounds) || rounds < 1) throw new Error('Provide a positive round count')
  const inputs = officialCorpusInventory().occurrences
  const samples: Array<{ id: string; round: number; ok: boolean; totalMs: number; stages: RenderStageSample[]; error?: string }> = []
  for (const input of inputs) { try { renderMermaidSVGWithReceipt(input.source) } catch {} }
  for (let round = 1; round <= rounds; round++) {
    for (const input of inputs) {
      const stages: RenderStageSample[] = []
      // The corpus repeats sources; time ELK rather than a cached result.
      clearElkLayoutCache()
      const start = performance.now()
      let error: string | undefined
      try { withRenderStageObserver(sample => stages.push(sample), () => renderMermaidSVGWithReceipt(input.source)) }
      catch (value) { error = String(value) }
      samples.push({ id: input.id, round, ok: error === undefined, totalMs: performance.now() - start, stages, ...(error ? { error } : {}) })
    }
  }
  const configuration = {
    elkCache: process.env.AGENTIC_MERMAID_ELK_CACHE ?? '(default)',
    sceneAssertions: process.env.AGENTIC_MERMAID_SCENE_ASSERTIONS ?? '(default)',
    nodeOptions: process.env.NODE_OPTIONS ?? null,
    bunOptions: process.env.BUN_OPTIONS ?? null,
    flags: Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('APL_') || key.startsWith('AM_FC_'))),
  }
  const output = { diagnostic: true, runtime: process.versions, rounds, configuration, timings: 'inclusive; depth and parent record nested work', samples }
  if (positional[1]) writeFileSync(positional[1], `${JSON.stringify(output)}\n`)
  const totals: Record<string, number> = {}
  for (const sample of samples.filter(sample => sample.ok)) {
    totals.total = (totals.total ?? 0) + sample.totalMs
    for (const { stage, ms } of sample.stages) totals[stage] = (totals[stage] ?? 0) + ms
  }
  console.log(JSON.stringify({ successfulCalls: samples.filter(sample => sample.ok).length, totalsMs: totals, configuration, timings: output.timings }, null, 2))
}
