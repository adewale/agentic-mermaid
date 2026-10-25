// Direct native-to-native comparison. Reuses release workers/scheduling/gates;
// --baseline on release-bench.ts instead compares an older default ELK path.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { cpus, release } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { layoutCacheEnvironment } from './release-bench-fidelity.ts'
import { measureLayoutComparisons, report, type Group, type Input } from './release-bench.ts'
import { layoutReviewCaseIds, layoutReviewPopulation, populationIdentity } from './layout-review-population.ts'
import type { LayoutCache, LayoutMode } from './release-bench-types.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')

export function differentialArgs(argv: string[]) {
  const allowed = new Set(['baseline', 'candidate', 'main-elk', 'inputs', 'out', 'layout-cache', 'rounds', 'reps', 'budget-ms', 'memory-budget-ms', 'include-fallback'])
  const options = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]?.replace(/^--/, ''), value = argv[index + 1]
    if (!argv[index]?.startsWith('--') || !key || !allowed.has(key) || !value || value.startsWith('--') || options.has(key)) throw new Error(`Invalid argument: ${argv[index]}`)
    options.set(key, value)
  }
  for (const key of ['baseline', 'out', 'layout-cache']) if (!options.has(key)) throw new Error(`--${key} is required`)
  if (!['off', 'normal'].includes(options.get('layout-cache')!)) throw new Error('--layout-cache requires off|normal')
  if (options.has('include-fallback') && !['true', 'false'].includes(options.get('include-fallback')!)) throw new Error('--include-fallback requires true|false')
  // These are the existing full-canary bounds, not knobs for rescuing a failure.
  for (const [key, expected] of [['rounds', 3], ['reps', 25], ['budget-ms', 480000], ['memory-budget-ms', 480000]] as const) {
    if (options.has(key) && options.get(key) !== String(expected)) throw new Error(`--${key} is fixed at ${expected}`)
  }
  return options
}

export function artifactIdentity(directory: string) {
  const root = resolve(directory), entry = join(root, 'dist/index.js')
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name: string; version: string }
  if (pkg.name !== 'agentic-mermaid' || !existsSync(entry)) throw new Error(`Expected a built agentic-mermaid package at ${root}`)
  const files: Array<{ path: string; bytes: number; sha256: string }> = []
  const add = (path: string) => { const bytes = readFileSync(path); files.push({ path: relative(root, path), bytes: bytes.length, sha256: sha(bytes) }) }
  const walk = (path: string) => {
    for (const item of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = join(path, item.name)
      if (item.isDirectory()) walk(child)
      else if (item.isFile() && /\.(?:js|wasm)$/.test(item.name)) add(child)
    }
  }
  add(join(root, 'package.json')); walk(join(root, 'dist'))
  for (const lock of ['bun.lock', 'bun.lockb', 'package-lock.json']) if (existsSync(join(root, lock))) add(join(root, lock))
  return { directory: root, entry, version: pkg.version, files, sha256: sha(JSON.stringify(files)) }
}

export function runtimeDifferentialPlans(baseline: ReturnType<typeof artifactIdentity>, candidate: ReturnType<typeof artifactIdentity>, cache: LayoutCache,
  includeFallback = false, mainElk?: ReturnType<typeof artifactIdentity>) {
  const engine = (artifact: typeof baseline, label: string, layoutMode?: LayoutMode) => ({ label, entry: artifact.entry, version: artifact.version,
    identity: { kind: 'directory' as const, requested: artifact.directory, sha256: artifact.sha256 }, ...(layoutMode ? { layoutMode } : {}), layoutCache: cache, consumeReceipt: true })
  const before = engine(baseline, 'native23-reference', 'agentic'), after = engine(candidate, 'native24', 'agentic')
  const elk = engine(candidate, 'candidate-elk', 'elk')
  const plans = [
    { name: 'native23-aa', advisory: false, engines: [before, engine(baseline, 'native23-aa', 'agentic')] },
    { name: 'native23-native24', advisory: false, engines: [before, after] },
    { name: 'candidate-elk-native24', advisory: false, engines: [elk, after] },
  ]
  if (includeFallback) plans.push({ name: 'fallback23-fallback24', advisory: false,
    engines: [engine(baseline, 'fallback23', 'agentic-with-elk'), engine(candidate, 'fallback24', 'agentic-with-elk')] })
  if (mainElk) {
    // Pre-selector main has no graphLayout option. The shared declared
    // experiment policy excludes indexed-layout, selecting its ELK path.
    const reference = engine(mainElk, 'main-elk')
    plans.push({ name: 'main-elk-native24', advisory: false, engines: [reference, after] },
      { name: 'main-elk-candidate-elk', advisory: false, engines: [reference, elk] })
  }
  return plans
}

export function differentialPopulation(path?: string): Input[] {
  if (!path) return layoutReviewPopulation()
  const parsed: unknown = JSON.parse(readFileSync(resolve(path), 'utf8'))
  const inputs = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' && 'inputs' in parsed ? parsed.inputs : undefined
  if (!Array.isArray(inputs) || inputs.length !== 27 || new Set(inputs.map(input => input?.id)).size !== 27) throw new Error('Input lock must contain exactly the historical27 distinct IDs')
  for (const input of inputs) {
    if (!layoutReviewCaseIds.includes(input.id) || typeof input.source !== 'string' || typeof input.family !== 'string' || !['corpus', 'scaling', 'workflow'].includes(input.kind)) throw new Error(`Invalid locked input ${input.id}`)
    if (input.sourceSha256 !== undefined && input.sourceSha256 !== sha(input.source)) throw new Error(`Source digest mismatch for ${input.id}`)
    if (input.workflow !== undefined && input.workflow !== 'edit-flowchart') throw new Error(`Unknown workflow for ${input.id}`)
    if (input.id === 'agent:edit-flowchart' && input.workflow !== 'edit-flowchart') throw new Error('The edit workflow must remain enrolled as a workflow')
    if (input.expectedSvgLabels !== undefined && (!Array.isArray(input.expectedSvgLabels) || input.expectedSvgLabels.some((value: unknown) => typeof value !== 'string'))) throw new Error(`Invalid expected labels for ${input.id}`)
  }
  return inputs.map(({ id, family, source, kind, expectedSvgLabels, workflow }) => ({ id, family, source, kind,
    ...(expectedSvgLabels ? { expectedSvgLabels } : {}), ...(workflow ? { workflow } : {}) }))
}

function main() {
  const options = differentialArgs(process.argv.slice(2)), out = resolve(options.get('out')!)
  if (existsSync(out) && readdirSync(out).length) throw new Error(`Refusing nonempty output directory: ${out}`)
  const baseline = artifactIdentity(options.get('baseline')!), candidate = artifactIdentity(options.get('candidate') ?? ROOT)
  const mainElk = options.has('main-elk') ? artifactIdentity(options.get('main-elk')!) : undefined
  const cache = options.get('layout-cache')! as LayoutCache, inputs = differentialPopulation(options.get('inputs'))
  const groups: Group[] = [{ name: 'corpus', inputs: inputs.filter(input => input.kind === 'corpus'), budgetMs: 480000 },
    ...inputs.filter(input => input.kind !== 'corpus').map(input => ({ name: input.id, inputs: [input], budgetMs: 480000 }))]
  const plans = runtimeDifferentialPlans(baseline, candidate, cache, options.get('include-fallback') === 'true', mainElk)
  mkdirSync(out, { recursive: true })
  const memoryBudgetMs = options.has('memory-budget-ms') ? 480000 : undefined
  const started = Date.now(), artifacts = { baseline, candidate, ...(mainElk ? { mainElk } : {}) }
  const harnessFiles = ['layout-runtime-differential.ts', 'layout-review-population.ts', 'release-bench.ts', 'release-bench-worker.ts', 'release-bench-fidelity.ts']
  const metadata = { protocol: 'native-runtime-differential@1', sourceRevision: process.env.GITHUB_SHA, startedAt: new Date(started).toISOString(),
    config: { rounds: 3, reps: 25, budgetMs: 480000, ...(memoryBudgetMs === undefined ? {} : { measurementProtocol: 'independent-timing-memory-budgets@1', timingBudgetMs: 480000, memoryBudgetMs, maximumMeasurementBudgetMs: 480000 + memoryBudgetMs }), layoutCache: cache, cacheEnvironment: layoutCacheEnvironment(cache), timing: 'batched-layout-reference@1',
      consumption: 'svg-utf8-and-full-receipt-json', optionalFallback: options.get('include-fallback') === 'true', failurePolicy: memoryBudgetMs === undefined ? 'no-retry; shared deadline; preserve incomplete campaigns' : 'no-retry; independent timing and memory deadlines; preserve incomplete campaigns' },
    artifacts, population: populationIdentity(inputs), plans,
    harness: harnessFiles.map(name => ({ name, sha256: sha(readFileSync(join(import.meta.dir, name))) })),
    environment: { node: process.versions.node, bun: process.versions.bun, platform: process.platform, arch: process.arch, osRelease: release(),
      cpu: cpus()[0]?.model, logicalCpus: cpus().length,
      cpuQuota: existsSync('/sys/fs/cgroup/cpu.max') ? readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim() : undefined,
      memoryLimit: existsSync('/sys/fs/cgroup/memory.max') ? readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim() : undefined },
    limitations: ['Historical27 canary, including edit workflow; Architecture junction supplements are separate.',
      'Optional main-elk is a pre-selector default renderer with graphLayout omitted; the declared experiment policy excludes indexed-layout. It is not a native baseline.',
      'Native A/A is an independent old-native control, never an ELK control or ratio divisor.',
      'Receipt version/implementation differences are recorded separately from output identity; no receipt normalization.',
      'The source/layout quality rerun is labelled separately by the existing release worker.'] }
  const save = (name: string, value: unknown) => writeFileSync(join(out, name), `${JSON.stringify(value, null, 2)}\n`)
  save('plan.json', metadata); save('report.json', { ...metadata, status: 'running', ok: false })
  const comparisons: unknown[] = []
  try {
    const measured = measureLayoutComparisons(join(out, 'shared-reference'), plans, groups, 3, 25, started + 480000, undefined, true, memoryBudgetMs === undefined ? undefined : { budgetMs: memoryBudgetMs })
    let ok = true
    for (let index = 0; index < measured.length; index++) {
      const pair = measured[index]!, control = plans[index]!.name === 'native23-aa'
      const rendered = report(inputs, groups, pair.runs, 3, control)
      // The reporter's A/A semantics are artifact-generic; its legacy display
      // name says ELK. Relabel only that description, never its checks/results.
      if (control) for (const check of rendered.summary.checks) check.name = check.name.replace('ELK A/A', 'Native A/A')
      const differences = inputs.map(input => {
        const a = pair.runs[0]!.results.get(input.id), b = pair.runs[1]!.results.get(input.id)
        return { id: input.id, measured: !!a && !!b, svgEqual: a?.svg.ok && b?.svg.ok ? a.svg.output === b.svg.output : undefined,
          receiptEqual: a?.layout?.receipt.sha256 === b?.layout?.receipt.sha256 && a?.layout?.receipt.bytes === b?.layout?.receipt.bytes,
          beforeDecisions: a?.layout?.decisions, candidateDecisions: b?.layout?.decisions,
          certificationEqual: JSON.stringify(a?.layout?.certification) === JSON.stringify(b?.layout?.certification) }
      })
      const result = { ...rendered.summary, name: pair.name, control, differences }
      comparisons.push(result); ok &&= rendered.ok
      mkdirSync(join(out, pair.name), { recursive: true })
      writeFileSync(join(out, pair.name, 'report.json'), `${JSON.stringify(result, null, 2)}\n`)
      writeFileSync(join(out, pair.name, 'report.md'), control ? rendered.markdown.replaceAll('ELK A/A', 'Native A/A') : rendered.markdown)
      save('report.json', { ...metadata, status: 'running', ok: false, comparisons })
    }
    const finalArtifacts = { baseline: artifactIdentity(baseline.directory), candidate: artifactIdentity(candidate.directory),
      ...(mainElk ? { mainElk: artifactIdentity(mainElk.directory) } : {}) }
    const artifactsUnchanged = JSON.stringify(artifacts) === JSON.stringify(finalArtifacts)
    ok &&= artifactsUnchanged
    save('report.json', { ...metadata, finishedAt: new Date().toISOString(), status: 'completed', ok, comparisons, artifactsUnchanged, finalArtifacts })
    if (!ok) process.exitCode = 1
  } catch (error) {
    save('report.json', { ...metadata, finishedAt: new Date().toISOString(), status: 'failed', ok: false, comparisons, error: String(error) })
    throw error
  }
}

if (import.meta.main) main()
