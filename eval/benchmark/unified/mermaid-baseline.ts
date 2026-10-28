import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { assertBenchmarkSetVersions, benchmarkToolPins } from 'trident/tool-versions.ts'
import { runBaselineBrowserSuite } from 'trident/unified/baseline-browser.ts'
import { runMermaidBaselineCompatibility } from './mermaid-baseline-compatibility.ts'
import type { UnifiedRunOptions, UnifiedSuiteResult } from 'trident/unified/types.ts'
import { mermaidOracleDirectory, mermaidUpstreamDirectory } from 'trident/portable/mermaid-oracle.ts'

/** Campaign adapters keep baseline setup out of existing measurement workers. */
export async function runMermaidBrowserBaseline(options: UnifiedRunOptions): Promise<UnifiedSuiteResult> {
  const root = options.harnessRoot ?? options.root
  const reviewed = new Set(['mermaid-js/mermaid', 'adewale/agentic-mermaid', 'obsidianmd/pele'])
  const projects = options.communityProjects?.filter(project => reviewed.has(project))
  const unavailable = (options.communityProjects ?? []).filter(project => !reviewed.has(project)).map(project => ({
    suite: 'mermaid-baseline-browser', surface: 'browser:svg', runtime: 'Browser', family: '*', caseId: 'adapter:' + project,
    operation: 'render', format: 'svg', mode: 'capability-boundary', status: 'unsupported' as const,
    metrics: { project, runtimeExecuted: false },
    detail: 'No reviewed adapter for this product browser-baseline protocol; catalog SVG evidence is collected separately.',
  }))
  const gaps = unavailable.length ? ['Requested projects without a reviewed browser-baseline adapter remain unsupported: ' + unavailable.map(row => row.metrics.project).join(', ')] : []
  if (projects?.length === 0) {
    const timestamp = new Date().toISOString()
    return { id: 'mermaid-baseline-browser', status: 'unsupported', startedAt: timestamp, finishedAt: timestamp, observations: unavailable, gaps, toolVersions: [] }
  }
  const result = await runBaselineBrowserSuite({
    root,
    out: options.out,
    agenticRoot: options.packageRoot ?? options.root,
    peleRoot: options.portableArtifactRoot ?? join(root, `node_modules/.cache/unified-community/pele@${benchmarkToolPins['obsidianmd/pele'].version}/node_modules/pele`),
    referenceRoot: join(options.referenceDir ?? mermaidOracleDirectory(), 'node_modules/mermaid'),
    upstreamRoot: options.mermaidDir ?? mermaidUpstreamDirectory(),
    browserExecutable: options.executable,
    nodeExecutable: options.nodeExecutable,
    records: options.benchmarkRecordStore,
    force: options.benchmarkForce,
    projects,
    mode: options.profile === 'smoke' ? 'smoke' : 'full',
    rounds: options.rounds,
  })
  return { ...result, id: 'mermaid-baseline-browser', observations: [...result.observations, ...unavailable], gaps: [...result.gaps, ...gaps], toolVersions: assertBenchmarkSetVersions(result.identities.map(identity => ({ tool: identity.tool, version: identity.version, source: identity.entry }))) }
}

export async function runMermaidParserBaseline(options: UnifiedRunOptions): Promise<UnifiedSuiteResult> {
  const result = await runMermaidBaselineCompatibility({ ...options, parserFunctionalOnly: options.profile === 'smoke' })
  const receipt = join(options.out, 'parser-baseline.json')
  if (!existsSync(receipt)) return result
  const report = JSON.parse(readFileSync(receipt, 'utf8')) as { targets: { project: string; version: string; evidenceDirectory: string }[] }
  return { ...result, toolVersions: assertBenchmarkSetVersions(report.targets.map(target => ({ tool: target.project, version: target.version, source: target.evidenceDirectory }))) }
}
