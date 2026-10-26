import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { admitCurrentReference } from '../../mermaid-modern-compat/reference.ts'
import { assertBenchmarkExecutionAllowed } from '../ci-policy.ts'
import { assertBenchmarkSetVersions, assertBenchmarkToolVersion } from '../tool-versions.ts'
import { captureInstalledDependencyClosure } from '../portable/artifact-dependencies.ts'
import { baselineMeasurementContext } from './baseline-measurement-context.ts'
import { deliveredArtifactIdentity, executableIdentity } from './benchmark-context.ts'
import { inventoryOriginalDeclarations } from './upstream-fidelity-census.ts'
import { runRetainedSuite } from './retained-suite.ts'
import type { BenchmarkObservation, UnifiedRunOptions, UnifiedSuiteResult } from './types.ts'

export interface UpstreamOriginalOptions extends UnifiedRunOptions { upstreamWorkerTimeoutMs?: number; upstreamRunnerRoot?: string }
const write = (file: string, value: unknown) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n')
const scope = 'Actual Vitest execution of pinned Mermaid source and unmodified original core vite.config.ts. Core project includes its discovered package/unit suites; docs-site Vite workspace and browser rendering/e2e suites are not executed here. No public-parser facade, expectation rewriting or snapshot updating.'
interface OriginalTask { title: string; fullName: string; status: string; failureMessages: string[]; location?: { line: number; column: number }; duration?: number }
interface OriginalFile { name: string; status: string; message?: string; assertionResults: OriginalTask[]; startTime: number; endTime: number }
interface OriginalVitestJson { success: boolean; startTime: number; numTotalTests: number; numPassedTests: number; numFailedTests: number; numPendingTests: number; numTodoTests: number; numTotalTestSuites: number; numPassedTestSuites: number; numFailedTestSuites: number; testResults: OriginalFile[] }
export function captureUpstreamTransformDependencies(upstream: string, names: readonly string[] = ['jison', 'js-yaml', 'ajv', 'esbuild', 'typescript', '@rollup/plugin-typescript', 'langium', 'jsdom']) {
  return names.map(name => {
    const importer = name === 'langium' ? join(upstream, 'packages/parser/package.json') : join(upstream, 'package.json')
    const require = createRequire(importer)
    // Resolve the installed package directory, not a CommonJS entry. Langium
    // legitimately exposes only an ESM import condition; its bytes still bind.
    const logical = require.resolve.paths(name)?.map(base => join(base, name)).find(directory => existsSync(join(directory, 'package.json')))
    if (!logical) throw Error('Cannot locate installed source-transform package ' + name + ' from ' + importer)
    const directory = realpathSync(logical), manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
    if (manifest.name !== name) throw Error('Source-transform package name differs from the resolved directory: ' + name)
    return { name, files: deliveredArtifactIdentity(directory, true), dependencies: captureInstalledDependencyClosure(directory) }
  })
}
const infrastructure = (message: string) => /^(?:Error: )?(?:Failed to resolve import \"|Cannot find (?:module|package) ['\"]|ERR_MODULE_NOT_FOUND|Failed to load url|Could not find module)/.test(message)

/** Native runner JSON calls test callbacks "assertionResults". Keep that name
 * from being mistaken for the number of individual expect() assertions. */
export function summarizeOriginalVitest(report: OriginalVitestJson, upstream: string, inventory: ReturnType<typeof inventoryOriginalDeclarations>) {
  if (!Array.isArray(report.testResults)) throw Error('Actual Vitest JSON is missing file results')
  const callbacks = report.testResults.flatMap(file => file.assertionResults.map(test => ({ path: relative(upstream, file.name), name: test.fullName, line: test.location?.line, originalStatus: test.status, status: infrastructure(test.failureMessages.join('\n')) ? 'unavailable' : test.status === 'passed' ? 'passed' : test.status === 'failed' ? 'failed' : 'skipped-upstream', failureMessages: test.failureMessages, durationMs: test.duration })))
  if (callbacks.length !== report.numTotalTests || callbacks.filter(row => row.originalStatus === 'passed').length !== report.numPassedTests || callbacks.filter(row => row.originalStatus === 'failed').length !== report.numFailedTests) throw Error('Actual Vitest counts differ from the retained native callback rows')
  const files = report.testResults.map(file => ({ path: relative(upstream, file.name), originalStatus: file.status, callbackCount: file.assertionResults.length, status: file.status === 'failed' && !file.assertionResults.length || infrastructure(file.message ?? '') ? 'unavailable' : file.status, message: file.message ?? '' }))
  const declarations = inventory.files.flatMap(file => file.declarations.map(declaration => {
    const observed = callbacks.filter(callback => callback.path === file.path && callback.line === declaration.line)
    const physical = files.find(result => result.path === file.path)
    return { id: `${file.path}:${declaration.line}`, family: file.family, path: file.path, line: declaration.line, name: declaration.name, status: !physical ? 'outside-core-project-discovery' : physical.status === 'unavailable' ? 'unavailable' : !observed.length ? 'location-unmapped' : observed.some(callback => callback.status === 'failed') ? 'failed' : observed.some(callback => callback.status === 'unavailable') ? 'unavailable' : observed.every(callback => callback.status === 'skipped-upstream') ? 'skipped-upstream' : 'passed', expandedCallbacks: observed.length }
  }))
  return { scope, rawOriginalCounts: { totalCallbacks: report.numTotalTests, passedCallbacks: report.numPassedTests, failedCallbacks: report.numFailedTests, pendingCallbacks: report.numPendingTests, todoCallbacks: report.numTodoTests, nestedSuites: report.numTotalTestSuites, passedNestedSuites: report.numPassedTestSuites, failedNestedSuites: report.numFailedTestSuites }, actualAssertionCount: null, actualAssertionCountReason: 'Vitest JSON emits expanded callback results, not individual expect() invocation counts', physicalFiles: files.length, unavailableFiles: files.filter(file => file.status === 'unavailable').length, callbacks, files, declarations, census: inventory.counts }
}

export async function runUpstreamOriginalSuite(options: UpstreamOriginalOptions): Promise<UnifiedSuiteResult> {
  assertBenchmarkExecutionAllowed()
  const skippedAt = new Date().toISOString()
  if (options.communityProjects && !options.communityProjects.includes('mermaid-js/mermaid')) return { id: 'upstream-original', status: 'not-applicable', startedAt: skippedAt, finishedAt: skippedAt, observations: [], gaps: ['Pinned Mermaid original runner was not selected; no source, reference, runtime or project record was prepared'] }
  const startedAt = new Date().toISOString(), root = options.harnessRoot ?? options.root, upstream = options.mermaidDir ?? resolve(root, '../mermaid'), reference = options.referenceDir ?? resolve(root, '../mermaid-reference'), node = options.nodeExecutable ?? 'node'
  mkdirSync(options.out, { recursive: true })
  const pin = admitCurrentReference(upstream, reference)
  assertBenchmarkToolVersion('mermaid-js/mermaid', pin.version, 'Pinned source release tag and actual reference install')
  let runnerRoot: string, runner: string
  try {
    runnerRoot = options.upstreamRunnerRoot ?? process.env.MERMAID_UPSTREAM_RUNNER_ROOT ?? upstream
    runner = join(dirname(createRequire(join(runnerRoot, 'package.json')).resolve('vitest/package.json')), 'vitest.mjs')
    if (!existsSync(runner)) throw Error('Vitest executable missing')
  } catch (error) { return { id: 'upstream-original', status: 'blocked', startedAt, finishedAt: new Date().toISOString(), observations: [], gaps: [scope, 'Actual upstream test runtime unavailable; install the declared source dev dependencies and generate/build the declared workspace prerequisites. ' + String(error)] } }
  const inventory = inventoryOriginalDeclarations(upstream), sourceConfig = join(upstream, 'vite.config.ts'), requiredVersion = JSON.parse(readFileSync(join(upstream, 'package.json'), 'utf8')).devDependencies.vitest, actualRunnerVersion = JSON.parse(readFileSync(join(dirname(runner), 'package.json'), 'utf8')).version
  if (actualRunnerVersion !== requiredVersion.replace(/^[~^]/, '')) throw Error(`Original runner differs from pinned minimum tool version: declared=${requiredVersion}, actual=${actualRunnerVersion}`)
  return runRetainedSuite({ out: options.out, records: options.benchmarkRecordStore ?? join(options.out, 'records'), force: options.benchmarkForce,
    identity: () => JSON.parse(JSON.stringify({ project: 'mermaid-js/mermaid', lane: 'upstream-original-core-runner', protocol: { version: 'actual-original-vitest-core-v1', pin: admitCurrentReference(upstream, reference), context: baselineMeasurementContext(root, node, ['eval/benchmark/unified/upstream-fidelity-original.ts']), sourceConfig: execFileSync('git', ['rev-parse', `${pin.commit}:vite.config.ts`], { cwd: upstream, encoding: 'utf8' }).trim(), selection: scope }, artifact: { sourceCommit: pin.commit, runnerVersion: actualRunnerVersion, runnerFiles: deliveredArtifactIdentity(dirname(runner), true), runnerDependencies: captureInstalledDependencyClosure(dirname(runner)), preparedRuntimeDependencies: captureInstalledDependencyClosure(runnerRoot), referenceDependencies: captureInstalledDependencyClosure(reference), sourceTransformDependencies: captureUpstreamTransformDependencies(upstream), generatedGrammar: deliveredArtifactIdentity(join(upstream, 'packages/parser/src/language/generated'), true), compiledElkPlugin: deliveredArtifactIdentity(join(upstream, 'packages/mermaid-layout-elk/dist'), true) }, measurement: { node: executableIdentity(node), workers: 1, snapshots: 'Vitest CI mode: updateSnapshot none; no creation or updates', originalChildEnvironment: { CI: 'true' } } })),
    measure: async directory => {
      const collectionStartedAt = new Date().toISOString(), workspace = join(directory, 'core.workspace.mjs'), output = join(directory, 'vitest-original.json'), log = join(directory, 'vitest-original.log'), fontCache = join(directory, 'font-cache')
      mkdirSync(fontCache, { recursive: true })
      writeFileSync(workspace, `export default [${JSON.stringify(sourceConfig)}];\n`)
      const args = [runner, 'run', '--workspace', workspace, '--maxWorkers', '1', '--minWorkers', '1', '--includeTaskLocation', '--reporter', 'json', '--outputFile', output]
      write(join(directory, 'invocation.json'), { executable: node, args, cwd: upstream, sourcePin: pin, runnerVersion: actualRunnerVersion, scope, environment: { XDG_CACHE_HOME: fontCache, CI: 'true' } })
      const wall = performance.now(), child = spawnSync(node, args, { cwd: upstream, encoding: 'utf8', env: { ...process.env, XDG_CACHE_HOME: fontCache, CI: 'true' }, timeout: options.upstreamWorkerTimeoutMs ?? 900_000, maxBuffer: 16 * 1024 * 1024 }), workflowWallMs = performance.now() - wall
      writeFileSync(log, (child.stdout ?? '') + (child.stderr ?? ''))
      if (child.error || !existsSync(output)) throw Error(`Original upstream runner did not publish a complete JSON result: ${child.error?.message ?? child.stderr ?? child.status}`)
      const raw = JSON.parse(readFileSync(output, 'utf8')) as OriginalVitestJson
      const snapshots = (raw as unknown as { snapshot?: { added?: number; updated?: number; filesAdded?: number; filesUpdated?: number; didUpdate?: boolean } }).snapshot
      if (snapshots && (snapshots.added || snapshots.updated || snapshots.filesAdded || snapshots.filesUpdated || snapshots.didUpdate)) throw Error('Original runner wrote snapshots despite the read-only CI snapshot contract')
      const summary = summarizeOriginalVitest(raw, upstream, inventory)
      write(join(directory, 'upstream-original-summary.json'), { pin, runnerVersion: actualRunnerVersion, ...summary, subprocessExitCode: child.status, workflowWallMs })
      const observations: BenchmarkObservation[] = summary.callbacks.map((row, index) => ({ suite: 'upstream-original', surface: 'mermaid:original-source-vitest', runtime: 'Node + Vitest + jsdom', family: summary.declarations.find(declaration => declaration.path === row.path)?.family ?? '<shared>', caseId: `${row.path}:${row.line ?? 'unlocated'}:${index}`, operation: 'original-upstream-native-callback', format: 'assertions', mode: 'original-runner-functionality', status: row.status === 'unavailable' ? 'blocked' : row.status === 'skipped-upstream' ? 'not-applicable' : row.status === 'failed' ? 'failed' : 'passed', detail: row.failureMessages.join('\n').slice(0, 4000), metrics: { originalCallbackStatus: row.originalStatus, individualAssertionCountAvailable: false } }))
      for (const file of summary.files.filter(file => file.status === 'unavailable' && file.callbackCount === 0)) observations.push({ suite: 'upstream-original', surface: 'mermaid:original-source-vitest', runtime: 'Node + Vitest + jsdom', family: '<shared>', caseId: file.path, operation: 'original-module-collection', format: 'assertions', mode: 'original-runner-functionality', status: 'blocked', detail: file.message })
      observations.push({ suite: 'upstream-original', surface: 'mermaid:original-source-vitest', runtime: 'Node + Vitest + jsdom', family: '*', caseId: 'original-runner-workflow', operation: 'upstream-test-runner-workflow', format: 'assertions', mode: 'unpaired-workflow-diagnostic', status: child.status === 0 ? 'passed' : 'blocked', samplesMs: [workflowWallMs], detail: 'Full source-runner process wall time includes source transforms/imports/setup, callbacks, framework reporting and teardown. Not public API latency or comparable with public-model facade time.', metrics: { originalRunnerExitCode: child.status, totalCallbacks: raw.numTotalTests, passedCallbacks: raw.numPassedTests, failedCallbacks: raw.numFailedTests } })
      return { id: 'upstream-original', status: summary.unavailableFiles ? 'blocked' : child.status === 0 ? 'passed' : 'failed', startedAt: collectionStartedAt, finishedAt: new Date().toISOString(), observations, gaps: [scope, 'Individual expect() counts are unavailable in native Vitest JSON; callback counts are never presented as assertions.', 'Browser rendering/e2e and docs-site workspace require separate original runners and their actual prerequisites.'], artifacts: ['core.workspace.mjs', 'invocation.json', 'vitest-original.json', 'vitest-original.log', 'upstream-original-summary.json'], toolVersions: assertBenchmarkSetVersions([{ tool: 'mermaid-js/mermaid', version: pin.version, source: sourceConfig }]) }
    },
  })
}
