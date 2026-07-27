// Move 10: unit-test the golden-drift gate decision (was inline ci.yml bash).
// All five verdicts are covered, including the precedence (uncommitted drift
// outranks the token check) and the stray-token guard that keeps the token
// meaningful.

import { describe, test, expect } from 'bun:test'
import { evaluateGoldenDrift, githubPushBeforeSha, goldenDriftCommands, parseGitStatusPorcelainZ, APPROVE_TOKEN, type GoldenDriftFacts } from '../../scripts/ci/golden-drift.ts'

const commit = (sha: string, goldenFiles: string[] = [], commitMessage = 'chore: something') => ({ sha, goldenFiles, commitMessage })
const base: GoldenDriftFacts = { uncommittedGoldenFiles: [], headGoldenFiles: [], commits: [commit('abc123')] }
const F = (over: Partial<GoldenDriftFacts>): GoldenDriftFacts => ({ ...base, ...over })

describe('evaluateGoldenDrift', () => {
  test('clean: no golden movement', () => {
    const v = evaluateGoldenDrift(base)
    expect(v).toMatchObject({ ok: true, code: 'clean' })
  })

  test('approved: every golden-changing commit carries its own token', () => {
    const file = 'src/__tests__/testdata/x.txt'
    const v = evaluateGoldenDrift(F({
      headGoldenFiles: [file],
      commits: [commit('abc123', [file], `fix layout\n\n${APPROVE_TOKEN} regenerated flowchart goldens`)],
    }))
    expect(v).toMatchObject({ ok: true, code: 'approved' })
  })

  test('unreviewed-goldens: HEAD changes goldens without token', () => {
    const file = 'src/__tests__/testdata/x.txt'
    const v = evaluateGoldenDrift(F({ headGoldenFiles: [file], commits: [commit('abc123', [file])] }))
    expect(v).toMatchObject({ ok: false, code: 'unreviewed-goldens' })
  })

  test('stray-token: a line starts with the token but no golden change', () => {
    const v = evaluateGoldenDrift(F({ commits: [commit('abc123', [], `docs\n${APPROVE_TOKEN}`)] }))
    expect(v).toMatchObject({ ok: false, code: 'stray-token' })
  })

  // Regression for the footgun this gate hit on its own commits: a commit that
  // merely MENTIONS the token in prose (mid-line) must NOT count as approval.
  test('the token mentioned mid-line in prose does not trigger approval/stray', () => {
    expect(evaluateGoldenDrift(F({ commits: [commit('abc123', [], `docs: document the ${APPROVE_TOKEN} escape hatch`)] })))
      .toMatchObject({ ok: true, code: 'clean' })
    const file = 'src/__tests__/testdata/x.txt'
    expect(evaluateGoldenDrift(F({ headGoldenFiles: [file], commits: [commit('abc123', [file], `feat: mention ${APPROVE_TOKEN} inline`)] })))
      .toMatchObject({ ok: false, code: 'unreviewed-goldens' })
  })

  // Regression for PR #228's CI-only failure: ordinary prose wrapped exactly
  // before the token put it at column 1, followed immediately by punctuation.
  // That is a mention, not the complete approval line the gate documents.
  test('wrapped prose beginning with the token does not become approval', () => {
    const prose = `docs: explain the instruction\n${APPROVE_TOKEN}") is not an approval line`
    expect(evaluateGoldenDrift(F({ commits: [commit('abc123', [], prose)] })))
      .toMatchObject({ ok: true, code: 'clean' })
    const file = 'src/__tests__/testdata/x.txt'
    expect(evaluateGoldenDrift(F({ headGoldenFiles: [file], commits: [commit('abc123', [file], prose)] })))
      .toMatchObject({ ok: false, code: 'unreviewed-goldens' })
  })

  test('an earlier approval cannot bless a later unapproved golden change', () => {
    const first = 'src/__tests__/testdata/first.svg'
    const later = 'src/__tests__/testdata/later.svg'
    const v = evaluateGoldenDrift(F({
      headGoldenFiles: [first, later],
      commits: [
        commit('approved', [first], `render first\n${APPROVE_TOKEN} reviewed first`),
        commit('unapproved', [later], 'render later'),
      ],
    }))
    expect(v).toMatchObject({ ok: false, code: 'unreviewed-goldens' })
    expect(v.message).toContain('unapproved')
  })

  test('a fully reverted golden range is clean when it has no stray token', () => {
    const file = 'src/__tests__/testdata/x.svg'
    expect(evaluateGoldenDrift(F({
      headGoldenFiles: [],
      commits: [commit('add', [file]), commit('revert', [file])],
    }))).toMatchObject({ ok: true, code: 'clean' })
  })

  // A shallow checkout cannot walk the approval range, so the token lookup
  // returns nothing and the gate would report `unreviewed-goldens` — blaming the
  // author for the checkout's depth, with an instruction that does not help
  // because the approval is already there. Refuse instead of approximating.
  test('shallow-history outranks the token check and names the real cause', () => {
    const v = evaluateGoldenDrift(F({
      headGoldenFiles: ['src/__tests__/testdata/x.txt'],
      commits: [],
      truncatedHistory: true,
    }))
    expect(v).toMatchObject({ ok: false, code: 'shallow-history' })
    expect(v.message).toContain('fetch-depth: 0')
    // The misleading verdict it replaces must NOT be what a shallow run reports.
    expect(v.code).not.toBe('unreviewed-goldens')
  })

  test('a complete checkout is unaffected by the shallow guard', () => {
    const file = 'src/__tests__/testdata/x.txt'
    expect(evaluateGoldenDrift(F({
      headGoldenFiles: [file],
      commits: [commit('abc123', [file], `fix\n${APPROVE_TOKEN} reviewed`)],
      truncatedHistory: false,
    }))).toMatchObject({ ok: true, code: 'approved' })
  })

  test('uncommitted-drift outranks everything (even with the token)', () => {
    const v = evaluateGoldenDrift(F({
      uncommittedGoldenFiles: ['src/__tests__/testdata/y.txt'],
      headGoldenFiles: ['src/__tests__/testdata/y.txt'],
      commits: [commit('abc123', ['src/__tests__/testdata/y.txt'], `fix\n${APPROVE_TOKEN}`)],
    }))
    expect(v).toMatchObject({ ok: false, code: 'uncommitted-drift' })
  })

  test('the verdict message always names the token for actionability', () => {
    for (const v of [
      evaluateGoldenDrift(F({ headGoldenFiles: ['src/__tests__/testdata/x.txt'], commits: [commit('abc123', ['src/__tests__/testdata/x.txt'])] })),
      evaluateGoldenDrift(F({ commits: [commit('abc123', [], `x\n${APPROVE_TOKEN}`)] })),
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
    expect(merge.commitsCmd).toContain('base..prhead')

    const push = goldenDriftCommands({ parents: ['tip'], pushBefore: 'before', goldenDir: DIR })
    expect(push.filesCmd).toContain('before..HEAD')
    expect(push.commitsCmd).toContain('before..HEAD')
  })

  // Regression for the failure this gate hit on PR #228. A PR whose NET diff
  // touches goldens but whose TIP commit does not: reading only the tip's
  // message made every commit pushed after an approved golden change re-fail
  // the gate. The range diff still reports the approved file, while the tip
  // message no longer carries the token — so a branch green at the approving
  // commit went red on the next unrelated commit, with no golden movement
  // between them.
  test('merge mode enumerates every PR commit for individual approval checks', () => {
    const { commitsCmd } = goldenDriftCommands({ parents: ['base', 'prhead'], pushBefore: null, goldenDir: DIR })
    expect(commitsCmd).toContain('base..prhead')
    expect(commitsCmd).toContain('--reverse')
  })

  test('a lone non-merge commit with no push payload reads that commit alone', () => {
    const { filesCmd, commitsCmd } = goldenDriftCommands({ parents: ['tip'], pushBefore: null, goldenDir: DIR })
    expect(filesCmd).toContain('git show --name-only')
    expect(commitsCmd).toBe('git rev-parse HEAD')
  })

  // Reading a range of messages requires the range to be in the checkout. This
  // is reported so the CLI can refuse a shallow clone rather than walk an empty
  // range and blame the author — the exact way the first version of this fix
  // failed in CI while passing on a full local clone.
  test('range modes declare that they need history; the single-commit mode does not', () => {
    expect(goldenDriftCommands({ parents: ['base', 'prhead'], pushBefore: null, goldenDir: DIR }).needsRangeHistory).toBe(true)
    expect(goldenDriftCommands({ parents: ['tip'], pushBefore: 'before', goldenDir: DIR }).needsRangeHistory).toBe(true)
    expect(goldenDriftCommands({ parents: ['tip'], pushBefore: null, goldenDir: DIR }).needsRangeHistory).toBe(false)
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
