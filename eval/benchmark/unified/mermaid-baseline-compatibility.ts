import { readBenchmarkResult } from '../portable/project-records.ts'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { admitCurrentReference } from '../../mermaid-modern-compat/reference.ts'
import { assertBenchmarkExecutionAllowed } from '../ci-policy.ts'
import { captureInstalledDependencyClosure } from '../portable/artifact-dependencies.ts'
import { byteDigest } from '../portable/artifacts.ts'
import { portableCases } from '../portable/cohorts.ts'
import { median, quantile } from '../portable/statistics.ts'
import { defaultTimeObserver } from '../portable/time-observer.ts'
import { assertBenchmarkToolVersion } from '../tool-versions.ts'
import { deliveredArtifactIdentity, executableIdentity } from './benchmark-context.ts'
import { baselineMeasurementContext } from './baseline-measurement-context.ts'
import { committedDataIdentity } from './committed-data-identity.ts'
import { parseStartupResource, runStartupChild } from './entry-startup.ts'
import { inspectCurrentProjectRecords, stableValue } from '../portable/project-records.ts'
import { protocolIdentity } from './protocol-identity.ts'
import { requiredFamilyWorkloads } from './required-family-cases.ts'
import { runRetainedSuite } from './retained-suite.ts'
import { readStableSupportPolicy } from './stable-support.ts'
import type { BenchmarkObservation, UnifiedRunOptions, UnifiedSuiteResult } from './types.ts'
import { inventoryUpstreamTests } from './upstream-test-inventory.ts'

export interface MermaidBaselineCompatibilityOptions extends UnifiedRunOptions {
  parserStartupSamples?: number
  parserResourceSamples?: number
  parserPlan?: boolean
  parserFunctionalOnly?: boolean
}
interface ParserInput {
  bindingId: string
  caseId: string
  cohort: string
  family: string
  source: string
  expectedAccepted: boolean
  expectedTypes: string[]
  prelude?: { source: string; accept: boolean }[]
}
interface ParserTarget {
  project: string
  adapter: 'agentic' | 'pele' | 'mermaid'
  root: string
  packageName: string
  version: string
  specifier: string
  entry: string
  hostAdapter: string
  referenceRoot?: string
}
const protocol = 'node-public-parser-baseline-v1'
const worker = fileURLToPath(new URL('./mermaid-baseline-parser-worker.mjs', import.meta.url))
const read = (path: string): any => JSON.parse(readFileSync(path, 'utf8'))
const write = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n')
const serializable = (value: unknown): any => JSON.parse(JSON.stringify(value))
const startupCase = { id: 'parser-startup:two-node', family: 'flowchart', source: 'flowchart LR\nA[Start] --> B[End]' }
const workflowScope = 'Fresh Node process spawn through required host setup, public export import/initialization, one awaited public parser call, full returned-value JSON consumption and phase delivery. Result-file storage, subsequent qualification and teardown are excluded; lifecycle exit must still succeed.'
const resourceScope =
  'Separate fresh GNU time whole-child CPU/RSS includes Node, driver, target import, required jsdom for Mermaid, consumption, snapshots, GC and teardown. JS snapshots include driver/module/DOM state, not API-only allocation, native/GPU peaks, PSS or leak proof. Signed snapshot differences are descriptive.'

/** Duplicate corpus membership is an explicit alias of one source/prelude call,
 * not independent evidence. No implementation reply chooses the denominator. */
export function groupParserInputs(bindings: readonly ParserInput[]) {
  const unique: Array<Omit<ParserInput, 'bindingId' | 'caseId' | 'cohort'> & { uniqueId: string; bindings: ParserInput[] }> = []
  for (const binding of bindings) {
    const found = unique.find(input => input.source === binding.source && stableValue(input.prelude ?? []) === stableValue(binding.prelude ?? []))
    if (found) {
      if (found.expectedAccepted !== binding.expectedAccepted || stableValue(found.expectedTypes) !== stableValue(binding.expectedTypes)) throw Error('Identical parser inputs have conflicting independently declared expectations')
      found.bindings.push(binding)
    } else unique.push({ family: binding.family, source: binding.source, expectedAccepted: binding.expectedAccepted, expectedTypes: binding.expectedTypes, ...(binding.prelude ? { prelude: binding.prelude } : {}), uniqueId: `source-${unique.length + 1}`, bindings: [binding] })
  }
  return unique
}
function resolveTarget(root: string, adapter: ParserTarget['adapter'], node: string, referenceRoot?: string): ParserTarget {
  const actualRoot = realpathSync(root),
    pkg = read(join(actualRoot, 'package.json'))
  const expected = adapter === 'agentic' ? 'agentic-mermaid' : adapter === 'pele' ? 'pele' : 'mermaid'
  if (pkg.name !== expected || typeof pkg.version !== 'string') throw Error(`Wrong public parser package: expected ${expected} at ${actualRoot}`)
  const project = adapter === 'agentic' ? 'adewale/agentic-mermaid' : adapter === 'pele' ? 'obsidianmd/pele' : 'mermaid-js/mermaid'
  assertBenchmarkToolVersion(pkg.name, pkg.version, join(actualRoot, 'package.json'))
  assertBenchmarkToolVersion(project, pkg.version, join(actualRoot, 'package.json'))
  const specifier = adapter === 'agentic' ? 'agentic-mermaid/agent/core' : expected
  const entry = fileURLToPath(execFileSync(node, ['--experimental-import-meta-resolve', '--input-type=module', '-e', 'process.stdout.write(import.meta.resolve(process.argv[1], process.argv[2]))', specifier, pathToFileURL(join(actualRoot, 'package.json')).href], { encoding: 'utf8', timeout: 10_000 }).trim())
  return {
    project,
    adapter,
    root: actualRoot,
    packageName: pkg.name,
    version: pkg.version,
    specifier,
    entry: realpathSync(entry),
    hostAdapter: adapter === 'mermaid' ? 'Node + required jsdom DOM adapter' : 'Node without DOM adapter',
    ...(referenceRoot ? { referenceRoot: realpathSync(referenceRoot) } : {}),
  }
}
function targetIdentity(target: ParserTarget) {
  return { target, package: read(join(target.root, 'package.json')), entrySha256: byteDigest(target.entry), delivered: deliveredArtifactIdentity(target.adapter === 'agentic' ? join(target.root, 'dist') : target.root, true), dependencies: captureInstalledDependencyClosure(target.referenceRoot ?? target.root) }
}

/** Read an immutable original-assertion result without calling its sampler.
 * Current producer/input/artifact checks must still match; an expired result
 * becomes unavailable here, never an automatic remeasurement. */
export function retainedMermaidAssertions(harness: string, records: string, upstream: string, reference: string, inventory: ReturnType<typeof inventoryUpstreamTests>) {
  const retained = inspectCurrentProjectRecords(records).find(item => item.record.identity.project === 'mermaid-js/mermaid' && item.record.identity.lane === 'upstream-test-assertions')
  if (!retained?.evidenceRetained) return { status: 'unavailable', reason: 'No retained pinned Mermaid original-assertion record; this baseline does not retime that suite' }
  const record = retained.record,
    identity = record.identity as any
  const owning = readBenchmarkResult(join(record.evidenceDirectory, 'result.json'))
  const { observations: _observations, ...metadata } = owning
  if (stableValue(owning.observations) !== stableValue(record.observations) || stableValue(metadata) !== stableValue(record.provenance)) throw Error('Retained original assertion result differs from its immutable record')
  const paths = (objects: string[]) => objects.map(value => value.split('\t')[1]!)
  const referenceRequire = createRequire(join(reference, 'package.json'))
  if (
    identity.protocol.sourceCommit !== execFileSync('git', ['rev-parse', 'HEAD'], { cwd: upstream, encoding: 'utf8' }).trim() ||
    stableValue(protocolIdentity(harness, paths(identity.protocol.context.producers))) !== stableValue(identity.protocol.context.producers) ||
    stableValue(committedDataIdentity(harness, paths(identity.protocol.inputs))) !== stableValue(identity.protocol.inputs) ||
    stableValue(read(referenceRequire.resolve('mermaid/package.json'))) !== stableValue(identity.artifact.referencePackage) ||
    stableValue(captureInstalledDependencyClosure(reference)) !== stableValue(identity.artifact.installed)
  )
    return { status: 'unavailable', reason: 'Retained reference producer/input/artifact identity changed; no original assertions were rerun', recordId: record.id }
  const callbackRows = record.observations.filter(row => row.suite === 'upstream-test-assertions' && row.operation === 'original-upstream-assertions')
  const ledger = read(join(harness, 'eval/mermaid-upstream-suite-bench/mindmap-gitgraph-f3dea583.json'))
  const projected = new Set(ledger.upstream.files.map((file: any) => file.path))
  const replay = record.observations.filter(row => row.suite === 'upstream-source-replay')
  return {
    status: 'reused',
    recordId: record.id,
    evidenceDirectory: record.evidenceDirectory,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    identity: record.identity,
    projectedDeclarations: inventory.files.filter(file => projected.has(file.path)).reduce((sum, file) => sum + file.declarations.length, 0),
    expandedCallbacks: callbackRows.length,
    passedCallbacks: callbackRows.filter(row => row.status === 'passed').length,
    failedCallbacks: callbackRows.filter(row => row.status === 'failed').length,
    unavailableCallbacks: callbackRows.filter(row => row.status === 'blocked').map(row => ({ caseId: row.caseId, reason: row.detail })),
    skippedCallbacks: callbackRows.filter(row => row.status === 'not-applicable').length,
    executedAssertions: callbackRows.reduce((sum, row) => sum + Number(row.metrics?.executedAssertions ?? 0), 0),
    passedAssertions: callbackRows.reduce((sum, row) => sum + Number(row.metrics?.passedAssertions ?? 0), 0),
    fullInventory: inventory.counts,
    sourceReplay: {
      count: replay.length,
      accepted: replay.filter(row => row.metrics?.observedAccepted === true).length,
      rejected: replay.filter(row => row.metrics?.observedAccepted === false).length,
      unavailable: replay.filter(row => row.metrics?.observedAccepted === null).length,
      scope: 'Unscored literal admission diagnostics, including negatives, internal and disabled examples; acceptance is not an assertion pass',
    },
    scope: 'Original unchanged Mindmap/GitGraph callbacks through the existing reviewed public-model facade. Private logger/config accessors are unavailable in this adapter, not missing Mermaid functionality. Full inventory declarations outside this projection are unexecuted, not passes.',
  }
}

export async function runMermaidBaselineCompatibility(options: MermaidBaselineCompatibilityOptions): Promise<UnifiedSuiteResult> {
  assertBenchmarkExecutionAllowed()
  const startedAt = new Date().toISOString(),
    harness = options.harnessRoot ?? options.root
  const node = execFileSync(options.nodeExecutable ?? 'node', ['-p', 'process.execPath'], { encoding: 'utf8' }).trim()
  if (!node) throw Error('Node runtime admission returned no executable; check driver/sandbox access before benchmarking')
  const upstream = options.mermaidDir ?? resolve(harness, '../mermaid'),
    reference = options.referenceDir ?? resolve(harness, '../mermaid-reference')
  const pin = admitCurrentReference(upstream, reference)
  const policy = readStableSupportPolicy(join(harness, 'docs/project/upstream-mermaid-policy.json')) as any
  const expectedTypes = (family: string) => [...new Set<string>([family, ...(policy.families.find((row: any) => row.id === family)?.upstreamDetectorIds ?? [])])].sort()
  const bindings: ParserInput[] = [
    ...portableCases().map(input => ({ bindingId: `portable/${input.id}`, caseId: input.id, cohort: input.cohort, family: input.family, source: input.source, expectedAccepted: input.expected.accept, expectedTypes: expectedTypes(input.family), ...(input.prelude ? { prelude: input.prelude } : {}) })),
    ...requiredFamilyWorkloads().map(input => ({ bindingId: `required/${input.id}`, caseId: input.id, cohort: 'required-family', family: input.family, source: input.source, expectedAccepted: true, expectedTypes: expectedTypes(input.family) })),
  ]
  const cases = groupParserInputs(bindings)
  const common = { ...startupCase, uniqueId: startupCase.id, expectedAccepted: true, expectedTypes: expectedTypes('flowchart') }
  const settings = {
    startupSamples: options.parserFunctionalOnly ? 0 : (options.parserStartupSamples ?? (options.profile === 'full' ? 25 : 1)),
    resourceSamples: options.parserFunctionalOnly ? 0 : (options.parserResourceSamples ?? (options.profile === 'full' ? 5 : 1)),
    rounds: options.rounds,
    functionalOnly: options.parserFunctionalOnly ?? false,
    calibration: 'none; unpaired descriptive samples, not a controlled product speedup',
    startupCase,
    workflowScope,
    resourceScope,
  }
  for (const value of [settings.startupSamples, settings.resourceSamples]) if (!Number.isSafeInteger(value) || value < 0) throw Error('Parser sample counts must be nonnegative integers')
  const records = options.benchmarkRecordStore ?? join(harness, 'bench-report/project-records')
  const inventory = inventoryUpstreamTests(upstream)
  const original = retainedMermaidAssertions(harness, records, upstream, reference, inventory)
  const require = createRequire(join(reference, 'package.json'))
  const selected = options.communityProjects ?? ['adewale/agentic-mermaid', 'obsidianmd/pele', 'mermaid-js/mermaid']
  if (new Set(selected).size !== selected.length) throw Error('Parser baseline project selection contains duplicates')
  const targetList: ParserTarget[] = [],
    unavailableTargets: { project: string; reason: string }[] = []
  for (const project of selected) {
    try {
      if (project === 'adewale/agentic-mermaid') targetList.push(resolveTarget(options.packageRoot ?? options.root, 'agentic', node))
      else if (project === 'obsidianmd/pele' && options.portableArtifactRoot) targetList.push(resolveTarget(options.portableArtifactRoot, 'pele', node))
      else if (project === 'mermaid-js/mermaid') targetList.push(resolveTarget(dirname(require.resolve('mermaid/package.json')), 'mermaid', node, reference))
      else unavailableTargets.push({ project, reason: 'No configured actual package root and reviewed public parser adapter; no implementation was invoked' })
    } catch (error) {
      unavailableTargets.push({ project, reason: 'Public parser artifact admission failed: ' + String(error) })
    }
  }
  const out = options.out
  mkdirSync(out, { recursive: true })
  const observer = options.observerExecutable ?? options.portableObserver ?? defaultTimeObserver() ?? '/usr/bin/time'
  const observerIdentity = executableIdentity(observer)
  const plan = { schemaVersion: 1, protocol, pin, settings, bindings: bindings.length, uniqueInputs: cases.length, cases, targets: targetList, unavailableTargets, retainedOriginalAssertions: original }
  if (options.parserPlan) {
    write(join(out, 'parser-baseline-plan.json'), plan)
    return { id: 'mermaid-baseline-compatibility', status: 'not-applicable', startedAt, finishedAt: new Date().toISOString(), observations: [], gaps: ['Plan only; no parser or startup/resource sampler executed'], artifacts: [join(out, 'parser-baseline-plan.json')] }
  }
  const targetReports: any[] = [],
    observations: BenchmarkObservation[] = [],
    gaps: string[] = []
  for (const target of unavailableTargets) {
    observations.push({
      suite: 'mermaid-baseline-compatibility',
      surface: 'project-admission',
      runtime: 'unavailable',
      family: '*',
      caseId: target.project,
      operation: 'artifact-admission',
      format: 'report',
      mode: 'not-executed',
      status: 'blocked',
      metrics: { implementation: target.project, runtimeExecuted: false },
      detail: target.reason,
    })
    gaps.push(target.project + ': ' + target.reason)
  }
  const producers = ['eval/benchmark/unified/mermaid-baseline-compatibility.ts', 'eval/benchmark/unified/mermaid-baseline-parser-worker.mjs', 'eval/benchmark/unified/required-family-cases.ts']
  for (const target of targetList) {
    const targetOut = join(out, Buffer.from(target.project).toString('base64url'))
    const rows = await runRetainedSuite({
      out: targetOut,
      records,
      force: options.benchmarkForce,
      identity: () => serializable({ project: target.project, lane: 'node-public-parser-baseline', protocol: { protocol, context: baselineMeasurementContext(harness, node, producers), pin, cases, common }, artifact: targetIdentity(target), measurement: { settings, observer: observerIdentity } }),
      measure: async directory => {
        const begin = new Date().toISOString(),
          rawDir = join(directory, 'raw')
        mkdirSync(rawDir)
        const rows: BenchmarkObservation[] = []
        const functionFile = join(rawDir, 'functional.json'),
          functionJob = join(rawDir, 'functional.job.json')
        write(functionJob, { target, mode: 'functional', cases, resultFile: functionFile })
        execFileSync(node, ['--experimental-import-meta-resolve', worker, functionJob], { encoding: 'utf8', timeout: 120_000, maxBuffer: 1024 * 1024 })
        const functional = read(functionFile)
        for (const input of cases) {
          const result = functional.results.find((row: any) => row.uniqueId === input.uniqueId)
          if (!result) throw Error('Functional parser worker omitted an input: ' + input.uniqueId)
          for (const binding of input.bindings)
            rows.push({
              suite: 'mermaid-baseline-compatibility',
              surface: 'node:public-parser',
              runtime: `Node ${functional.runtime.versions.node}`,
              family: binding.family,
              caseId: binding.bindingId,
              operation: 'public-parse-admission',
              format: 'structured',
              mode: 'functional-admission',
              status: result.status,
              metrics: {
                implementation: target.project,
                uniqueId: input.uniqueId,
                canonicalCaseId: binding.caseId,
                cohort: binding.cohort,
                expectedAccepted: binding.expectedAccepted,
                publicAccepted: result.publicAccepted,
                accepted: result.accepted,
                syntaxRejected: result.syntaxRejected,
                preserved: result.preserved,
                expectedTypeMatches: result.expectedTypeMatches,
                preludeMatches: result.preludeMatches,
                runtimeExecuted: true,
                hostAdapter: target.hostAdapter,
                aliasOfIdenticalSource: input.bindings.length > 1,
              },
              detail: result.scopeNote ?? result.preservationReason ?? result.unavailable ?? result.error?.message,
            })
        }
        for (const mode of ['startup', 'resource'] as const)
          for (let sample = 1; sample <= (mode === 'startup' ? settings.startupSamples : settings.resourceSamples); sample++) {
            const round = ((sample - 1) % Math.max(1, options.rounds)) + 1
            const prefix = join(rawDir, `${mode}-${sample}`),
              jobFile = prefix + '.job.json',
              resultFile = prefix + '.json',
              resourceFile = prefix + '.time'
            const row: BenchmarkObservation = {
              suite: 'mermaid-baseline-compatibility',
              surface: 'node:public-parser',
              runtime: `Node ${functional.runtime.versions.node}`,
              family: common.family,
              caseId: common.id,
              operation: mode === 'startup' ? 'public-parse-first-consumed' : 'parser-process-resource',
              format: mode === 'startup' ? 'structured' : 'memory',
              mode: mode === 'startup' ? 'spawn-to-first-consumed-parse' : 'fresh-node-parser-resource',
              status: 'blocked',
              metrics: { implementation: target.project, round, sample, hostAdapter: target.hostAdapter, workflowScope: mode === 'startup' ? workflowScope : resourceScope, calibration: 'unpaired-descriptive-only' },
            }
            try {
              if (mode === 'resource' && (observerIdentity.status !== 'available' || !/GNU\s*Time/i.test(observerIdentity.version ?? ''))) throw Error('Verified GNU time is unavailable; no substitute resource sample')
              write(jobFile, { target, mode, cases: [common], resultFile, consumedFile: prefix + '.consumed.json' })
              const workerArgs = ['--experimental-import-meta-resolve', ...(mode === 'resource' ? ['--expose-gc'] : []), worker, jobFile]
              const child = await runStartupChild(mode === 'resource' ? observer : node, mode === 'resource' ? ['-f', 'user_seconds=%U\nsystem_seconds=%S\npeak_rss_kib=%M', '-o', resourceFile, '--', node, ...workerArgs] : workerArgs, { cwd: target.root, timeoutMs: 60_000 })
              if (child.code !== 0 || !existsSync(resultFile)) throw Error(`Parser child lifecycle failed (${child.code}): ${child.stderr}`)
              const result = read(resultFile),
                call = result.results[0],
                first = child.phases.find(phase => phase.phase === 'first-consumed')
              row.status = call.status
              row.bytes = call.outputBytes
              row.metrics = { ...row.metrics, publicApiMs: call.publicApiMs ?? null, lifecycleExitCode: child.code, processThroughExitMs: child.wallMs, resultFile, gcAvailable: result.gcAvailable }
              if (mode === 'startup') {
                if (!first) throw Error('Parser child omitted complete first-consumed phase')
                row.samplesMs = [first.observedMs]
              } else row.metrics = { ...row.metrics, ...parseStartupResource(readFileSync(resourceFile, 'utf8')), snapshotsFile: resultFile }
              row.detail = call.unavailable ?? call.error?.message
            } catch (error) {
              row.status = 'blocked'
              row.detail = String(error)
            }
            rows.push(row)
          }
        write(join(directory, 'parser-target.json'), { target, settings, functionality: { uniqueInvocations: cases.length, bindings: cases.flatMap(input => input.bindings.map(binding => ({ ...binding, uniqueId: input.uniqueId, result: functional.results.find((row: any) => row.uniqueId === input.uniqueId) }))) } })
        return {
          id: 'mermaid-baseline-compatibility',
          status: rows.some(row => row.status === 'failed') ? 'failed' : rows.some(row => row.status === 'blocked' || row.status === 'unsupported') ? 'blocked' : 'passed',
          startedAt: begin,
          finishedAt: new Date().toISOString(),
          observations: rows,
          gaps: [workflowScope, resourceScope, 'Different public return scopes: Agentic typed/source model, Pele native parser model, Mermaid validation/type result. This is not full-AST throughput or a calibrated speedup.'],
        }
      },
    })
    observations.push(...rows.observations)
    const cache = read(join(targetOut, 'cache.json')),
      targetData = read(join(cache.evidenceDirectory, 'parser-target.json'))
    const startupRows = rows.observations.filter(row => row.operation === 'public-parse-first-consumed')
    const qualified = startupRows.filter(row => row.status === 'passed').flatMap(row => row.samplesMs ?? [])
    const resourceRows = rows.observations
      .filter(row => row.operation === 'parser-process-resource')
      .map(row => ({
        round: row.metrics?.round,
        sample: row.metrics?.sample,
        status: row.status,
        wholeWorker: { peakRssBytes: row.metrics?.peakRssBytes ?? null, userCpuMs: row.metrics?.userCpuMs ?? null, systemCpuMs: row.metrics?.systemCpuMs ?? null, cpuResolutionMs: row.metrics?.cpuResolutionMs ?? null },
        snapshots: typeof row.metrics?.snapshotsFile === 'string' ? read(row.metrics.snapshotsFile).snapshots : null,
        error: row.detail ?? null,
      }))
    targetReports.push({
      project: target.project,
      version: target.version,
      boundary: target.hostAdapter,
      artifact: targetIdentity(target),
      recordId: cache.recordId,
      evidenceDirectory: cache.evidenceDirectory,
      startedAt: rows.startedAt,
      finishedAt: rows.finishedAt,
      reused: cache.reused,
      functionality: targetData.functionality,
      startup: { caseId: startupCase.id, count: qualified.length, attempted: startupRows.length, samplesMs: qualified, medianMs: qualified.length ? median(qualified) : null, p95Ms: qualified.length >= 20 ? quantile(qualified, 0.95) : null, rows: startupRows, scope: workflowScope },
      resources: { rows: resourceRows, scope: resourceScope },
      capabilities:
        target.adapter === 'mermaid'
          ? [
              { operation: 'Agentic typed edit/build/query APIs', status: 'not-applicable', reason: 'Not a public API in the selected Mermaid core package; not a failed parser benchmark' },
              { operation: 'MCP, native executable and CLI', status: 'not-applicable', reason: 'Mermaid core declares no equivalent Agentic endpoints; a separately versioned wrapper/CLI requires its own artifact and benchmark' },
            ]
          : [{ operation: 'Other invocation and typed API functionality', status: 'not-measured', reason: 'This lane measures public syntax admission, not every product API' }],
    })
  }
  const commonQualifiedCaseIds = bindings
    .filter(binding => binding.expectedAccepted && targetReports.length > 1 && targetReports.every(target => target.functionality.bindings.some((row: any) => row.bindingId === binding.bindingId && row.result.status === 'passed' && row.result.accepted === true)))
    .map(binding => binding.bindingId)
  gaps.push(
    'No A/A control or randomized paired experiment: startup medians/p95 are descriptive. Preserve all rejected, unsupported and unavailable cases; do not rank positive-only survivors as complete-library performance.',
    'Three independently authored invalid sources are already members of the portable cohort; they are not extra independent cases when also listed as negative controls.',
    'Agentic deliberately reads generously. A native-parse acceptance divergence on a strict negative is not automatically a product parser bug; verify warnings are a separate unmeasured public path in this lane.',
  )
  if (original.status !== 'reused') gaps.push(original.reason!)
  write(join(out, 'parser-baseline.json'), {
    schemaVersion: 1,
    protocol,
    pin,
    scope: 'Public syntax-admission workflow, kept separate from browser SVG rendering, native-model fidelity and original assertion compatibility.',
    settings,
    targets: targetReports,
    unavailableTargets,
    commonQualifiedCaseIds,
    retainedOriginalAssertions: original,
    gaps,
  })
  return {
    id: 'mermaid-baseline-compatibility',
    status: observations.some(row => row.status === 'failed') ? 'failed' : observations.some(row => row.status === 'blocked' || row.status === 'unsupported') || original.status !== 'reused' ? 'blocked' : 'passed',
    startedAt,
    finishedAt: new Date().toISOString(),
    observations,
    gaps,
    artifacts: [join(out, 'parser-baseline.json')],
  }
}

export function parseMermaidBaselineOptions(argv: string[]): MermaidBaselineCompatibilityOptions {
  const values = new Map<string, string>(),
    switches = new Set(['--plan', '--force', '--functional-only'])
  const names = new Set(['--root', '--harness-root', '--package-root', '--pele-root', '--reference-dir', '--mermaid-dir', '--records', '--out', '--node', '--observer', '--startup-samples', '--resource-samples', '--projects', '--rounds', '--profile'])
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index]!
    if (values.has(flag)) throw Error('Duplicate parser baseline option ' + flag)
    if (switches.has(flag)) {
      values.set(flag, 'true')
      continue
    }
    const value = argv[++index]
    if (!names.has(flag) || !value || value.startsWith('--')) throw Error('Invalid parser baseline option ' + flag)
    values.set(flag, value)
  }
  const root = resolve(values.get('--root') ?? process.cwd())
  const number = (flag: string, fallback: number) => {
    const value = Number(values.get(flag) ?? fallback)
    if (!Number.isSafeInteger(value) || value < 1) throw Error(flag + ' requires a positive integer')
    return value
  }
  const profile = values.get('--profile') ?? 'full'
  if (!['smoke', 'full'].includes(profile)) throw Error('Profile must be smoke or full')
  return {
    root,
    harnessRoot: resolve(values.get('--harness-root') ?? root),
    packageRoot: values.has('--package-root') ? resolve(values.get('--package-root')!) : root,
    portableArtifactRoot: values.has('--pele-root') ? resolve(values.get('--pele-root')!) : undefined,
    portableProject: 'obsidianmd/pele',
    referenceDir: values.has('--reference-dir') ? resolve(values.get('--reference-dir')!) : undefined,
    mermaidDir: values.has('--mermaid-dir') ? resolve(values.get('--mermaid-dir')!) : undefined,
    benchmarkRecordStore: values.has('--records') ? resolve(values.get('--records')!) : undefined,
    out: resolve(values.get('--out') ?? 'bench-report/mermaid-parser-baseline'),
    nodeExecutable: values.get('--node'),
    observerExecutable: values.get('--observer'),
    parserStartupSamples: number('--startup-samples', profile === 'full' ? 25 : 1),
    parserResourceSamples: number('--resource-samples', profile === 'full' ? 5 : 1),
    rounds: number('--rounds', 5),
    profile: profile as 'smoke' | 'full',
    communityProjects: values.get('--projects')?.split(','),
    parserPlan: values.has('--plan'),
    parserFunctionalOnly: values.has('--functional-only'),
    benchmarkForce: values.has('--force'),
  }
}
export async function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === '--help') {
    console.log(
      'Local public-parser baseline: --root DIR --package-root PACKAGE --pele-root PACKAGE --reference-dir DIR --mermaid-dir DIR --records DIR --out DIR [--node EXEC --observer GNU_TIME --startup-samples 25 --resource-samples 5 --rounds 5 --profile full|smoke --projects IDs --functional-only --plan --force]. Host setup/import are inside fresh result clocks. No CI execution or provider calls.',
    )
    return
  }
  const result = await runMermaidBaselineCompatibility(parseMermaidBaselineOptions(argv))
  console.log(JSON.stringify({ id: result.id, status: result.status, observations: result.observations.length, artifacts: result.artifacts }, null, 2))
  if (result.status === 'failed') process.exitCode = 1
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
