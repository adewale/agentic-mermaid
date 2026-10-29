import { prepareDisplayText, type DisplayTextInput, type PreparedDisplayText } from '../shared/display-text.ts'
import type { LabelDisplay } from '../multiline-utils.ts'
import type { TextTransform } from '../types.ts'
import { graphemes } from '../shared/graphemes.ts'
import { visualWidth } from './width.ts'

export interface CellTextOptions {
  display?: LabelDisplay
  transform?: TextTransform
  maxWidth?: number
  hyphenate?: boolean
}
export interface CellTextBreak {
  readonly kind: 'authored' | 'wrap' | 'hyphen'
  readonly sourceOffset: number
  readonly replacedText?: string
}
export interface CellTextBlock {
  readonly unit: 'cell'
  readonly prepared: PreparedDisplayText
  readonly lines: readonly string[]
  readonly lineWidths: readonly number[]
  readonly breaks: readonly CellTextBreak[]
  readonly width: number
  readonly height: number
}

/** Cell fitting consumes the same display reading as pixel fitting. A wide
 * cluster remains whole even when a hard budget will subsequently refuse it.
 * Soft breaks retain the source range and any replaced separator. */
export function prepareCellText(source: DisplayTextInput, options: CellTextOptions = {}): CellTextBlock {
  const prepared = prepareDisplayText(source, options.display ?? 'literal', options.transform)
  const limit = options.maxWidth && Number.isFinite(options.maxWidth) && options.maxWidth > 0 ? Math.max(1, Math.floor(options.maxWidth)) : Infinity
  const lines: string[] = [], breaks: CellTextBreak[] = []
  for (const [lineIndex, runs] of prepared.lines.entries()) {
    if (lineIndex > 0) breaks.push({ kind: 'authored', sourceOffset: prepared.lineStarts[lineIndex]! - 1 })
    const text = runs.map(run => run.text).join('')
    if (visualWidth(text) <= limit) { lines.push(text); continue }
    const clusters = graphemes(text)
    // Sources may contain formatting tags or casing expansions. Map visible
    // graphemes through prepared source spans, never through serialized markup.
    const pieces = runs.flatMap(run => run.clusters ?? [{ text: run.text, sourceStart: run.sourceStart, sourceEnd: run.sourceEnd }])
    const sourceOffsets: number[] = []
    let pieceIndex = 0, pieceOffset = 0
    for (const cluster of clusters) {
      sourceOffsets.push(pieces[pieceIndex]!.sourceStart)
      let remaining = cluster.length
      while (remaining > 0) {
        const take = Math.min(remaining, pieces[pieceIndex]!.text.length - pieceOffset)
        remaining -= take; pieceOffset += take
        if (pieceOffset === pieces[pieceIndex]!.text.length) { pieceIndex++; pieceOffset = 0 }
      }
    }
    let start = 0
    while (start < clusters.length) {
      let end = start, width = 0, separator = -1
      while (end < clusters.length && width + visualWidth(clusters[end]!) <= limit) {
        width += visualWidth(clusters[end]!)
        if (/\s/u.test(clusters[end]!)) separator = end + 1
        end++
      }
      if (end === clusters.length) { lines.push(clusters.slice(start).join('')); break }
      if (end > start && !/\s/u.test(clusters[end - 1]!) && /\s/u.test(clusters[end] ?? '')) {
        separator = end
        while (separator < clusters.length && /\s/u.test(clusters[separator]!)) separator++
      }
      let paintEnd = end, replacedText: string | undefined, hyphen = false
      if (separator > start) {
        if (clusters.slice(start, separator).some(cluster => !/\s/u.test(cluster))) while (separator < clusters.length && /\s/u.test(clusters[separator]!)) separator++
        end = separator; paintEnd = end
        while (paintEnd > start && /\s/u.test(clusters[paintEnd - 1]!)) paintEnd--
        if (paintEnd === start) paintEnd = end
        else replacedText = clusters.slice(paintEnd, end).join('')
      } else {
        end = Math.max(start + 1, end)
        const needsHyphen = (at: number) => options.hyphenate !== false && at < clusters.length && !(visualWidth(clusters[at - 1]!) === 2 && visualWidth(clusters[at]!) === 2)
        while (end > start + 1 && needsHyphen(end) && visualWidth(clusters.slice(start, end).join('')) + 1 > limit) end--
        paintEnd = end
        hyphen = needsHyphen(end) && visualWidth(clusters.slice(start, end).join('')) + 1 <= limit
      }
      lines.push(clusters.slice(start, paintEnd).join('') + (hyphen ? '-' : ''))
      if (end < clusters.length) breaks.push(Object.freeze({ kind: hyphen ? 'hyphen' : 'wrap', sourceOffset: sourceOffsets[end]!, ...(replacedText ? { replacedText } : {}) }))
      start = end
    }
  }
  const lineWidths = lines.map(visualWidth)
  breaks.forEach(Object.freeze)
  return Object.freeze({ unit: 'cell', prepared, lines: Object.freeze(lines), lineWidths: Object.freeze(lineWidths), breaks: Object.freeze(breaks), width: lineWidths.reduce((a, b) => Math.max(a, b), 0), height: lines.length })
}
