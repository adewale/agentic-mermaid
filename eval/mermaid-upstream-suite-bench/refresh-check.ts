import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = process.cwd()
const UPSTREAM = resolve(process.env.MERMAID_UPSTREAM_DIR ?? join(ROOT, '../upstream-mermaid'))
const UPSTREAM_REVISION = 'a2d9686451df7c4644a3eeca20535bbd4c5776b0'
const COVERED_PATH = 'packages/mermaid/src/diagrams'

function git(args: string[]): string {
  return execFileSync('git', ['-C', UPSTREAM, ...args], { encoding: 'utf8' }).trim()
}

if (!existsSync(UPSTREAM)) {
  throw new Error(`Upstream Mermaid checkout not found at ${UPSTREAM}. Set MERMAID_UPSTREAM_DIR or clone it next to this checkout.`)
}

git(['fetch', 'origin', 'develop'])
const remoteRevision = git(['rev-parse', 'origin/develop'])
const changedFiles = git(['diff', '--name-only', `${UPSTREAM_REVISION}..origin/develop`, '--', COVERED_PATH])
  .split('\n')
  .map(line => line.trim())
  .filter(Boolean)

console.log(`Pinned upstream revision: ${UPSTREAM_REVISION}`)
console.log(`Latest fetched origin/develop: ${remoteRevision}`)

if (changedFiles.length === 0) {
  console.log(`No upstream changes under ${COVERED_PATH}; BUILD-20 coverage remains current for the harvested parser/DB scope.`)
} else {
  console.error(`Upstream changed ${changedFiles.length} harvested diagram file(s):`)
  for (const file of changedFiles) console.error(`- ${file}`)
  throw new Error('Refresh BUILD-20 by checking out the new upstream revision, updating family block counts if needed, regenerating cases/exclusions/manifest/ratchet, and rerunning the upstream bench.')
}
