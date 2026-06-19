// Move 10: the golden-snapshot drift gate, as testable code instead of inline
// YAML. The decision logic (the trickiest new CI behavior) is a pure function
// unit-tested in src/__tests__/golden-drift.test.ts; the CLI wrapper gathers the
// git facts and maps the verdict to GitHub annotations + exit code. ci.yml calls
// `bun run scripts/ci/golden-drift.ts`.

export interface GoldenDriftFacts {
  /** Committed goldens with UNcommitted working-tree changes (suite regenerated them). */
  uncommittedGoldenFiles: string[]
  /** Goldens changed by the HEAD commit. */
  headGoldenFiles: string[]
  /** The HEAD commit message. */
  commitMessage: string
}

export type GoldenDriftCode =
  | 'clean'               // no golden movement, or movement properly approved
  | 'approved'            // HEAD changes goldens AND carries the token
  | 'uncommitted-drift'   // running the suite left goldens dirty
  | 'unreviewed-goldens'  // HEAD changes goldens without the token
  | 'stray-token'         // token present but HEAD changes no goldens

export interface GoldenDriftVerdict {
  ok: boolean
  code: GoldenDriftCode
  message: string
}

export const APPROVE_TOKEN = '[approve-goldens]'
// The token only counts at the START of a line. A bare substring match trips on
// any commit that merely *mentions* the token in prose (e.g. a commit that
// documents this very gate), so approval must be deliberate: a line that begins
// with [approve-goldens]. Real approvers write `[approve-goldens] <reason>`.
export const APPROVE_TOKEN_RE = /^[ \t]*\[approve-goldens\]/m

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
  if (f.uncommittedGoldenFiles.length > 0) {
    return {
      ok: false,
      code: 'uncommitted-drift',
      message: `Running the suite left uncommitted golden changes: ${f.uncommittedGoldenFiles.join(', ')}. Regenerate, review, commit them, and start a commit-message line with ${APPROVE_TOKEN}.`,
    }
  }
  const hasToken = APPROVE_TOKEN_RE.test(f.commitMessage)
  const headChangesGoldens = f.headGoldenFiles.length > 0
  if (hasToken && headChangesGoldens) {
    return { ok: true, code: 'approved', message: `Golden changes approved via ${APPROVE_TOKEN}.` }
  }
  if (hasToken && !headChangesGoldens) {
    return { ok: false, code: 'stray-token', message: `A line starts with ${APPROVE_TOKEN} but HEAD changes no goldens under src/__tests__/testdata/. Remove the stray approval line.` }
  }
  if (!hasToken && headChangesGoldens) {
    return {
      ok: false,
      code: 'unreviewed-goldens',
      message: `HEAD modifies committed goldens (${f.headGoldenFiles.join(', ')}) without approval. After reviewing the golden diff, start a commit-message line with ${APPROVE_TOKEN}.`,
    }
  }
  return { ok: true, code: 'clean', message: 'No golden drift.' }
}

// ---- CLI wrapper: gather git facts, annotate, exit ------------------------

if (import.meta.main) {
  const { execSync } = await import('node:child_process')
  const GOLDEN_DIR = 'src/__tests__/testdata/'
  const run = (cmd: string) => execSync(cmd, { encoding: 'utf8' })
  const lines = (cmd: string) =>
    run(cmd).split('\n').map(s => s.trim()).filter(Boolean)

  // On a GitHub `pull_request` build the checkout is the MERGE ref: HEAD is a
  // synthetic merge commit whose parents are [base, prHead]. `git show HEAD`
  // there surfaces whatever the BASE branch changed since the fork point (e.g.
  // main regenerating goldens), not what this PR changed — a false positive.
  // When HEAD has 2+ parents, scope the gate to the PR's own net change
  // (base...prHead) and read the token from the PR's own commit messages, not
  // the auto-generated merge message.
  const parents = run('git rev-list --parents -n 1 HEAD').trim().split(/\s+/).slice(1)
  const isMerge = parents.length >= 2
  const [base, prHead] = parents
  let pushBefore: string | null = null
  if (!isMerge && process.env.GITHUB_EVENT_PATH) {
    const { readFileSync } = await import('node:fs')
    pushBefore = githubPushBeforeSha(process.env.GITHUB_EVENT_NAME, readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
  }

  const facts: GoldenDriftFacts = {
    uncommittedGoldenFiles: parseGitStatusPorcelainZ(run(`git status --porcelain=v1 -z --untracked-files=all -- ${GOLDEN_DIR}`)),
    headGoldenFiles: isMerge
      ? lines(`git diff --name-only ${base}...${prHead} -- ${GOLDEN_DIR}`)
      : pushBefore
        ? lines(`git diff --name-only ${pushBefore}..HEAD -- ${GOLDEN_DIR}`)
      : lines(`git show --name-only --format= HEAD -- ${GOLDEN_DIR}`),
    commitMessage: isMerge
      ? run(`git log --format=%B ${base}..${prHead}`)
      : pushBefore
        ? run(`git log --format=%B ${pushBefore}..HEAD`)
      : run('git log -1 --format=%B'),
  }
  const v = evaluateGoldenDrift(facts)
  if (v.ok) {
    process.stdout.write(`::notice title=Golden drift::${v.message}\n`)
    process.exit(0)
  }
  process.stdout.write(`::error title=Golden drift (${v.code})::${v.message}\n`)
  process.exit(1)
}
