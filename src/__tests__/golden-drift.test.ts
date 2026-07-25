// Move 10: unit-test the golden-drift gate decision (was inline ci.yml bash).
// All five verdicts are covered, including the precedence (uncommitted drift
// outranks the token check) and the stray-token guard that keeps the token
// meaningful.

import { describe, test, expect } from 'bun:test'
import { evaluateGoldenDrift, githubPushBeforeSha, goldenDriftCommands, parseGitStatusPorcelainZ, APPROVE_TOKEN, type GoldenDriftFacts } from '../../scripts/ci/golden-drift.ts'

const base: GoldenDriftFacts = { uncommittedGoldenFiles: [], headGoldenFiles: [], commitMessage: 'chore: something' }
const F = (over: Partial<GoldenDriftFacts>): GoldenDriftFacts => ({ ...base, ...over })

describe('evaluateGoldenDrift', () => {
  test('clean: no golden movement', () => {
    const v = evaluateGoldenDrift(base)
    expect(v).toMatchObject({ ok: true, code: 'clean' })
  })

  test('approved: HEAD changes goldens AND a line starts with the token', () => {
    const v = evaluateGoldenDrift(F({ headGoldenFiles: ['src/__tests__/testdata/x.txt'], commitMessage: `fix layout\n\n${APPROVE_TOKEN} regenerated flowchart goldens` }))
    expect(v).toMatchObject({ ok: true, code: 'approved' })
  })

  test('unreviewed-goldens: HEAD changes goldens without token', () => {
    const v = evaluateGoldenDrift(F({ headGoldenFiles: ['src/__tests__/testdata/x.txt'] }))
    expect(v).toMatchObject({ ok: false, code: 'unreviewed-goldens' })
  })

  test('stray-token: a line starts with the token but no golden change', () => {
    const v = evaluateGoldenDrift(F({ commitMessage: `docs\n${APPROVE_TOKEN}` }))
    expect(v).toMatchObject({ ok: false, code: 'stray-token' })
  })

  // Regression for the footgun this gate hit on its own commits: a commit that
  // merely MENTIONS the token in prose (mid-line) must NOT count as approval.
  test('the token mentioned mid-line in prose does not trigger approval/stray', () => {
    expect(evaluateGoldenDrift(F({ commitMessage: `docs: document the ${APPROVE_TOKEN} escape hatch` })))
      .toMatchObject({ ok: true, code: 'clean' })
    expect(evaluateGoldenDrift(F({ headGoldenFiles: ['src/__tests__/testdata/x.txt'], commitMessage: `feat: mention ${APPROVE_TOKEN} inline` })))
      .toMatchObject({ ok: false, code: 'unreviewed-goldens' })
  })

  test('uncommitted-drift outranks everything (even with the token)', () => {
    const v = evaluateGoldenDrift(F({
      uncommittedGoldenFiles: ['src/__tests__/testdata/y.txt'],
      headGoldenFiles: ['src/__tests__/testdata/y.txt'],
      commitMessage: `fix\n${APPROVE_TOKEN}`,
    }))
    expect(v).toMatchObject({ ok: false, code: 'uncommitted-drift' })
  })

  test('the verdict message always names the token for actionability', () => {
    for (const v of [
      evaluateGoldenDrift(F({ headGoldenFiles: ['src/__tests__/testdata/x.txt'] })),
      evaluateGoldenDrift(F({ commitMessage: `x\n${APPROVE_TOKEN}` })),
      evaluateGoldenDrift(F({ uncommittedGoldenFiles: ['src/__tests__/testdata/x.txt'] })),
    ]) {
      expect(v.message).toContain(APPROVE_TOKEN)
    }
  })
})

describe('parseGitStatusPorcelainZ', () => {
  test('captures tracked modifications and untracked generated goldens', () => {
    const out = [
      ' M src/__tests__/testdata/existing.svg',
      '?? src/__tests__/testdata/new.svg',
      '',
    ].join('\0')
    expect(parseGitStatusPorcelainZ(out)).toEqual([
      'src/__tests__/testdata/existing.svg',
      'src/__tests__/testdata/new.svg',
    ])
  })

  test('reports the destination path for renamed/copied porcelain entries', () => {
    const out = [
      'R  src/__tests__/testdata/new-name.svg',
      'src/__tests__/testdata/old-name.svg',
      'C  src/__tests__/testdata/copied.svg',
      'src/__tests__/testdata/source.svg',
      '',
    ].join('\0')
    expect(parseGitStatusPorcelainZ(out)).toEqual([
      'src/__tests__/testdata/new-name.svg',
      'src/__tests__/testdata/copied.svg',
    ])
  })

  test('feeds untracked files into the uncommitted-drift verdict', () => {
    const [untracked] = parseGitStatusPorcelainZ('?? src/__tests__/testdata/new.svg\0')
    const v = evaluateGoldenDrift(F({ uncommittedGoldenFiles: [untracked!] }))
    expect(v).toMatchObject({ ok: false, code: 'uncommitted-drift' })
  })
})

describe('goldenDriftCommands', () => {
  const DIR = 'src/__tests__/testdata/'

  // The invariant the whole gate rests on: whichever commits decide "did the
  // goldens move" must be the same commits that decide "was it approved".
  test('every mode scopes files and approval to the same commits', () => {
    const merge = goldenDriftCommands({ parents: ['base', 'prhead'], pushBefore: null, goldenDir: DIR })
    expect(merge.filesCmd).toContain('base prhead')
    expect(merge.messageCmd).toContain('base..prhead')

    const push = goldenDriftCommands({ parents: ['tip'], pushBefore: 'before', goldenDir: DIR })
    expect(push.filesCmd).toContain('before..HEAD')
    expect(push.messageCmd).toContain('before..HEAD')
  })

  // Regression for the failure this gate hit on PR #228. A PR whose NET diff
  // touches goldens but whose TIP commit does not: reading only the tip's
  // message made every commit pushed after an approved golden change re-fail
  // the gate. The range diff still reports the approved file, while the tip
  // message no longer carries the token — so a branch green at the approving
  // commit went red on the next unrelated commit, with no golden movement
  // between them.
  test('merge mode reads approval from the whole PR, not just the tip commit', () => {
    const { messageCmd } = goldenDriftCommands({ parents: ['base', 'prhead'], pushBefore: null, goldenDir: DIR })
    expect(messageCmd).toContain('base..prhead')
    expect(messageCmd).not.toContain('-1')
  })

  test('a lone non-merge commit with no push payload reads that commit alone', () => {
    const { filesCmd, messageCmd } = goldenDriftCommands({ parents: ['tip'], pushBefore: null, goldenDir: DIR })
    expect(filesCmd).toContain('git show --name-only')
    expect(messageCmd).toBe('git log -1 --format=%B')
  })

  test('the file scope is always confined to the golden directory', () => {
    for (const o of [
      { parents: ['base', 'prhead'], pushBefore: null },
      { parents: ['tip'], pushBefore: 'before' },
      { parents: ['tip'], pushBefore: null },
    ]) {
      expect(goldenDriftCommands({ ...o, goldenDir: DIR }).filesCmd).toContain(`-- ${DIR}`)
    }
  })
})

describe('githubPushBeforeSha', () => {
  test('extracts the before SHA from GitHub push event JSON', () => {
    expect(githubPushBeforeSha('push', JSON.stringify({
      before: '0123456789abcdef0123456789abcdef01234567',
    }))).toBe('0123456789abcdef0123456789abcdef01234567')
  })

  test('ignores non-push, branch-creation, malformed, and missing payloads', () => {
    expect(githubPushBeforeSha('pull_request', JSON.stringify({
      before: '0123456789abcdef0123456789abcdef01234567',
    }))).toBeNull()
    expect(githubPushBeforeSha('push', JSON.stringify({
      before: '0000000000000000000000000000000000000000',
    }))).toBeNull()
    expect(githubPushBeforeSha('push', '{')).toBeNull()
    expect(githubPushBeforeSha('push', undefined)).toBeNull()
  })
})
