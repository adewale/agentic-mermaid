// The committed-evidence gate decision (scripts/ci/evidence-policy.ts), unit
// tested like golden-drift: every verdict, the per-commit token binding, and
// the boundary rules that keep the token meaningful. The wiring block at the
// end pins the surfaces that teach the policy — PR template, contributing doc,
// probe script — so the gate cannot silently lose its paper trail.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  APPROVE_TOKEN,
  evaluateEvidencePolicy,
  evidenceRangeCommands,
  mediaEvidencePaths,
  type EvidencePolicyFacts,
} from '../../scripts/ci/evidence-policy.ts'

const ROOT = join(import.meta.dir, '..', '..')
const commit = (sha: string, unreferencedFiles: string[] = [], commitMessage = 'chore: something') => ({ sha, unreferencedFiles, commitMessage })
const base: EvidencePolicyFacts = { unreferencedHeadFiles: [], commits: [commit('abc123')] }
const F = (over: Partial<EvidencePolicyFacts>): EvidencePolicyFacts => ({ ...base, ...over })
const FILE = 'docs/pr-assets/one-shot-before-after.png'

describe('evaluateEvidencePolicy', () => {
  test('clean: no unreferenced evidence committed', () => {
    expect(evaluateEvidencePolicy(base)).toMatchObject({ ok: true, code: 'clean' })
  })

  test('approved: the offending commit carries its own token line', () => {
    const v = evaluateEvidencePolicy(F({
      unreferencedHeadFiles: [FILE],
      commits: [commit('abc123', [FILE], `fix layout\n\n${APPROVE_TOKEN} no gh --attach in this session`)],
    }))
    expect(v).toMatchObject({ ok: true, code: 'approved' })
  })

  test('unreferenced-evidence: one-shot pixels committed without approval', () => {
    const v = evaluateEvidencePolicy(F({ unreferencedHeadFiles: [FILE], commits: [commit('abc123', [FILE])] }))
    expect(v).toMatchObject({ ok: false, code: 'unreferenced-evidence' })
    expect(v.message).toContain(FILE)
    expect(v.message).toContain('--attach')
    expect(v.message).toContain('docs/contributing/visual-review-evidence.md')
  })

  test('per-commit binding: one approved commit does not bless another', () => {
    const other = 'docs/pr-assets/second.png'
    const v = evaluateEvidencePolicy(F({
      unreferencedHeadFiles: [FILE, other],
      commits: [
        commit('aaa111', [FILE], `evidence\n\n${APPROVE_TOKEN} attach unavailable`),
        commit('bbb222', [other]),
      ],
    }))
    expect(v).toMatchObject({ ok: false, code: 'unreferenced-evidence' })
    expect(v.message).toContain('bbb222')
  })

  test('stray-token: a token line with nothing to approve fails', () => {
    const v = evaluateEvidencePolicy(F({ commits: [commit('abc123', [], `docs\n${APPROVE_TOKEN}`)] }))
    expect(v).toMatchObject({ ok: false, code: 'stray-token' })
  })

  test('the token mentioned mid-line in prose does not approve or stray', () => {
    expect(evaluateEvidencePolicy(F({ commits: [commit('abc123', [], `docs: document the ${APPROVE_TOKEN} escape hatch`)] })))
      .toMatchObject({ ok: true, code: 'clean' })
    expect(evaluateEvidencePolicy(F({ unreferencedHeadFiles: [FILE], commits: [commit('abc123', [FILE], `feat: mention ${APPROVE_TOKEN} inline`)] })))
      .toMatchObject({ ok: false, code: 'unreferenced-evidence' })
  })

  test('wrapped prose beginning with the token is a mention, not approval', () => {
    const prose = `docs: explain the instruction\n${APPROVE_TOKEN}") is not an approval line`
    expect(evaluateEvidencePolicy(F({ commits: [commit('abc123', [], prose)] })))
      .toMatchObject({ ok: true, code: 'clean' })
    expect(evaluateEvidencePolicy(F({ unreferencedHeadFiles: [FILE], commits: [commit('abc123', [FILE], prose)] })))
      .toMatchObject({ ok: false, code: 'unreferenced-evidence' })
  })

  test('shallow-history: an unwalkable approval range is refused, not misread', () => {
    const v = evaluateEvidencePolicy(F({ truncatedHistory: true, unreferencedHeadFiles: [FILE] }))
    expect(v).toMatchObject({ ok: false, code: 'shallow-history' })
  })
})

describe('mediaEvidencePaths', () => {
  test('keeps only attachable media under docs/pr-assets/', () => {
    expect(mediaEvidencePaths([
      'docs/pr-assets/a.png',
      'docs/pr-assets/nested/b.JPG',
      'docs/pr-assets/clip.mp4',
      'docs/pr-assets/vector.svg',
      'docs/pr-assets/readme.md',        // not media
      'docs/pr-assets/receipt.json',     // not media
      'docs/assets/elsewhere.png',       // outside the evidence dir
      'src/__tests__/testdata/x.png',    // goldens are golden-drift's business
    ])).toEqual([
      'docs/pr-assets/a.png',
      'docs/pr-assets/nested/b.JPG',
      'docs/pr-assets/clip.mp4',
      'docs/pr-assets/vector.svg',
    ])
  })
})

describe('evidenceRangeCommands', () => {
  test('a PR merge ref compares its parents, filtered to additions and edits', () => {
    const c = evidenceRangeCommands({ parents: ['base0', 'head1'], pushBefore: null })
    expect(c.filesCmd).toBe('git diff --name-only --diff-filter=AM base0 head1 -- docs/pr-assets/')
    expect(c.commitsCmd).toBe('git rev-list --reverse base0..head1')
    expect(c.headTree).toBe('head1')
    expect(c.needsRangeHistory).toBe(true)
  })

  test('a push compares the before SHA; a bare HEAD evaluates one commit', () => {
    const push = evidenceRangeCommands({ parents: ['only0'], pushBefore: 'before9' })
    expect(push.filesCmd).toBe('git diff --name-only --diff-filter=AM before9..HEAD -- docs/pr-assets/')
    expect(push.headTree).toBe('HEAD')
    expect(push.needsRangeHistory).toBe(true)
    const single = evidenceRangeCommands({ parents: ['only0'], pushBefore: null })
    expect(single.filesCmd).toBe('git show --name-only --diff-filter=AM --format= HEAD -- docs/pr-assets/')
    expect(single.commitsCmd).toBe('git rev-parse HEAD')
    expect(single.needsRangeHistory).toBe(false)
  })
})

describe('evidence policy wiring', () => {
  test('the surfaces agents read teach the token and the probe', () => {
    const template = readFileSync(join(ROOT, '.github/PULL_REQUEST_TEMPLATE.md'), 'utf8')
    const doc = readFileSync(join(ROOT, 'docs/contributing/visual-review-evidence.md'), 'utf8')
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
    expect(template).toContain(APPROVE_TOKEN)
    expect(doc).toContain(APPROVE_TOKEN)
    expect(doc).toContain('bun run evidence:probe')
    expect(pkg.scripts['evidence:probe']).toBe('bun run scripts/ci/evidence-policy.ts --probe')
  })
})
