import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { assertBenchmarkToolVersion } from 'trident/tool-versions.ts'
import { communityCatalogFile, harnessRepository } from 'trident/unified/trident-paths.ts'
import type { UnifiedRunOptions } from 'trident/unified/types.ts'

// Shared by the unified runner and community:update, without importing the suites.
const DRIVER = resolve(import.meta.dirname, '../../..')
const readJson = (file: string): any => JSON.parse(readFileSync(file, 'utf8'))

export { admitSelectedArtifacts } from 'trident/unified/artifact-admission.ts'
import { admitSelectedArtifacts } from 'trident/unified/artifact-admission.ts'

export interface SuiteOptions extends UnifiedRunOptions {
  harnessRoot: string
  packageRoot?: string
  site?: string
  ownershipSite?: string
  candidateTarball?: string
  candidateSha256?: string
  baseline?: string
  baselineCheckout?: string
  candidateCheckout?: string
  baselineRef?: string
  baselineNpm?: string
  baselineTarball?: string
  baselineSha256?: string
  baselineLock?: string
  bezelDir?: string
  mermaidDir?: string
  referenceDir?: string
  liveProvider?: string
  liveModel?: string
}

export interface RunnerOptions extends SuiteOptions {
  selected?: string[]
  timeoutMs: number
  list: boolean
  allowIncomplete: boolean
  exportTables?: boolean
}
export function parseOptions(argv: string[]): RunnerOptions {
  const flags = new Set(['--list', '--allow-incomplete', '--community-force', '--benchmark-force', '--export-tables'])
  const allowed = new Set([
    'profile',
    'suites',
    'out',
    'rounds',
    'timeout-ms',
    'target',
    'package-root',
    'site',
    'ownership-site',
    'executable',
    'candidate-tarball',
    'candidate-sha256',
    'baseline',
    'baseline-checkout',
    'candidate-checkout',
    'baseline-ref',
    'baseline-npm',
    'baseline-tarball',
    'baseline-sha256',
    'baseline-lock',
    'bezel-dir',
    'mermaid-dir',
    'reference-dir',
    'zenuml-root',
    'upstream-runner-root',
    'live-provider',
    'live-model',
    'community-artifacts',
    'community-projects',
    'projects',
    'benchmark-records',
    'benchmark-resume-attempt',
    'startup-samples',
    'startup-surfaces',
    'node-executable',
    'bun-executable',
    'startup-observer',
    'native-executable',
    'community-catalog',
    'community-records',
    'portable-project',
    'portable-artifact-root',
    'portable-adapter',
    'portable-observer',
    'modern-editor-root',
    'community-prepared',
    'community-inputs',
    'community-browser-prepared',
    'community-artifact-policy',
    'community-coverage',
    'community-outputs',
    'community-qualification-assets',
    'community-qualification-protocol',
  ])
  const options = new Map<string, string>()
  const seen = new Set<string>()
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!
    if (seen.has(flag)) throw new Error(`Duplicate option ${flag}`)
    seen.add(flag)
    if (flags.has(flag)) {
      options.set(flag.slice(2), 'true')
      continue
    }
    const key = flag.slice(2),
      value = argv[++i]
    if (!flag.startsWith('--') || !allowed.has(key) || !value || value.startsWith('--')) throw new Error(`Invalid option ${flag}; use --help`)
    options.set(key, value)
  }
  const profile = options.get('profile') ?? 'smoke'
  if (profile !== 'smoke' && profile !== 'full') throw new Error('--profile must be smoke or full')
  const positive = (key: string, fallback: number) => {
    const value = Number(options.get(key) ?? fallback)
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`--${key} must be a positive integer`)
    return value
  }
  const path = (key: string) => (options.has(key) ? resolve(options.get(key)!) : undefined)
  const selected = options.get('suites')?.split(',')
  if (selected?.some(id => !id) || (selected && new Set(selected).size !== selected.length)) throw new Error('--suites needs unique nonempty comma-separated IDs')
  for (const name of ['candidate-sha256', 'baseline-sha256']) {
    const digest = options.get(name)
    if (digest !== undefined && !/^[a-f0-9]{64}$/.test(digest)) throw new Error(`--${name} must be a lowercase SHA-256 artifact digest`)
    if (digest !== undefined && !options.has(name.replace('sha256', 'tarball'))) throw new Error(`--${name} requires its tarball path`)
  }
  if (options.has('baseline') && options.has('baseline-npm')) throw new Error('Use --baseline directory or --baseline-npm selector, not both')
  if (options.has('baseline-lock') && options.has('baseline-tarball')) throw new Error('Use --baseline-lock or --baseline-tarball, not both')
  const communityPolicy = options.get('community-artifact-policy') ?? 'latest',
    communityCoverage = options.get('community-coverage') ?? 'once'
  if (!['frozen', 'latest'].includes(communityPolicy) || !['once', 'repeated'].includes(communityCoverage)) throw Error('Invalid community artifact or coverage policy')
  const liveProvider = options.get('live-provider')
  if (options.has('projects') && options.has('community-projects')) throw Error('Use --projects or --community-projects, not both')
  const projects = (options.get('projects') ?? options.get('community-projects'))?.split(',')
  if (projects?.some(project => !project) || (projects && new Set(projects).size !== projects.length)) throw Error('--projects needs unique nonempty project IDs')
  if (options.has('benchmark-resume-attempt') && (projects?.length !== 1 || selected?.length !== 1 || !['entry-startup', 'upstream-test-assertions'].includes(selected[0]!) || options.has('benchmark-force'))) throw Error('--benchmark-resume-attempt requires one selected project, one retained suite, and no --benchmark-force')
  const startupSurfaces = options.get('startup-surfaces')?.split(',') as RunnerOptions['startupSurfaces']
  if (startupSurfaces && (!startupSurfaces.length || new Set(startupSurfaces).size !== startupSurfaces.length || startupSurfaces.some(surface => !['library', 'cli', 'mcp', 'browser'].includes(surface)))) throw Error('--startup-surfaces needs unique library,cli,mcp,browser values')
  if (liveProvider && !['anthropic', 'openai-compatible'].includes(liveProvider)) throw new Error('--live-provider must be anthropic or openai-compatible')
  if (!options.has('list')) admitSelectedArtifacts({
    portableArtifactRoot: path('portable-artifact-root'), portableProject: options.get('portable-project'),
    communityArtifacts: path('community-artifacts'), communityPreparedFile: path('community-prepared'),
    communityCatalogFile: path('community-catalog'), communityProjects: projects, harnessRoot: DRIVER,
  })
  return {
    root: path('target') ?? DRIVER,
    harnessRoot: DRIVER,
    packageRoot: path('package-root'),
    out: path('out') ?? resolve('bench-report/unified'),
    profile,
    rounds: positive('rounds', profile === 'smoke' ? 1 : 3),
    timeoutMs: positive('timeout-ms', profile === 'full' ? 4 * 60 * 60_000 : 30 * 60_000),
    selected,
    list: options.has('list'),
    allowIncomplete: options.has('allow-incomplete'),
    exportTables: options.has('export-tables'),
    executable: path('executable'),
    site: path('site'),
    ownershipSite: path('ownership-site'),
    candidateTarball: path('candidate-tarball'),
    candidateSha256: options.get('candidate-sha256'),
    baseline: path('baseline'),
    baselineCheckout: path('baseline-checkout'),
    candidateCheckout: path('candidate-checkout'),
    baselineRef: options.get('baseline-ref'),
    baselineNpm: options.get('baseline-npm'),
    baselineTarball: path('baseline-tarball'),
    baselineSha256: options.get('baseline-sha256'),
    baselineLock: path('baseline-lock'),
    bezelDir: path('bezel-dir'),
    mermaidDir: path('mermaid-dir'),
    referenceDir: path('reference-dir'),
    fidelityZenumlRoot: path('zenuml-root'),
    upstreamRunnerRoot: path('upstream-runner-root'),
    liveProvider,
    liveModel: options.get('live-model'),
    communityArtifacts: path('community-artifacts'),
    communityProjects: projects,
    benchmarkRecordStore: path('benchmark-records'),
    benchmarkForce: options.has('benchmark-force'),
    benchmarkResumeAttempt: path('benchmark-resume-attempt'),
    startupSamples: options.has('startup-samples') ? positive('startup-samples', 5) : undefined,
    startupSurfaces,
    nodeExecutable: path('node-executable'),
    bunExecutable: path('bun-executable'),
    observerExecutable: path('startup-observer'),
    nativeExecutable: path('native-executable'),
    communityCatalogFile: path('community-catalog'),
    communityRecordStore: path('community-records'),
    communityForce: options.has('community-force'),
    portableProject: options.get('portable-project'),
    portableArtifactRoot: path('portable-artifact-root'),
    portableAdapter: options.get('portable-adapter'),
    portableObserver: path('portable-observer'),
    modernEditorRoot: path('modern-editor-root'),
    communityPreparedFile: path('community-prepared'),
    communityInputsFile: path('community-inputs'),
    communityBrowserPreparedFile: path('community-browser-prepared'),
    communityArtifactPolicy: communityPolicy as 'frozen' | 'latest',
    communityCoverageOnce: communityCoverage === 'once',
    communityOutputs: options.has('community-outputs')
      ? options
          .get('community-outputs')!
          .split(',')
          .map(value => value.trim())
      : undefined,
    communityQualificationAssetDir: path('community-qualification-assets'),
    communityQualificationProtocol: options.get('community-qualification-protocol'),
  }
}
