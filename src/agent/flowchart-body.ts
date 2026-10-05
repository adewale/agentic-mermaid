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
import { parseMutableStyleProps, unsafeStylePaintError } from '../shared/style-props.ts'
import { unknownOpMessage } from './mutation-ops.ts'
import { normalizeV11Shape } from '../flowchart-shapes.ts'
import {
  type FlowchartRegion,
  type FlowchartScan,
  flowchartStatementSpans,
  flowchartTextArrowLabelRanges,
  scanFlowchart,
} from '../flowchart-lexer.ts'
import { parseFlowchartLabel, writeFlowchartLabelText } from '../flowchart-labels.ts'
import { quoteMetadataString } from '../shared/metadata-yaml.ts'
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
  /** The statement as flowchart-lexer.ts reads it. */
  readonly scan: FlowchartScan
  /** The outermost region opening at each offset. */
  readonly regionsByStart: ReadonlyMap<number, FlowchartRegion>
  /** Closed statement-level pipe labels, in source order. */
  readonly pipeLabels: readonly FlowchartRegion[]
  readonly topLevel: readonly boolean[]
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
    flowchartStatementSpans(line).map(segment => {
      const scan = scanFlowchart(segment.text)
      const regionsByStart = new Map<number, FlowchartRegion>()
      for (const region of scan.regions) if (!regionsByStart.has(region.start)) regionsByStart.set(region.start, region)
      const topLevel = scan.topLevel
      const textLabelRanges = flowchartTextArrowLabelRanges(segment.text, scan)
      const operatorRanges = compactOperatorRanges(segment.text, topLevel)
      return {
        ...segment,
        line: lineIndex + 1,
        scan,
        regionsByStart,
        pipeLabels: scan.regions.filter(region => region.kind === 'pipe' && region.closed && region.parent === -1),
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
      const labelCol = node ? nodeLabelColumn(segment, node.label, column + id.length) : -1
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
          const labelRanges = edgeIntervalLabelRanges(segment, sourceEnd, mention.targetCol)
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

interface TextRange { start: number; end: number }

/** The pipe labels (`-->|label|`) of a statement that lie between `from` and
 * `to`, as the lexer delimits them (sorted by opening pipe). */
function pipeLabelRanges(segment: SourceStatementSegment, from: number, to: number): TextRange[] {
  const ranges: TextRange[] = []
  const pipes = segment.pipeLabels
  let low = 0
  let high = pipes.length
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    if (pipes[middle]!.start < from) low = middle + 1
    else high = middle
  }
  for (let index = low; index < pipes.length && pipes[index]!.start < to; index++) {
    const pipe = pipes[index]!
    if (pipe.contentEnd < to && pipe.contentEnd > pipe.contentStart) ranges.push({ start: pipe.contentStart, end: pipe.contentEnd })
  }
  return ranges
}

function edgeIntervalLabelRanges(segment: SourceStatementSegment, from: number, to: number): TextRange[] {
  return [
    ...pipeLabelRanges(segment, from, to),
    ...segment.textLabelRanges.filter(range => range.start >= from && range.end <= to),
  ].sort((left, right) => left.start - right.start)
}

/** Where `label` begins in one label range: when the range's text reads as
 * the label (flowchart-labels.ts), at its first character inside any quotes;
 * otherwise where the label's text, as parsed or as the serializer writes it,
 * lies inside the range (a `@{ … }` value, a lean shape's slashes). */
function labelColumnInRange(line: string, label: string, range: TextRange): number {
  const raw = line.slice(range.start, range.end)
  let parsed: string | undefined
  try {
    parsed = parseFlowchartLabel(raw).text
  } catch {
    parsed = undefined
  }
  if (parsed === label) {
    let column = range.start + raw.length - raw.trimStart().length
    if (line[column] === '"') column += line[column + 1] === '`' ? 2 : 1
    return column
  }
  for (const spelling of new Set([label, writeFlowchartLabelText(label)])) {
    const column = line.indexOf(spelling, range.start)
    if (column >= range.start && column + spelling.length <= range.end) return column
  }
  return -1
}

function labelColumnInRanges(line: string, label: string, ranges: readonly TextRange[]): number {
  if (!label) return -1
  for (const range of ranges) {
    const column = labelColumnInRange(line, label, range)
    if (column >= 0) return column
  }
  return -1
}

function nonNodeStatement(line: string): boolean {
  const trimmed = line.trim()
  return trimmed === 'end'
    || /^(?:graph|flowchart|swimlane|stateDiagram(?:-v2)?)(?:\s|$)/i.test(trimmed)
    || /^(?:subgraph|direction|classDef|class|style|linkStyle|click|href)\b/i.test(trimmed)
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

function matchLengthAt(expression: RegExp, line: string, index: number): number {
  expression.lastIndex = index
  return expression.exec(line)?.[0].length ?? 0
}

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

function compactOperatorRanges(line: string, topLevel: readonly boolean[]): Array<{ start: number; end: number }> {
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

/** A subgraph title: the `[…]` after its id, or the rest of the line. */
function titleColumn(line: string, label: string, afterCol: number): number {
  const title = scanFlowchart(line).regions.find(region => region.kind === 'shape' && region.closed && region.start >= afterCol)
  return labelColumnInRanges(line, label, [title ? { start: title.contentStart, end: title.contentEnd } : { start: Math.max(0, afterCol), end: line.length }])
}

/** A node's label lies in the shape text right after its id and in a
 * `@{ … }` block after that, as the lexer delimits them. */
function nodeLabelColumn(segment: SourceStatementSegment, label: string, afterCol: number): number {
  const ranges: TextRange[] = []
  let cursor = afterCol
  let shape = segment.regionsByStart.get(cursor)
  if (shape?.kind === 'shape' && shape.closed) {
    cursor = shape.end
    // A doubled delimiter (`((…))`, `[[…]]`, `([…])`) holds the label in its
    // innermost shape text.
    for (let inner = segment.regionsByStart.get(shape.contentStart);
      inner?.kind === 'shape' && inner.closed && inner.end === shape.contentEnd;
      inner = segment.regionsByStart.get(inner.contentStart)) shape = inner
    ranges.push({ start: shape.contentStart, end: shape.contentEnd })
  }
  const metadata = segment.regionsByStart.get(cursor)
  if (metadata?.kind === 'metadata' && metadata.closed) ranges.push({ start: metadata.contentStart, end: metadata.contentEnd })
  return labelColumnInRanges(segment.text, label, ranges.reverse())
}

function mapSubgraphSource(sg: MermaidSubgraph, lines: string[], map: SourceMap): void {
  const re = new RegExp(`^\\s*subgraph\\s+${escapeRegex(sg.id)}(?:\\b|\\[|$)`, 'i')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (!re.test(line)) continue
    const col = line.indexOf(sg.id)
    map.groups.set(sg.id, { line: i + 1, col: col + 1 })
    const labelCol = sg.label && sg.label !== sg.id ? titleColumn(line, sg.label, col + sg.id.length) : -1
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
    lines.push(`${indent}subgraph ${sg.id}${sg.label !== sg.id ? `[${escapeNodeLabel(sg.label)}]` : ''}`)
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
  // Mermaid rejects an index that names no link, and its style draws nothing.
  for (const [idx, style] of graph.linkStyles) {
    if (idx === 'default' || idx < graph.edges.length) lines.push(`  linkStyle ${idx} ${styleProps(style)}`)
  }
  for (const node of graph.nodes.values()) {
    if (node.href) lines.push(`  click ${node.id} href ${quoteValue(node.href)}`)
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
      node.icon !== undefined ? `icon: ${quoteMetadataString(node.icon)}` : `img: ${quoteMetadataString(node.image!)}`,
      ...(node.iconForm ? [`form: ${node.iconForm}`] : []),
      ...(node.label !== node.id ? [`label: ${quoteMetadataLabel(node.label)}`] : []),
    ]
    return `@{ ${entries.join(', ')} }`
  }
  // v11 typed shapes serialize as `@{ shape: <authored spelling>, label: … }`
  // — the AUTHORED alias round-trips verbatim (repo #44); the label uses the
  // same quoting table as every other emitted label.
  if (node.authoredShape !== undefined) {
    const label = node.label !== node.id ? `, label: ${quoteMetadataLabel(node.label)}` : ''
    return `@{ shape: ${node.authoredShape}${label} }`
  }
  const lbl = escapeNodeLabel(node.label)
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

/** The ONE quoted-label form for bracket, pipe and subgraph labels: the
 *  label codec's text (flowchart-labels.ts), which spells `"` as `#quot;`
 *  because upstream's quoted strings have no escapes. A leading backtick is
 *  written `#96;`: `"` and a backtick open a markdown string. */
function quoteLabel(label: string): string {
  const text = writeFlowchartLabelText(label)
  return `"${text.startsWith('`') ? `#96;${text.slice(1)}` : text}"`
}

/** A `@{ label: … }` value: the label codec's text written as the YAML
 *  double-quoted scalar that upstream's `@{}` reader, and ours
 *  (shared/metadata-yaml.ts), reads back. */
function quoteMetadataLabel(label: string): string {
  return quoteMetadataString(writeFlowchartLabelText(label))
}

/** A `click` href: `"` and `\` backslash-escaped, the form its parser reads
 *  back. */
function quoteValue(value: string): string {
  const normalized = value.replace(/\r?\n/g, '<br>')
  return `"${normalized.replace(/["\\]/g, '\\$&')}"`
}

function escapeLabel(label: string): string {
  // Mermaid rejects an empty quoted label; a lone space trims back to empty.
  if (label === '') return '" "'
  // Upstream rejects a bracket, `|`, `"` or `@` in a bare label, and a leading
  // `~~~` (its invisible-link token).
  if (/[\[\]{}()|"@]|^~~~/.test(label)) return quoteLabel(label)
  return writeFlowchartLabelText(label)
}

/** `;` separates statements and no bracket shields it in an asymmetric
 *  `A>x]` node or after a title's closing delimiter (`[};a]`), and a leading
 *  `/` or `\` after `[` opens a lean or trapezoid shape (`-` after `(`, an
 *  ellipse), so a node label or subgraph title holding either is quoted. (A
 *  pipe label needs no quotes for these: the statement splitter skips `|…|`.)
 *  A title's line break stays on the `subgraph` line as `<br>`. */
function escapeNodeLabel(label: string): string {
  return /;|^[-/\\]/.test(label) ? quoteLabel(label) : escapeLabel(label)
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

// Label inputs are trimmed exactly as the parser trims authored labels (and
// upstream's flowchart DB does), so a typed edit stores the label that its
// serialized source re-parses to.
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
        id: op.id, label: op.label.trim(), shape: resolved.shape,
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
        graph.nodes.set(op.target, { ...n, label: op.label.trim() })
        return done()
      }
      const idx = findEdgeIndexById(graph, op.target)
      if (idx >= 0) { graph.edges[idx]!.label = edgeLabelInput(op.label); return done() }
      return err({ code: 'NODE_NOT_FOUND', message: `Target "${op.target}" matches no node or edge` })
    }
    case 'add_edge': {
      ensureNode(graph, op.from); ensureNode(graph, op.to)
      graph.edges.push({ source: op.from, target: op.to, label: edgeLabelInput(op.label), style: op.style ?? 'solid', hasArrowStart: false, hasArrowEnd: true })
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
      const sg: MermaidSubgraph = { id: op.id, label: op.label?.trim() ?? op.id, nodeIds: [], children: [] }
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
      const props = parseStylePropsForOp(op.style, `define_class ${op.name}`, 'fill:#f96,stroke:#333')
      if ('message' in props) return err({ code: 'INVALID_OP', message: props.message })
      graph.classDefs.set(op.name, props.value)
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
      const props = parseStylePropsForOp(op.style, `set_node_style ${op.id}`, 'fill:#bbf,stroke-width:2px')
      if ('message' in props) return err({ code: 'INVALID_OP', message: props.message })
      graph.nodeStyles.set(op.id, props.value)
      return done()
    }
    default: {
      const _x: never = op
      return err({ code: 'INVALID_OP', message: unknownOpMessage('flowchart', _x) })
    }
  }
}

// ---- Op helpers ---------------------------------------------------------

/** An edge label that trims to nothing is no label, as `-->|" "|` parses. */
function edgeLabelInput(label: string | undefined): string | undefined {
  return label?.trim() || undefined
}

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
 *  grammar, two consumers). A style that parses to nothing, or that paints with
 *  something other than a CSS color, is rejected prescriptively instead of
 *  writing a directive the renderer would refuse. */
function parseStylePropsForOp(style: string, subject: string, example: string): { value: Record<string, string> } | { message: string } {
  const parsed = parseMutableStyleProps(style)
  if (parsed.ok) return { value: parsed.value }
  if (parsed.reason === 'UNSAFE_PAINT') return { message: unsafeStylePaintError(subject, parsed.paint).message }
  return { message: `Style "${style}" parses to no properties — expected CSS-like pairs such as "${example}"` }
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
