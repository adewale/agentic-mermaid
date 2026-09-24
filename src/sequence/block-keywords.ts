/** Exact Sequence block keywords shared by native and agent projections. */
export type SequenceBlockOpener = 'loop' | 'alt' | 'opt' | 'par' | 'par_over' | 'critical' | 'break' | 'rect' | 'box'
export type SequenceBlockContinuation = 'else' | 'and' | 'option'

// Mermaid's sequence lexer uses a word boundary after these keywords, not a
// required space. Labels such as `critical:C` and `option:retry` are valid,
// while `optional` and `option_retry` are not block keywords.
const OPEN_RE = /^(loop|alt|opt|par|critical|break|rect|box)\b\s*(.*)$/i
const CONTINUE_RE = /^(else|and|option)\b\s*(.*)$/i
const LEGACY_PAR_OVER_RE = /^par_over\b\s*(.*)$/i

export function parseSequenceBlockOpener(line: string): { type: SequenceBlockOpener; label: string } | null {
  // Preserve the existing par_over rendering disposition until its distinct
  // upstream over-participants semantics get their own #264 block-authority
  // slice. This is not evidence that par_over is a native `par` construct.
  const parOver = LEGACY_PAR_OVER_RE.exec(line)
  if (parOver) return { type: 'par_over', label: parOver[1]?.trim() ?? '' }
  const match = OPEN_RE.exec(line)
  return match ? { type: match[1]!.toLowerCase() as SequenceBlockOpener, label: match[2]?.trim() ?? '' } : null
}

export function parseSequenceBlockContinuation(line: string): { type: SequenceBlockContinuation; label: string } | null {
  const match = CONTINUE_RE.exec(line)
  return match ? { type: match[1]!.toLowerCase() as SequenceBlockContinuation, label: match[2]?.trim() ?? '' } : null
}

export function continuationBelongsToBlock(
  continuation: SequenceBlockContinuation,
  block: SequenceBlockOpener,
): boolean {
  return (continuation === 'else' && block === 'alt')
    || (continuation === 'and' && block === 'par')
    || (continuation === 'option' && block === 'critical')
}
