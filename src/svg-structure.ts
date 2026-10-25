import { decodeXML } from 'entities'
import { inspectSvgOnce } from './svg-inspection-cache.ts'
import { isAsciiXmlNameChar } from './shared/xml-name.ts'

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
function isWhitespace(char: string | undefined): boolean {
  if (char === undefined) return false
  const code = char.charCodeAt(0)
  if (code < 128) return code === 32 || (code >= 9 && code <= 13)
  return /\s/.test(char)
}

function scanTagEnd(source: string, start: number): number {
  let end = source.indexOf('>', start)
  if (end < 0) return -1
  for (let cursor = start; cursor < end; cursor++) {
    const char = source[cursor]
    if (char !== '"' && char !== "'") continue
    const close = source.indexOf(char, cursor + 1)
    if (close < 0) return -1
    cursor = close
    if (close > end) {
      end = source.indexOf('>', close + 1)
      if (end < 0) return -1
    }
  }
  return end + 1
}

/** Quote-aware lexical start-tag scan shared by safe SVG post-processors.
 * Final XML admission remains the authority for well-formedness; this scanner
 * only supplies exact attribute/text ranges without ever interpreting text
 * nodes as markup or CSS. */
export function scanSvgStartTags(source: string): readonly SvgStartTagToken[] {
  return inspectSvgOnce('start-tags', source, () => scanStartTags(source)!)
}

/** Constructor checks need the first tag's values, not retained token objects. */
export function visitSvgFirstTagAttributes(source: string, expectedName: string, attribute: (name: string, value: string) => void): string | undefined {
  const visitor = { attribute, expectedName, name: undefined as string | undefined }
  scanStartTags(source, undefined, undefined, visitor)
  return visitor.name
}

// One lexical owner: inventory, CSS values/contexts, or style bodies only.
function scanStartTags(source: string, cssRanges?: SvgRange[], styleContexts?: SvgRange[], first?: { attribute(name: string, value: string): void; expectedName: string; name: string | undefined }): readonly SvgStartTagToken[] | undefined {
  const tags: SvgStartTagToken[] | undefined = cssRanges || styleContexts || first ? undefined : []
  for (let start = source.indexOf('<'); start >= 0; start = source.indexOf('<', start + 1)) {
    if (source.startsWith('<!--', start)) {
      const end = source.indexOf('-->', start + 4)
      if (end < 0) break
      start = end + 2
      continue
    }
    const initial = source[start + 1]
    if (!initial || initial === '/' || initial === '!' || initial === '?') continue
    let nameEnd = start + 1
    while (isAsciiXmlNameChar(source[nameEnd])) nameEnd++
    if (nameEnd === start + 1) continue
    const end = scanTagEnd(source, nameEnd)
    if (end < 0) break
    // `/\s*>` at the end of the tag, read backwards without slicing it.
    let beforeClose = end - 2
    while (beforeClose > start && isWhitespace(source[beforeClose])) beforeClose--
    const name = source.slice(start + 1, nameEnd)
    if (first) first.name = name
    const selfClosing = source[beforeClose] === '/'
    const attributes: SvgAttributeToken[] | undefined = tags ? [] : undefined
    if (tags || cssRanges || first) {
      let cursor = nameEnd
      while (cursor < end - 1) {
        while (isWhitespace(source[cursor])) cursor++
        if (source[cursor] === '>' || (source[cursor] === '/' && source[cursor + 1] === '>')) break
        const nameStart = cursor
        while (isAsciiXmlNameChar(source[cursor])) cursor++
        if (cursor === nameStart) break
        const name = source.slice(nameStart, cursor)
        while (isWhitespace(source[cursor])) cursor++
        if (source[cursor] !== '=') break
        cursor++
        while (isWhitespace(source[cursor])) cursor++
        const quote = source[cursor]
        if (quote !== '"' && quote !== "'") break
        cursor++
        const valueStart = cursor
        const valueEnd = source.indexOf(quote, cursor)
        if (valueEnd < 0 || valueEnd >= end - 1) break
        cursor = valueEnd
        if (attributes) attributes.push(Object.freeze({ name, value: source.slice(valueStart, cursor), quote, nameStart, valueStart, valueEnd: cursor }))
        else if (first && first.name === first.expectedName) first.attribute(name, source.slice(valueStart, cursor))
        else if (cssRanges && CSS_VALUE_ATTRIBUTES.has(name)) {
          const range = { start: valueStart, end: cursor }
          cssRanges.push(range)
          if (name === 'style') styleContexts!.push(range)
        }
        cursor++
      }
    }
    if (tags) tags.push(Object.freeze({ name, start, end, attributes: Object.freeze(attributes!), selfClosing }))
    if (first) return undefined
    if (styleContexts && name === 'style' && !selfClosing) {
      const close = source.indexOf('</style', end)
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

export function transformSvgAttributes(
  source: string,
  transform: (attribute: SvgAttributeToken, tag: SvgStartTagToken) => string | undefined,
): string {
  const replacements: Replacement[] = []
  for (const tag of scanSvgStartTags(source)) {
    for (const attribute of tag.attributes) {
      const value = transform(attribute, tag)
      if (value !== undefined && value !== attribute.value) {
        replacements.push({ start: attribute.valueStart, end: attribute.valueEnd, value })
      }
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
export interface SvgCssProjection {
  readonly source: string
  readonly cssRanges: readonly SvgRange[]
  readonly styleContexts: readonly SvgRange[]
}

export function projectSvgCss(source: string): SvgCssProjection {
  const cssRanges: SvgRange[] = []
  const styleContexts: SvgRange[] = []
  scanStartTags(source, cssRanges, styleContexts)
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
  transform: (css: string) => string,
  projection: SvgCssProjection = projectSvgCss(source),
): string {
  if (projection.source !== source) throw new Error('SVG CSS projection does not match its source')
  return applyReplacements(source, projection.cssRanges.map(range => ({
    ...range,
    value: transform(source.slice(range.start, range.end)),
  })))
}

export function replaceSvgRootStartTag(
  source: string,
  root: SvgStartTagToken,
  replacement: string,
): string {
  return `${source.slice(0, root.start)}${replacement}${source.slice(root.end)}`
}
