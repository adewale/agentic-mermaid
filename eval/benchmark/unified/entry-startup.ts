import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { fileURLToPath } from 'node:url'
import { assertBenchmarkExecutionAllowed } from '../ci-policy.ts'
import { assertInvocationReceipt } from './invocation-receipt.ts'
import { qualifyOutput } from './qualification.ts'
import { requiredFamilyWorkloads } from './required-family-cases.ts'
import type { BenchmarkObservation, UnifiedRunOptions, UnifiedSuiteResult, UnifiedWorkload } from './types.ts'

export const ENTRY_STARTUP_PROTOCOL = 'public-entry-startup-consumed-v1'
export const ENTRY_STARTUP_PRODUCERS = [fileURLToPath(import.meta.url), fileURLToPath(new URL('./entry-startup-worker.mjs', import.meta.url)), fileURLToPath(new URL('./invocation-mcp.ts', import.meta.url)), fileURLToPath(new URL('./invocation-browser.ts', import.meta.url))]
const worker = ENTRY_STARTUP_PRODUCERS[1]!
const marker = '\u0001entry-startup\u0001'
export interface EntryStartupOptions extends UnifiedRunOptions {
  samplesPerRound?: number
  nodeExecutable?: string
  bunExecutable?: string
  observerExecutable?: string
  nativeExecutable?: string
  adapter?: 'agentic' | 'pele'
  project?: string
  surfaces?: readonly ('library' | 'cli' | 'mcp' | 'browser')[]
  timeoutMs?: number
}
export interface StartupInvocationOptions {
  startupOnly?: boolean
  startupSamplesPerRound?: number
  startupRuntimes?: { name: string; executable: string; version: string }[]
  startupObserverExecutable?: string
  startupAdapter?: 'agentic' | 'pele'
  startupMcpTransports?: readonly ('stdio' | 'http-sse')[]
}
export interface EntryInventory {
  publicName: string
  path: string
  kind: 'module' | 'browser-global' | 'browser-module' | 'data' | 'cli' | 'mcp' | 'native'
  exists: boolean
  conditions?: unknown
  aliases?: string[]
}
export interface StartupOperation { id: string; name: string | null; format: string; factory: string | null; receipt: boolean; meta?: boolean; discovery?: boolean }
export interface EntryStartupJob {
  id: string
  entry: EntryInventory
  runtime: string
  executable: string
  operation: StartupOperation
  workload: UnifiedWorkload
  registrationExport?: string
}
export interface PreparedEntryStartup {
  project: string
  adapter: 'agentic' | 'pele'
  packageRoot: string
  inventory: EntryInventory[]
  jobs: EntryStartupJob[]
  cliJobs: { entry: EntryInventory; runtime: string; executable: string; prefix: string[]; formats: string[]; help: string }[]
  settings: { protocol: string; rounds: number; samplesPerRound: number; resourceSamplesPerRound: number; surfaces: readonly string[]; runtimes: { name: string; executable: string; version: string }[]; runtimeArguments: Record<string, { latency: string[]; resource: string[] }>; observer: { executable: string; available: boolean; version: string }; timeoutMs: number }
  gaps: string[]
}
export function startupImportTarget(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    const spec = value as Record<string, unknown>
    return startupImportTarget(spec.node ?? spec.import ?? spec.default)
  }
}
/** Every declared public key is retained, including JSON and global scripts.
 * Wildcards expand shipped files instead of relying on a benchmark-owned list. */
export function discoverStartupInventory(root: string): EntryInventory[] {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const inventory: EntryInventory[] = []
  const add = (publicName: string, path: string, conditions: unknown) => {
    const kind = path.endsWith('.json') ? 'data' : /(?:\.global\.|\.iife\.)/.test(path) || publicName === './global' ? 'browser-global' : publicName.startsWith('./browser') ? 'browser-module' : 'module'
    inventory.push({ publicName, path, kind, exists: existsSync(resolve(root, path)), conditions })
  }
  const exports = pkg.exports && (typeof pkg.exports === 'string' || 'import' in pkg.exports || 'default' in pkg.exports) ? { '.': pkg.exports } : pkg.exports ?? { '.': pkg.module ?? pkg.main }
  for (const [key, conditions] of Object.entries(exports)) {
    const path = startupImportTarget(conditions)
    if (!path) { inventory.push({ publicName: key, path: '', kind: 'module', exists: false, conditions }); continue }
    if (!key.includes('*') && !path.includes('*')) { add(key, path, conditions); continue }
    if (key.split('*').length !== 2 || path.split('*').length !== 2) { inventory.push({ publicName: key, path, kind: 'module', exists: false, conditions }); continue }
    const [before, after] = path.split('*') as [string, string]
    const slash = before.lastIndexOf('/'), dir = resolve(root, before.slice(0, slash + 1)), prefix = before.slice(slash + 1)
    if (!existsSync(dir)) { inventory.push({ publicName: key, path, kind: 'module', exists: false, conditions }); continue }
    for (const file of readdirSync(dir).sort()) if (file.startsWith(prefix) && file.endsWith(after) && statSync(join(dir, file)).isFile()) {
      const captured = file.slice(prefix.length, after.length ? -after.length : undefined)
      add(key.replace('*', captured), path.replace('*', captured), conditions)
    }
  }
  const bins: Record<string, string> = typeof pkg.bin === 'string' ? { [pkg.name.replace(/^@[^/]+\//, '')]: pkg.bin } : pkg.bin ?? {}
  for (const [name, path] of Object.entries(bins)) inventory.push({ publicName: name, path, kind: /mcp/.test(name) ? 'mcp' : 'cli', exists: existsSync(resolve(root, path)), aliases: Object.entries(bins).filter(([, other]) => other === path).map(([alias]) => alias) })
  const binary = /--outfile(?:=|\s+)([^\s]+)/.exec(pkg.scripts?.['build:binary'] ?? '')?.[1]
  if (binary) inventory.push({ publicName: 'build:binary', path: binary, kind: 'native', exists: existsSync(resolve(root, binary)) })
  return inventory
}

export interface FreshChildResult { code: number | null; stdout: string; stderr: string; wallMs: number; phases: { phase: string; observedMs: number; [key: string]: unknown }[] }
/** Stop each phase on receipt of a complete frame. UTF8 decoding is streaming;
 * arbitrary stdout chunk boundaries cannot truncate multibyte results. */
export async function runStartupChild(command: string, args: string[], options: { cwd: string; input?: string; timeoutMs?: number }): Promise<FreshChildResult> {
  return await new Promise((resolveResult, reject) => {
    const started = performance.now(), phases: FreshChildResult['phases'] = [], decoder = new StringDecoder('utf8')
    const child = spawn(command, args, { cwd: options.cwd, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, LC_ALL: 'C' } })
    let stdout = '', stderr = '', pending = '', aborted = false
    const kill = () => { try { if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL') } catch {} }
    const timer = setTimeout(() => { aborted = true; kill() }, options.timeoutMs ?? 60_000)
    const accept = (text: string) => {
      stdout += text; pending += text
      let newline: number
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline); pending = pending.slice(newline + 1)
        if (line.startsWith(marker)) { try { phases.push({ ...JSON.parse(line.slice(marker.length)), observedMs: performance.now() - started }) } catch { /* malformed frames are rejected by the caller */ } }
      }
    }
    child.stdout!.on('data', chunk => accept(decoder.write(chunk)))
    child.stderr!.on('data', chunk => { stderr += chunk.toString(); if (stderr.length > 100_000) stderr = stderr.slice(-100_000) })
    child.once('error', error => { clearTimeout(timer); kill(); reject(error) })
    child.once('close', code => { clearTimeout(timer); accept(decoder.end()); resolveResult({ code: aborted ? 124 : code, stdout, stderr, wallMs: performance.now() - started, phases }) })
    child.stdin!.on('error', () => {})
    child.stdin!.end(options.input)
  })
}
const common: UnifiedWorkload = { id: 'entry-startup:two-node', family: 'flowchart', source: 'flowchart LR\nA[Start] --> B[End]', expectedLabels: ['Start', 'End'], features: ['labelled-nodes', 'directed-edge'], provenance: 'authored stable public-entry workload; qualification outside clocks' }
function workloadFor(type: string | null | undefined): UnifiedWorkload | undefined {
  if (!type || type === 'flowchart') return common
  const normalized = type === 'gitGraph' ? 'gitgraph' : type === 'quadrantChart' ? 'quadrant' : type
  return requiredFamilyWorkloads().find(value => value.family === normalized)
}
function runtimeArgs(runtime: string, resource = false): string[] { return [...(runtime === 'node' ? ['--experimental-import-meta-resolve'] : []), ...(resource ? ['--expose-gc'] : [])] }
export async function prepareEntryStartup(options: EntryStartupOptions): Promise<PreparedEntryStartup> {
  assertBenchmarkExecutionAllowed()
  const packageRoot = resolve(options.portableArtifactRoot ?? options.packageRoot ?? options.root), adapter = options.adapter ?? (options.portableAdapter === 'pele' ? 'pele' : 'agentic'), project = options.project ?? options.portableProject ?? (adapter === 'pele' ? 'pele' : 'agentic-mermaid')
  const out = join(options.out, 'entry-startup-preparation'); mkdirSync(out, { recursive: true })
  const inventory = discoverStartupInventory(packageRoot), jobs: EntryStartupJob[] = [], cliJobs: PreparedEntryStartup['cliJobs'] = [], gaps: string[] = [], runtimes: PreparedEntryStartup['settings']['runtimes'] = []
  if (options.nativeExecutable) {
    const declared = inventory.find(value => value.kind === 'native')
    if (declared) { declared.conditions = { declaredPath: declared.path, explicitExecutable: resolve(options.nativeExecutable) }; declared.path = resolve(options.nativeExecutable); declared.exists = existsSync(declared.path) }
    else inventory.push({ publicName: 'explicit-native-executable', path: resolve(options.nativeExecutable), kind: 'native', exists: existsSync(resolve(options.nativeExecutable)) })
  }
  for (const [name, executable] of [['node', options.nodeExecutable ?? 'node'], ['bun', options.bunExecutable ?? 'bun']]) {
    try { const result = await runStartupChild(executable!, ['--version'], { cwd: packageRoot }); if (result.code !== 0) throw Error(result.stderr); runtimes.push({ name: name!, executable: executable!, version: result.stdout.trim() }) } catch (error) { gaps.push(`${name} unavailable: ${String(error)}`) }
  }
  const observerExecutable = options.observerExecutable ?? options.portableObserver ?? '/usr/bin/time'
  let observer = { executable: observerExecutable, available: false, version: '' }
  try { const result = await runStartupChild(observerExecutable, ['--version'], { cwd: packageRoot }); observer = { executable: observerExecutable, available: result.code === 0 && /GNU [Tt]ime/.test(result.stdout + result.stderr), version: (result.stdout + result.stderr).trim() } } catch {}
  const surfaces = options.surfaces ?? ['library', 'cli', 'mcp', 'browser']
  if (surfaces.includes('library')) for (const entry of inventory.filter(value => value.kind === 'module')) {
    if (!entry.exists) { gaps.push(`Declared entry missing or unresolved: ${entry.publicName}`); continue }
    for (const runtime of runtimes) {
      const file = join(out, 'discovery.json')
      writeFileSync(file, JSON.stringify({ root: packageRoot, exportName: entry.publicName, adapter, mode: 'discover' }))
      const discovery = await runStartupChild(runtime.executable, [...runtimeArgs(runtime.name), worker, file], { cwd: packageRoot, timeoutMs: options.timeoutMs })
      const result = discovery.phases.find(value => value.phase === 'discovery')
      if (discovery.code !== 0 || !result) { gaps.push(`${entry.publicName}/${runtime.name} discovery failed: ${discovery.stderr || discovery.phases.find(value => value.phase === 'failed')?.error || discovery.stdout}`); continue }
      const workload = workloadFor(result.diagramType as string | null)
      if (!workload) { gaps.push(`${entry.publicName}/${runtime.name}: no independently authored startup render fixture for diagram type ${String(result.diagramType)}; import-ready discovery measured; render unmeasured`); jobs.push({ id: `${entry.publicName}/${runtime.name}/module-ready:json`, entry, runtime: runtime.name, executable: runtime.executable, operation: { id: 'module-ready:json', name: null, format: 'json', factory: null, receipt: false, discovery: true }, workload: common }); continue }
      const discovered = result.operations as StartupOperation[]
      const operations = discovered.length ? discovered : [{ id: 'module-ready:json', name: null, format: 'json', factory: null, receipt: false, discovery: true }]
      for (const operation of operations) jobs.push({ id: `${entry.publicName}/${runtime.name}/${operation.id}`, entry, runtime: runtime.name, executable: runtime.executable, operation, workload, ...(adapter === 'pele' && (entry.publicName === './core' || entry.publicName.startsWith('./diagrams/')) ? { registrationExport: entry.publicName === './core' ? './diagrams/flowchart' : entry.publicName } : {}) })
    }
  }
  if (surfaces.includes('cli') && adapter === 'agentic') for (const entry of inventory.filter(value => value.exists && (value.kind === 'cli' || value.kind === 'native'))) {
    const variants = entry.kind === 'native' ? [{ name: 'native', executable: options.nativeExecutable ?? resolve(packageRoot, entry.path), prefix: [] as string[] }] : runtimes.map(runtime => ({ ...runtime, prefix: [resolve(packageRoot, entry.path)] }))
    for (const runtime of variants) {
      try {
        const help = await runStartupChild(runtime.executable, [...runtime.prefix, 'render', '--help'], { cwd: packageRoot })
        const formats = [...new Set([...help.stdout.matchAll(/^\s*--format\s+(\w+)\s/gm)].map(match => match[1]!))]
        if (help.code !== 0 || !formats.length) throw Error('Published help exposes no render format choices')
        cliJobs.push({ entry, runtime: runtime.name, executable: runtime.executable, prefix: runtime.prefix, formats, help: help.stdout })
      } catch (error) { gaps.push(`${entry.publicName}/${runtime.name}: CLI discovery failed: ${String(error)}`) }
    }
  }
  return { project, adapter, packageRoot, inventory, jobs, cliJobs, gaps, settings: { protocol: ENTRY_STARTUP_PROTOCOL, rounds: options.rounds, samplesPerRound: options.samplesPerRound ?? (options.profile === 'full' ? 5 : 1), resourceSamplesPerRound: 1, surfaces, runtimes, runtimeArguments: Object.fromEntries(runtimes.map(runtime => [runtime.name, { latency: runtimeArgs(runtime.name), resource: runtimeArgs(runtime.name, true) }])), observer, timeoutMs: options.timeoutMs ?? 60_000 } }
}
export function parseStartupResource(text: string): { userCpuMs: number; systemCpuMs: number; peakRssBytes: number; cpuResolutionMs: number } {
  const field = (name: string) => { const value = new RegExp(`^${name}=([0-9]+(?:\\.[0-9]+)?)$`, 'm').exec(text)?.[1]; if (value === undefined) throw Error(`Missing GNU time field: ${name}`); return Number(value) }
  return { userCpuMs: field('user_seconds') * 1000, systemCpuMs: field('system_seconds') * 1000, peakRssBytes: field('peak_rss_kib') * 1024, cpuResolutionMs: 10 }
}
function startupRow(prepared: PreparedEntryStartup, job: EntryStartupJob, operation: string, mode: string): BenchmarkObservation {
  return { suite: 'entry-startup', surface: 'library:' + job.entry.publicName, runtime: job.runtime, family: job.workload.family, caseId: job.id, operation, format: job.operation.format, mode, status: 'passed', metrics: { project: prepared.project } }
}
function validateResult(job: EntryStartupJob, result: any): string[] {
  const artifact = result.binaryBase64 ? new Uint8Array(Buffer.from(result.binaryBase64, 'base64')) : result.artifact
  const findings = qualifyOutput(job.workload, artifact, job.operation.format).findings
  const sidecar = result.sidecarJson ? JSON.parse(result.sidecarJson) : undefined
  if (job.operation.receipt) { try { assertInvocationReceipt(sidecar?.receipt, job.operation.format) } catch (error) { findings.push(String(error)) } }
  if (job.operation.meta && (!sidecar || typeof sidecar !== 'object' || !Object.keys(sidecar).length)) findings.push('Metadata-bearing operation returned no consumed metadata')
  return findings
}
export async function runEntryStartupSuite(options: EntryStartupOptions, prepared?: PreparedEntryStartup): Promise<UnifiedSuiteResult> {
  assertBenchmarkExecutionAllowed()
  const startedAt = new Date().toISOString(), p = prepared ?? await prepareEntryStartup(options), out = join(options.out, 'entry-startup')
  mkdirSync(out, { recursive: true })
  const observations: BenchmarkObservation[] = [], gaps = [...p.gaps], artifacts: string[] = []
  const inventoryFile = join(out, 'inventory.json'); writeFileSync(inventoryFile, JSON.stringify(p, null, 2)); artifacts.push(inventoryFile)
  if (p.settings.rounds * p.settings.samplesPerRound < 20) gaps.push('Fewer than 20 independent fresh samples per interface: smoke only; p95 unavailable and no reliable tail claim.')
  for (const entry of p.inventory.filter(value => value.kind === 'data' || !value.exists)) observations.push({ suite: 'entry-startup', surface: entry.publicName, runtime: 'inventory', family: '*', caseId: entry.publicName, operation: 'entry-inventory', format: entry.kind, mode: 'declaration', status: entry.exists ? 'not-applicable' : 'blocked', detail: entry.exists ? 'Public data export; no executable startup/API result.' : 'Declared artifact absent or conditional target unsupported; no sample manufactured.' })
  let sequence = 0
  for (const job of p.jobs) for (let round = 1; round <= p.settings.rounds; round++) for (let sample = 1; sample <= p.settings.samplesPerRound; sample++) {
    const prefix = join(out, `sample-${++sequence}`), jobFile = prefix + '.job.json', resultFile = prefix + '.result.json'
    const payload = { root: p.packageRoot, exportName: job.entry.publicName, adapter: p.adapter, operation: job.operation, source: job.workload.source, registrationExport: job.registrationExport, resultFile }
    const row = startupRow(p, job, job.operation.id, 'process-to-first-consumed')
    row.metrics = { ...row.metrics, round, sample, independentFreshProcess: true, runtimeArguments: JSON.stringify(runtimeArgs(job.runtime)), role: job.operation.discovery ? 'public namespace/data discovery; not a rendered result' : 'public renderer', clock: 'parent spawn through fully consumed first artifact and all returned enumerable sidecars; validation and result-file storage excluded; Node parent-aware resolution flag is explicit consumer harness overhead', qualificationScope: 'format/authored labels/receipt envelope; not full semantic/visual fidelity' }
    try {
      writeFileSync(jobFile, JSON.stringify({ ...payload, mode: 'latency' }))
      const result = await runStartupChild(job.executable, [...runtimeArgs(job.runtime), worker, jobFile], { cwd: p.packageRoot, timeoutMs: p.settings.timeoutMs })
      const first = result.phases.find(value => value.phase === 'first-consumed'), ready = result.phases.find(value => value.phase === 'api-ready')
      row.metrics = { ...row.metrics, lifecycleExitCode: result.code, processThroughExitMs: result.wallMs }
      if (first) row.samplesMs = [first.observedMs]
      if (!first || !ready || !existsSync(resultFile)) throw Error(String(result.phases.find(value => value.phase === 'failed')?.error || result.stderr || 'No complete first result; lifecycle exit ' + result.code))
      const consumed = JSON.parse(readFileSync(resultFile, 'utf8')), findings = validateResult(job, consumed)
      row.samplesMs = [first.observedMs]; row.bytes = consumed.bytes; row.findings = findings; row.status = findings.length ? 'failed' : 'passed'
      row.metrics = { ...row.metrics, observedSpawnToApiReadyMs: ready.observedMs, moduleImportMs: consumed.importMs, workerApiReadyMs: consumed.readyMs, firstApiMs: consumed.apiMs, consumptionMs: consumed.consumeMs, processThroughExitMs: result.wallMs, companionImports: JSON.stringify(consumed.companionImports), entry: consumed.entry }
      if (result.code !== 0) { row.status = 'failed'; row.detail = `Fresh child lifecycle exited ${result.code} after first consumed result` + (result.stderr ? '\n' + result.stderr : '') }
    } catch (error) { row.status = 'failed'; row.detail = String(error) }
    observations.push(row)
    if (sample <= p.settings.resourceSamplesPerRound && row.status === 'passed' && p.settings.observer.available) {
      const resourceRow = startupRow(p, job, job.operation.id, 'fresh-process-resource-paired-control')
      resourceRow.metrics = { project: p.project, round, sample, runtimeArguments: JSON.stringify(runtimeArgs(job.runtime, true)), clock: 'separate fresh diagnostic; not a latency sample', rssScope: 'GNU time whole child lifetime incl runtime/import/backend/consumption/storage/optional GC; never API-only or parent high-water mark', snapshotScope: 'process.memoryUsage bytes at named phases; outputHeldAfterGc keeps returned result/consumer copies alive; afterReleaseAfterGc releases benchmark output references while module/renderer state remains; JS heap excludes native/backend allocations', cpuScope: 'whole child user/system seconds converted to milliseconds; 10ms per field resolution; zero censored, not free' }
      try {
        const records: Record<string, unknown> = {}
        for (const mode of ['baseline', 'resource'] as const) {
          const resourceFile = prefix + '.' + mode + '.time'
          writeFileSync(jobFile, JSON.stringify({ ...payload, mode }))
          const child = await runStartupChild(p.settings.observer.executable, ['-f', 'user_seconds=%U\nsystem_seconds=%S\npeak_rss_kib=%M', '-o', resourceFile, '--', job.executable, ...runtimeArgs(job.runtime, true), worker, jobFile], { cwd: p.packageRoot, timeoutMs: p.settings.timeoutMs })
          if (child.code !== 0 || !existsSync(resultFile)) throw Error('GNU time fresh child failed: ' + child.stderr)
          const consumed = JSON.parse(readFileSync(resultFile, 'utf8'))
          const snapshotsFile = resultFile + '.snapshots.json'
          if (!existsSync(snapshotsFile)) throw Error('Fresh resource child omitted release checkpoint')
          consumed.snapshots = JSON.parse(readFileSync(snapshotsFile, 'utf8'))
          rmSync(snapshotsFile, { force: true })
          if (mode === 'resource') { const findings = validateResult(job, consumed); if (findings.length) throw Error(findings.join('; ')) }
          records[mode] = { ...parseStartupResource(readFileSync(resourceFile, 'utf8')), snapshots: consumed.snapshots, bytes: consumed.bytes }
          rmSync(resourceFile, { force: true })
        }
        const file = prefix + '.resource.json'; writeFileSync(file, JSON.stringify(records, null, 2)); artifacts.push(file)
        const active = records.resource as any, baseline = records.baseline as any
        resourceRow.metrics = { ...resourceRow.metrics, peakRssBytes: active.peakRssBytes, baselinePeakRssBytes: baseline.peakRssBytes, peakDifferenceBytes: active.peakRssBytes - baseline.peakRssBytes, userCpuMs: active.userCpuMs, systemCpuMs: active.systemCpuMs, baselineUserCpuMs: baseline.userCpuMs, baselineSystemCpuMs: baseline.systemCpuMs, cpuResolutionMs: 10, rawSnapshots: file, differenceMeaning: 'paired descriptive whole-process difference; negative allowed; not allocation attribution or an allocation peak' }
      } catch (error) { resourceRow.status = 'failed'; resourceRow.detail = String(error) }
      observations.push(resourceRow)
    }
    rmSync(jobFile, { force: true }); rmSync(resultFile, { force: true })
  }
  if (!p.settings.observer.available) gaps.push(`GNU time unavailable or unverified at ${p.settings.observer.executable}; process peak/CPU observations blocked, never substituted with parent maxRSS.`)
  for (const job of p.cliJobs) for (const format of job.formats) for (const inputMode of ['stdin', 'file']) for (let round = 1; round <= p.settings.rounds; round++) for (let sample = 1; sample <= p.settings.samplesPerRound; sample++) {
    const prefix = join(out, `cli-${++sequence}`), sourceFile = prefix + '.mmd', outputFile = prefix + '.out'
    writeFileSync(sourceFile, common.source)
    const args = [...job.prefix, 'render', inputMode === 'stdin' ? '-' : sourceFile, '--format', format, '--output', outputFile]
    const row: BenchmarkObservation = { suite: 'entry-startup', surface: 'cli:' + job.entry.publicName, runtime: job.runtime, family: common.family, caseId: `${job.entry.publicName}/${job.runtime}/${format}/${inputMode}`, operation: 'render', format, mode: 'process-to-fully-consumed-output', status: 'passed', metrics: { project: p.project, round, sample, independentFreshProcess: true, inputMode, aliases: JSON.stringify(job.entry.aliases ?? []), clock: 'parent spawn through process exit, drained stdout, output file read/copy and public envelope parse; independent qualification after clock', aliasMeaning: 'manifest aliases reference this executable target; not independent implementations' } }
    try {
      const start = performance.now(), child = await runStartupChild(job.executable, args, { cwd: p.packageRoot, input: inputMode === 'stdin' ? common.source : undefined, timeoutMs: p.settings.timeoutMs })
      const bytes = readFileSync(outputFile), artifact = format === 'png' ? new Uint8Array(bytes) : format === 'layout' ? JSON.parse(bytes.toString()) : bytes.toString()
      const elapsed = performance.now() - start
      row.samplesMs = [elapsed]; row.bytes = bytes.length
      const q = qualifyOutput(common, artifact, format)
      row.findings = q.findings
      if (child.code !== 0 || !q.ok) { row.status = 'failed'; row.detail = child.stderr || q.findings.join('; ') }
    } catch (error) { row.status = 'failed'; row.detail = String(error) }
    observations.push(row)
    if (sample <= p.settings.resourceSamplesPerRound && p.settings.observer.available && row.status === 'passed') {
      const resourceRow: BenchmarkObservation = { ...row, mode: 'fresh-cli-process-resource', samplesMs: undefined, metrics: { project: p.project, round, sample, scope: 'GNU time whole CLI process incl runtime/backend/output writes; parent file consumption and qualification excluded; JS snapshots unavailable for unmodified public CLI' } }
      try {
        rmSync(outputFile, { force: true })
        const resourceFile = prefix + '.time', child = await runStartupChild(p.settings.observer.executable, ['-f', 'user_seconds=%U\nsystem_seconds=%S\npeak_rss_kib=%M', '-o', resourceFile, '--', job.executable, ...args], { cwd: p.packageRoot, input: inputMode === 'stdin' ? common.source : undefined, timeoutMs: p.settings.timeoutMs })
        const bytes = readFileSync(outputFile), artifact = format === 'png' ? new Uint8Array(bytes) : format === 'layout' ? JSON.parse(bytes.toString()) : bytes.toString(), q = qualifyOutput(common, artifact, format)
        if (child.code !== 0 || !q.ok) throw Error(child.stderr || q.findings.join('; '))
        resourceRow.metrics = { ...resourceRow.metrics, ...parseStartupResource(readFileSync(resourceFile, 'utf8')), baselineScope: 'runtime matched empty control retained in library resource rows; native has no equivalent empty compiled process; no subtraction claimed' }
        rmSync(resourceFile, { force: true })
      } catch (error) { resourceRow.status = 'failed'; resourceRow.detail = String(error) }
      observations.push(resourceRow)
    }
    rmSync(sourceFile, { force: true }); rmSync(outputFile, { force: true })
  }
  // Existing protocol harnesses preserve their ordinary suite behavior. Startup
  // variants make the first real request before warmup and use fresh endpoints.
  if (p.adapter === 'agentic') {
    const commonOptions = { ...options, packageRoot: p.packageRoot, startupOnly: true, startupAdapter: p.adapter, startupSamplesPerRound: p.settings.samplesPerRound, startupRuntimes: p.settings.runtimes, startupObserverExecutable: p.settings.observer.available ? p.settings.observer.executable : undefined }
    if (p.settings.surfaces.includes('mcp')) { const { runInvocationMcp } = await import('./invocation-mcp.ts'); const result = await runInvocationMcp(commonOptions, [common]); observations.push(...result.rows.map(row => ({ ...row, suite: 'entry-startup' }))); gaps.push(...result.gaps); artifacts.push(...result.artifacts) }
    if (p.settings.surfaces.includes('browser')) { const { runInvocationBrowser } = await import('./invocation-browser.ts'); const result = await runInvocationBrowser(commonOptions, [common]); observations.push(...result.rows.map(row => ({ ...row, suite: 'entry-startup' }))); gaps.push(...result.gaps); artifacts.push(...result.artifacts) }
  } else for (const surface of ['cli', 'mcp', 'browser']) if (p.settings.surfaces.includes(surface)) {
    if (surface === 'browser') { const { runInvocationBrowser } = await import('./invocation-browser.ts'); const result = await runInvocationBrowser({ ...options, packageRoot: p.packageRoot, startupOnly: true, startupAdapter: p.adapter, startupSamplesPerRound: p.settings.samplesPerRound }, [common]); observations.push(...result.rows.map(row => ({ ...row, suite: 'entry-startup' }))); gaps.push(...result.gaps); artifacts.push(...result.artifacts); continue }
    const declared = p.inventory.some(value => surface === 'browser' ? value.kind.startsWith('browser') : value.kind === surface)
    observations.push({ suite: 'entry-startup', surface, runtime: 'inventory', family: '*', caseId: 'peer-' + surface, operation: 'entry-inventory', format: surface, mode: 'declaration', status: declared ? 'blocked' : 'not-applicable', detail: declared ? 'Declared peer entry retained; startup adapter not implemented for this surface.' : 'Package declares no corresponding public invocation interface.' })
  }
  return { id: 'entry-startup', status: observations.some(value => value.status === 'failed') ? 'failed' : observations.some(value => value.status === 'blocked') || gaps.length ? 'blocked' : 'passed', startedAt, finishedAt: new Date().toISOString(), observations, gaps, artifacts }
}
