// The committed-evidence gate. docs/contributing/visual-review-evidence.md
// splits evidence into living artifacts (committed, kept current by a receipt,
// baseline, test, or doc that names them) and one-shot PR evidence (attached
// to the PR via `gh --attach`, never committed). Prose alone does not change
// agent behavior, so this gate makes the split executable: media committed
// under docs/pr-assets/ must have an in-repo consumer that names its full
// repository path, or the commit must carry an explicit approval line — the
// deliberate fallback for sessions that cannot attach (no gh, or a gh without
// --attach). Structure mirrors golden-drift.ts: the decision is a pure
// function unit-tested in src/__tests__/evidence-policy.test.ts; the CLI
// wrapper gathers git facts and maps the verdict to GitHub annotations + exit
// code. quality-gates.ts runs `bun run scripts/ci/evidence-policy.ts`;
// `--probe` reports which evidence path the current environment supports.

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
  /**
   * Media added or modified under docs/pr-assets/ across the evaluated range
   * that NO tracked text file at the range head names by full repository path.
   * Referenced-ness is judged at the head so a PR may add the asset in one
   * commit and its receipt/doc consumer in a later one.
   */
  unreferencedHeadFiles: string[]
  /** Every commit in the range, with its own share of those files. */
  commits: Array<{
    sha: string
    unreferencedFiles: string[]
    commitMessage: string
  }>
  /** Same refusal as golden-drift: a range the shallow checkout cannot walk. */
  truncatedHistory?: boolean
}

export type EvidencePolicyCode =
  | 'clean'                  // no unreferenced evidence committed
  | 'approved'               // every offending commit carries the token
  | 'unreferenced-evidence'  // one-shot pixels committed without approval
  | 'stray-token'            // token present but nothing to approve
  | 'shallow-history'        // approval spans a range the checkout cannot walk

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
  const stray = f.commits.find(commit => APPROVE_TOKEN_RE.test(commit.commitMessage) && commit.unreferencedFiles.length === 0)
  if (stray) {
    return { ok: false, code: 'stray-token', message: `Commit ${stray.sha} starts a line with ${APPROVE_TOKEN} but adds or modifies no unreferenced evidence media under ${EVIDENCE_DIR}. Remove the stray approval line.` }
  }
  if (f.unreferencedHeadFiles.length === 0) {
    return { ok: true, code: 'clean', message: 'No unreferenced committed evidence.' }
  }
  const unapproved = f.commits.find(commit => commit.unreferencedFiles.length > 0 && !APPROVE_TOKEN_RE.test(commit.commitMessage))
  if (unapproved) {
    return {
      ok: false,
      code: 'unreferenced-evidence',
      message:
        `Commit ${unapproved.sha} commits evidence media under ${EVIDENCE_DIR} that nothing in the repository names by full path (${unapproved.unreferencedFiles.join(', ')}). ` +
        `One-shot evidence is attached, not committed: write renders to docs/pr-assets/attached/ (gitignored) and pass them to \`gh pr create|comment --attach\` — \`bun run evidence:probe\` reports whether this environment can. ` +
        `A living artifact instead needs the consumer that keeps it current: a receipt, baseline, test, or doc naming its full repository path. ` +
        `Only when attaching is impossible here (no gh, or a gh without --attach), keep the file committed and start a commit-message line with ${APPROVE_TOKEN}. ` +
        `See docs/contributing/visual-review-evidence.md.`,
    }
  }
  return { ok: true, code: 'approved', message: `Every commit adding unreferenced evidence is approved via ${APPROVE_TOKEN}.` }
}

/**
 * Which commits and trees the gate reads, mirroring goldenDriftCommands: PR
 * merge refs compare their two parents, pushes compare the before SHA, and a
 * bare HEAD evaluates the single commit. Deletions are exempt on purpose —
 * removing committed pixels is the direction the policy encourages — so the
 * file diffs filter to added/modified. `headTree` is where referenced-ness is
 * judged.
 */
export function evidenceRangeCommands(o: { parents: string[]; pushBefore: string | null }): {
  filesCmd: string
  commitsCmd: string
  headTree: string
  needsRangeHistory: boolean
} {
  if (o.parents.length >= 2) {
    const [base, prHead] = o.parents
    return {
      filesCmd: `git diff --name-only --diff-filter=AM ${base} ${prHead} -- ${EVIDENCE_DIR}`,
      commitsCmd: `git rev-list --reverse ${base}..${prHead}`,
      headTree: prHead!,
      needsRangeHistory: true,
    }
  }
  if (o.pushBefore) {
    return {
      filesCmd: `git diff --name-only --diff-filter=AM ${o.pushBefore}..HEAD -- ${EVIDENCE_DIR}`,
      commitsCmd: `git rev-list --reverse ${o.pushBefore}..HEAD`,
      headTree: 'HEAD',
      needsRangeHistory: true,
    }
  }
  return {
    filesCmd: `git show --name-only --diff-filter=AM --format= HEAD -- ${EVIDENCE_DIR}`,
    commitsCmd: 'git rev-parse HEAD',
    headTree: 'HEAD',
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
  const { filesCmd, commitsCmd, headTree, needsRangeHistory } = evidenceRangeCommands({ parents, pushBefore })
  const shallow = run('git rev-parse --is-shallow-repository').trim() === 'true'

  // Referenced-ness: some tracked text file at the head tree, outside
  // docs/pr-assets/ itself, contains the asset's full repository path. Every
  // sanctioned consumer (evidence receipts, eval baselines, contributing docs,
  // the citizenship matrix, tests) names assets that way; a generator writing
  // the file via join() fragments is not a consumer and does not count.
  const referenced = (path: string): boolean => {
    try {
      return run(`git grep -I --fixed-strings -l -e "${path}" ${headTree} -- ':(exclude)docs/pr-assets'`).trim() !== ''
    } catch {
      return false // git grep exits 1 when nothing matches
    }
  }
  const headEvidence = mediaEvidencePaths(lines(filesCmd))
  const unreferencedHead = new Set(headEvidence.filter(path => !referenced(path)))
  const commits = lines(commitsCmd).map(sha => ({
    sha,
    unreferencedFiles: mediaEvidencePaths(
      lines(`git diff-tree --root --no-commit-id --name-only --diff-filter=AM -r -m ${sha} -- ${EVIDENCE_DIR}`),
    ).filter(path => unreferencedHead.has(path)),
    commitMessage: run(`git log -1 --format=%B ${sha}`),
  }))

  const facts: EvidencePolicyFacts = {
    unreferencedHeadFiles: [...unreferencedHead],
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
