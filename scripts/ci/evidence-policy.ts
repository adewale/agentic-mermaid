// The committed-evidence gate. docs/contributing/visual-review-evidence.md
// splits evidence into living artifacts (committed, kept current by a receipt,
// baseline, test, or doc) and one-shot PR evidence (attached to the PR via
// `gh --attach`, never committed). Prose alone does not change agent behavior,
// so this gate makes the split executable, and the rule is deliberately blunt:
// a commit that ADDS media under docs/pr-assets/ must carry an explicit
// approval line, because one-shot evidence has its own gitignored home
// (docs/pr-assets/attached/) and never lands there — so a new committed
// evidence file is always a deliberate act: a new living artifact, or the
// fallback for a session that cannot attach (no gh, or a gh without
// --attach). Modifying or deleting an existing committed asset needs no
// approval: the commit-vs-attach decision was made when the path first
// landed, and regenerations are kept honest by their own byte/receipt gates.
// Structure mirrors golden-drift.ts: the decision is a pure function
// unit-tested in src/__tests__/evidence-policy.test.ts; the CLI wrapper
// gathers git facts and maps the verdict to GitHub annotations + exit code.
// quality-gates.ts runs `bun run scripts/ci/evidence-policy.ts`; `--probe`
// reports which evidence path the current environment supports.

import { githubPushBeforeSha } from './golden-drift.ts'

export const EVIDENCE_DIR = 'docs/pr-assets/'
/** The media set `gh --attach` accepts — the files this policy governs. */
export const ATTACHABLE_MEDIA_RE = /\.(png|jpe?g|gif|webp|svg|mp4|mov|webm)$/i

export const APPROVE_TOKEN = '[approve-committed-evidence]'
// Same boundary rule as [approve-goldens]: the token only counts as a complete
// line, so prose that merely mentions it (this file included) is not approval.
export const APPROVE_TOKEN_RE = /^[ \t]*\[approve-committed-evidence\](?:[ \t]+.*)?[ \t]*$/m

export function mediaEvidencePaths(paths: string[]): string[] {
  return paths.filter(path => path.startsWith(EVIDENCE_DIR) && ATTACHABLE_MEDIA_RE.test(path))
}

export interface EvidencePolicyFacts {
  /** Media newly added under docs/pr-assets/ across the evaluated range. */
  addedHeadFiles: string[]
  /** Every commit in the range, with its own added media. */
  commits: Array<{
    sha: string
    addedFiles: string[]
    commitMessage: string
  }>
  /** Same refusal as golden-drift: a range the shallow checkout cannot walk. */
  truncatedHistory?: boolean
}

export type EvidencePolicyCode =
  | 'clean'                // no evidence media added
  | 'approved'             // every adding commit carries the token
  | 'unapproved-evidence'  // evidence media added without approval
  | 'stray-token'          // token present but nothing to approve
  | 'shallow-history'      // approval spans a range the checkout cannot walk

export interface EvidencePolicyVerdict {
  ok: boolean
  code: EvidencePolicyCode
  message: string
}

export function evaluateEvidencePolicy(f: EvidencePolicyFacts): EvidencePolicyVerdict {
  if (f.truncatedHistory) {
    return {
      ok: false,
      code: 'shallow-history',
      message: `Approval spans a commit range, but the checkout is shallow so the range cannot be read — the gate would find no ${APPROVE_TOKEN} even where one exists. Check out with fetch-depth: 0.`,
    }
  }
  const stray = f.commits.find(commit => APPROVE_TOKEN_RE.test(commit.commitMessage) && commit.addedFiles.length === 0)
  if (stray) {
    return { ok: false, code: 'stray-token', message: `Commit ${stray.sha} starts a line with ${APPROVE_TOKEN} but adds no evidence media under ${EVIDENCE_DIR}. Remove the stray approval line.` }
  }
  // A range whose additions net out (added then deleted) has nothing left to
  // review, mirroring golden-drift's net-zero rule.
  if (f.addedHeadFiles.length === 0) {
    return { ok: true, code: 'clean', message: 'No committed evidence added.' }
  }
  const unapproved = f.commits.find(commit => commit.addedFiles.length > 0 && !APPROVE_TOKEN_RE.test(commit.commitMessage))
  if (unapproved) {
    return {
      ok: false,
      code: 'unapproved-evidence',
      message:
        `Commit ${unapproved.sha} adds evidence media under ${EVIDENCE_DIR} (${unapproved.addedFiles.join(', ')}). ` +
        `One-shot evidence is attached, not committed: write renders to docs/pr-assets/attached/ (gitignored) and pass them to \`gh pr create|comment --attach\` — \`bun run evidence:probe\` reports whether this environment can. ` +
        `If the file is a living artifact (kept current by a receipt, baseline, test, or doc) or this session cannot attach, keep it committed and start a commit-message line with ${APPROVE_TOKEN}. ` +
        `See docs/contributing/visual-review-evidence.md.`,
    }
  }
  return { ok: true, code: 'approved', message: `Every commit adding evidence is approved via ${APPROVE_TOKEN}.` }
}

/**
 * Which commits the gate reads, mirroring goldenDriftCommands: PR merge refs
 * compare their two parents, pushes compare the before SHA, and a bare HEAD
 * evaluates the single commit. Only additions are gated — modifications and
 * deletions of already-committed assets are exempt on purpose — so the file
 * diffs filter to A.
 */
export function evidenceRangeCommands(o: { parents: string[]; pushBefore: string | null }): {
  filesCmd: string
  commitsCmd: string
  needsRangeHistory: boolean
} {
  if (o.parents.length >= 2) {
    const [base, prHead] = o.parents
    return {
      filesCmd: `git diff --name-only --diff-filter=A ${base} ${prHead} -- ${EVIDENCE_DIR}`,
      commitsCmd: `git rev-list --reverse ${base}..${prHead}`,
      needsRangeHistory: true,
    }
  }
  if (o.pushBefore) {
    return {
      filesCmd: `git diff --name-only --diff-filter=A ${o.pushBefore}..HEAD -- ${EVIDENCE_DIR}`,
      commitsCmd: `git rev-list --reverse ${o.pushBefore}..HEAD`,
      needsRangeHistory: true,
    }
  }
  return {
    filesCmd: `git show --name-only --diff-filter=A --format= HEAD -- ${EVIDENCE_DIR}`,
    commitsCmd: 'git rev-parse HEAD',
    needsRangeHistory: false,
  }
}

// ---- CLI wrapper: gather git facts, annotate, exit ------------------------

if (import.meta.main) {
  const { execSync } = await import('node:child_process')
  const run = (cmd: string) => execSync(cmd, { encoding: 'utf8' })
  const lines = (cmd: string) =>
    run(cmd).split('\n').map(s => s.trim()).filter(Boolean)

  if (process.argv.includes('--probe')) {
    // Capability probe for agents deciding an evidence path before a PR.
    // Informational: always exits 0.
    let helpText = ''
    try {
      helpText = run('gh pr comment --help 2>&1')
    } catch {
      helpText = ''
    }
    if (/--attach\b/.test(helpText)) {
      process.stdout.write(`gh supports --attach. Attach one-shot evidence: write renders to docs/pr-assets/attached/ and pass each to \`gh pr create|comment --attach './file.png#caption'\`. Commit only living, receipt-gated artifacts.\n`)
    } else {
      const why = helpText === '' ? 'gh is not available in this session' : 'this gh has no --attach (stable releases through v2.98.0 lack it)'
      process.stdout.write(`Fallback path: ${why}. Commit one-shot evidence under ${EVIDENCE_DIR} with head-pinned URLs in the PR body, and start a commit-message line with ${APPROVE_TOKEN}. See docs/contributing/visual-review-evidence.md.\n`)
    }
    process.exit(0)
  }

  // Same merge-ref unpacking as golden-drift: on a `pull_request` build HEAD
  // is synthetic, so the PR's own net change is its two parents' diff.
  const parents = run('git rev-list --parents -n 1 HEAD').trim().split(/\s+/).slice(1)
  let pushBefore: string | null = null
  if (parents.length < 2 && process.env.GITHUB_EVENT_PATH) {
    const { readFileSync } = await import('node:fs')
    pushBefore = githubPushBeforeSha(process.env.GITHUB_EVENT_NAME, readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
  }
  const { filesCmd, commitsCmd, needsRangeHistory } = evidenceRangeCommands({ parents, pushBefore })
  const shallow = run('git rev-parse --is-shallow-repository').trim() === 'true'
  const commits = lines(commitsCmd).map(sha => ({
    sha,
    addedFiles: mediaEvidencePaths(
      lines(`git diff-tree --root --no-commit-id --name-only --diff-filter=A -r -m ${sha} -- ${EVIDENCE_DIR}`),
    ),
    commitMessage: run(`git log -1 --format=%B ${sha}`),
  }))

  const facts: EvidencePolicyFacts = {
    addedHeadFiles: mediaEvidencePaths(lines(filesCmd)),
    commits,
    truncatedHistory: needsRangeHistory && shallow,
  }
  const v = evaluateEvidencePolicy(facts)
  if (v.ok) {
    process.stdout.write(`::notice title=Committed evidence::${v.message}\n`)
    process.exit(0)
  }
  process.stdout.write(`::error title=Committed evidence (${v.code})::${v.message}\n`)
  process.exit(1)
}
