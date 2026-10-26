import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, relative, resolve } from 'node:path'
import { assertBenchmarkExecutionAllowed } from '../ci-policy.ts'
import { artifactIdentity, resolveArtifact } from '../portable/artifacts.ts'
import { captureInstalledDependencyClosure } from '../portable/artifact-dependencies.ts'
import { defaultTimeObserver } from '../portable/time-observer.ts'
import { benchmarkContext, deliveredArtifactIdentity, executableIdentity } from './benchmark-context.ts'
import { committedDataIdentity } from './committed-data-identity.ts'
import { ENTRY_STARTUP_PRODUCERS, type EntryStartupOptions, prepareEntryStartup, runEntryStartupSuite } from './entry-startup.ts'
import { projectReportView } from './project-report-view.ts'
import { runRetainedSuite } from './retained-suite.ts'
import type { UnifiedRunOptions, UnifiedSuiteResult } from './types.ts'
import { runUpstreamTestScoreSuite, UPSTREAM_TEST_SCORE_PRODUCERS } from './upstream-test-score.ts'
import { assertBenchmarkSetVersions, assertBenchmarkToolVersion } from '../tool-versions.ts'

interface RetainedCampaignOptions extends UnifiedRunOptions {
  benchmarkRecordStore?: string
  benchmarkForce?: boolean
  startupSamples?: number
  startupSurfaces?: readonly ('library' | 'cli' | 'mcp' | 'browser')[]
  nodeExecutable?: string
  bunExecutable?: string
  observerExecutable?: string
  nativeExecutable?: string
  mermaidDir?: string
  referenceDir?: string
}
const json = (value: unknown): any => JSON.parse(JSON.stringify(value))
const combine = (id: string, startedAt: string, results: UnifiedSuiteResult[]): UnifiedSuiteResult => ({
  id,
  status: results.some(result => result.status === 'failed') ? 'failed' : !results.length || results.some(result => result.status !== 'passed') ? 'blocked' : 'passed',
  startedAt,
  finishedAt: new Date().toISOString(),
  observations: results.flatMap(result => result.observations),
  gaps: [...new Set(results.flatMap(result => result.gaps))],
  artifacts: results.flatMap(result => result.artifacts ?? []),
  toolVersions: assertBenchmarkSetVersions(results.flatMap(result => result.toolVersions ?? [])),
})
function missingProjects(options: RetainedCampaignOptions, available: readonly string[], suite: string): UnifiedSuiteResult[] {
  return (options.communityProjects ?? [])
    .filter(project => !available.includes(project))
    .map(project => {
      const now = new Date().toISOString()
      const detail = `Selected project ${project} has no configured artifact and reviewed ${suite} adapter; no implementation was invoked`
      return {
        id: suite,
        status: 'blocked',
        startedAt: now,
        finishedAt: now,
        observations: [{ suite, surface: 'project-admission', runtime: 'unavailable', family: '*', caseId: project, operation: 'artifact-admission', format: 'report', mode: 'not-executed', status: 'blocked', metrics: { implementation: project, runtimeExecuted: false }, detail }],
        gaps: [detail],
      }
    })
}

function targets(options: RetainedCampaignOptions) {
  return [{ id: 'adewale/agentic-mermaid', root: options.packageRoot ?? options.root, adapter: 'agentic' as const }, ...(options.portableArtifactRoot ? [{ id: options.portableProject ?? 'obsidianmd/pele', root: options.portableArtifactRoot, adapter: 'pele' as const }] : [])].filter(
    project => !options.communityProjects || options.communityProjects.includes(project.id),
  )
}
function nodePath(options: RetainedCampaignOptions) {
  return execFileSync(options.nodeExecutable ?? process.env.NODE_BIN ?? 'node', ['-p', 'process.execPath'], { encoding: 'utf8' }).trim()
}

export async function runRetainedEntryStartupSuite(options: RetainedCampaignOptions): Promise<UnifiedSuiteResult> {
  assertBenchmarkExecutionAllowed()
  const startedAt = new Date().toISOString()
  const harness = options.harnessRoot ?? options.root
  const node = nodePath(options)
  const require = createRequire(join(harness, 'eval/benchmark/package.json'))
  const browser = options.executable ?? (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : require('playwright').chromium.executablePath())
  const projects = targets(options)
  const results: UnifiedSuiteResult[] = missingProjects(
    options,
    projects.map(project => project.id),
    'entry-startup',
  )
  for (const project of projects) {
    const artifact = resolveArtifact(project.id, project.root, project.adapter, node)
    assertBenchmarkToolVersion(project.id, artifact.version, 'entry startup artifact')
    const settings = { profile: options.profile, rounds: options.rounds, samplesPerRound: options.startupSamples ?? (options.profile === 'full' ? 5 : 1), resourceSamplesPerRound: 1, surfaces: options.startupSurfaces ?? ['library', 'cli', 'mcp', 'browser'], timeoutMs: 60_000 }
    const actual: EntryStartupOptions = {
      ...options,
      ...settings,
      surfaces: settings.surfaces as EntryStartupOptions['surfaces'],
      packageRoot: project.root,
      portableArtifactRoot: undefined,
      portableProject: undefined,
      adapter: project.adapter,
      project: project.id,
      nodeExecutable: node,
      bunExecutable: options.bunExecutable ?? 'bun',
      observerExecutable: options.observerExecutable ?? options.portableObserver ?? defaultTimeObserver() ?? '/usr/bin/time',
      executable: browser,
      nativeExecutable: project.adapter === 'agentic' ? options.nativeExecutable : undefined,
    }
    const retained = await runRetainedSuite({
      out: join(options.out, Buffer.from(project.id).toString('base64url')),
      records: options.benchmarkRecordStore ?? join(harness, 'bench-report/project-records'),
      force: options.benchmarkForce,
      resumeAttempt: options.benchmarkResumeAttempt,
      identity: () =>
        json({
          project: project.id,
          lane: 'entry-startup',
          protocol: {
            context: benchmarkContext(
              harness,
              node,
              ENTRY_STARTUP_PRODUCERS.map(path => relative(harness, path)),
              project.adapter === 'agentic' && settings.surfaces.includes('mcp') ? ['@modelcontextprotocol/sdk/client/index.js'] : [],
            ),
            settings,
          },
          artifact: { package: artifactIdentity(artifact), website: project.adapter === 'agentic' && settings.surfaces.includes('browser') ? deliveredArtifactIdentity(options.site ?? join(options.root, 'website/public')) : null },
          measurement: {
            node: executableIdentity(node),
            bun: executableIdentity(actual.bunExecutable),
            observer: executableIdentity(actual.observerExecutable),
            browser: settings.surfaces.includes('browser') ? executableIdentity(browser) : null,
            native: executableIdentity(actual.nativeExecutable),
            bunOptions: process.env.BUN_OPTIONS ?? null,
            scope: 'Fresh-process public entry startup and separately paired resource diagnostics',
          },
        }),
      measure: async directory => {
        const run = { ...actual, out: directory }
        return runEntryStartupSuite(run, await prepareEntryStartup(run))
      },
    })
    results.push({ ...projectReportView(retained, project.id), toolVersions: [{ tool: project.id, version: artifact.version, source: 'entry-startup' }] })
  }
  const result = combine('entry-startup', startedAt, results)
  if (!results.length) result.gaps.push('No selected project has a configured startup artifact/adapter; no peer was invoked')
  return result
}

export async function runRetainedUpstreamTestSuite(options: RetainedCampaignOptions): Promise<UnifiedSuiteResult> {
  assertBenchmarkExecutionAllowed()
  const startedAt = new Date().toISOString()
  const harness = options.harnessRoot ?? options.root
  const node = nodePath(options)
  const upstream = options.mermaidDir ?? process.env.MERMAID_UPSTREAM_DIR ?? resolve(harness, '../mermaid')
  const reference = options.referenceDir ?? process.env.MERMAID_REFERENCE_DIR ?? resolve(harness, '../mermaid-reference')
  const git = (...args: string[]) => execFileSync('git', args, { cwd: upstream, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const sourcePin = () => {
    if (git('status', '--porcelain', '--untracked-files=all')) throw Error('Upstream test corpus must be a clean pinned checkout')
    return git('rev-parse', 'HEAD')
  }
  const projects = [...targets(options), ...(!options.communityProjects || options.communityProjects.includes('mermaid-js/mermaid') ? [{ id: 'mermaid-js/mermaid', root: reference, adapter: 'reference' as const }] : [])]
  const results: UnifiedSuiteResult[] = missingProjects(
    options,
    projects.map(project => project.id),
    'upstream-test-assertions',
  )
  for (const project of projects) {
    assertBenchmarkToolVersion(project.id, JSON.parse(readFileSync(join(project.root, project.adapter === 'reference' ? 'node_modules/mermaid/package.json' : 'package.json'), 'utf8')).version, 'original upstream assertion artifact')
    if (project.adapter === 'pele' && process.env.PELE_BENCHMARK_ROOT && realpathSync(process.env.PELE_BENCHMARK_ROOT) !== realpathSync(project.root)) throw Error('PELE_BENCHMARK_ROOT conflicts with the selected original-assertion artifact; no cache or worker may use a different tool')
    const artifact = () => (project.adapter === 'reference' ? { referencePackage: JSON.parse(readFileSync(join(reference, 'node_modules/mermaid/package.json'), 'utf8')), installed: captureInstalledDependencyClosure(reference) } : artifactIdentity(resolveArtifact(project.id, project.root, project.adapter, node)))
    const retained = await runRetainedSuite({
      out: join(options.out, Buffer.from(project.id).toString('base64url')),
      records: options.benchmarkRecordStore ?? join(harness, 'bench-report/project-records'),
      force: options.benchmarkForce,
      resumeAttempt: options.benchmarkResumeAttempt,
      identity: () =>
        json({
          project: project.id,
          lane: 'upstream-test-assertions',
          protocol: {
            context: benchmarkContext(harness, node, [...UPSTREAM_TEST_SCORE_PRODUCERS, 'eval/benchmark/unified/committed-data-identity.ts']),
            inputs: committedDataIdentity(harness, ['docs/project/upstream-mermaid-policy.json', 'eval/mermaid-upstream-suite-bench/mindmap-gitgraph-f3dea583.json', 'eval/mermaid-upstream-suite-bench/upstream-f3dea583/mindmap.spec.ts', 'eval/mermaid-upstream-suite-bench/upstream-f3dea583/gitGraph.spec.ts']),
            sourceCommit: sourcePin(),
          },
          artifact: artifact(),
          measurement: { node: executableIdentity(node), referenceInstalled: captureInstalledDependencyClosure(reference), scope: 'Original upstream assertions through explicit public-model adapters; private/unprojected assertions remain unavailable; no calibrated speed rank' },
        }),
      measure: directory => runUpstreamTestScoreSuite({ ...options, out: directory, nodeExecutable: node, communityProjects: [project.id] }),
    })
    results.push({ ...projectReportView(retained, project.id), toolVersions: [{ tool: project.id, version: JSON.parse(readFileSync(join(project.root, project.adapter === 'reference' ? 'node_modules/mermaid/package.json' : 'package.json'), 'utf8')).version, source: 'upstream-test-assertions' }] })
  }
  const result = combine('upstream-test-assertions', startedAt, results)
  if (!results.length) result.gaps.push('No selected project has a configured original-assertion adapter; no peer was invoked')
  return result
}
