import { splitSequenceTextControl } from './text.ts'

/** Exact Sequence block keywords shared by native and agent projections. */
export type SequenceBlockOpener = 'loop' | 'alt' | 'opt' | 'par' | 'par_over' | 'critical' | 'break' | 'rect' | 'box'
export type SequenceBlockContinuation = 'else' | 'and' | 'option'

// Mermaid's sequence lexer uses a word boundary after these keywords, not a
// required space. Labels such as `critical:C` and `option:retry` are valid,
// while `optional` and `option_retry` are not block keywords.
// [\s\S] keeps U+2028/U+2029 inside the argument for explicit validation;
// dot would silently fail to classify the block opener at that boundary.
const OPEN_RE = /^(loop|alt|opt|par_over|par|critical|break|rect|box)\b\s*([\s\S]*)$/i
const CONTINUE_RE = /^(else|and|option)\b\s*([\s\S]*)$/i

export function parseSequenceBlockOpener(line: string): { type: SequenceBlockOpener; label: string; wrap?: boolean } | null {
  const match = OPEN_RE.exec(line)
  if (!match) return null
  const type = match[1]!.toLowerCase() as SequenceBlockOpener
  const label = match[2]?.trim() ?? ''
  if (type === 'box') return { type, label }
  const control = splitSequenceTextControl(label)
  return { type, label: control.text, ...(control.wrap === undefined ? {} : { wrap: control.wrap }) }
}

export function parseSequenceBlockContinuation(line: string): { type: SequenceBlockContinuation; label: string; wrap?: boolean } | null {
  const match = CONTINUE_RE.exec(line)
  if (!match) return null
  const control = splitSequenceTextControl(match[2] ?? '')
  return { type: match[1]!.toLowerCase() as SequenceBlockContinuation, label: control.text, ...(control.wrap === undefined ? {} : { wrap: control.wrap }) }
}

export function continuationBelongsToBlock(
  continuation: SequenceBlockContinuation,
  block: SequenceBlockOpener,
): boolean {
  return (continuation === 'else' && block === 'alt')
    || (continuation === 'and' && (block === 'par' || block === 'par_over'))
    || (continuation === 'option' && block === 'critical')
}
