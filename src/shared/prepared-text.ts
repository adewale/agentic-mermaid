import type { LabelDisplay } from '../multiline-utils.ts'
import type { TextTransform } from '../types.ts'
import { LINE_HEIGHT_RATIO, measureTextWidth, measureSystemFontSafeTextWidth, measureMonospaceTextWidth, getCharWidth } from '../text-metrics.ts'
import { graphemes } from './graphemes.ts'
import { serializeStyledSegment } from './inline-format.ts'
import { prepareDisplayText, type DisplayRun, type DisplayTextInput, type PreparedDisplayText } from './display-text.ts'

export interface PixelTextOptions {
  display?: LabelDisplay
  transform?: TextTransform
  fontSize: number
  fontWeight: number
  letterSpacing?: number
  maxWidth?: number
  safeFont?: boolean
  monospace?: boolean
}

export interface TextBreak {
  readonly kind: 'authored' | 'wrap' | 'hyphen'
  readonly sourceOffset: number
  readonly replacedText?: string
}

export interface PixelTextLine {
  readonly runs: readonly DisplayRun[]
  readonly text: string
  readonly width: number
  readonly baseline: number
  readonly originX: number
}

export interface PixelTextBlock {
  readonly unit: 'px'
  readonly prepared: PreparedDisplayText
  readonly text: string
  readonly lines: string[]
  readonly lineBlocks: readonly PixelTextLine[]
  readonly breaks: readonly TextBreak[]
  readonly width: number
  readonly height: number
  readonly lineHeight: number
  readonly fontSize: number
  readonly fontWeight: number
  readonly letterSpacing: number
  readonly monospace: boolean
  readonly safeFont: boolean
}

function sameStyle(a: DisplayRun, b: DisplayRun): boolean {
  return a.bold === b.bold && a.italic === b.italic && a.underline === b.underline && a.strikethrough === b.strikethrough
}

function coalesce(runs: readonly DisplayRun[]): DisplayRun[] {
  const result: DisplayRun[] = []
  for (const run of runs.flatMap(run => (run as WrapGlyph).fragments ?? [run])) {
    const prior = result.at(-1)
    if (prior && sameStyle(prior, run)) result[result.length - 1] = { ...prior, text: prior.text + run.text, sourceEnd: run.sourceEnd }
    else result.push({ ...run })
  }
  return result
}

function advance(runs: readonly DisplayRun[], options: PixelTextOptions): number {
  if (runs.length === 0) return 0
  const measure = options.safeFont ? measureSystemFontSafeTextWidth : measureTextWidth
  const grouped = coalesce(runs)
  const text = grouped.map(run => run.text).join('')
  const width = options.monospace ? measureMonospaceTextWidth(text, options.fontSize) : grouped.reduce((sum, run) => sum + measure(run.text, options.fontSize, run.bold ? Math.max(700, options.fontWeight) : options.fontWeight), 0)
  // Native shaping may apply tracking to several code points in a cluster
  // (flags are a common example). Negative tracking can reverse occupied
  // intervals; reserve their envelope rather than shrinking to final advance.
  if (/[^\x20-\x7e]/u.test(text)) {
    // Unknown fallback faces need an em envelope, rather than the Latin bucket
    // for Ω/Ш/etc. Count visible code points: a fallback can draw separate
    // glyphs for components of a flag or a ZWJ cluster. Zero-width marks stay
    // attached to their base. ASCII sharing this shaping run uses safe metrics.
    const naturalWidth = grouped.reduce((sum, run) => sum + [...run.text].reduce((line, char) => line + (getCharWidth(char) === 0 ? 0 : /[^\x20-\x7e]/u.test(char) ? options.fontSize * 1.2 : measureSystemFontSafeTextWidth(char, options.fontSize, run.bold ? Math.max(700, options.fontWeight) : options.fontWeight)), 0), 0)
    const orphanMarks = graphemes(text).filter(cluster => /\p{M}/u.test(cluster) && [...cluster].every(char => getCharWidth(char) === 0)).length
    return Math.max(width, naturalWidth + orphanMarks * options.fontSize * 1.2) + Math.max(0, [...text].length - 1) * Math.abs(options.letterSpacing ?? 0)
  }
  return (options.letterSpacing ?? 0) < 0 ? trackedBounds(grouped, options).width : Math.max(0, width + Math.max(0, graphemes(text).length - 1) * (options.letterSpacing ?? 0))
}

/** With negative tracking, total advance can be zero while glyph intervals
 * still occupy space. Bounds enclose every interval rather than clamping the
 * final pen position and pretending that nothing is drawn. */
function trackedBounds(runs: readonly DisplayRun[], options: PixelTextOptions): { width: number; originX: number } {
  const measure = options.safeFont ? measureSystemFontSafeTextWidth : measureTextWidth
  let x = 0, min = 0, max = 0
  for (const run of runs) {
    const clusters = graphemes(run.text)
    for (const [i, cluster] of clusters.entries()) {
      const width = options.monospace ? measureMonospaceTextWidth(cluster, options.fontSize) : measure(cluster, options.fontSize, run.bold ? Math.max(700, options.fontWeight) : options.fontWeight) - (i === clusters.length - 1 ? 0 : options.fontSize * 0.15)
      min = Math.min(min, x); max = Math.max(max, x + width)
      x += width + (options.letterSpacing ?? 0)
    }
  }
  return { width: max - min, originX: -min }
}

/** A run can expand under casing (ß → SS), so its retained source span is
 * authoritative; transformed offsets are never mistaken for source offsets. */
interface WrapGlyph extends DisplayRun { readonly fragments?: readonly DisplayRun[] }

function glyphs(runs: readonly DisplayRun[]): WrapGlyph[] {
  const pieces = runs.flatMap(run => (run.clusters ?? graphemes(run.text).map(text => ({ text, sourceStart: run.sourceStart, sourceEnd: run.sourceEnd }))).map(cluster => ({ ...run, ...cluster, clusters: undefined })))
  let pieceIndex = 0
  let pieceOffset = 0
  return graphemes(pieces.map(piece => piece.text).join('')).map(text => {
    let remaining = text.length
    const fragments: DisplayRun[] = []
    while (remaining > 0) {
      const piece = pieces[pieceIndex]!
      const take = Math.min(remaining, piece.text.length - pieceOffset)
      fragments.push({ ...piece, text: piece.text.slice(pieceOffset, pieceOffset + take) })
      remaining -= take; pieceOffset += take
      if (pieceOffset === piece.text.length) { pieceIndex++; pieceOffset = 0 }
    }
    return { ...fragments[0]!, text, sourceEnd: fragments.at(-1)!.sourceEnd, ...(fragments.length > 1 ? { fragments } : {}) }
  })
}

function hyphenRun(glyph: WrapGlyph): DisplayRun {
  const { fragments: _fragments, ...run } = (glyph.fragments?.at(-1) ?? glyph) as WrapGlyph
  return { ...run, text: '-', clusters: undefined }
}

/** Prepared text is the layout authority. Soft breaks retain every authored
 * space, and inserted hyphens have an explicit provenance record. */
export function preparePixelText(source: DisplayTextInput, options: PixelTextOptions): PixelTextBlock {
  if (!Number.isFinite(options.fontSize) || options.fontSize <= 0 || !Number.isFinite(options.fontWeight) || !Number.isFinite(options.letterSpacing ?? 0)) throw new RangeError('Prepared text requires finite typography and a positive font size')
  const prepared = prepareDisplayText(source, options.display, options.transform)
  const maxWidth = options.maxWidth
  const broken: DisplayRun[][] = []
  const breaks: TextBreak[] = []
  for (const [lineIndex, original] of prepared.lines.entries()) {
    if (lineIndex > 0) breaks.push({ kind: 'authored', sourceOffset: prepared.lineStarts[lineIndex]! - 1 })
    if (original.length === 0) { broken.push([]); continue }
    if (!maxWidth || !Number.isFinite(maxWidth) || maxWidth <= 0 || advance(original, options) <= maxWidth) {
      broken.push([...original]); continue
    }
    const clusters = glyphs(original)
    let start = 0
    while (start < clusters.length) {
      let end = start
      let whitespace = -1
      while (end < clusters.length && advance(clusters.slice(start, end + 1), options) <= maxWidth) {
        if (/\s/u.test(clusters[end]!.text)) whitespace = end + 1
        end++
      }
      if (end === clusters.length) { broken.push(coalesce(clusters.slice(start))); break }
      if (end > start && !/\s/u.test(clusters[end - 1]!.text) && /\s/u.test(clusters[end]?.text ?? '')) {
        whitespace = end
        while (whitespace < clusters.length && /\s/u.test(clusters[whitespace]!.text)) whitespace++
      }
      let hyphen = false
      let paintEnd: number | undefined
      let replacedText: string | undefined
      if (whitespace > start) {
        if (clusters.slice(start, whitespace).some(cluster => !/\s/u.test(cluster.text))) while (whitespace < clusters.length && /\s/u.test(clusters[whitespace]!.text)) whitespace++
        end = whitespace
        paintEnd = end
        while (paintEnd > start && /\s/u.test(clusters[paintEnd - 1]!.text)) paintEnd--
        if (paintEnd === start) paintEnd = end
        else replacedText = clusters.slice(paintEnd, end).map(run => run.text).join('')
      }
      else {
        end = Math.max(start + 1, end)
        const latinBreak = (at: number) => /[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}]/u.test(clusters[at - 1]?.text ?? '') && /\p{L}/u.test(clusters[at]?.text ?? '')
        if (latinBreak(end)) {
          while (end > start + 1 && advance([...clusters.slice(start, end), hyphenRun(clusters[end - 1]!)], options) > maxWidth) end--
          hyphen = advance([...clusters.slice(start, end), hyphenRun(clusters[end - 1]!)], options) <= maxWidth
        }
      }
      const line = coalesce(clusters.slice(start, paintEnd ?? end))
      const sourceOffset = clusters[end]?.sourceStart ?? prepared.source.length
      if (hyphen) line.push({ ...hyphenRun(clusters[end - 1]!), sourceStart: sourceOffset, sourceEnd: sourceOffset })
      broken.push(line)
      if (end < clusters.length) breaks.push({ kind: hyphen ? 'hyphen' : 'wrap', sourceOffset, ...(replacedText ? { replacedText } : {}) })
      start = end
    }
    if (clusters.length === 0) broken.push([])
  }
  // The Latin baseline band cannot enclose joining-script ascents or stacked
  // diacritics. Reserve a native shaping band before family placement; marks
  // may extend ink even when they contribute no horizontal advance.
  const visible = prepared.lines.map(runs => runs.map(run => run.text).join('')).join('\n')
  const maxMarks = /\p{M}/u.test(visible.normalize('NFD').replace(/[\uFE0E\uFE0F]/g, '')) ? graphemes(visible.normalize('NFD')).reduce((max, cluster) => Math.max(max, (cluster.replace(/[\uFE0E\uFE0F]/g, '').match(/\p{M}/gu) ?? []).length), 0) : 0
  const lineHeight = options.fontSize * Math.max(LINE_HEIGHT_RATIO, /[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(visible) ? 2.4 : 0, maxMarks ? LINE_HEIGHT_RATIO + maxMarks * 0.6 : 0)
  const lineBlocks = broken.map((runs, i) => {
    const text = runs.map(run => prepared.display === 'literal' ? run.text : serializeStyledSegment(run)).join('')
    runs.forEach(Object.freeze)
    return Object.freeze({ runs: Object.freeze(runs), text, width: advance(runs, options), baseline: i * lineHeight + options.fontSize * 0.35, originX: (options.letterSpacing ?? 0) < 0 && !/[^\x20-\x7e]/u.test(runs.map(run => run.text).join('')) ? trackedBounds(runs, options).originX : 0 })
  })
  const lines = lineBlocks.map(line => line.text)
  Object.freeze(lines)
  breaks.forEach(Object.freeze)
  const width = lineBlocks.reduce((max, line) => Math.max(max, line.width), 0)
  return Object.freeze({ unit: 'px', prepared, text: lines.join('\n'), lines, lineBlocks: Object.freeze(lineBlocks), breaks: Object.freeze(breaks), width, height: lines.length * lineHeight, lineHeight, fontSize: options.fontSize, fontWeight: options.fontWeight, letterSpacing: options.letterSpacing ?? 0, monospace: options.monospace ?? false, safeFont: options.safeFont ?? false })
}

export type PixelTextFit =
  | { readonly kind: 'placed'; readonly block: PixelTextBlock }
  | { readonly kind: 'needs-space'; readonly block: PixelTextBlock; readonly required: { width: number; height: number } }

/** The primitive reports insufficient space. The family decides whether its
 * canvas may grow or an owned omission must be reported. */
export function fitPixelText(source: DisplayTextInput, options: PixelTextOptions, available: { width: number; height: number }): PixelTextFit {
  const block = preparePixelText(source, { ...options, maxWidth: available.width })
  return block.width <= available.width && block.height <= available.height
    ? { kind: 'placed', block }
    : { kind: 'needs-space', block, required: { width: block.width, height: block.height } }
}
