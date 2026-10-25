import { writeGrammarText } from './grammar-text.ts'

// Mermaid-universal accessibility directives — accTitle / accDescr single
// lines and accDescr { … } blocks — belong to our shared source envelope.
// Families without a pinned Mermaid production diagnose this native extension.
// Source normalization owns their grammar. Family parsers receive the
// directive-free grammar view plus this typed projection; they must not scan
// the source for the same metadata a second time.

export interface MermaidAccessibility {
  title?: string
  descr?: string
}

export interface ParsedAccessibilityDirective {
  title: boolean
  form: 'inline' | 'block' | 'native'
  value: string
  /** Index of the last physical line consumed by this directive. */
  endIndex: number
  /** A family statement authored after the closing brace on the same line. */
  suffixLine?: string
}

export interface AccessibilityScan {
  accessibility: MermaidAccessibility
  /** Original physical lines with valid universal directives removed. */
  familyLines: string[]
  /** The index in the scanned lines of each family line. */
  familyOrigins: number[]
  /** First unterminated accDescr block, retained in `familyLines`. */
  unclosedIndex?: number
}

const ACC_TITLE_RE = /^\s*accTitle(?:\s*:\s*|\s+)([^\r\n]+)$/i
const ACC_DESCR_PREFIX_RE = /^\s*accDescr(?=\s|:|\{|$)/i
/**
 * Parse one universal accessibility directive. `null` means the line is not
 * a directive; `undefined` means it opens an unclosed description block and
 * must remain family-visible so normal parse/opaque error handling still
 * applies.
 */
export function parseAccessibilityDirective(
  lines: readonly string[],
  startIndex: number,
): ParsedAccessibilityDirective | null | undefined {
  const line = lines[startIndex]
  if (line === undefined) return null

  const native = line.match(/^\s*%% agentic-mermaid (accTitle|accDescr): ("[^\r\n]*")\s*$/)
  if (native) {
    try {
      const value: unknown = JSON.parse(native[2]!)
      if (typeof value === 'string') return { title: native[1] === 'accTitle', form: 'native', value, endIndex: startIndex }
    } catch { /* Malformed comments remain ordinary authored comments. */ }
  }

  const descriptionPrefix = line.match(ACC_DESCR_PREFIX_RE)
  if (descriptionPrefix) {
    // Consume whitespace and the optional colon once. Two overlapping \s*
    // spans in the former block regex backtracked quadratically when a long
    // whitespace-only line had no opening brace.
    let description = line.slice(descriptionPrefix[0].length).trimStart()
    if (description.startsWith(':')) description = description.slice(1).trimStart()
    if (!description.startsWith('{')) {
      const value = description.trim()
      return value ? { title: false, form: 'inline', value, endIndex: startIndex } : null
    }
    const parts: string[] = []
    for (let index = startIndex; index < lines.length; index++) {
      const content = index === startIndex ? description.slice(1) : lines[index]!
      const closing = content.indexOf('}')
      if (closing < 0) {
        if (content.trim()) parts.push(content.trim())
        continue
      }
      const beforeClosing = content.slice(0, closing).trim()
      if (beforeClosing) parts.push(beforeClosing)
      const suffix = content.slice(closing + 1)
      const indent = lines[index]!.match(/^\s*/)?.[0] ?? ''
      return {
        title: false,
        form: 'block',
        value: parts.join('\n').trim(),
        endIndex: index,
        ...(suffix.trim() ? { suffixLine: indent + suffix.trimStart() } : {}),
      }
    }
    return undefined
  }

  const title = line.match(ACC_TITLE_RE)
  if (title) return { title: true, form: 'inline', value: title[1]!.trim(), endIndex: startIndex }
  return null
}

/**
 * Remove valid universal directives and collect their last-authored values in
 * one pass. Invalid/unclosed blocks and everything after them are preserved
 * byte-for-byte for the family parser. This is the source-normalization waist:
 * registered families receive its `familyLines` automatically and never need
 * their own accTitle/accDescr grammar.
 *
 * `statementEnds` gives, for each line, the last line of the family statement
 * that starts there (a quoted string may run onto later lines, see
 * quotedTextEnds). A line inside a statement is the family's text, never a
 * directive.
 */
export function scanAccessibilityDirectives(lines: readonly string[], statementEnds?: readonly number[], readValue?: (directive: ParsedAccessibilityDirective) => string): AccessibilityScan {
  const accessibility: MermaidAccessibility = {}
  const familyLines: string[] = []
  const familyOrigins: number[] = []
  let unclosedIndex: number | undefined

  for (let index = 0; index < lines.length; index++) {
    const directive = parseAccessibilityDirective(lines, index)
    if (directive === undefined) {
      unclosedIndex = index
      familyLines.push(...lines.slice(index))
      for (let origin = index; origin < lines.length; origin++) familyOrigins.push(origin)
      break
    }
    if (directive === null) {
      const end = statementEndAt(statementEnds, index, lines.length)
      familyLines.push(...lines.slice(index, end + 1))
      for (let origin = index; origin <= end; origin++) familyOrigins.push(origin)
      index = end
      continue
    }
    const value = readValue ? readValue(directive) : directive.value
    if (directive.title) accessibility.title = value
    else accessibility.descr = value
    if (directive.suffixLine) {
      familyLines.push(directive.suffixLine)
      familyOrigins.push(directive.endIndex)
    }
    index = directive.endIndex
  }

  return {
    accessibility,
    familyLines,
    familyOrigins,
    ...(unclosedIndex !== undefined ? { unclosedIndex } : {}),
  }
}

/** The last line of the statement starting at `index`: the line itself unless
 * `statementEnds` names a later one. */
export function statementEndAt(statementEnds: readonly number[] | undefined, index: number, lineCount: number): number {
  const end = statementEnds?.[index] ?? index
  return end > index ? Math.min(end, lineCount - 1) : index
}

/** Apply the common strict-family policy without duplicating parser guards. */
export function requireClosedAccessibility(scan: AccessibilityScan): void {
  if (scan.unclosedIndex !== undefined) throw new Error('Unclosed accDescr block')
}

export interface AccessibilityFieldProjection {
  accessibilityTitle?: string
  accessibilityDescription?: string
}

export interface AccessibilityObjectProjection {
  accessibility?: { title?: string; description?: string }
}

/** Project the normalized universal envelope onto the field shape used by
 * sequence/class/ER/timeline/journey/architecture/mindmap/gitgraph models. */
export function accessibilityFields(
  accessibility: MermaidAccessibility,
): AccessibilityFieldProjection {
  return {
    ...(accessibility.title !== undefined ? { accessibilityTitle: accessibility.title } : {}),
    ...(accessibility.descr !== undefined ? { accessibilityDescription: accessibility.descr } : {}),
  }
}

/** Return a model carrying the normalized universal accessibility fields.
 * The original model is retained when the envelope is empty. */
export function withAccessibilityFields<T extends object>(
  value: T,
  accessibility: MermaidAccessibility,
): T & AccessibilityFieldProjection {
  if (accessibility.title === undefined && accessibility.descr === undefined) {
    return value as T & AccessibilityFieldProjection
  }
  return { ...value, ...accessibilityFields(accessibility) }
}

/** Project the normalized universal envelope onto the object shape used by
 * XYChart and Quadrant renderer models, field by field: a field the envelope
 * lacks keeps the model's own value (XYChart reads one written mid-line). */
export function withAccessibilityObject<T extends AccessibilityObjectProjection>(
  value: T,
  accessibility: MermaidAccessibility,
): T & AccessibilityObjectProjection {
  if (accessibility.title === undefined && accessibility.descr === undefined) {
    return value as T & AccessibilityObjectProjection
  }
  return {
    ...value,
    accessibility: {
      ...value.accessibility,
      ...(accessibility.title !== undefined ? { title: accessibility.title } : {}),
      ...(accessibility.descr !== undefined ? { description: accessibility.descr } : {}),
    },
  }
}

/** Native metadata for families without an external accessibility production.
 * JSON transports an authored grammar field; shielding global preprocessors
 * keeps decoding at the same field boundary as ordinary accessibility text. */
export function appendNativeAccessibilityLines(lines: string[], value: AccessibilityFieldProjection): void {
  for (const [name, text] of [['accTitle', value.accessibilityTitle], ['accDescr', value.accessibilityDescription]] as const) {
    if (text === undefined) continue
    const field = nativeAccessibilityJSON(writeGrammarText(text, ':;,%{}'))
    lines.push(`  %% agentic-mermaid ${name}: ${field}`)
  }
}

function nativeAccessibilityJSON(text: string): string {
  return JSON.stringify(text).replace(/[&<>#%\u2028\u2029]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`)
}

/** Classify native fields before any source-global cleanup or directives.
 * A native-looking line inside a family statement is still that family's text.
 * Replacements retain exact source provenance through the cleanup receipt. */
export function nativeAccessibilityTransportEdits(text: string, statementEnds?: readonly number[]): Array<{ start: number; end: number; text: string }> {
  return classifyNativeAccessibilityRegions(text, statementEnds).native.map(region => {
    const line = text.slice(region.start, region.end)
    const start = region.start + line.indexOf('"')
    return { start, end: region.start + line.trimEnd().length, text: nativeAccessibilityJSON(region.directive.value) }
  }).filter(edit => edit.text !== text.slice(edit.start, edit.end))
}

interface EnvelopeRegion { start: number; end: number }
interface NativeAccessibilityRegion extends EnvelopeRegion { directive: ParsedAccessibilityDirective }

/** Source-ordered ownership: an outer config directive owns scalar lookalikes;
 * an outer native JSON field owns directive-looking text in its string. */
export function classifyNativeAccessibilityRegions(text: string, statementEnds?: readonly number[]): { native: NativeAccessibilityRegion[]; directives: EnvelopeRegion[] } {
  const { openers, closings } = directiveDelimiters(text)
  const directives: EnvelopeRegion[] = [], native: NativeAccessibilityRegion[] = []
  const lines = text.split(/\r\n?|\n/)
  let offset = 0, next = 0, closing = 0, configEnd = 0, nativeBlockedThrough = -1
  const discoverBefore = (end: number): void => {
    while (next < openers.length && openers[next]! < end) {
      const start = openers[next++]!
      if (start < configEnd) continue
      while (closing < closings.length && closings[closing]!.start < start) closing++
      if (closing === closings.length) continue
      configEnd = closings[closing]!.end
      directives.push({ start, end: configEnd })
    }
  }
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!
    discoverBefore(offset)
    if (configEnd <= offset && index > nativeBlockedThrough) {
      const directive = parseAccessibilityDirective(lines, index)
      if (directive?.form === 'native') {
        const end = offset + line.length
        native.push({ start: offset, end, directive })
        // Discover openers independently: an unclosed literal opener in this
        // field must not swallow a real directive beginning on a later row.
        while (next < openers.length && openers[next]! < end) next++
      } else nativeBlockedThrough = directive === undefined ? lines.length
        : Math.max(statementEndAt(statementEnds, index, lines.length), directive?.endIndex ?? index)
    }
    offset += line.length
    if (text[offset] === '\r') offset++
    if (text[offset] === '\n') offset++
  }
  discoverBefore(Infinity)
  return { native, directives }
}

/** All opener candidates are independent, including candidates nested inside a
 * later-rejected match. Delimiter cursors advance once, keeping work linear. */
function directiveDelimiters(text: string): { openers: number[]; closings: EnvelopeRegion[] } {
  const openers = [...text.matchAll(/%%\{\s*\w+/g)].map(match => match.index)
  // Match the generous reader's close too. Config owns these bytes even when
  // verify diagnoses the separated delimiter as outside the pinned grammar.
  const closings = [...text.matchAll(/\}\s*%%/g)].map(match => ({ start: match.index, end: match.index + match[0].length }))
  return { openers, closings }
}

/** Config text is not family quote syntax. Used only to discover the family's
 * statement boundaries before classifying native metadata ownership. */
export function maskMermaidConfigForGrammar(text: string): string {
  const { openers, closings } = directiveDelimiters(text), chars = text.split('')
  let closing = 0, end = 0
  for (const start of openers) {
    if (start < end) continue
    while (closing < closings.length && closings[closing]!.start < start) closing++
    if (closing === closings.length) break
    end = closings[closing]!.end
    for (let index = start; index < end; index++) if (chars[index] !== '\r' && chars[index] !== '\n') chars[index] = ' '
  }
  return chars.join('')
}
