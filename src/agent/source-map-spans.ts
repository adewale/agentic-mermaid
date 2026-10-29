import { coalesceFlowchartLines, type FlowchartScan, type FlowchartTextRange, flowchartTextArrowLabelRanges, scanFlowchart } from '../flowchart-lexer.ts'
import { INIT_DIRECTIVE_REGEX, MERMAID_DIRECTIVE_REGEX, splitHeaderStatement } from '../mermaid-source-wrapper.ts'
import type { PreservedSourceSpans, SourceLocation, SourceMap, SourceMapSpans, SourceSpan } from './types.ts'
import type { MermaidCleanup } from '../shared/mermaid-cleanup.ts'
import { sourceLineStarts, sourcePointAt, sourceSpan } from '../family-detection.ts'

interface PhysicalLine {
  text: string
  start: number
}

const authoredLinesBySourceMap = new WeakMap<SourceMap, ReadonlyMap<number, { line: number; text: string }>>()
const cleanupBySourceMap = new WeakMap<SourceMap, MermaidCleanup>()

export function recordSourceCleanup(sourceMap: SourceMap, cleanup: MermaidCleanup): void {
  cleanupBySourceMap.set(sourceMap, cleanup)
}

export function sourceCleanup(sourceMap: SourceMap): MermaidCleanup | undefined {
  return cleanupBySourceMap.get(sourceMap)
}

/** Where statements end, for a family that knows: keyed like the location
 * maps, in canonical coordinates, just after the last character. Such an
 * entry's span runs from its location to its end, in place of the bounds
 * read from its line. */
export interface SourceMapEnds {
  nodes?: Map<string, SourceLocation>
  edges?: Map<string, SourceLocation>
  groups?: Map<string, SourceLocation>
  labels?: Map<string, SourceLocation>
}

const sourceMapEnds = new WeakMap<SourceMap, SourceMapEnds>()

export function recordSourceMapEnds(sourceMap: SourceMap, ends: SourceMapEnds): void {
  sourceMapEnds.set(sourceMap, ends)
}

type AuthoredSourceMapSpans = Partial<Pick<SourceMapSpans, 'nodes' | 'edges' | 'groups' | 'labels' | 'metadata'>>
const authoredSourceMapSpans = new WeakMap<SourceMap, AuthoredSourceMapSpans>()

/** Native parsers may retain exact authored spans through their preparation
 * receipt instead of recovering them from canonical, trimmed lines. */
export function recordAuthoredSourceMapSpans(sourceMap: SourceMap, spans: AuthoredSourceMapSpans): void {
  authoredSourceMapSpans.set(sourceMap, spans)
}

/** Internal provenance for diagnostics; keep the public SourceMap shape stable. */
export function authoredLineForCanonical(sourceMap: SourceMap, canonicalLine: number): number {
  return authoredLinesBySourceMap.get(sourceMap)?.get(canonicalLine)?.line ?? canonicalLine
}

/** The authored text of a canonical line, as the parse read it, which
 *  canonical lines may not keep (trailing blanks); undefined where the
 *  diagram was not parsed from source. */
export function authoredTextForCanonical(sourceMap: SourceMap, canonicalLine: number): string | undefined {
  return authoredLinesBySourceMap.get(sourceMap)?.get(canonicalLine)?.text
}

function physicalLines(source: string): PhysicalLine[] {
  const lines: PhysicalLine[] = []
  let start = 0
  for (let index = 0; index <= source.length; index++) {
    if (index !== source.length && source.charCodeAt(index) !== 10 && source.charCodeAt(index) !== 13) continue
    lines.push({ text: source.slice(start, index), start })
    if (source.charCodeAt(index) === 13 && source.charCodeAt(index + 1) === 10) index++
    start = index + 1
  }
  return lines
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
  // A statement written on the header line is read as a line of its own;
  // match it where it stands on that line.
  const header = authored[cursor]
  const split = header && splitHeaderStatement(header.text).split('\n')
  if (header && split?.length === 2) {
    authored.splice(cursor, 1, { text: split[0]!, start: header.start }, { text: split[1]!, start: header.start + header.text.indexOf(split[1]!, split[0]!.length) })
  }
  for (let index = 0; index < canonical.length; index++) {
    const wanted = canonical[index]!.text.trim()
    if (!wanted) continue
    let found = -1
    for (let authoredIndex = cursor; authoredIndex < authored.length; authoredIndex++) {
      // Normalization removes a directive inside a statement.
      const text = authored[authoredIndex]!.text
      if (text.trim() === wanted || (text.includes('%%{') && text.replace(new RegExp(INIT_DIRECTIVE_REGEX.source, 'g'), '').replace(MERMAID_DIRECTIVE_REGEX, '').trim() === wanted)) {
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
  /** Where the quoted text starting at `start` ends, or undefined when no
   * quote opens right before `start`. */
  readonly quoteEnd: (start: number, limit: number) => number | undefined
}

/** Which lexer reads a family's authored lines. Flowchart lines are read by
 * the flowchart lexer (flowchart-lexer.ts), which the parser uses too; other
 * families keep the generic line scanner below. */
export type SourceSpanGrammar = 'flowchart' | 'generic'

interface EnclosingDelimiterIndex {
  readonly openerAt: Int32Array
  readonly closerAt: Int32Array
}

/** The generic line rule for the families without their own lexer: `"`,
 * `'` or a backtick opens a string that the same character closes, and `\`
 * escapes the next character inside it. Marks every character from an
 * opening quote through its closing quote. */
function genericQuotedMask(line: string): Uint8Array {
  const quoted = new Uint8Array(line.length)
  let quote: string | undefined
  let escaped = false
  for (let index = 0; index < line.length; index++) {
    const char = line[index]!
    if (quote) {
      quoted[index] = 1
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === quote) quote = undefined
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quoted[index] = 1
      quote = char
    }
  }
  return quoted
}

/** Index the innermost matched delimiter enclosing every offset in one pass
 * after quote-aware delimiter matching. Label-span lookup can then answer in
 * constant time instead of rescanning a long same-line statement for every
 * shaped node. */
function indexEnclosingDelimiters(line: string, quoted: Uint8Array): EnclosingDelimiterIndex {
  const matchingCloser = new Int32Array(line.length)
  matchingCloser.fill(-1)
  const matchStack: Array<{ opener: string; index: number }> = []
  for (let index = 0; index < line.length; index++) {
    const char = line[index]!
    if (quoted[index]) continue
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
  for (let index = 0; index < line.length; index++) {
    openerAt[index] = nearestMatched?.index ?? -1
    closerAt[index] = nearestMatched?.closer ?? -1
    const char = line[index]!
    if (quoted[index]) continue
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

/** The innermost closed shape text enclosing every offset, from the
 * flowchart lexer's regions: the opener itself is outside, its closer inside. */
function indexFlowchartEnclosingDelimiters(line: string, scan: FlowchartScan): EnclosingDelimiterIndex {
  const openerAt = new Int32Array(line.length + 1)
  const closerAt = new Int32Array(line.length + 1)
  openerAt.fill(-1)
  closerAt.fill(-1)
  // Regions open outermost first, so an inner region overwrites its parent.
  for (const region of scan.regions) {
    if (region.kind !== 'shape' || !region.closed) continue
    openerAt.fill(region.start, region.start + 1, region.end)
    closerAt.fill(region.end - 1, region.start + 1, region.end)
  }
  return { openerAt, closerAt }
}

/** The end of the flowchart string (or markdown string) whose text starts at
 * an offset. */
function flowchartQuoteEnds(scan: FlowchartScan): (start: number, limit: number) => number | undefined {
  const ends = new Map<number, number>()
  for (const region of scan.regions) {
    if (region.kind === 'string' || region.kind === 'markdown') ends.set(region.contentStart, region.contentEnd)
  }
  return (start, limit) => {
    const end = ends.get(start)
    return end === undefined ? undefined : Math.min(end, limit)
  }
}

function genericQuoteEnd(line: string, start: number, limit: number): number | undefined {
  if (start === 0 || (line[start - 1] !== '"' && line[start - 1] !== "'")) return undefined
  return closingQuote(line, start, line[start - 1]!, limit)
}

function indexStatementBounds(line: string, textArrowLabelRanges: readonly FlowchartTextRange[], lexed: { flowchart: FlowchartScan } | { quoted: Uint8Array }): StatementBoundsIndex {
  const flowchart = 'flowchart' in lexed ? lexed.flowchart : undefined
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
  if (flowchart) separators.push(...flowchart.separators.filter(index => index > prefixEnd))
  let textArrowRangeIndex = 0
  const stack: string[] = []
  let pipeLabel = false
  for (let index = 0; 'quoted' in lexed && index < line.length; index++) {
    const char = line[index]!
    if (lexed.quoted[index]) continue
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

/** A canonical location in the authored text: the line (or the lines of a
 * statement read across lines) it lies in, and its offset there. */
interface AuthoredPosition {
  readonly line: PhysicalLine
  readonly at: number
}

function statementSpan(lineStarts: readonly number[], position: AuthoredPosition | undefined, analysis: AuthoredLineAnalysis | undefined): SourceSpan | undefined {
  if (!position || !analysis) return undefined
  const [startInLine, endInLine] = statementBounds(analysis.statementBounds, position.at)
  return sourceSpan(lineStarts, position.line.start + startInLine, position.line.start + endInLine)
}

/** For each canonical line of a flowchart statement the parser reads across
 * lines (coalesceFlowchartLines), the authored text from the statement's
 * first line to its last. */
function flowchartStatementLines(canonicalLines: readonly PhysicalLine[], lines: ReadonlyMap<number, PhysicalLine>, authoredSource: string): Map<number, PhysicalLine> {
  const result = new Map<number, PhysicalLine>()
  for (const group of coalesceFlowchartLines(canonicalLines.map(line => line.text))) {
    if (!group.joined) continue
    const first = lines.get(group.line + 1)
    const last = group.joined.findLast(joined => lines.has(joined.line + 1))
    const final = last && lines.get(last.line + 1)
    if (!first || !final || final.start < first.start) continue
    const statement = { text: authoredSource.slice(first.start, final.start + final.text.length), start: first.start }
    for (const line of [group.line, ...group.joined.map(joined => joined.line)]) result.set(line + 1, statement)
  }
  return result
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
  const quoteEnd = analysis.quoteEnd(start, lineEnd)
  if (quoteEnd !== undefined) return quoteEnd
  if (start > 0 && line[start - 1] === '|') {
    const closing = line.indexOf('|', start)
    if (closing >= 0 && closing <= lineEnd) return closing
  }
  if (/^edge#\d+:/i.test(key)) {
    // A text-arrow label ends where the flowchart lexer closes it; else at
    // the first link that could close one (a dotted one may leave out its
    // leading `-`: `-. x .- y`).
    const label = analysis.textArrowLabelRanges.find(range => range.start === start)
    if (label) return label.end
    const closer = line.slice(start, lineEnd).search(/-{2,}[>ox]|-{3,}|-?\.+-[>ox]?|={2,}[>ox]|={3,}/)
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

function labelSpan(lineStarts: readonly number[], position: AuthoredPosition | undefined, key: string, analysis: AuthoredLineAnalysis | undefined): SourceSpan | undefined {
  if (!position || !analysis) return undefined
  const endInLine = labelEnd(position.line.text, position.at, key, analysis)
  return sourceSpan(lineStarts, position.line.start + position.at, position.line.start + endInLine)
}

function mapStatementSpans(locations: Map<string, SourceLocation>, lineStarts: readonly number[], positionOf: (location: SourceLocation) => AuthoredPosition | undefined, analysisFor: (line: PhysicalLine) => AuthoredLineAnalysis): Map<string, SourceSpan> {
  const result = new Map<string, SourceSpan>()
  for (const [key, location] of locations) {
    const position = positionOf(location)
    const located = statementSpan(lineStarts, position, position ? analysisFor(position.line) : undefined)
    if (located) result.set(key, located)
  }
  return result
}

/** Add exact authored spans without changing the legacy canonical locations. */
export function attachSourceMapSpans(sourceMap: SourceMap, canonicalSource: string, authoredSource: string, preserved: PreservedSourceSpans, grammar: SourceSpanGrammar = 'generic'): SourceMap {
  const lineStarts = sourceLineStarts(authoredSource)
  const lines = authoredLineMap(canonicalSource, authoredSource, preserved)
  const canonicalLines = physicalLines(canonicalSource)
  // A flowchart statement read across lines is analysed across them.
  const statementLines = grammar === 'flowchart' ? flowchartStatementLines(canonicalLines, lines, authoredSource) : new Map<number, PhysicalLine>()
  const positionOf = (location: SourceLocation): AuthoredPosition | undefined => {
    const authoredLine = lines.get(location.line)
    const canonicalLine = canonicalLines[location.line - 1]
    if (!authoredLine || !canonicalLine) return undefined
    const relative = Math.max(0, location.col - 1 - indentationWidth(canonicalLine.text))
    const at = Math.min(authoredLine.text.length, indentationWidth(authoredLine.text) + relative)
    const statement = statementLines.get(location.line)
    return statement ? { line: statement, at: authoredLine.start - statement.start + at } : { line: authoredLine, at }
  }
  const lineAnalysisCache = new Map<PhysicalLine, AuthoredLineAnalysis>()
  const analysisFor = (line: PhysicalLine): AuthoredLineAnalysis => {
    const cached = lineAnalysisCache.get(line)
    if (cached) return cached
    const flowchart = grammar === 'flowchart' ? scanFlowchart(line.text) : undefined
    const textArrowLabelRanges = flowchartTextArrowLabelRanges(line.text, flowchart)
    const quoted = flowchart ? undefined : genericQuotedMask(line.text)
    const analysis: AuthoredLineAnalysis = flowchart
      ? {
          textArrowLabelRanges,
          statementBounds: indexStatementBounds(line.text, textArrowLabelRanges, { flowchart }),
          enclosingDelimiters: indexFlowchartEnclosingDelimiters(line.text, flowchart),
          quoteEnd: flowchartQuoteEnds(flowchart),
        }
      : {
          textArrowLabelRanges,
          statementBounds: indexStatementBounds(line.text, textArrowLabelRanges, { quoted: quoted! }),
          enclosingDelimiters: indexEnclosingDelimiters(line.text, quoted!),
          quoteEnd: (start, limit) => genericQuoteEnd(line.text, start, limit),
        }
    lineAnalysisCache.set(line, analysis)
    return analysis
  }
  const labels = new Map<string, SourceSpan>()
  for (const [key, location] of sourceMap.labels) {
    const position = positionOf(location)
    const located = labelSpan(lineStarts, position, key, position ? analysisFor(position.line) : undefined)
    if (located) labels.set(key, located)
  }
  const ends = sourceMapEnds.get(sourceMap)
  const offsetOf = (location: SourceLocation): number | undefined => {
    const position = positionOf(location)
    return position && position.line.start + position.at
  }
  const withEnds = (located: Map<string, SourceSpan>, locations: Map<string, SourceLocation>, endsOf: Map<string, SourceLocation> | undefined): Map<string, SourceSpan> => {
    for (const [key, end] of endsOf ?? []) {
      const location = locations.get(key)
      const start = location && offsetOf(location)
      const stop = offsetOf(end)
      if (start !== undefined && stop !== undefined && stop >= start) located.set(key, sourceSpan(lineStarts, start, stop))
    }
    return located
  }
  const spans: SourceMapSpans = {
    preserved,
    nodes: withEnds(mapStatementSpans(sourceMap.nodes, lineStarts, positionOf, analysisFor), sourceMap.nodes, ends?.nodes),
    edges: withEnds(mapStatementSpans(sourceMap.edges, lineStarts, positionOf, analysisFor), sourceMap.edges, ends?.edges),
    groups: withEnds(mapStatementSpans(sourceMap.groups, lineStarts, positionOf, analysisFor), sourceMap.groups, ends?.groups),
    labels: withEnds(labels, sourceMap.labels, ends?.labels),
  }
  const authored = authoredSourceMapSpans.get(sourceMap)
  if (authored) {
    const canonicalAt = new Map([...lines].map(([line, authored]) => [authored.start, line]))
    const authoredLines = physicalLines(authoredSource)
    for (const category of ['nodes', 'edges', 'groups', 'labels'] as const) {
      const exact = authored[category]
      if (!exact) continue
      spans[category] = exact
      for (const [key, span] of exact) {
        const row = authoredLines[span.start.line - 1]
        const canonicalLine = row && canonicalAt.get(row.start)
        const canonical = canonicalLine && canonicalLines[canonicalLine - 1]
        const location = sourceMap[category].get(key)
        if (canonical && location) sourceMap[category].set(key, { line: canonicalLine, col: location.col + indentationWidth(canonical.text) })
        else sourceMap[category].delete(key)
      }
    }
    if (authored.metadata) spans.metadata = authored.metadata
  }
  sourceMap.spans = spans
  authoredLinesBySourceMap.set(sourceMap, new Map([...lines].map(([canonicalLine, authoredLine]) => [
    canonicalLine,
    { line: sourcePointAt(lineStarts, authoredLine.start).line, text: authoredLine.text },
  ])))
  return sourceMap
}
