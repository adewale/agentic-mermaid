// Run with Bun: bun eval/elk-layered/capture.ts [capture-to-resume]
// Additive stress packet: bun eval/elk-layered/capture.ts --current-main-stress <complete-canonical-capture> [supplement-to-resume]
// External cohort: bun eval/elk-layered/capture.ts --supplement <complete-canonical-capture> <sources.json> [supplement-to-resume]
// These mocks are eval-only: production candidate selection and retry code run
// unchanged. Rejecting the first 0–3 ELK returns exercises their existing ladder.
import { mock } from 'bun:test'
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { serialize } from 'node:v8'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { assertLayoutGraphWork } from '../../src/shared/diagram-limits.ts'
import type { ElkNode } from 'elkjs'

process.env.AGENTIC_MERMAID_ELK_CACHE = '0'

// Additional current-Main stress inputs are recorded separately and retain an
// explicit reference to the complete canonical packet they augment.
const stressSupplement = process.argv[2] === '--current-main-stress'
const fileSupplement = process.argv[2] === '--supplement'
const supplementary = stressSupplement || fileSupplement
const canonicalDirectory = supplementary ? process.argv[3] : undefined
if (supplementary && canonicalDirectory === undefined) throw new Error('Pass the complete retained canonical capture before the supplement')
const canonical = canonicalDirectory === undefined ? undefined : JSON.parse(readFileSync(join(canonicalDirectory, 'capture.json'), 'utf8'))
if (canonical !== undefined && (!canonical.complete || canonical.oracle !== 'elkjs/lib/elk-worker.js synchronous dispatcher' || canonical.supplements !== undefined || canonical.population !== undefined && canonical.population !== 'complete corpus')) throw new Error('A supplement requires a complete actual-elkjs canonical capture')
type SourceSample = { id: string; family: string; source: string }
let supplementSource: { path: string; sha256: string; provenance: unknown } | undefined
let externalSamples: SourceSample[] | undefined
if (fileSupplement) {
  const sourcePath = process.argv[4]
  if (sourcePath === undefined) throw new Error('Pass a source file containing cases with id, family and source strings')
  const bytes = readFileSync(sourcePath)
  const packet = JSON.parse(bytes.toString()) as { cases?: unknown; provenance?: unknown } | unknown[]
  const rows = Array.isArray(packet) ? packet : packet.cases
  const isSample = (row: unknown): row is SourceSample => row !== null && typeof row === 'object'
    && typeof (row as SourceSample).id === 'string' && typeof (row as SourceSample).family === 'string' && typeof (row as SourceSample).source === 'string'
  if (!Array.isArray(rows) || rows.length === 0 || !rows.every(isSample)) throw new Error('The source file must contain a nonempty cases array with id, family and source strings')
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('Supplement source ids must be unique')
  externalSamples = rows
  supplementSource = { path: resolve(sourcePath), sha256: createHash('sha256').update(bytes).digest('hex'), provenance: Array.isArray(packet) ? undefined : packet.provenance }
}
const resumeDirectory = process.argv[fileSupplement ? 5 : stressSupplement ? 4 : 2]
const outputRoot = join(import.meta.dir, 'output')
mkdirSync(outputRoot, { recursive: true })
const output = resumeDirectory ?? mkdtempSync(join(outputRoot, 'capture-'))
const resumed = resumeDirectory ? JSON.parse(readFileSync(join(output, 'capture.json'), 'utf8')) : undefined
if (resumed?.complete) throw new Error('This capture is already complete')
const retained = resumed ? readdirSync(output) : []
const resumeRender = retained.reduce((next, name) => {
  const match = /^render-(\d+)\.bin$/.exec(name)
  return match ? Math.max(next, Number(match[1]) + 1) : next
}, 0)
const oracleModule = await import('../../src/elk-instance.ts')
// The oracle is always the published dev dependency, even after production
// switches to the port. Use its synchronous dispatcher without changing JSON
// values or crossing realms; production never loads this eval-only worker.
interface OracleResponse { data?: ElkNode; error?: unknown }
interface OracleWorker {
  onmessage: (event: { data: OracleResponse }) => void
  dispatcher: { saveDispatch(event: { data: { id: number; cmd: string; graph?: ElkNode; algorithms?: string[] } }): void }
}
const require = createRequire(import.meta.url)
const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document')
let OracleWorkerConstructor: new () => OracleWorker
try {
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {} })
  OracleWorkerConstructor = (require('elkjs/lib/elk-worker.js') as { Worker: new () => OracleWorker }).Worker
} finally {
  if (documentDescriptor === undefined) Reflect.deleteProperty(globalThis, 'document')
  else Object.defineProperty(globalThis, 'document', documentDescriptor)
}
const oracleWorker = new OracleWorkerConstructor()
function dispatch(data: Parameters<OracleWorker['dispatcher']['saveDispatch']>[0]['data']): OracleResponse {
  let response: OracleResponse | undefined
  oracleWorker.onmessage = event => { response = event.data }
  oracleWorker.dispatcher.saveDispatch({ data })
  if (response === undefined) throw new Error('elkjs oracle did not respond synchronously')
  if ('error' in response) throw response.error
  return response
}
dispatch({ id: -1, cmd: 'register', algorithms: ['layered', 'stress', 'mrtree', 'radial', 'force', 'disco', 'sporeOverlap', 'sporeCompaction', 'rectpacking'] })
function oracle(graph: ElkNode): ElkNode {
  // Preserve the production boundary's shared work admission and unchanged caps.
  assertLayoutGraphWork(graph)
  const response = dispatch({ id: 0, cmd: 'layout', graph })
  if (response.data === undefined) throw new Error('elkjs oracle did not return a graph')
  return response.data
}
const strategies = [
  { name: 'default', options: {} },
  { name: 'separate-hierarchy', options: { separateHierarchy: true } },
  { name: 'without-corank', options: { disableCorankFanIn: true } },
  { name: 'separate-without-corank', options: { separateHierarchy: true, disableCorankFanIn: true } },
] as const
let strategy: typeof strategies[number] = strategies[0]
let rejectedReturns = 0
let render = 0
let call = 0
let captures = retained.reduce((next, name) => /^\d+\.bin$/.test(name) ? Math.max(next, Number(name.slice(0, -4)) + 1) : next, 0)
let stopRequested = false
process.once('SIGINT', () => { stopRequested = true })

mock.module('../../src/elk-instance.ts', () => ({
  ...oracleModule,
  elkLayoutSync(graph: ElkNode): ElkNode {
    const input = structuredClone(graph)
    const ordinal = call++
    let result: ElkNode
    try {
      result = oracle(graph)
    } catch (error) {
      writeFileSync(join(output, `${captures++}.bin`), serialize({ render, ordinal, input, outcome: { kind: 'throw', error } }))
      throw error
    }
    const injectedRejection = ordinal < rejectedReturns
    writeFileSync(join(output, `${captures++}.bin`), serialize({ render, ordinal, input, outcome: { kind: 'return', value: result }, injectedRejection }))
    if (injectedRejection) throw new Error('Eval-only rejection to exercise the existing ELK degradation ladder')
    return result
  },
}))

const engine = await import('../../src/layout-engine.ts')
const layoutGraph = engine.layoutGraphSync
const layoutPlacement = engine.layoutElkGraphPlacementSync
mock.module('../../src/layout-engine.ts', () => ({
  ...engine,
  layoutGraphSync(...[graph, options = {}]: Parameters<typeof layoutGraph>) {
    return layoutGraph(graph, { ...options, ...strategy.options })
  },
  layoutElkGraphPlacementSync(...[graph, options = {}]: Parameters<typeof layoutPlacement>) {
    return layoutPlacement(graph, { ...options, ...strategy.options })
  },
}))

const { collectSamples } = await import('../layout-compare/run.ts')
const { generatedFlowchartSamples } = await import('../layout-compare/generated.ts')
const { renderMermaidSVGWithReceipt } = await import('../../src/agent/index.ts')
// Keep the complete seed ranges enrolled in the existing layout comparison.
// Sources below are the existing Main 947645a1 layout-cost, layout-worst-case,
// and junction-contraction fixtures. Their options remain owned by production.
function currentMainStressSamples(): { id: string; family: 'flowchart'; source: string }[] {
  const names = (prefix: string, n: number): string[] => Array.from({ length: n }, (_, i) => `${prefix}${i}`)
  const fan = (from: string, to: string, n: number, op = '-->'): string => `${names(from, n).join(' & ')} ${op} ${names(to, n).join(' & ')}`
  const chain = Array.from({ length: 79 }, (_, i) => `n${i} --> n${i + 1}`)
  const nested = [...chain, ...Array.from({ length: 20 }, (_, i) => `n${i} --> n${79 - i}`)]
  const complete = Array.from({ length: 30 }, (_, i) => Array.from({ length: 29 - i }, (_, k) => `k${i} --> k${i + k + 1}`)).flat()
  const rows: [string, string][] = [
    ['layout-cost/nested-links-80-20', ['flowchart TD', ...nested].join('\n')],
    ['layout-worst-case/complete-dag-30', ['flowchart TD', ...complete].join('\n')],
    ['layout-cost/fan-19', `flowchart TD\n${fan('a', 'b', 19)}`],
    ['layout-cost/fan-20', `flowchart TD\n${fan('a', 'b', 20)}`],
    ['layout-cost/fan-23', `flowchart TD\n${fan('a', 'b', 23)}`],
    ['layout-cost/stacked-fans-19', `flowchart TD\n${fan('a', 'b', 19)}\n${fan('b', 'c', 19)}`],
    ['junction-contraction/LR-arrows-21', `flowchart LR\n${fan('a', 'b', 21)}`],
    ['junction-contraction/TD-bidirectional-21', `flowchart TD\n${fan('a', 'b', 21, '<-->')}`],
    ['junction-contraction/RL-dotted-group-21', `flowchart RL\nsubgraph G[Grid]\n${fan('a', 'b', 21, '-.->')}\nend\nx --> a0`],
    ['junction-contraction/BT-open-21', `flowchart BT\n${fan('a', 'b', 21, '---')}`],
    ['junction-contraction/labelled-open-block', `flowchart LR\n${fan('a', 'b', 3)}\na0 -->|x| b0`],
  ]
  return rows.map(([id, source]) => ({ id: 'current-main-stress/' + id, family: 'flowchart', source }))
}
const samples = externalSamples ?? (stressSupplement ? currentMainStressSamples() : [
  ...collectSamples({ includeStress: true }),
  ...generatedFlowchartSamples({ start: 0, count: 256 }),
  ...generatedFlowchartSamples({ start: 256, count: 128 }),
  ...generatedFlowchartSamples({ start: 0, count: 256 }, 'sha256-counter-v1'),
])
const packageInfo = JSON.parse(readFileSync(join(import.meta.dir, '../../node_modules/elkjs/package.json'), 'utf8')) as { version: string }
if (packageInfo.version !== '0.11.1') throw new Error(`Expected elkjs 0.11.1, received ${packageInfo.version}`)
const metadata = {
  source: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: join(import.meta.dir, '../..'), encoding: 'utf8' }).trim(),
  elkjs: packageInfo.version,
  oracle: 'elkjs/lib/elk-worker.js synchronous dispatcher',
  elkjsTagRevision: '572e73323791d05f09b0815ff639af2b67f202ab',
  javaTag: 'v0.11.0',
  javaRevision: '54123e884b1ae743b453260f713b20c9bf5787f2',
  runtime: `Bun ${Bun.version}`,
  serialization: 'node:v8 on the recorded runtime; preserves undefined, nonfinite numbers and negative zero',
  started: resumed?.started ?? new Date().toISOString(),
  ...(resumed ? { resumed: [...(resumed.resumed ?? []), { at: new Date().toISOString(), render: resumeRender, captures }] } : {}),
  population: fileSupplement ? 'external corpus supplement' : stressSupplement ? 'current-main-stress supplement' : 'complete corpus',
  ...(supplementSource === undefined ? {} : { supplementSource }),
  ...(canonicalDirectory === undefined ? {} : { supplements: { directory: resolve(canonicalDirectory), source: canonical.source, captures: canonical.captures } }),
  samples: samples.length,
  plannedRenders: samples.length * strategies.length * 4,
}
if (resumed && (resumed.source !== metadata.source || resumed.runtime !== metadata.runtime || resumed.plannedRenders !== metadata.plannedRenders || resumed.oracle !== metadata.oracle || resumed.population !== metadata.population || resumed.supplements?.directory !== metadata.supplements?.directory || resumed.supplements?.source !== metadata.supplements?.source || resumed.supplements?.captures !== metadata.supplements?.captures || resumed.supplementSource?.path !== metadata.supplementSource?.path || resumed.supplementSource?.sha256 !== metadata.supplementSource?.sha256)) {
  throw new Error('Resume requires the original source, runtime, oracle and complete population, including its canonical reference')
}
writeFileSync(join(output, 'capture.json'), JSON.stringify({ ...metadata, complete: false }, null, 2))
console.log(JSON.stringify({ output, ...metadata }))
let lastProgress = Date.now()
const recordedSources = resumed ? new Set(readFileSync(join(output, 'sources.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line).id as string)) : new Set<string>()
population: for (const sample of samples) {
  if (!recordedSources.has(sample.id)) appendFileSync(join(output, 'sources.jsonl'), JSON.stringify(sample) + '\n')
  for (const nextStrategy of strategies) {
    strategy = nextStrategy
    for (let depth = 0; depth < 4; depth++) {
      if (render < resumeRender) { render++; continue }
      if (stopRequested) break population
      rejectedReturns = depth
      call = 0
      const firstCapture = captures
      let outcome: unknown
      try {
        const rendered = renderMermaidSVGWithReceipt(sample.source, { graphLayout: { backend: 'elk', fallback: 'none' } })
        // Consume the public result as well as every kernel result.
        outcome = { kind: 'return', svgLength: rendered.svg.length, receipt: rendered.receipt }
      } catch (error) {
        outcome = { kind: 'throw', error }
      }
      writeFileSync(join(output, `render-${render}.bin`), serialize({ sample: sample.id, family: sample.family, strategy: strategy.name, depth, firstCapture, captures: captures - firstCapture, outcome }))
      render++
      if (Date.now() - lastProgress >= 10_000) {
        console.log(JSON.stringify({ render, total: metadata.plannedRenders, captures, sample: sample.id }))
        lastProgress = Date.now()
      }
      // Let signals and output flush between fully synchronous renders.
      await new Promise<void>(resolve => setImmediate(resolve))
    }
  }
}
const complete = render === metadata.plannedRenders
writeFileSync(join(output, 'capture.json'), JSON.stringify({ ...metadata, complete, finished: new Date().toISOString(), renders: render, captures }, null, 2))
console.log(JSON.stringify({ output, complete, renders: render, captures }))
