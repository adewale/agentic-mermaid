import { writtenTagOf, projectWrittenTag, writerEvidenceEnabled, type WrittenReplacement } from './svg-writer-evidence.ts'
import { decodeXML } from 'entities'
import { createSvgInspector } from './svg-inspection-cache.ts'
import { asciiXmlNameEnd, isAsciiXmlNameChar, xmlTokenAt, xmlIndexOf, xmlSlice } from './shared/xml-name.ts'

export interface SvgAttributeToken {
  readonly name: string
  readonly value: string
  readonly quote: '"' | "'"
  readonly nameStart: number
  readonly valueStart: number
  readonly valueEnd: number
}

export interface SvgStartTagToken {
  readonly name: string
  readonly start: number
  /** Offset immediately after `>`. */
  readonly end: number
  readonly attributes: readonly SvgAttributeToken[]
  readonly selfClosing: boolean
}

/** Exactly JavaScript's `\s`, without a regex call per ASCII character. */
function isWhitespace(char: string | undefined, fresh = false): boolean {
  if (char === undefined) return false
  if (!fresh) {
    const code = char.charCodeAt(0)
    if (code < 128) return code === 32 || (code >= 9 && code <= 13)
    return /\s/.test(char)
  }
  return char === ' ' || char >= '\t' && char <= '\r' || char === '\u00a0' || char === '\u1680'
    || char >= '\u2000' && char <= '\u200a' || char === '\u2028' || char === '\u2029'
    || char === '\u202f' || char === '\u205f' || char === '\u3000' || char === '\ufeff'
}

/** Private lexical membership must not borrow an inherited split/includes
 * result as evidence about the actual class string. */
export function svgClassHasTokenFresh(value: string, token: string): boolean {
  let start = 0
  for (let end = 0; end <= value.length; end++) {
    if (end !== value.length && !isWhitespace(value[end], true)) continue
    if (end - start === token.length && xmlTokenAt(value, token, start)) return true
    start = end + 1
  }
  return false
}

function sourceIndexOf(source: string, token: string, start: number | undefined, fresh: boolean): number {
  return fresh ? xmlIndexOf(source, token, start ?? 0) : start === undefined ? source.indexOf(token) : source.indexOf(token, start)
}
function sourceTokenAt(source: string, token: string, start: number, fresh: boolean): boolean {
  return fresh ? xmlTokenAt(source, token, start) : source.startsWith(token, start)
}
function sourceSlice(source: string, start: number, end: number, fresh: boolean): string {
  return fresh ? xmlSlice(source, start, end) : source.slice(start, end)
}

function scanTagEnd(source: string, start: number, fresh = false): number {
  let end = sourceIndexOf(source, '>', start, fresh)
  if (end < 0) return -1
  for (let cursor = start; cursor < end; cursor++) {
    const char = source[cursor]
    if (char !== '"' && char !== "'") continue
    const close = sourceIndexOf(source, char, cursor + 1, fresh)
    if (close < 0) return -1
    cursor = close
    if (close > end) {
      end = sourceIndexOf(source, '>', close + 1, fresh)
      if (end < 0) return -1
    }
  }
  return end + 1
}

function scanStyleClose(source: string, start: number, fresh: boolean): number {
  for (let cursor = sourceIndexOf(source, '<', start, fresh); cursor >= 0; cursor = sourceIndexOf(source, '<', cursor + 1, fresh)) {
    const comment = sourceTokenAt(source, '<!--', cursor, fresh), cdata = sourceTokenAt(source, '<![CDATA[', cursor, fresh)
    if (comment || cdata) {
      const end = sourceIndexOf(source, comment ? '-->' : ']]>', cursor + (comment ? 4 : 9), fresh)
      if (end < 0) return -1
      cursor = end + 2
    } else if (sourceTokenAt(source, '</style', cursor, fresh) && (source[cursor + 7] === '>' || isWhitespace(source[cursor + 7], fresh))) return cursor
  }
  return -1
}

/** Quote-aware lexical start-tag scan shared by safe SVG post-processors.
 * Final XML admission remains the authority for well-formedness; this scanner
 * only supplies exact attribute/text ranges without ever interpreting text
 * nodes as markup or CSS. */
const inspectStartTags = createSvgInspector('start-tags', source => scanStartTags(source)!)

export function scanSvgStartTags(source: string): readonly SvgStartTagToken[] {
  return inspectStartTags(source)
}

/** Private emission custody needs fresh lexical data, rather than a public
 * inspection-cache entry supplied by another caller. */
export function scanSvgStartTagsFresh(source: string): readonly SvgStartTagToken[] {
  return scanStartTags(source, undefined, undefined, undefined, true)!
}

/** Constructor checks need the first tag's values, not retained token objects. */
export function visitSvgFirstTagAttributes(source: string, expectedName: string, attribute: (name: string, value: string) => void): string | undefined {
  const visitor = { attribute, expectedName, name: undefined as string | undefined }
  scanStartTags(source, undefined, undefined, visitor)
  return visitor.name
}

/** Native validation can retain primitive operands without exposing the
 * scanner's arrays to inherited push hooks. Generic visitors stay observable. */
export function visitSvgStartTagsFresh(source: string, visitor: {
  tag(name: string, start: number, end: number, selfClosing: boolean): void
  attribute(name: string, value: string, quote: '"' | "'", nameStart: number, valueStart: number, valueEnd: number): void
}): void {
  scanStartTags(source, undefined, undefined, undefined, true, visitor)
}

// One lexical owner: inventory, CSS values/contexts, or style bodies only.
function scanStartTags(source: string, cssRanges?: SvgRange[], styleContexts?: SvgRange[], first?: { attribute(name: string, value: string): void; expectedName: string; name: string | undefined }, fresh = false, primitive?: Parameters<typeof visitSvgStartTagsFresh>[1], collectWritten = false): readonly SvgStartTagToken[] | undefined {
  const tags: SvgStartTagToken[] | undefined = cssRanges || styleContexts || first || primitive ? undefined : []
  for (let start = sourceIndexOf(source, '<', undefined, fresh); start >= 0; start = sourceIndexOf(source, '<', start + 1, fresh)) {
    if (sourceTokenAt(source, '<!--', start, fresh)) {
      const end = sourceIndexOf(source, '-->', start + 4, fresh)
      if (end < 0) break
      start = end + 2
      continue
    }
    if (sourceTokenAt(source, '<![CDATA[', start, fresh)) {
      const end = sourceIndexOf(source, ']]>', start + 9, fresh)
      if (end < 0) break
      start = end + 2
      continue
    }
    const initial = source[start + 1]
    if (!initial || initial === '/' || initial === '!' || initial === '?') continue
    let nameEnd = start + 1
    if (fresh) { while (isAsciiXmlNameChar(source[nameEnd], true)) nameEnd++ }
    else nameEnd = asciiXmlNameEnd(source, nameEnd)
    if (nameEnd === start + 1) continue
    const end = scanTagEnd(source, nameEnd, fresh)
    if (end < 0) break
    // `/\s*>` at the end of the tag, read backwards without slicing it.
    let beforeClose = end - 2
    while (beforeClose > start && isWhitespace(source[beforeClose], fresh)) beforeClose--
    const name = sourceSlice(source, start + 1, nameEnd, fresh)
    if (first) first.name = name
    const selfClosing = source[beforeClose] === '/'
    primitive?.tag(name, start, end, selfClosing)
    const attributes: SvgAttributeToken[] | undefined = tags ? [] : undefined
    if (tags || cssRanges || first || primitive) {
      let cursor = nameEnd
      while (cursor < end - 1) {
        while (isWhitespace(source[cursor], fresh)) cursor++
        if (source[cursor] === '>' || (source[cursor] === '/' && source[cursor + 1] === '>')) break
        const nameStart = cursor
        if (fresh) { while (isAsciiXmlNameChar(source[cursor], true)) cursor++ }
        else cursor = asciiXmlNameEnd(source, cursor)
        if (cursor === nameStart) break
        const name = sourceSlice(source, nameStart, cursor, fresh)
        while (isWhitespace(source[cursor], fresh)) cursor++
        if (source[cursor] !== '=') break
        cursor++
        while (isWhitespace(source[cursor], fresh)) cursor++
        const quote = source[cursor]
        if (quote !== '"' && quote !== "'") break
        cursor++
        const valueStart = cursor
        const valueEnd = sourceIndexOf(source, quote, cursor, fresh)
        if (valueEnd < 0 || valueEnd >= end - 1) break
        cursor = valueEnd
        if (attributes) attributes.push(Object.freeze({ name, value: sourceSlice(source, valueStart, cursor, fresh), quote, nameStart, valueStart, valueEnd: cursor }))
        else if (first && first.name === first.expectedName) first.attribute(name, sourceSlice(source, valueStart, cursor, fresh))
        else if (primitive) primitive.attribute(name, sourceSlice(source, valueStart, cursor, fresh), quote, nameStart, valueStart, cursor)
        else if (cssRanges && CSS_VALUE_ATTRIBUTES.has(name)) {
          const range: SvgCssRange = collectWritten ? { start: valueStart, end: cursor, tagStart: start, tagEnd: end, name } : { start: valueStart, end: cursor }
          cssRanges.push(range)
          if (name === 'style') styleContexts!.push(range)
        }
        cursor++
      }
    }
    if (tags) tags.push(Object.freeze({ name, start, end, attributes: Object.freeze(attributes!), selfClosing }))
    if (first) return undefined
    if (styleContexts && name === 'style' && !selfClosing) {
      const close = scanStyleClose(source, end, fresh)
      if (close >= 0) {
        const range = { start: end, end: close }
        cssRanges?.push(range)
        styleContexts.push(range)
      }
    }
    start = end - 1
  }
  return tags && Object.freeze(tags)
}

export function svgRootStartTag(source: string): SvgStartTagToken | undefined {
  const firstNonWhitespace = source.search(/\S/)
  if (firstNonWhitespace < 0) return undefined
  // A root lookup needs only its opening tag, not every mark in the drawing.
  const end = scanTagEnd(source, firstNonWhitespace)
  if (end < 0) return undefined
  const root = scanSvgStartTags(source.slice(0, end))[0]
  return root?.start === firstNonWhitespace && root.name === 'svg' ? root : undefined
}

export function svgAttribute(
  tag: SvgStartTagToken,
  name: string,
): SvgAttributeToken | undefined {
  return tag.attributes.find(attribute => attribute.name === name)
}

export function decodedSvgAttributeValue(
  tag: SvgStartTagToken,
  name: string,
): string | undefined {
  const attribute = svgAttribute(tag, name)
  return attribute ? decodeXML(attribute.value) : undefined
}

interface Replacement {
  readonly start: number
  readonly end: number
  readonly value: string
  readonly name?: string
  readonly tagStart?: number
  readonly tagEnd?: number
}

// Replacement ranges are normally disjoint (attribute values, style text), so
// one linear pass assembles the result instead of re-copying it per range.
// Overlap is possible only for tag-like text inside <style>; it keeps the
// original right-to-left semantics.
function applyReplacements(source: string, replacements: readonly Replacement[]): string {
  if (replacements.length === 0) return source
  const ordered = [...replacements].sort((left, right) => right.start - left.start)
  const parts: string[] = []
  let cursor = source.length
  for (const replacement of ordered) {
    if (replacement.end > cursor) {
      let output = source
      for (const range of ordered) output = `${output.slice(0, range.start)}${range.value}${output.slice(range.end)}`
      return output
    }
    parts.push(source.slice(replacement.end, cursor), replacement.value)
    cursor = replacement.start
  }
  parts.push(source.slice(0, cursor))
  return parts.reverse().join('')
}

function carryWrittenTags(source: string, changes: readonly Replacement[]): void {
  let start = -1, end = -1
  let owned: WrittenReplacement[] = []
  const retain = () => {
    if (!owned.length) return
    const tag = writtenTagOf(source.slice(start, end))
    if (tag) projectWrittenTag(source, { start, end, tag }, owned)
  }
  for (const change of changes) {
    if (change.tagStart === undefined) continue
    if (change.tagStart !== start) {
      retain()
      start = change.tagStart; end = change.tagEnd!; owned = []
    }
    owned.push(change)
  }
  retain()
}

export function transformSvgAttributes(
  source: string,
  transform: (attribute: SvgAttributeToken, tag: SvgStartTagToken) => string | undefined,
): string {
  const replacements: Replacement[] = []
  const collectWritten = writerEvidenceEnabled()
  for (const tag of scanSvgStartTags(source)) {
    const firstChange = replacements.length
    for (const attribute of tag.attributes) {
      const value = transform(attribute, tag)
      if (value !== undefined && value !== attribute.value) {
        const change = { start: attribute.valueStart, end: attribute.valueEnd, value, name: attribute.name }
        replacements.push(change)
      }
    }
    if (collectWritten && replacements.length > firstChange) {
      const evidence = writtenTagOf(source.slice(tag.start, tag.end))
      if (evidence) projectWrittenTag(source, { start: tag.start, end: tag.end, tag: evidence }, replacements.slice(firstChange))
    }
  }
  return applyReplacements(source, replacements)
}

const CSS_VALUE_ATTRIBUTES = new Set([
  'clip-path', 'color', 'cursor', 'fill', 'filter', 'flood-color',
  'lighting-color', 'marker-end', 'marker-mid', 'marker-start', 'mask',
  'stop-color', 'stroke', 'style',
])

export interface SvgRange {
  readonly start: number
  readonly end: number
}

/** Local lexical CSS metadata, valid only for this exact immutable string.
 * Consumed synchronously; never public inspection evidence or XML admission. */
interface SvgCssRange extends SvgRange {
  readonly tagStart?: number
  readonly tagEnd?: number
  readonly name?: string
}

export interface SvgCssProjection {
  readonly source: string
  readonly cssRanges: readonly SvgCssRange[]
  readonly styleContexts: readonly SvgRange[]
}

export function projectSvgCss(source: string): SvgCssProjection {
  const cssRanges: SvgCssRange[] = []
  const styleContexts: SvgRange[] = []
  scanStartTags(source, cssRanges, styleContexts, undefined, false, undefined, writerEvidenceEnabled())
  return { source, cssRanges, styleContexts }
}

/** Style bodies only: skip attribute parsing and retain no tag inventory. */
export function svgStyleRanges(source: string): readonly SvgRange[] {
  const ranges: SvgRange[] = []
  scanStartTags(source, undefined, ranges)
  return ranges
}

export function svgCssText(source: string): string {
  return projectSvgCss(source).cssRanges.map(range => source.slice(range.start, range.end)).join('\n')
}

export function transformSvgCssValues(
  source: string,
  transform: (css: string, range: SvgRange) => string,
  projection: SvgCssProjection = projectSvgCss(source),
): string {
  if (projection.source !== source) throw new Error('SVG CSS projection does not match its source')
  const changes: Replacement[] = []
  for (const range of projection.cssRanges) {
    const original = source.slice(range.start, range.end)
    const value = transform(original, range)
    if (value !== original) changes.push({ ...range, value, name: range.name })
  }
  if (writerEvidenceEnabled()) carryWrittenTags(source, changes)
  return applyReplacements(source, changes)
}

export function replaceSvgRootStartTag(
  source: string,
  root: SvgStartTagToken,
  replacement: string,
): string {
  return `${source.slice(0, root.start)}${replacement}${source.slice(root.end)}`
}
