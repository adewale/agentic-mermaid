// Move 9: the `--since` base-ref construction for the incremental mutation
// lane, as a tested pure function instead of inline `${{ github.base_ref ||
// 'main' }}` shell. ci.yml calls `bun run scripts/ci/mutation-since.ts` (reading
// GITHUB_BASE_REF) and feeds the printed ref to `stryker run --since`.

/**
 * The git ref stryker should diff against. On a PR, GITHUB_BASE_REF is the
 * target branch; on a push to main it is empty, so we fall back to `main`
 * (diffing against itself yields an empty change set → the lane no-ops).
 */
export function sinceRef(baseRef: string | undefined): string {
  const ref = (baseRef ?? '').trim() || 'main'
  // Reject refs git itself forbids (git-check-ref-format): no whitespace, no
  // `..`, no leading `-`, none of ~^:?*[ \. A malformed GITHUB_BASE_REF should
  // fail loudly rather than build a bogus `--since` argument.
  if (/\s/.test(ref) || ref.includes('..') || ref.startsWith('-') || /[~^:?*[\\]/.test(ref)) {
    throw new Error(`invalid base ref: ${JSON.stringify(ref)}`)
  }
  // A SHA (detached HEAD / merge base) is already a concrete commit — prefixing
  // `origin/` would make it an invalid ref. Branch names get the remote prefix.
  if (/^[0-9a-f]{7,40}$/i.test(ref)) return ref
  return `origin/${ref}`
}

if (import.meta.main) {
  process.stdout.write(sinceRef(process.env.GITHUB_BASE_REF))
}
