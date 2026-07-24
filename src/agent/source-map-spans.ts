import { type FlowchartTextRange, flowchartTextArrowLabelRanges } from '../flowchart-statement-labels.ts'
import type { PreservedSourceSpans, SourceLocation, SourceMap, SourceMapSpans, SourceSpan, SourceSpanPoint } from './types.ts'

interface PhysicalLine {
  text: string
  start: number
}

function physicalLines(source: string): PhysicalLine[] {
  const lines: PhysicalLine[] = []
  let start = 0
  for (let index = 0; index <= source.length; index++) {
    if (index !== source.length && source.charCodeAt(index) !== 10) continue
    const physicalEnd = index > start && source.charCodeAt(index - 1) === 13 ? index - 1 : index
    lines.push({ text: source.slice(start, physicalEnd), start })
    start = index + 1
  }
  return lines
}

function sourceLineStarts(source: string): readonly number[] {
  const starts = [0]
  for (let index = 0; index < source.length; index++) {
    if (source.charCodeAt(index) === 10) starts.push(index + 1)
  }
  return starts
}

function point(lineStarts: readonly number[], offset: number): SourceSpanPoint {
  let low = 0
  let high = lineStarts.length
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    if (lineStarts[middle]! <= offset) low = middle + 1
    else high = middle
  }
  const lineIndex = Math.max(0, low - 1)
  return Object.freeze({ offset, line: lineIndex + 1, col: offset - lineStarts[lineIndex]! + 1 })
}

function span(lineStarts: readonly number[], start: number, end: number): SourceSpan {
  return Object.freeze({ start: point(lineStarts, start), end: point(lineStarts, end) })
}

/**
 * Match canonical, trimmed grammar lines back to the exact authored physical
 * lines. Sequential matching keeps repeated statements stable.
 */
function authoredLineMap(canonicalSource: string, authoredSource: string, preserved: PreservedSourceSpans): Map<number, PhysicalLine> {
  const canonical = physicalLines(canonicalSource)
  const authored = physicalLines(authoredSource)
  const result = new Map<number, PhysicalLine>()
  // The canonical source starts at the family header. Starting at that exact
  // authored line prevents Mermaid-looking YAML block-scalar content from
  // capturing semantic lines before the real diagram begins.
  let cursor = Math.max(0, preserved.header.start.line - 1)
  for (let index = 0; index < canonical.length; index++) {
    const wanted = canonical[index]!.text.trim()
    if (!wanted) continue
    let found = -1
    for (let authoredIndex = cursor; authoredIndex < authored.length; authoredIndex++) {
      if (authored[authoredIndex]!.text.trim() === wanted) {
        found = authoredIndex
        break
      }
    }
    if (found < 0) continue
    result.set(index + 1, authored[found]!)
    cursor = found + 1
  }
  return result
}

function indentationWidth(line: string): number {
  return line.length - line.trimStart().length
}

interface StatementBoundsIndex {
  readonly header?: readonly [number, number]
  readonly headerThrough: number
  readonly segments: ReadonlyArray<{
    readonly through: number
    readonly bounds: readonly [number, number]
  }>
  readonly fallback: readonly [number, number]
}

interface AuthoredLineAnalysis {
  readonly textArrowLabelRanges: readonly FlowchartTextRange[]
  readonly statementBounds: StatementBoundsIndex
  readonly enclosingDelimiters: EnclosingDelimiterIndex
}

interface EnclosingDelimiterIndex {
  readonly openerAt: Int32Array
  readonly closerAt: Int32Array
}

/** Index the innermost matched delimiter enclosing every offset in one pass
 * after quote-aware delimiter matching. Label-span lookup can then answer in
 * constant time instead of rescanning a long same-line statement for every
 * shaped node. */
function indexEnclosingDelimiters(line: string): EnclosingDelimiterIndex {
  const matchingCloser = new Int32Array(line.length)
  matchingCloser.fill(-1)
  const matchStack: Array<{ opener: string; index: number }> = []
  let quote: string | undefined
  let escaped = false
  for (let index = 0; index < line.length; index++) {
    const char = line[index]!
    if (quote) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === quote) quote = undefined
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char
      continue
    }
    if (char === '[' || char === '(' || char === '{') {
      matchStack.push({ opener: char, index })
      continue
    }
    if (char !== ']' && char !== ')' && char !== '}') continue
    const frame = matchStack.pop()
    const expected = frame?.opener === '[' ? ']' : frame?.opener === '(' ? ')' : frame ? '}' : undefined
    if (frame && char === expected) matchingCloser[frame.index] = index
  }

  interface DelimiterFrame {
    readonly opener: string
    readonly index: number
    readonly closer: number
    readonly previousMatched?: DelimiterFrame
  }
  const openerAt = new Int32Array(line.length + 1)
  const closerAt = new Int32Array(line.length + 1)
  openerAt.fill(-1)
  closerAt.fill(-1)
  const stack: DelimiterFrame[] = []
  let nearestMatched: DelimiterFrame | undefined
  quote = undefined
  escaped = false
  for (let index = 0; index < line.length; index++) {
    openerAt[index] = nearestMatched?.index ?? -1
    closerAt[index] = nearestMatched?.closer ?? -1
    const char = line[index]!
    if (quote) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === quote) quote = undefined
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char
      continue
    }
    if (char === '[' || char === '(' || char === '{') {
      const closer = matchingCloser[index]!
      const frame = { opener: char, index, closer, previousMatched: nearestMatched }
      stack.push(frame)
      if (closer >= 0) nearestMatched = frame
      continue
    }
    if (char !== ']' && char !== ')' && char !== '}') continue
    const frame = stack.pop()
    if (frame && nearestMatched === frame) nearestMatched = frame.previousMatched
  }
  openerAt[line.length] = nearestMatched?.index ?? -1
  closerAt[line.length] = nearestMatched?.closer ?? -1
  return { openerAt, closerAt }
}

function indexStatementBounds(line: string, textArrowLabelRanges: readonly FlowchartTextRange[]): StatementBoundsIndex {
  let prefixEnd = -1
  let inlineNamespace = false
  const inlineAccessibility = line.match(/^\s*accDescr\s*:?\s*\{/i)
  if (inlineAccessibility) {
    prefixEnd = line.indexOf('}', inlineAccessibility[0].length)
  } else if (/^\s*namespace\s+[^{};]+\s*\{/.test(line)) {
    prefixEnd = line.indexOf('{')
    inlineNamespace = true
  } else if (/^\s*\}/.test(line)) {
    // A block suffix begins after the first non-whitespace closing brace.
    // Later braces may belong to shaped nodes such as `A{Decision}`.
    prefixEnd = line.indexOf('}')
  }
  const separators: number[] = [prefixEnd]
  let textArrowRangeIndex = 0
  const stack: string[] = []
  let quote: string | undefined
  let pipeLabel = false
  let escaped = false
  for (let index = 0; index < line.length; index++) {
    const char = line[index]!
    if (quote) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === quote) quote = undefined
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char
      continue
    }
    if (char === '|' && stack.length === 0) {
      pipeLabel = !pipeLabel
      continue
    }
    if (char === '[' || char === '(' || char === '{') {
      stack.push(char)
      continue
    }
    if (char === ']' || char === ')' || char === '}') {
      if (inlineNamespace && char === '}' && stack.length === 1 && stack[0] === '{' && index > prefixEnd) {
        separators.push(index)
      }
      stack.pop()
      continue
    }
    const statementDepth = inlineNamespace && stack.length === 1 && stack[0] === '{'
    if (char === ';' && (stack.length === 0 || statementDepth) && !pipeLabel && index > prefixEnd) {
      while (textArrowLabelRanges[textArrowRangeIndex] && textArrowLabelRanges[textArrowRangeIndex]!.end <= index) textArrowRangeIndex++
      const range = textArrowLabelRanges[textArrowRangeIndex]
      if (!range || index < range.start || index >= range.end) separators.push(index)
    }
  }
  separators.push(line.length)
  const segments: Array<{ through: number; bounds: readonly [number, number] }> = []
  for (let index = 0; index < separators.length - 1; index++) {
    const rawStart = separators[index]! + 1
    const rawEnd = separators[index + 1]!
    const start = rawStart + indentationWidth(line.slice(rawStart, rawEnd))
    const end = line.slice(0, rawEnd).trimEnd().length
    segments.push({ through: rawEnd, bounds: [Math.min(start, end), Math.max(start, end)] })
  }
  return {
    ...(inlineNamespace ? { header: [indentationWidth(line), prefixEnd + 1] as const } : {}),
    headerThrough: prefixEnd,
    segments,
    fallback: [indentationWidth(line), line.trimEnd().length],
  }
}

function statementBounds(index: StatementBoundsIndex, at: number): readonly [number, number] {
  if (index.header && at <= index.headerThrough) return index.header
  let low = 0
  let high = index.segments.length
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    if (at <= index.segments[middle]!.through) high = middle
    else low = middle + 1
  }
  return index.segments[low]?.bounds ?? index.fallback
}

function statementSpan(lineStarts: readonly number[], authoredLine: PhysicalLine | undefined, canonicalLine: PhysicalLine | undefined, location: SourceLocation, analysis: AuthoredLineAnalysis | undefined): SourceSpan | undefined {
  if (!authoredLine || !canonicalLine || !analysis) return undefined
  const relative = Math.max(0, location.col - 1 - indentationWidth(canonicalLine.text))
  const authoredAt = Math.min(authoredLine.text.length, indentationWidth(authoredLine.text) + relative)
  const [startInLine, endInLine] = statementBounds(analysis.statementBounds, authoredAt)
  return span(lineStarts, authoredLine.start + startInLine, authoredLine.start + endInLine)
}

function firstIndexAfter(line: string, start: number, candidates: readonly string[]): number {
  let end = line.length
  for (const candidate of candidates) {
    const index = line.indexOf(candidate, start)
    if (index >= start && index < end) end = index
  }
  return end
}

function closingQuote(line: string, start: number, quote: string, limit: number): number {
  let escaped = false
  for (let index = start; index < limit; index++) {
    const char = line[index]!
    if (escaped) escaped = false
    else if (char === '\\') escaped = true
    else if (char === quote) return index
  }
  return limit
}

function enclosingCloser(index: EnclosingDelimiterIndex, segmentStart: number, start: number, limit: number): number | undefined {
  const offset = Math.min(start, index.closerAt.length - 1)
  const opener = index.openerAt[offset]!
  const closer = index.closerAt[offset]!
  return opener >= segmentStart && closer >= start && closer <= limit ? closer : undefined
}

function labelEnd(line: string, start: number, key: string, analysis: AuthoredLineAnalysis): number {
  const [segmentStart, segmentEnd] = statementBounds(analysis.statementBounds, start)
  const lineEnd = Math.min(line.trimEnd().length, segmentEnd)
  if (/Cardinality$/i.test(key)) {
    if (start > 0 && (line[start - 1] === '"' || line[start - 1] === "'")) {
      return closingQuote(line, start, line[start - 1]!, lineEnd)
    }
    return Math.min(lineEnd, start + 2)
  }
  if (/:(?:member|attr)#\d+$/i.test(key)) return lineEnd
  if (/^gantt:task:/i.test(key)) {
    const colon = firstIndexAfter(line, start, [':'])
    return line.slice(0, colon).trimEnd().length
  }
  if (/^xychart:.*:point#\d+$/i.test(key)) {
    const token = line.slice(start).match(/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)/)?.[0]
    if (token) return start + token.length
  }
  if (/^quadrant:point#\d+$/i.test(key)) {
    const pointEnd = line.slice(start, lineEnd).search(/\s*:\s*\[/)
    if (pointEnd >= 0) {
      const classSuffix = line.indexOf(':::', start)
      return classSuffix >= start && classSuffix < start + pointEnd ? line.slice(0, classSuffix).trimEnd().length : start + pointEnd
    }
  }
  if (/^radar:(?:axis|curve)#\d+$/i.test(key)) {
    const token = line.slice(start).match(/^[\w](?:[\w-]*[\w])?/)?.[0]
    if (token) return start + token.length
  }
  if (/^sankey:link#\d+$/i.test(key)) {
    // The span is the whole CSV row (the row IS the link).
    return lineEnd
  }

  // Most quoted Mermaid labels are mapped to the first character inside the
  // quotes. Preserve the content, not its syntax delimiters.
  if (start > 0 && (line[start - 1] === '"' || line[start - 1] === "'")) {
    const quote = line[start - 1]!
    return closingQuote(line, start, quote, lineEnd)
  }
  if (start > 0 && line[start - 1] === '|') {
    const closing = line.indexOf('|', start)
    if (closing >= 0 && closing <= lineEnd) return closing
  }
  if (/^edge#\d+:/i.test(key)) {
    const closer = line.slice(start, lineEnd).search(/-{2,}[>ox]|-{3,}|\.+->|-\.+-|={2,}>|={3,}/)
    if (closer >= 0) return line.slice(0, start + closer).trimEnd().length
  }
  const closer = enclosingCloser(analysis.enclosingDelimiters, segmentStart, start, lineEnd)
  if (closer !== undefined) return closer

  const candidates = [']', '}', ')', '|', '"', "'", '[']
  let end = firstIndexAfter(line, start, candidates)
  const arrow = line.slice(start).search(/\s+(?=(?:<?[-.=~]+|[-.=~]+[>ox]))/)
  if (arrow >= 0) end = Math.min(end, start + arrow)
  if (/:name$/i.test(key)) {
    const valueList = line.indexOf('[', start)
    if (valueList >= 0) end = Math.min(end, valueList)
  }
  return Math.max(start, Math.min(lineEnd, line.slice(0, end).trimEnd().length))
}

function labelSpan(lineStarts: readonly number[], lines: Map<number, PhysicalLine>, canonicalLines: readonly PhysicalLine[], location: SourceLocation, key: string, analysis: AuthoredLineAnalysis | undefined): SourceSpan | undefined {
  const authoredLine = lines.get(location.line)
  const canonicalLine = canonicalLines[location.line - 1]
  if (!authoredLine || !canonicalLine || !analysis) return undefined
  const canonicalIndent = indentationWidth(canonicalLine.text)
  const authoredIndent = indentationWidth(authoredLine.text)
  const relativeStart = Math.max(0, location.col - 1 - canonicalIndent)
  const startInLine = Math.min(authoredLine.text.length, authoredIndent + relativeStart)
  const endInLine = labelEnd(authoredLine.text, startInLine, key, analysis)
  return span(lineStarts, authoredLine.start + startInLine, authoredLine.start + endInLine)
}

function mapStatementSpans(locations: Map<string, SourceLocation>, lineStarts: readonly number[], lines: Map<number, PhysicalLine>, canonicalLines: readonly PhysicalLine[], analysisFor: (line: PhysicalLine) => AuthoredLineAnalysis): Map<string, SourceSpan> {
  const result = new Map<string, SourceSpan>()
  for (const [key, location] of locations) {
    const authoredLine = lines.get(location.line)
    const located = statementSpan(lineStarts, authoredLine, canonicalLines[location.line - 1], location, authoredLine ? analysisFor(authoredLine) : undefined)
    if (located) result.set(key, located)
  }
  return result
}

/** Add exact authored spans without changing the legacy canonical locations. */
export function attachSourceMapSpans(sourceMap: SourceMap, canonicalSource: string, authoredSource: string, preserved: PreservedSourceSpans): SourceMap {
  const lineStarts = sourceLineStarts(authoredSource)
  const lines = authoredLineMap(canonicalSource, authoredSource, preserved)
  const canonicalLines = physicalLines(canonicalSource)
  const lineAnalysisCache = new Map<number, AuthoredLineAnalysis>()
  const analysisFor = (line: PhysicalLine): AuthoredLineAnalysis => {
    const cached = lineAnalysisCache.get(line.start)
    if (cached) return cached
    const textArrowLabelRanges = flowchartTextArrowLabelRanges(line.text)
    const analysis = {
      textArrowLabelRanges,
      statementBounds: indexStatementBounds(line.text, textArrowLabelRanges),
      enclosingDelimiters: indexEnclosingDelimiters(line.text),
    }
    lineAnalysisCache.set(line.start, analysis)
    return analysis
  }
  const labels = new Map<string, SourceSpan>()
  for (const [key, location] of sourceMap.labels) {
    const authoredLine = lines.get(location.line)
    const located = labelSpan(lineStarts, lines, canonicalLines, location, key, authoredLine ? analysisFor(authoredLine) : undefined)
    if (located) labels.set(key, located)
  }
  const spans: SourceMapSpans = {
    preserved,
    nodes: mapStatementSpans(sourceMap.nodes, lineStarts, lines, canonicalLines, analysisFor),
    edges: mapStatementSpans(sourceMap.edges, lineStarts, lines, canonicalLines, analysisFor),
    groups: mapStatementSpans(sourceMap.groups, lineStarts, lines, canonicalLines, analysisFor),
    labels,
  }
  sourceMap.spans = spans
  return sourceMap
}
