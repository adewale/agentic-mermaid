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
  const branch = (baseRef ?? '').trim() || 'main'
  return `origin/${branch}`
}

if (import.meta.main) {
  process.stdout.write(sinceRef(process.env.GITHUB_BASE_REF))
}
