// Read Git's NUL-delimited changed paths. Unknown files and missing history
// receive full qualification; only explicitly recognized documentation is light.
import { appendFileSync, readFileSync } from 'node:fs'

const args = process.argv.slice(2)
if (args.some(arg => arg !== '--full')) {
  throw new Error('Usage: git diff --name-only -z BASE HEAD | bun scripts/ci/change-scope.ts [--full]')
}
const paths = readFileSync(0, 'utf8').split('\0').filter(Boolean)
const documentation = (path: string): boolean =>
  /^(?:README|AGENTS|CLAUDE|TODO|AGENT_NATIVE|Instructions_for_agents|SECURITY|THIRD_PARTY_NOTICES)\.md$/.test(path)
  || /^(?:docs|skills|\.github)\/.+\.md$/.test(path)
  || /^website\/source\/.+\.md$/.test(path)
const full = args.includes('--full') || paths.length === 0 || !paths.every(documentation)
const scope = { full }
console.log(JSON.stringify(scope))
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `full=${full}\n`)
}
