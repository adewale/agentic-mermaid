import { execFileSync, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { admitCurrentReference } from '../../mermaid-modern-compat/reference.ts'
import { selectsCoreFidelity } from '../fidelity/selection.ts'
import { assertBenchmarkExecutionAllowed } from '../ci-policy.ts'
import { assertBenchmarkSetVersions, assertBenchmarkToolVersion, benchmarkToolPins } from '../tool-versions.ts'
import { deliveredArtifactIdentity, executableIdentity } from './benchmark-context.ts'
import { captureInstalledDependencyClosure } from '../portable/artifact-dependencies.ts'
import { baselineMeasurementContext } from './baseline-measurement-context.ts'
import { runRetainedSuite } from './retained-suite.ts'
import { inventoryOriginalDeclarations } from './upstream-fidelity-census.ts'
import type { BenchmarkObservation, UnifiedRunOptions, UnifiedSuiteResult } from './types.ts'

interface CallbackEvidence { family: string; path: string; name: string; line?: number; status: 'passed' | 'failed' | 'unavailable' | 'skipped-upstream'; assertions: { passed: boolean; matcher: string }[]; sources: string[]; reason?: string }
interface WorkerEvidence { invocationId: string; tool: string; version: string; artifact: { name: string; version: string; entry: string }; callbacks: CallbackEvidence[]; fileErrors: { path: string; reason: string }[]; blocked?: string }
export interface UpstreamFidelityOptions extends UnifiedRunOptions { upstreamWorkerTimeoutMs?: number; upstreamRunnerRoot?: string; upstreamFidelityPlan?: boolean }
const write = (file: string, value: unknown) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n')
const serializable = (value: unknown): any => JSON.parse(JSON.stringify(value))
const moduleRoot = dirname(fileURLToPath(import.meta.url))
const statusCounts = (values: { status: string }[]) => Object.fromEntries([...new Set(values.map(value => value.status))].map(status => [status, values.filter(value => value.status === status).length]))
const scope = 'Original pinned source callbacks with expectations unchanged, through reviewed public parser/model projections. Declarations, expanded callbacks and assertions retain separate counts. Private/import/matcher gaps and disabled tests are never passes; this is distinct from Mermaid own-runner execution.'

function sourceContext(options: UpstreamFidelityOptions) {
  const root = options.harnessRoot ?? options.root
  const upstream = options.mermaidDir ?? resolve(root, '../mermaid'), reference = options.referenceDir ?? resolve(root, '../mermaid-reference')
  const pin = admitCurrentReference(upstream, reference)
  if (execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: upstream, encoding: 'utf8' }).trim()) throw Error('Pinned Mermaid tracked sources have local changes')
  return { root, upstream, reference, pin }
}

/** Every inventoried declaration retains a disposition, even when its imports,
 * private setup or assertion matcher cannot be represented by a public API. */
export function upstreamDeclarationLedger(inventory: ReturnType<typeof inventoryOriginalDeclarations>, selectedPaths: Set<string>, result: Pick<WorkerEvidence, 'callbacks' | 'fileErrors'>) {
  return inventory.files.flatMap(file => file.declarations.map(declaration => {
    const callbacks = result.callbacks.filter(callback => callback.path === file.path && callback.line === declaration.line)
    const fileError = result.fileErrors.find(error => error.path === file.path)
    const disabled = declaration.modifiers.some(modifier => ['skip', 'todo'].includes(modifier))
    const status = disabled ? 'skipped-upstream' : !selectedPaths.has(file.path) ? 'outside-public-parser-projection' : fileError ? 'unavailable' : !callbacks.length ? 'unexecuted-registration' : callbacks.some(callback => callback.status === 'failed') ? 'failed' : callbacks.some(callback => callback.status === 'unavailable') ? 'unavailable' : callbacks.every(callback => callback.status === 'skipped-upstream') ? 'skipped-upstream' : 'passed'
    return { id: `${file.path}:${declaration.line}`, family: file.family, path: file.path, line: declaration.line, name: declaration.name, status, expandedCallbacks: callbacks.length, executedAssertions: callbacks.reduce((sum, row) => sum + row.assertions.length, 0), passedAssertions: callbacks.reduce((sum, row) => sum + row.assertions.filter(assertion => assertion.passed).length, 0), ...(fileError ? { reason: fileError.reason } : !callbacks.length ? { reason: !selectedPaths.has(file.path) ? 'Shared/render/internal/e2e declaration outside this reviewed public parser projection; original own-runner is a separate result' : disabled ? 'Disabled by upstream' : 'Original declaration did not register a runnable callback in this projection' } : {}) }
  }))
}

export async function runUpstreamFidelitySuite(options: UpstreamFidelityOptions): Promise<UnifiedSuiteResult> {
  assertBenchmarkExecutionAllowed()
  const startedAt = new Date().toISOString()
  if (!selectsCoreFidelity(options.communityProjects)) return { id: 'upstream-fidelity', status: 'not-applicable', startedAt, finishedAt: startedAt, observations: [], gaps: ['No project with a reviewed original public-parser projection was selected; no source, reference, runtime or output directory was prepared.'] }
  const { root, upstream, reference, pin } = sourceContext(options)
  mkdirSync(options.out, { recursive: true })
  const inventory = inventoryOriginalDeclarations(upstream)
  const policy = JSON.parse(readFileSync(join(root, 'docs/project/upstream-mermaid-policy.json'), 'utf8'))
  const required = new Set<string>([...policy.families.filter((family: any) => family.maturity === 'stable').map((family: any) => family.id), 'eventmodeling', 'zenuml'])
  const selected = inventory.files.filter(file => required.has(file.family) && file.path.startsWith('packages/mermaid/src/diagrams/'))
  const files = options.profile === 'smoke' ? selected.filter((file, index) => selected.findIndex(other => other.family === file.family) === index) : selected
  write(join(options.out, 'upstream-fidelity-inventory.json'), { pin, requiredFamilies: [...required], selectedPaths: files.map(file => file.path), ...inventory })
  if (options.upstreamFidelityPlan) return { id: 'upstream-fidelity', status: 'blocked', startedAt, finishedAt: new Date().toISOString(), observations: [], gaps: ['Plan only; no public parser callback or upstream test runner executed'], artifacts: ['upstream-fidelity-inventory.json'] }
  const targets = [
    { tool: 'agentic', project: 'adewale/agentic-mermaid', packageRoot: options.packageRoot ?? root },
    { tool: 'pele', project: 'obsidianmd/pele', packageRoot: options.portableArtifactRoot ?? join(root, `node_modules/.cache/unified-community/pele@${benchmarkToolPins['obsidianmd/pele'].version}/node_modules/pele`) },
    { tool: 'mermaid', project: 'mermaid-js/mermaid', packageRoot: join(reference, 'node_modules/mermaid') },
  ].filter(target => !options.communityProjects || options.communityProjects.includes(target.project))
  const results: any[] = [], observations: BenchmarkObservation[] = []
  for (const target of targets) {
    const out = join(options.out, Buffer.from(target.project).toString('base64url')), manifest = JSON.parse(readFileSync(join(target.packageRoot, 'package.json'), 'utf8'))
    assertBenchmarkToolVersion(target.project, manifest.version, join(target.packageRoot, 'package.json'))
    const result = await runRetainedSuite({ out, records: options.benchmarkRecordStore ?? join(options.out, 'records'), force: options.benchmarkForce,
      identity: () => serializable({ project: target.project, lane: 'upstream-fidelity', protocol: { version: 'original-public-parser-projection-v1', pin: admitCurrentReference(upstream, reference), context: baselineMeasurementContext(root, options.nodeExecutable ?? 'node', ['eval/benchmark/unified/upstream-fidelity.ts', 'eval/benchmark/unified/upstream-fidelity-worker.mjs']), sourceFiles: files.map(file => ({ path: file.path, object: execFileSync('git', ['rev-parse', `${pin.commit}:${file.path}`], { cwd: upstream, encoding: 'utf8' }).trim() })) }, artifact: { package: manifest, delivered: deliveredArtifactIdentity(join(target.packageRoot, 'dist'), true), dependencies: captureInstalledDependencyClosure(target.tool === 'mermaid' ? reference : target.packageRoot) }, measurement: { projection: scope, profile: options.profile, node: executableIdentity(options.nodeExecutable ?? 'node') } }),
      measure: async directory => {
        const collectionStartedAt = new Date().toISOString(), invocationId = randomUUID(), jobPath = join(directory, 'job.json'), output = join(directory, 'upstream-fidelity-worker.json')
        write(jobPath, { ...target, referenceRoot: reference, invocationId, output, files: files.map(file => ({ family: file.family, path: file.path, absolutePath: join(upstream, file.path) })) })
        const child = spawnSync(options.nodeExecutable ?? 'node', [join(moduleRoot, 'upstream-fidelity-worker.mjs'), jobPath], { cwd: root, encoding: 'utf8', timeout: options.upstreamWorkerTimeoutMs ?? 600_000, maxBuffer: 4 * 1024 * 1024 })
        if (child.status !== 0 || child.error || !existsSync(output)) throw Error(`Original callback projection worker incomplete: ${child.error?.message ?? child.stderr ?? child.status}`)
        const evidence = JSON.parse(readFileSync(output, 'utf8')) as WorkerEvidence
        if (evidence.invocationId !== invocationId || evidence.tool !== target.tool || evidence.version !== manifest.version || !Array.isArray(evidence.callbacks)) throw Error('Original callback worker receipt differs from admitted target/invocation')
        const ledger = upstreamDeclarationLedger(inventory, new Set(files.map(file => file.path)), evidence)
        write(join(directory, 'upstream-declaration-ledger.json'), ledger)
        const rows: BenchmarkObservation[] = evidence.callbacks.map((row, index) => ({ suite: 'upstream-fidelity', surface: `${target.project}:public-parser-model`, runtime: 'Node', family: row.family, caseId: `${row.path}:${row.line ?? 'unlocated'}:${index}`, operation: 'original-upstream-callback', format: 'structured', mode: 'functionality-only', status: row.status === 'unavailable' ? 'blocked' : row.status === 'skipped-upstream' ? 'not-applicable' : row.status, detail: row.reason, metrics: { executedAssertions: row.assertions.length, passedAssertions: row.assertions.filter(assertion => assertion.passed).length, declarationLine: row.line ?? null, sourceCount: row.sources.length } }))
        const gaps = [scope, 'Original private database representation and exact diagnostic wording are compatibility observations, not automatically diagram-meaning defects.', ...evidence.fileErrors.map(error => `${error.path}: ${error.reason}`)]
        write(join(directory, 'upstream-fidelity-summary.json'), { project: target.project, version: manifest.version, declaredInventory: inventory.counts, selectedFiles: files.length, declaredOutcomes: statusCounts(ledger), expandedOutcomes: statusCounts(evidence.callbacks), executedAssertions: evidence.callbacks.reduce((sum, row) => sum + row.assertions.length, 0), passedAssertions: evidence.callbacks.reduce((sum, row) => sum + row.assertions.filter(assertion => assertion.passed).length, 0), families: [...required].map(family => ({ family, selectedFiles: files.filter(file => file.family === family).length, callbacks: statusCounts(evidence.callbacks.filter(row => row.family === family)), declarations: statusCounts(ledger.filter(row => row.family === family)) })), scope })
        return { id: 'upstream-fidelity', status: rows.some(row => row.status === 'failed') ? 'failed' : 'blocked', startedAt: collectionStartedAt, finishedAt: new Date().toISOString(), observations: rows, gaps, artifacts: ['job.json', 'upstream-fidelity-worker.json', 'upstream-declaration-ledger.json', 'upstream-fidelity-summary.json'] }
      },
    })
    observations.push(...result.observations)
    const cache = JSON.parse(readFileSync(join(out, 'cache.json'), 'utf8'))
    results.push({ project: target.project, version: manifest.version, recordId: cache.recordId, reused: cache.reused, evidenceDirectory: cache.evidenceDirectory, startedAt: cache.startedAt, finishedAt: cache.finishedAt, summary: JSON.parse(readFileSync(join(cache.evidenceDirectory, 'upstream-fidelity-summary.json'), 'utf8')) })
  }
  write(join(options.out, 'upstream-fidelity-report.json'), { pin, scope, inventory: inventory.counts, requiredFamilies: [...required], results })
  return { id: 'upstream-fidelity', status: observations.some(row => row.status === 'failed') ? 'failed' : 'blocked', startedAt, finishedAt: new Date().toISOString(), observations, gaps: [scope], artifacts: ['upstream-fidelity-report.json', 'upstream-fidelity-inventory.json'], toolVersions: assertBenchmarkSetVersions(results.map(result => ({ tool: result.project, version: result.version, source: result.evidenceDirectory }))) }
}
