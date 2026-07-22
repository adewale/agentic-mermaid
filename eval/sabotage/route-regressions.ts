#!/usr/bin/env bun
/**
 * Lightweight sabotage checks for high-value route and link regressions.
 *
 * Each sabotage creates a detached git worktree, applies a one-line revert of
 * a previously fixed bug, then runs the focused regression tests and expects
 * them to fail. `bun run sabotage:routes` is the bounded PR fault-injection
 * gate, unlike the retired broad mutation sweep.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

interface SabotageCase {
  name: string
  file: string
  oldText: string
  newText: string
  command: string[]
  expectedFailure: RegExp
  timeout?: number
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const keep = process.argv.includes('--keep')
const allowDirty = process.argv.includes('--allow-dirty')

const cases: SabotageCase[] = [
  {
    name: 'text-embedded link length uses both operator halves',
    file: 'src/parser.ts',
    oldText: '  const extra = Math.max(extraOpen, extraClose)\n',
    newText: '  const extra = extraOpen\n',
    command: ['bun', 'test', 'src/__tests__/link-grammar.test.ts', '--timeout', '120000'],
    expectedFailure: /text-embedded label length survives canonical serialization|Expected: 3/,
  },
  {
    name: 'non-incident moved node is audited as ROUTE_STALE_AFTER_NODE_MOVE',
    file: 'src/route-contracts.ts',
    oldText: '    for (const node of positioned.nodes) {\n      if (node.id === edge.source || node.id === edge.target) continue\n',
    newText: '    for (const node of positioned.nodes) {\n      continue\n',
    command: ['bun', 'test', 'src/__tests__/route-contracts.test.ts', '--timeout', '120000'],
    expectedFailure: /non-incident node moved onto a certified route|ROUTE_STALE_AFTER_NODE_MOVE/,
  },
  {
    name: 'final detours cannot expose stale straightened metadata',
    file: 'src/route-contracts.ts',
    oldText: "    return { ...base, invariant: draft.invariant === 'straight' ? 'explained-detour' : draft.invariant }\n",
    // Inject the impossible public state unconditionally. The old sabotage
    // copied draft.straightened, but newer layout balancing means this fixture
    // can be a detour throughout and therefore made that mutation a no-op.
    newText: "    return { ...base, invariant: draft.invariant === 'straight' ? 'explained-detour' : draft.invariant, straightened: true as const } as RouteCertificate\n",
    command: ['bun', 'test', 'src/__tests__/route-contracts.test.ts', '--timeout', '120000'],
    expectedFailure: /does not expose straightened on a final detour|clears the straightened bit|straightened/,
  },
  {
    name: 'subgraph IDs are classified as container endpoints',
    file: 'src/layout-engine.ts',
    oldText: '  const endpointSubgraph = (id: string) => nodeToSubgraph.get(id) ?? subgraphToParent.get(id)\n',
    newText: '  const endpointSubgraph = (id: string) => nodeToSubgraph.get(id)\n',
    command: ['bun', 'test', 'src/__tests__/subgraph-direction.test.ts', 'src/__tests__/subgraph-hierarchy-exhaustive.test.ts', '--timeout', '120000'],
    expectedFailure: /nested subgraph-id edges under direction overrides attach to the container|ROUTE_CONTAINER_MISANCHOR|edge should be present/,
  },
  {
    // Issue #25 acceptance criterion 3: "disabling the direct-lane proof
    // reintroduces a failing test." Neuter tryStraighten (the repair the
    // direct-lane proof authorizes) so it never straightens; the MFA forward
    // lanes then keep their doglegs and the criterion-1 straightness test fails.
    name: 'disabling the direct-lane straightening proof reintroduces MFA hitches',
    file: 'src/route-contracts.ts',
    oldText: '  if (!search) return { applied: false, blockers: [] }\n',
    newText: '  if (true) return { applied: false, blockers: [] }\n',
    command: ['bun', 'test', 'src/__tests__/route-contracts.test.ts', '--timeout', '120000'],
    expectedFailure: /MFA\/login regression.*straight horizontal lane|isStraightHorizontal/,
  },
  {
    name: 'canonical corpus rejects reintroduced route hitches',
    file: 'src/route-contracts.ts',
    oldText: '  for (let round = 0; round < positioned.edges.length; round++) {\n',
    newText: '  for (let round = 0; round < 0; round++) {\n',
    command: ['bun', 'run', 'eval:degenerate-routes'],
    expectedFailure: /"hitches": [1-9]/,
    timeout: 300_000,
  },
  {
    name: 'canonical corpus rejects edge-through-node packing regressions',
    file: 'src/layout/passes/index.ts',
    oldText: '    moveSet(separationUnit(ahead.id, behind.id), f.sign === 1 ? delta : -delta)\n',
    newText: '    // sabotage: omit push-ahead closure\n',
    command: ['bun', 'run', 'eval:degenerate-routes'],
    expectedFailure: /"edgeThroughNode": [1-9]/,
    timeout: 300_000,
  },
  {
    name: 'canonical corpus rejects inconsistent route certificates',
    file: 'src/route-contracts.ts',
    oldText: '      bendCount: bendCountFinal,\n',
    newText: '      bendCount: bendCountFinal + 1,\n',
    command: ['bun', 'run', 'eval:degenerate-routes', '--limit', '1'],
    expectedFailure: /bend-count-mismatch/,
  },
  {
    name: 'canonical corpus rejects generator-definition drift',
    file: 'eval/degenerate-etn/generators.ts',
    oldText: 'export const DENSE_DAG_CASES = 2_000\n',
    newText: 'export const DENSE_DAG_CASES = 1_999\n',
    command: ['bun', 'run', 'eval:degenerate-routes'],
    expectedFailure: /corpus definition drift: expected 2800 cases, generators define 2799/,
  },
]

function run(command: string[], cwd: string, options: { expectFailure?: boolean; timeout?: number } = {}) {
  const result = spawnSync(command[0]!, command.slice(1), {
    cwd,
    encoding: 'utf8',
    timeout: options.timeout ?? 180_000,
    maxBuffer: 1024 * 1024 * 16,
  })
  if (result.error) throw result.error
  if (options.expectFailure) {
    if (result.status === 0) {
      throw new Error(`expected failure but command passed: ${command.join(' ')}`)
    }
    return result
  }
  if (result.status !== 0) {
    process.stderr.write(result.stdout)
    process.stderr.write(result.stderr)
    throw new Error(`command failed (${result.status}): ${command.join(' ')}`)
  }
  return result
}

function git(args: string[], cwd = repoRoot) {
  return run(['git', ...args], cwd)
}

function replaceOnce(file: string, oldText: string, newText: string) {
  const text = readFileSync(file, 'utf8')
  const count = text.split(oldText).length - 1
  if (count !== 1) throw new Error(`${file}: expected one match, found ${count}`)
  writeFileSync(file, text.replace(oldText, newText))
}

const dirty = git(['status', '--porcelain']).stdout.trim()
if (dirty && !allowDirty) {
  throw new Error('sabotage checks run against committed HEAD; commit/stash changes first, or pass --allow-dirty to test committed HEAD anyway')
}

const head = git(['rev-parse', 'HEAD']).stdout.trim()
const root = mkdtempSync(join(tmpdir(), 'agentic-mermaid-sabotage-'))
const worktree = join(root, 'worktree')

git(['worktree', 'add', '--detach', worktree, head])
try {
  const nodeModules = join(repoRoot, 'node_modules')
  const worktreeNodeModules = join(worktree, 'node_modules')
  if (existsSync(nodeModules) && !existsSync(worktreeNodeModules)) {
    symlinkSync(nodeModules, worktreeNodeModules, 'dir')
  }

  for (const item of cases) {
    git(['reset', '--hard', head], worktree)
    replaceOnce(join(worktree, item.file), item.oldText, item.newText)
    const result = run(item.command, worktree, {
      expectFailure: true,
      ...(item.timeout === undefined ? {} : { timeout: item.timeout }),
    })
    const output = result.stdout + result.stderr
    if (!item.expectedFailure.test(output)) {
      throw new Error(`${item.name}: command failed, but not with the expected regression signal`)
    }
    const firstFailure = output.split('\n').find(line => /\(fail\)|error:|Expected:/.test(line))?.trim()
    console.log(`✓ ${item.name}${firstFailure ? ` — ${firstFailure}` : ''}`)
  }
} finally {
  if (keep) {
    console.log(`kept worktree: ${worktree}`)
  } else {
    try { git(['worktree', 'remove', '--force', worktree]) } catch {}
    rmSync(root, { recursive: true, force: true })
  }
}
