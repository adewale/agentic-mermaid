export interface BuildGitShaInputs {
  explicit?: string
  head?: string
  status?: string
}

/**
 * Resolve provenance without claiming an exact commit for bytes built from a
 * dirty or unverifiable checkout. CI may supply an explicit immutable source
 * revision; local/manual builds derive and qualify the checkout state.
 */
export function resolveBuildGitSha({ explicit, head, status }: BuildGitShaInputs): string {
  if (explicit?.trim()) {
    const revision = explicit.trim()
    if (!head?.trim()) throw new Error('SITE_GIT_SHA was supplied but checkout HEAD could not be verified')
    if (revision !== head.trim()) throw new Error(`SITE_GIT_SHA ${revision} does not match checkout HEAD ${head.trim()}`)
    if (status === undefined) throw new Error('SITE_GIT_SHA was supplied but checkout cleanliness could not be verified')
    if (status.trim()) throw new Error(`SITE_GIT_SHA cannot label a dirty checkout as exact: ${status.trim().split(/\r?\n/)[0]}`)
    return revision
  }
  if (!head?.trim()) return 'development'
  const revision = head.trim()
  if (status === undefined) return `${revision}-unverified`
  return status.trim() ? `${revision}-dirty` : revision
}
