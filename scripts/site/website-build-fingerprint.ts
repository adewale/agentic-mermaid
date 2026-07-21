import { createHash, type Hash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Conservative source authority for the generated website. Directory entries
 * deliberately trade occasional extra rebuilds for never reusing stale output.
 * Generated website outputs and test-only sources are excluded below. */
export const WEBSITE_BUILD_FINGERPRINT_PATHS = Object.freeze([
  'website',
  'public',
  'docs/schemas/style-spec.schema.json',
  'docs/assets/style-cookbook',
  'examples/styles',
  'skills/agentic-mermaid-diagram-workflow',
  'Instructions_for_agents.md',
  'editor',
  'scripts/site',
  'scripts/docs',
  'shared',
  'src',
  'eval/agent-usage/homepage-prompt.ts',
  'assets/fonts',
  'package.json',
  'bun.lock',
] as const)

const EXCLUDED_PATHS = Object.freeze([
  'website/.wrangler',
  'website/public',
  'website/src/generated',
  'src/__tests__',
] as const)

export interface WebsiteBuildFingerprintOptions {
  paths?: readonly string[]
  /** Tests may inject stable provenance instead of consulting a Git checkout. */
  provenance?: readonly string[]
}

export function isWebsiteBuildFingerprintInput(path: string): boolean {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '')
  if (EXCLUDED_PATHS.some(excluded => normalized === excluded || normalized.startsWith(`${excluded}/`))) return false
  return WEBSITE_BUILD_FINGERPRINT_PATHS.some(input => normalized === input || normalized.startsWith(`${input}/`))
}

export function computeWebsiteBuildFingerprint(root: string, options: WebsiteBuildFingerprintOptions = {}): string {
  const hash = createHash('sha256')
  const provenance = options.provenance ?? gitProvenance(root)
  for (const value of provenance) {
    hash.update(value)
    hash.update('\0')
  }
  for (const rel of options.paths ?? WEBSITE_BUILD_FINGERPRINT_PATHS) addPathToHash(hash, root, rel)
  return hash.digest('hex')
}

function gitProvenance(root: string): string[] {
  return [['rev-parse', 'HEAD'], ['status', '--porcelain=v1', '--untracked-files=normal']].map(args => {
    try { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }) }
    catch { return 'git-unavailable' }
  })
}

function addPathToHash(hash: Hash, root: string, rel: string): void {
  hash.update(rel)
  hash.update('\0')
  if (EXCLUDED_PATHS.some(excluded => rel === excluded || rel.startsWith(`${excluded}/`))) {
    hash.update('excluded')
    hash.update('\0')
    return
  }
  const abs = join(root, rel)
  if (!existsSync(abs)) {
    hash.update('missing')
    hash.update('\0')
    return
  }
  const stat = statSync(abs)
  if (stat.isDirectory()) {
    hash.update('dir')
    hash.update('\0')
    for (const name of readdirSync(abs).sort()) addPathToHash(hash, root, `${rel}/${name}`)
    return
  }
  hash.update('file')
  hash.update('\0')
  hash.update(readFileSync(abs))
  hash.update('\0')
}
