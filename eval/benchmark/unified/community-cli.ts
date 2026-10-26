import { readBenchmarkDocument, writeBenchmarkDocument } from '../portable/project-records.ts'
/** Supplemental fixed-core CLI comparison. Existing community evidence is never overwritten. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { communityCoreWorkloads, normalizeCommunityOutput, runCommunityCli } from './community.ts'
import type { CommunityArtifact, PreparedCommunity } from './community-types.ts'
import type { BenchmarkObservation, UnifiedRunOptions, UnifiedSuiteResult, UnifiedWorkload } from './types.ts'

interface Options {
  run: string
  out: string
  target: string
  packageRoot: string
  rounds: number
  outputs?: string[]
  observerExecutable?: string
  observerProvenance?: string
  resourceOnly?: boolean
  baselineCli?: string
}
interface Variant {
  prepared: PreparedCommunity
  variantOf: string
  variant: string
  outputs: string[]
  identity?: unknown
  error?: string
}
const read = readBenchmarkDocument
const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.length % 2 ? sorted[sorted.length >> 1]! : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2
}
const terminalIds = ['core:flow5', 'core:tree50', 'core:seq20']
const safe = (value: string) => value.replace(/[^a-z0-9._-]+/gi, '_')
function git(root: string, args: string[]) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}
function findRun(path: string, depth = 0): string {
  if (existsSync(join(path, 'community-prepared.json')) && existsSync(join(path, 'community-inputs.json'))) return path
  if (depth >= 5) throw Error('No paired community-prepared.json/community-inputs.json found under ' + path)
  const candidates: string[] = []
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (!entry.isDirectory() || /^(community-raw|node_modules|cache|worktrees|packages|attempts)$/.test(entry.name)) continue
    try {
      candidates.push(findRun(join(path, entry.name), depth + 1))
    } catch {
      // This child is not a community suite output.
    }
  }
  if (candidates.length !== 1) throw Error(`Expected exactly one community suite output under ${path}, found ${candidates.length}; pass its directory explicitly`)
  return candidates[0]!
}
function admittedIdentity(artifact: CommunityArtifact) {
  if (!artifact.executable || !existsSync(artifact.executable)) throw Error('Declared public CLI executable is absent')
  const executable = { path: realpathSync(artifact.executable), sha256: digest(artifact.executable), bytes: statSync(artifact.executable).size }
  if (artifact.sha256 && artifact.sha256 !== executable.sha256) throw Error('Prepared executable digest differs from actual bytes')
  const files = (artifact.files ?? []).map(file => {
    if (!existsSync(file.path) || digest(file.path) !== file.sha256) throw Error('Prepared artifact file digest differs: ' + file.path)
    return { ...file, bytes: statSync(file.path).size }
  })
  const delivery = artifact.runtime?.startsWith('node:') ? { executableBytes: executable.bytes, scope: 'external Node runtime executable; not npm package or dependency closure' } : { executableBytes: executable.bytes, scope: 'compiled CLI executable only; dynamic libraries and other external resources excluded' }
  return { executable, delivery, files, version: artifact.version, revision: artifact.revision ?? null, integrity: artifact.integrity ?? null, args: artifact.args ?? [], input: artifact.input ?? 'stdin', runtime: artifact.runtime ?? 'native:compiled-public-cli (embedded runtime version unreported)' }
}
function shippedFiles(root: string, directory = join(root, 'dist')): Array<{ path: string; sha256: string }> {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return shippedFiles(root, path)
    return entry.isFile() ? [{ path, sha256: digest(path) }] : []
  })
}
function candidateVariants(options: Options, prepared: PreparedCommunity[]): Variant[] {
  const base = prepared.find(entry => entry.node.benchmark?.adapter === 'agentic')
  if (!base) return []
  const pkg = read(join(options.packageRoot, 'package.json'))
  const cliPath = typeof pkg.bin === 'string' ? pkg.bin : (pkg.bin?.am ?? pkg.bin?.['agentic-mermaid'])
  if (!cliPath) throw Error('Installed Agentic Mermaid package declares no CLI')
  const cli = join(options.packageRoot, cliPath),
    files = shippedFiles(options.packageRoot)
  files.push({ path: join(options.packageRoot, 'package.json'), sha256: digest(join(options.packageRoot, 'package.json')) })
  const nodeRuntime = JSON.parse(execFileSync(process.env.NODE_BIN ?? 'node', ['-p', 'JSON.stringify({executable:process.execPath,version:process.versions.node})'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })) as { executable: string; version: string }
  const definitions = [
    { variant: 'node-cli', executable: nodeRuntime.executable, args: [cli, 'render', '-', '--format', '{format}'], runtime: `node:${nodeRuntime.version} installed public CLI`, files },
    { variant: 'native-cli', executable: join(options.target, 'dist/am'), args: ['render', '-', '--format', '{format}'], runtime: 'bun-compiled:embedded-runtime (version unreported)', files: [] },
  ]
  return definitions.map(definition => ({
    variantOf: base.node.id,
    variant: definition.variant,
    outputs: ['svg', 'terminal'],
    prepared: {
      node: { ...base.node, id: `${base.node.id}#${definition.variant}`, benchmark: { ...base.node.benchmark!, outputs: ['svg', 'unicode'] } },
      artifact: { kind: 'cli', executable: definition.executable, args: definition.args, input: 'stdin', version: pkg.version, runtime: definition.runtime, files: definition.files },
    },
  }))
}
function ranksFor(variants: Variant[], observations: BenchmarkObservation[], workloads: UnifiedWorkload[], rounds: number) {
  return variants
    .flatMap(variant =>
      variant.outputs.map(output => {
        const requiredCaseIds = workloads.filter(w => output !== 'terminal' || terminalIds.includes(w.id)).map(w => w.id)
        const rows = observations.filter(row => row.metrics?.implementation === variant.prepared.node.id && row.format === output)
        const perRoundMs = Array.from({ length: rounds }, (_, index) => {
          const selected = requiredCaseIds.map(id => rows.filter(row => row.caseId === id && row.metrics?.round === index + 1))
          return selected.every(matches => matches.length === 1 && matches[0]!.status === 'passed' && matches[0]!.samplesMs?.length === 1 && Number.isFinite(matches[0]!.samplesMs![0]) && matches[0]!.samplesMs![0]! > 0) ? selected.reduce((sum, matches) => sum + matches[0]!.samplesMs![0]!, 0) : null
        })
        const qualified = rows.length === requiredCaseIds.length * rounds && perRoundMs.every(value => value !== null)
        return {
          implementation: variant.prepared.node.id,
          variantOf: variant.variantOf,
          variant: variant.variant,
          metricId: `${variant.prepared.node.id}:cli:${output}`,
          surface: 'cli:end-to-end',
          output,
          runtime: variant.prepared.artifact?.runtime ?? 'native:compiled-public-cli (embedded runtime version unreported)',
          version: variant.prepared.artifact?.version ?? null,
          artifactDelivery: variant.identity ? (variant.identity as ReturnType<typeof admittedIdentity>).delivery : null,
          requiredCaseIds,
          rounds,
          qualified,
          perRoundMs,
          medianMs: qualified ? median(perRoundMs as number[]) : null,
          featureCoverage: null,
          featureCoverageStatus: 'unmeasured: fixed-core supplemental cohort only',
          error: variant.error ?? null,
        }
      }),
    )
    .sort((a, b) => a.output.localeCompare(b.output) || (a.medianMs ?? Infinity) - (b.medianMs ?? Infinity))
}
interface ResourceObserver {
  path: string
  version: string | null
  error?: string
  sha256?: string
  bytes?: number
  locale?: Record<string, string | null>
  provenance?: unknown
}
function resourceObserver(configured?: string, provenance?: string): ResourceObserver {
  const path = resolve(configured ?? '/usr/bin/time')
  try {
    if (!existsSync(path)) throw Error('GNU /usr/bin/time is unavailable')
    const version = execFileSync(path, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
    if (!/GNU\s+Time/i.test(version)) throw Error('External time observer is not GNU time')
    return { path: realpathSync(path), version, sha256: digest(path), bytes: statSync(path).size, locale: { LC_ALL: process.env.LC_ALL ?? null, LC_NUMERIC: process.env.LC_NUMERIC ?? null, LANG: process.env.LANG ?? null }, ...(provenance ? { provenance: { file: resolve(provenance), value: read(provenance) } } : {}) }
  } catch (error) {
    return { path, version: null, error: String(error) }
  }
}
function resourceDiagnostic(variant: Variant, output: string, workload: UnifiedWorkload, observer: ResourceObserver, out: string): BenchmarkObservation {
  const row: BenchmarkObservation = {
    suite: 'community-cli',
    surface: 'cli:end-to-end',
    runtime: variant.prepared.artifact?.runtime ?? 'native:compiled-public-cli (embedded runtime version unreported)',
    family: workload.family,
    caseId: workload.id,
    operation: 'resource-diagnostic',
    format: output,
    mode: 'instrumented-resource-only',
    status: 'blocked',
    metrics: { implementation: variant.prepared.node.id, variantOf: variant.variantOf, variant: variant.variant, metricId: `${variant.prepared.node.id}:cli-resource:${output}` },
  }
  const artifact = variant.prepared.artifact!
  if (observer.error || variant.error || (artifact.format && artifact.format !== output)) {
    row.detail = observer.error ?? variant.error ?? 'Declared CLI has no prepared binding for this output'
    return row
  }
  const resourcePath = join(out, 'gnu-time.txt')
  rmSync(resourcePath, { force: true })
  // GNU time execs the exact reviewed command; its observer elapsed time is never a speed sample.
  const wrapped: PreparedCommunity = { node: variant.prepared.node, artifact: { ...artifact, executable: observer.path, args: ['-f', 'user_seconds=%U\nsystem_seconds=%S\npeak_rss_kib=%M', '-o', resourcePath, '--', artifact.executable!, ...(artifact.args ?? [])] } }
  const actual = runCommunityCli(wrapped, output, workload, 1, out)
  row.status = actual.status
  row.bytes = actual.bytes
  row.findings = actual.findings
  row.detail = actual.detail
  row.metrics = { ...row.metrics, qualification: actual.metrics?.qualification ?? 'unavailable', observer: observer.path, clock: 'GNU time child user/system CPU and maximum resident set; observer elapsed discarded' }
  // Failed/invalid output still consumed real child resources; keep those costs without qualifying its cohort.
  try {
    if (!existsSync(resourcePath)) throw Error('GNU time did not emit child resource evidence')
    const fields = new Map(
      readFileSync(resourcePath, 'utf8')
        .trim()
        .split('\n')
        .map(line => {
          const equal = line.indexOf('=')
          return [line.slice(0, equal), line.slice(equal + 1)]
        }),
    )
    const value = (name: string) => {
      const text = fields.get(name)
      if (!text || !/^\d+(?:[.,]\d+)?$/.test(text)) throw Error('Invalid GNU time resource field ' + name)
      return Number(text.replace(',', '.'))
    }
    const userCpuMs = value('user_seconds') * 1000,
      systemCpuMs = value('system_seconds') * 1000,
      peakRssBytes = value('peak_rss_kib') * 1024
    if (![userCpuMs, systemCpuMs, peakRssBytes].every(Number.isFinite) || peakRssBytes <= 0) throw Error('GNU time resource values are not finite measured child evidence')
    row.metrics = {
      ...row.metrics,
      userCpuMs,
      systemCpuMs,
      totalCpuMs: userCpuMs + systemCpuMs,
      peakRssBytes,
      cpuReportingQuantumMs: 10,
      cpuBelowResolution: userCpuMs + systemCpuMs === 0,
      totalCpuLowerBoundMs: Math.max(0, userCpuMs + systemCpuMs - 20),
      totalCpuUpperBoundMs: userCpuMs + systemCpuMs + 20,
      evidence: resourcePath,
    }
  } catch (error) {
    row.status = 'failed'
    row.detail = [row.detail, String(error)].filter(Boolean).join('; ')
  }
  return row
}
function resourceRanksFor(variants: Variant[], diagnostics: BenchmarkObservation[], workloads: UnifiedWorkload[]) {
  return variants.flatMap(variant =>
    variant.outputs.map(output => {
      const requiredCaseIds = workloads.filter(w => output !== 'terminal' || terminalIds.includes(w.id)).map(w => w.id),
        rows = diagnostics.filter(row => row.metrics?.implementation === variant.prepared.node.id && row.format === output)
      const qualified =
        rows.length === requiredCaseIds.length &&
        requiredCaseIds.every(id => rows.filter(row => row.caseId === id).length === 1) &&
        rows.every(row => row.status === 'passed' && ['userCpuMs', 'systemCpuMs', 'peakRssBytes'].every(name => typeof row.metrics?.[name] === 'number' && Number.isFinite(row.metrics[name]) && Number(row.metrics[name]) >= 0) && Number(row.metrics?.peakRssBytes) > 0)
      const userCpuMs = qualified ? rows.reduce((sum, row) => sum + Number(row.metrics!.userCpuMs), 0) : null,
        systemCpuMs = qualified ? rows.reduce((sum, row) => sum + Number(row.metrics!.systemCpuMs), 0) : null
      return {
        implementation: variant.prepared.node.id,
        variantOf: variant.variantOf,
        variant: variant.variant,
        metricId: `${variant.prepared.node.id}:cli-resource:${output}`,
        surface: 'cli:end-to-end',
        output,
        runtime: variant.prepared.artifact?.runtime ?? 'native:compiled-public-cli (embedded runtime version unreported)',
        version: variant.prepared.artifact?.version ?? null,
        artifactDelivery: variant.identity ? (variant.identity as ReturnType<typeof admittedIdentity>).delivery : null,
        requiredCaseIds,
        qualified,
        peakRssBytes: qualified ? Math.max(...rows.map(row => Number(row.metrics!.peakRssBytes))) : null,
        userCpuMs,
        systemCpuMs,
        totalCpuMs: qualified ? userCpuMs! + systemCpuMs! : null,
        cpuBelowResolution: qualified ? userCpuMs! + systemCpuMs! === 0 : null,
        totalCpuLowerBoundMs: qualified ? Math.max(0, userCpuMs! + systemCpuMs! - 20 * requiredCaseIds.length) : null,
        totalCpuUpperBoundMs: qualified ? userCpuMs! + systemCpuMs! + 20 * requiredCaseIds.length : null,
        cpuUncertaintyAllowanceMs: 20 * requiredCaseIds.length,
        cpuReportingQuantumMs: 10,
        cpuPrecisionPolicy: 'User/system fields report10ms grain. Portfolio bounds allow20ms per case for both fields plus unmodeled rounding; conservative reporting allowance, not a statistical confidence interval. All-zero reported CPU is censored below resolution, never free execution. No CPU speed rank.',
        portfolioPolicy: 'One fresh process per required case; peak RSS is maximum case high-water mark, CPU is sum across cases; zero CPU readings may be below10ms precision, never a zero-latency result',
      }
    }),
  )
}
export async function runCommunityCliCohort(options: Options) {
  if (!Number.isSafeInteger(options.rounds) || options.rounds < 1) throw Error('rounds must be a positive integer')
  const selectedOutputs = options.outputs?.map(normalizeCommunityOutput)
  if (selectedOutputs && (!selectedOutputs.length || new Set(selectedOutputs).size !== selectedOutputs.length || selectedOutputs.some(output => !['svg', 'terminal'].includes(output)))) throw Error('CLI output selection must contain unique svg/terminal names')
  const source = findRun(options.run),
    prepared = read(join(source, 'community-prepared.json')) as PreparedCommunity[],
    inputs = read(join(source, 'community-inputs.json')) as { workloads: UnifiedWorkload[] }
  // Preserve the exact frozen source and independent expectations from the original run.
  const required = communityCoreWorkloads().map(w => w.id),
    workloads = inputs.workloads.filter(w => required.includes(w.id))
  if (workloads.length !== required.length || new Set(workloads.map(w => w.id)).size !== required.length || required.some(id => !workloads.some(w => w.id === id)) || workloads.some(w => !w.expectedLabels?.length)) throw Error('Frozen community inputs do not contain the complete independently labelled fixed core')
  mkdirSync(options.out, { recursive: true })
  const resultPath = join(options.out, 'community-cli-result.json'),
    ranksPath = join(options.out, 'ranks.json')
  if (existsSync(resultPath) || existsSync(ranksPath)) throw Error('Supplemental output already contains evidence; choose a fresh --out')
  const variants: Variant[] = prepared
    .filter(entry => entry.artifact?.kind === 'cli')
    .map(entry => ({ prepared: entry, variantOf: entry.node.id, variant: 'public-cli', outputs: [...new Set((entry.node.benchmark?.outputs ?? entry.node.outputs).map(normalizeCommunityOutput))].filter(output => output === 'svg' || output === 'terminal') }))
  variants.push(...candidateVariants(options, prepared))
  if (selectedOutputs) for (const variant of variants) variant.outputs = variant.outputs.filter(output => selectedOutputs.includes(output))
  for (const variant of variants) {
    try {
      variant.identity = admittedIdentity(variant.prepared.artifact!)
    } catch (error) {
      variant.error = String(error)
    }
  }
  const observer = resourceObserver(options.observerExecutable, options.observerProvenance) // Availability/version is collected before any latency clock.
  let baseline: any
  if (options.resourceOnly) {
    if (!options.baselineCli) throw Error('Resource-only mode requires --baseline-cli with immutable completed CLI evidence')
    baseline = read(join(options.baselineCli, 'community-cli-result.json'))
    if (baseline.id !== 'community-cli' || !baseline.finishedAt || baseline.rounds !== options.rounds || JSON.stringify(baseline.evidence?.cohort) !== JSON.stringify(workloads)) throw Error('Resource-only baseline has a different or incomplete literal cohort/round policy')
    const identity = (variant: Variant) => ({
      variantOf: variant.variantOf,
      variant: variant.variant,
      outputs: variant.outputs,
      node: variant.prepared.node,
      artifact: Object.fromEntries(Object.entries(variant.prepared.artifact ?? {}).filter(([key]) => key !== 'detail')),
      identity: variant.identity,
      error: variant.error ?? null,
    })
    if (JSON.stringify(baseline.evidence.variants.map(identity)) !== JSON.stringify(variants.map(identity))) throw Error('Resource-only program, runtime, binding or artifact bytes differ from original CLI cohort')
    if (resolve(baseline.evidence.sourceRun) !== resolve(source) || resolve(baseline.evidence.target.root) !== resolve(options.target) || resolve(baseline.evidence.target.packageRoot) !== resolve(options.packageRoot) || baseline.evidence.target.head !== git(options.target, ['rev-parse', 'HEAD']))
      throw Error('Resource-only target/source parent differs from baseline')
    if (observer.error) throw Error('Resource-only observer unavailable: ' + observer.error)
  }
  const status = git(options.target, ['status', '--porcelain=v1', '--untracked-files=all']).split('\n').filter(Boolean)
  const harnessRoot = resolve(import.meta.dir, '../../..'),
    harnessStatus = git(harnessRoot, ['status', '--porcelain=v1', '--untracked-files=all']).split('\n').filter(Boolean)
  const evidence = {
    sourceRun: source,
    resourceOnly: options.resourceOnly ?? false,
    resourcePasses: 1,
    latencyMeasured: !options.resourceOnly,
    baselineCli: baseline
      ? {
          directory: resolve(options.baselineCli!),
          startedAt: baseline.startedAt,
          finishedAt: baseline.finishedAt,
          latencyFinishedAt: baseline.latencyFinishedAt ?? null,
          previousResourceRows: baseline.diagnostics.length,
          previousQualifiedResourceRanks: baseline.resourceRanks.filter((row: any) => row.qualified).length,
        }
      : null,
    outputSelection: selectedOutputs ?? null,
    scope: selectedOutputs ? 'partial-output-lane; omitted CLI latency/resources were not executed' : 'all-bound-CLI-outputs',
    preparedFile: join(source, 'community-prepared.json'),
    inputsFile: join(source, 'community-inputs.json'),
    harness: { root: harnessRoot, head: git(harnessRoot, ['rev-parse', 'HEAD']), dirty: harnessStatus.length > 0, status: harnessStatus },
    target: { root: options.target, packageRoot: options.packageRoot, head: git(options.target, ['rev-parse', 'HEAD']), dirty: status.length > 0, status },
    cohort: workloads,
    catalogNodes: prepared.length,
    comparatorNodes: prepared.filter(entry => entry.node.benchmark).length,
    catalogTools: [...new Set(variants.map(variant => variant.variantOf))],
    variants,
    resourceObserver: observer,
  }
  writeFileSync(join(options.out, 'community-cli-inputs.json'), JSON.stringify(evidence, null, 2))
  const startedAt = new Date().toISOString(),
    observations: BenchmarkObservation[] = [],
    executionOrder: string[][] = []
  if (!options.resourceOnly)
    for (let round = 1; round <= options.rounds; round++) {
      const ordered = round % 2 ? variants : [...variants].reverse()
      executionOrder.push(ordered.map(variant => variant.prepared.node.id))
      for (const variant of ordered)
        for (const output of variant.outputs)
          for (const workload of workloads.filter(w => output !== 'terminal' || terminalIds.includes(w.id))) {
            const directory = join(options.out, 'raw', `round-${round}`, safe(variant.prepared.node.id), output, safe(workload.id))
            mkdirSync(directory, { recursive: true })
            let row: BenchmarkObservation
            if (variant.error || (variant.prepared.artifact?.format && variant.prepared.artifact.format !== output)) {
              row = {
                suite: 'community-cli',
                surface: 'cli:end-to-end',
                runtime: variant.prepared.artifact?.runtime ?? 'native:compiled-public-cli (embedded runtime version unreported)',
                caseId: workload.id,
                family: workload.family,
                operation: 'render',
                format: output,
                mode: 'fresh-process',
                status: 'blocked',
                detail: variant.error ?? 'Declared CLI has no prepared binding for this output',
              }
            } else row = runCommunityCli(variant.prepared, output, workload, round, directory)
            row.suite = 'community-cli'
            row.runtime = variant.prepared.artifact?.runtime ?? 'native:compiled-public-cli (embedded runtime version unreported)'
            row.metrics = { ...row.metrics, implementation: variant.prepared.node.id, variantOf: variant.variantOf, variant: variant.variant, metricId: `${variant.prepared.node.id}:cli:${output}`, round }
            observations.push(row)
            writeFileSync(join(directory, 'observation.json'), JSON.stringify(row, null, 2))
          }
    }
  const latencyFinishedAt = options.resourceOnly ? null : new Date().toISOString(),
    diagnostics: BenchmarkObservation[] = []
  // Every latency round is complete before the separately instrumented resource phase begins.
  if (!variants.some(variant => variant.outputs.length))
    diagnostics.push({
      suite: 'community-cli',
      surface: 'cli:end-to-end',
      runtime: 'unmeasured',
      family: '*',
      caseId: 'no-cli-variant',
      operation: 'capability',
      format: 'mixed',
      mode: 'capability',
      status: 'not-applicable',
      detail: 'The selected projects have no bound public CLI variant for these outputs; no latency or resource pass was executed.',
    })
  else if (observer.error) diagnostics.push({ suite: 'community-cli', surface: 'cli:end-to-end', runtime: 'unmeasured', family: '*', caseId: 'resource-observer', operation: 'resource-diagnostic', format: 'mixed', mode: 'instrumented-resource-only', status: 'blocked', detail: observer.error })
  for (const variant of variants)
    for (const output of variant.outputs)
      for (const workload of workloads.filter(w => output !== 'terminal' || terminalIds.includes(w.id))) {
        const directory = join(options.out, 'resources', safe(variant.prepared.node.id), output, safe(workload.id))
        mkdirSync(directory, { recursive: true })
        const diagnostic = resourceDiagnostic(variant, output, workload, observer, directory)
        diagnostics.push(diagnostic)
        writeFileSync(join(directory, 'observation.json'), JSON.stringify(diagnostic, null, 2))
      }
  // Check executable and declared shipped bytes again; a changed artifact withholds its rank.
  for (const variant of variants)
    if (!variant.error) {
      try {
        if (JSON.stringify(admittedIdentity(variant.prepared.artifact!)) !== JSON.stringify(variant.identity)) throw Error('CLI artifact changed during the supplemental campaign')
      } catch (error) {
        variant.error = String(error)
        for (const row of [...observations, ...diagnostics].filter(row => row.metrics?.implementation === variant.prepared.node.id)) {
          row.status = 'failed'
          row.detail = variant.error
        }
      }
    }
  if (JSON.stringify(resourceObserver(options.observerExecutable, options.observerProvenance)) !== JSON.stringify(observer)) throw Error('Resource observer identity changed during campaign')
  const ranks = options.resourceOnly ? [] : ranksFor(variants, observations, workloads, options.rounds),
    resourceRanks = resourceRanksFor(variants, diagnostics, workloads)
  const resourcePolicy =
    'Separate GNU time diagnostic after all uninstrumented latency rounds finish. Actual reviewed command/stdout qualification retained; wrapper elapsed never enters speed ranks. Fixed-cohort child peak RSS includes runtime/shared code; maximum across per-case high-water marks, not sum. User/system CPU sums across fresh per-case processes and is quantized to10ms per field. Total CPU bounds allow20ms per case in either direction (lower bounded by0); all-zero totals are censored below resolution, never free cost. These are conservative reporting-grain bounds, not statistical confidence intervals; no CPU speed ranks. Shared OS/filesystem caches; native process RSS is not PSS, a process-tree sum, incremental allocation, or leak proof. External runtime executable bytes are not npm delivery/dependency closure.'
  const policy = options.resourceOnly
    ? 'Resource-only rerun: no latency invocation executed or replaced. Original completed CLI latency and earlier blocked-resource ledgers remain immutable; only fixed-cohort instrumented CPU/RSS evidence is fresh under the recorded observer identity.'
    : 'Supplemental fresh-process CLI boundary only: spawn through drained stdout or completed output file. SVG uses6 fixed inputs/5 families; Unicode terminal uses3/2. Input-file setup and independent artifact qualification occur outside each clock. Identical frozen source/label cohorts for every variant; all required cases must pass exactly once in every round. Alternate forward/reverse variant order. Shared OS/filesystem caches are not cold-disk guarantees. Node CLI and compiled Bun CLI are variants of the same catalog tool, never additional catalog nodes. No broad feature coverage is inferred. Previous published community ranks are not mutated.'
  const result = {
    id: 'community-cli',
    resourceOnly: options.resourceOnly ?? false,
    resourcePasses: 1,
    latencyMeasured: !options.resourceOnly && variants.some(variant => variant.outputs.length),
    status: [...observations, ...diagnostics].some(row => row.status === 'failed') ? 'failed' : [...observations, ...diagnostics].some(row => row.status === 'blocked') ? 'blocked' : 'passed',
    startedAt,
    finishedAt: new Date().toISOString(),
    latencyFinishedAt,
    rounds: options.rounds,
    observations,
    diagnostics,
    ranks,
    resourceRanks,
    executionOrder,
    evidence,
    policy,
    resourcePolicy,
  }
  writeBenchmarkDocument(resultPath, result)
  writeFileSync(ranksPath, JSON.stringify({ resourceOnly: options.resourceOnly ?? false, startedAt, finishedAt: result.finishedAt, rounds: options.rounds, ranks, resourceRanks, latencyFinishedAt, executionOrder, evidence, policy, resourcePolicy }, null, 2))
  return result
}
/** Orchestrator adapter: this supplemental phase depends on its completed sibling community suite. */
export async function runCommunityCliSuite(options: UnifiedRunOptions): Promise<UnifiedSuiteResult> {
  const startedAt = new Date().toISOString(),
    source = join(dirname(options.out), 'community')
  mkdirSync(options.out, { recursive: true })
  let envelope: UnifiedSuiteResult
  try {
    for (const file of ['community-prepared.json', 'community-inputs.json', 'community-result.json']) if (!existsSync(join(source, file))) throw Error(`Completed community prerequisite is absent: ${join(source, file)}`)
    const prerequisite = read(join(source, 'community-result.json'))
    if (prerequisite.id !== 'community' || typeof prerequisite.finishedAt !== 'string' || !Array.isArray(prerequisite.observations)) throw Error('Community prerequisite has no completed suite envelope')
    const result = await runCommunityCliCohort({ run: source, out: options.out, target: options.root, packageRoot: options.packageRoot ?? options.root, rounds: options.rounds, outputs: options.communityOutputs })
    envelope = {
      id: 'community-cli',
      status: result.status as UnifiedSuiteResult['status'],
      startedAt,
      finishedAt: result.finishedAt,
      observations: [...result.observations, ...result.diagnostics],
      gaps: ['Supplemental fixed-core CLI comparison only; deep feature coverage is unmeasured for these variants.', ...result.evidence.variants.flatMap(variant => (variant.error ? [`${variant.prepared.node.id}: ${variant.error}`] : []))],
      artifacts: ['community-cli-result.json', 'ranks.json', 'community-cli-inputs.json'],
    }
  } catch (error) {
    const detail = String(error)
    envelope = {
      id: 'community-cli',
      status: 'blocked',
      startedAt,
      finishedAt: new Date().toISOString(),
      observations: [{ suite: 'community-cli', surface: 'cli:end-to-end', runtime: 'unmeasured', family: '*', caseId: 'community-cli-prerequisites', operation: 'prepare', format: 'mixed', mode: 'prerequisite', status: 'blocked', detail }],
      gaps: [detail],
    }
  }
  writeBenchmarkDocument(join(options.out, 'community-cli-suite.json'), envelope)
  return envelope
}
export { ranksFor as rankCommunityCliObservations, resourceDiagnostic as runCommunityResourceDiagnostic, resourceObserver as observeCommunityResourceTool, resourceRanksFor as rankCommunityCliResources }

/** The cache binds the same public CLI variants and observer as timed execution. */
export function communityCliCacheIdentity(options: Pick<Options, 'target' | 'packageRoot'>, prepared: PreparedCommunity[]) {
  return {
    observer: resourceObserver(),
    candidates: candidateVariants(options as Options, prepared).map(variant => {
      try {
        return { variant: variant.variant, identity: admittedIdentity(variant.prepared.artifact!) }
      } catch (error) {
        return { variant: variant.variant, error: String(error) }
      }
    }),
  }
}

if (import.meta.main) {
  const values = new Map<string, string>()
  for (let index = 2; index < process.argv.length; index += 2) {
    if (process.argv[index] === '--resource-only') {
      if (values.has('--resource-only')) throw Error('Duplicate --resource-only')
      values.set('--resource-only', 'true')
      index -= 1
      continue
    }
    const option = process.argv[index]!,
      value = process.argv[index + 1]
    if (!['--run', '--out', '--target', '--package-root', '--rounds', '--outputs', '--observer-executable', '--observer-provenance', '--baseline-cli'].includes(option) || !value || value.startsWith('--') || values.has(option))
      throw Error('Usage: bun run eval/benchmark/unified/community-cli.ts --run DIR --out FRESH_DIR --target CHECKOUT --package-root INSTALLED_PACKAGE [--rounds 3]')
    values.set(option, value)
  }
  for (const name of ['--run', '--out', '--target', '--package-root']) if (!values.has(name)) throw Error('Missing required ' + name)
  const result = await runCommunityCliCohort({
    run: resolve(values.get('--run')!),
    out: resolve(values.get('--out')!),
    target: resolve(values.get('--target')!),
    packageRoot: resolve(values.get('--package-root')!),
    rounds: Number(values.get('--rounds') ?? 3),
    outputs: values.has('--outputs') ? values.get('--outputs')!.split(',') : undefined,
    observerExecutable: values.get('--observer-executable'),
    observerProvenance: values.get('--observer-provenance'),
    resourceOnly: values.has('--resource-only'),
    baselineCli: values.get('--baseline-cli'),
  })
  console.log(JSON.stringify({ status: result.status, ranks: result.ranks.map(rank => ({ implementation: rank.implementation, output: rank.output, qualified: rank.qualified, medianMs: rank.medianMs })) }))
  if (result.status === 'failed') process.exitCode = 1
  else if (result.status === 'blocked') process.exitCode = 2
}
