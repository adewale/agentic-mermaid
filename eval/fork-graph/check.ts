// Re-checks population.json against live sources: each node's branch head
// (anonymous `git ls-remote`) and each package's latest version (npm registry,
// PyPI JSON). Prints drift and exits 1 when anything moved or became
// unreachable. A research aid with network inputs and moving targets: it is
// not part of any test or CI job.
//
//   bun run eval/fork-graph/check.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

interface Pkg {
  registry: 'npm' | 'pypi'
  name: string
  version: string
}
interface GraphNode {
  id: string
  repo?: string
  branch?: string
  head?: string
  packages?: Pkg[]
}
interface Population {
  checkedAt: string
  nodes: GraphNode[]
}

const population = JSON.parse(readFileSync(join(import.meta.dir, 'population.json'), 'utf8')) as Population

const GITHUB_REPO = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/

async function branchHead(repo: string, branch: string): Promise<string | undefined> {
  const child = Bun.spawn(['git', 'ls-remote', repo, `refs/heads/${branch}`], { stdout: 'pipe', stderr: 'ignore', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
  const out = await new Response(child.stdout).text()
  await child.exited
  return /^[0-9a-f]{40}/.exec(out)?.[0]
}

async function latestVersion(pkg: Pkg): Promise<string | undefined> {
  const url = pkg.registry === 'npm' ? `https://registry.npmjs.org/${pkg.name}/latest` : `https://pypi.org/pypi/${pkg.name}/json`
  const response = await fetch(url).catch(() => undefined)
  if (!response?.ok) return undefined
  const body = (await response.json()) as { version?: string; info?: { version?: string } }
  return pkg.registry === 'npm' ? body.version : body.info?.version
}

async function checkNode(node: GraphNode): Promise<string[]> {
  const drift: string[] = []
  // Only plain GitHub HTTPS URLs reach git, so a crafted entry cannot pass an option.
  if (node.repo && !GITHUB_REPO.test(node.repo)) drift.push(`${node.id}: repo ${node.repo} is not a https://github.com/<owner>/<repo> URL`)
  else if (node.repo && node.branch && node.head) {
    const head = await branchHead(node.repo, node.branch)
    if (!head) drift.push(`${node.id}: ${node.branch} unreachable`)
    else if (head !== node.head) drift.push(`${node.id}: ${node.branch} ${node.head.slice(0, 12)} -> ${head.slice(0, 12)}`)
  }
  for (const pkg of node.packages ?? []) {
    const version = await latestVersion(pkg)
    if (!version) drift.push(`${node.id}: ${pkg.registry}:${pkg.name} unreachable`)
    else if (version !== pkg.version) drift.push(`${node.id}: ${pkg.registry}:${pkg.name} ${pkg.version} -> ${version}`)
  }
  return drift
}

async function main() {
  const queue = [...population.nodes]
  const drift: string[] = []
  const worker = async () => {
    for (let node = queue.shift(); node; node = queue.shift()) drift.push(...(await checkNode(node)))
  }
  await Promise.all(Array.from({ length: 8 }, worker))
  drift.sort()
  for (const line of drift) console.log(line)
  console.log(`${drift.length} drift line(s) across ${population.nodes.length} nodes since ${population.checkedAt}`)
  process.exitCode = drift.length ? 1 : 0
}

await main()
