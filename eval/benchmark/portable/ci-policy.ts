import { assertMermaidOracle } from './mermaid-oracle.ts'

/** Performance results require an explicitly owned local measurement session, and every
 * benchmark run consults the one pinned Mermaid oracle, so a run refuses to start without it.
 * Commands that only build, check or read evidence pass mermaidOracle: false. */
export function assertBenchmarkExecutionAllowed(environment: NodeJS.ProcessEnv = process.env, requirements: { mermaidOracle?: boolean } = {}): void {
  const enabled = (value: string | undefined) => value !== undefined && value !== '' && !/^(?:0|false|no)$/i.test(value)
  const indicators = ['CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'BUILDKITE', 'CIRCLECI', 'TF_BUILD', 'JENKINS_URL', 'TEAMCITY_VERSION']
  const active = indicators.filter(name => enabled(environment[name]))
  if (active.length) throw new Error(`Benchmarks are excluded from CI (${active.join(', ')}). Run them in an explicit local measurement session; records can be updated without rerunning unchanged projects.`)
  if (requirements.mermaidOracle ?? true) assertMermaidOracle(environment)
}
