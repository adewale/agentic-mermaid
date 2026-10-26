import { writeBenchmarkDocument } from '../portable/project-records.ts'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { assertBenchmarkExecutionAllowed } from '../ci-policy.ts'
import { MICRO_WORKLOADS } from '../micro-bench-cases.ts'
import { type CatalogArtifactAdmission, createCatalogEligibility } from './catalog-eligibility.ts'
import { assertCommunityNotInterrupted, trackCommunityProcess } from './community-process.ts'
import type { CommunityArtifact, CommunityNode, CommunityWorkerJob, PreparedCommunity } from './community-types.ts'
import { readWorkerRows } from './community-worker-evidence.ts'
import { qualifyOutput, svgQualificationProvenance, withReferenceLabels } from './qualification.ts'
import type { BenchmarkObservation, UnifiedRunOptions, UnifiedSuiteResult, UnifiedWorkload } from './types.ts'
import { getWorkloadEvidence, unifiedWorkloads } from './workloads.ts'

const here = dirname(fileURLToPath(import.meta.url))
const median = (xs: number[]) => {
  const a = [...xs].sort((a, b) => a - b)
  return a.length % 2 ? a[a.length >> 1]! : (a[(a.length >> 1) - 1]! + a[a.length >> 1]!) / 2
}
export const normalizeCommunityOutput = (output: string): string => (({ 'ascii-unicode': 'terminal', ascii: 'terminal', unicode: 'terminal', ast: 'parse', 'mermaid-text': 'source' }) as Record<string, string>)[output] ?? output
const safe = (id: string) => id.replace(/[^a-z0-9._-]+/gi, '_')
function writePreparationCheckpoint(path: string, value: unknown) {
  const temporary = path + `.pending-${process.pid}`
  try {
    writeFileSync(temporary, JSON.stringify(value, null, 2))
    renameSync(temporary, path)
  } catch (error) {
    if (existsSync(temporary)) unlinkSync(temporary)
    throw error
  }
}
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
  const config = node.benchmark!,
    name = config.package!
  const recorded = config.version ?? node.packages?.find(p => p.registry === 'npm' && p.name === name)?.version
  let version = recorded
  if (!config.version && config.versionPolicy !== 'recorded' && !pinned && process.env.AM_COMMUNITY_VERSION_POLICY !== 'recorded') {
    const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`)
    if (!response.ok) throw new Error(`${name} registry HTTP ${response.status}`)
    version = ((await response.json()) as { version: string }).version
  }
  if (!version) throw new Error(`No published version recorded for ${name}`)
  const extra = await import('./community-extra-adapters.mjs'),
    plan = extra.extraPackagePreparation(name)
  const prefix = join(cache, `${safe(name)}@${version}`),
    root = join(prefix, 'node_modules', name)
  mkdirSync(prefix, { recursive: true })
  const companions: string[] = plan.companions ?? []
  const needed =
    !existsSync(join(root, 'package.json')) ||
    companions.some(spec => {
      const name = spec.startsWith('@') ? spec.slice(0, spec.lastIndexOf('@')) : spec.split('@')[0]!
      return !existsSync(join(prefix, 'node_modules', name, 'package.json'))
    })
  if (needed) {
    const install = spawnSync('npm', ['install', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund', `${name}@${version}`, ...companions], {
      encoding: 'utf8',
      timeout: 300_000,
      env: { ...process.env, npm_config_cache: process.env.npm_config_cache ?? process.env.NPM_CONFIG_CACHE ?? join(cache, '.npm-cache') },
    })
    writeFileSync(join(prefix, 'install.log'), install.stdout + install.stderr)
    if (install.status !== 0) throw new Error(`${name} installation failed; ${join(prefix, 'install.log')}`)
  }
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name: string; version: string }
  if (pkg.name !== name || pkg.version !== version) throw new Error('Installed npm identity differs from resolved pin')
  const integrity = installedNpmIntegrity(prefix, root, name, version)
  const bunRuntime = /bun/i.test(config.runtime ?? plan.runtime ?? ''),
    runtime = bunRuntime ? (plan.runtime ?? 'Bun') : 'Node'
  let module: string
  const entryOverride = config.entry ?? plan.entry
  if (entryOverride) module = resolve(root, entryOverride)
  else {
    const specifier = name + ((config.subpath ?? plan.subpath) ? '/' + (config.subpath ?? plan.subpath) : '')
    const command = bunRuntime ? (process.env.BUN_BIN ?? 'bun') : 'node'
    const args = bunRuntime ? ['-e'] : ['--experimental-import-meta-resolve', '--input-type=module', '-e']
    const resolution = spawnSync(command, [...args, 'process.stdout.write(import.meta.resolve(process.argv[1], process.argv[2]))', specifier, pathToFileURL(join(root, 'package.json')).href], { encoding: 'utf8', timeout: 30_000 })
    if (resolution.status !== 0) throw new Error(`Cannot resolve the actual ${bunRuntime ? 'Bun' : 'Node'} import-condition export ${specifier}: ${resolution.stderr}`)
    module = fileURLToPath(resolution.stdout.trim())
  }
  if (!existsSync(module)) throw new Error(`Missing published entry: ${module}`)
  const wasmFiles = [] as { path: string; sha256: string }[]
  const addFile = (path: string) => {
    if (existsSync(path)) wasmFiles.push({ path, sha256: artifactDigest(path) })
  }
  addFile(module)
  for (const relative of [plan.wasmRelativePath, 'pkg/affine_mermaid_renderer_wasm_bg.wasm', 'grok-mermaid.wasm', 'src/grok-mermaid.wasm', 'dist/xmermaid_bg.wasm'].filter((value): value is string => typeof value === 'string')) addFile(join(root, relative))
  const prepared: CommunityArtifact = { kind: 'node', root, module, version, integrity, runtime, sha256: artifactDigest(module), files: wasmFiles, ...(plan.wasmRelativePath ? { wasm: join(root, plan.wasmRelativePath) } : {}), apiBoundary: plan.boundary }
  return extra.prepareExtraPublishedArtifact(prepared, { installedIntegrity: (nativeRoot: string, packageName: string, packageVersion: string) => installedNpmIntegrity(prefix, nativeRoot, packageName, packageVersion) })
}

export function verifyProvidedCommunityArtifact(artifact: CommunityArtifact): void {
  const entry = artifact.kind === 'cli' || artifact.kind === 'jsonl-worker' ? artifact.executable : artifact.kind === 'python' ? (artifact.python ?? artifact.executable) : (artifact.module ?? artifact.executable)
  if (!entry || !existsSync(entry)) throw new Error('Provided artifact entry does not exist')
  const sourceFiles = artifact.sourceFiles as { root: string; revision: string; gitPath: string; blob: string }[] | undefined
  const dependencyPatches = artifact.dependencyPatches as { root: string; revision: string; gitPath: string; blob: string }[] | undefined
  if (!artifact.sha256 && !artifact.files?.length && !sourceFiles?.length) throw new Error('Provided artifacts require compiled/shipped byte identity or a clean pinned Git source proof')
  const verified = new Set<string>()
  for (const proof of [...(sourceFiles ?? []), ...(dependencyPatches ?? [])]) {
    if (!/^[a-f0-9]{40}$/.test(proof.revision) || !/^[a-f0-9]{40}$/.test(proof.blob)) throw new Error('Invalid Git source identity')
    const tree = execFileSync('git', ['ls-tree', proof.revision, '--', proof.gitPath], { cwd: proof.root, encoding: 'utf8' }).trim()
    if (!/^100(?:644|755) /.test(tree) || tree.split(/\s+/)[2] !== proof.blob) throw new Error('Interpreted source Git blob differs from its admitted revision')
    execFileSync('git', ['diff', '--quiet', proof.revision, '--', proof.gitPath], { cwd: proof.root })
    if (sourceFiles?.includes(proof)) verified.add(realpathSync(resolve(proof.root, proof.gitPath)))
  }
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

const stableProtocol = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(stableProtocol)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, item]) => [key, stableProtocol(item)]),
        )
      : value
const sameProtocol = (left: unknown, right: unknown) => JSON.stringify(stableProtocol(left)) === JSON.stringify(stableProtocol(right))
function validateFrozenCommunityEntry(entry: PreparedCommunity, node: CommunityNode, options: UnifiedRunOptions): PreparedCommunity {
  if (!sameProtocol(entry.node.benchmark, node.benchmark) || !sameProtocol(entry.node.outputs, node.outputs) || entry.node.head !== node.head) throw Error(`Frozen node/config identity differs: ${node.id}`)
  if (!entry.artifact) return { node, error: entry.error ?? 'Frozen preparation did not record an actual artifact attempt; no acquisition is allowed during this run' }
  try {
    const artifact = entry.artifact
    verifyProvidedCommunityArtifact(artifact)
    if (node.benchmark?.adapter === 'extra-source' && (artifact.reviewed !== true || artifact.sourceRevision !== node.benchmark.sourcePin || !artifact.buildRecipeId || !artifact.runtimeCommandId)) throw Error('Source artifact has no exact reviewed Git/protocol binding')
    if (node.benchmark?.adapter === 'source-cli' && artifact.revision !== (node.release?.commit ?? node.head)) throw Error('Native artifact revision differs from recorded source pin')
    if (node.benchmark?.adapter === 'franken' && artifact.revision !== node.distribution?.revision) throw Error('WASM artifact revision differs from frozen distribution')
    if (node.benchmark?.package) {
      if (!artifact.root) throw Error('Frozen npm artifact has no installed package root')
      const pkg = JSON.parse(readFileSync(join(artifact.root, 'package.json'), 'utf8'))
      if (pkg.name !== node.benchmark.package || pkg.version !== artifact.version || (node.benchmark.version && pkg.version !== node.benchmark.version)) throw Error('Frozen installed npm package identity differs')
      const levels = pkg.name.startsWith('@') ? '../../..' : '../..',
        prefix = resolve(artifact.root, levels)
      if (installedNpmIntegrity(prefix, artifact.root, pkg.name, pkg.version) !== artifact.integrity) throw Error('Frozen npm lock integrity differs')
    }
    if (node.benchmark?.adapter === 'agentic' && options.packageRoot && (!artifact.root || realpathSync(artifact.root) !== realpathSync(options.packageRoot))) throw Error('Frozen local candidate root differs from requested actual package')
    return { node, artifact }
  } catch (error) {
    return { node, error: `Frozen artifact validation failed (not reacquired): ${String(error)}` }
  }
}
function loadFrozenCommunity(options: UnifiedRunOptions, nodes: CommunityNode[]): PreparedCommunity[] {
  const path = options.communityPreparedFile!,
    raw = JSON.parse(readFileSync(path, 'utf8')) as PreparedCommunity[]
  if (!Array.isArray(raw) || new Set(raw.map(entry => entry.node.id)).size !== raw.length || (!options.communityProjects && raw.length !== nodes.length) || nodes.some(node => !raw.some(entry => entry.node.id === node.id))) throw Error('Frozen preparation must contain every selected catalog ID exactly once')
  const prepared = nodes.map(node => validateFrozenCommunityEntry(raw.find(entry => entry.node.id === node.id)!, node, options))
  mkdirSync(options.out, { recursive: true })
  writeFileSync(join(options.out, 'community-prepared.json'), JSON.stringify(prepared, null, 2))
  writeFileSync(
    join(options.out, 'community-preparation-provenance.json'),
    JSON.stringify(
      { source: resolve(path), sourceSha256: artifactDigest(path), loadedAt: new Date().toISOString(), acquisition: 'forbidden; frozen actual failures are retained without retry', invalidArtifacts: prepared.filter(entry => !entry.artifact).map(entry => ({ id: entry.node.id, error: entry.error })) },
      null,
      2,
    ),
  )
  return prepared
}
export async function prepareCommunity(options: UnifiedRunOptions): Promise<PreparedCommunity[]> {
  const driver = options.harnessRoot ?? options.root,
    cache = resolve(process.env.AM_COMMUNITY_CACHE ?? join(driver, 'node_modules/.cache/unified-community'))
  mkdirSync(cache, { recursive: true })
  const catalog = JSON.parse(readFileSync(options.communityCatalogFile ?? join(driver, 'docs/mermaid-community.json'), 'utf8')) as { nodes: CommunityNode[] }
  catalog.nodes = selectCommunityProjects(catalog.nodes, options.communityProjects)
  if (options.communityPreparedFile) return loadFrozenCommunity(options, catalog.nodes)
  const manifestPath = options.communityArtifacts ?? process.env.AM_BENCH_COMMUNITY_ARTIFACTS
  const provided = manifestPath ? (JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, CommunityArtifact>) : {}
  const prepared: PreparedCommunity[] = []
  mkdirSync(options.out, { recursive: true })
  const checkpoint = (complete: boolean) => {
    writePreparationCheckpoint(join(options.out, 'community-prepared.json'), prepared)
    writePreparationCheckpoint(join(options.out, 'community-preparation-status.json'), {
      complete,
      updatedAt: new Date().toISOString(),
      expectedIds: catalog.nodes.map(node => node.id),
      attempted: prepared.length,
      ready: prepared.filter(entry => entry.artifact).length,
      failures: prepared.filter(entry => !entry.artifact).map(entry => ({ id: entry.node.id, error: entry.error ?? 'No applicable adapter configured' })),
    })
  }
  checkpoint(false)
  const preparationPriority = (node: CommunityNode) => (node.benchmark?.adapter !== 'extra-source' ? 0 : ['fork-go-cli', 'mermaidtext-go'].includes(node.benchmark.sourceAdapter ?? '') ? 1 : node.benchmark.sourceAdapter === 'grok-source' ? 3 : 2)
  const preparationOrder = process.env.AM_COMMUNITY_SOURCE_PREPARATION_GATE ? [...catalog.nodes].sort((left, right) => preparationPriority(left) - preparationPriority(right)) : catalog.nodes
  for (const node of preparationOrder) {
    console.log(`community preparation ${prepared.length + 1}/${catalog.nodes.length}: ${node.id}`)
    if (!node.benchmark) {
      prepared.push({ node, error: 'Applicable catalog operations have no admitted adapter; explicitly unmeasured' })
      checkpoint(false)
      continue
    }
    try {
      let artifact = provided[node.id]
      if (artifact) {
        verifyProvidedCommunityArtifact(artifact)
        if (['dart', 'bezel', 'franken', 'termaid'].includes(node.benchmark.adapter)) {
          const { prepareCommunityArtifact } = await import('./community-artifact-prepare.ts')
          if (options.communityArtifactPolicy !== 'frozen') artifact = await prepareCommunityArtifact(node, cache, manifestPath)
          verifyProvidedCommunityArtifact(artifact)
          if (node.benchmark.adapter === 'franken' && artifact.revision !== node.distribution?.revision) throw new Error('Provided Franken distribution revision differs from its recorded immutable pin')
        } else if (node.benchmark.adapter === 'extra-source') {
          if (artifact.reviewed !== true || artifact.sourceRevision !== node.benchmark.sourcePin || !artifact.buildRecipeId || !artifact.runtimeCommandId) throw new Error('Provided source artifact lacks exact reviewed source/protocol identity')
        } else if (node.benchmark.package || artifact.kind === 'node') {
          if (!artifact.root) throw new Error('Provided Node artifact requires an actual package root')
          const pkg = JSON.parse(readFileSync(join(artifact.root, 'package.json'), 'utf8')) as { name: string; version: string },
            expectedName = node.benchmark.package ?? (node.benchmark.adapter === 'agentic' ? 'agentic-mermaid' : undefined)
          if (!expectedName || pkg.name !== expectedName || pkg.version !== artifact.version) throw new Error('Provided Node artifact package name/version does not match its installed metadata')
          if (node.benchmark.package) {
            const recorded = node.benchmark.version ?? node.packages?.find(pkg => pkg.registry === 'npm' && pkg.name === expectedName)?.version
            const pinned = node.id === 'mermaid-js/mermaid' || node.benchmark.versionPolicy === 'recorded' || !!node.benchmark.version || process.env.AM_COMMUNITY_VERSION_POLICY === 'recorded'
            let expectedVersion = recorded
            if (options.communityArtifactPolicy === 'frozen' && !node.benchmark.version) expectedVersion = artifact.version
            else if (!pinned) {
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
      } else if (node.benchmark.adapter === 'extra-source') {
        const goRecipe = ['fork-go-cli', 'mermaidtext-go'].includes(node.benchmark.sourceAdapter ?? '')
        const gate = !goRecipe ? (process.env.AM_COMMUNITY_NON_GO_PREPARATION_GATE ?? process.env.AM_COMMUNITY_SOURCE_PREPARATION_GATE) : process.env.AM_COMMUNITY_SOURCE_PREPARATION_GATE
        if (gate && existsSync(gate)) {
          console.log(`community source-build scheduler waiting for ${gate} to be removed before ${node.id}`)
          while (existsSync(gate)) {
            assertCommunityNotInterrupted()
            await new Promise(resolve => setTimeout(resolve, 1000))
          }
        }
        const { prepareExtraCommunitySource } = await import('./community-extra-source.ts')
        artifact = await prepareExtraCommunitySource(node, process.env.AM_COMMUNITY_SOURCE_CACHE ?? cache)
      } else if (node.benchmark.adapter === 'agentic') {
        const root = options.packageRoot ?? options.root,
          module = join(root, 'dist/agent.js')
        if (!existsSync(module)) throw new Error('Build/pack the candidate before community timing')
        const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }
        artifact = { kind: 'node', root, module, version: pkg.version, sha256: artifactDigest(module), runtime: 'Node' }
      } else if (node.benchmark.package) artifact = await npmArtifact(node, cache, node.id === 'mermaid-js/mermaid')
      else if (node.benchmark.adapter === 'source-cli') {
        const { prepareCommunitySource } = await import('./community-source-prepare.ts')
        artifact = await prepareCommunitySource(node, process.env.AM_COMMUNITY_SOURCE_CACHE ?? cache)
      } else {
        const { prepareCommunityArtifact } = await import('./community-artifact-prepare.ts')
        artifact = await prepareCommunityArtifact(node, cache)
      }
      if (!artifact) throw new Error('Preparation returned no actual artifact')
      if (node.id === '1jehuang/mermaid-rs-renderer' && artifact.kind === 'cli') artifact.outputBindings = { ...(artifact.outputBindings ?? {}), png: { args: ['-i', '-', '-e', 'png', '-o', '{output}'], input: 'stdin' } }
      artifact.detail = `${artifact.detail ?? ''}${artifact.detail ? '; ' : ''}Version policy: ${provided[node.id] && options.communityArtifactPolicy === 'frozen' ? 'provided actual artifact version/bytes frozen; no latest lookup' : node.benchmark.adapter === 'agentic' ? 'local candidate source/package' : node.id === 'mermaid-js/mermaid' ? 'pinned current Mermaid' : node.benchmark.adapter === 'source-cli' || node.benchmark.adapter === 'extra-source' || node.benchmark.adapter === 'franken' ? 'recorded immutable source/distribution' : node.benchmark.version || node.benchmark.versionPolicy === 'recorded' || process.env.AM_COMMUNITY_VERSION_POLICY === 'recorded' ? 'recorded registry release' : 'resolved latest registry release'}. Recorded catalog versions remain separately available on the node.`
      prepared.push({ node, artifact })
    } catch (error) {
      prepared.push({ node, error: String(error) })
    }
    checkpoint(false)
  }
  prepared.sort((left, right) => catalog.nodes.findIndex(node => node.id === left.node.id) - catalog.nodes.findIndex(node => node.id === right.node.id))
  checkpoint(true)
  mkdirSync(options.out, { recursive: true })
  writeFileSync(join(options.out, 'community-prepared.json'), JSON.stringify(prepared, null, 2))
  return prepared
}

export function selectCommunityProjects(nodes: CommunityNode[], projects?: string[]): CommunityNode[] {
  if (new Set(nodes.map(node => node.id)).size !== nodes.length) throw Error('Duplicate community catalog IDs')
  if (!projects) return nodes
  if (!projects.length || projects.some(id => !id || !nodes.some(node => node.id === id)) || new Set(projects).size !== projects.length) throw Error('Community project selection must contain unique known catalog IDs')
  return nodes.filter(node => projects.includes(node.id))
}

function envelope(node: CommunityNode, output: string, workload: UnifiedWorkload, round: number): BenchmarkObservation {
  return {
    suite: 'community',
    surface: 'node:public-api',
    runtime: 'Node',
    family: workload.family,
    caseId: workload.id,
    operation: output === 'parse' || output === 'diagnostics' ? output : output === 'source' ? 'format' : output === 'react-flow' ? 'convert' : 'render',
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
  row.mode = workload.features.includes('core-graph-batch') ? 'fresh-process' : 'feature-corpus-qualification'
  if (artifact.sourceFallback === 'framed-source' && Array.isArray(artifact.supportedFamilies) && !artifact.supportedFamilies.includes(workload.family)) {
    row.status = 'unsupported'
    row.detail = 'Reviewed public renderer does not implement this family; its framed-source fallback is not diagram ink'
    return row
  }
  const input = join(out, 'cli-input.mmd'),
    destination = join(out, `cli-output.${output === 'png' ? 'png' : output === 'svg' ? 'svg' : 'txt'}`)
  writeFileSync(input, workload.source)
  if (existsSync(destination)) unlinkSync(destination)
  const binding = artifact.outputBindings?.[output]
  const args = (binding?.args ?? artifact.args ?? []).map(arg =>
    arg
      .replaceAll('{input}', input)
      .replaceAll('{output}', destination)
      .replaceAll('{format}', output === 'terminal' ? 'unicode' : output),
  )
  const started = performance.now(),
    child = spawnSync(artifact.executable!, args, { input: (binding?.input ?? artifact.input) === 'file' ? undefined : workload.source, timeout: 30_000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, NO_COLOR: '1', TERM: 'dumb' } }),
    ms = performance.now() - started
  if (workload.features.includes('core-graph-batch')) row.samplesMs = [ms]
  else row.metrics = { ...row.metrics, firstMs: ms, timingScope: 'one qualification call, not a repeated speed sample' }
  if (child.status !== 0) {
    row.status = 'failed'
    row.detail = child.error?.message ?? child.stderr?.toString().slice(0, 1500)
    return row
  }
  const fileOutput = (binding?.args ?? artifact.args)?.some(arg => arg.includes('{output}'))
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

function workerPreparedEntry(prepared: PreparedCommunity): PreparedCommunity {
  if (!prepared.artifact) return prepared
  const artifact = { ...prepared.artifact }
  // Proof manifests stay in the canonical ledger; they are not renderer state.
  Object.assign(artifact, { files: undefined, sourceFiles: undefined, dependencyPatches: undefined, runtimeDependencyRoots: undefined })
  return { node: prepared.node, artifact }
}
async function nodeRound(prepared: PreparedCommunity, output: string, workloads: UnifiedWorkload[], round: number, options: UnifiedRunOptions): Promise<BenchmarkObservation[]> {
  const directory = join(options.out, 'community-raw')
  mkdirSync(directory, { recursive: true })
  type RawRow = {
    mode?: string
    diagnosticAccepted?: boolean
    diagnosticStatusScope?: string
    diagnosticAdmissionFailed?: boolean
    parserAdmissionFailed?: boolean
    publicParserReturn?: { type: string; value?: unknown }
    surface?: string
    runtime?: string
    apiBoundary?: string
    id: string
    family: string
    status: string
    detail?: string
    samplesMs?: number[]
    firstMs?: number
    bytes?: number
    qualification?: string
    diagnosticsCount?: number
  }
  type DiagnosticControl = { id: string; source: string; expectedAccepted: false; actualAccepted: boolean | null; status: 'passed' | 'failed'; detail?: string; qualificationError?: string }
  type Raw = {
    status: string
    detail?: string
    importMs?: number
    rssBytes?: number
    peakRssBytes?: number
    runtime?: string
    publicApiAvailable?: boolean
    diagnosticAdmissionFailed?: boolean
    diagnosticAdmission?: DiagnosticControl[]
    parserAdmission?: DiagnosticControl[]
    parserAdmissionFailed?: boolean
    rows: RawRow[]
  }
  const controls = new Map<string, { kind: 'validator' | 'parser'; control: DiagnosticControl; attempt: number; runtime?: string; publicApiAvailable?: boolean; file: string }>()
  const admissionAttempts: { attempt: number; file: string; kind: 'validator' | 'parser'; controls?: DiagnosticControl[]; error?: string }[] = []
  const collected = new Map<string, { row: RawRow; raw?: Raw; attempt: number }>(),
    attempts: { attempt: number; exitCode: number | null; timedOut: boolean; activeCase?: string; detail?: string }[] = []
  let admissionEvidenceIssue = false
  let remaining = [...workloads],
    lifecycleIssue: string | undefined
  for (let attempt = 1; remaining.length && attempt <= 8; attempt++) {
    const stem = `${safe(prepared.node.id)}-${output}-r${round}-attempt${attempt}`,
      file = join(directory, stem + '.json'),
      jobPath = join(directory, stem + '.job.json'),
      progressFile = file + '.jsonl'
    for (const previous of [file, progressFile]) if (existsSync(previous)) unlinkSync(previous)
    const job: CommunityWorkerJob & { progressFd: number; artifactProofFile: string } = {
      prepared: workerPreparedEntry(prepared),
      artifactProofFile: join(options.out, 'community-prepared.json'),
      workloads: remaining,
      output,
      out: file,
      samples: 5,
      warmupMs: 50,
      minSampleMs: 10,
      harnessRoot: options.harnessRoot ?? options.root,
      packageRoot: options.packageRoot,
      coverageOnce: options.communityCoverageOnce ?? true,
      progressFd: 3,
    }
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
    const runtimeCommand = /bun/i.test(prepared.artifact?.runtime ?? '') ? (process.env.BUN_BIN ?? 'bun') : 'node'
    const child = spawn(runtimeCommand, [join(here, 'community-worker.mjs'), jobPath], { detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe', 'pipe'], env: { ...process.env, AGENTIC_MERMAID_ELK_CACHE: '1', AGENTIC_MERMAID_SCENE_ASSERTIONS: '0' } })
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
      if (existsSync(file)) {
        const value: unknown = JSON.parse(readFileSync(file, 'utf8'))
        if (!value || typeof value !== 'object' || !Array.isArray((value as Raw).rows)) throw Error('Completed worker report has no rows array')
        raw = value as Raw
      }
    } catch (error) {
      detail = `Malformed completed worker report: ${String(error)}`
    }
    const admittedRows = readWorkerRows(progressFile, raw?.rows ?? [])
    rows = admittedRows.rows as unknown as RawRow[]
    if (admittedRows.errors.length) detail = admittedRows.errors.join('; ')
    if (admittedRows.ignoredTail) detail = [detail, 'Uncommitted JSONL tail ignored; earlier complete rows retained'].filter(Boolean).join('; ')
    const admissionGroups: { kind: 'validator' | 'parser'; controls: DiagnosticControl[]; file: string }[] = [
      { kind: 'validator', controls: raw?.diagnosticAdmission ?? [], file },
      { kind: 'parser', controls: raw?.parserAdmission ?? [], file },
    ]
    for (const [kind, suffix, property] of [
      ['validator', '.diagnostic-admission.json', 'diagnosticAdmission'],
      ['parser', '.parser-admission.json', 'parserAdmission'],
    ] as const) {
      const sidecar = file + suffix
      if (!existsSync(sidecar)) continue
      try {
        const value = JSON.parse(readFileSync(sidecar, 'utf8')) as Record<string, unknown>
        const evidence = value[property]
        if (!Array.isArray(evidence)) throw Error('Negative-admission sidecar has no control array')
        admissionGroups.push({ kind, controls: evidence as DiagnosticControl[], file: sidecar })
      } catch (error) {
        admissionAttempts.push({ attempt, file: sidecar, kind, error: String(error) })
        admissionEvidenceIssue = true
        lifecycleIssue = `Malformed negative-admission sidecar: ${sidecar}: ${String(error)}`
      }
    }
    for (const group of admissionGroups) {
      if (!Array.isArray(group.controls)) {
        admissionEvidenceIssue = true
        continue
      }
      if (group.controls.length) admissionAttempts.push({ attempt, file: group.file, kind: group.kind, controls: group.controls })
      for (const control of group.controls) {
        if (!control || typeof control.id !== 'string' || typeof control.source !== 'string' || control.expectedAccepted !== false || !['passed', 'failed'].includes(control.status) || ![true, false, null].includes(control.actualAccepted)) {
          admissionEvidenceIssue = true
          admissionAttempts.push({ attempt, file: group.file, kind: group.kind, error: 'Malformed negative control; no admission inferred' })
          continue
        }
        const key = JSON.stringify([group.kind, control.id, control.source]),
          previous = controls.get(key)
        const normalized = control.status === 'passed' && control.actualAccepted !== false ? { ...control, status: 'failed' as const, detail: 'Negative control did not reject; claimed pass is contradictory' } : control
        const actual = previous && (previous.control.status !== normalized.status || previous.control.actualAccepted !== normalized.actualAccepted) ? { ...normalized, status: 'failed' as const, detail: 'Negative-control outcome changed across fresh worker attempts: ' + (normalized.detail ?? '') } : normalized
        controls.set(key, { kind: group.kind, control: actual, attempt, runtime: raw?.runtime, publicApiAvailable: raw?.publicApiAvailable, file: group.file })
      }
    }
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
  writeFileSync(join(directory, `${safe(prepared.node.id)}-${output}-r${round}-negative-admission-attempts.json`), JSON.stringify(admissionAttempts, null, 2))
  const observations = workloads.map(workload => {
    const { row: result, raw, attempt } = collected.get(workload.id)!,
      row = envelope(prepared.node, output, workload, round)
    row.runtime = result.runtime ?? raw?.runtime ?? prepared.artifact?.runtime ?? 'Node'
    if (result.surface) row.surface = result.surface
    if (result.mode) row.mode = result.mode
    else if ((options.communityCoverageOnce ?? true) && !workload.features.includes('core-graph-batch')) row.mode = 'feature-corpus-qualification'
    if (!result.surface && /bun/i.test(prepared.artifact?.runtime ?? '')) row.surface = /component|integration/i.test(prepared.artifact?.apiBoundary ?? '') ? 'bun:renderer-component' : 'bun:public-api'
    row.status = result.status === 'passed' ? 'passed' : result.status === 'unsupported' ? 'unsupported' : result.status === 'blocked' ? 'blocked' : 'failed'
    row.samplesMs = result.samplesMs
    row.bytes = result.bytes
    row.detail = result.detail
    row.metrics = {
      ...row.metrics,
      version: prepared.artifact!.version,
      apiBoundary: result.apiBoundary ?? prepared.artifact?.apiBoundary ?? 'public package API',
      firstMs: result.firstMs ?? null,
      importMs: raw?.importMs ?? null,
      endRssBytes: raw?.rssBytes ?? null,
      peakProcessRssBytes: raw?.peakRssBytes ?? null,
      qualification: result.qualification ?? 'unavailable',
      diagnosticsCount: result.diagnosticsCount ?? null,
      accepted: result.diagnosticAccepted ?? null,
      diagnosticAdmissionFailed: result.diagnosticAdmissionFailed ?? raw?.diagnosticAdmissionFailed ?? null,
      parserAdmissionFailed: result.parserAdmissionFailed ?? raw?.parserAdmissionFailed ?? null,
      publicParserReturnType: result.publicParserReturn?.type ?? null,
      publicParserReturnValue: result.publicParserReturn ? JSON.stringify(result.publicParserReturn.value ?? null) : null,
      firstCallScope: output === 'diagnostics' || (output === 'parse' && controls.size > 0) ? 'first positive workload call after independent negative-admission calls; not first-ever API call' : 'first workload call after public adapter initialization',
      statusScope: result.diagnosticStatusScope ?? null,
      workerPortfolioCases: raw?.rows?.length ?? null,
      workerAttempt: attempt,
      artifactIntegrity: prepared.artifact?.integrity ?? prepared.artifact?.sha256 ?? null,
      boundary: 'public API return/settled promise; validation excluded; memory includes worker/qualification; restarted workers remain separately identified',
    }
    return row
  })
  for (const { kind, control, attempt, runtime, publicApiAvailable, file } of controls.values())
    observations.push({
      ...envelope(
        prepared.node,
        kind === 'parser' ? 'parse' : 'diagnostics',
        { id: `${kind}-negative-admission:${control.id}`, family: 'invalid-source', source: control.source, features: [`${kind}-negative-admission`], provenance: 'independently authored negative source controls; actual public syntax/validator API' },
        round,
      ),
      surface: kind === 'parser' ? 'node:public-parse-validation' : /bun/i.test(prepared.artifact?.runtime ?? '') ? 'bun:public-api' : 'node:public-api',
      runtime: runtime ?? prepared.artifact?.runtime ?? 'unmeasured',
      operation: `${kind}-negative-admission`,
      mode: 'independent-negative-control',
      status: control.status,
      detail: [control.detail, control.qualificationError].filter(Boolean).join('; '),
      metrics: {
        implementation: prepared.node.id,
        version: prepared.artifact!.version,
        round,
        expectedAccepted: false,
        actualAccepted: control.actualAccepted,
        publicApiAvailable: publicApiAvailable ?? null,
        controlSource: control.source,
        workerAttempt: attempt,
        evidenceFile: file,
        clock: 'functional admission only; no speed sample',
      },
    })
  const requiresParserControls = output === 'parse' && (prepared.node.benchmark?.adapter === 'mermaid' || prepared.node.benchmark?.sourceAdapter === 'mermaid-source')
  const admissionKind = requiresParserControls ? 'parser' : 'validator',
    admissionControls = [...controls.values()].filter(entry => entry.kind === admissionKind),
    controlCount = admissionControls.length
  if ((output === 'diagnostics' || requiresParserControls) && admissionControls.some(entry => entry.control.status !== 'passed' || entry.control.actualAccepted !== false))
    for (const row of observations.filter(row => row.caseId.startsWith('core:') && row.status === 'passed')) {
      row.status = 'failed'
      row.detail = 'Independent negative-admission controls failed or changed across worker attempts; core speed rank withheld'
    }
  if ((output === 'diagnostics' || requiresParserControls) && (controlCount !== 2 || admissionEvidenceIssue)) {
    for (const row of observations.filter(row => row.caseId.startsWith('core:'))) {
      row.status = 'blocked'
      row.detail = 'Complete independent negative-admission control evidence is unavailable; core speed rank withheld'
    }
    observations.push({
      ...envelope(prepared.node, admissionKind === 'parser' ? 'parse' : 'diagnostics', { id: `${admissionKind}-negative-admission:incomplete-evidence`, family: 'invalid-source', source: '', features: [], provenance: 'validator protocol evidence guard' }, round),
      operation: `${admissionKind}-negative-admission`,
      mode: 'independent-negative-control',
      status: 'blocked',
      detail: `Expected2 valid independent negative controls; observed${controlCount}; malformedEvidence=${admissionEvidenceIssue}. No acceptance or timing inferred.`,
    })
  }
  if (lifecycleIssue) observations.push({ ...envelope(prepared.node, output, { id: 'worker-lifecycle', family: '*', source: '', features: [], provenance: 'worker lifecycle' }, round), operation: 'worker-lifecycle', status: 'blocked', detail: lifecycleIssue })
  return observations
}

function matchedRanks(observations: BenchmarkObservation[], rounds: number, byFamily = false) {
  const groups = new Map<string, BenchmarkObservation[]>()
  for (const row of observations.filter(row => row.caseId.startsWith('core:'))) {
    const key = JSON.stringify([row.surface, row.format, row.metrics?.implementation, byFamily ? row.family : '*'])
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  return [...groups]
    .map(([key, rows]) => {
      const [surface, output, implementation, family] = JSON.parse(key) as string[]
      const ids = communityCoreWorkloads()
        .filter(w => (output !== 'terminal' || ['core:flow5', 'core:tree50', 'core:seq20'].includes(w.id)) && (!byFamily || w.family === family))
        .map(w => w.id)
      const relevant = rows.filter(row => ids.includes(row.caseId))
      const values = Array.from({ length: rounds }, (_, index) => {
        const selected = ids.map(id => relevant.filter(row => row.caseId === id && row.metrics?.round === index + 1))
        return ids.length && selected.every(matches => matches.length === 1 && matches[0]!.status === 'passed' && matches[0]!.samplesMs?.length && matches[0]!.samplesMs!.every(value => Number.isFinite(value) && value > 0)) ? selected.reduce((n, matches) => n + median(matches[0]!.samplesMs!), 0) : null
      })
      const qualified = ids.length > 0 && relevant.length === ids.length * rounds && values.every(value => value !== null)
      return {
        implementation,
        surface,
        output,
        ...(byFamily ? { family } : {}),
        runtime: rows[0]?.runtime ?? 'unmeasured',
        version: rows[0]?.metrics?.version ?? null,
        evidenceImplementation: rows[0]?.metrics?.evidenceImplementation ?? implementation,
        independentMeasurement: !rows.some(row => row.metrics?.evidenceReuse === true),
        requiredCaseIds: ids,
        qualified,
        perRoundMs: values,
        medianMs: qualified ? median(values as number[]) : null,
        policy: byFamily
          ? 'Family scope of the existing fixed core only: flowchart2 inputs; other SVG/parser families1; terminal flowchart2/sequence1. All required cases must pass every round. This is not an invented broader workload or full-family feature score.'
          : 'Fixed core: SVG/PNG/parser6 inputs/5 families; terminal3/2. Every required case must qualify uniquely in every round; boundaries remain separate.',
      }
    })
    .sort((a, b) => (a.medianMs ?? Infinity) - (b.medianMs ?? Infinity))
}
function sourceAliasPlan(prepared: PreparedCommunity[], catalog: { nodes: CommunityNode[] }) {
  const admissions = Object.fromEntries(prepared.filter(entry => entry.artifact).map(entry => [entry.node.id, entry.artifact as CatalogArtifactAdmission]))
  const eligibility = createCatalogEligibility(catalog, admissions),
    aliases = new Map<string, { representative: string; proof: string }>()
  const physical = (entry: PreparedCommunity) => {
    const artifact = entry.artifact!,
      path = artifact.module ?? artifact.executable
    return {
      kind: artifact.kind,
      artifactClass: artifact.artifactClass ?? null,
      sourceProgramClass: artifact.sourceProgramClass ?? null,
      entry: path ? realpathSync(path) : null,
      root: artifact.root ? realpathSync(artifact.root) : null,
      benchmarkConfig: entry.node.benchmark,
      specialNodeBinding: entry.node.id === 'dfadler/zombie-mermaid' ? entry.node.id : null,
      module: artifact.module ?? null,
      executable: artifact.executable ?? null,
      global: artifact.global ?? null,
      python: artifact.python ?? null,
      wasm: artifact.wasm ?? null,
      apiAdmission: artifact.apiAdmission ?? null,
      version: artifact.version,
      sourceRevision: artifact.sourceRevision ?? artifact.revision ?? null,
      adapter: entry.node.benchmark?.adapter,
      sourceAdapter: entry.node.benchmark?.sourceAdapter,
      outputs: [...new Set((entry.node.benchmark?.outputs ?? []).map(normalizeCommunityOutput))].sort(),
      runtime: artifact.runtime,
      runtimeVersion: artifact.runtimeVersion,
      buildRecipeId: artifact.buildRecipeId,
      runtimeCommandId: artifact.runtimeCommandId,
      apiBoundary: artifact.apiBoundary ?? null,
      args: artifact.args ?? [],
      input: artifact.input ?? null,
      format: artifact.format ?? null,
      bindings: artifact.outputBindings ?? null,
      integrity: artifact.integrity ?? null,
      native: artifact.nativeBinding ?? null,
      dependencies: artifact.dependencies ?? null,
      supportedFamilies: artifact.supportedFamilies ?? null,
      sourceFallback: artifact.sourceFallback ?? null,
    }
  }
  for (const group of eligibility.equivalenceGroups.filter(group => group.status === 'verified-artifact-equivalence')) {
    const representative = prepared.find(entry => entry.node.id === group.canonicalCandidate)!
    if (!representative.artifact || !['node', 'cli'].includes(representative.artifact.kind) || representative.artifact.artifactClass === 'git-interpreted-source' || representative.artifact.sourceProgramClass === 'git-interpreted-source') continue
    for (const alias of group.aliases) {
      const entry = prepared.find(entry => entry.node.id === alias.id)!
      if (!entry.artifact || entry.artifact.artifactClass === 'git-interpreted-source' || entry.artifact.sourceProgramClass === 'git-interpreted-source' || !sameProtocol(physical(representative), physical(entry))) continue
      aliases.set(alias.id, { representative: representative.node.id, proof: `${group.sourcePin}:${group.sourceAdapter}:identical-physical-artifact-and-reviewed-protocol` })
    }
  }
  return { eligibility, aliases }
}
function loadCommunityInputs(options: UnifiedRunOptions): { workloads: UnifiedWorkload[]; gaps: string[]; reference: unknown; source?: string } | undefined {
  if (!options.communityInputsFile) return
  const input = JSON.parse(readFileSync(options.communityInputsFile, 'utf8')) as { workloads: UnifiedWorkload[]; reference?: unknown }
  if (!Array.isArray(input.workloads) || new Set(input.workloads.map(workload => workload.id)).size !== input.workloads.length) throw Error('Frozen community input IDs are missing or duplicated')
  for (const core of communityCoreWorkloads()) {
    const actual = input.workloads.find(workload => workload.id === core.id)
    if (!actual || actual.source !== core.source || !sameProtocol(actual.expectedLabels, core.expectedLabels)) throw Error(`Frozen core source/independent expectations differ: ${core.id}`)
  }
  return { workloads: input.workloads, gaps: [], reference: input.reference ?? null, source: resolve(options.communityInputsFile) }
}
export function verifyFrozenBrowserEngine(peer: import('./community-browser.ts').PreparedCommunityBrowser) {
  if (peer.browserStatus !== 'prepared') return
  const engine = peer.browser!,
    entry = resolve(engine.root, engine.entry)
  if (!engine || !entry.startsWith(resolve(engine.root) + '/') || !existsSync(entry) || artifactDigest(entry) !== engine.artifactSha256) throw Error('Prepared browser entry digest/root is mismatched')
  const files = (engine as typeof engine & { files?: { path: string; sha256: string }[] }).files
  if (!files?.length || !files.some(file => realpathSync(file.path) === realpathSync(entry))) throw Error('Frozen browser engine has no admitted entry/resource file manifest')
  for (const file of files) if (!existsSync(file.path) || artifactDigest(file.path) !== file.sha256) throw Error('Prepared browser resource digest mismatch: ' + file.path)
  for (const resource of [engine.wasm ? resolve(engine.root, engine.wasm) : undefined, engine.qualificationHelper].filter((path): path is string => !!path)) if (!files.some(file => realpathSync(file.path) === realpathSync(resource))) throw Error('Browser WASM/qualification helper is not bound by its resource manifest')
}
async function communityBrowsers(prepared: PreparedCommunity[], options: UnifiedRunOptions) {
  const browser = await import('./community-browser.ts')
  if (!options.communityPreparedFile && !options.communityBrowserPreparedFile) return browser.prepareCommunityBrowsers(prepared, options)
  const path = options.communityBrowserPreparedFile ?? join(dirname(options.communityPreparedFile!), 'community-browser-prepared.json')
  if (!existsSync(path)) {
    const missing = prepared.map(entry => ({ ...entry, browserStatus: (entry.node.benchmark?.outputs?.includes('svg') ? 'blocked' : 'not-applicable') as 'blocked' | 'not-applicable', browserDetail: 'No frozen browser preparation exists; browser acquisition/bundling is forbidden during this run' }))
    writeFileSync(join(options.out, 'community-browser-prepared.json'), JSON.stringify(missing, null, 2))
    return missing
  }
  const raw = JSON.parse(readFileSync(path, 'utf8')) as import('./community-browser.ts').PreparedCommunityBrowser[]
  if (!Array.isArray(raw) || (!options.communityProjects && raw.length !== prepared.length) || new Set(raw.map(peer => peer.node.id)).size !== raw.length) throw Error('Frozen browser snapshot must contain each selected catalog ID exactly once')
  const loaded = prepared.map(entry => {
    const peer = raw.find(peer => peer.node.id === entry.node.id)
    if (!peer || !sameProtocol(peer.node.benchmark, entry.node.benchmark)) throw Error('Frozen browser catalog/config differs: ' + entry.node.id)
    try {
      verifyFrozenBrowserEngine(peer)
      return { ...peer, node: entry.node }
    } catch (error) {
      return { ...peer, node: entry.node, browser: undefined, browserStatus: 'blocked' as const, browserDetail: String(error) }
    }
  })
  writeFileSync(join(options.out, 'community-browser-prepared.json'), JSON.stringify(loaded, null, 2))
  return loaded
}
export async function runCommunitySuite(options: UnifiedRunOptions): Promise<UnifiedSuiteResult> {
  assertBenchmarkExecutionAllowed()
  const startedAt = new Date().toISOString(),
    observations: BenchmarkObservation[] = [],
    gaps: string[] = [],
    prepared = await prepareCommunity(options)
  const outputSelection = options.communityOutputs?.map(normalizeCommunityOutput)
  if (outputSelection && (!outputSelection.length || new Set(outputSelection).size !== outputSelection.length || outputSelection.some(output => !prepared.some(entry => entry.node.benchmark?.outputs?.some(bound => normalizeCommunityOutput(bound) === output)))))
    throw Error('Unknown, empty or duplicate community output selection')
  const outputSelected = (output: string) => !outputSelection || outputSelection.includes(normalizeCommunityOutput(output))
  const driverWorkloads = unifiedWorkloads(options.profile) // Initializes parser-only/feature evidence without replacing frozen sources.
  const frozenInputs = loadCommunityInputs(options)
  const enriched = frozenInputs ? undefined : await withReferenceLabels(driverWorkloads, { root: options.harnessRoot ?? options.root })
  gaps.push(...(frozenInputs?.gaps ?? enriched!.gaps))
  const workloads = frozenInputs?.workloads ?? [...communityCoreWorkloads(), ...enriched!.workloads]
  writeFileSync(
    join(options.out, 'community-inputs.json'),
    JSON.stringify(
      {
        workloads,
        reference: frozenInputs?.reference ?? enriched?.provenance,
        source: frozenInputs?.source ?? null,
        policy: 'Full feature qualification executes once per admitted artifact/input; fixed-core performance is calibrated across rounds. Frozen source/expectations are not regenerated. Labels are existential evidence, not complete semantic/visual fidelity.',
      },
      null,
      2,
    ),
  )
  const browser = await import('./community-browser.ts'),
    preparedBrowsers = await communityBrowsers(prepared, options)
  const driver = options.harnessRoot ?? options.root,
    catalog = JSON.parse(readFileSync(options.communityCatalogFile ?? join(driver, 'docs/mermaid-community.json'), 'utf8')) as { nodes: CommunityNode[] }
  const aliasPlan = sourceAliasPlan(prepared, catalog),
    aliasProofPath = join(options.out, 'community-alias-proof.json')
  writeFileSync(
    aliasProofPath,
    JSON.stringify(
      {
        ...aliasPlan.eligibility,
        appliedNodeCliAliases: Object.fromEntries(aliasPlan.aliases),
        browserAliasesApplied: false,
        policy: 'Only verified compiled byte groups with identical physical entry/root, adapter, output/runtime/dependency/public invocation protocol reuse Node/CLI evidence. Interpreted-source and browser observations are never aliased.',
      },
      null,
      2,
    ),
  )
  for (const entry of prepared) {
    if (!entry.node.benchmark) {
      observations.push({
        suite: 'community',
        surface: 'catalog',
        runtime: 'unmeasured',
        family: '*',
        caseId: entry.node.id,
        operation: 'enroll',
        format: '*',
        mode: 'metadata',
        status: 'blocked',
        detail: 'Catalog declares applicable operations but no adapter was admitted; capability is unmeasured, not a wrapper or runtime N/A verdict',
        metrics: { implementation: entry.node.id, roles: entry.node.roles.join(',') },
      })
      continue
    }
    const boundOutputs = new Set((entry.node.benchmark.outputs ?? []).map(normalizeCommunityOutput))
    for (const declaredOutput of new Set(entry.node.outputs.map(normalizeCommunityOutput))) {
      if (!outputSelected(declaredOutput) || boundOutputs.has(declaredOutput)) continue
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
  const runnable = prepared.filter(p => p.artifact && !aliasPlan.aliases.has(p.node.id))
  for (let round = 1; round <= options.rounds; round++)
    for (const entry of round % 2 ? runnable : [...runnable].reverse()) {
      assertCommunityNotInterrupted()
      console.log(`community round ${round}/${options.rounds}: ${entry.node.id} ${entry.artifact!.version}`)
      for (const output of [...new Set((entry.node.benchmark!.outputs ?? []).map(normalizeCommunityOutput))].filter(outputSelected)) {
        const roundWorkloads = ((options.communityCoverageOnce ?? true) && round > 1 ? workloads.filter(w => w.features.includes('core-graph-batch')) : workloads).filter(w => output !== 'terminal' || !w.features.includes('core-graph-batch') || ['core:flow5', 'core:tree50', 'core:seq20'].includes(w.id))
        const selectedWorkloads = ['parse', 'diagnostics'].includes(output) ? roundWorkloads : roundWorkloads.filter(w => !getWorkloadEvidence(w.id)?.parserOnly)
        for (const workload of roundWorkloads.filter(w => !selectedWorkloads.includes(w))) observations.push({ ...envelope(entry.node, output, workload, round), status: 'not-applicable', detail: 'Owning fixture declares a parser-only assertion scope; rendering is not a promised operation for this input.' })
        if ((entry.node.benchmark!.adapter === 'mermaid' || entry.node.benchmark!.sourceAdapter === 'mermaid-source') && output === 'svg') {
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
          if (entry.artifact!.format && entry.artifact!.format !== output && !entry.artifact!.outputBindings?.[output]) {
            const detail = `Prepared CLI supports ${entry.artifact!.format}; declared ${output} output has no command binding`
            gaps.push(`${entry.node.id}: ${detail}`)
            for (const workload of selectedWorkloads) observations.push({ ...envelope(entry.node, output, workload, round), surface: 'cli:end-to-end', runtime: entry.artifact!.runtime ?? 'native', status: 'blocked', detail })
            continue
          }
          for (const workload of selectedWorkloads) observations.push(runCli(entry, output, workload, round, options.out))
        } else if (entry.artifact!.kind === 'jsonl-worker' || entry.artifact!.kind === 'python') {
          const { runExternalCommunity } = await import('./community-external.ts')
          observations.push(...(await runExternalCommunity(entry, selectedWorkloads, output, round, options)))
        } else observations.push(...(await nodeRound(entry, output, selectedWorkloads, round, options)))
      }
    }
  for (const [implementation, alias] of aliasPlan.aliases) {
    const sourceRows = observations.filter(row => row.metrics?.implementation === alias.representative && (row.surface.startsWith('node:') || row.surface.startsWith('bun:') || row.surface === 'cli:end-to-end'))
    if (!sourceRows.length && !outputSelection)
      observations.push({
        ...envelope(prepared.find(entry => entry.node.id === implementation)!.node, '*', { id: 'shared-artifact-evidence', family: '*', source: '', features: [], provenance: aliasProofPath }, 0),
        status: 'blocked',
        detail: 'Verified alias representative produced no matching Node/CLI observation; no pass or timing inferred',
      })
    for (const row of sourceRows)
      observations.push({
        ...row,
        metrics: { ...row.metrics, implementation, evidenceImplementation: alias.representative, evidenceReuse: true, equivalenceProofFile: aliasProofPath, equivalenceProof: alias.proof },
        detail: [row.detail, `Shared actual-artifact evidence from ${alias.representative}; this is not an independent measurement.`].filter(Boolean).join(' '),
      })
  }
  const browserResult = await browser.runCommunityBrowserSuite(
    preparedBrowsers,
    workloads.filter(w => !getWorkloadEvidence(w.id)?.parserOnly),
    options,
  )
  for (const peer of preparedBrowsers.filter(peer => peer.browserStatus === 'prepared' && outputSelected(peer.browser?.output ?? 'svg')))
    for (const workload of workloads.filter(w => getWorkloadEvidence(w.id)?.parserOnly))
      observations.push({ ...envelope(peer.node, 'svg', workload, 0), surface: 'browser:public-api', runtime: 'chromium', status: 'not-applicable', detail: 'Owning fixture declares a parser-only assertion scope; browser rendering is not a promised operation for this input.' })
  observations.push(...browserResult.observations)
  gaps.push(...browserResult.gaps)
  const identityRechecks: { implementation: string; boundary: string; status: string; detail?: string }[] = []
  for (const entry of prepared.filter(entry => entry.artifact)) {
    try {
      verifyProvidedCommunityArtifact(entry.artifact!)
      identityRechecks.push({ implementation: entry.node.id, boundary: 'node-cli-declared-artifacts', status: 'passed' })
    } catch (error) {
      const detail = `Artifact changed after preparation/measurement: ${String(error)}`
      identityRechecks.push({ implementation: entry.node.id, boundary: 'node-cli-declared-artifacts', status: 'failed', detail })
      gaps.push(`${entry.node.id}: ${detail}`)
      for (const row of observations.filter(row => row.metrics?.implementation === entry.node.id && !row.surface.startsWith('browser:'))) {
        row.status = 'failed'
        row.detail = detail
      }
    }
  }
  for (const peer of preparedBrowsers.filter(peer => peer.browserStatus === 'prepared')) {
    try {
      verifyFrozenBrowserEngine(peer)
      identityRechecks.push({ implementation: peer.node.id, boundary: 'browser-artifacts', status: 'passed' })
    } catch (error) {
      const detail = `Browser artifact changed after measurement: ${String(error)}`
      identityRechecks.push({ implementation: peer.node.id, boundary: 'browser-artifacts', status: 'failed', detail })
      gaps.push(`${peer.node.id}: ${detail}`)
      for (const row of observations.filter(row => row.metrics?.implementation === peer.node.id && row.surface.startsWith('browser:'))) {
        row.status = 'failed'
        row.detail = detail
      }
    }
  }
  writeFileSync(join(options.out, 'community-identity-rechecks.json'), JSON.stringify(identityRechecks, null, 2))
  const ranks = matchedRanks(observations, options.rounds),
    familyRanks = matchedRanks(observations, options.rounds, true),
    finishedAt = new Date().toISOString()
  const candidate = options as UnifiedRunOptions & { candidateTarball?: string; candidateSha256?: string }
  const targetRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: options.root, encoding: 'utf8' }).trim()
  if (candidate.candidateTarball && candidate.candidateSha256 && artifactDigest(candidate.candidateTarball) !== candidate.candidateSha256) throw Error('Measured candidate tarball differs from supplied immutable artifact identity')
  const candidateArtifact = prepared.find(entry => entry.node.benchmark?.adapter === 'agentic')?.artifact
  const evidence = {
    protocol: 'community-fixed-core-feature-once-v2',
    outputSelection: outputSelection ?? null,
    scope: outputSelection ? 'partial-output-lane; omitted output observations were not executed' : 'all-bound-outputs',
    qualificationProtocol: options.communityQualificationProtocol ?? null,
    svgQualification: svgQualificationProvenance(),
    profile: options.profile,
    rounds: options.rounds,
    coverageOnce: options.communityCoverageOnce ?? true,
    target: {
      root: options.root,
      packageRoot: options.packageRoot ?? options.root,
      revision: targetRevision,
      candidateTarball: candidate.candidateTarball ?? null,
      candidateSha256: candidate.candidateSha256 ?? null,
      compiledArtifacts: candidateArtifact ? { entry: candidateArtifact.module ?? null, sha256: candidateArtifact.sha256 ?? null, files: candidateArtifact.files ?? [] } : null,
    },
    targetAdvance: (candidateArtifact as (CommunityArtifact & { targetAdvance?: unknown }) | undefined)?.targetAdvance ?? null,
    currentReference: frozenInputs?.reference ?? enriched?.provenance ?? null,
    coreCaseIds: workloads.filter(workload => workload.features.includes('core-graph-batch')).map(workload => workload.id),
    featureCaseIds: workloads.filter(workload => !workload.features.includes('core-graph-batch')).map(workload => workload.id),
    catalogIds: prepared.map(entry => entry.node.id),
    finishedAt,
    preparedSource: options.communityPreparedFile ?? null,
    frozenInputsSource: options.communityInputsFile ?? null,
    browserSource: options.communityBrowserPreparedFile ?? null,
  }
  writeFileSync(join(options.out, 'community-evidence.json'), JSON.stringify(evidence, null, 2))
  writeFileSync(
    join(options.out, 'community-ranks.json'),
    JSON.stringify(
      {
        startedAt,
        finishedAt,
        protocol: evidence.protocol,
        evidence,
        rounds: options.rounds,
        ranks,
        familyRanks,
        catalogNodes: prepared.length,
        comparatorNodes: prepared.filter(p => p.node.benchmark).length,
        artifacts: prepared,
        eligibility: aliasPlan.eligibility,
        aliases: Object.fromEntries(aliasPlan.aliases),
        browserAliasesApplied: false,
        identityRechecks,
        gaps,
      },
      null,
      2,
    ),
  )
  const result: UnifiedSuiteResult = {
    id: 'community',
    status: observations.some(row => row.status === 'failed') ? 'failed' : observations.some(row => row.status === 'blocked') ? 'blocked' : 'passed',
    startedAt,
    finishedAt,
    observations,
    gaps,
    artifacts: ['community-prepared.json', 'community-inputs.json', 'community-ranks.json', 'community-alias-proof.json', 'community-identity-rechecks.json', 'community-evidence.json'],
  }
  writeBenchmarkDocument(join(options.out, 'community-result.json'), result)
  return result
}

// Adapter boundaries are exported for independently authored admission probes.
export const rankCommunityFamilyObservations = (observations: BenchmarkObservation[], rounds: number) => matchedRanks(observations, rounds, true)
export { matchedRanks as rankCommunityObservations, nodeRound as runCommunityNodeRound, runCli as runCommunityCli, sourceAliasPlan as planCommunitySourceAliases }
