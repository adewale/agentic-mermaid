/** Freeze expensive community acquisition separately from timed execution. */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { prepareCommunity } from './community.ts'
import { prepareCommunityBrowsers } from './community-browser.ts'
import { parseOptions, runUnified } from './run.ts'

const git = (root: string, args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
export async function main(argv = process.argv.slice(2)): Promise<void> {
  const preparing = argv.includes('--prepare-only')
  const options = parseOptions(argv.filter(arg => arg !== '--prepare-only'))
  const directory = join(options.out, 'community')
  const preparedFile = join(directory, 'community-prepared.json')
  const browserFile = join(directory, 'community-browser-prepared.json')
  const frozen = join(options.out, 'preparation.json')
  mkdirSync(directory, { recursive: true })
  if (preparing) {
    const startedAt = new Date().toISOString()
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
