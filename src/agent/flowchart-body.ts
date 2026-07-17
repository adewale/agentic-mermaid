// ============================================================================
// Flowchart/state structured body: parse / serialize / mutate / source-map
// (FamilyDescriptor hooks — BUILD-3 stage 2, removing the in-tree exception).
//
// Flowchart and state are two DiagramKinds sharing one body kind
// ('flowchart', holding the legacy renderer's MermaidGraph). Both register
// a descriptor built by `flowchartFamilyHooks(headerKind)`, which binds the
// serialized header (`flowchart <dir>` vs `stateDiagram-v2`).
//
// Contract differences from the narrow structured families, kept on purpose:
//   - parse ERRORS on bad syntax instead of falling back to opaque. The
//     legacy parser is broad and has no lossless bail-out mode; silent
//     opaque fallback would convert crisp parse errors on the flagship
//     family into render-time failures.
//   - parse consumes the full canonical source (the legacy parser needs the
//     header) and contributes a SourceMap via the buildSourceMap hook.
// ============================================================================

import { parseMermaid as parseFlowchartLegacy } from '../parser.ts'
import { parseMutableStyleProps } from '../shared/style-props.ts'
import { unknownOpMessage } from './mutation-ops.ts'
import { normalizeV11Shape } from '../flowchart-shapes.ts'
import type { MermaidGraph, MermaidNode, MermaidEdge, MermaidSubgraph, NodeShape, Direction } from '../types.ts'
import type {
  DiagramBody, FlowchartMutationOp, MutationError, ParseError, Result, SourceMap,
} from './types.ts'
import { ok, err } from './types.ts'

export type FlowchartBody = Extract<DiagramBody, { kind: 'flowchart' }>

interface SourceStatementSegment {
  readonly text: string
  readonly start: number
  readonly line: number
  readonly topLevel: boolean[]
  readonly textLabelRanges: TextRange[]
  readonly operatorRanges: ReadonlyArray<{ start: number; end: number }>
  readonly operatorStarts: ReadonlySet<number>
  readonly operatorEnds: ReadonlySet<number>
}

// ---- Parser -----------------------------------------------------------------

export function parseFlowchartBody(canonicalSource: string): Result<FlowchartBody, ParseError[]> {
  try {
    const graph = parseFlowchartLegacy(canonicalSource)
    return ok({ kind: 'flowchart', graph })
  } catch (e) {
    return err([{ code: 'PARSE_FAILED', message: e instanceof Error ? e.message : String(e) }])
  }
}

// ---- SourceMap --------------------------------------------------------------

export function buildFlowchartSourceMap(body: FlowchartBody, canonicalSource: string): SourceMap {
  const map: SourceMap = { nodes: new Map(), edges: new Map(), groups: new Map(), labels: new Map() }
  const lines = canonicalSource.split(/\r?\n/)
  const sourceSegments: SourceStatementSegment[] = lines.flatMap((line, lineIndex) =>
    sourceStatementSegments(line).map(segment => {
      const topLevel = topLevelMask(segment.text)
      const textLabelRanges = bareTextArrowLabelRanges(segment.text, topLevel)
      const operatorRanges = compactOperatorRanges(segment.text, topLevel)
      return {
        ...segment,
        line: lineIndex + 1,
        topLevel,
        textLabelRanges,
        operatorRanges,
        operatorStarts: new Set(operatorRanges.map(range => range.start)),
        operatorEnds: new Set(operatorRanges.map(range => range.end)),
      }
    }))

  const nodeIdTrie = buildNodeIdTrie(body.graph.nodes.keys())
  const nodeSegments = new Map<string, SourceStatementSegment[]>()
  const nodeColumns = new Map<SourceStatementSegment, Map<string, number[]>>()
  for (const segment of sourceSegments) {
    for (const { id, column } of candidateNodeTokens(segment.text, nodeIdTrie)) {
      if (!nodeTokenAt(segment, id, column)) continue
      const columnsById = nodeColumns.get(segment) ?? new Map<string, number[]>()
      const columns = columnsById.get(id) ?? []
      columns.push(column)
      columnsById.set(id, columns)
      nodeColumns.set(segment, columnsById)
      const occurrences = nodeSegments.get(id) ?? []
      if (occurrences.at(-1) !== segment) {
        occurrences.push(segment)
        nodeSegments.set(id, occurrences)
      }
      if (map.nodes.has(id)) continue
      map.nodes.set(id, { line: segment.line, col: segment.start + column + 1 })
      const node = body.graph.nodes.get(id)
      const labelCol = node ? nodeLabelColumn(segment.text, node.label, column + id.length) : -1
      if (labelCol >= 0) map.labels.set(`node:${id}`, { line: segment.line, col: segment.start + labelCol + 1 })
    }
  }

  for (const sg of body.graph.subgraphs) mapSubgraphSource(sg, lines, map)

  const edgeOccurrences = new Map<string, number>()
  const edgeMatches = new Map<string, Array<{
    segment: SourceStatementSegment
    sourceCol: number
    labelCol: number
  }>>()
  body.graph.edges.forEach((edge, index) => {
    const indexedKey = edgeSourceMapKey(index, edge)
    const pairKey = `${edge.source}->${edge.target}`
    const signature = `${edge.source}\u0000${edge.target}\u0000${edge.label ?? ''}`
    let matches = edgeMatches.get(signature)
    if (!matches) {
      const targetSegments = new Set(nodeSegments.get(edge.target) ?? [])
      const candidateSegments = (nodeSegments.get(edge.source) ?? []).filter(segment => targetSegments.has(segment))
      matches = candidateSegments.flatMap(segment => {
        const columnsById = nodeColumns.get(segment)!
        const sourceColumns = columnsById.get(edge.source) ?? []
        const mentions = edgeMentions(
          sourceColumns,
          edge.source === edge.target ? sourceColumns : (columnsById.get(edge.target) ?? []),
          edge.source.length,
          segment.operatorRanges,
        )
        return mentions.flatMap(mention => {
          const sourceEnd = mention.sourceCol + edge.source.length
          const labelRanges = edgeIntervalLabelRanges(
            segment.text,
            segment.topLevel,
            segment.textLabelRanges,
            sourceEnd,
            mention.targetCol,
          )
          if (!edge.label) return labelRanges.length > 0 ? [] : [{ segment, sourceCol: mention.sourceCol, labelCol: -1 }]
          const labelCol = labelColumnInRanges(segment.text, edge.label, labelRanges)
          return labelCol >= 0 ? [{ segment, sourceCol: mention.sourceCol, labelCol }] : []
        })
      })
      edgeMatches.set(signature, matches)
    }
    const occurrence = edgeOccurrences.get(signature) ?? 0
    edgeOccurrences.set(signature, occurrence + 1)
    const match = matches[Math.min(occurrence, Math.max(0, matches.length - 1))]
    if (match) {
      const { segment, sourceCol: relativeCol, labelCol } = match
      const loc = { line: segment.line, col: segment.start + relativeCol + 1 }
      map.edges.set(indexedKey, loc)
      if (!map.edges.has(pairKey)) map.edges.set(pairKey, loc)
      if (edge.label && labelCol >= 0) {
        map.labels.set(indexedKey, { line: segment.line, col: segment.start + labelCol + 1 })
      }
    }
  })

  return map
}

function sourceStatementSegments(line: string): Array<{ text: string; start: number }> {
  const out: Array<{ text: string; start: number }> = []
  const textArrowLabelRanges = bareTextArrowLabelRanges(line, topLevelMask(line))
  let textArrowRangeIndex = 0
  let segmentStart = 0
  const stack: string[] = []
  let quote: string | undefined
  let pipeLabel = false
  let escaped = false
  const push = (end: number): void => {
    const raw = line.slice(segmentStart, end)
    const leading = raw.length - raw.trimStart().length
    const text = raw.trim()
    if (text) out.push({ text, start: segmentStart + leading })
    segmentStart = end + 1
  }
  for (let index = 0; index < line.length; index++) {
    const char = line[index]!
    if (quote) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === quote) quote = undefined
      continue
    }
    if (char === '"' || char === "'" || char.charCodeAt(0) === 96) { quote = char; continue }
    if (char === '|' && stack.length === 0) { pipeLabel = !pipeLabel; continue }
    if (char === '[' || char === '(' || char === '{') { stack.push(char); continue }
    if (char === ']' || char === ')' || char === '}') { stack.pop(); continue }
    if (char === ';' && stack.length === 0 && !pipeLabel) {
      while (textArrowLabelRanges[textArrowRangeIndex]
        && textArrowLabelRanges[textArrowRangeIndex]!.end <= index) textArrowRangeIndex++
      const range = textArrowLabelRanges[textArrowRangeIndex]
      if (!range || index < range.start || index >= range.end) push(index)
    }
  }
  push(line.length)
  return out
}

interface TextRange { start: number; end: number }
interface TextArrowRange extends TextRange { closeEnd: number }

/** Locate bare text-arrow labels without relying on either endpoint text.
 * Endpoint ids are legal label text, so searching for the target first makes
 * `A -- B --> B` look unlabeled. */
function bareTextArrowLabelRanges(line: string, topLevel = topLevelMask(line)): TextRange[] {
  const ranges: TextRange[] = []
  const lastCloser = lastTextArrowCloserIndex(line)
  if (lastCloser < 0) return ranges
  for (let index = 0; index < lastCloser; index++) {
    if (!topLevel[index]) continue
    const range = textArrowLabelRangeAt(line, index, lastCloser)
    if (!range || ranges.some(existing => existing.start === range.start && existing.end === range.end)) continue
    ranges.push(range)
    index = range.closeEnd - 1
  }
  return ranges
}

const TEXT_ARROW_OPEN_RE = /(?:<)?(?:-{2,}|-\.+|={2,})/y
const TEXT_ARROW_CLOSE_RE = /(?:-{2,}[>ox]|-{3,}|\.+->|-\.+-|={2,}>|={3,})/y

function matchLengthAt(expression: RegExp, line: string, index: number): number {
  expression.lastIndex = index
  return expression.exec(line)?.[0].length ?? 0
}

function lastTextArrowCloserIndex(line: string): number {
  let last = -1
  for (let index = 0; index < line.length; index++) {
    if (!/[-.=]/.test(line[index]!)) continue
    if (matchLengthAt(TEXT_ARROW_CLOSE_RE, line, index) > 0) last = index
  }
  return last
}

/** Mirror the parser's quote-aware text-arrow consumer at one source offset.
 * Requiring a complete closer distinguishes compact labels (`A--lab-->B`)
 * from legal hyphenated ids (`foo--bar`). */
function textArrowLabelRangeAt(
  line: string,
  index: number,
  lastCloser = lastTextArrowCloserIndex(line),
): TextArrowRange | undefined {
  if (index > lastCloser || !/[-=<]/.test(line[index] ?? '')) return undefined
  if (index > 0 && /[-.=<]/.test(line[index - 1]!)) return undefined
  if (matchLengthAt(COMPACT_EDGE_OPERATOR_AT_RE, line, index) > 0) return undefined
  const openerLength = matchLengthAt(TEXT_ARROW_OPEN_RE, line, index)
  if (openerLength === 0) return undefined
  const semicolonEligible = /\s/.test(line[index + openerLength] ?? '')
  let sawSemicolon = false
  let quote = false
  let escaped = false
  for (let cursor = index + openerLength; cursor <= lastCloser; cursor++) {
    const char = line[cursor]!
    if (quote) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quote = false
      continue
    }
    if (char === '"') { quote = true; continue }
    if (char === ';') {
      if (!semicolonEligible) return undefined
      sawSemicolon = true
      continue
    }
    const closerLength = matchLengthAt(TEXT_ARROW_CLOSE_RE, line, cursor)
    if (closerLength === 0) continue
    if (sawSemicolon && !/\s/.test(line[cursor - 1] ?? '')) return undefined
    const rawLabel = line.slice(index + openerLength, cursor)
    const leading = rawLabel.length - rawLabel.trimStart().length
    const trimmed = rawLabel.trim()
    if (!trimmed) continue
    const start = index + openerLength + leading
    return { start, end: start + trimmed.length, closeEnd: cursor + closerLength }
  }
  return undefined
}

function topLevelPipeLabelRanges(line: string, topLevel: boolean[], from: number, to: number): TextRange[] {
  const ranges: TextRange[] = []
  for (let index = Math.max(0, from); index < Math.min(line.length, to); index++) {
    if (line[index] !== '|' || !topLevel[index]) continue
    let contentStart = index + 1
    while (/\s/.test(line[contentStart] ?? '')) contentStart++
    let closing = -1
    if (line[contentStart] === '"') {
      let escaped = false
      for (let cursor = contentStart + 1; cursor < to; cursor++) {
        const char = line[cursor]!
        if (escaped) { escaped = false; continue }
        if (char === '\\') { escaped = true; continue }
        if (char !== '"') continue
        let pipe = cursor + 1
        while (/\s/.test(line[pipe] ?? '')) pipe++
        if (line[pipe] === '|') closing = pipe
        break
      }
    } else {
      closing = line.indexOf('|', index + 1)
    }
    if (closing > index + 1 && closing < to) {
      ranges.push({ start: index + 1, end: closing })
      index = closing
    }
  }
  return ranges
}

function edgeIntervalLabelRanges(
  line: string,
  topLevel: boolean[],
  textLabelRanges: TextRange[],
  from: number,
  to: number,
): TextRange[] {
  return [
    ...topLevelPipeLabelRanges(line, topLevel, from, to),
    ...textLabelRanges.filter(range => range.start >= from && range.end <= to),
  ].sort((left, right) => left.start - right.start)
}

function labelColumnInRanges(line: string, label: string, ranges: readonly TextRange[]): number {
  if (!label || label.trim().length === 0) return -1
  const variants = [label]
  const escaped = label.replace(/<br\s*\/?\s*>/gi, '\\n')
  if (escaped !== label) variants.push(escaped)
  for (const range of ranges) {
    for (const variant of variants) {
      const column = line.indexOf(variant, range.start)
      if (column >= range.start && column + variant.length <= range.end) return column
    }
  }
  return -1
}

function nonNodeStatement(line: string): boolean {
  const trimmed = line.trim()
  return trimmed === 'end'
    || /^(?:graph|flowchart|swimlane|stateDiagram(?:-v2)?)(?:\s|$)/i.test(trimmed)
    || /^(?:subgraph|direction|classDef|class|style|linkStyle|click|href)\b/i.test(trimmed)
}

function topLevelMask(line: string): boolean[] {
  const result = Array<boolean>(line.length).fill(false)
  const stack: string[] = []
  let quote: string | undefined
  let pipeLabel = false
  let escaped = false
  for (let index = 0; index < line.length; index++) {
    const char = line[index]!
    result[index] = quote === undefined && stack.length === 0 && !pipeLabel
    if (quote) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === quote) quote = undefined
      continue
    }
    // Spell the backtick by code point so the repository's deliberately
    // lightweight non-code scanner does not mistake this quote detector for
    // the start of a template literal.
    if (char === '"' || char === "'" || char.charCodeAt(0) === 96) { quote = char; continue }
    if (char === '|' && stack.length === 0) { pipeLabel = !pipeLabel; continue }
    if (char === '[' || char === '(' || char === '{') { stack.push(char); continue }
    if (char === ']' || char === ')' || char === '}') stack.pop()
  }
  return result
}

function nodeTokenAt(
  segment: SourceStatementSegment,
  id: string,
  start: number,
): boolean {
  const { text: line, topLevel, textLabelRanges: labelRanges, operatorStarts, operatorEnds } = segment
  if (nonNodeStatement(line) || !topLevel[start]) return false
  if (labelRanges.some(range => start >= range.start && start < range.end)) return false
  const before = line[start - 1]
  const idEnd = start + id.length
  const after = line[idEnd]
  let prefixEnd = start
  while (prefixEnd > 0 && /\s/.test(line[prefixEnd - 1]!)) prefixEnd--
  const startsTextArrow = labelRanges.some(range => range.start > idEnd
    && /^(?:<)?(?:-{2,}|-\.+|={2,})\s*$/.test(line.slice(idEnd, range.start)))
  const leftBoundary = !nodeIdCharacter(before) || operatorEnds.has(start)
  const rightBoundary = !nodeIdCharacter(after)
    || operatorStarts.has(idEnd)
    || matchLengthAt(COMPACT_EDGE_OPERATOR_AT_RE, line, idEnd) > 0
    || startsTextArrow
  if (!leftBoundary || !rightBoundary) return false
  if (line.slice(Math.max(0, prefixEnd - 3), prefixEnd) === ':::'
    || edgeIdOperatorAt(line, idEnd, operatorStarts, labelRanges)) return false
  // In `A o--x B`, o is an edge-start marker, not the independently
  // declared node `o` that may occur later. At the beginning of `o--x B`,
  // after a fan-out `&`, after an incoming operator in `A-->o--x B`, or
  // after an incoming pipe label in `A-->|label|o--x B`, it is a real
  // endpoint.
  return !((id === 'o' || id === 'x') && /^--[ox]/.test(line.slice(idEnd, idEnd + 3))
    && prefixEnd > 0 && line[prefixEnd - 1] !== '&' && line[prefixEnd - 1] !== '|'
    && !operatorEnds.has(prefixEnd))
}

interface NodeIdTrie {
  readonly children: Map<string, NodeIdTrie>
  ids?: string[]
}

function buildNodeIdTrie(ids: Iterable<string>): NodeIdTrie {
  const root: NodeIdTrie = { children: new Map() }
  for (const id of ids) {
    let branch = root
    for (let index = 0; index < id.length; index++) {
      const char = id[index]!
      let child = branch.children.get(char)
      if (!child) {
        child = { children: new Map() }
        branch.children.set(char, child)
      }
      branch = child
    }
    ;(branch.ids ??= []).push(id)
  }
  return root
}

function candidateNodeTokens(line: string, trie: NodeIdTrie): Array<{ id: string; column: number }> {
  const candidates: Array<{ id: string; column: number }> = []
  for (let column = 0; column < line.length; column++) {
    let branch: NodeIdTrie | undefined = trie
    for (let index = column; index < line.length; index++) {
      branch = branch.children.get(line[index]!)
      if (!branch) break
      for (const id of branch.ids ?? []) candidates.push({ id, column })
    }
  }
  return candidates
}

const COMPACT_EDGE_OPERATOR_SOURCE = '(?:(?:<)?(?:~{3,}|-{2,}>|-{3,}|-{2,}[ox]|-\\.+->?|\\.+->|={2,}>|={3,})|[ox]-{2,}[ox])'
const COMPACT_EDGE_OPERATOR_AT_RE = new RegExp(COMPACT_EDGE_OPERATOR_SOURCE, 'y')

function nodeIdCharacter(char: string | undefined): boolean {
  return char !== undefined && /[\p{L}\p{N}_-]/u.test(char)
}

function edgeIdOperatorAt(
  line: string,
  at: number,
  operatorStarts: ReadonlySet<number>,
  labelRanges: readonly TextRange[],
): boolean {
  if (line[at] !== '@') return false
  let operator = at + 1
  while (/\s/.test(line[operator] ?? '')) operator++
  if (operatorStarts.has(operator) || matchLengthAt(COMPACT_EDGE_OPERATOR_AT_RE, line, operator) > 0) return true
  return labelRanges.some(range => range.start > operator
    && /^(?:<)?(?:-{2,}|-\.+|={2,})\s*$/.test(line.slice(operator, range.start)))
}

function edgeSourceMapKey(index: number, edge: MermaidEdge): string { return `edge#${index}:${edge.source}->${edge.target}` }

interface EdgeMention { sourceCol: number; targetCol: number }

function compactOperatorRanges(line: string, topLevel: boolean[]): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = []
  for (let index = 0; index < line.length; index++) {
    if (!topLevel[index]) continue
    const length = matchLengthAt(COMPACT_EDGE_OPERATOR_AT_RE, line, index)
    if (length === 0) continue
    ranges.push({ start: index, end: index + length })
    index += length - 1
  }
  return ranges
}

function lowerBound(values: readonly number[], minimum: number): number {
  let low = 0
  let high = values.length
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    if (values[middle]! < minimum) low = middle + 1
    else high = middle
  }
  return low
}

function lowerBoundOperators(
  operators: ReadonlyArray<{ start: number; end: number }>,
  minimum: number,
): number {
  let low = 0
  let high = operators.length
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    if (operators[middle]!.start < minimum) low = middle + 1
    else high = middle
  }
  return low
}

function edgeMentions(
  sourceColumns: readonly number[],
  targetColumns: readonly number[],
  sourceLength: number,
  operators: ReadonlyArray<{ start: number; end: number }>,
): EdgeMention[] {
  const mentions: EdgeMention[] = []
  for (const sourceCol of sourceColumns) {
    const sourceEnd = sourceCol + sourceLength
    let operatorIndex = lowerBoundOperators(operators, sourceEnd)
    if (operatorIndex > 0 && operators[operatorIndex - 1]!.end > sourceEnd) operatorIndex--
    const operator = operators[operatorIndex]
    if (!operator) continue
    const nextOperatorStart = operators[operatorIndex + 1]?.start ?? Number.POSITIVE_INFINITY
    for (let targetIndex = lowerBound(targetColumns, operator.end); targetIndex < targetColumns.length; targetIndex++) {
      const targetCol = targetColumns[targetIndex]!
      if (targetCol > nextOperatorStart) break
      mentions.push({ sourceCol, targetCol })
    }
  }
  return mentions
}

function labelColumn(line: string, label: string, afterCol: number): number {
  if (!label || label.trim().length === 0) return -1
  const direct = line.indexOf(label, Math.max(0, afterCol))
  if (direct >= 0) return direct
  const escaped = label.replace(/<br\s*\/?\s*>/gi, '\\n')
  if (escaped !== label) return line.indexOf(escaped, Math.max(0, afterCol))
  return -1
}

function nodeLabelColumn(line: string, label: string, afterCol: number): number {
  const ranges: TextRange[] = []
  let cursor = afterCol
  const declarationRange = (): TextRange | undefined => {
    const opener = line[cursor]
    if (opener !== '[' && opener !== '(' && opener !== '{' && opener !== '>') return undefined
    const closer = opener === '[' ? ']' : opener === '(' ? ')' : opener === '{' ? '}' : ']'
    const stack: string[] = []
    let quote: string | undefined
    let escaped = false
    for (let index = cursor; index < line.length; index++) {
      const char = line[index]!
      if (quote) {
        if (escaped) escaped = false
        else if (char === '\\') escaped = true
        else if (char === quote) quote = undefined
        continue
      }
      if (char === '"' || char === "'" || char.charCodeAt(0) === 96) { quote = char; continue }
      if (opener === '>' && char === ']' && index > cursor) return { start: cursor + 1, end: index }
      if (char === '[' || char === '(' || char === '{') stack.push(char)
      else if (char === ']' || char === ')' || char === '}') {
        stack.pop()
        if (char === closer && stack.length === 0) return { start: cursor + 1, end: index }
      }
    }
    return undefined
  }

  const shape = declarationRange()
  if (shape) {
    ranges.push(shape)
    cursor = shape.end + 1
  }
  if (line.startsWith('@{', cursor)) {
    const metadata = (() => {
      let depth = 0
      let quote: string | undefined
      let escaped = false
      for (let index = cursor + 1; index < line.length; index++) {
        const char = line[index]!
        if (quote) {
          if (escaped) escaped = false
          else if (char === '\\') escaped = true
          else if (char === quote) quote = undefined
          continue
        }
        if (char === '"' || char === "'") { quote = char; continue }
        if (char === '{') depth++
        else if (char === '}' && --depth === 0) return { start: cursor + 2, end: index }
      }
      return undefined
    })()
    if (metadata) ranges.push(metadata)
  }
  return labelColumnInRanges(line, label, ranges.reverse())
}

function mapSubgraphSource(sg: MermaidSubgraph, lines: string[], map: SourceMap): void {
  const re = new RegExp(`^\\s*subgraph\\s+${escapeRegex(sg.id)}(?:\\b|\\[|$)`, 'i')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (!re.test(line)) continue
    const col = line.indexOf(sg.id)
    map.groups.set(sg.id, { line: i + 1, col: col + 1 })
    const labelCol = sg.label && sg.label !== sg.id ? labelColumn(line, sg.label, col + sg.id.length) : -1
    if (labelCol >= 0) map.labels.set(`group:${sg.id}`, { line: i + 1, col: labelCol + 1 })
    break
  }
  for (const child of sg.children) mapSubgraphSource(child, lines, map)
}

function escapeRegex(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

// ---- Serializer -------------------------------------------------------------

export function renderFlowchart(graph: MermaidGraph, headerKind: 'flowchart' | 'state'): string {
  const lines: string[] = [headerKind === 'state' ? 'stateDiagram-v2' : `flowchart ${graph.direction}`]
  const declaredInline = new Set<string>()

  // Subgraph blocks MUST come before edges: the legacy parser associates a
  // node with the subgraph in whose block it FIRST appears. If an edge at the
  // top declared the node first, a later bare reference inside the subgraph is
  // ignored and membership is lost on re-parse. Emitting members (with their
  // shape declaration) inside the block first makes round-trip stable.
  const membersDeclared = new Set<string>()
  const renderSubgraph = (sg: MermaidGraph['subgraphs'][number], indent: string) => {
    lines.push(`${indent}subgraph ${sg.id}${sg.label !== sg.id ? `[${sg.label}]` : ''}`)
    if (sg.direction) lines.push(`${indent}  direction ${sg.direction}`)
    for (const child of sg.children) renderSubgraph(child, indent + '  ')
    for (const nid of sg.nodeIds) {
      const node = graph.nodes.get(nid)
      if (node && needsExplicitDeclaration(node)) {
        lines.push(`${indent}  ${node.id}${renderShape(node)}`)
        declaredInline.add(nid)
      } else {
        lines.push(`${indent}  ${nid}`)
      }
      membersDeclared.add(nid)
    }
    lines.push(`${indent}end`)
  }
  for (const sg of graph.subgraphs) renderSubgraph(sg, '  ')

  for (const edge of graph.edges) {
    lines.push('  ' + renderEdge(edge, graph.nodes, declaredInline))
    const metadata = renderEdgeMetadata(edge)
    if (metadata) lines.push('  ' + metadata)
  }

  for (const [id, node] of graph.nodes) {
    if (declaredInline.has(id) || membersDeclared.has(id)) continue
    const orphan = graph.edges.every(e => e.source !== id && e.target !== id)
    if (orphan || needsExplicitDeclaration(node)) lines.push('  ' + `${node.id}${renderShape(node)}`)
  }

  for (const [name, props] of graph.classDefs) lines.push(`  classDef ${name} ${styleProps(props)}`)
  for (const [id, cls] of graph.classAssignments) lines.push(`  class ${id} ${cls}`)
  for (const [id, style] of graph.nodeStyles) lines.push(`  style ${id} ${styleProps(style)}`)
  for (const [idx, style] of graph.linkStyles) lines.push(`  linkStyle ${idx} ${styleProps(style)}`)
  for (const node of graph.nodes.values()) {
    if (node.href) lines.push(`  click ${node.id} href ${quoteLabel(node.href)}`)
  }

  return lines.join('\n') + '\n'
}

function needsExplicitDeclaration(node: MermaidNode): boolean {
  return node.label !== node.id || node.shape !== 'rectangle' || node.authoredShape !== undefined || node.icon !== undefined || node.image !== undefined
}

function renderShape(node: MermaidNode): string {
  // Media metadata is fully modeled as inert local presentation data, so the
  // typed serializer can reproduce it without falling back to an opaque body.
  if (node.icon !== undefined || node.image !== undefined) {
    const entries = [
      node.icon !== undefined ? `icon: ${quoteLabel(node.icon)}` : `img: ${quoteLabel(node.image!)}`,
      ...(node.iconForm ? [`form: ${node.iconForm}`] : []),
      ...(node.label !== node.id ? [`label: ${quoteLabel(node.label)}`] : []),
    ]
    return `@{ ${entries.join(', ')} }`
  }
  // v11 typed shapes serialize as `@{ shape: <authored spelling>, label: … }`
  // — the AUTHORED alias round-trips verbatim (repo #44); the label uses the
  // same quoting table as every other emitted label.
  if (node.authoredShape !== undefined) {
    const label = node.label !== node.id ? `, label: ${quoteLabel(node.label)}` : ''
    return `@{ shape: ${node.authoredShape}${label} }`
  }
  const lbl = escapeLabel(node.label)
  switch (node.shape) {
    case 'rectangle': return `[${lbl}]`
    case 'rounded': return `(${lbl})`
    case 'stadium': return `([${lbl}])`
    case 'subroutine': return `[[${lbl}]]`
    case 'cylinder': return `[(${lbl})]`
    case 'circle': return `((${lbl}))`
    case 'doublecircle': return `(((${lbl})))`
    case 'asymmetric': return `>${lbl}]`
    case 'diamond': return `{${lbl}}`
    case 'hexagon': return `{{${lbl}}}`
    case 'trapezoid': return `[/${lbl}\\]`
    case 'trapezoid-alt': return `[\\${lbl}/]`
    case 'lean-r': return `[/${lbl}/]`
    case 'lean-l': return `[\\${lbl}\\]`
    case 'service': return `[${lbl}]`
    case 'state-start':
    case 'state-end':
    // State-parser-only pseudostates — unreachable from flowchart bodies
    // (the flowchart grammar and op menu never produce them).
    case 'state-fork':
    case 'state-join':
    case 'state-choice':
    case 'state-history': return ''
  }
}

/** The ONE quoted-label escaping used by every serialization site (bracket
 *  labels and `@{ label: … }` metadata): `<br>`-normalized, `"` and `\`
 *  backslash-escaped — exactly the form the parser's quoted-label grammar
 *  reads back. */
function quoteLabel(label: string): string {
  const normalized = label.replace(/\r?\n/g, '<br>')
  return `"${normalized.replace(/["\\]/g, '\\$&')}"`
}

function escapeLabel(label: string): string {
  const normalized = label.replace(/\r?\n/g, '<br>')
  if (/[\[\]{}()|]/.test(normalized)) return quoteLabel(label)
  return normalized
}

function renderEdge(edge: MermaidEdge, nodes: Map<string, MermaidNode>, declaredInline: Set<string>): string {
  const src = inlineNodeRef(edge.source, nodes, declaredInline)
  const dst = inlineNodeRef(edge.target, nodes, declaredInline)
  const labelPart = edge.label ? `|${escapeLabel(edge.label)}|` : ''
  // v11.6 edge identity: the authored `id@` prefix round-trips verbatim.
  const idPrefix = edge.id ? `${edge.id}@` : ''
  return `${src} ${idPrefix}${renderEdgeArrow(edge)}${labelPart} ${dst}`
}

function renderEdgeMetadata(edge: MermaidEdge): string | null {
  if (!edge.id) return null
  const entries = [
    ...(edge.animate !== undefined ? [`animate: ${edge.animate}`] : []),
    ...(edge.animation ? [`animation: ${edge.animation}`] : []),
    ...(edge.curve ? [`curve: ${edge.curve}`] : []),
  ]
  return entries.length > 0 ? `${edge.id}@{ ${entries.join(', ')} }` : null
}

function inlineNodeRef(id: string, nodes: Map<string, MermaidNode>, declaredInline: Set<string>): string {
  const n = nodes.get(id)
  if (!n) return id
  if (needsExplicitDeclaration(n) && !declaredInline.has(id)) {
    declaredInline.add(id)
    return `${id}${renderShape(n)}`
  }
  return id
}

function renderEdgeArrow(edge: MermaidEdge): string {
  const start = edge.hasArrowStart ? markerChar(edge.startMarker ?? 'arrow', true) : ''
  const end = edge.hasArrowEnd ? markerChar(edge.endMarker ?? 'arrow', false) : ''
  // Extra shaft units for a lengthened link (Mermaid rank distance). `length`
  // is undefined ≡ 1 for base operators, so they serialize byte-identically.
  const extra = Math.max(0, (edge.length ?? 1) - 1)
  switch (edge.style) {
    case 'invisible': return '~'.repeat(3 + extra)
    case 'solid': return `${start}${'-'.repeat((!edge.hasArrowStart && !edge.hasArrowEnd ? 3 : 2) + extra)}${end}`
    case 'dotted': return `${start}-${'.'.repeat(1 + extra)}-${end}`
    case 'thick': return `${start}${'='.repeat((!edge.hasArrowStart && !edge.hasArrowEnd ? 3 : 2) + extra)}${end}`
  }
}

function markerChar(marker: 'arrow' | 'circle' | 'cross', isStart: boolean): string {
  if (marker === 'arrow') return isStart ? '<' : '>'
  if (marker === 'circle') return 'o'
  return 'x'
}

function styleProps(props: Record<string, string>): string {
  return Object.entries(props).map(([k, v]) => `${k}:${v}`).join(',')
}

// ---- Mutator ----------------------------------------------------------------

export function mutateFlowchart(body: FlowchartBody, op: FlowchartMutationOp): Result<FlowchartBody, MutationError> {
  const graph = cloneGraph(body.graph)
  const done = (): Result<FlowchartBody, MutationError> => ok({ kind: 'flowchart', graph })
  switch (op.kind) {
    case 'add_node': {
      if (graph.nodes.has(op.id)) return err({ code: 'DUPLICATE_NODE', message: `Node "${op.id}" already exists` })
      const resolved = resolveShapeValue(op.shape ?? 'rectangle')
      if (!resolved) {
        return err({ code: 'INVALID_OP', message: `Unknown shape "${op.shape}" — pass a geometry (${GEOMETRY_SHAPES.join(', ')}) or a Mermaid v11 @{ shape } name/alias (e.g. manual-input, document, delay)` })
      }
      graph.nodes.set(op.id, {
        id: op.id, label: op.label, shape: resolved.shape,
        ...(resolved.semanticShape !== undefined ? { semanticShape: resolved.semanticShape, authoredShape: resolved.authoredShape } : {}),
      })
      if (op.parent) {
        const parent = findSubgraph(graph, op.parent)
        if (!parent) return err({ code: 'INVALID_OP', message: `Parent group "${op.parent}" not found` })
        parent.nodeIds.push(op.id)
      }
      return done()
    }
    case 'remove_node': {
      if (!graph.nodes.has(op.id)) return err({ code: 'NODE_NOT_FOUND', message: `Node "${op.id}" not found` })
      graph.nodes.delete(op.id)
      retainEdges(graph, edge => edge.source !== op.id && edge.target !== op.id)
      for (const sg of graph.subgraphs) removeFromSubgraph(sg, op.id)
      graph.classAssignments.delete(op.id)
      graph.nodeStyles.delete(op.id)
      return done()
    }
    case 'rename_node': {
      if (!graph.nodes.has(op.from)) return err({ code: 'NODE_NOT_FOUND', message: `Node "${op.from}" not found` })
      if (graph.nodes.has(op.to)) return err({ code: 'DUPLICATE_NODE', message: `Cannot rename to "${op.to}" — already exists` })
      const node = graph.nodes.get(op.from)!
      graph.nodes.delete(op.from)
      graph.nodes.set(op.to, { ...node, id: op.to, label: node.label === op.from ? op.to : node.label })
      for (const e of graph.edges) {
        if (e.source === op.from) e.source = op.to
        if (e.target === op.from) e.target = op.to
      }
      for (const sg of graph.subgraphs) renameInSubgraph(sg, op.from, op.to)
      if (graph.classAssignments.has(op.from)) {
        graph.classAssignments.set(op.to, graph.classAssignments.get(op.from)!); graph.classAssignments.delete(op.from)
      }
      if (graph.nodeStyles.has(op.from)) {
        graph.nodeStyles.set(op.to, graph.nodeStyles.get(op.from)!); graph.nodeStyles.delete(op.from)
      }
      return done()
    }
    case 'set_label': {
      if (graph.nodes.has(op.target)) {
        const n = graph.nodes.get(op.target)!
        graph.nodes.set(op.target, { ...n, label: op.label })
        return done()
      }
      const idx = findEdgeIndexById(graph, op.target)
      if (idx >= 0) { graph.edges[idx]!.label = op.label; return done() }
      return err({ code: 'NODE_NOT_FOUND', message: `Target "${op.target}" matches no node or edge` })
    }
    case 'add_edge': {
      ensureNode(graph, op.from); ensureNode(graph, op.to)
      graph.edges.push({ source: op.from, target: op.to, label: op.label, style: op.style ?? 'solid', hasArrowStart: false, hasArrowEnd: true })
      return done()
    }
    case 'remove_edge': {
      const idx = findEdgeIndexById(graph, op.id)
      if (idx < 0) return err({ code: 'EDGE_NOT_FOUND', message: `Edge "${op.id}" not found — pass an authored edge ID (e1), "from->to", or "from->to#k" for the k-th parallel edge` })
      retainEdges(graph, (_edge, edgeIndex) => edgeIndex !== idx)
      return done()
    }
    case 'set_shape': {
      const node = graph.nodes.get(op.id)
      if (!node) return err({ code: 'NODE_NOT_FOUND', message: `Node "${op.id}" not found` })
      const resolved = resolveShapeValue(op.shape)
      if (!resolved) {
        return err({ code: 'INVALID_OP', message: `Unknown shape "${op.shape}" — pass a geometry (${GEOMETRY_SHAPES.join(', ')}) or a Mermaid v11 @{ shape } name/alias (e.g. manual-input, document, delay)` })
      }
      graph.nodes.set(op.id, {
        ...node,
        shape: resolved.shape,
        semanticShape: resolved.semanticShape,
        authoredShape: resolved.authoredShape,
      })
      return done()
    }
    case 'set_direction': {
      if (op.subgraph !== undefined && op.subgraph !== null) {
        const sg = findSubgraph(graph, op.subgraph)
        if (!sg) return err({ code: 'GROUP_NOT_FOUND', message: `Subgraph "${op.subgraph}" not found` })
        sg.direction = op.direction
        return done()
      }
      graph.direction = op.direction
      return done()
    }
    case 'add_subgraph': {
      if (findSubgraph(graph, op.id)) return err({ code: 'INVALID_OP', message: `Subgraph "${op.id}" already exists` })
      if (graph.nodes.has(op.id)) return err({ code: 'INVALID_OP', message: `Identifier "${op.id}" is already a node — subgraph ids and node ids share one namespace` })
      const members: string[] = []
      for (const memberId of op.members ?? []) {
        if (!graph.nodes.has(memberId)) return err({ code: 'NODE_NOT_FOUND', message: `Member node "${memberId}" not found — add_node it first` })
        members.push(memberId)
      }
      const sg: MermaidSubgraph = { id: op.id, label: op.label ?? op.id, nodeIds: [], children: [] }
      if (op.parent !== undefined && op.parent !== null) {
        const parent = findSubgraph(graph, op.parent)
        if (!parent) return err({ code: 'GROUP_NOT_FOUND', message: `Parent subgraph "${op.parent}" not found` })
        parent.children.push(sg)
      } else {
        graph.subgraphs.push(sg)
      }
      // Members MOVE into the new subgraph from wherever they currently live
      // (top level or another subgraph) — the state make_composite precedent.
      for (const memberId of members) {
        for (const existing of graph.subgraphs) removeFromSubgraph(existing, memberId)
        sg.nodeIds.push(memberId)
      }
      return done()
    }
    case 'remove_subgraph': {
      const located = locateSubgraph(graph, op.id)
      if (!located) return err({ code: 'GROUP_NOT_FOUND', message: `Subgraph "${op.id}" not found` })
      const { list, index } = located
      const sg = list[index]!
      if (op.removeMembers) {
        const memberIds = new Set(collectMemberNodeIds(sg))
        for (const memberId of memberIds) {
          graph.nodes.delete(memberId)
          graph.classAssignments.delete(memberId)
          graph.nodeStyles.delete(memberId)
        }
        retainEdges(graph, edge => !memberIds.has(edge.source) && !memberIds.has(edge.target))
        list.splice(index, 1)
        return done()
      }
      // Default: dissolve the box — member nodes survive at the parent scope
      // and nested subgraphs are promoted in place.
      list.splice(index, 1, ...sg.children)
      return done()
    }
    case 'move_node': {
      if (!graph.nodes.has(op.id)) return err({ code: 'NODE_NOT_FOUND', message: `Node "${op.id}" not found` })
      const target = op.subgraph === null ? null : findSubgraph(graph, op.subgraph)
      if (op.subgraph !== null && !target) return err({ code: 'GROUP_NOT_FOUND', message: `Subgraph "${op.subgraph}" not found` })
      for (const sg of graph.subgraphs) removeFromSubgraph(sg, op.id)
      if (target) target.nodeIds.push(op.id)
      return done()
    }
    case 'define_class': {
      if (!/^[\w-]+$/.test(op.name)) return err({ code: 'INVALID_OP', message: 'Class name must contain only letters, digits, underscore, or hyphen' })
      const props = parseStylePropsForOp(op.style)
      if (!props) return err({ code: 'INVALID_OP', message: `Style "${op.style}" parses to no properties — expected CSS-like pairs such as "fill:#f96,stroke:#333"` })
      graph.classDefs.set(op.name, props)
      return done()
    }
    case 'set_node_class': {
      if (!graph.nodes.has(op.id)) return err({ code: 'NODE_NOT_FOUND', message: `Node "${op.id}" not found` })
      if (op.className === null) graph.classAssignments.delete(op.id)
      else {
        if (!/^[\w-]+$/.test(op.className)) return err({ code: 'INVALID_OP', message: 'Class name must contain only letters, digits, underscore, or hyphen' })
        graph.classAssignments.set(op.id, op.className)
      }
      return done()
    }
    case 'set_node_style': {
      if (!graph.nodes.has(op.id)) return err({ code: 'NODE_NOT_FOUND', message: `Node "${op.id}" not found` })
      if (op.style === null) { graph.nodeStyles.delete(op.id); return done() }
      const props = parseStylePropsForOp(op.style)
      if (!props) return err({ code: 'INVALID_OP', message: `Style "${op.style}" parses to no properties — expected CSS-like pairs such as "fill:#bbf,stroke-width:2px"` })
      graph.nodeStyles.set(op.id, props)
      return done()
    }
    default: {
      const _x: never = op
      return err({ code: 'INVALID_OP', message: unknownOpMessage('flowchart', _x) })
    }
  }
}

// ---- Op helpers ---------------------------------------------------------

/** Runtime NodeShape vocabulary for set_shape/add_node — mirrors the
 *  NodeShape type (the op-schema enum is transcribed from the same list). */
const GEOMETRY_SHAPES: readonly NodeShape[] = [
  'rectangle', 'service', 'rounded', 'diamond', 'stadium', 'circle', 'subroutine',
  'doublecircle', 'hexagon', 'cylinder', 'asymmetric', 'trapezoid', 'trapezoid-alt',
  'lean-r', 'lean-l', 'state-start', 'state-end',
]

interface ResolvedShapeValue {
  shape: NodeShape
  semanticShape?: string
  authoredShape?: string
}

/** Resolve a shape value: a NodeShape geometry name passes through (clearing
 *  any v11 metadata), a documented v11 name/alias maps through the ONE table
 *  in src/flowchart-shapes.ts and keeps the authored spelling. */
function resolveShapeValue(shape: string): ResolvedShapeValue | null {
  if ((GEOMETRY_SHAPES as readonly string[]).includes(shape)) {
    return { shape: shape as NodeShape }
  }
  const v11 = normalizeV11Shape(shape)
  if (!v11) return null
  return { shape: v11.geometry, semanticShape: v11.canonical, authoredShape: shape }
}

/** Style strings parse through the parser's OWN parseStyleProps (one style
 *  grammar, two consumers); null when nothing parses — the op is rejected
 *  prescriptively instead of writing an empty directive. */
function parseStylePropsForOp(style: string): Record<string, string> | null {
  const parsed = parseMutableStyleProps(style)
  return parsed.ok ? parsed.value : null
}

function locateSubgraph(graph: MermaidGraph, id: string): { list: MermaidSubgraph[]; index: number } | null {
  const search = (list: MermaidSubgraph[]): { list: MermaidSubgraph[]; index: number } | null => {
    for (let i = 0; i < list.length; i++) {
      if (list[i]!.id === id) return { list, index: i }
      const nested = search(list[i]!.children)
      if (nested) return nested
    }
    return null
  }
  return search(graph.subgraphs)
}

function collectMemberNodeIds(sg: MermaidSubgraph): string[] {
  const out = [...sg.nodeIds]
  for (const child of sg.children) out.push(...collectMemberNodeIds(child))
  return out
}

// ---- Graph helpers ----------------------------------------------------------

/** Retain edges and atomically remap every numeric linkStyle bound to an old
 * edge index. `default` and authored out-of-range indices have no edge identity
 * to remap, so they retain their historical compatibility behavior. */
function retainEdges(
  graph: MermaidGraph,
  keep: (edge: MermaidEdge, index: number) => boolean,
): void {
  const oldEdges = graph.edges
  const oldToNew = new Map<number, number>()
  const edges: MermaidEdge[] = []
  oldEdges.forEach((edge, oldIndex) => {
    if (!keep(edge, oldIndex)) return
    oldToNew.set(oldIndex, edges.length)
    edges.push(edge)
  })

  const linkStyles = new Map<number | 'default', Record<string, string>>()
  for (const [target, style] of graph.linkStyles) {
    if (target === 'default' || !Number.isInteger(target) || target < 0 || target >= oldEdges.length) {
      linkStyles.set(target, style)
      continue
    }
    const remapped = oldToNew.get(target)
    if (remapped !== undefined) linkStyles.set(remapped, style)
  }
  graph.edges = edges
  graph.linkStyles = linkStyles
}

export function edgeIdOf(edge: MermaidEdge, idx = 0): string {
  return idx === 0 ? `${edge.source}->${edge.target}` : `${edge.source}->${edge.target}#${idx}`
}

function findEdgeIndexById(graph: MermaidGraph, id: string): number {
  // Authored v11.6 edge IDs are the primary selector (`e1@-->` identity);
  // the endpoint forms `from->to` / `from->to#k` remain valid.
  const authored = graph.edges.findIndex(e => e.id === id)
  if (authored >= 0) return authored
  const [endpoints, suffix] = id.split('#')
  const [from, to] = (endpoints ?? '').split('->')
  if (!from || !to) return -1
  const occ = suffix ? parseInt(suffix, 10) : 0
  let seen = 0
  for (let i = 0; i < graph.edges.length; i++) {
    const e = graph.edges[i]!
    if (e.source === from && e.target === to) { if (seen === occ) return i; seen++ }
  }
  return -1
}

function ensureNode(graph: MermaidGraph, id: string): void {
  if (!graph.nodes.has(id)) graph.nodes.set(id, { id, label: id, shape: 'rectangle' })
}

function findSubgraph(graph: MermaidGraph, id: string): MermaidSubgraph | null {
  const search = (list: MermaidSubgraph[]): MermaidSubgraph | null => {
    for (const sg of list) { if (sg.id === id) return sg; const c = search(sg.children); if (c) return c }
    return null
  }
  return search(graph.subgraphs)
}
function removeFromSubgraph(sg: MermaidSubgraph, id: string): void {
  sg.nodeIds = sg.nodeIds.filter(n => n !== id)
  for (const c of sg.children) removeFromSubgraph(c, id)
}
function renameInSubgraph(sg: MermaidSubgraph, from: string, to: string): void {
  sg.nodeIds = sg.nodeIds.map(n => (n === from ? to : n))
  for (const c of sg.children) renameInSubgraph(c, from, to)
}

function cloneGraph(graph: MermaidGraph): MermaidGraph {
  return {
    direction: graph.direction,
    nodes: new Map(Array.from(graph.nodes, ([k, v]) => [k, { ...v }])),
    edges: graph.edges.map(e => ({ ...e })),
    subgraphs: graph.subgraphs.map(cloneSubgraph),
    classDefs: new Map(Array.from(graph.classDefs, ([k, v]) => [k, { ...v }])),
    classAssignments: new Map(graph.classAssignments),
    nodeStyles: new Map(Array.from(graph.nodeStyles, ([k, v]) => [k, { ...v }])),
    linkStyles: new Map(Array.from(graph.linkStyles, ([k, v]) => [k, { ...v }])),
  }
}
function cloneSubgraph(sg: MermaidGraph['subgraphs'][number]): MermaidGraph['subgraphs'][number] {
  return { id: sg.id, label: sg.label, nodeIds: [...sg.nodeIds], children: sg.children.map(cloneSubgraph), direction: sg.direction }
}
