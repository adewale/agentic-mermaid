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

/**
 * Pure gate decision. Precedence: uncommitted drift is always a hard fail
 * (regenerate + commit first); then the token vs. golden-change cross-check.
 */
export function evaluateGoldenDrift(f: GoldenDriftFacts): GoldenDriftVerdict {
  if (f.uncommittedGoldenFiles.length > 0) {
    return {
      ok: false,
      code: 'uncommitted-drift',
      message: `Running the suite changed committed goldens that were not committed: ${f.uncommittedGoldenFiles.join(', ')}. Regenerate, review, commit them, and start a commit-message line with ${APPROVE_TOKEN}.`,
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
  const lines = (cmd: string) =>
    execSync(cmd, { encoding: 'utf8' }).split('\n').map(s => s.trim()).filter(Boolean)

  const facts: GoldenDriftFacts = {
    uncommittedGoldenFiles: lines(`git diff --name-only -- ${GOLDEN_DIR}`),
    headGoldenFiles: lines(`git show --name-only --format= HEAD -- ${GOLDEN_DIR}`),
    commitMessage: execSync('git log -1 --format=%B', { encoding: 'utf8' }),
  }
  const v = evaluateGoldenDrift(facts)
  if (v.ok) {
    process.stdout.write(`::notice title=Golden drift::${v.message}\n`)
    process.exit(0)
  }
  process.stdout.write(`::error title=Golden drift (${v.code})::${v.message}\n`)
  process.exit(1)
}
