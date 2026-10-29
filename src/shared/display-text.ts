import { performanceExperimentEnabled } from '../experimental-performance.ts'
import { WeightedLru } from '../experimental/weighted-lru.ts'
import type { LabelDisplay } from '../multiline-utils.ts'
import type { TextTransform } from '../types.ts'
import { parseInlineFormatting, serializeStyledSegment, FORMAT_TAG_SOURCE, type StyledSegment } from './inline-format.ts'
import { graphemes } from './graphemes.ts'
import { createImmutableParts } from './immutable-parts.ts'
import { sanitizeTextControls } from './text-controls.ts'

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

const displayPlans = new WeightedLru<string, PreparedDisplayText>(512, 4 * 1024 * 1024)
const retainedPlans = new WeakSet<object>()
const immutableDisplayParts = createImmutableParts()
export function isImmutableDisplayTextPart(value: object): boolean { return immutableDisplayParts.has(value) }
function retainPlan(plan: PreparedDisplayText): PreparedDisplayText { retainedPlans.add(plan); return plan }

/** Capture a supplied interpretation without reading its source a second time. */
function immutablePlan(plan: PreparedDisplayText): PreparedDisplayText {
  if (retainedPlans.has(plan)) return plan
  return retainPlan(immutableDisplayParts.freeze({
    source: plan.source, display: plan.display, ...(plan.transform ? { transform: plan.transform } : {}),
    lineStarts: immutableDisplayParts.freeze([...plan.lineStarts]),
    lines: immutableDisplayParts.freeze(plan.lines.map(line => immutableDisplayParts.freeze(line.map(run => immutableDisplayParts.freeze({
      ...run, ...(run.clusters ? { clusters: immutableDisplayParts.freeze(run.clusters.map(cluster => immutableDisplayParts.freeze({ ...cluster }))) } : {}),
    }))))),
  }))
}

/** A family's public string and the display reading that produced it. The
 * snapshot prevents a later direct string edit from reusing stale runs. */
export interface LabelContent {
  readonly value: string
  readonly prepared: PreparedDisplayText
  /** Family lexical payload before display/entity normalization, with its
   * quoting removed. This is not an original diagram source coordinate. */
  readonly authored?: string
}

export type DisplayTextInput = string | PreparedDisplayText

export function resolveLabelContent(value: string, content?: LabelContent): DisplayTextInput {
  return content?.value === value ? content.prepared : value
}

/** Visible characters, with no second interpretation of markup or entities. */
export function preparedDisplayTextValue(prepared: PreparedDisplayText): string {
  return prepared.lines.map(line => line.map(run => run.text).join('')).join('\n')
}

/** Decode tokens only after formatting has been read. A replacement retains
 * the whole token's span in the normalized, pre-expansion source. */
export function replaceDisplayTextTokens(prepared: PreparedDisplayText, pattern: RegExp, replace: (token: string) => string): PreparedDisplayText {
  prepared = immutablePlan(prepared)
  if (prepared.transform) throw new TypeError('Display tokens must be decoded before text transforms')
  const tokens = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g')
  const lines = prepared.lines.map(line => immutableDisplayParts.freeze(line.map(run => {
    const sourceStarts: number[] = [], sourceEnds: number[] = []
    for (const cluster of run.clusters ?? [{ text: run.text, sourceStart: run.sourceStart, sourceEnd: run.sourceEnd }]) {
      for (let index = 0; index < cluster.text.length; index++) {
        sourceStarts.push(cluster.sourceStart); sourceEnds.push(cluster.sourceEnd)
      }
    }
    const clusters: NonNullable<DisplayRun['clusters']>[number][] = []
    const append = (text: string, start: number, end: number, decoded: boolean): void => {
      let offset = start
      for (const cluster of graphemes(text)) {
        clusters.push(immutableDisplayParts.freeze({
          text: sanitizeTextControls(cluster),
          sourceStart: sourceStarts[decoded ? start : offset] ?? run.sourceStart,
          sourceEnd: sourceEnds[decoded ? end - 1 : offset + cluster.length - 1] ?? run.sourceEnd,
        }))
        offset += cluster.length
      }
    }
    let cursor = 0
    for (const match of run.text.matchAll(tokens)) {
      if (match[0].length === 0) throw new TypeError('Display token patterns must not match empty text')
      append(run.text.slice(cursor, match.index), cursor, match.index, false)
      append(replace(match[0]), match.index, match.index + match[0].length, true)
      cursor = match.index + match[0].length
    }
    append(run.text.slice(cursor), cursor, run.text.length, false)
    return immutableDisplayParts.freeze({ ...run, text: clusters.map(cluster => cluster.text).join(''), clusters: immutableDisplayParts.freeze(clusters) })
  })))
  return retainPlan(immutableDisplayParts.freeze({ ...prepared, lines: immutableDisplayParts.freeze(lines) }))
}

/** The inverse display layer: encode literal run text before adding its real
 * formatting and line breaks. The family owns lexical escaping. */
export function writeDisplayText(prepared: PreparedDisplayText, encodeText: (text: string) => string, lineBreak = '<br>'): string {
  if (prepared.transform) throw new TypeError('Authored text must be written before text transforms')
  return prepared.lines.map(line => line.map(run => serializeStyledSegment({ ...run, text: encodeText(run.text) })).join('')).join(lineBreak)
}

/** Add literal prefixes/suffixes or join labels without re-reading their text.
 * Source ranges are shifted into the concatenated normalized source. */
export function concatDisplayText(parts: readonly DisplayTextInput[]): PreparedDisplayText {
  const lines: DisplayRun[][] = [[]]
  const lineStarts = [0]
  let source = '', display: LabelDisplay = 'literal'
  for (const part of parts) {
    const prepared = prepareDisplayText(part, 'literal')
    if (prepared.transform) throw new TypeError('Display text must be combined before text transforms')
    if (prepared.display === 'formatted') display = 'formatted'
    const offset = source.length
    for (const [index, runs] of prepared.lines.entries()) {
      if (index > 0) { lines.push([]); lineStarts.push(offset + prepared.lineStarts[index]!) }
      for (const run of runs) lines.at(-1)!.push(immutableDisplayParts.freeze({
        ...run, sourceStart: offset + run.sourceStart, sourceEnd: offset + run.sourceEnd,
        ...(run.clusters ? { clusters: immutableDisplayParts.freeze(run.clusters.map(cluster => immutableDisplayParts.freeze({ ...cluster, sourceStart: offset + cluster.sourceStart, sourceEnd: offset + cluster.sourceEnd }))) } : {}),
      }))
    }
    source += prepared.source
  }
  return retainPlan(immutableDisplayParts.freeze({ source, display, lines: immutableDisplayParts.freeze(lines.map(line => immutableDisplayParts.freeze(line))), lineStarts: immutableDisplayParts.freeze(lineStarts) }))
}

/** Transform visible characters, never serialized formatting instructions. */
export function transformDisplayText(text: string, transform?: TextTransform): string {
  if (transform === 'uppercase') return text.toUpperCase()
  if (transform === 'lowercase') return text.toLowerCase()
  if (transform === 'capitalize') return text.replace(/(?<![\p{L}\p{M}\p{N}\p{Pc}])\p{L}/gu, ch => ch.toUpperCase())
  return text
}

/** Input is the family's already normalized label. No entity decoding, grammar
 * normalization, whitespace trimming or interpretation of decoded tag-like text.
 * Display controls become inert before either cell or pixel fitting; authored
 * source and cluster ranges retain their original values. */
export function prepareDisplayText(source: DisplayTextInput, display: LabelDisplay = 'formatted', transform?: TextTransform): PreparedDisplayText {
  if (typeof source !== 'string') {
    source = immutablePlan(source)
    if (!transform || source.transform === transform) return source
    if (source.transform) throw new TypeError('A prepared display transform cannot be replaced without its original runs')
    return transformPreparedDisplayText(source, transform)
  }
  const cacheKey = performanceExperimentEnabled('text-spans') && source.length <= 16384 ? JSON.stringify([source, display, transform]) : undefined
  if (cacheKey !== undefined) { const cached = displayPlans.get(cacheKey); if (cached) return cached }
  let offset = 0
  const lineStarts: number[] = []
  const empty = immutableDisplayParts.freeze([]) as readonly DisplayRun[]
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
    runs = runs.map(run => {
      let sourceAt = run.sourceStart
      const clusters = graphemes(run.text).map(cluster => {
        const result = immutableDisplayParts.freeze({ text: sanitizeTextControls(cluster), sourceStart: sourceAt, sourceEnd: sourceAt + cluster.length })
        sourceAt += cluster.length
        return result
      })
      return immutableDisplayParts.freeze({ ...run, text: clusters.map(cluster => cluster.text).join(''), clusters: immutableDisplayParts.freeze(clusters) })
    })
    offset += line.length + 1
    return immutableDisplayParts.freeze(runs)
  })
  const prepared = retainPlan(immutableDisplayParts.freeze({ source, display, lines: immutableDisplayParts.freeze(lines), lineStarts: immutableDisplayParts.freeze(lineStarts) }))
  const result = transform ? transformPreparedDisplayText(prepared, transform) : prepared
  if (cacheKey !== undefined) displayPlans.set(cacheKey, result, cacheKey.length * 2 + source.length * 96 + 256)
  return result
}

function transformPreparedDisplayText(prepared: PreparedDisplayText, transform: TextTransform): PreparedDisplayText {
  const lines = prepared.lines.map(line => {
    const visible = line.map(run => run.text).join('')
    const transformed = transformDisplayText(visible, transform)
    const capitalized = transform === 'capitalize' ? new Set([...visible.matchAll(/(?<![\p{L}\p{M}\p{N}\p{Pc}])\p{L}/gu)].map(match => match.index!)) : undefined
    let at = 0, transformedAt = 0
    return immutableDisplayParts.freeze(line.map(run => {
      const start = transformedAt
      const clusters = (run.clusters ?? [{ text: run.text, sourceStart: run.sourceStart, sourceEnd: run.sourceEnd }]).map(cluster => {
        const length = transform === 'uppercase' || capitalized?.has(at) ? cluster.text.toUpperCase().length : transform === 'lowercase' ? cluster.text.toLowerCase().length : cluster.text.length
        const text = transformed.slice(transformedAt, transformedAt + length)
        at += cluster.text.length; transformedAt += length
        return immutableDisplayParts.freeze({ ...cluster, text })
      })
      return immutableDisplayParts.freeze({ ...run, text: transformed.slice(start, transformedAt), clusters: immutableDisplayParts.freeze(clusters) })
    }))
  })
  return retainPlan(immutableDisplayParts.freeze({ ...prepared, transform, lines: immutableDisplayParts.freeze(lines) }))
}
