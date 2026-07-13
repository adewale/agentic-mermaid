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
  if (explicit?.trim()) return explicit.trim()
  if (!head?.trim()) return 'development'
  const revision = head.trim()
  if (status === undefined) return `${revision}-unverified`
  return status.trim() ? `${revision}-dirty` : revision
}
