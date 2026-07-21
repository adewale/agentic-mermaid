import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  cleanHeadCommit,
  verifyBaselineCommit,
  verifiedBaselineCases,
  type BaselineFile,
} from '../../scripts/pr-assets/palette-rollout-evidence.ts'

const ROOT = join(import.meta.dir, '..', '..')
const BASELINE_DIR = join(ROOT, 'eval', 'palette-rollout', 'baseline')

function git(root: string, ...args: string[]): string {
  const result = Bun.spawnSync(['git', ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
  return result.stdout.toString().trim()
}

describe('palette rollout evidence integrity', () => {
  test('reconstructs every manifest color and metric from the frozen SVGs', () => {
    const baseline = JSON.parse(readFileSync(join(BASELINE_DIR, 'baseline.json'), 'utf8')) as BaselineFile
    expect(verifiedBaselineCases(baseline, BASELINE_DIR)).toHaveLength(8)

    const corrupted = structuredClone(baseline)
    corrupted.cases[0]!.metrics.unique -= 1
    expect(() => verifiedBaselineCases(corrupted, BASELINE_DIR))
      .toThrow('manifest metrics/colors for xychart-github-light do not match its frozen SVG')
  })

  test('rejects a false or unreachable baseline commit label', () => {
    expect(() => verifyBaselineCommit('0'.repeat(40), ROOT))
      .toThrow('does not resolve to a commit in this repository')
  })

  test('accepts a reviewed development-line commit after a squash merge', () => {
    const repo = mkdtempSync(join(tmpdir(), 'palette-baseline-squash-'))
    try {
      git(repo, 'init', '--quiet')
      git(repo, 'config', 'user.name', 'Palette Evidence')
      git(repo, 'config', 'user.email', 'evidence@example.test')
      writeFileSync(join(repo, 'source.txt'), 'base\n')
      git(repo, 'add', 'source.txt')
      git(repo, 'commit', '--quiet', '-m', 'base')
      const base = git(repo, 'rev-parse', 'HEAD')

      git(repo, 'checkout', '--quiet', '-b', 'development-line')
      writeFileSync(join(repo, 'source.txt'), 'reviewed baseline\n')
      git(repo, 'commit', '--quiet', '-am', 'reviewed baseline')
      const baseline = git(repo, 'rev-parse', 'HEAD')

      git(repo, 'checkout', '--quiet', '-b', 'squash-result', base)
      writeFileSync(join(repo, 'source.txt'), 'squash result\n')
      git(repo, 'commit', '--quiet', '-am', 'squash merge')
      const ancestry = Bun.spawnSync(['git', 'merge-base', '--is-ancestor', baseline, 'HEAD'], { cwd: repo })
      expect(ancestry.exitCode).toBe(1)
      expect(() => verifyBaselineCommit(baseline, repo)).not.toThrow()
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  test('only assigns a commit identity to a completely clean worktree', () => {
    const repo = mkdtempSync(join(tmpdir(), 'palette-baseline-git-'))
    try {
      git(repo, 'init', '--quiet')
      writeFileSync(join(repo, 'tracked.txt'), 'committed\n')
      git(repo, 'add', 'tracked.txt')
      git(repo, '-c', 'user.name=Palette Evidence', '-c', 'user.email=evidence@example.test', 'commit', '--quiet', '-m', 'baseline')

      expect(cleanHeadCommit(repo)).toMatch(/^[0-9a-f]{40}$/)
      writeFileSync(join(repo, 'untracked.txt'), 'not committed\n')
      expect(() => cleanHeadCommit(repo)).toThrow('Refusing to record a palette baseline from a dirty worktree')
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  test('both palette evidence checks are hard CI quality gates', async () => {
    const { parse } = await import('yaml')
    const workflow = parse(readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8'))
    const commands = workflow.jobs.quality.steps.map((step: { run?: string }) => step.run).filter(Boolean)
    expect(commands).toContain('bun run gallery:palette-rollout:check')
    expect(commands).toContain('bun run gallery:palette-harmony:check')
  })
})
