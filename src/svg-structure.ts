import { decodeXML } from 'entities'
import { inspectSvgOnce } from './svg-inspection-cache.ts'

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

function isNameChar(char: string | undefined): boolean {
  if (char === undefined) return false
  const code = char.charCodeAt(0)
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
    || (code >= 48 && code <= 57) || code === 95 || code === 46 || code === 58 || code === 45
}

/** Exactly JavaScript's `\s`, without a regex call per ASCII character. */
function isWhitespace(char: string | undefined): boolean {
  if (char === undefined) return false
  const code = char.charCodeAt(0)
  if (code < 128) return code === 32 || (code >= 9 && code <= 13)
  return /\s/.test(char)
}

function scanTagEnd(source: string, start: number): number {
  let quote: '"' | "'" | undefined
  for (let cursor = start; cursor < source.length; cursor++) {
    const char = source[cursor]!
    if (quote) {
      if (char === quote) quote = undefined
    } else if (char === '"' || char === "'") {
      quote = char
    } else if (char === '>') {
      return cursor + 1
    }
  }
  return -1
}

/** Quote-aware lexical start-tag scan shared by safe SVG post-processors.
 * Final XML admission remains the authority for well-formedness; this scanner
 * only supplies exact attribute/text ranges without ever interpreting text
 * nodes as markup or CSS. */
export function scanSvgStartTags(source: string): readonly SvgStartTagToken[] {
  return inspectSvgOnce('start-tags', source, () => scanStartTags(source))
}

function scanStartTags(source: string): readonly SvgStartTagToken[] {
  const tags: SvgStartTagToken[] = []
  for (let start = source.indexOf('<'); start >= 0; start = source.indexOf('<', start + 1)) {
    if (source.startsWith('<!--', start)) {
      const end = source.indexOf('-->', start + 4)
      if (end < 0) break
      start = end + 2
      continue
    }
    const first = source[start + 1]
    if (!first || first === '/' || first === '!' || first === '?') continue
    let nameEnd = start + 1
    while (isNameChar(source[nameEnd])) nameEnd++
    if (nameEnd === start + 1) continue
    const end = scanTagEnd(source, nameEnd)
    if (end < 0) break
    const attributes: SvgAttributeToken[] = []
    let cursor = nameEnd
    while (cursor < end - 1) {
      while (isWhitespace(source[cursor])) cursor++
      if (source[cursor] === '>' || (source[cursor] === '/' && source[cursor + 1] === '>')) break
      const nameStart = cursor
      while (isNameChar(source[cursor])) cursor++
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
      while (cursor < end - 1 && source[cursor] !== quote) cursor++
      if (source[cursor] !== quote) break
      attributes.push(Object.freeze({ name, value: source.slice(valueStart, cursor), quote, nameStart, valueStart, valueEnd: cursor }))
      cursor++
    }
    // `/\s*>` at the end of the tag, read backwards without slicing it.
    let beforeClose = end - 2
    while (beforeClose > start && isWhitespace(source[beforeClose])) beforeClose--
    tags.push(Object.freeze({
      name: source.slice(start + 1, nameEnd),
      start,
      end,
      attributes: Object.freeze(attributes),
      selfClosing: source[beforeClose] === '/',
    }))
    start = end - 1
  }
  return Object.freeze(tags)
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

function applyReplacementsRightToLeft(source: string, replacements: readonly Replacement[]): string {
  let output = source
  for (const replacement of [...replacements].sort((left, right) => right.start - left.start)) {
    output = `${output.slice(0, replacement.start)}${replacement.value}${output.slice(replacement.end)}`
  }
  return output
}

// Replacement ranges are normally disjoint (attribute values, style text), so
// one forward pass assembles the result instead of re-copying it per range.
// Overlap is possible only for tag-like text inside <style>; it keeps the
// original right-to-left semantics.
function applyReplacements(source: string, replacements: readonly Replacement[]): string {
  if (replacements.length === 0) return source
  const parts: string[] = []
  let cursor = 0
  for (const replacement of [...replacements].sort((left, right) => left.start - right.start)) {
    if (replacement.start < cursor) return applyReplacementsRightToLeft(source, replacements)
    parts.push(source.slice(cursor, replacement.start), replacement.value)
    cursor = replacement.end
  }
  parts.push(source.slice(cursor))
  return parts.join('')
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

function svgCssRanges(source: string): readonly { readonly start: number; readonly end: number }[] {
  const ranges: Array<{ start: number; end: number }> = []
  for (const tag of scanSvgStartTags(source)) {
    for (const attribute of tag.attributes) {
      if (CSS_VALUE_ATTRIBUTES.has(attribute.name)) {
        ranges.push({ start: attribute.valueStart, end: attribute.valueEnd })
      }
    }
    if (tag.name === 'style' && !tag.selfClosing) {
      const close = source.indexOf('</style', tag.end)
      if (close >= 0) ranges.push({ start: tag.end, end: close })
    }
  }
  return ranges
}

export function svgCssText(source: string): string {
  return svgCssRanges(source).map(range => source.slice(range.start, range.end)).join('\n')
}

export function transformSvgCssValues(source: string, transform: (css: string) => string): string {
  return applyReplacements(source, svgCssRanges(source).map(range => ({
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
