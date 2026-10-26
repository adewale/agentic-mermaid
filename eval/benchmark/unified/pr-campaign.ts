import { readBenchmarkDocument } from '../portable/project-records.ts'
import '../ci-policy-enforce.ts'
/** Current-head PR comparisons. Preparation is separate from sequential clocks. */
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'
import { BUILTIN_FAMILY_METADATA } from '../../../src/agent/families.ts'
import { classifyMermaidFamilyFromFirstLine } from '../../../src/family-detection.ts'
import { normalizeMermaidSource } from '../../../src/mermaid-source.ts'
import { MICRO_WORKLOADS } from '../micro-bench-cases.ts'
import { agentEditCase } from '../release-bench-fidelity.ts'
import { childCommand, entryImport } from './invocation.ts'
import { compactNativeArtifact, type NativeStorageProof, releaseNativeArtifact, restoreNativeArtifact } from './native-storage.ts'
import { withReferenceLabels } from './qualification.ts'
import type { UnifiedWorkload } from './types.ts'

export const CORE_CASE_IDS = ['flow5', 'tree50', 'seq20', 'class80', 'er40', 'state80'] as const
const CORE_DEFAULT_METRICS = ['cold', 'import', 'firstSvg', 'svg', 'svgReceipt', 'ascii', 'asciiReceipt', 'unicode', 'unicodeReceipt', 'agent'] as const
const CORE_FULL_METRICS = ['png', 'pngReceipt', 'layoutReceipt'] as const
const DRIVER = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
interface Options {
  root: string
  repo?: string
  out: string
  rounds: number
  profile: 'smoke' | 'full'
  invocationProfile: 'smoke' | 'full'
  invocationRounds: number
  prs?: number[]
  prepareOnly: boolean
  compactNative: boolean
  apiOnly?: boolean
  coreMetrics?: string[]
  extraCoreCases?: string[]
  snapshotFile?: string
  dependencyPolicy: 'strict' | 'main-overrides'
}
interface Target {
  id: string
  pr?: number
  title: string
  draft?: boolean
  head: string
  revision: string
  main: string
  root: string
  integration: 'main' | 'integrated' | 'dependency-resolved' | 'conflicting-head' | 'branch-base'
  conflicts: string[]
  sourceObjects: string[]
  sourceContract: unknown
  equivalentTo?: string
  buildStatus?: 'passed' | 'failed' | 'blocked'
  packageRoot?: string
  tarball?: string
  tarballSha256?: string
  packageBytes?: number
  packageGzipBytes?: number
  entryGzipBytes?: number
  browserBundleGzipBytes?: number
  dependencyVersions?: Record<string, string>
  emittedRuntimeIdentity?: { path: string; sha256: string }[]
  buildError?: string
  nativeStorage?: NativeStorageProof
  selectedPreparation?: { site: 'selected' | 'not-selected'; native: 'selected' | 'not-selected' }
}
interface Campaign {
  measurementDriver?: { capturedAt: string; head: string; dirty: boolean; status: string[]; xdgCacheHome?: string | null }
  measurementConfig?: {
    core: { profile: 'smoke' | 'full'; rounds: number; metrics?: string[]; extraCases?: string[]; receiptValidation?: string }
    family: { profile: 'smoke' | 'full'; rounds: number; requestedRounds?: number }
    invocation: { profile: 'smoke' | 'full'; rounds: number; status?: string }
    policy: string
  }
  installationComplete?: boolean
  preparedAt?: string
  schemaVersion: number
  frozenAt: string
  repo: string
  main: string
  driver: string
  rounds: number
  profile: 'smoke' | 'full'
  dependencyPolicy: Options['dependencyPolicy']
  apiOnly?: boolean
  coreMetrics?: string[]
  extraCoreCases?: string[]
  snapshot?: { file: string; checkedAt: string }
  openPRs: any[]
  targets: Target[]
  policy: string
}
interface CoreResult {
  extraCases?: string[]
  rows: Array<{ id: string; family: string; metric: string; status: string; samplesMs?: number[]; bytes?: number; error?: string }>
  runtime: string
  memory: unknown
}
const read = readBenchmarkDocument
const git = (root: string, args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const stamp = () => new Date().toISOString()
export function parsePrCampaignOptions(argv: string[]): Options {
  const values = new Map<string, string>()
  const flags = new Set(['prepare-only', 'run', 'compact-native', 'api-only'])
  const allowed = new Set(['root', 'repo', 'out', 'rounds', 'profile', 'invocation-profile', 'invocation-rounds', 'prs', 'dependency-policy', 'core-metrics', 'extra-core-cases', 'snapshot-file'])
  let prepareOnly = false,
    compactNative = false,
    apiOnly = false
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]!.replace(/^--/, '')
    if (!argv[i]!.startsWith('--')) throw Error(`Invalid argument ${argv[i]}`)
    if (flags.has(key)) {
      if (key === 'prepare-only') prepareOnly = true
      if (key === 'compact-native') compactNative = true
      if (key === 'api-only') apiOnly = true
      continue
    }
    const value = argv[++i]
    if (!allowed.has(key) || !value || value.startsWith('--') || values.has(key)) throw Error(`Invalid option --${key}`)
    values.set(key, value)
  }
  const rounds = Number(values.get('rounds') ?? 3),
    profile = values.get('profile') ?? 'smoke',
    invocationProfile = values.get('invocation-profile') ?? profile,
    invocationRounds = Number(values.get('invocation-rounds') ?? rounds),
    dependencyPolicy = values.get('dependency-policy') ?? 'strict',
    prs = values.get('prs')?.split(',').map(Number)
  if (!Number.isSafeInteger(rounds) || rounds < 1 || !['smoke', 'full'].includes(profile) || !['smoke', 'full'].includes(invocationProfile) || !Number.isSafeInteger(invocationRounds) || invocationRounds < 1 || !['strict', 'main-overrides'].includes(dependencyPolicy) || prs?.some(n => !Number.isSafeInteger(n) || n < 1))
    throw Error('Invalid rounds/profile/dependency-policy/PR selection')
  const coreMetrics = values.get('core-metrics')?.split(',')
  if (coreMetrics && (!coreMetrics.length || new Set(coreMetrics).size !== coreMetrics.length || coreMetrics.some(metric => ![...CORE_DEFAULT_METRICS, ...CORE_FULL_METRICS].includes(metric as any)))) throw Error('Invalid --core-metrics selection')
  const extraCoreCases = values.get('extra-core-cases')?.split(',')
  if (extraCoreCases && (new Set(extraCoreCases).size !== extraCoreCases.length || extraCoreCases.some(id => !extraCoreSource(id)))) throw Error('Invalid --extra-core-cases selection')
  return {
    apiOnly,
    coreMetrics,
    extraCoreCases,
    snapshotFile: values.get('snapshot-file') ? resolve(values.get('snapshot-file')!) : undefined,
    root: resolve(values.get('root') ?? DRIVER),
    repo: values.get('repo'),
    out: resolve(values.get('out') ?? 'bench-report/active-prs'),
    rounds,
    profile: profile as Options['profile'],
    invocationProfile: invocationProfile as Options['invocationProfile'],
    invocationRounds,
    prs,
    prepareOnly,
    compactNative,
    dependencyPolicy: dependencyPolicy as Options['dependencyPolicy'],
  }
}
async function command(command: string, args: string[], cwd: string, log: string, timeoutMs = 15 * 60_000) {
  const result = await childCommand(command, args, { cwd, timeoutMs, processGroup: true })
  writeFileSync(log, result.stdout.toString() + result.stderr)
  if (result.code !== 0) throw Error(`${command} ${args.join(' ')} exited ${result.code}; see ${log}`)
  return result
}
export function selectedCoreMetrics(options: Pick<Options, 'coreMetrics' | 'profile'>): string[] {
  return options.coreMetrics ?? [...CORE_DEFAULT_METRICS, ...(options.profile === 'full' ? CORE_FULL_METRICS : [])]
}
function extraCoreSource(id: string): string | undefined {
  if (id === 'gitGraph20') return ['gitGraph', ...Array.from({ length: 20 }, (_, i) => `  commit id: "benchmark-${i}"${i % 5 === 0 ? ` tag: "v${i / 5}"` : ''}`)].join('\n')
  return CORE_CASE_IDS.includes(id as any) ? undefined : (MICRO_WORKLOADS as Record<string, string>)[id]
}
export function frozenPrSnapshot(file: string, repo = 'adewale/agentic-mermaid') {
  const snapshot = read(file)
  if (
    !/^[a-f0-9]{40}$/.test(snapshot.main) ||
    !snapshot.checkedAt ||
    !Array.isArray(snapshot.openPRs) ||
    new Set(snapshot.openPRs.map((pr: any) => pr.number)).size !== snapshot.openPRs.length ||
    snapshot.openPRs.some((pr: any) => !Number.isSafeInteger(pr.number) || pr.number < 1 || !/^[a-f0-9]{40}$/.test(pr.headRefOid))
  )
    throw Error('Invalid frozen PR snapshot')
  return { repo, main: snapshot.main, prs: snapshot.openPRs, checkedAt: snapshot.checkedAt }
}
function metadata(root: string, repo?: string) {
  const args = repo ? ['--repo', repo] : []
  const repository = repo ?? readJsonCommand('gh', ['repo', 'view', '--json', 'nameWithOwner'], root).nameWithOwner
  const remote = execFileSync('git', ['ls-remote', `https://github.com/${repository}.git`, 'refs/heads/main'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const main = remote.split(/\s+/)[0]
  if (!main || !/^[a-f0-9]{40}$/.test(main)) throw Error('Cannot resolve exact remote main revision')
  return { repo: repository, main, prs: readJsonCommand('gh', ['pr', 'list', ...args, '--state', 'open', '--limit', '1000', '--json', 'number,title,headRefOid,baseRefName,isDraft,url,updatedAt'], root) }
}
function readJsonCommand(command: string, args: string[], cwd: string) {
  return JSON.parse(execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
}
function sourceIdentity(target: Target) {
  const paths = ['src', 'bin', 'assets', 'website/src', 'website/build.ts', 'scripts/site', 'scripts/build', 'tsup.config.ts', 'tsup.browser.config.ts', 'tsup.browser-lazy.config.ts']
  target.sourceObjects = git(target.root, ['ls-tree', '-r', '--format=%(objectname) %(path)', target.revision, '--', ...paths])
    .split('\n')
    .filter(line => line && !line.includes(' src/__tests__/'))
  const pkg = JSON.parse(git(target.root, ['show', `${target.revision}:package.json`]))
  target.sourceContract = { version: pkg.version, exports: pkg.exports, imports: pkg.imports, dependencies: pkg.dependencies, overrides: pkg.overrides, scripts: pkg.scripts, devDependencies: pkg.devDependencies }
}
/** Normal JSON three-way merge; only override conflicts may prefer frozen main. */
export function mergeBenchmarkPackage(base: any, main: any, head: any, path: string[] = []): any {
  if (equal(main, head)) return main
  if (equal(main, base)) return head
  if (equal(head, base)) return main
  const objects = [base, main, head].every(v => v === undefined || (v !== null && typeof v === 'object' && !Array.isArray(v)))
  if (!objects) {
    if (path[0] === 'overrides') return main
    throw Error(`Non-override package conflict at ${path.join('.')}`)
  }
  const out: Record<string, unknown> = {}
  for (const key of new Set([...Object.keys(base ?? {}), ...Object.keys(main ?? {}), ...Object.keys(head ?? {})])) {
    const value = mergeBenchmarkPackage(base?.[key], main?.[key], head?.[key], [...path, key])
    if (value !== undefined) out[key] = value
  }
  return out
}
function linkModules(source: string, target: string) {
  mkdirSync(target, { recursive: true })
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.name === '.cache') continue
    const src = join(source, entry.name),
      dest = join(target, entry.name)
    if ((entry.name.startsWith('@') || entry.name === '.bin') && entry.isDirectory()) {
      linkModules(src, dest)
      continue
    }
    if (existsSync(dest)) continue
    symlinkSync(src, dest, entry.isDirectory() ? 'dir' : 'file')
  }
}
async function targetDependencies(options: Options, target: Target, mainRoot: string) {
  const shared = join(mainRoot, 'node_modules')
  if (!existsSync(shared)) throw Error('Frozen main dependency installation absent')
  const own = join(target.root, 'node_modules')
  if (!existsSync(own)) linkModules(shared, own)
  const pkg = read(join(target.root, 'package.json')),
    missing = Object.entries(pkg.devDependencies ?? {}).filter(([name]) => !existsSync(join(shared, name, 'package.json')))
  if (missing.length) {
    const tools = join(options.out, 'build-tooling', target.id)
    mkdirSync(tools, { recursive: true })
    writeFileSync(join(tools, 'package.json'), JSON.stringify({ private: true, dependencies: Object.fromEntries(missing) }))
    await command('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], tools, join(options.out, `${target.id}-build-tools.log`))
    linkModules(join(tools, 'node_modules'), own)
  }
  target.dependencyVersions = {}
  for (const name of Object.keys(pkg.dependencies ?? {})) {
    const file = join(own, name, 'package.json')
    if (!existsSync(file)) throw Error(`Declared runtime dependency ${name} absent under fixed-main dependency policy`)
    target.dependencyVersions[name] = read(file).version
  }
}
async function build(options: Options, target: Target, mainRoot: string) {
  const out = join(options.out, 'builds', target.id)
  mkdirSync(out, { recursive: true })
  try {
    delete target.buildError
    await targetDependencies(options, target, mainRoot)
    target.selectedPreparation = { site: options.apiOnly ? 'not-selected' : 'selected', native: options.apiOnly ? 'not-selected' : 'selected' }
    for (const script of options.apiOnly ? ['build'] : ['build', 'website']) {
      const scripts = read(join(target.root, 'package.json')).scripts ?? {}
      if (!scripts[script]) {
        writeFileSync(join(out, `${script.replaceAll(':', '-')}.log`), 'Script unavailable on this historical target\n')
        continue
      }
      await command(process.env.BUN_BIN ?? (process.versions.bun ? process.execPath : 'bun'), ['run', script], target.root, join(out, `${script.replaceAll(':', '-')}.log`))
    }
    const native = join(target.root, 'dist/am'),
      nativeSaved = join(out, 'optional-native-am')
    if (existsSync(native)) renameSync(native, nativeSaved)
    const packDir = join(options.out, 'packages', target.id)
    mkdirSync(packDir, { recursive: true })
    const packed = await command('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', packDir], target.root, join(out, 'pack.log')),
      manifest = JSON.parse(packed.stdout.toString())[0]
    if (!manifest?.filename) throw Error('npm pack returned no archive')
    target.tarball = join(packDir, manifest.filename)
    const bytes = readFileSync(target.tarball)
    target.tarballSha256 = createHash('sha256').update(bytes).digest('hex')
    target.packageBytes = manifest.unpackedSize
    target.packageGzipBytes = bytes.length
    await command('tar', ['-xzf', target.tarball, '-C', packDir], target.root, join(out, 'extract.log'))
    target.packageRoot = join(packDir, 'package')
    linkModules(join(target.root, 'node_modules'), join(target.packageRoot, 'node_modules'))
    const index = join(target.packageRoot, 'dist/index.js')
    if (!existsSync(index)) throw Error('Packed artifact has no root API entry')
    target.entryGzipBytes = gzipSync(readFileSync(index), { level: 9 }).length
    const browserBundle = join(target.packageRoot, 'dist/browser.global.js')
    if (existsSync(browserBundle)) target.browserBundleGzipBytes = gzipSync(readFileSync(browserBundle), { level: 9 }).length
    target.buildStatus = 'passed'
    if (existsSync(nativeSaved)) renameSync(nativeSaved, native)
    else if (!options.apiOnly && read(join(target.root, 'package.json')).scripts?.['build:binary']) {
      try {
        await command(process.env.BUN_BIN ?? (process.versions.bun ? process.execPath : 'bun'), ['run', 'build:binary'], target.root, join(out, 'build-binary.log'))
      } catch (error) {
        writeFileSync(join(out, 'binary-unavailable.log'), String(error))
      }
    }
  } catch (error) {
    target.buildStatus = 'failed'
    target.buildError = String(error)
  }
}
export async function preparePrCampaign(options: Options): Promise<Campaign> {
  mkdirSync(options.out, { recursive: true })
  const file = join(options.out, 'campaign.json')
  let campaign: Campaign
  if (existsSync(file)) {
    campaign = read(file) as Campaign
    if (campaign.rounds !== options.rounds || campaign.profile !== options.profile || campaign.dependencyPolicy !== options.dependencyPolicy || !!campaign.apiOnly !== !!options.apiOnly || !equal(campaign.coreMetrics, options.coreMetrics) || !equal(campaign.extraCoreCases, options.extraCoreCases))
      throw Error('Existing immutable campaign profile differs; choose another --out or reuse its original options')
    if (campaign.preparedAt && campaign.targets.every(target => target.buildStatus !== 'passed' || (!!target.packageRoot && existsSync(join(target.packageRoot, 'dist/index.js'))))) return campaign
  } else {
    const frozen = options.snapshotFile ? frozenPrSnapshot(options.snapshotFile, options.repo) : metadata(options.root, options.repo),
      prs = frozen.prs.filter((pr: any) => !options.prs || options.prs.includes(pr.number))
    if (options.prs?.some(n => !prs.some((pr: any) => pr.number === n))) throw Error('A requested PR is not currently open')
    const prefix = `refs/benchmark/unified/${Date.now()}`
    git(options.root, ['fetch', 'origin', `${frozen.main}:${prefix}/main`])
    const mainRoot = join(options.out, 'worktrees/main')
    mkdirSync(dirname(mainRoot), { recursive: true })
    git(options.root, ['worktree', 'add', '--detach', mainRoot, frozen.main])
    const main: Target = { id: 'main', title: 'Frozen main', head: frozen.main, revision: frozen.main, main: frozen.main, root: mainRoot, integration: 'main', conflicts: [], sourceObjects: [], sourceContract: {} }
    campaign = {
      schemaVersion: 1,
      apiOnly: !!options.apiOnly,
      coreMetrics: options.coreMetrics,
      extraCoreCases: options.extraCoreCases,
      snapshot: options.snapshotFile ? { file: options.snapshotFile, checkedAt: (frozen as any).checkedAt } : undefined,
      frozenAt: stamp(),
      repo: frozen.repo,
      main: frozen.main,
      driver: git(options.root, ['rev-parse', 'HEAD']),
      rounds: options.rounds,
      profile: options.profile,
      dependencyPolicy: options.dependencyPolicy,
      openPRs: prs,
      targets: [main],
      policy:
        (options.apiOnly ? 'Explicit API-only profile: canonical library build and npm pack; site/native builds and broad invocation are not selected. ' : 'Canonical per-target build/site and npm packs; optional native binary built separately after packing. ') +
        'Current open heads and main frozen before preparation. Runtime dependencies use one frozen-main installation. Timing jobs execute sequentially with paired same-main controls. Source identities use Git object IDs; only compiled/shipped archive bytes are hashed. Source conflicts are measured as heads plus own bases, excluded from current-main integration rank. No merge-readiness claim.',
    }
    writeFileSync(file, JSON.stringify(campaign, null, 2))
  }
  const frozen = { main: campaign.main },
    prs = campaign.openPRs,
    prefix = `refs/benchmark/unified/resume-${Date.now()}`,
    mainRoot = campaign.targets.find(target => target.id === 'main')!.root
  if (!campaign.installationComplete) {
    await command(process.env.BUN_BIN ?? (process.versions.bun ? process.execPath : 'bun'), ['install', '--frozen-lockfile'], mainRoot, join(options.out, 'main-install.log'))
    campaign.installationComplete = true
    writeFileSync(file, JSON.stringify(campaign, null, 2))
  }
  for (const pr of prs) {
    if (campaign.targets.some(target => target.id === `pr-${pr.number}`)) continue
    git(options.root, ['fetch', 'origin', `${pr.headRefOid}:${prefix}/pr${pr.number}`])
    const root = join(options.out, `worktrees/pr-${pr.number}`)
    git(options.root, ['worktree', 'add', '--detach', root, frozen.main])
    let integration: Target['integration'] = 'integrated',
      revision = pr.headRefOid,
      conflicts: string[] = []
    try {
      git(root, ['-c', 'user.name=Benchmark', '-c', 'user.email=benchmark@localhost', 'merge', '--no-commit', '--no-ff', pr.headRefOid])
    } catch {
      conflicts = git(root, ['diff', '--name-only', '--diff-filter=U']).split('\n').filter(Boolean)
    }
    if (conflicts.length && options.dependencyPolicy === 'main-overrides' && conflicts.every(p => ['package.json', 'bun.lock'].includes(p))) {
      try {
        const base = git(root, ['merge-base', frozen.main, pr.headRefOid]),
          basePkg = JSON.parse(git(root, ['show', `${base}:package.json`])),
          mainPkg = JSON.parse(git(root, ['show', `${frozen.main}:package.json`])),
          headPkg = JSON.parse(git(root, ['show', `${pr.headRefOid}:package.json`])),
          merged = mergeBenchmarkPackage(basePkg, mainPkg, headPkg)
        if (!equal(merged.dependencies, mainPkg.dependencies)) throw Error('Runtime dependencies changed; fixed-main lock cannot silently resolve them')
        writeFileSync(join(root, 'package.json'), JSON.stringify(merged, null, 2) + '\n')
        if (conflicts.includes('bun.lock')) writeFileSync(join(root, 'bun.lock'), git(root, ['show', `${frozen.main}:bun.lock`]) + '\n')
        git(root, ['add', 'package.json', 'bun.lock'])
        conflicts = []
        integration = 'dependency-resolved'
      } catch {
        /* Retain the source-conflict ledger; never guess at non-override changes. */
      }
    }
    if (conflicts.length) {
      git(root, ['merge', '--abort'])
      git(root, ['checkout', '--detach', pr.headRefOid])
      integration = 'conflicting-head'
    } else {
      try {
        git(root, ['rev-parse', '--verify', 'MERGE_HEAD'])
        git(root, ['-c', 'user.name=Benchmark', '-c', 'user.email=benchmark@localhost', 'commit', '--no-verify', '-m', `Local benchmark PR${pr.number} into ${frozen.main.slice(0, 12)}`])
      } catch {
        /* Already an ancestor produces no synthetic merge. */
      }
      revision = git(root, ['rev-parse', 'HEAD'])
    }
    const target: Target = { id: `pr-${pr.number}`, pr: pr.number, title: pr.title, draft: pr.isDraft, head: pr.headRefOid, revision, main: frozen.main, root, integration, conflicts, sourceObjects: [], sourceContract: {} }
    campaign.targets.push(target)
    if (integration === 'conflicting-head') {
      const base = git(root, ['merge-base', frozen.main, pr.headRefOid]),
        baseRoot = join(options.out, `worktrees/base-${pr.number}`)
      git(options.root, ['worktree', 'add', '--detach', baseRoot, base])
      campaign.targets.push({ id: `base-${pr.number}`, pr: pr.number, title: `Own base of PR${pr.number}`, head: base, revision: base, main: frozen.main, root: baseRoot, integration: 'branch-base', conflicts: [], sourceObjects: [], sourceContract: {} })
    }
    writeFileSync(file, JSON.stringify(campaign, null, 2))
  }
  for (const target of campaign.targets) {
    if (target.buildStatus === 'passed' && target.packageRoot && existsSync(join(target.packageRoot, 'dist/index.js'))) continue
    sourceIdentity(target)
    target.equivalentTo = campaign.targets.find(prior => prior !== target && campaign.targets.indexOf(prior) < campaign.targets.indexOf(target) && equal(prior.sourceObjects, target.sourceObjects) && equal(prior.sourceContract, target.sourceContract))?.id
    console.log(`prepare ${target.id}: ${target.integration}${target.equivalentTo ? ' equivalent to ' + target.equivalentTo : ''}`)
    await build(options, target, mainRoot)
    writeFileSync(file, JSON.stringify(campaign, null, 2))
  }
  campaign.preparedAt = stamp()
  writeFileSync(file, JSON.stringify(campaign, null, 2))
  return campaign
}

export const PR_CORE_WORKER = `import fs from 'node:fs';import{pathToFileURL}from'node:url';
const job=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const rows=[],encode=new TextEncoder(),selected=new Set(job.metrics);
const coldStart=performance.now(),api=await import(pathToFileURL(job.index)),importMs=performance.now()-coldStart;
const firstStart=performance.now(),firstSvg=api.renderMermaidSVG(job.workloads[0].source),firstBytes=encode.encode(firstSvg),firstMs=performance.now()-firstStart,processStartupToFirstArtifactMs=performance.now();globalThis.__coldSink=firstBytes;
const{qualifyOutput}=await import(pathToFileURL(job.qualifier));let renderAgentEdit,agentEditCase;if(selected.has('agent'))({renderAgentEdit,agentEditCase}=await import(pathToFileURL(job.workflow)));const{assertInvocationReceipt}=await import(pathToFileURL(job.receiptValidator));
const coldQualification=qualifyOutput(job.workloads[0],firstSvg,'svg');for(const[metric,ms]of[['cold',importMs+firstMs],['import',importMs],['firstSvg',firstMs]])if(selected.has(metric))rows.push({id:'cold:first-svg',family:job.workloads[0].family,metric,status:coldQualification.ok?'passed':'failed',samplesMs:[ms],bytes:firstBytes.length,importMs,firstMs,processStartupToFirstArtifactMs,phase:'fresh-root-import-first-consumed-svg',error:coldQualification.findings.join('; ')});
let agent={};if(job.metrics.some(m=>['agent','png','pngReceipt','layoutReceipt'].includes(m)))try{agent=await import(pathToFileURL(job.agent))}catch{};
const definitions=[['svg','svg',api.renderMermaidSVG],['svgReceipt','svg',api.renderMermaidSVGWithReceipt],['ascii','ascii',s=>api.renderMermaidASCII(s,{useAscii:true,colorMode:'none'})],['asciiReceipt','ascii',s=>api.renderMermaidASCIIWithReceipt(s,{useAscii:true,colorMode:'none'})],['unicode','unicode',s=>api.renderMermaidASCII(s,{useAscii:false,colorMode:'none'})],['unicodeReceipt','unicode',s=>api.renderMermaidASCIIWithReceipt(s,{useAscii:false,colorMode:'none'})],...(job.metrics.some(m=>['png','pngReceipt','layoutReceipt'].includes(m))?[['png','png',agent.renderMermaidPNG],['pngReceipt','png',agent.renderMermaidPNGWithReceipt],['layoutReceipt','layout',agent.layoutMermaidWithReceipt]]:[])];
const consume=(value,receiptRequired=false,format)=>{if(receiptRequired&&job.receiptValidation!=='pre-post-outside-clocks')assertInvocationReceipt(value?.receipt,format);const artifact=value?.svg??value?.text??value?.png??value?.layout??value;const bytes=artifact instanceof Uint8Array?artifact:encode.encode(typeof artifact==='string'?artifact:JSON.stringify(artifact));const receipt=value?.receipt?encode.encode(JSON.stringify(value.receipt)):undefined;globalThis.__coreSink=[bytes,receipt];return{artifact,receipt:value?.receipt,bytes:bytes.length+(receipt?.length??0)}};
async function measure(w,metric,format,fn){const row={id:w.id,family:w.family,metric,status:'passed'};try{if(typeof fn!=='function'){row.status='unsupported';row.error='Public API unavailable';rows.push(row);return}let value=consume(await fn(w.source),metric.endsWith('Receipt'),format);if(metric.endsWith('Receipt')&&job.receiptValidation==='pre-post-outside-clocks')assertInvocationReceipt(value.receipt,format);let check=qualifyOutput(w,value.artifact,format);if(!check.ok)throw Error(check.findings.join('; '));let n=0,start=performance.now();do{value=consume(await fn(w.source),metric.endsWith('Receipt'),format);n++}while(n<3||performance.now()-start<75);const per=(performance.now()-start)/n,iterations=Math.max(1,Math.min(256,Math.ceil(15/Math.max(.001,per))));row.samplesMs=[];for(let sample=0;sample<5;sample++){start=performance.now();for(let i=0;i<iterations;i++)value=consume(await fn(w.source),metric.endsWith('Receipt'),format);row.samplesMs.push((performance.now()-start)/iterations)}if(metric.endsWith('Receipt')&&job.receiptValidation==='pre-post-outside-clocks')assertInvocationReceipt(value.receipt,format);check=qualifyOutput(w,value.artifact,format);if(!check.ok)throw Error(check.findings.join('; '));row.bytes=value.bytes;row.iterations=iterations;row.qualification=check.scope}catch(error){row.status='failed';row.error=String(error)}rows.push(row)}
for(const[metric,format,fn]of definitions)if(selected.has(metric))for(const w of job.workloads)if(!job.extraCases.includes(w.id)||['svg','svgReceipt'].includes(metric))await measure(w,metric,format,fn);
if(selected.has('agent'))await measure({...agentEditCase,expectedLabels:agentEditCase.expectedSvgLabels,features:['verified-edit-workflow'],provenance:'existing release benchmark agent edit case'},'agent','svg',source=>renderAgentEdit(agent,source));
globalThis.gc?.();fs.writeFileSync(job.out,JSON.stringify({runtime:process.version,selectedMetrics:job.metrics,receiptValidation:job.receiptValidation??'includes-external-receipt-validation',coreCases:job.coreCases,extraCases:job.extraCases,rows,memory:{...process.memoryUsage(),peakRssBytes:process.resourceUsage().maxRSS*1024},policy:'Fresh Node worker; root import plus first UTF8-consumed SVG recorded before native agent/PNG and qualification modules load; excludes process startup and cold-filesystem guarantees. Warm metrics: at least3 calls and75ms warm-up;5 calibrated samplemeans targeting15ms. Receipt cases include JSON/UTF8 consumption. Receipt validation clock placement is declared separately in receiptValidation; default historical full calls include external receipt validation. Six fixed inputs across five families; all six are used for each terminal portfolio (community terminal uses a different three-input cohort). Plain and receipt clocks both consume output UTF8; receipt clocks additionally serialize receipts. This differs from community API-return clocks and raw medians must not be mixed. Paired same-source controls bracket every candidate.'},null,2));`
interface CoreJob {
  key: string
  target: string
  reference: string
  round: number
  cache: string
  before: string
  candidate: string
  after: string
  status: 'passed' | 'failed'
  finishedAt: string
}
const med = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.length % 2 ? sorted[(sorted.length - 1) / 2]! : ((sorted[sorted.length / 2 - 1] ?? 0) + (sorted[sorted.length / 2] ?? 0)) / 2
}
export function completePrControlRounds(evidence: Array<{ key: string; round: number }>, rounds: number): boolean {
  return evidence.length > 0 && new Set(evidence.map(row => row.key)).size === evidence.length && evidence.every(row => Number.isSafeInteger(row.round) && row.round >= 1 && row.round <= rounds) && new Set(evidence.map(row => row.round)).size === rounds
}
export function prCorePortfolio(result: CoreResult, metric: string, caseIds: readonly string[] = CORE_CASE_IDS): number | undefined {
  const metricRows = result.rows.filter(row => row.metric === metric)
  const isPortfolio = !['cold', 'import', 'firstSvg', 'agent'].includes(metric)
  if (isPortfolio && metricRows.some(row => ![...CORE_CASE_IDS, ...(result.extraCases ?? [])].includes(row.id as any))) return undefined
  const rows = metricRows.filter(row => !isPortfolio || caseIds.includes(row.id))
  const expected: readonly string[] = metric === 'agent' ? [agentEditCase.id] : ['cold', 'import', 'firstSvg'].includes(metric) ? ['cold:first-svg'] : caseIds
  if (rows.length !== expected.length || new Set(rows.map(row => row.id)).size !== expected.length || expected.some(id => !rows.some(row => row.id === id)) || rows.some(row => row.status !== 'passed' || !row.samplesMs?.length || row.samplesMs.some(value => !Number.isFinite(value) || value <= 0))) return undefined
  return rows.reduce((sum, row) => sum + med(row.samplesMs!), 0)
}
async function coreJob(options: Options, campaign: Campaign, target: Target, reference: Target, round: number, cache: string, worker: string, workloads: UnifiedWorkload[]): Promise<CoreJob> {
  const dir = join(options.out, 'core', `${target.id}-r${round}-cache${cache}`)
  mkdirSync(dir, { recursive: true })
  const completed = join(dir, 'complete.json')
  // Timing evidence is never automatically reused across campaign invocations.
  // Keep earlier attempt directories as immutable evidence; this run starts fresh.
  const attempt = join(dir, `attempt-${Date.now()}`)
  mkdirSync(attempt, { recursive: true })
  const run = async (t: Target, role: string) => {
    const out = join(attempt, `${role}.json`),
      job = join(attempt, `${role}.job.json`)
    rmSync(out, { force: true })
    writeFileSync(
      job,
      JSON.stringify({
        index: join(t.packageRoot!, 'dist/index.js'),
        agent: join(t.packageRoot!, existsSync(join(t.packageRoot!, 'dist/agent.js')) ? 'dist/agent.js' : 'dist/agent-core.js'),
        qualifier: join(options.root, 'eval/benchmark/unified/qualification.ts'),
        workflow: join(options.root, 'eval/benchmark/release-bench-fidelity.ts'),
        receiptValidator: join(options.root, 'eval/benchmark/unified/invocation-receipt.ts'),
        workloads,
        full: options.profile === 'full',
        metrics: selectedCoreMetrics(options),
        receiptValidation: options.apiOnly ? 'pre-post-outside-clocks' : 'includes-external-receipt-validation',
        coreCases: CORE_CASE_IDS,
        extraCases: options.extraCoreCases ?? [],
        out,
      }),
    )
    const result = await childCommand('node', ['--expose-gc', worker, job], { cwd: t.packageRoot!, timeoutMs: 10 * 60_000, processGroup: true, env: { ...process.env, AGENTIC_MERMAID_ELK_CACHE: cache, AGENTIC_MERMAID_SCENE_ASSERTIONS: '0', AGENTIC_MERMAID_EXPERIMENTS: '' } })
    writeFileSync(join(attempt, `${role}.log`), result.stderr)
    return { out, code: result.code }
  }
  const before = await run(reference, 'control-before'),
    candidate = await run(target, 'candidate'),
    after = await run(reference, 'control-after'),
    job: CoreJob = { key: `${target.id}:${round}:${cache}`, target: target.id, reference: reference.id, round, cache, before: before.out, candidate: candidate.out, after: after.out, status: [before, candidate, after].every(r => r.code === 0 && existsSync(r.out)) ? 'passed' : 'failed', finishedAt: stamp() }
  writeFileSync(completed, JSON.stringify(job, null, 2))
  return job
}
function reportCampaign(options: Options, campaign: Campaign, jobs: CoreJob[], coverage: any[]) {
  const records: any[] = []
  for (const target of campaign.targets) {
    const evidenceTarget = target.equivalentTo ?? target.id,
      own = jobs.filter(job => job.target === evidenceTarget),
      isControl = evidenceTarget === 'main' || target.integration === 'branch-base'
    const metrics = new Set<string>(own.flatMap(job => (existsSync(job.candidate) ? (read(job.candidate) as CoreResult).rows.map(row => row.metric) : [])))
    for (const metric of selectedCoreMetrics(options)) metrics.add(metric)
    if (isControl) for (const job of jobs) if (job.reference === evidenceTarget && existsSync(job.before)) for (const row of (read(job.before) as CoreResult).rows) metrics.add(row.metric)
    for (const cache of options.profile === 'full' ? ['1', '0'] : ['1'])
      for (const selection of [...metrics].flatMap(metric => [{ metric, caseId: undefined as string | undefined }, ...(['svg', 'svgReceipt'].includes(metric) ? (options.extraCoreCases ?? []).map(caseId => ({ metric, caseId })) : [])])) {
        const { metric, caseId } = selection,
          portfolio = (result: CoreResult) => prCorePortfolio(result, metric, caseId ? [caseId] : CORE_CASE_IDS)
        const selected = own.filter(job => job.cache === cache),
          samples: number[] = [],
          ratios: number[] = [],
          controls: number[] = [],
          admittedRounds: Array<{ key: string; round: number }> = [],
          errors: string[] = []
        if (isControl)
          for (const job of jobs.filter(job => job.reference === evidenceTarget && job.cache === cache)) {
            const before = existsSync(job.before) ? portfolio(read(job.before)) : undefined,
              after = existsSync(job.after) ? portfolio(read(job.after)) : undefined
            if (before !== undefined && after !== undefined) {
              samples.push((before + after) / 2)
              ratios.push(1)
              controls.push(after / before)
              admittedRounds.push({ key: job.key, round: job.round })
            }
          }
        else
          for (const job of selected) {
            if (job.status !== 'passed') {
              errors.push('Worker process failed')
              continue
            }
            const before = portfolio(read(job.before)),
              candidate = portfolio(read(job.candidate)),
              after = portfolio(read(job.after))
            if (before === undefined || candidate === undefined || after === undefined) {
              errors.push(...(read(job.candidate) as CoreResult).rows.filter(row => row.metric === metric && row.status !== 'passed').map(row => `${row.id}: ${row.error ?? row.status}`))
              if (!errors.length) errors.push('Reference or candidate portfolio did not qualify')
              continue
            }
            samples.push(candidate)
            ratios.push(candidate / Math.sqrt(before * after))
            controls.push(after / before)
            admittedRounds.push({ key: job.key, round: job.round })
          }
        const complete = target.buildStatus === 'passed' && samples.length > 0 && completePrControlRounds(admittedRounds, options.rounds) && (isControl || samples.length === options.rounds),
          band = { low: Math.min(0.97, 1, ...controls, ...controls.map(r => 1 / r)), high: Math.max(1.03, 1, ...controls, ...controls.map(r => 1 / r)) },
          ratio = complete ? med(ratios) : undefined
        records.push({
          target: target.id,
          caseId,
          sourceEvidence: evidenceTarget,
          integration: target.integration,
          metric,
          cache,
          status: complete ? 'passed' : 'unavailable',
          medianMs: complete ? med(samples) : null,
          observedMs: samples,
          pairedRatio: ratio ?? null,
          controlRatios: controls,
          decisionBand: band,
          classification: !complete ? 'unavailable' : target.equivalentTo ? 'same production source' : ratio! < band.low ? 'lower observed cost' : ratio! > band.high ? 'higher observed cost' : 'within observed variation',
          errors,
        })
      }
  }
  const report = {
    schemaVersion: 1,
    createdAt: stamp(),
    frozenAt: campaign.frozenAt,
    main: campaign.main,
    targets: campaign.targets,
    measurementDriver: campaign.measurementDriver,
    measurementConfig: campaign.measurementConfig,
    core: records.filter(row => !row.caseId),
    extraCore: records.filter(row => row.caseId),
    selectedCoreMetrics: selectedCoreMetrics(options),
    extraCoreCases: options.extraCoreCases ?? [],
    apiOnly: !!options.apiOnly,
    coverage,
    jobs,
    policy: campaign.policy,
    notes: [
      'Only matching core metric/input portfolios have paired ranks. Main A/A before/after ranges are observed variation, not confidence intervals; decision bands include reciprocals and a3% practical floor.',
      'Source-equivalent docs/test changes reuse only core-renderer timing evidence; broad family/invocation suites execute every actual candidate, and package footprints remain separate.',
      'Conflicting old heads and own bases are exploratory, never presented as an integration benefit on current main.',
      'Family/transport broad coverage and fixed-core latency have different scopes; they are never multiplied into an invented overall score.',
      ...(options.apiOnly ? ['Explicit API-only selection omits site/native builds and transport invocation; family functionality at the declared campaign profile remains selected. Only declared core metrics execute. Supplemental case records are outside the six-input aggregate.'] : []),
      `Resolved measurement coverage: core ${options.profile}/${options.rounds} rounds; family ${options.profile}/${options.apiOnly ? 'one functionality pass' : `${options.rounds} requested rounds`}; invocation ${options.apiOnly ? 'not selected (API-only)' : `${options.invocationProfile}/${options.invocationRounds} rounds`}. Invocation overrides are intentional independent coverage cost choices, never hidden downsampling.`,
      'Prepared artifacts may be reused, but every campaign invocation reruns all measurements; old timing and broad-suite results are never admitted through existence-only resume checks.',
      `Receipt validation protocol: ${options.apiOnly ? 'first/final external validation excluded from measured calls' : 'includes external receipt validation in measured receipt calls (historical full protocol)'}.`,
      'Core plain APIs include output UTF8 consumption. Receipt APIs additionally include receipt JSON. Six terminal inputs differ from community three-input terminal cohort; raw cross-protocol medians cannot be mixed.',
    ],
  }
  writeFileSync(join(options.out, 'scores.json'), JSON.stringify(report, null, 2) + '\n')
  const rankView = {
    ...report,
    units: { medianMs: 'milliseconds per matched portfolio', packageGzipBytes: 'actual npm tarball bytes', browserBundleGzipBytes: 'gzip level9 of complete shipped IIFE JS; excludes separately loaded fonts/network' },
    protocols: {
      coreCases: [...CORE_CASE_IDS],
      families: 5,
      agentCases: selectedCoreMetrics(options).includes('agent') ? [agentEditCase.id] : [],
      selectedMetrics: selectedCoreMetrics(options),
      receiptValidation: options.apiOnly ? 'pre-post-outside-clocks' : 'includes-external-receipt-validation',
      supplementalCases: options.extraCoreCases ?? [],
      cache: '1 = explicit repeated-input result reuse;0 = result-cache flag off; other default caches retain artifact policy',
      paired: 'candidate / geometric mean of fresh same-source controls before and after; median over paired rounds',
    },
    ranks: campaign.targets.map(target => ({
      id: target.id,
      label: target.pr ? `PR #${target.pr}` : target.title,
      head: target.head,
      sourceRevision: target.revision,
      integration: target.integration,
      draft: !!target.draft,
      sourceEvidence: target.equivalentTo ?? target.id,
      buildStatus: target.buildStatus,
      buildError: target.buildError,
      artifact: { tarball: target.tarball, sha256: target.tarballSha256 },
      packageGzipBytes: target.packageGzipBytes,
      browserBundleGzipBytes: target.browserBundleGzipBytes,
      entryGzipBytes: target.entryGzipBytes,
      metrics: Object.fromEntries(records.filter(row => !row.caseId && row.target === target.id && row.cache === '1').map(row => [row.metric, row])),
      metricsByCache: Object.fromEntries(['1', '0'].map(cache => [cache, Object.fromEntries(records.filter(row => !row.caseId && row.target === target.id && row.cache === cache).map(row => [row.metric, row]))])),
      coverage: coverage.filter(row => row.target === target.id),
    })),
  }
  writeFileSync(join(options.out, 'pr-ranks.json'), JSON.stringify(rankView, null, 2) + '\n')

  const lines = [
    '# Active PR benchmark stack ranks',
    '',
    `Frozen ${campaign.frozenAt}; main \`${campaign.main}\`. Core ${options.profile}, ${options.rounds} rounds; family ${options.profile}, ${options.apiOnly ? 'one functionality pass' : `${options.rounds} requested rounds`}; invocation ${options.apiOnly ? 'not selected (API-only)' : `${options.invocationProfile}, ${options.invocationRounds} rounds`}.`,
    `Measurement driver \`${campaign.measurementDriver?.head ?? 'unrecorded'}\`; dirty: ${campaign.measurementDriver?.dirty ?? 'unrecorded'}. Preparation driver remains separately recorded.`,
    '',
    campaign.policy,
    '',
    '## Current-main integrations · default repeated-input SVG',
    '',
    '| Candidate | SVG batch | Paired ratio | Interpretation | Package tarball |',
    '|---|---:|---:|---|---:|',
  ]
  const primary = records.filter(row => !row.caseId && row.metric === 'svg' && row.cache === '1' && !['conflicting-head', 'branch-base'].includes(row.integration)).sort((a, b) => (a.pairedRatio ?? Infinity) - (b.pairedRatio ?? Infinity))
  for (const row of primary) {
    const target = campaign.targets.find(t => t.id === row.target)!
    lines.push(`| ${row.target}${target.draft ? ' (draft)' : ''} | ${row.medianMs?.toFixed(2) ?? 'unavailable'} ms | ${row.pairedRatio?.toFixed(3) ?? '—'}× | ${row.classification} | ${target.packageGzipBytes ? (target.packageGzipBytes / 1024).toFixed(1) + ' KiB' : 'unavailable'} |`)
  }
  for (const metric of [...new Set(records.map(row => row.metric))].filter(metric => metric !== 'svg')) {
    lines.push('', `## ${metric} · default repeated inputs`, '', '| Candidate | Portfolio ms | Paired ratio | Interpretation |', '|---|---:|---:|---|')
    for (const row of records.filter(row => !row.caseId && row.metric === metric && row.cache === '1' && !['conflicting-head', 'branch-base'].includes(row.integration)).sort((a, b) => (a.pairedRatio ?? Infinity) - (b.pairedRatio ?? Infinity)))
      lines.push(`| ${row.target} | ${row.medianMs?.toFixed(2) ?? 'unavailable'} | ${row.pairedRatio?.toFixed(3) ?? '—'}× | ${row.classification} |`)
  }
  lines.push('', '## Every frozen target', '', '| Candidate | PR head | Measured source | Integration | Build | Runtime equivalence |', '|---|---|---|---|---|---|')
  for (const target of campaign.targets) lines.push(`| ${target.id} | \`${target.head}\` | \`${target.revision}\` | ${target.integration} | ${target.buildStatus ?? 'unprepared'}${target.buildError ? ': ' + target.buildError.replaceAll('|', '/') : ''} | ${target.equivalentTo ?? 'independent source'} |`)
  lines.push('', '## Broad family and invocation results', '', '| Candidate | Suite | Profile / rounds | Status | Passed / measured observations |', '|---|---|---|---|---|')
  for (const result of coverage) lines.push(`| ${result.target} | ${result.suite} | ${result.profile} / ${result.rounds} | ${result.status} | ${result.passed ?? 0} / ${result.total ?? 0}${result.sharedWith ? ' (shared with ' + result.sharedWith + ')' : ''} |`)
  lines.push(
    '',
    '## Exploratory conflicting heads and bases',
    '',
    'Their per-metric observations and paired own-base ratios are retained in `scores.json`. No current-main rank is assigned.',
    '',
    ...(options.extraCoreCases?.length
      ? [
          '## Supplemental cases (outside six-core aggregate)',
          '',
          '| Candidate | Case | Metric | Cache | ms | Paired ratio |',
          '|---|---|---|---|---:|---:|',
          ...records.filter(row => row.caseId).map(row => `| ${row.target} | ${row.caseId} | ${row.metric} | ${row.cache} | ${row.medianMs?.toFixed(3) ?? 'unavailable'} | ${row.pairedRatio?.toFixed(3) ?? '—'} |`),
          '',
        ]
      : []),
    ...report.notes.map(note => '- ' + note),
    '',
    'Full errors, output qualification and declared gaps remain in per-target raw artifacts. No PR is certified merge-ready by these timings.',
    '',
  )
  writeFileSync(join(options.out, 'STACK-RANK.md'), lines.join('\n'))
}
export function revalidatePrCampaign(options: Pick<Options, 'out'>, campaign: Campaign) {
  // Preparation may have been resumed after the harness was improved. Revalidate
  // the actual emitted runtime bytes before reusing only core timing evidence.
  for (const target of campaign.targets) {
    sourceIdentity(target)
    target.emittedRuntimeIdentity = []
    if (target.packageRoot && target.buildStatus === 'passed') {
      const dist = join(target.packageRoot, 'dist')
      // Public entries may import shared chunks. Bind the emitted closure,
      // including browser/WASM bytes, before sharing core observations.
      const visit = (directory: string, prefix: string) => {
        for (const file of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
          const path = prefix + file.name
          if (file.isDirectory()) visit(join(directory, file.name), path + '/')
          else if (file.isFile() && /\.(?:[cm]?js|wasm)$/.test(file.name))
            target.emittedRuntimeIdentity!.push({
              path,
              sha256: createHash('sha256')
                .update(readFileSync(join(directory, file.name)))
                .digest('hex'),
            })
        }
      }
      if (!existsSync(dist)) throw Error(`Prepared target ${target.id} has no shipped dist directory`)
      visit(dist, 'dist/')
    }
    target.equivalentTo = campaign.targets.find(
      prior =>
        prior !== target &&
        campaign.targets.indexOf(prior) < campaign.targets.indexOf(target) &&
        prior.buildStatus === 'passed' &&
        target.buildStatus === 'passed' &&
        equal(prior.sourceObjects, target.sourceObjects) &&
        equal(prior.sourceContract, target.sourceContract) &&
        equal(prior.emittedRuntimeIdentity, target.emittedRuntimeIdentity),
    )?.id
  }
  writeFileSync(join(options.out, 'campaign.json'), JSON.stringify(campaign, null, 2))
}
export async function runPrCampaign(options: Options, campaign: Campaign) {
  const driverStatus = git(options.root, ['status', '--porcelain=v1', '--untracked-files=all']).split('\n').filter(Boolean)
  campaign.measurementDriver = { capturedAt: stamp(), head: git(options.root, ['rev-parse', 'HEAD']), dirty: driverStatus.length > 0, status: driverStatus, xdgCacheHome: process.env.XDG_CACHE_HOME ?? null }
  campaign.measurementConfig = {
    core: { profile: options.profile, rounds: options.rounds, metrics: selectedCoreMetrics(options), extraCases: options.extraCoreCases ?? [], receiptValidation: options.apiOnly ? 'pre-post-outside-clocks' : 'includes-external-receipt-validation' },
    family: { profile: options.profile, rounds: options.apiOnly ? 1 : options.rounds, ...(options.apiOnly ? { requestedRounds: options.rounds } : {}) },
    invocation: { profile: options.invocationProfile, rounds: options.apiOnly ? 0 : options.invocationRounds, status: options.apiOnly ? 'not-selected' : 'selected' },
    policy: options.apiOnly
      ? 'Explicit API-only: invocation/site/native not selected. Family functionality executes one pass at the declared profile; core performance preserves the requested rounds and selected metrics. Requested family rounds are retained separately from actual pass count.'
      : 'Core/family preserve campaign profile and rounds; only broad invocation uses explicit independent overrides. All admitted family representatives and actual runtimes/transports remain enrolled according to the selected invocation profile.',
  }
  revalidatePrCampaign(options, campaign)
  const main = campaign.targets.find(target => target.id === 'main')!,
    qualified = [main, ...campaign.targets.filter(target => target.buildStatus === 'passed' && !target.equivalentTo && target.id !== 'main' && target.integration !== 'branch-base')],
    coreDir = join(options.out, 'core')
  mkdirSync(coreDir, { recursive: true })
  const worker = join(coreDir, 'worker.mjs')
  writeFileSync(worker, PR_CORE_WORKER)
  const ids = [...CORE_CASE_IDS, ...(options.extraCoreCases ?? [])],
    workloads: UnifiedWorkload[] = ids.map(id => {
      const source = (MICRO_WORKLOADS as Record<string, string>)[id] ?? extraCoreSource(id)!,
        classification = classifyMermaidFamilyFromFirstLine(normalizeMermaidSource(source).firstLine)
      if (classification.kind !== 'registered') throw Error(`Unregistered core case ${id}`)
      return { id, family: classification.familyId, source, features: ['fixed-core-performance'], provenance: id === 'gitGraph20' ? 'authored twenty-commit/four-tag GitGraph supplemental case; separate from six-core aggregate' : 'eval/benchmark/micro-bench-cases.ts' }
    }),
    enriched = await withReferenceLabels(workloads, { root: options.root })
  writeFileSync(join(options.out, 'core-inputs.json'), JSON.stringify(enriched, null, 2))
  const jobs: CoreJob[] = [],
    coverage: any[] = []
  if (main.buildStatus === 'passed')
    for (let round = 1; round <= options.rounds; round++)
      for (const cache of options.profile === 'full' ? ['1', '0'] : ['1'])
        for (const target of round % 2 ? qualified : [...qualified].reverse()) {
          const reference = target.integration === 'conflicting-head' ? campaign.targets.find(t => t.id === `base-${target.pr}`) : main
          if (!reference || reference.buildStatus !== 'passed') continue
          console.log(`core ${target.id} round${round} cache${cache} vs${reference.id}`)
          jobs.push(await coreJob(options, campaign, target, reference, round, cache, worker, enriched.workloads))
          reportCampaign(options, campaign, jobs, coverage)
        }
  // Broad suites run after all core clocks. Each target/suite gets its own process.
  for (const target of campaign.targets) {
    if (target.buildStatus !== 'passed') continue
    if (options.apiOnly) coverage.push({ target: target.id, suite: 'invocation', status: 'not-selected', profile: options.invocationProfile, rounds: 0, reason: 'Explicit --api-only; no site/native/transport invocation selection' })
    for (const suite of options.apiOnly ? ['family'] : ['family', 'invocation']) {
      // Storage preparation is outside the fresh invocation subprocess and
      // its clocks. The restored executable has its original path and bytes.
      const out = join(options.out, 'targets', target.id, suite),
        attempt = join(out, `attempt-${Date.now()}`),
        resultPath = join(attempt, 'result.json')
      mkdirSync(attempt, { recursive: true })
      const job = join(attempt, 'job.json'),
        profile = suite === 'invocation' ? options.invocationProfile : options.profile,
        rounds = suite === 'invocation' ? options.invocationRounds : options.apiOnly ? 1 : options.rounds
      writeFileSync(job, JSON.stringify({ root: target.root, harnessRoot: options.root, packageRoot: target.packageRoot, out: attempt, rounds, profile, resultPath }))
      try {
        if (suite === 'invocation' && target.nativeStorage) restoreNativeArtifact(target.nativeStorage)
        await command(process.env.BUN_BIN ?? (process.versions.bun ? process.execPath : 'bun'), ['run', join(options.root, 'eval/benchmark/unified/run.ts'), '--worker-suite', suite, '--worker-job', job], options.root, join(attempt, 'run.log'), suite === 'invocation' ? 90 * 60_000 : 60 * 60_000)
      } catch (error) {
        if (!existsSync(resultPath)) writeFileSync(resultPath, JSON.stringify({ status: 'failed', observations: [], gaps: [String(error)] }))
      }
      writeFileSync(join(out, 'latest.json'), JSON.stringify({ resultPath, measuredAt: stamp(), policy: 'Fresh attempt; no automatic evidence reuse' }, null, 2))
      const result = read(resultPath)
      coverage.push({ target: target.id, suite, profile, rounds, status: result.status, passed: result.observations.filter((row: any) => row.status === 'passed').length, total: result.observations.length, gaps: result.gaps, resultPath })
      reportCampaign(options, campaign, jobs, coverage)
    }
    if (target.nativeStorage) releaseNativeArtifact(target.nativeStorage)
  }
  reportCampaign(options, campaign, jobs, coverage)
  try {
    const current = metadata(options.root, campaign.repo)
    writeFileSync(
      join(options.out, 'remote-heads.json'),
      JSON.stringify(
        {
          checkedAt: stamp(),
          main: current.main,
          openPRs: current.prs,
          changes: campaign.openPRs.filter(pr => current.prs.find((now: any) => now.number === pr.number)?.headRefOid !== pr.headRefOid).map(pr => ({ pr: pr.number, measured: pr.headRefOid, current: current.prs.find((now: any) => now.number === pr.number)?.headRefOid ?? null })),
          policy: 'Read-only end check; changed later heads never relabel frozen measurements.',
        },
        null,
        2,
      ),
    )
  } catch (error) {
    writeFileSync(join(options.out, 'remote-heads.json'), JSON.stringify({ checkedAt: stamp(), status: 'unavailable', error: String(error) }))
  }
  writeFileSync(join(options.out, 'complete.json'), JSON.stringify({ completedAt: stamp(), targets: campaign.targets.length, jobs: jobs.length }, null, 2))
}
export async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help')) {
    console.log(
      'bun run eval/benchmark/unified/pr-campaign.ts --out DIR [--prepare-only|--run] [--compact-native] [--api-only] [--core-metrics svg,svgReceipt,firstSvg,import] [--extra-core-cases gitGraph20] [--snapshot-file FILE] [--prs N,N] [--rounds N] [--profile smoke|full] [--invocation-profile smoke|full] [--invocation-rounds N] [--repo owner/name] [--root DRIVER] [--dependency-policy strict|main-overrides]\nPreparation freezes main and all selected open PR heads, builds canonical artifacts and actual npm packs. --compact-native stores candidate executables losslessly and verifies/restores their original bytes and paths before each invocation subprocess, outside clocks; main remains materialized. --api-only skips site/native builds and broad invocation while preserving selected core and declared-profile family coverage; --core-metrics chooses actual measured APIs; --extra-core-cases adds separately reported SVG cases without changing the fixed six aggregate; --snapshot-file freezes supplied exact main/open heads without rediscovery. --run reuses the frozen prepared artifacts but always reruns all measurements in new attempt directories; existing timing/coverage results are never automatically reused. Invocation profile/rounds default to the campaign settings; explicit overrides affect only broad invocation coverage and are recorded in evidence. Package-only conflicts are resolved only under explicit main-overrides policy; source conflicts remain exploratory.',
    )
    return
  }
  const options = parsePrCampaignOptions(argv),
    campaign = await preparePrCampaign(options)
  if (options.compactNative) {
    const directory = join(options.out, 'native-storage')
    mkdirSync(directory, { recursive: true })
    for (const target of campaign.targets) {
      if (target.id === 'main' || target.buildStatus !== 'passed') continue
      const file = join(target.root, 'dist/am')
      if (target.nativeStorage) releaseNativeArtifact(target.nativeStorage)
      else if (existsSync(file)) target.nativeStorage = compactNativeArtifact(file, join(directory, target.id + '.gz'))
      writeFileSync(join(options.out, 'campaign.json'), JSON.stringify(campaign, null, 2))
    }
  }
  if (options.prepareOnly) {
    console.log(JSON.stringify({ status: 'prepared', targets: campaign.targets.map(target => ({ id: target.id, integration: target.integration, buildStatus: target.buildStatus, equivalentTo: target.equivalentTo })) }, null, 2))
    return
  }
  await runPrCampaign(options, campaign)
}
if (import.meta.main) await main()
