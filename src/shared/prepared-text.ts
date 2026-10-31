import { asciiAdvanceSpans } from '../experimental/ascii-advances.ts'
import { performanceExperimentEnabled } from '../experimental-performance.ts'
import { WeightedLru } from '../experimental/weighted-lru.ts'
import type { LabelDisplay } from '../multiline-utils.ts'
import type { TextTransform } from '../types.ts'
import { LINE_HEIGHT_RATIO, measureTextWidth, measureSystemFontSafeTextWidth, measureMonospaceTextWidth, getCharWidth } from '../text-metrics.ts'
import { graphemes } from './graphemes.ts'
import { serializeStyledSegment } from './inline-format.ts'
import { isImmutableDisplayTextPart, isOwnedDisplayTextPart, prepareDisplayText, type DisplayRun, type DisplayTextInput, type PreparedDisplayText } from './display-text.ts'
import { createImmutableParts } from './immutable-parts.ts'
import { customTextMeasurementActive, customTextInkActive, profileTextInk, profileTextFontFamily, type ProfileTextInkMeasurement } from '../text-measurement-profile.ts'
import { formatSvgNumber } from './svg-number.ts'
import type { AxisAlignedBox } from './transformed-bounds.ts'
import { interTextEnvelope } from './inter-text-envelope.ts'

export interface PixelTextOptions {
  display?: LabelDisplay
  transform?: TextTransform
  fontSize: number
  fontWeight: number
  letterSpacing?: number
  maxWidth?: number
  safeFont?: boolean
  monospace?: boolean
  fontFamily?: string
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
  /** ASCII tracking and styled runs use these exact allocations during emission. */
  readonly fragments?: readonly PixelTextFragment[]
  /** Host-shaped ink for the single continuously fitted line. */
  readonly ink?: ProfileTextInkMeasurement
}

export interface PixelTextFragment {
  readonly runIndex: number
  readonly text: string
  readonly x: number
  readonly width: number
  readonly ink?: ProfileTextInkMeasurement
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
  readonly fontFamily?: string
}

// This evidence belongs to actual preparation, not to a caller-supplied copy
// of the metrics. Scene admission carries it across its own immutable snapshot.
const pixelBlocks = new WeightedLru<string, PixelTextBlock>(256, 8 * 1024 * 1024)
const preparedBlocks = new WeakSet<object>()
const shapedInkBlocks = new WeakSet<object>()
const interEnvelopeBlocks = new WeakSet<object>()
const pixelProjectionFrozen = Object.isFrozen
const pixelProjectionPrototype = Object.getPrototypeOf
const pixelProjectionDescriptor = Object.getOwnPropertyDescriptor, pixelProjectionOwn = Object.hasOwn
const pixelProjectionKeys = Reflect.ownKeys, pixelProjectionSame = Object.is, pixelProjectionDefine = Object.defineProperty
// Only constructor-owned immutable data, never the transferable measurement brand.
const immutablePixelParts = createImmutableParts(isImmutableDisplayTextPart, isOwnedDisplayTextPart)
export function isImmutablePixelTextPart(value: object): boolean { return immutablePixelParts.has(value) }
export function isOwnedPixelTextPart(value: object): boolean { return immutablePixelParts.hasOwned(value) }
export function isRetainedPixelText(value: object): boolean { return preparedBlocks.has(value) }
export function transferRetainedPixelText(source: object, snapshot: object): void {
  if (preparedBlocks.has(source)) preparedBlocks.add(snapshot)
  if (shapedInkBlocks.has(source)) shapedInkBlocks.add(snapshot)
  if (interEnvelopeBlocks.has(source)) interEnvelopeBlocks.add(snapshot)
}

export function hasPreparedTextInk(block: PixelTextBlock): boolean { return shapedInkBlocks.has(block) }
export function hasPreparedInterTextEnvelope(block: PixelTextBlock): boolean { return interEnvelopeBlocks.has(block) }

/** Bundled normal Inter has a conservative Latin envelope distinct from a
 * host's exact shaped ink. It never grants the host-shaped measurement brand. */
export function preparedInterTextBounds(block: PixelTextBlock, cx: number, cy: number, anchor: string, baselineShift = 0.35, documentFont?: string): AxisAlignedBox | undefined {
  if (!interEnvelopeBlocks.has(block) || (block.fontFamily ?? documentFont) !== 'Inter') return undefined
  let result: AxisAlignedBox | undefined
  const size = Number(formatSvgNumber(block.fontSize))
  for (let index = 0; index < block.lineBlocks.length; index++) {
    const line = block.lineBlocks[index]
    if (!line) return undefined
    const served = preparedTextLineGeometry(block, index, cx, cy, anchor, baselineShift)
    const include = (text: string, weight: number, x: number, width: number, completeShapingRun = false): boolean => {
      const envelope = interTextEnvelope(text, weight, size, width, completeShapingRun)
      if (!envelope) return false
      const bounds = { x0: x - envelope.left, x1: x + width + envelope.right, y0: served.baseline - envelope.above, y1: served.baseline + envelope.below }
      if (!Object.values(bounds).every(value => Number.isFinite(value) && Math.abs(value) <= 1e6)) return false
      result = result ? { x0: Math.min(result.x0, bounds.x0), y0: Math.min(result.y0, bounds.y0), x1: Math.max(result.x1, bounds.x1), y1: Math.max(result.y1, bounds.y1) } : bounds
      return true
    }
    if (line.fragments) for (let i = 0; i < line.fragments.length; i++) {
      const fragment = line.fragments[i]
      if (!fragment) return undefined
      const run = line.runs[fragment.runIndex], position = served.fragments?.[i]
      if (!run || !position || !include(fragment.text, run.bold ? Math.max(700, block.fontWeight) : block.fontWeight, Number(position.x), Number(position.textLength))) return undefined
    } else {
      const width = Number(served.textLength), offset = anchor === 'middle' ? width / 2 : anchor === 'end' ? width : 0
      // Only a single unfragmented line owns the complete <text> shaping run.
      // Multiline tspans retain the same conservative bound as fragments.
      if (!include(line.runs.map(run => run.text).join(''), block.fontWeight, Number(served.x) - offset, width, block.lineBlocks.length === 1)) return undefined
    }
  }
  return result
}

/** The served fitted operands are shared by emission and occupied geometry.
 * Advance allocation remains separate from the host's actual outline bounds. */
export function preparedTextLineGeometry(block: PixelTextBlock, index: number, cx: number, cy: number, anchor: string, baselineShift = 0.35) {
  const line = block.lineBlocks[index]!, count = block.lineBlocks.length
  const firstDy = -((count - 1) / 2) * block.lineHeight + block.fontSize * baselineShift
  const x = formatSvgNumber(cx), y = formatSvgNumber(cy)
  const dy = formatSvgNumber(index === 0 ? firstDy : block.lineHeight)
  const baseline = Number(y) + Number(formatSvgNumber(firstDy)) + index * Number(formatSvgNumber(block.lineHeight))
  const origin = (anchor === 'middle' ? cx - line.width / 2 : anchor === 'end' ? cx - line.width : cx) + line.originX
  return {
    x, y, dy, baseline, textLength: formatSvgNumber(line.width),
    fragments: line.fragments?.map(fragment => ({ x: formatSvgNumber(origin + fragment.x), textLength: formatSvgNumber(Math.max(0, fragment.width)) })),
  }
}

/** Only an actual retained host-shaped preparation can supply this envelope.
 * Native-shaped logical lines and decorations have no fitted-run authority. */
export function preparedTextInkBounds(block: PixelTextBlock, cx: number, cy: number, anchor: string, baselineShift = 0.35): AxisAlignedBox | undefined {
  if (!hasPreparedTextInk(block)) return undefined
  let result: AxisAlignedBox | undefined
  const include = (ink: ProfileTextInkMeasurement, x: number, width: number, baseline: number): void => {
    if (!ink.bounds) return
    if (!(width > 0)) throw new RangeError('Prepared text ink requires a positive fitted advance')
    const scale = width / ink.advance, b = ink.bounds
    const bounds = { x0: x + b.x0 * scale, y0: baseline + b.y0, x1: x + b.x1 * scale, y1: baseline + b.y1 }
    if (!Object.values(bounds).every(value => Number.isFinite(value) && Math.abs(value) <= 1e6)) throw new RangeError('Prepared text ink exceeds finite bounded coordinates')
    result = result ? { x0: Math.min(result.x0, bounds.x0), y0: Math.min(result.y0, bounds.y0), x1: Math.max(result.x1, bounds.x1), y1: Math.max(result.y1, bounds.y1) } : bounds
  }
  for (let index = 0; index < block.lineBlocks.length; index++) {
    const line = block.lineBlocks[index]!, served = preparedTextLineGeometry(block, index, cx, cy, anchor, baselineShift)
    if (line.fragments) for (let i = 0; i < line.fragments.length; i++) {
      const fragment = line.fragments[i]!, position = served.fragments![i]!
      include(fragment.ink!, Number(position.x), Number(position.textLength), served.baseline)
    } else {
      const width = Number(served.textLength), offset = anchor === 'middle' ? width / 2 : anchor === 'end' ? width : 0
      include(line.ink!, Number(served.x) - offset, width, served.baseline)
    }
  }
  return result
}

function preparedRunInk(text: string, run: DisplayRun | undefined, options: PixelTextOptions): ProfileTextInkMeasurement | undefined {
  const ink = profileTextInk({ text, fontSize: options.fontSize, fontWeight: run?.bold ? Math.max(700, options.fontWeight) : options.fontWeight,
    fontStyle: run?.italic ? 'italic' : 'normal', monospace: options.monospace ?? false, fontFamily: options.fontFamily })
  return ink && immutablePixelParts.freezeOwned({ advance: ink.advance, bounds: ink.bounds && immutablePixelParts.freezeOwned({ ...ink.bounds }) })
}

function sameStyle(a: DisplayRun, b: DisplayRun): boolean {
  return a.bold === b.bold && a.italic === b.italic && a.underline === b.underline && a.strikethrough === b.strikethrough
}

function coalesce(runs: readonly DisplayRun[]): DisplayRun[] {
  const result: DisplayRun[] = []
  let prior: { -readonly [Key in keyof DisplayRun]: DisplayRun[Key] } | undefined
  for (const run of runs.flatMap(run => (run as WrapGlyph).fragments ?? run)) {
    if (prior && sameStyle(prior, run)) {
      // Only the newly copied accumulator is mutable; input runs stay retained.
      prior.text += run.text
      prior.sourceEnd = run.sourceEnd
    } else {
      prior = { ...run }
      result.push(prior)
    }
  }
  return result
}

function advance(runs: readonly DisplayRun[], options: PixelTextOptions): number {
  if (runs.length === 0) return 0
  const measure = options.safeFont ? measureSystemFontSafeTextWidth : measureTextWidth
  const grouped = runs.length === 1 && !(runs[0] as WrapGlyph).fragments ? runs : coalesce(runs)
  const text = grouped.length === 1 ? grouped[0]!.text : grouped.map(run => run.text).join('')
  if ((options.letterSpacing ?? 0) !== 0 && !/[^\x20-\x7e]/u.test(text)) return trackedBounds(grouped, options).width
  const width = options.monospace
    ? customTextMeasurementActive()
      ? grouped.reduce((sum, run) => sum + measureMonospaceTextWidth(run.text, options.fontSize, 0, run.bold ? Math.max(700, options.fontWeight) : options.fontWeight, run.italic ? 'italic' : 'normal', options.fontFamily), 0)
      : measureMonospaceTextWidth(text, options.fontSize)
    : grouped.reduce((sum, run) => sum + measure(run.text, options.fontSize, run.bold ? Math.max(700, options.fontWeight) : options.fontWeight, run.italic ? 'italic' : 'normal', options.fontFamily), 0)
  // Native shaping may apply tracking to several code points in a cluster
  // (flags are a common example). Negative tracking can reverse occupied
  // intervals; reserve their envelope rather than shrinking to final advance.
  if (!customTextMeasurementActive() && /[^\x20-\x7e]/u.test(text)) {
    // Unknown fallback faces need an em envelope, rather than the Latin bucket
    // for Ω/Ш/etc. Count visible code points: a fallback can draw separate
    // glyphs for components of a flag or a ZWJ cluster. Zero-width marks stay
    // attached to their base. ASCII sharing this shaping run uses safe metrics.
    const naturalWidth = grouped.reduce((sum, run) => sum + [...run.text].reduce((line, char) => line + (getCharWidth(char) === 0 ? 0 : /[^\x20-\x7e]/u.test(char) ? options.fontSize * 1.2 : measureSystemFontSafeTextWidth(char, options.fontSize, run.bold ? Math.max(700, options.fontWeight) : options.fontWeight)), 0), 0)
    const orphanMarks = graphemes(text).filter(cluster => /\p{M}/u.test(cluster) && [...cluster].every(char => getCharWidth(char) === 0)).length
    return Math.max(width, naturalWidth + orphanMarks * options.fontSize * 1.2) + Math.max(0, [...text].length - 1) * Math.abs(options.letterSpacing ?? 0)
  }
  if ((options.letterSpacing ?? 0) < 0) return trackedBounds(grouped, options).width
  const letterSpacing = options.letterSpacing ?? 0
  return Math.max(0, width + (letterSpacing === 0 ? 0 : Math.max(0, graphemes(text).length - 1) * letterSpacing))
}

/** Positioned graphemes must be measured as the same graphemes that SVG will
 * paint. Whole-run metrics may include kerning or a nonadditive host profile. */
function trackingLayout(runs: readonly DisplayRun[], options: PixelTextOptions): { width: number; originX: number; fragments: readonly PixelTextFragment[] } {
  const clusters = runs.flatMap((run, runIndex) => graphemes(run.text).map(text => ({ runIndex, text })))
  let x = 0, min = 0, max = 0
  const fragments = clusters.map((cluster, index) => {
    const run = runs[cluster.runIndex]!, next = clusters[index + 1]
    const lastInStyle = !next || !sameStyle(run, runs[next.runIndex]!)
    const width = trackedGlyphWidth(cluster.text, run, lastInStyle, options)
    const fragment = immutablePixelParts.freeze({ ...cluster, x, width })
    min = Math.min(min, x); max = Math.max(max, x + width)
    x += width + (options.letterSpacing ?? 0)
    return fragment
  })
  return { width: max - min, originX: -min, fragments: immutablePixelParts.freeze(fragments) }
}

/** Fit each style run itself: fitting a parent containing style descendants is
 * not applied consistently by native SVG rasterizers. Keep whole-run shaping
 * and its authored whitespace, rather than measuring these glyphs separately. */
function styledRunLayout(runs: readonly DisplayRun[], options: PixelTextOptions): { width: number; originX: number; fragments: readonly PixelTextFragment[] } {
  const groups: { runIndex: number; text: string }[] = []
  for (const [runIndex, run] of runs.entries()) {
    const prior = groups.at(-1)
    if (prior && sameStyle(runs[prior.runIndex]!, run)) prior.text += run.text
    else groups.push({ runIndex, text: run.text })
  }
  let x = 0
  const fragments = groups.map(({ runIndex, text }) => {
    const width = advance([{ ...runs[runIndex]!, text }], options)
    const fragment = immutablePixelParts.freeze({ runIndex, text, x, width })
    x += width
    return fragment
  })
  return { width: x, originX: 0, fragments: immutablePixelParts.freeze(fragments) }
}

function trackedGlyphWidth(text: string, run: DisplayRun, lastInStyle: boolean, options: PixelTextOptions): number {
  const weight = run.bold ? Math.max(700, options.fontWeight) : options.fontWeight
  const fontStyle = run.italic ? 'italic' : 'normal'
  const measure = options.safeFont ? measureSystemFontSafeTextWidth : measureTextWidth
  return options.monospace ? measureMonospaceTextWidth(text, options.fontSize, 0, weight, fontStyle, options.fontFamily)
    : measure(text, options.fontSize, weight, fontStyle, options.fontFamily) - (lastInStyle || customTextMeasurementActive() ? 0 : options.fontSize * 0.15)
}

/** With negative tracking, total advance can be zero while glyph intervals
 * still occupy space. Bounds enclose every interval rather than clamping the
 * final pen position and pretending that nothing is drawn. */
function trackedBounds(runs: readonly DisplayRun[], options: PixelTextOptions): { width: number; originX: number } {
  let x = 0, min = 0, max = 0
  for (const run of runs) {
    const clusters = graphemes(run.text)
    for (const [i, cluster] of clusters.entries()) {
      const width = trackedGlyphWidth(cluster, run, i === clusters.length - 1, options)
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
  if (performanceExperimentEnabled('text-spans')) options = {
    display: options.display, transform: options.transform, fontSize: options.fontSize, fontWeight: options.fontWeight,
    letterSpacing: options.letterSpacing, maxWidth: options.maxWidth, safeFont: options.safeFont, monospace: options.monospace, fontFamily: options.fontFamily,
  }
  if (!Number.isFinite(options.fontSize) || options.fontSize <= 0 || !Number.isFinite(options.fontWeight) || !Number.isFinite(options.letterSpacing ?? 0)) throw new RangeError('Prepared text requires finite typography and a positive font size')
  const cacheKey = performanceExperimentEnabled('text-spans') && !customTextMeasurementActive() && typeof source === 'string' && source.length <= 16384
    ? JSON.stringify([source, options, profileTextFontFamily()]) : undefined
  if (cacheKey !== undefined) { const cached = pixelBlocks.get(cacheKey); if (cached) return cached }
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
    const textSpans = performanceExperimentEnabled('text-spans')
    const spans = textSpans && !customTextMeasurementActive() ? asciiAdvanceSpans(original, options) : undefined
    const fits = textSpans ? (from: number, to: number): boolean => {
      const estimate = spans?.width(from, to)
      // Prefix subtraction can differ by an ulp from a fresh left-fold. Keep
      // the exact predicate near a wrapping boundary, including authored ties.
      if (estimate !== undefined && Math.abs(estimate - maxWidth) > 1e-8 * Math.max(1, Math.abs(estimate), Math.abs(maxWidth))) return estimate < maxWidth
      return advance(clusters.slice(from, to), options) <= maxWidth
    } : undefined
    let start = 0
    while (start < clusters.length) {
      let end = start
      let whitespace = -1
      if (fits) {
        while (end < clusters.length && fits(start, end + 1)) {
          if (/\s/u.test(clusters[end]!.text)) whitespace = end + 1
          end++
        }
      } else {
        while (end < clusters.length && advance(clusters.slice(start, end + 1), options) <= maxWidth) {
          if (/\s/u.test(clusters[end]!.text)) whitespace = end + 1
          end++
        }
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
      const sourceOffset = spans?.offsets[end] ?? clusters[end]?.sourceStart ?? prepared.source.length
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
  const lineBlocks: PixelTextLine[] = []
  let completeInk = customTextInkActive() && !options.monospace
  for (let i = 0; i < broken.length; i++) {
    const runs = broken[i]!
    const text = runs.map(run => prepared.display === 'literal' ? run.text : serializeStyledSegment(run)).join('')
    runs.forEach(immutablePixelParts.freeze)
    const ascii = !/[^\x20-\x7e]/u.test(text)
    const styled = runs.some(run => run.bold || run.italic || run.underline || run.strikethrough)
    let allocation = ascii ? (options.letterSpacing ?? 0) !== 0 ? trackingLayout(runs, options) : styled ? styledRunLayout(runs, options) : undefined : undefined
    let ink: ProfileTextInkMeasurement | undefined
    if (completeInk && ascii && !runs.some(run => run.underline || run.strikethrough)) {
      if (allocation) {
        const fragments = allocation.fragments.map(fragment => {
          const measured = preparedRunInk(fragment.text, runs[fragment.runIndex], options)
          if (!measured) completeInk = false
          return immutablePixelParts.freezeOwned({ ...fragment, ...(measured ? { ink: measured } : {}) })
        })
        allocation = { ...allocation, fragments: immutablePixelParts.freezeOwned(fragments) }
      } else {
        ink = preparedRunInk(runs.map(run => run.text).join(''), undefined, options)
        if (!ink) completeInk = false
      }
    } else completeInk = false
    lineBlocks.push(immutablePixelParts.freezeOwned({ runs: immutablePixelParts.freezeOwned(runs), text, width: allocation?.width ?? advance(runs, options), baseline: i * lineHeight + options.fontSize * 0.35, originX: allocation?.originX ?? 0, ...(allocation ? { fragments: allocation.fragments } : {}), ...(ink ? { ink } : {}) }))
  }
  const lines: string[] = []
  for (const line of lineBlocks) lines.push(line.text)
  immutablePixelParts.freezeOwned(lines)
  breaks.forEach(immutablePixelParts.freezeOwned)
  const width = lineBlocks.reduce((max, line) => Math.max(max, line.width), 0)
  // A shaped block may be reused under another document. Its measured face
  // must remain an emitted override rather than inheriting that new root.
  const selectedFont = options.fontFamily ?? profileTextFontFamily()
  const interEnvelope = !customTextMeasurementActive() && selectedFont === 'Inter' && !options.monospace && lineBlocks.every(line =>
    line.runs.every(run => !run.italic && !run.underline && !run.strikethrough)
    && (line.fragments ? line.fragments.every(fragment => interTextEnvelope(fragment.text, line.runs[fragment.runIndex]!.bold ? Math.max(700, options.fontWeight) : options.fontWeight, options.fontSize, fragment.width) !== undefined)
      : interTextEnvelope(line.runs.map(run => run.text).join(''), options.fontWeight, options.fontSize, line.width) !== undefined))
  const fontFamily = options.fontFamily ?? (completeInk ? selectedFont : undefined)
  if (!fontFamily) completeInk = false
  const block: PixelTextBlock = immutablePixelParts.freezeOwned({ unit: 'px', prepared, text: lines.join('\n'), lines, lineBlocks: immutablePixelParts.freezeOwned(lineBlocks), breaks: immutablePixelParts.freezeOwned(breaks), width, height: lines.length * lineHeight, lineHeight, fontSize: options.fontSize, fontWeight: options.fontWeight, letterSpacing: options.letterSpacing ?? 0, monospace: options.monospace ?? false, safeFont: options.safeFont ?? false, ...(fontFamily ? { fontFamily } : {}) })
  if (immutablePixelParts.has(block)) {
    preparedBlocks.add(block)
    if (completeInk) shapedInkBlocks.add(block)
    if (interEnvelope) interEnvelopeBlocks.add(block)
    if (cacheKey !== undefined) pixelBlocks.set(cacheKey, block, cacheKey.length * 2 + block.prepared.source.length * 128 + block.lines.length * 256 + 512)
  }
  return block
}

/** A line projection keeps the measured runs and their original preparation. */
export function pixelTextLine(block: PixelTextBlock | undefined, index: number): PixelTextBlock | undefined {
  const line = block?.lineBlocks[index]
  if (!block || !line) return undefined
  if (!isRetainedPixelText(block)) throw new TypeError('Pixel line projection requires retained preparation')
  const parts: { value: object; prototype: object | null; keys: readonly PropertyKey[]; slots: PropertyDescriptor[]; valid: boolean }[] = []
  const freezePart = <T extends object>(value: T): Readonly<T> => {
    const prototype = pixelProjectionPrototype(value), keys = pixelProjectionKeys(value), slots: PropertyDescriptor[] = []
    let valid = true
    for (let i = 0; i < keys.length; i++) {
      const slot = pixelProjectionDescriptor(value, keys[i]!)
      if (!slot || !pixelProjectionOwn(slot, 'value')) { valid = false; break }
      pixelProjectionDefine(slots, i, { value: slot, enumerable: true })
    }
    pixelProjectionDefine(parts, parts.length, { value: { value, prototype, keys, slots, valid }, enumerable: true })
    return immutablePixelParts.freeze(value)
  }
  const lines = [line.text]
  freezePart(lines)
  const projected: PixelTextBlock = freezePart({ ...block, text: line.text, lines, lineBlocks: freezePart([freezePart({ ...line, baseline: block.fontSize * 0.35 })]), breaks: freezePart([]), width: line.width, height: block.lineHeight })
  // Projection derives the source's measurement authority. Admitted snapshots
  // need no constructor ownership. Authenticate each new wrapper after all
  // dynamic freezes, retaining its original data and child references.
  let valid = parts.length === 5
  for (let partIndex = 0; valid && partIndex < parts.length; partIndex++) {
    const part = parts[partIndex]!
    if (!part.valid || !pixelProjectionFrozen(part.value) || pixelProjectionPrototype(part.value) !== part.prototype) { valid = false; break }
    const keys = pixelProjectionKeys(part.value)
    if (keys.length !== part.keys.length) { valid = false; break }
    for (let i = 0; i < keys.length; i++) {
      const slot = pixelProjectionDescriptor(part.value, keys[i]!), before = part.slots[i]!
      if (keys[i] !== part.keys[i] || !slot || !pixelProjectionOwn(slot, 'value')
        || !pixelProjectionSame(slot.value, before.value) || slot.enumerable !== before.enumerable) { valid = false; break }
    }
  }
  if (valid) transferRetainedPixelText(block, projected)
  return projected
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
