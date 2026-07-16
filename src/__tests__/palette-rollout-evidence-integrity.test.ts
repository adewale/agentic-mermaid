import { describe, expect, test } from 'bun:test'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  cleanHeadCommit,
  verifyBaselineCommit,
  verifyFrozenBaselineRender,
  verifiedBaselineCases,
  type BaselineFile,
} from '../../scripts/pr-assets/palette-rollout-evidence.ts'

const ROOT = join(import.meta.dir, '..', '..')
const BASELINE_DIR = join(ROOT, 'eval', 'palette-rollout', 'baseline')

function git(root: string, ...args: string[]): void {
  const result = Bun.spawnSync(['git', ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
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

  test('binds every frozen SVG byte to the named historical renderer commit', async () => {
    const baseline = JSON.parse(readFileSync(join(BASELINE_DIR, 'baseline.json'), 'utf8')) as BaselineFile
    await expect(verifyFrozenBaselineRender(baseline.commit, BASELINE_DIR, ROOT)).resolves.toBeUndefined()

    const corrupted = mkdtempSync(join(tmpdir(), 'palette-baseline-svg-'))
    try {
      cpSync(BASELINE_DIR, corrupted, { recursive: true })
      const path = join(corrupted, 'xychart-github-light.svg')
      writeFileSync(path, `${readFileSync(path, 'utf8')}\n`)
      await expect(verifyFrozenBaselineRender(baseline.commit, corrupted, ROOT))
        .rejects.toThrow('does not match the renderer at commit')
    } finally {
      rmSync(corrupted, { recursive: true, force: true })
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
