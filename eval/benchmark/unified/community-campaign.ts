/** Freeze expensive community acquisition separately from timed execution. */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { assertBenchmarkExecutionAllowed } from '../ci-policy.ts'
import { readBenchmarkDocument } from '../portable/project-records.ts'
import { prepareCommunity } from './community.ts'
import { prepareCommunityBrowsers } from './community-browser.ts'
import type { CommunityArtifact } from './community-types.ts'
import { parseOptions, runUnified } from './run.ts'

const git = (root: string, args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
interface TargetIdentity {
  revision: string
  packageRoot: string
  candidateTarball: string
  candidateSha256: string
}
interface TargetAdvance {
  from: TargetIdentity
  to: TargetIdentity
}
const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
function targetIdentity(options: ReturnType<typeof parseOptions>): TargetIdentity {
  if (!options.packageRoot || !options.candidateTarball || !options.candidateSha256) throw Error('A target advance requires --package-root, --candidate-tarball and --candidate-sha256')
  if (digest(options.candidateTarball) !== options.candidateSha256) throw Error('Current candidate archive differs from supplied byte identity')
  return { revision: git(options.root, ['rev-parse', 'HEAD']), packageRoot: options.packageRoot, candidateTarball: options.candidateTarball, candidateSha256: options.candidateSha256 }
}
function originalTarget(directory: string): TargetIdentity {
  const invocation = JSON.parse(readFileSync(join(directory, 'invocation.json'), 'utf8')),
    report = readBenchmarkDocument(join(directory, 'report.json'))
  const revisions = new Set<string>()
  const visit = (value: unknown) => {
    if (value && typeof value === 'object')
      for (const [key, child] of Object.entries(value)) {
        if (key === 'targetRevision' && typeof child === 'string') revisions.add(child)
        else if (typeof child === 'object') visit(child)
      }
  }
  visit(report)
  if (revisions.size !== 1 || !invocation.packageRoot || !invocation.candidateTarball || !invocation.candidateSha256) throw Error('Original unified run has no unique recorded target/archive identity')
  const revision = [...revisions][0]!
  if (digest(invocation.candidateTarball) !== invocation.candidateSha256) throw Error('Original candidate archive byte identity differs')
  if (existsSync(join(invocation.root, '.git')) && git(invocation.root, ['rev-parse', 'HEAD']) !== revision) throw Error('Original retained checkout no longer matches its recorded run revision')
  return { revision, packageRoot: invocation.packageRoot, candidateTarball: invocation.candidateTarball, candidateSha256: invocation.candidateSha256 }
}
function candidateArtifact(options: ReturnType<typeof parseOptions>, advance: TargetAdvance): CommunityArtifact & { targetAdvance: TargetAdvance } {
  const root = options.packageRoot!,
    module = join(root, 'dist/agent.js'),
    pkgPath = join(root, 'package.json'),
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  for (const [file, member] of [
    [module, 'package/dist/agent.js'],
    [pkgPath, 'package/package.json'],
  ]) {
    const packed = execFileSync('tar', ['-xOzf', options.candidateTarball!, member!], { maxBuffer: 64 * 1024 * 1024 })
    if (!readFileSync(file!).equals(packed)) throw Error('Current installed entry/package metadata differs from actual npm archive: ' + file)
  }
  const walk = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      const path = join(directory, entry.name)
      return entry.isDirectory() ? walk(path) : entry.isFile() ? [path] : []
    })
  const files = [pkgPath, ...walk(join(root, 'dist'))].map(path => ({ path, sha256: digest(path) }))
  const dependencies = Object.fromEntries(
    Object.keys(pkg.dependencies ?? {}).map(name => {
      const path = join(root, 'node_modules', name, 'package.json')
      return [name, existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')).version : null]
    }),
  )
  return {
    kind: 'node',
    root,
    module,
    version: pkg.version,
    revision: advance.to.revision,
    sha256: digest(module),
    files,
    runtime: 'Node',
    dependencies,
    targetAdvance: advance,
    detail: 'Only the local candidate advances from the explicitly referenced original run; peer versions/artifacts and source/label cohort remain frozen. All timings are new.',
  }
}
export async function main(argv = process.argv.slice(2)): Promise<void> {
  assertBenchmarkExecutionAllowed()
  const preparing = argv.includes('--prepare-only')
  const advanceIndex = argv.indexOf('--advance-from'),
    advanceFrom = advanceIndex >= 0 ? argv[advanceIndex + 1] : undefined
  if (advanceIndex >= 0 && (!advanceFrom || advanceFrom.startsWith('--') || argv.lastIndexOf('--advance-from') !== advanceIndex)) throw Error('--advance-from requires one original unified-run directory')
  const options = parseOptions(argv.filter((arg, index) => arg !== '--prepare-only' && arg !== '--run' && (advanceIndex < 0 || (index !== advanceIndex && index !== advanceIndex + 1))))
  const directory = join(options.out, 'community')
  const preparedFile = join(directory, 'community-prepared.json')
  const browserFile = join(directory, 'community-browser-prepared.json')
  const frozen = join(options.out, 'preparation.json')
  mkdirSync(directory, { recursive: true })
  if (preparing) {
    const startedAt = new Date().toISOString()
    const targetAdvance = advanceFrom ? { from: originalTarget(resolve(advanceFrom)), to: targetIdentity(options) } : undefined
    if (targetAdvance) {
      const catalog = JSON.parse(readFileSync(options.communityCatalogFile ?? join(options.harnessRoot, 'docs/mermaid-community.json'), 'utf8')),
        self = catalog.nodes.find((node: { benchmark?: { adapter?: string } }) => node.benchmark?.adapter === 'agentic')
      if (!self) throw Error('Catalog declares no local candidate')
      const source = options.communityArtifacts ?? process.env.AM_BENCH_COMMUNITY_ARTIFACTS,
        provided = source ? JSON.parse(readFileSync(source, 'utf8')) : {}
      provided[self.id] = candidateArtifact(options, targetAdvance)
      const manifest = join(options.out, 'provided-with-target-advance.json')
      writeFileSync(manifest, JSON.stringify(provided, null, 2))
      options.communityArtifacts = manifest
    }
    const prepared = await prepareCommunity({ ...options, out: directory })
    const browsers = await prepareCommunityBrowsers(prepared, { ...options, out: directory })
    writeFileSync(browserFile, JSON.stringify(browsers, null, 2))
    const manifest = {
      status: 'prepared',
      startedAt,
      finishedAt: new Date().toISOString(),
      driver: git(options.harnessRoot, ['rev-parse', 'HEAD']),
      target: git(options.root, ['rev-parse', 'HEAD']),
      preparedFile,
      browserFile,
      inputsFile: options.communityInputsFile ?? null,
      targetAdvance: targetAdvance ?? null,
      advanceFrom: advanceFrom ? resolve(advanceFrom) : null,
      catalogNodes: prepared.length,
      artifacts: prepared.filter(peer => peer.artifact).length,
      acquisitionFailures: prepared.filter(peer => !peer.artifact).map(peer => ({ id: peer.node.id, reason: peer.error ?? 'No artifact bound' })),
      policy: 'Preparation performs actual pinned acquisition/build and browser binding before performance clocks. Errors remain recorded; configuration is not a working-API claim. Timed execution loads this frozen snapshot without reinstalling or rebundling.',
    }
    writeFileSync(frozen, JSON.stringify(manifest, null, 2))
    console.log(JSON.stringify(manifest, null, 2))
    return
  }
  if (!existsSync(frozen)) throw Error('Run --prepare-only into this --out directory before timing the community campaign')
  const manifest = JSON.parse(readFileSync(frozen, 'utf8'))
  if (manifest.status !== 'prepared' || manifest.target !== git(options.root, ['rev-parse', 'HEAD'])) throw Error('Frozen preparation target differs from requested checkout')
  if (manifest.targetAdvance && JSON.stringify(manifest.targetAdvance.to) !== JSON.stringify(targetIdentity(options))) throw Error('Frozen target advance differs from the actual requested target/archive')
  const report = await runUnified({
    ...options,
    selected: ['community', 'community-cli'],
    communityPreparedFile: preparedFile,
    communityBrowserPreparedFile: browserFile,
    communityInputsFile: options.communityInputsFile ?? manifest.inputsFile ?? undefined,
    communityArtifactPolicy: 'frozen',
  })
  console.log(`Community campaign ${report.status}: ${resolve(options.out, 'report.md')}`)
  process.exitCode = report.status === 'failed' ? 1 : report.status === 'incomplete' && !options.allowIncomplete ? 2 : 0
}
if (import.meta.main) await main()
