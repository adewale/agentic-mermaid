import type { LabelDisplay } from '../multiline-utils.ts'
import type { TextTransform } from '../types.ts'
import { parseInlineFormatting, FORMAT_TAG_SOURCE, type StyledSegment } from './inline-format.ts'
import { graphemes } from './graphemes.ts'

export interface DisplayRun extends Readonly<StyledSegment> {
  readonly sourceStart: number
  readonly sourceEnd: number
  readonly clusters?: readonly { text: string; sourceStart: number; sourceEnd: number }[]
}

export interface PreparedDisplayText {
  readonly source: string
  readonly display: LabelDisplay
  readonly transform?: TextTransform
  readonly lines: readonly (readonly DisplayRun[])[]
  readonly lineStarts: readonly number[]
}

/** Transform visible characters, never serialized formatting instructions. */
export function transformDisplayText(text: string, transform?: TextTransform): string {
  if (transform === 'uppercase') return text.toUpperCase()
  if (transform === 'lowercase') return text.toLowerCase()
  if (transform === 'capitalize') return text.replace(/(?<![\p{L}\p{M}\p{N}\p{Pc}])\p{L}/gu, ch => ch.toUpperCase())
  return text
}

/** Input is the family's already normalized label. No entity decoding, grammar
 * normalization, whitespace trimming or interpretation of decoded tag-like text. */
export function prepareDisplayText(source: string, display: LabelDisplay = 'formatted', transform?: TextTransform): PreparedDisplayText {
  let offset = 0
  const lineStarts: number[] = []
  const empty = Object.freeze([]) as readonly DisplayRun[]
  const lines = source.split('\n').map(line => {
    lineStarts.push(offset)
    if (line === '') { offset++; return empty }
    let runs: DisplayRun[]
    if (display === 'literal') {
      runs = [{ text: line, bold: false, italic: false, underline: false, strikethrough: false, sourceStart: offset, sourceEnd: offset + line.length }]
    } else {
      const tags = new RegExp(FORMAT_TAG_SOURCE, 'gi')
      const spans: Array<{ start: number; end: number }> = []
      let cursor = 0
      for (const tag of line.matchAll(tags)) {
        if (tag.index! > cursor) spans.push({ start: cursor, end: tag.index! })
        cursor = tag.index! + tag[0].length
      }
      if (cursor < line.length) spans.push({ start: cursor, end: line.length })
      runs = parseInlineFormatting(line).map((run, i) => ({ ...run, sourceStart: offset + spans[i]!.start, sourceEnd: offset + spans[i]!.end }))
    }
    const visible = runs.map(run => run.text).join('')
    const transformed = transformDisplayText(visible, transform)
    let at = 0
    let transformedAt = 0
    const capitalized = transform === 'capitalize' ? new Set([...visible.matchAll(/(?<![\p{L}\p{M}\p{N}\p{Pc}])\p{L}/gu)].map(match => match.index!)) : undefined
    runs = runs.map(run => {
      const start = transformedAt
      let sourceAt = run.sourceStart
      const clusters = graphemes(run.text).map(cluster => {
        const length = (transform === 'uppercase' || (capitalized?.has(at))) ? cluster.toUpperCase().length : transform === 'lowercase' ? cluster.toLowerCase().length : cluster.length
        const text = transformed.slice(transformedAt, transformedAt + length)
        const result = { text, sourceStart: sourceAt, sourceEnd: sourceAt + cluster.length }
        sourceAt += cluster.length; at += cluster.length; transformedAt += length
        return Object.freeze(result)
      })
      return Object.freeze({ ...run, text: transformed.slice(start, transformedAt), clusters: Object.freeze(clusters) })
    })
    offset += line.length + 1
    return Object.freeze(runs)
  })
  return Object.freeze({ source, display, ...(transform ? { transform } : {}), lines: Object.freeze(lines), lineStarts: Object.freeze(lineStarts) })
}
