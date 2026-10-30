// Typo tolerance for closed vocabularies: the one "did you mean" rule shared
// by op schemas, Style names and Mermaid config values.

function levenshtein(a: string, b: string): number {
  const m = a.length,
    n = b.length
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)])
  for (let j = 0; j <= n; j++) d[0]![j] = j
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[m]![n]!
}

/** Case-insensitive edit distance between two names. */
export function nameDistance(a: string, b: string): number {
  return levenshtein(a.toLowerCase(), b.toLowerCase())
}

/** Nearest candidate within an edit-distance threshold (typo tolerance). */
export function nearestName(target: string, candidates: readonly string[]): string | undefined {
  let best: string | undefined
  let bestD = Infinity
  for (const c of candidates) {
    const dist = nameDistance(target, c)
    if (dist < bestD) {
      bestD = dist
      best = c
    }
  }
  // Only suggest when the match is close (<= ~40% of the longer string).
  return best !== undefined && bestD <= Math.max(2, Math.ceil(best.length * 0.4)) ? best : undefined
}
