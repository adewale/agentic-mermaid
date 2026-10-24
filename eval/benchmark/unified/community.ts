import { createHash } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'
import { MICRO_WORKLOADS } from '../micro-bench-cases.ts'
import { unifiedWorkloads } from './workloads.ts'
import { qualifyOutput, withReferenceLabels } from './qualification.ts'
import type { BenchmarkObservation, UnifiedRunOptions, UnifiedSuiteResult, UnifiedWorkload } from './types.ts'
import type { CommunityArtifact, CommunityNode, CommunityWorkerJob, PreparedCommunity } from './community-types.ts'
import { assertCommunityNotInterrupted, trackCommunityProcess } from './community-process.ts'

const here = dirname(fileURLToPath(import.meta.url))
const median = (xs: number[]) => {
  const a = [...xs].sort((a, b) => a - b)
  return a.length % 2 ? a[a.length >> 1]! : (a[(a.length >> 1) - 1]! + a[a.length >> 1]!) / 2
}
export const normalizeCommunityOutput = (output: string): string => (({ 'ascii-unicode': 'terminal', ascii: 'terminal', unicode: 'terminal', ast: 'parse', 'mermaid-text': 'source' }) as Record<string, string>)[output] ?? output
const safe = (id: string) => id.replace(/[^a-z0-9._-]+/gi, '_')
const artifactDigest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
export function communityCoreWorkloads(): UnifiedWorkload[] {
  const range = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => prefix + i)
  const expectations: Record<string, { family: string; labels: string[] }> = {
    flow5: { family: 'flowchart', labels: ['Start', 'Check', 'Do it', 'Skip', 'End'] },
    tree50: { family: 'flowchart', labels: range('Node ', 50) },
    seq20: { family: 'sequence', labels: range('message ', 20) },
    class80: { family: 'class', labels: range('C', 80) },
    er40: { family: 'er', labels: range('E', 40) },
    state80: { family: 'state', labels: range('S', 81) },
  }
  return Object.entries(expectations).map(([id, expected]) => ({
    id: `core:${id}`,
    family: expected.family,
    source: MICRO_WORKLOADS[id as keyof typeof MICRO_WORKLOADS],
    features: ['core-graph-batch'],
    provenance: 'eval/benchmark/micro-bench-cases.ts; independently declared fixture labels',
    expectedLabels: expected.labels,
  }))
}

/** npm can write physical-prefix keys when --prefix traverses a symlink.
 * Match one concrete installed root; nested or linked identities are not pins. */
export function installedNpmIntegrity(prefix: string, root: string, name: string, version: string): string {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name: string; version: string }
  if (pkg.name !== name || pkg.version !== version) throw new Error('Installed npm identity differs from the resolved pin')
  const actual = realpathSync(root),
    lock = JSON.parse(readFileSync(join(prefix, 'package-lock.json'), 'utf8')) as { packages?: Record<string, { version?: string; integrity?: string; link?: boolean }> }
  const bases = [...new Set([resolve(prefix), realpathSync(prefix)])]
  const matches = Object.entries(lock.packages ?? {}).filter(([key, entry]) => {
    if (!key || entry.link || entry.version !== version) return false
    return bases.some(base => {
      try {
        return realpathSync(resolve(base, key)) === actual
      } catch {
        return false
      }
    })
  })
  if (matches.length !== 1) throw new Error(`Expected one installed npm lock identity for ${name}@${version}; found ${matches.length}`)
  const integrity = matches[0]![1].integrity
  if (typeof integrity !== 'string' || !integrity.startsWith('sha512-')) throw new Error('Missing installed package SHA-512 integrity')
  const encoded = integrity.slice(7),
    bytes = Buffer.from(encoded, 'base64')
  if (bytes.length !== 64 || bytes.toString('base64') !== encoded) throw new Error('Noncanonical installed package SHA-512 integrity')
  return integrity
}

async function npmArtifact(node: CommunityNode, cache: string, pinned = false): Promise<CommunityArtifact> {
  const name = node.benchmark!.package!
  const recorded = node.packages?.find(p => p.registry === 'npm' && p.name === name)?.version
  let version = recorded
  if (!pinned && process.env.AM_COMMUNITY_VERSION_POLICY !== 'recorded') {
    const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`)
    if (!response.ok) throw new Error(`${name} registry HTTP ${response.status}`)
    version = ((await response.json()) as { version: string }).version
  }
  if (!version) throw new Error(`No published version recorded for ${name}`)
  const prefix = join(cache, `${safe(name)}@${version}`),
    root = join(prefix, 'node_modules', name)
  mkdirSync(prefix, { recursive: true })
  if (!existsSync(join(root, 'package.json'))) {
    const install = spawnSync('npm', ['install', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund', `${name}@${version}`], { encoding: 'utf8', timeout: 240_000, env: { ...process.env, npm_config_cache: process.env.npm_config_cache ?? process.env.NPM_CONFIG_CACHE ?? join(cache, '.npm-cache') } })
    writeFileSync(join(prefix, 'install.log'), install.stdout + install.stderr)
    if (install.status !== 0) throw new Error(`${name} installation failed; ${join(prefix, 'install.log')}`)
  }
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name: string; version: string; exports?: unknown; main?: string }
  if (pkg.name !== name || pkg.version !== version) throw new Error('Installed npm identity differs from resolved pin')
  const integrity = installedNpmIntegrity(prefix, root, name, version)
  const specifier = name + (node.benchmark?.subpath ? '/' + node.benchmark.subpath : '')
  // The acquisition driver is Bun; resolving here with Bun's conditions can
  // accidentally select a .ts source entry that Node cannot import in npm.
  const resolution = spawnSync('node', ['--experimental-import-meta-resolve', '--input-type=module', '-e', 'process.stdout.write(import.meta.resolve(process.argv[1], process.argv[2]))', specifier, pathToFileURL(join(root, 'package.json')).href], { encoding: 'utf8', timeout: 30_000 })
  if (resolution.status !== 0) throw new Error(`Cannot resolve the Node import-condition export ${specifier}: ${resolution.stderr}`)
  const module = fileURLToPath(resolution.stdout.trim())
  if (!existsSync(module)) throw new Error(`Missing Node import-condition entry: ${module}`)
  return { kind: 'node', root, module, version, integrity, runtime: 'Node' }
}

function verifyProvidedArtifact(artifact: CommunityArtifact): void {
  const entry = artifact.module ?? artifact.executable ?? artifact.python
  if (!entry || !existsSync(entry)) throw new Error('Provided artifact entry does not exist')
  if (!artifact.sha256 && !artifact.files?.length) throw new Error('Provided artifacts require a byte digest or a nonempty verified file manifest')
  const verified = new Set<string>()
  for (const file of artifact.files ?? []) {
    if (!/^[a-f0-9]{64}$/.test(file.sha256) || !existsSync(file.path) || artifactDigest(file.path) !== file.sha256) throw new Error(`Artifact digest mismatch: ${file.path}`)
    verified.add(realpathSync(file.path))
  }
  if (artifact.sha256) {
    if (!/^[a-f0-9]{64}$/.test(artifact.sha256) || artifactDigest(entry) !== artifact.sha256) throw new Error('Provided artifact entry digest mismatch')
    verified.add(realpathSync(entry))
  }
  if (!verified.has(realpathSync(entry))) throw new Error('Provided file manifest does not bind the executable/module entry')
  if (artifact.wasm && !verified.has(realpathSync(artifact.wasm))) throw new Error('Provided WASM is absent from the verified artifact file manifest')
}

export async function prepareCommunity(options: UnifiedRunOptions): Promise<PreparedCommunity[]> {
  const driver = options.harnessRoot ?? options.root,
    cache = resolve(process.env.AM_COMMUNITY_CACHE ?? join(driver, 'node_modules/.cache/unified-community'))
  mkdirSync(cache, { recursive: true })
  const catalog = JSON.parse(readFileSync(join(driver, 'docs/mermaid-community.json'), 'utf8')) as { nodes: CommunityNode[] }
  const manifestPath = options.communityArtifacts ?? process.env.AM_BENCH_COMMUNITY_ARTIFACTS
  const provided = manifestPath ? (JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, CommunityArtifact>) : {}
  const prepared: PreparedCommunity[] = []
  for (const node of catalog.nodes) {
    if (!node.benchmark) {
      prepared.push({ node })
      continue
    }
    try {
      let artifact = provided[node.id]
      if (artifact) {
        verifyProvidedArtifact(artifact)
        if (['dart', 'bezel', 'franken', 'termaid'].includes(node.benchmark.adapter)) {
          const { prepareCommunityArtifact } = await import('./community-artifact-prepare.ts')
          artifact = await prepareCommunityArtifact(node, cache, manifestPath)
          verifyProvidedArtifact(artifact)
          if (node.benchmark.adapter === 'franken' && artifact.revision !== node.distribution?.revision) throw new Error('Provided Franken distribution revision differs from its recorded immutable pin')
        } else if (artifact.kind === 'node') {
          if (!artifact.root) throw new Error('Provided Node artifact requires an actual package root')
          const pkg = JSON.parse(readFileSync(join(artifact.root, 'package.json'), 'utf8')) as { name: string; version: string },
            expectedName = node.benchmark.package ?? (node.benchmark.adapter === 'agentic' ? 'agentic-mermaid' : undefined)
          if (!expectedName || pkg.name !== expectedName || pkg.version !== artifact.version) throw new Error('Provided Node artifact package name/version does not match its installed metadata')
          if (node.benchmark.package) {
            const recorded = node.packages?.find(pkg => pkg.registry === 'npm' && pkg.name === expectedName)?.version
            const pinned = node.benchmark.adapter === 'mermaid' || process.env.AM_COMMUNITY_VERSION_POLICY === 'recorded'
            let expectedVersion = recorded
            if (!pinned) {
              const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(expectedName)}/latest`)
              if (!response.ok) throw new Error(`Cannot resolve provided package version: HTTP ${response.status}`)
              expectedVersion = ((await response.json()) as { version: string }).version
            }
            if (artifact.version !== expectedVersion) throw new Error('Provided Node artifact differs from the resolved recorded/latest version policy')
          }
        } else if (node.benchmark.adapter === 'source-cli') {
          const revision = node.release?.commit ?? node.head
          if (!revision || artifact.revision !== revision) throw new Error('Provided native artifact revision differs from the recorded immutable source pin')
          if (artifact.kind === 'cli') {
            const { reviewedCommunitySourcePresentation } = await import('./community-source-prepare.ts')
            const presentation = reviewedCommunitySourcePresentation(node)
            artifact = { ...artifact, ...presentation, detail: [artifact.detail, presentation.defaults].filter(Boolean).join('; ') }
          }
        }
      } else if (node.benchmark.adapter === 'agentic') {
        const root = options.packageRoot ?? options.root,
          module = join(root, 'dist/agent.js')
        if (!existsSync(module)) throw new Error('Build/pack the candidate before community timing')
        const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }
        artifact = { kind: 'node', root, module, version: pkg.version, sha256: artifactDigest(module), runtime: 'Node' }
      } else if (node.benchmark.package) artifact = await npmArtifact(node, cache, node.benchmark.adapter === 'mermaid')
      else if (node.benchmark.adapter === 'source-cli') {
        const { prepareCommunitySource } = await import('./community-source-prepare.ts')
        artifact = await prepareCommunitySource(node, process.env.AM_COMMUNITY_SOURCE_CACHE ?? cache)
      } else {
        const { prepareCommunityArtifact } = await import('./community-artifact-prepare.ts')
        artifact = await prepareCommunityArtifact(node, cache)
      }
      artifact.detail = `${artifact.detail ?? ''}${artifact.detail ? '; ' : ''}Version policy: ${node.benchmark.adapter === 'agentic' ? 'local candidate source/package' : node.benchmark.adapter === 'mermaid' ? 'pinned current Mermaid' : node.benchmark.adapter === 'source-cli' || node.benchmark.adapter === 'franken' ? 'recorded immutable source/distribution' : process.env.AM_COMMUNITY_VERSION_POLICY === 'recorded' ? 'recorded registry release' : 'resolved latest registry release'}. Recorded catalog versions remain separately available on the node.`
      prepared.push({ node, artifact })
    } catch (error) {
      prepared.push({ node, error: String(error) })
    }
  }
  mkdirSync(options.out, { recursive: true })
  writeFileSync(join(options.out, 'community-prepared.json'), JSON.stringify(prepared, null, 2))
  return prepared
}

function envelope(node: CommunityNode, output: string, workload: UnifiedWorkload, round: number): BenchmarkObservation {
  return {
    suite: 'community',
    surface: 'node:public-api',
    runtime: 'Node',
    family: workload.family,
    caseId: workload.id,
    operation: output === 'parse' || output === 'diagnostics' ? output : 'render',
    format: output,
    mode: workload.features.includes('core-graph-batch') ? 'core-api-repeat' : 'feature-corpus-attempt',
    status: 'blocked',
    metrics: { implementation: node.id, round, featureCount: workload.features.length },
  }
}
function runCli(prepared: PreparedCommunity, output: string, workload: UnifiedWorkload, round: number, out: string): BenchmarkObservation {
  const artifact = prepared.artifact!,
    row = envelope(prepared.node, output, workload, round)
  row.surface = 'cli:end-to-end'
  row.runtime = artifact.runtime ?? 'native'
  row.mode = 'fresh-process'
  const input = join(out, 'cli-input.mmd'),
    destination = join(out, `cli-output.${output === 'png' ? 'png' : output === 'svg' ? 'svg' : 'txt'}`)
  writeFileSync(input, workload.source)
  if (existsSync(destination)) unlinkSync(destination)
  const args = (artifact.args ?? []).map(arg =>
    arg
      .replaceAll('{input}', input)
      .replaceAll('{output}', destination)
      .replaceAll('{format}', output === 'terminal' ? 'unicode' : output),
  )
  const started = performance.now(),
    child = spawnSync(artifact.executable!, args, { input: artifact.input === 'file' ? undefined : workload.source, timeout: 30_000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, NO_COLOR: '1', TERM: 'dumb' } }),
    ms = performance.now() - started
  row.samplesMs = [ms]
  if (child.status !== 0) {
    row.status = 'failed'
    row.detail = child.error?.message ?? child.stderr?.toString().slice(0, 1500)
    return row
  }
  const fileOutput = artifact.args?.some(arg => arg.includes('{output}'))
  if (fileOutput && !existsSync(destination)) {
    row.status = 'failed'
    row.detail = 'CLI exited successfully without producing its declared output file'
    return row
  }
  const value = fileOutput ? readFileSync(destination) : child.stdout
  const text = output === 'png' ? value : value.toString()
  if (output === 'terminal' && typeof text === 'string' && /^[\s]*[\[{]/.test(text)) {
    try {
      const encoded = JSON.parse(text)
      if (encoded && typeof encoded === 'object') {
        row.status = 'failed'
        row.detail = 'Structured CLI sidecars must be decoded by a declared adapter; JSON/source labels are not terminal ink'
        return row
      }
    } catch {
      /* Bracket-shaped terminal drawings need not be JSON. */
    }
  }
  const qualification = qualifyOutput(workload, text, output)
  row.status = qualification.ok ? 'passed' : 'failed'
  row.bytes = value.byteLength
  row.findings = qualification.findings
  row.metrics = { ...row.metrics, qualification: qualification.scope, version: artifact.version, boundary: 'spawn through drained stdout/file artifact; process startup included' }
  return row
}

async function nodeRound(prepared: PreparedCommunity, output: string, workloads: UnifiedWorkload[], round: number, options: UnifiedRunOptions): Promise<BenchmarkObservation[]> {
  const directory = join(options.out, 'community-raw')
  mkdirSync(directory, { recursive: true })
  type RawRow = { id: string; family: string; status: string; detail?: string; samplesMs?: number[]; firstMs?: number; bytes?: number; qualification?: string; diagnosticsCount?: number }
  type Raw = { status: string; detail?: string; importMs?: number; rssBytes?: number; peakRssBytes?: number; runtime?: string; rows: RawRow[] }
  const collected = new Map<string, { row: RawRow; raw?: Raw; attempt: number }>(),
    attempts: { attempt: number; exitCode: number | null; timedOut: boolean; activeCase?: string; detail?: string }[] = []
  let remaining = [...workloads],
    lifecycleIssue: string | undefined
  for (let attempt = 1; remaining.length && attempt <= 8; attempt++) {
    const stem = `${safe(prepared.node.id)}-${output}-r${round}-attempt${attempt}`,
      file = join(directory, stem + '.json'),
      jobPath = join(directory, stem + '.job.json'),
      progressFile = file + '.jsonl'
    for (const previous of [file, progressFile]) if (existsSync(previous)) unlinkSync(previous)
    const job: CommunityWorkerJob & { progressFd: number } = { prepared, workloads: remaining, output, out: file, samples: 5, warmupMs: 50, minSampleMs: 10, harnessRoot: options.harnessRoot ?? options.root, packageRoot: options.packageRoot, progressFd: 3 }
    writeFileSync(jobPath, JSON.stringify(job))
    let stdout = '',
      stderr = '',
      progressBuffer = '',
      activeCase: string | undefined,
      timedOut = false,
      ready = false,
      detail: string | undefined,
      timer: ReturnType<typeof setTimeout> | undefined
    assertCommunityNotInterrupted()
    const child = spawn('node', [join(here, 'community-worker.mjs'), jobPath], { detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe', 'pipe'], env: { ...process.env, AGENTIC_MERMAID_ELK_CACHE: '1', AGENTIC_MERMAID_SCENE_ASSERTIONS: '0' } })
    trackCommunityProcess(child)
    const terminate = () => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL')
        else child.kill('SIGKILL')
      } catch {}
    }
    const deadline = (ms: number) => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        timedOut = true
        detail = activeCase ? `Current workload exceeded ${ms}ms: ${activeCase}` : `Worker import/cleanup exceeded ${ms}ms`
        terminate()
      }, ms)
    }
    deadline(120_000)
    child.stdout?.on('data', chunk => {
      stdout = (stdout + String(chunk)).slice(-2_000_000)
    })
    child.stderr?.on('data', chunk => {
      stderr = (stderr + String(chunk)).slice(-2_000_000)
    })
    child.stdio[3]?.on('data', chunk => {
      progressBuffer += String(chunk)
      for (;;) {
        const newline = progressBuffer.indexOf('\n')
        if (newline < 0) break
        const line = progressBuffer.slice(0, newline)
        progressBuffer = progressBuffer.slice(newline + 1)
        try {
          const event = JSON.parse(line) as { phase: string; id?: string }
          if (event.phase === 'ready') {
            ready = true
            deadline(30_000)
          } else if (event.phase === 'case' && remaining.some(workload => workload.id === event.id)) {
            activeCase = event.id
            deadline(30_000)
          } else if (event.phase === 'result' && activeCase === event.id) {
            activeCase = undefined
            deadline(30_000)
          } else if (event.phase === 'done') {
            activeCase = undefined
            deadline(10_000)
          }
        } catch {
          /* Only the dedicated worker progress pipe can reset a deadline. */
        }
      }
    })
    const exitCode = await new Promise<number | null>(done => {
      child.once('error', error => {
        detail = String(error)
      })
      child.once('close', code => done(code))
    })
    clearTimeout(timer)
    writeFileSync(join(directory, stem + '.log'), stdout + stderr)
    let raw: Raw | undefined,
      rows: RawRow[] = []
    try {
      if (existsSync(file)) raw = JSON.parse(readFileSync(file, 'utf8')) as Raw
    } catch (error) {
      detail = `Malformed completed worker report: ${String(error)}`
    }
    try {
      if (existsSync(progressFile))
        rows = readFileSync(progressFile, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map(line => JSON.parse(line) as RawRow)
    } catch (error) {
      detail = `Malformed partial worker report: ${String(error)}`
    }
    if (!rows.length && raw?.rows) rows = raw.rows
    for (const row of rows) if (remaining.some(workload => workload.id === row.id)) collected.set(row.id, { row, raw, attempt })
    attempts.push({ attempt, exitCode, timedOut, activeCase, detail: detail ?? raw?.detail })
    if (activeCase && !collected.has(activeCase)) collected.set(activeCase, { row: { id: activeCase, family: remaining.find(workload => workload.id === activeCase)!.family, status: 'failed', detail: detail ?? `Worker stopped during workload (exit ${exitCode}): ${stderr.slice(-1500)}` }, raw, attempt })
    const unresolved = remaining.filter(workload => !collected.has(workload.id))
    if (!unresolved.length) {
      if (exitCode !== 0 || raw?.status !== 'completed') lifecycleIssue = detail ?? raw?.detail ?? `Worker cleanup incomplete (exit ${exitCode})`
      remaining = []
      break
    }
    if (!ready || (!activeCase && exitCode === 0)) {
      const reason = detail ?? raw?.detail ?? 'Worker stopped without returning every selected workload'
      for (const workload of unresolved) collected.set(workload.id, { row: { id: workload.id, family: workload.family, status: 'blocked', detail: reason }, raw, attempt })
      remaining = []
      break
    }
    remaining = unresolved
  }
  for (const workload of remaining) collected.set(workload.id, { row: { id: workload.id, family: workload.family, status: 'blocked', detail: 'Eight worker restart attempts exhausted; previous completed rows are preserved' }, attempt: 8 })
  writeFileSync(join(directory, `${safe(prepared.node.id)}-${output}-r${round}-attempts.json`), JSON.stringify(attempts, null, 2))
  const observations = workloads.map(workload => {
    const { row: result, raw, attempt } = collected.get(workload.id)!,
      row = envelope(prepared.node, output, workload, round)
    row.status = result.status === 'passed' ? 'passed' : result.status === 'unsupported' ? 'unsupported' : result.status === 'blocked' ? 'blocked' : 'failed'
    row.samplesMs = result.samplesMs
    row.bytes = result.bytes
    row.detail = result.detail
    row.metrics = {
      ...row.metrics,
      version: prepared.artifact!.version,
      firstMs: result.firstMs ?? null,
      importMs: raw?.importMs ?? null,
      endRssBytes: raw?.rssBytes ?? null,
      peakProcessRssBytes: raw?.peakRssBytes ?? null,
      qualification: result.qualification ?? 'unavailable',
      diagnosticsCount: result.diagnosticsCount ?? null,
      workerAttempt: attempt,
      artifactIntegrity: prepared.artifact?.integrity ?? prepared.artifact?.sha256 ?? null,
      boundary: 'public API return/settled promise; validation excluded; memory includes worker/qualification; restarted workers remain separately identified',
    }
    return row
  })
  if (lifecycleIssue) observations.push({ ...envelope(prepared.node, output, { id: 'worker-lifecycle', family: '*', source: '', features: [], provenance: 'worker lifecycle' }, round), operation: 'worker-lifecycle', status: 'blocked', detail: lifecycleIssue })
  return observations
}

function matchedRanks(observations: BenchmarkObservation[], rounds: number) {
  const groups = new Map<string, BenchmarkObservation[]>()
  for (const row of observations.filter(row => row.caseId.startsWith('core:'))) {
    const key = [row.surface, row.format, row.metrics?.implementation].join('|')
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  return [...groups]
    .map(([key, rows]) => {
      const [surface, output, implementation] = key.split('|'),
        ids = communityCoreWorkloads()
          .filter(w => output !== 'terminal' || ['core:flow5', 'core:tree50', 'core:seq20'].includes(w.id))
          .map(w => w.id),
        values = Array.from({ length: rounds }, (_, index) => {
          const selected = ids.map(id => rows.filter(row => row.caseId === id && row.metrics?.round === index + 1))
          return selected.every(matches => matches.length === 1 && matches[0]!.status === 'passed' && matches[0]!.samplesMs?.length && matches[0]!.samplesMs!.every(value => Number.isFinite(value) && value > 0)) ? selected.reduce((n, matches) => n + median(matches[0]!.samplesMs!), 0) : undefined
        })
      return {
        implementation,
        surface,
        output,
        requiredCaseIds: ids,
        qualified: values.every(value => value !== undefined),
        perRoundMs: values,
        medianMs: values.every(value => value !== undefined) ? median(values as number[]) : null,
        policy: 'Fixed core: SVG/PNG/parser six inputs across five families; terminal three inputs across two families. Every required case must qualify in every round; CLI and public API rank separately.',
      }
    })
    .sort((a, b) => (a.medianMs ?? Infinity) - (b.medianMs ?? Infinity))
}

export async function runCommunitySuite(options: UnifiedRunOptions): Promise<UnifiedSuiteResult> {
  const startedAt = new Date().toISOString(),
    observations: BenchmarkObservation[] = [],
    gaps: string[] = [],
    prepared = await prepareCommunity(options)
  const base = unifiedWorkloads(options.profile),
    enriched = await withReferenceLabels(base, { root: options.harnessRoot ?? options.root })
  gaps.push(...enriched.gaps)
  const workloads = [...communityCoreWorkloads(), ...enriched.workloads]
  writeFileSync(join(options.out, 'community-inputs.json'), JSON.stringify({ workloads, reference: enriched.provenance, policy: 'Feature corpus attempt timings are separate from calibrated core performance ranks. Labels are existential evidence, not complete semantic/visual fidelity.' }, null, 2))
  // Browser bundling is acquisition, completed before any community timing.
  const browser = await import('./community-browser.ts')
  const preparedBrowsers = await browser.prepareCommunityBrowsers(prepared, options)
  for (const entry of prepared) {
    if (!entry.node.benchmark) {
      observations.push({
        suite: 'community',
        surface: 'catalog',
        runtime: 'not-applicable',
        family: '*',
        caseId: entry.node.id,
        operation: 'enroll',
        format: '*',
        mode: 'metadata',
        status: 'not-applicable',
        detail: 'Catalog node has no benchmark adapter; observed lineage/wrapper metadata is retained and excluded from renderer ranks',
        metrics: { implementation: entry.node.id, roles: entry.node.roles.join(',') },
      })
      continue
    }
    const boundOutputs = new Set((entry.node.benchmark.outputs ?? []).map(normalizeCommunityOutput))
    for (const declaredOutput of new Set(entry.node.outputs.map(normalizeCommunityOutput))) {
      if (boundOutputs.has(declaredOutput)) continue
      const detail = `Catalog declares ${declaredOutput}; no benchmark output adapter is bound. This capability is unmeasured.`
      gaps.push(`${entry.node.id}: ${detail}`)
      observations.push({
        suite: 'community',
        surface: 'catalog:capability',
        runtime: 'unmeasured',
        family: '*',
        caseId: `capability:${declaredOutput}`,
        operation: 'capability',
        format: declaredOutput,
        mode: 'capability',
        status: 'blocked',
        detail,
        metrics: { implementation: entry.node.id, declaredOutput, measured: false, unmeasuredCases: workloads.length },
      })
    }
    if (!entry.artifact) {
      gaps.push(`${entry.node.id}: ${entry.error}`)
      observations.push({ ...envelope(entry.node, '*', { id: '*', family: '*', source: '', features: [], provenance: 'community catalog' }, 0), status: 'blocked', detail: entry.error })
      continue
    }
  }
  const runnable = prepared.filter(p => p.artifact)
  for (let round = 1; round <= options.rounds; round++)
    for (const entry of round % 2 ? runnable : [...runnable].reverse()) {
      assertCommunityNotInterrupted()
      console.log(`community round ${round}/${options.rounds}: ${entry.node.id} ${entry.artifact!.version}`)
      for (const output of new Set((entry.node.benchmark!.outputs ?? []).map(normalizeCommunityOutput))) {
        if (entry.node.benchmark!.adapter === 'mermaid' && output === 'svg') {
          if (round === 1)
            observations.push({
              ...envelope(entry.node, output, { id: 'node-svg-capability', family: '*', source: '', features: [], provenance: 'public API runtime requirement' }, round),
              operation: 'capability',
              mode: 'capability',
              status: 'not-applicable',
              detail: 'Public SVG rendering needs browser geometry; measured in browser:public-api, not a Node/jsdom speed claim',
              metrics: { implementation: entry.node.id, unmeasuredCases: workloads.length },
            })
          continue
        }
        if (entry.artifact!.kind === 'cli') {
          // CLI image format support must be declared by the prepared command; no stale-file success.
          if (entry.artifact!.format && entry.artifact!.format !== output) {
            const detail = `Prepared CLI supports ${entry.artifact!.format}; declared ${output} output has no command binding`
            gaps.push(`${entry.node.id}: ${detail}`)
            for (const workload of workloads) observations.push({ ...envelope(entry.node, output, workload, round), surface: 'cli:end-to-end', runtime: entry.artifact!.runtime ?? 'native', status: 'blocked', detail })
            continue
          }
          for (const workload of workloads) observations.push(runCli(entry, output, workload, round, options.out))
        } else if (entry.artifact!.kind === 'jsonl-worker' || entry.artifact!.kind === 'python') {
          const { runExternalCommunity } = await import('./community-external.ts')
          observations.push(...(await runExternalCommunity(entry, workloads, output, round, options)))
        } else observations.push(...(await nodeRound(entry, output, workloads, round, options)))
      }
    }
  const browserResult = await browser.runCommunityBrowserSuite(preparedBrowsers, workloads, options)
  observations.push(...browserResult.observations)
  gaps.push(...browserResult.gaps)
  const ranks = matchedRanks(observations, options.rounds)
  writeFileSync(join(options.out, 'community-ranks.json'), JSON.stringify({ startedAt, rounds: options.rounds, ranks, catalogNodes: prepared.length, comparatorNodes: prepared.filter(p => p.node.benchmark).length, artifacts: prepared, gaps }, null, 2))
  const result: UnifiedSuiteResult = {
    id: 'community',
    status: observations.some(row => row.status === 'failed') ? 'failed' : observations.some(row => row.status === 'blocked') ? 'blocked' : 'passed',
    startedAt,
    finishedAt: new Date().toISOString(),
    observations,
    gaps,
    artifacts: ['community-prepared.json', 'community-inputs.json', 'community-ranks.json'],
  }
  writeFileSync(join(options.out, 'community-result.json'), JSON.stringify(result, null, 2))
  return result
}

// Adapter boundaries are exported for independently authored admission probes.
export { nodeRound as runCommunityNodeRound, runCli as runCommunityCli }
