#!/usr/bin/env bun
// Production freshness: a green deploy run proves only the deploys that ran.
// Nothing else notices when deploys stop happening — 0.4.2 was never published,
// so every deploy after 2026-08-03 skipped and agentic-mermaid.dev kept serving
// a 2026-07-31 build while each run reported success. This check compares what
// production actually serves (capabilities.json `generatedFrom`) with the
// newest deployable main commit and fails once main has carried undeployed
// commits for longer than the allowed drift.
//
// The decision is a pure function. The CLI wrapper reads the live build stamp
// (a read-only GET) and the git facts, then maps the verdict to a GitHub
// annotation and exit code. .github/workflows/production-freshness.yml runs it
// on a schedule.

import { execFileSync } from 'node:child_process'

export const PRODUCTION_CAPABILITIES_URL = 'https://agentic-mermaid.dev/capabilities.json'
export const DEFAULT_MAX_DRIFT_DAYS = 3
const DAY_MS = 24 * 60 * 60 * 1000
const FULL_SHA_RE = /^[0-9a-f]{40}$/

export interface LiveBuild {
  gitSha: string
  packageVersion: string
  buildTime: string
}

export interface FreshnessFacts {
  live: LiveBuild
  /** Newest main commit that passed canonical CI, i.e. the one deploy should serve. */
  deployable: { sha: string; packageVersion: string }
  /** How the live commit relates to the deployable one in main's history. */
  relation: 'same' | 'live-behind' | 'live-ahead' | 'unrelated'
  /** First-parent commits on main after the live one, oldest first; empty unless live-behind. */
  undeployed: Array<{ sha: string; committedAt: string }>
  now: Date
  maxDriftDays: number
}

export type FreshnessCode = 'current' | 'within-drift' | 'stale' | 'unknown-build'

export interface FreshnessVerdict {
  ok: boolean
  code: FreshnessCode
  message: string
}

/** Validate the `generatedFrom` stamp that website/build.ts writes into capabilities.json. */
export function parseLiveBuild(json: unknown): LiveBuild {
  const stamp = (json as { generatedFrom?: Record<string, unknown> } | null)?.generatedFrom
  if (!stamp || typeof stamp !== 'object') throw new Error('capabilities.json has no generatedFrom build stamp')
  const { gitSha, packageVersion, buildTime } = stamp
  if (typeof gitSha !== 'string' || typeof packageVersion !== 'string' || typeof buildTime !== 'string') {
    throw new Error(`capabilities.json generatedFrom is incomplete: ${JSON.stringify(stamp)}`)
  }
  return { gitSha, packageVersion, buildTime }
}

function describeLive(live: LiveBuild): string {
  return `${live.gitSha.slice(0, 12)} (agentic-mermaid@${live.packageVersion}, built ${live.buildTime})`
}

export function assessProductionFreshness(f: FreshnessFacts): FreshnessVerdict {
  const live = describeLive(f.live)
  const deployable = `${f.deployable.sha.slice(0, 12)} (agentic-mermaid@${f.deployable.packageVersion})`
  // A build stamp that is not an exact commit (a dirty or local build) or not on
  // main's history cannot be dated against main, so it is never "fresh enough".
  if (!FULL_SHA_RE.test(f.live.gitSha) || f.relation === 'unrelated') {
    return {
      ok: false,
      code: 'unknown-build',
      message: `Production serves ${live}, which is not a commit on main's history, so its freshness cannot be established. Deployable main is ${deployable}.`,
    }
  }
  if (f.relation === 'same' || f.relation === 'live-ahead') {
    return { ok: true, code: 'current', message: `Production serves ${live}, the newest deployable main commit or later.` }
  }
  const oldest = f.undeployed[0]
  if (!oldest) {
    throw new Error('live-behind requires at least one undeployed main commit')
  }
  const driftMs = f.now.getTime() - Date.parse(oldest.committedAt)
  if (Number.isNaN(driftMs)) throw new Error(`Undeployed commit ${oldest.sha} has an unreadable commit time: ${oldest.committedAt}`)
  const driftDays = driftMs / DAY_MS
  const summary = `Production serves ${live}; deployable main is ${deployable}, ${f.undeployed.length} main commit(s) ahead. The oldest undeployed commit, ${oldest.sha.slice(0, 12)}, landed ${oldest.committedAt} (${driftDays.toFixed(1)} days ago)`
  if (driftDays > f.maxDriftDays) {
    return {
      ok: false,
      code: 'stale',
      message: `${summary}, beyond the ${f.maxDriftDays}-day limit. Check the "Deploy website to Cloudflare" runs; if agentic-mermaid@${f.deployable.packageVersion} is not on npm, publish it (docs/contributing/releasing.md).`,
    }
  }
  return { ok: true, code: 'within-drift', message: `${summary}, within the ${f.maxDriftDays}-day limit.` }
}

// ---- CLI wrapper: gather the live stamp and git facts, annotate, exit --------

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

function isAncestor(ancestor: string, descendant: string): boolean {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function commitExists(sha: string): boolean {
  try {
    execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

export function gatherGitFacts(liveSha: string, deployableSha: string): Pick<FreshnessFacts, 'relation' | 'undeployed'> & { deployableVersion: string } {
  const deployableVersion = JSON.parse(git(['show', `${deployableSha}:package.json`])).version as string
  if (!FULL_SHA_RE.test(liveSha) || !commitExists(liveSha)) return { relation: 'unrelated', undeployed: [], deployableVersion }
  if (liveSha === deployableSha) return { relation: 'same', undeployed: [], deployableVersion }
  if (isAncestor(deployableSha, liveSha)) return { relation: 'live-ahead', undeployed: [], deployableVersion }
  if (!isAncestor(liveSha, deployableSha)) return { relation: 'unrelated', undeployed: [], deployableVersion }
  const undeployed = git(['log', '--first-parent', '--reverse', '--format=%H %cI', `${liveSha}..${deployableSha}`])
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const [sha, committedAt] = line.split(' ')
      return { sha: sha!, committedAt: committedAt! }
    })
  return { relation: 'live-behind', undeployed, deployableVersion }
}

function option(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name)
  return index === -1 ? undefined : argv[index + 1]
}

if (import.meta.main) {
  const argv = process.argv.slice(2)
  const deployableSha = option(argv, '--deployable-sha')
  const url = option(argv, '--url') ?? PRODUCTION_CAPABILITIES_URL
  const maxDriftDays = Number(option(argv, '--max-drift-days') ?? DEFAULT_MAX_DRIFT_DAYS)
  if (!deployableSha || !FULL_SHA_RE.test(deployableSha) || !Number.isFinite(maxDriftDays) || maxDriftDays < 0) {
    process.stderr.write('Usage: bun run scripts/ci/production-freshness.ts --deployable-sha <40-hex sha> [--max-drift-days N] [--url capabilities.json URL]\n')
    process.exit(2)
  }
  const bust = new URL(url)
  bust.searchParams.set('freshness', String(Date.now()))
  const response = await fetch(bust, { headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(30_000) })
  if (!response.ok) {
    process.stdout.write(`::error title=Production freshness unknown::GET ${url} returned HTTP ${response.status}.\n`)
    process.exit(1)
  }
  const live = parseLiveBuild(await response.json())
  const { deployableVersion, relation, undeployed } = gatherGitFacts(live.gitSha, deployableSha)
  const verdict = assessProductionFreshness({
    live,
    deployable: { sha: deployableSha, packageVersion: deployableVersion },
    relation,
    undeployed,
    now: new Date(),
    maxDriftDays,
  })
  if (verdict.ok) {
    process.stdout.write(`::notice title=Production freshness (${verdict.code})::${verdict.message}\n`)
    process.exit(0)
  }
  process.stdout.write(`::error title=Production freshness (${verdict.code})::${verdict.message}\n`)
  process.exit(1)
}
