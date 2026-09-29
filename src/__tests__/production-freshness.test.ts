// The scheduled production-freshness check (scripts/ci/production-freshness.ts):
// the pure verdict with an injected clock, then the CLI end to end against a
// local capabilities.json server and a scratch git history, so the wiring from
// live stamp + git facts to exit code is exercised without touching production.

import { afterAll, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assessProductionFreshness, parseLiveBuild, type FreshnessFacts } from '../../scripts/ci/production-freshness.ts'

const SCRIPT = join(import.meta.dir, '..', '..', 'scripts', 'ci', 'production-freshness.ts')
const LIVE = 'd2d821cb07f46d39770c3b731c346ef0c22ea773'
const MAIN = '19edb8ce55cf1a9e0000000000000000000000aa'
const NOW = new Date('2026-09-27T12:00:00Z')

const facts = (over: Partial<FreshnessFacts>): FreshnessFacts => ({
  live: { gitSha: LIVE, packageVersion: '0.4.1', buildTime: '2026-07-31T11:27:14Z' },
  deployable: { sha: MAIN, packageVersion: '0.4.2' },
  relation: 'live-behind',
  undeployed: [{ sha: '83bd4bf65a60000000000000000000000000000b', committedAt: '2026-08-03T19:42:43+01:00' }],
  now: NOW,
  maxDriftDays: 3,
  ...over,
})

const daysBefore = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString()

describe('assessProductionFreshness', () => {
  test('stale: the 2026-08 outage, where main held undeployed commits for eight weeks', () => {
    const verdict = assessProductionFreshness(facts({}))
    expect(verdict).toMatchObject({ ok: false, code: 'stale' })
    expect(verdict.message).toContain('d2d821cb07f4 (agentic-mermaid@0.4.1, built 2026-07-31T11:27:14Z)')
    expect(verdict.message).toContain('83bd4bf65a60')
    expect(verdict.message).toContain('beyond the 3-day limit')
  })

  test('drift is dated from the oldest undeployed commit, with the limit inclusive', () => {
    const undeployed = (days: number) => [
      { sha: 'a'.repeat(40), committedAt: daysBefore(days) },
      { sha: 'b'.repeat(40), committedAt: daysBefore(0.1) },
    ]
    expect(assessProductionFreshness(facts({ undeployed: undeployed(3) }))).toMatchObject({ ok: true, code: 'within-drift' })
    expect(assessProductionFreshness(facts({ undeployed: undeployed(3.01) }))).toMatchObject({ ok: false, code: 'stale' })
    expect(assessProductionFreshness(facts({ undeployed: undeployed(0.5), maxDriftDays: 0 }))).toMatchObject({ ok: false, code: 'stale' })
  })

  test('current when production serves deployable main or a newer main commit', () => {
    expect(assessProductionFreshness(facts({ relation: 'same', undeployed: [] }))).toMatchObject({ ok: true, code: 'current' })
    expect(assessProductionFreshness(facts({ relation: 'live-ahead', undeployed: [] }))).toMatchObject({ ok: true, code: 'current' })
  })

  test('a build that is not an exact main commit is never fresh', () => {
    for (const gitSha of [`${LIVE}-dirty`, 'development', `${LIVE}-unverified`]) {
      expect(assessProductionFreshness(facts({ live: { gitSha, packageVersion: '0.4.2', buildTime: NOW.toISOString() }, relation: 'same', undeployed: [] })))
        .toMatchObject({ ok: false, code: 'unknown-build' })
    }
    expect(assessProductionFreshness(facts({ relation: 'unrelated', undeployed: [] }))).toMatchObject({ ok: false, code: 'unknown-build' })
  })
})

describe('parseLiveBuild', () => {
  test('reads the generatedFrom stamp and rejects a page without one', () => {
    expect(parseLiveBuild({ generatedFrom: { gitSha: LIVE, packageVersion: '0.4.1', buildTime: '2026-07-31T11:27:14Z' } }))
      .toEqual({ gitSha: LIVE, packageVersion: '0.4.1', buildTime: '2026-07-31T11:27:14Z' })
    expect(() => parseLiveBuild({ sdkVersion: '0.4.1' })).toThrow('no generatedFrom build stamp')
    expect(() => parseLiveBuild({ generatedFrom: { gitSha: LIVE } })).toThrow('incomplete')
  })
})

describe('production-freshness CLI', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'am-freshness-'))
  afterAll(() => rmSync(scratch, { recursive: true, force: true }))

  function git(args: string[], date?: string): string {
    const dated = date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}
    const result = spawnSync('git', args, {
      cwd: scratch,
      encoding: 'utf8',
      env: { ...process.env, GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.com', ...dated },
    })
    if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
    return result.stdout.trim()
  }

  function commit(version: string, daysAgo: number): string {
    writeFileSync(join(scratch, 'package.json'), JSON.stringify({ name: 'agentic-mermaid', version }))
    writeFileSync(join(scratch, 'marker.txt'), `${version} ${daysAgo}`)
    git(['add', '-A'])
    git(['commit', '-q', '-m', `v${version} ${daysAgo}`], new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString())
    return git(['rev-parse', 'HEAD'])
  }

  git(['init', '-q'])
  const deployed = commit('0.4.1', 60)
  const bump = commit('0.4.2', 55)
  const recent = commit('0.4.2', 1)
  const tip = commit('0.4.2', 0.5)

  async function runCli(liveSha: string, deployableSha: string, maxDriftDays = 3) {
    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch: () => Response.json({ generatedFrom: { gitSha: liveSha, packageVersion: '0.4.1', buildTime: '2026-07-31T11:27:14Z' } }),
    })
    try {
      const proc = Bun.spawn(['bun', 'run', SCRIPT, '--deployable-sha', deployableSha, '--max-drift-days', String(maxDriftDays), '--url', `http://127.0.0.1:${server.port}/capabilities.json`], {
        cwd: scratch, stdout: 'pipe', stderr: 'pipe',
      })
      const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
      return { exitCode, stdout, stderr }
    } finally {
      server.stop(true)
    }
  }

  test('fails when production is behind main for longer than the limit', async () => {
    const r = await runCli(deployed, tip)
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toContain('::error title=Production freshness (stale)::')
    expect(r.stdout).toContain(`oldest undeployed commit, ${bump.slice(0, 12)}`)
    expect(r.stdout).toContain('3 main commit(s) ahead')
  })

  test('passes when production serves deployable main, or trails it within the limit', async () => {
    const current = await runCli(tip, tip)
    expect({ exitCode: current.exitCode, notice: current.stdout.includes('::notice title=Production freshness (current)::') }).toEqual({ exitCode: 0, notice: true })
    const drifting = await runCli(bump, tip)
    expect({ exitCode: drifting.exitCode, notice: drifting.stdout.includes('(within-drift)') }).toEqual({ exitCode: 0, notice: true })
    expect(drifting.stdout).toContain(`oldest undeployed commit, ${recent.slice(0, 12)}`)
  })

  test('fails when production serves a commit that is not on main', async () => {
    const r = await runCli('f'.repeat(40), tip)
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toContain('(unknown-build)')
  })
})
