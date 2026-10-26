import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { requiredFamilyWorkloads } from './required-family-cases.ts'
import { artifactIdentity, readJson, resolveArtifact } from '../portable/artifacts.ts'
import { assessStableFamilySupport, readStableSupportPolicy, type FamilyMaturityAudit, type StableSupportObservation } from './stable-support.ts'
import { benchmarkContext } from './benchmark-context.ts'
import { runRetainedSuite } from './retained-suite.ts'
import { assertBenchmarkExecutionAllowed } from '../ci-policy.ts'
import type { BenchmarkObservation, UnifiedRunOptions, UnifiedSuiteResult } from './types.ts'
import { mermaidUpstreamDirectory } from '../portable/mermaid-oracle.ts'

interface SupportOptions extends UnifiedRunOptions {
  mermaidDir?: string
  benchmarkRecordStore?: string
  benchmarkForce?: boolean
  nodeExecutable?: string
}

const producers = ['eval/benchmark/unified/stable-support-run.ts', 'eval/benchmark/unified/stable-support-worker.mjs', 'eval/benchmark/unified/stable-maturity-review.json', 'docs/project/upstream-mermaid-policy.json']
const requirement = [{ id: 'qualified-public-svg', surface: 'public-svg', operation: 'render', format: 'svg' }]
const json = (value: unknown): any => JSON.parse(JSON.stringify(value))

export async function runStableSupportSuite(options: SupportOptions): Promise<UnifiedSuiteResult> {
  assertBenchmarkExecutionAllowed()
  const startedAt = new Date().toISOString()
  const harness = options.harnessRoot ?? options.root
  const policy = readStableSupportPolicy(join(harness, 'docs/project/upstream-mermaid-policy.json'))
  const audit = readJson(join(harness, 'eval/benchmark/unified/stable-maturity-review.json')) as FamilyMaturityAudit
  const cases = requiredFamilyWorkloads()
  const node = options.nodeExecutable ?? execFileSync('node', ['-p', 'process.execPath'], { encoding: 'utf8' }).trim()
  const upstream = options.mermaidDir ?? mermaidUpstreamDirectory()
  const sources = ['packages/mermaid/src/docs/syntax/eventmodeling.md', 'packages/mermaid/src/docs/syntax/zenuml.md', 'packages/mermaid/src/diagrams/eventmodeling/detector.ts']
  const git = (...args: string[]) => execFileSync('git', args, { cwd: upstream, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  if (git('rev-parse', 'HEAD') !== policy.pin.commit || git('status', '--porcelain', '--', ...sources)) throw Error('Required-family maturity review needs the clean pinned Mermaid source')
  const projects = [
    { id: 'adewale/agentic-mermaid', root: options.packageRoot ?? options.root, adapter: 'agentic' as const },
    ...(options.portableArtifactRoot ? [{ id: options.portableProject ?? 'obsidianmd/pele', root: options.portableArtifactRoot, adapter: 'pele' as const }] : []),
  ].filter(project => !options.communityProjects || options.communityProjects.includes(project.id))
  if (!projects.length) return { id: 'stable-support', status: 'blocked', startedAt, finishedAt: new Date().toISOString(), observations: [], gaps: ['No selected project has a configured required-family probe; supply the actual artifact and its reviewed public adapter'] }
  const results: UnifiedSuiteResult[] = (options.communityProjects ?? []).filter(project => !projects.some(target => target.id === project)).map(project => ({ id: 'stable-support', status: 'blocked', startedAt, finishedAt: new Date().toISOString(), observations: [{ suite: 'stable-support', surface: 'project-admission', runtime: 'unavailable', family: '*', caseId: project, operation: 'artifact-admission', format: 'report', mode: 'not-executed', status: 'blocked', metrics: { implementation: project, runtimeExecuted: false }, detail: 'Selected project has no configured required-family public adapter or artifact' }], gaps: [`${project}: selected but unconfigured; no peer was invoked`] }))
  for (const project of projects) {
    const artifact = resolveArtifact(project.id, project.root, project.adapter, node)
    const out = join(options.out, Buffer.from(project.id).toString('base64url'))
    const result = await runRetainedSuite({
      out,
      records: options.benchmarkRecordStore ?? join(harness, 'bench-report/project-records'),
      force: options.benchmarkForce,
      identity: () => json({ project: project.id, lane: 'required-family-admission', protocol: { context: benchmarkContext(harness, node, producers), policy, audit, cases, requirement, upstreamFiles: git('ls-tree', '-r', 'HEAD', '--', ...sources) }, artifact: artifactIdentity(artifact), measurement: { scope: 'Functional SVG admission only; no latency rank or new memory claim' } }),
      measure: async directory => {
        const begin = new Date().toISOString()
        const resultFile = join(directory, 'observations.json')
        const jobFile = join(directory, 'job.json')
        const svg = join(directory, 'svg')
        mkdirSync(svg)
        writeFileSync(jobFile, JSON.stringify({ artifact, cases, out: svg, resultFile }))
        execFileSync(node, [join(harness, 'eval/benchmark/unified/stable-support-worker.mjs'), jobFile], { cwd: directory, timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] })
        const observations = JSON.parse(readFileSync(resultFile, 'utf8')) as BenchmarkObservation[]
        const runtime: StableSupportObservation[] = observations.map(row => ({ ...row, expectedAccepted: row.metrics?.expectedAccepted === true, runtimeExecuted: row.metrics?.runtimeExecuted === true, nativeSemantic: row.metrics?.nativeSemantic === true, paintedSemantic: row.metrics?.paintedSemantic === true, detail: row.findings?.join('; ') }))
        const support = assessStableFamilySupport(policy, runtime, requirement, audit)
        const supportFile = join(directory, 'required-family-support.json')
        writeFileSync(supportFile, JSON.stringify({ project: project.id, ...support }, null, 2) + '\n')
        const failedRequired = support.families.some(family => family.requiredForComparison && family.cells.some(cell => cell.status === 'failed' || cell.status === 'unsupported'))
        return { id: 'stable-support', status: failedRequired ? 'failed' : support.completeLibraryEligible ? 'passed' : 'blocked', startedAt: begin, finishedAt: new Date().toISOString(), observations, gaps: [...support.gaps, 'This probes public SVG format and authored-label admission, not complete native functionality, all feature combinations or painted fidelity. Beta/experimental probes remain separate supplements.'], artifacts: [supportFile] }
      },
    })
    results.push(result)
  }
  return { id: 'stable-support', status: results.some(result => result.status === 'failed') ? 'failed' : results.some(result => result.status !== 'passed') ? 'blocked' : 'passed', startedAt, finishedAt: new Date().toISOString(), observations: results.flatMap(result => result.observations), gaps: [...new Set(results.flatMap(result => result.gaps))], artifacts: results.flatMap(result => result.artifacts ?? []) }
}
