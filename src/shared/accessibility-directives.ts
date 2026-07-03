// Mermaid-universal accessibility directives — accTitle / accDescr single
// lines and accDescr { … } blocks — are legal in every diagram family.
// Families that MODEL them (sequence, timeline) parse them into fields; the
// rest accept-and-skip via this one helper so the tolerance can never drift
// per family again (pie and quadrant each carried a hand-rolled copy).

/**
 * If `lines[i]` starts an accessibility directive, return the index of its
 * LAST line (the caller's loop increment then steps past it); otherwise -1.
 * Handles single-line `accTitle:`/`accDescr:` and multi-line `accDescr {`
 * blocks terminated by a line containing `}`.
 */
export function accessibilityDirectiveEnd(lines: readonly string[], i: number): number {
  const line = lines[i]!.trim()
  if (/^acc(Title|Descr)\s*:/i.test(line)) return i
  if (/^accDescr\s*\{/i.test(line)) {
    let end = i
    while (end < lines.length && !lines[end]!.includes('}')) end++
    return end
  }
  return -1
}
