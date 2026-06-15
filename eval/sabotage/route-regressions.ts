#!/usr/bin/env bun
/**
 * Lightweight sabotage checks for high-value PR #30 regressions.
 *
 * Each sabotage creates a detached git worktree, applies a one-line revert of
 * a previously fixed bug, then runs the focused regression tests and expects
 * them to fail. This is deliberately opt-in (`bun run sabotage:routes`): it is
 * a confidence/survivor-harvest lane, not normal PR CI.
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
    name: 'downgraded detours cannot keep stale straightened metadata',
    file: 'src/route-contracts.ts',
    oldText: "    return { ...base, invariant: draft.invariant === 'straight' ? 'explained-detour' : draft.invariant }\n",
    newText: "    return { ...base, invariant: draft.invariant === 'straight' ? 'explained-detour' : draft.invariant, ...(draft.straightened ? { straightened: true as const } : {}) } as RouteCertificate\n",
    command: ['bun', 'test', 'src/__tests__/route-contracts.test.ts', '--timeout', '120000'],
    expectedFailure: /clears the straightened bit when a fixed-point retry downgrades to a detour|straightened/,
  },
  {
    name: 'subgraph IDs are classified as container endpoints',
    file: 'src/layout-engine.ts',
    oldText: '  const endpointSubgraph = (id: string) => nodeToSubgraph.get(id) ?? subgraphToParent.get(id)\n',
    newText: '  const endpointSubgraph = (id: string) => nodeToSubgraph.get(id)\n',
    command: ['bun', 'test', 'src/__tests__/subgraph-direction.test.ts', 'src/__tests__/subgraph-hierarchy-exhaustive.test.ts', '--timeout', '120000'],
    expectedFailure: /nested subgraph-id edges under direction overrides attach to the container|ROUTE_CONTAINER_MISANCHOR|edge should be present/,
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
    const result = run(item.command, worktree, { expectFailure: true })
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
