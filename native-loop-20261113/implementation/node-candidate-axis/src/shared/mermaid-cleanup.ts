import { decodeXML } from 'entities'
import { mermaidEntityPrepass } from './mermaid-entities.ts'

export type MermaidCleanupView = 'text' | 'payloadText' | 'authoredPayloadText' | 'lineText' | 'upstreamText' | 'prepassedText'
export type MermaidCleanupReason = 'line-ending' | 'xml-entity' | 'html-attribute-quotes' | 'style-semicolon' | 'native-accessibility'
export type MermaidCleanupBias = 'start' | 'end'

/** Locate a physical terminator while a source-preserving grammar scans the
 * authored view. CRLF and lone CR have the same boundary as normalized LF. */
export function mermaidLineEnd(source: string, start: number): number {
  const ending = /[\r\n]/g
  ending.lastIndex = start
  return ending.exec(source)?.index ?? -1
}

/** Offsets are UTF-16 boundaries, matching String.slice and public source spans. */
export interface MermaidCleanupEdit {
  readonly originalStart: number
  readonly originalEnd: number
  readonly cleanedStart: number
  readonly cleanedEnd: number
}

/** One sparse transformation. Coordinates refer to this pass's input/output. */
export interface MermaidCleanupMapping {
  readonly edits: readonly MermaidCleanupEdit[]
}

export interface MermaidCleanupChange extends MermaidCleanupEdit {
  readonly reason: MermaidCleanupReason
  readonly view: MermaidCleanupView
  readonly line: number
  readonly col: number
}

/** Immutable data only: safe to retain in normalized sources and request snapshots. */
export interface MermaidCleanup {
  readonly originalText: string
  /** Generous rendering convention: XML decode once and normalize line endings. */
  readonly text: string
  /** CRLF normalized, lone CR retained for grammar-owned payload identities. */
  readonly payloadText: string
  /** The same payload-aware line endings without transport XML decoding. */
  readonly authoredPayloadText: string
  /** Authored grammar spelling with CRLF and lone CR normalized. */
  readonly lineText: string
  /** Mermaid's cleanupText result: normalized line endings and tag quotes.
   * The generous grammar preserves authored quotes instead. */
  readonly upstreamText: string
  /** Authored spelling after line endings and the style/classDef semicolon pass. */
  readonly prepassedText: string
  readonly changes: readonly MermaidCleanupChange[]
  readonly mappings: readonly MermaidCleanupMapping[]
  readonly lineMappings: readonly MermaidCleanupMapping[]
  readonly upstreamMappings: readonly MermaidCleanupMapping[]
  readonly prepassedMappings: readonly MermaidCleanupMapping[]
}

interface Replacement { start: number; end: number; text: string }
interface PendingChange { reason: MermaidCleanupReason; stage: number; edit: MermaidCleanupEdit }
interface MappedText { text: string; mappings: readonly MermaidCleanupMapping[]; changes: readonly PendingChange[] }

const NO_MAPPINGS: readonly MermaidCleanupMapping[] = Object.freeze([])
const NO_CHANGES: readonly MermaidCleanupChange[] = Object.freeze([])
const NO_PENDING_CHANGES: readonly PendingChange[] = Object.freeze([])

function identityCleanup(originalText: string): MermaidCleanup {
  return Object.freeze({ originalText, text: originalText, payloadText: originalText, authoredPayloadText: originalText, lineText: originalText, upstreamText: originalText, prepassedText: originalText,
    changes: NO_CHANGES, mappings: NO_MAPPINGS, lineMappings: NO_MAPPINGS,
    upstreamMappings: NO_MAPPINGS, prepassedMappings: NO_MAPPINGS })
}

function transform(value: MappedText, replacements: readonly Replacement[], reason: MermaidCleanupReason): MappedText {
  if (replacements.length === 0) return value
  const parts: string[] = []
  const edits: MermaidCleanupEdit[] = []
  let cursor = 0
  let delta = 0
  for (const replacement of replacements) {
    parts.push(value.text.slice(cursor, replacement.start), replacement.text)
    const cleanedStart = replacement.start + delta
    edits.push(Object.freeze({ originalStart: replacement.start, originalEnd: replacement.end,
      cleanedStart, cleanedEnd: cleanedStart + replacement.text.length }))
    delta += replacement.text.length - (replacement.end - replacement.start)
    cursor = replacement.end
  }
  parts.push(value.text.slice(cursor))
  const stage = value.mappings.length
  return { text: parts.join(''), mappings: [...value.mappings, Object.freeze({ edits: Object.freeze(edits) })],
    changes: [...value.changes, ...edits.map(edit => ({ reason, stage, edit }))] }
}

function matchedReplacements(text: string, expression: RegExp, replacement: (token: string) => string): Replacement[] {
  const result: Replacement[] = []
  for (const match of text.matchAll(expression)) {
    const next = replacement(match[0])
    if (next !== match[0]) result.push({ start: match.index, end: match.index + match[0].length, text: next })
  }
  return result
}

function normalizeLineEndings(value: MappedText): MappedText {
  return value.text.includes('\r')
    ? transform(value, matchedReplacements(value.text, /\r\n?/g, () => '\n'), 'line-ending') : value
}

function quoteCleanup(value: MappedText): MappedText {
  const lastClose = value.text.includes('<') ? value.text.lastIndexOf('>') : -1
  if (lastClose < 0) return value
  const replacements: Replacement[] = []
  // Restricting to the final '>' avoids quadratic failed tag scans on long
  // runs of '<word' without a closing bracket.
  for (const tag of value.text.slice(0, lastClose + 1).matchAll(/<(\w+)([^>]*)>/g)) {
    const attributesStart = tag.index + 1 + tag[1]!.length
    for (const attribute of tag[2]!.matchAll(/="([^"]*)"/g)) {
      const start = attributesStart + attribute.index + 1
      // Map each quote separately, preserving exact intervening label spans.
      replacements.push({ start, end: start + 1, text: "'" },
        { start: start + attribute[0].length - 2, end: start + attribute[0].length - 1, text: "'" })
    }
  }
  return transform(value, replacements, 'html-attribute-quotes')
}

function semicolonCleanup(value: MappedText): MappedText {
  if (!value.text.includes(';') || (!value.text.includes('style') && !value.text.includes('classDef'))) return value
  const replacements: Replacement[] = []
  for (const segment of value.text.matchAll(/[^\r\n\u2028\u2029]+/g)) {
    if (!segment[0].includes(';') || (!segment[0].includes('style') && !segment[0].includes('classDef'))) continue
    const cleaned = mermaidEntityPrepass(segment[0])
    // Each keyword removes the current last semicolon, at most twice.
    let before = segment[0].length
    const removedSemicolons: Replacement[] = []
    for (let removed = segment[0].length - cleaned.length; removed > 0; removed--) {
      const index = segment[0].lastIndexOf(';', before - 1)
      removedSemicolons.push({ start: segment.index + index, end: segment.index + index + 1, text: '' })
      before = index
    }
    replacements.push(...removedSemicolons.reverse())
  }
  const merged: Replacement[] = []
  for (const replacement of replacements) {
    const previous = merged.at(-1)
    if (previous && previous.end === replacement.start) previous.end = replacement.end
    else merged.push(replacement)
  }
  return transform(value, merged, 'style-semicolon')
}

/** Map across one pass. Exact boundaries stay exact; a boundary inside a
 * replacement selects its start or end. Deletions use the same explicit bias. */
function mapOffset(mapping: MermaidCleanupMapping, offset: number, bias: MermaidCleanupBias, forward = false): number {
  const edits = mapping.edits
  let low = 0
  let high = edits.length
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    const start = forward ? edits[middle]!.originalStart : edits[middle]!.cleanedStart
    if (start <= offset) low = middle + 1
    else high = middle
  }
  if (low === 0) return offset
  const edit = edits[low - 1]!
  const start = forward ? edit.originalStart : edit.cleanedStart
  const end = forward ? edit.originalEnd : edit.cleanedEnd
  const targetStart = forward ? edit.cleanedStart : edit.originalStart
  const targetEnd = forward ? edit.cleanedEnd : edit.originalEnd
  if (offset > end) return offset + targetEnd - end
  if (offset === start && start !== end) return targetStart
  if (offset === end && start !== end) return targetEnd
  return bias === 'start' ? targetStart : targetEnd
}

function backwards(mappings: readonly MermaidCleanupMapping[], offset: number, bias: MermaidCleanupBias, through = mappings.length): number {
  for (let index = through - 1; index >= 0; index--) offset = mapOffset(mappings[index]!, offset, bias)
  return offset
}

function mappingsFor(receipt: MermaidCleanup, view: MermaidCleanupView): readonly MermaidCleanupMapping[] {
  // Lone-CR replacement is length preserving, so payload views share the
  // exact boundary mappings of their fully normalized counterparts.
  return view === 'text' || view === 'payloadText' ? receipt.mappings : view === 'lineText' || view === 'authoredPayloadText' ? receipt.lineMappings
    : view === 'upstreamText' ? receipt.upstreamMappings : receipt.prepassedMappings
}

export function originalMermaidOffset(receipt: MermaidCleanup, offset: number, bias: MermaidCleanupBias = 'start', view: MermaidCleanupView = 'text'): number {
  if (!Number.isInteger(offset) || offset < 0 || offset > receipt[view].length) throw new RangeError('Cleanup offset is outside the selected source view')
  return backwards(mappingsFor(receipt, view), offset, bias)
}

/** Translate an authored UTF-16 boundary into the selected cleanup view. */
export function cleanedMermaidOffset(receipt: MermaidCleanup, offset: number, bias: MermaidCleanupBias = 'start', view: MermaidCleanupView = 'text'): number {
  if (!Number.isInteger(offset) || offset < 0 || offset > receipt.originalText.length) throw new RangeError('Cleanup offset is outside the original source')
  for (const mapping of mappingsFor(receipt, view)) offset = mapOffset(mapping, offset, bias, true)
  return offset
}

/** Inclusive provenance: a range boundary at a removed semicolon includes that
 * semicolon. Use originalMermaidOffset with an explicit bias for token bounds. */
export function originalMermaidRange(receipt: MermaidCleanup, start: number, end: number, view: MermaidCleanupView = 'text'): { start: number; end: number } {
  if (end < start) throw new RangeError('Cleanup range ends before it starts')
  return { start: originalMermaidOffset(receipt, start, 'start', view), end: originalMermaidOffset(receipt, end, 'end', view) }
}

export function authoredMermaidSlice(receipt: MermaidCleanup, start: number, end: number, view: MermaidCleanupView = 'text'): string {
  const range = originalMermaidRange(receipt, start, end, view)
  return receipt.originalText.slice(range.start, range.end)
}

function changeRecords(value: MappedText, view: MermaidCleanupView, lineStarts: readonly number[], only?: MermaidCleanupReason): MermaidCleanupChange[] {
  const changes: MermaidCleanupChange[] = []
  for (const { reason, stage, edit } of value.changes) {
    if (only !== undefined && reason !== only) continue
    const originalStart = backwards(value.mappings, edit.originalStart, 'start', stage)
    const originalEnd = backwards(value.mappings, edit.originalEnd, 'end', stage)
    let cleanedStart = edit.cleanedStart
    let cleanedEnd = edit.cleanedEnd
    for (let index = stage + 1; index < value.mappings.length; index++) {
      cleanedStart = mapOffset(value.mappings[index]!, cleanedStart, 'start', true)
      cleanedEnd = mapOffset(value.mappings[index]!, cleanedEnd, 'end', true)
    }
    let low = 0
    let high = lineStarts.length
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2)
      if (lineStarts[middle]! <= originalStart) low = middle + 1
      else high = middle
    }
    const line = Math.max(1, low)
    changes.push(Object.freeze({ reason, view, originalStart, originalEnd, cleanedStart, cleanedEnd,
      line, col: originalStart - lineStarts[line - 1]! + 1 }))
  }
  return changes
}

/** One shared receipt retains both authored provenance and Mermaid's cleanup
 * quirks. It does not eagerly decode #entity; codes into grammar delimiters. */
export function cleanupMermaidSource(originalText: string, nativeFields: readonly Replacement[] = []): MermaidCleanup {
  const hasCarriageReturn = originalText.includes('\r')
  const hasXmlEntity = originalText.includes('&')
  const hasQuotedTag = originalText.includes('<') && originalText.includes('="') && originalText.includes('>')
  const hasStyleSemicolon = originalText.includes(';') && (originalText.includes('style') || originalText.includes('classDef'))
  if (!nativeFields.length && !hasCarriageReturn && !hasXmlEntity && !hasQuotedTag && !hasStyleSemicolon) return identityCleanup(originalText)
  const original: MappedText = { text: originalText, mappings: NO_MAPPINGS, changes: NO_PENDING_CHANGES }
  const initial = transform(original, nativeFields, 'native-accessibility')
  const normalized = normalizeLineEndings(initial)
  const xmlDecoded = hasXmlEntity
    ? transform(initial, matchedReplacements(initial.text, /&(?:#[xX][0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g, decodeXML), 'xml-entity')
    : initial
  const semantic = xmlDecoded === initial ? normalized : normalizeLineEndings(xmlDecoded)
  const prepassed = hasStyleSemicolon ? semicolonCleanup(normalized) : normalized
  const upstream = hasQuotedTag ? quoteCleanup(normalized) : normalized
  if (semantic === original && prepassed === original && upstream === original) return identityCleanup(originalText)
  const lineStarts = [0]
  for (let index = 0; index < originalText.length; index++) {
    if (originalText[index] === '\r') {
      if (originalText[index + 1] === '\n') index++
      lineStarts.push(index + 1)
    } else if (originalText[index] === '\n') lineStarts.push(index + 1)
  }
  // Line endings have one diagnostic record, in the semantic view. Other views
  // retain their mappings without copying the same change record three times.
  const changes = [...changeRecords(semantic, 'text', lineStarts),
    ...changeRecords(prepassed, 'prepassedText', lineStarts, 'style-semicolon'),
    ...changeRecords(upstream, 'upstreamText', lineStarts, 'html-attribute-quotes')]
  return Object.freeze({ originalText, text: semantic.text,
    payloadText: xmlDecoded.text.includes('\r') ? xmlDecoded.text.replace(/\r\n/g, '\n') : xmlDecoded.text,
    authoredPayloadText: hasCarriageReturn ? initial.text.replace(/\r\n/g, '\n') : initial.text,
    lineText: normalized.text, upstreamText: upstream.text, prepassedText: prepassed.text,
    changes: Object.freeze(changes), mappings: Object.freeze(semantic.mappings),
    lineMappings: Object.freeze(normalized.mappings),
    upstreamMappings: Object.freeze(upstream.mappings), prepassedMappings: Object.freeze(prepassed.mappings) })
}
