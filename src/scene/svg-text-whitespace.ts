import type { SvgWriter } from './svg-writer.ts'

/** Lexical whitespace lost by the tooltip layout's normalization. Visible
 * characters remain exclusively in the semantic prepared source. */
export interface SvgTextWhitespaceEdit {
  readonly offset: number
  readonly length: 0 | 1
  readonly value: string
}

/** Retain only original whitespace, never a parallel copy of visible text. */
export function svgTextWhitespace(original: string, normalizedSource: string): readonly SvgTextWhitespaceEdit[] | undefined {
  if (original.replace(/[\t\n\r ]+/g, ' ').trim() !== normalizedSource) {
    throw new TypeError('SVG whitespace projection must preserve normalized semantic text')
  }
  if (original === normalizedSource) return undefined
  if (normalizedSource === '') return [{ offset: 0, length: 0, value: original }]

  const edits: SvgTextWhitespaceEdit[] = []
  const start = original.length - original.trimStart().length
  const end = original.trimEnd().length
  if (start) edits.push({ offset: 0, length: 0, value: original.slice(0, start) })
  let offset = 0
  for (let index = start; index < end;) {
    const char = original[index]!
    if (char !== ' ' && char !== '\t' && char !== '\n' && char !== '\r') {
      index++
      offset++
      continue
    }
    let next = index + 1
    while (next < end && /[\t\n\r ]/.test(original[next]!)) next++
    const value = original.slice(index, next)
    if (value !== ' ') edits.push({ offset, length: 1, value })
    index = next
    offset++
  }
  if (end < original.length) edits.push({ offset: normalizedSource.length, length: 0, value: original.slice(end) })
  return edits.length ? edits : undefined
}

/** Apply a closed whitespace-only lexical projection to semantic text. */
export function writeSvgTextWhitespace(value: string, edits: readonly SvgTextWhitespaceEdit[], writer: SvgWriter): void {
  let previousOffset = -1
  let consumed = 0
  for (const edit of edits) {
    if (!Number.isInteger(edit.offset) || edit.offset < consumed || edit.offset <= previousOffset || edit.offset > value.length) {
      throw new TypeError('SVG whitespace edits must be ordered and non-overlapping')
    }
    if (typeof edit.value !== 'string' || edit.value === '') throw new TypeError('SVG whitespace edits require non-empty whitespace')
    if (edit.length === 1) {
      if (value[edit.offset] !== ' ' || !/^[\t\n\r ]+$/.test(edit.value)) {
        throw new TypeError('SVG whitespace replacements must replace one semantic space with ASCII whitespace')
      }
    } else if (edit.length === 0) {
      if ((edit.offset !== 0 && edit.offset !== value.length) || edit.value.trim() !== '') {
        throw new TypeError('SVG whitespace insertions must contain only trimmed edge whitespace')
      }
    } else throw new TypeError('SVG whitespace edits must insert or replace one space')
    previousOffset = edit.offset
    consumed = edit.offset + edit.length
  }
  let offset = 0
  for (const edit of edits) {
    writer.text(value.slice(offset, edit.offset))
    writer.text(edit.value)
    offset = edit.offset + edit.length
  }
  writer.text(value.slice(offset))
}
