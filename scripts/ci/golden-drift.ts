// Move 10: the golden-snapshot drift gate, as testable code instead of inline
// YAML. The decision logic (the trickiest new CI behavior) is a pure function
// unit-tested in src/__tests__/golden-drift.test.ts; the CLI wrapper gathers the
// git facts and maps the verdict to GitHub annotations + exit code. ci.yml calls
// `bun run scripts/ci/golden-drift.ts`.

export interface GoldenDriftFacts {
  /** Committed goldens with UNcommitted working-tree changes (suite regenerated them). */
  uncommittedGoldenFiles: string[]
  /** Net golden changes across the evaluated PR/push/single-commit range. */
  headGoldenFiles: string[]
  /** Every commit in the evaluated range, with its own golden diff and message. */
  commits: Array<{
    sha: string
    goldenFiles: string[]
    commitMessage: string
  }>
  /**
   * True when approval spans a RANGE of commits but the checkout is shallow, so
   * the range cannot be walked. Without this the gate reads an empty message
   * list, finds no token, and reports `unreviewed-goldens` — blaming the author
   * for the checkout's depth. Silently under-reading is the worst failure a gate
   * like this can have, so it is refused rather than approximated.
   */
  truncatedHistory?: boolean
}

export type GoldenDriftCode =
  | 'clean'               // no golden movement, or movement properly approved
  | 'approved'            // HEAD changes goldens AND carries the token
  | 'uncommitted-drift'   // running the suite left goldens dirty
  | 'unreviewed-goldens'  // HEAD changes goldens without the token
  | 'stray-token'         // token present but HEAD changes no goldens
  | 'shallow-history'     // approval spans a range the checkout cannot walk

export interface GoldenDriftVerdict {
  ok: boolean
  code: GoldenDriftCode
  message: string
}

export const APPROVE_TOKEN = '[approve-goldens]'
// The token only counts at the START of a line. A bare substring match trips on
// any commit that merely *mentions* the token in prose (e.g. a commit that
// documents this very gate), so approval must be deliberate: a line that begins
// with [approve-goldens]. An approval is a complete line: either the bare token
// or the token followed by whitespace and a review note. Requiring that
// boundary keeps wrapped prose such as `[approve-goldens]") is ...` from
// becoming an accidental approval merely because Markdown put it at column 1.
export const APPROVE_TOKEN_RE = /^[ \t]*\[approve-goldens\](?:[ \t]+.*)?[ \t]*$/m

/**
 * Which commits the gate reads — for the net FILE diff and for per-commit
 * APPROVAL. The two must always cover the same range.
 *
 * A range-wide concatenated message is unsafe in the opposite direction: one
 * old token can bless a later unrelated golden change. Return the commit list
 * separately so the wrapper binds each token to that commit's own file diff.
 */
export function goldenDriftCommands(o: {
  parents: string[]
  pushBefore: string | null
  goldenDir: string
}): { filesCmd: string; commitsCmd: string; needsRangeHistory: boolean } {
  // A `pull_request` checkout is the MERGE ref: HEAD is synthetic, parents are
  // [base, prHead]. Compare the parents directly to scope the gate to the PR's
  // own net change — that needs no merge base. Walking the message range DOES
  // need the commits in between, which is why `needsRangeHistory` is reported
  // and the workflow checks out unshallowed.
  if (o.parents.length >= 2) {
    const [base, prHead] = o.parents
    return {
      filesCmd: `git diff --name-only ${base} ${prHead} -- ${o.goldenDir}`,
      commitsCmd: `git rev-list --reverse ${base}..${prHead}`,
      needsRangeHistory: true,
    }
  }
  if (o.pushBefore) {
    return {
      filesCmd: `git diff --name-only ${o.pushBefore}..HEAD -- ${o.goldenDir}`,
      commitsCmd: `git rev-list --reverse ${o.pushBefore}..HEAD`,
      needsRangeHistory: true,
    }
  }
  return {
    filesCmd: `git show --name-only --format= HEAD -- ${o.goldenDir}`,
    commitsCmd: 'git rev-parse HEAD',
    needsRangeHistory: false,
  }
}

export function parseGitStatusPorcelainZ(output: string): string[] {
  const entries = output.split('\0').filter(Boolean)
  const paths: string[] = []
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!
    const status = entry.slice(0, 2)
    const path = entry.slice(3)
    if (!path) continue
    paths.push(path)
    if ((status[0] === 'R' || status[0] === 'C' || status[1] === 'R' || status[1] === 'C') && i + 1 < entries.length) {
      i++ // porcelain -z includes the original path as the next NUL field.
    }
  }
  return [...new Set(paths)]
}

const ZERO_SHA_RE = /^0{40}$/

export function githubPushBeforeSha(eventName: string | undefined, eventJson: string | undefined): string | null {
  if (eventName !== 'push' || !eventJson) return null
  try {
    const before = JSON.parse(eventJson).before
    if (typeof before !== 'string') return null
    if (!/^[0-9a-f]{40}$/i.test(before) || ZERO_SHA_RE.test(before)) return null
    return before
  } catch {
    return null
  }
}

/**
 * Pure gate decision. Precedence: uncommitted drift is always a hard fail
 * (regenerate + commit first); then the token vs. golden-change cross-check.
 */
export function evaluateGoldenDrift(f: GoldenDriftFacts): GoldenDriftVerdict {
  if (f.truncatedHistory) {
    return {
      ok: false,
      code: 'shallow-history',
      message: `Approval spans a commit range, but the checkout is shallow so the range cannot be read — the gate would find no ${APPROVE_TOKEN} even where one exists. Check out with fetch-depth: 0.`,
    }
  }
  if (f.uncommittedGoldenFiles.length > 0) {
    return {
      ok: false,
      code: 'uncommitted-drift',
      message: `Running the suite left uncommitted golden changes: ${f.uncommittedGoldenFiles.join(', ')}. Regenerate, review, commit them, and start a commit-message line with ${APPROVE_TOKEN}.`,
    }
  }
  const stray = f.commits.find(commit => APPROVE_TOKEN_RE.test(commit.commitMessage) && commit.goldenFiles.length === 0)
  if (stray) {
    return { ok: false, code: 'stray-token', message: `Commit ${stray.sha} starts a line with ${APPROVE_TOKEN} but that commit changes no goldens under src/__tests__/testdata/. Remove the stray approval line.` }
  }
  // A range whose golden edits cancel out has no reviewable final drift. It is
  // clean once stray tokens are excluded, even if intermediate commits touched
  // goldens while arriving at the net-zero result.
  if (f.headGoldenFiles.length === 0) {
    return { ok: true, code: 'clean', message: 'No golden drift.' }
  }
  const unapproved = f.commits.find(commit => commit.goldenFiles.length > 0 && !APPROVE_TOKEN_RE.test(commit.commitMessage))
  if (unapproved) {
    return {
      ok: false,
      code: 'unreviewed-goldens',
      message: `Commit ${unapproved.sha} modifies committed goldens (${unapproved.goldenFiles.join(', ')}) without approval. After reviewing that commit's golden diff, start a commit-message line with ${APPROVE_TOKEN}.`,
    }
  }
  return { ok: true, code: 'approved', message: `Every golden-changing commit is approved via ${APPROVE_TOKEN}.` }
}

// ---- CLI wrapper: gather git facts, annotate, exit ------------------------

if (import.meta.main) {
  const { execSync } = await import('node:child_process')
  const GOLDEN_DIR = 'src/__tests__/testdata/'
  const run = (cmd: string) => execSync(cmd, { encoding: 'utf8' })
  const lines = (cmd: string) =>
    run(cmd).split('\n').map(s => s.trim()).filter(Boolean)

  // Which commits count is decision logic, so it lives in the pure layer above
  // and is unit-tested; this wrapper only gathers the git facts and executes it.
  // The merge ref must be unpacked into its parents before anything else: on a
  // `pull_request` build HEAD is synthetic, and reading it directly would
  // surface whatever the BASE branch changed since the fork point (e.g. main
  // regenerating goldens) rather than what this PR changed — a false positive.
  // Reading approval across the range needs the range to BE there, so the
  // workflow checks out with fetch-depth: 0; `truncatedHistory` below is what
  // makes a shallow checkout an explicit failure instead of a silent misread.
  const parents = run('git rev-list --parents -n 1 HEAD').trim().split(/\s+/).slice(1)
  let pushBefore: string | null = null
  if (parents.length < 2 && process.env.GITHUB_EVENT_PATH) {
    const { readFileSync } = await import('node:fs')
    pushBefore = githubPushBeforeSha(process.env.GITHUB_EVENT_NAME, readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
  }
  const { filesCmd, commitsCmd, needsRangeHistory } = goldenDriftCommands({ parents, pushBefore, goldenDir: GOLDEN_DIR })
  const shallow = run('git rev-parse --is-shallow-repository').trim() === 'true'
  const commits = lines(commitsCmd).map(sha => ({
    sha,
    goldenFiles: lines(`git diff-tree --root --no-commit-id --name-only -r -m ${sha} -- ${GOLDEN_DIR}`),
    commitMessage: run(`git log -1 --format=%B ${sha}`),
  }))

  const facts: GoldenDriftFacts = {
    uncommittedGoldenFiles: parseGitStatusPorcelainZ(run(`git status --porcelain=v1 -z --untracked-files=all -- ${GOLDEN_DIR}`)),
    headGoldenFiles: lines(filesCmd),
    commits,
    truncatedHistory: needsRangeHistory && shallow,
  }
  const v = evaluateGoldenDrift(facts)
  if (v.ok) {
    process.stdout.write(`::notice title=Golden drift::${v.message}\n`)
    process.exit(0)
  }
  process.stdout.write(`::error title=Golden drift (${v.code})::${v.message}\n`)
  process.exit(1)
}
