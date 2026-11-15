// Read Git's NUL-delimited changed paths. Unknown files and missing history
// receive full qualification; only explicitly recognized documentation is light.
import { appendFileSync, readFileSync } from 'node:fs'

const args = process.argv.slice(2)
if (args.some(arg => arg !== '--full' && arg !== '--layout-evidence')) {
  throw new Error('Usage: git diff --name-only -z BASE HEAD | bun scripts/ci/change-scope.ts [--full] [--layout-evidence]')
}
const paths = readFileSync(0, 'utf8').split('\0').filter(Boolean)
const documentation = (path: string): boolean =>
  /^(?:README|AGENTS|CLAUDE|TODO|AGENT_NATIVE|Instructions_for_agents|SECURITY|THIRD_PARTY_NOTICES)\.md$/.test(path)
  || /^(?:docs|skills|\.github)\/.+\.md$/.test(path)
  || /^website\/source\/.+\.md$/.test(path)
const full = args.includes('--full') || paths.length === 0 || !paths.every(documentation)
const layout = args.includes('--layout-evidence') || paths.some(path =>
  /^(?:src\/(?!cli\/|mcp\/|__tests__\/)|assets\/fonts\/|examples\/styles\/|eval\/(?:layout|visual|mermaid-docs)|scripts\/(?:pr-assets|site|build)\/)/.test(path)
  || path === 'package.json' || path === 'bun.lock')
const scope = { full, layout }
console.log(JSON.stringify(scope))
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `full=${full}\nlayout=${layout}\n`)
}
