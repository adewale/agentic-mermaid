import '../ci-policy-enforce.ts'
/** Prepare a fresh independent qualification helper while preserving every admitted engine asset. */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'
import type { PreparedCommunityBrowser } from './community-browser.ts'

export async function prepareQualificationRepair(options: { base: string; out: string; driver: string; protocol: string }) {
  const base = resolve(options.base),
    out = resolve(options.out),
    driver = resolve(options.driver)
  if (!options.protocol || (existsSync(out) && readdirSync(out).length > 0)) throw Error('Use an explicit new protocol and fresh correction preparation directory')
  const source = join(base, 'community-browser-prepared.json')
  const peers = JSON.parse(readFileSync(source, 'utf8')) as PreparedCommunityBrowser[]
  if (peers.length !== 84 || new Set(peers.map(peer => peer.node.id)).size !== 84) throw Error('Expected frozen84-node browser snapshot')
  const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
  for (const peer of peers) for (const file of peer.browser?.files ?? []) if (digest(file.path) !== file.sha256) throw Error('Base browser file proof changed before preparation: ' + file.path)
  mkdirSync(out, { recursive: true })
  const helper = join(out, 'qualification-visible-content-v3.js')
  await build({
    stdin: {
      contents: `export{isRenderedSourceEcho}from ${JSON.stringify(join(driver, 'eval/benchmark/unified/qualification-visible-source.ts'))};export{inspectSvgText}from ${JSON.stringify(join(driver, 'eval/benchmark/unified/svg-text-inspection.ts'))}`,
      resolveDir: driver,
      sourcefile: 'community-visible-output-qualification.mjs',
    },
    outfile: helper,
    bundle: true,
    platform: 'browser',
    format: 'iife',
    globalName: 'unifiedCommunityQualification',
    external: ['node:*'],
    target: 'es2022',
    minify: true,
    logLevel: 'silent',
  })
  const repaired = peers.map(peer => {
    if (!peer.browser) return peer
    const engine = peer.browser,
      originalHelper = engine.qualificationHelper
    if (!originalHelper || !engine.files?.some(file => resolve(file.path) === resolve(originalHelper))) throw Error('Base helper lacks proof: ' + peer.node.id)
    return { ...peer, browser: { ...engine, qualificationHelper: helper, files: [...engine.files.filter(file => resolve(file.path) !== resolve(originalHelper)), { path: helper, sha256: digest(helper) }] } }
  })
  for (const peer of peers) for (const file of peer.browser?.files ?? []) if (digest(file.path) !== file.sha256) throw Error('Preparation mutated an original file: ' + file.path)
  const revision = execFileSync('git', ['-C', driver, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const manifest = {
    protocol: options.protocol,
    preparedAt: new Date().toISOString(),
    driver: { root: driver, revision, dirty: Boolean(execFileSync('git', ['-C', driver, 'status', '--porcelain'], { encoding: 'utf8' }).trim()) },
    originalSnapshot: source,
    originalHelpers: [...new Set(peers.map(peer => peer.browser?.qualificationHelper).filter(Boolean))],
    freshHelper: { path: helper, sha256: digest(helper) },
    policy: 'Only the independent qualification helper changes. Original engine bundles, source programs, runtime dependencies, host contracts and helper files remain unchanged. No API call or performance clock executes in this preparation.',
  }
  writeFileSync(join(out, 'community-browser-prepared.json'), JSON.stringify(repaired, null, 2) + '\n')
  writeFileSync(join(out, 'qualification-preparation.json'), JSON.stringify(manifest, null, 2) + '\n')
  return manifest
}
if (import.meta.main) {
  const options = new Map<string, string>()
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index]!,
      value = process.argv[index + 1]
    if (!['--base', '--out', '--driver', '--protocol'].includes(key) || !value || value.startsWith('--') || options.has(key)) throw Error('Use --base COMMUNITY_DIR --out FRESH_DIR --driver CHECKOUT --protocol VERSION')
    options.set(key, value)
  }
  for (const key of ['--base', '--out', '--driver', '--protocol']) if (!options.has(key)) throw Error('Missing ' + key)
  console.log(JSON.stringify(await prepareQualificationRepair({ base: options.get('--base')!, out: options.get('--out')!, driver: options.get('--driver')!, protocol: options.get('--protocol')! }), null, 2))
}
