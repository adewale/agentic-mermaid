import { containsFlowchartOpaqueSyntax } from '../agent/flowchart-unsupported.ts'
import { coalesceFlowchartLines, type FlowchartLineGroup, type FlowchartScan, FLOWCHART_EDGE_ID_PREFIX_SOURCE, flowchartGroupPosition, flowchartNodeIdLength, flowchartStatementSpans, matchFlowchartLink, matchTextArrow, scanFlowchart } from '../flowchart-lexer.ts'
import { normalizeV11Shape } from '../flowchart-shapes.ts'
import { parseMermaid } from '../parser.ts'
import { assertMermaidGraphWork } from '../shared/diagram-limits.ts'
import { consumeClassShorthandPrefix } from '../shared/mermaid-identifiers.ts'
import { prepareDisplayText } from '../shared/display-text.ts'
import { observeParserMutation, observeParserStatement, parserObservationActive, withParserObservationGrammar } from '../shared/parser-observation.ts'
import { MermaidSyntaxError } from '../shared/syntax-error.ts'
import type { MermaidSubgraph } from '../types.ts'
import { readAgentflowMetadata } from './metadata.ts'
import type { AgentflowBody, AgentflowMapping, AgentflowRole } from './types.ts'

const syntaxError = (message: string, at?: { line: number; col: number }): MermaidSyntaxError => new MermaidSyntaxError(message, { diagramType: 'agentflow', ...(at ? { line: at.line + 1, column: at.col + 1 } : {}) })

const roles = new Set<AgentflowRole>(['task', 'tool', 'action', 'input', 'refdoc', 'decision', 'connector'])
// Lowercase names present in the pinned12.2 global shape registry beyond
// the shared Flowchart vocabulary. AgentFlow retains these metadata values;
// its renderer still derives only the family domain roles below.
const additionalShapeNames = new Set(['anchor', 'browser', 'bucket', 'choice', 'composite', 'console', 'directory', 'doublecircle', 'folder', 'icon', 'note', 'person', 'state'])

function invalidShape(shape: unknown): boolean {
  return !!shape && (typeof shape !== 'string' || shape !== shape.toLowerCase() || shape.includes('_') || ((!roles.has(shape as AgentflowRole) || shape === 'connector') && !additionalShapeNames.has(shape) && !normalizeV11Shape(shape)))
}

/** Metadata is data, including unknown nested keys. Prototype-shaped keys
 * are dropped before any model, projection or edit can consume the value. */
export function agentflowMetadata(value: unknown): Record<string, unknown> {
  const clean = (input: unknown, depth: number): unknown => {
    if (depth > 64) throw new Error('AgentFlow metadata nesting exceeds the host limit')
    if (Array.isArray(input)) return input.map(item => clean(item, depth + 1))
    if (input && typeof input === 'object') return Object.fromEntries(Object.entries(input).filter(([key]) => !['__proto__', 'prototype', 'constructor'].includes(key)).map(([key, item]) => [key, clean(item, depth + 1)]))
    if (input === null || typeof input === 'string' || typeof input === 'boolean' || (typeof input === 'number' && Number.isFinite(input))) return input
    throw syntaxError('AgentFlow metadata must contain finite YAML data values')
  }
  const cleaned = clean(value, 0)
  return cleaned && typeof cleaned === 'object' && !Array.isArray(cleaned) ? cleaned as Record<string, unknown> : {}
}

export function agentflowRole(shape: unknown): AgentflowRole {
  if (typeof shape === 'string' && roles.has(shape as AgentflowRole)) return shape as AgentflowRole
  return shape === 'subroutine' || shape === 'subprocess' || shape === 'subproc' || shape === 'framed-rectangle' ? 'tool'
    : shape === 'lean-right' || shape === 'lean-r' ? 'input' : shape === 'diamond' ? 'decision'
      : shape === 'lin-doc' || shape === 'lined-document' ? 'refdoc' : shape === 'hexagon' || shape === 'hex' ? 'action' : 'task'
}

/** Locate the declaration immediately before a classified metadata block.
 * Shape payloads and earlier links come from the shared lexer, so label text
 * cannot become a metadata target in a compound node/link statement. */
function metadataDeclaration(text: string, scan: FlowchartScan, before: number): string {
  const end = text.slice(0, before).trimEnd().length
  const shape = scan.regions.find(region => region.parent === -1 && region.kind === 'shape' && region.end === end)
  const nameEnd = shape?.start ?? end
  let afterLink = 0
  for (const link of scan.links) if (link.end <= nameEnd) afterLink = link.end
  const match = /([\p{L}\p{N}_.:-]+)\s*$/u.exec(text.slice(afterLink, nameEnd))
  if (!match) throw syntaxError('AgentFlow inline metadata needs a declared node, connector or flow')
  const start = afterLink + match.index
  if (!scan.topLevel[start]) throw syntaxError('AgentFlow metadata target must be outside label text')
  return match[1]!
}

const edgeIdPrefix = new RegExp(FLOWCHART_EDGE_ID_PREFIX_SOURCE, 'uy')

/** Source occurrences precede graph deduplication. Reuse classified regions
 * and the actual link/identifier primitives; label payload is never an ID. */
function mapGraphOccurrences(text: string, scan: FlowchartScan, record: (id: string, type: AgentflowMapping['type'], start: number, end: number) => AgentflowMapping): void {
  let at = 0, region = 0, groupStart = 0, sourceStart = 0
  let firstId: string | undefined, edgeId: string | undefined, pending = false, edge: AgentflowMapping | undefined
  while (at < text.length) {
    if (/\s/.test(text[at]!)) { at++; continue }
    if (text.startsWith('%%', at)) break
    if (firstId && text[at] === '&') { at++; continue }
    while (region < scan.regions.length && scan.regions[region]!.start < at) region++
    const current = scan.regions[region]
    if (current?.start === at) {
      if (current.kind === 'edge-text') { pending = true; sourceStart = groupStart; edge = undefined }
      at = current.end
      continue
    }
    if (firstId && /[-=.<xo~]/.test(text[at]!)) {
      const link = matchFlowchartLink(text, at) ?? matchTextArrow(text, at)
      if (link) { pending = true; sourceStart = groupStart; edge = undefined; at = link.end; continue }
    }
    const length = flowchartNodeIdLength(text, at)
    if (!length) { at++; continue }
    const start = at, id = text.slice(at, at + length)
    let end = at + length
    if (text[end] === '@') {
      edgeIdPrefix.lastIndex = at
      const named = edgeIdPrefix.exec(text)
      if (named) { edgeId = named[1]!; at += named[0].length; continue }
    }
    let next = region
    const shape = scan.regions[next]
    const shaped = shape?.start === end && shape.kind === 'shape'
    if (shaped) end = shape.end
    if (text.startsWith(':::', end)) end += consumeClassShorthandPrefix(text.slice(end))?.length ?? 0
    let after = end
    while (/\s/.test(text[after] ?? '') && after < text.length) after++
    while (next < scan.regions.length && scan.regions[next]!.start < after) next++
    const block = scan.regions[next]
    const annotated = block?.start === after && block.kind === 'metadata'
    if (annotated) end = block.end
    const node = record(id, annotated && !shaped ? 'attachment' : 'vertex', start, end)
    if (!firstId) { firstId = id; groupStart = start }
    if (pending) {
      edge = record(edgeId ?? firstId, 'edge', sourceStart, end)
      edgeId = undefined
      pending = false
      groupStart = start
    } else if (edge) { edge.endLine = node.endLine; edge.endCol = node.endCol }
    at = end
  }
}

/** Invert only the actual projection on failure. The shared lexer owns both
 * statement boundaries and metadata ranges; successful parses retain no trace. */
function locateTopologyError(error: MermaidSyntaxError, grammar: readonly string[], origins: readonly number[], groups: readonly FlowchartLineGroup[]): void {
  const row = (error.line ?? 0) - 1
  const groupIndex = origins[row * 2], start = origins[row * 2 + 1]
  const group = groupIndex === undefined ? undefined : groups[groupIndex]
  const statement = group && flowchartStatementSpans(group.text).find(statement => statement.start === start)
  let point: { line: number; col: number } | undefined
  if (statement && group) {
    const blocks = scanFlowchart(statement.text).regions.filter(region => region.kind === 'metadata' && region.parent === -1)
    let removed = 0
    for (const block of blocks) removed += block.end - block.start
    // Flow/global headers and connector declarations replace only a prefix.
    // Metadata removes classified ranges; neither rewrite creates new syntax.
    const prefixDelta = grammar[row]!.length - statement.text.length + removed
    let offset = Math.max(0, (error.column ?? 1) - 1 - prefixDelta)
    for (const block of blocks) if (block.start <= offset) offset += block.end - block.start
    point = flowchartGroupPosition(group, start! + offset)
  }
  const location = { diagramType: 'agentflow', ...(point ? { line: point.line + 1, column: point.col + 1 } : {}) }
  for (const key of ['diagramType', 'line', 'column'] as const) {
    if (location[key] !== undefined) Object.defineProperty(error, key, { value: location[key], enumerable: true, configurable: true })
  }
}

/** Flowchart supplies overlapping vertex/link syntax only. Container and
 * metadata records are captured before that projection is parsed. Source-only
 * render/label consumers omit occurrence publication; native/edit APIs keep it. */
export function parseAgentflow(source: string, collectMappings = true): AgentflowBody {
  const metadata = new Map<string, Record<string, unknown>>(), connectors = new Set<string>(), globals = new Set<string>(), mappings: AgentflowMapping[] = []
  const grammar: string[] = [], frames: Array<{ global: boolean; id?: string; mapping?: number }> = []
  // Packed group indices and statement offsets address already-produced
  // source groups. No per-statement origin objects or public fields are added.
  const origins: number[] = []
  const append = (text: string, group: number, start: number): void => { grammar.push(text); origins.push(group, start) }
  const declaredParents = new Map<string, string | undefined>()
  const openScope = (id: string, global: boolean): void => {
    if (!declaredParents.has(id)) declaredParents.set(id, frames.at(-1)?.id)
    frames.push({ global, id, ...(!global && collectMappings ? { mapping: mappings.length } : {}) })
  }
  const globalMentions = new Set<string>()
  const attachmentScopes = new Map<string, string | undefined>()
  const globalScopes = new Set<string>()
  let first = true, synthetic = 0
  // Only malformed shape assignments need an error origin; ordinary models
  // retain no second position map. A later valid assignment may supersede one.
  let invalidShapeSources: Map<string, { line: number; col: number }> | undefined
  const authoredIds = new Set(source.match(/[\p{L}\p{N}_-]+/gu) ?? [])
  const syntheticIdentity = (kind: 'global' | 'flow'): string => {
    let id = `__agentflow_${kind}_${synthetic++}`
    while (authoredIds.has(id)) id += '_'
    authoredIds.add(id)
    return id
  }
  const groups = coalesceFlowchartLines(source.split(/\r?\n/))
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
    const group = groups[groupIndex]!
    // A full comment owns the rest of its physical line, including semicolons.
    // Coalesced quoted labels and metadata still begin with their declaration.
    if (group.text.trimStart().startsWith('%%')) continue
    for (const statement of flowchartStatementSpans(group.text)) {
      let text = statement.text.trim()
      if (!text || text.startsWith('%%')) continue
      if (parserObservationActive('agentflow')) {
        const at = flowchartGroupPosition(group, statement.start)
        observeParserStatement('agentflow', first ? 'header' : 'statement', text, { line: at.line + 1, column: at.col + 1, unit: 'physical' })
      }
      if (first) {
        const header = text.match(/^agentflow-beta(?:\s+(LR|RL|TB|TD|BT))?\s*$/i)
        if (!header) throw syntaxError('Expected agentflow-beta and a supported direction')
        append(`flowchart ${header[1] ?? 'TB'}`, groupIndex, statement.start); first = false; continue
      }
      const map = collectMappings ? (id: string, type: AgentflowMapping['type'], start = 0, finish = statement.text.length): AgentflowMapping => {
        const at = flowchartGroupPosition(group, statement.start + start), end = flowchartGroupPosition(group, statement.start + finish)
        const mapping = { id, type, line: at.line + 1, col: at.col + 1, endLine: end.line + 1, endCol: end.col + 1 }
        mappings.push(mapping)
        return mapping
      } : undefined
      const scan = scanFlowchart(text)
      const blocks = scan.regions.filter(region => region.kind === 'metadata' && region.parent === -1)
      let attachment = false, withoutMetadata = '', cursor = 0
      const anonymousFlow = /^flow\s*(?:@\s*\{|$)/i.test(text) ? syntheticIdentity('flow') : undefined
      for (const block of blocks) {
        if (!block.closed) throw syntaxError('Unclosed AgentFlow metadata block', flowchartGroupPosition(group, statement.start + block.start))
        const prefix = text.slice(0, block.start).trimEnd()
        const declaration = metadataDeclaration(text, scan, block.start)
        const id = anonymousFlow && prefix === 'flow' ? anonymousFlow : declaration
        const parsed = readAgentflowMetadata(text.slice(block.contentStart, block.contentEnd))
        if (!parsed.ok) throw syntaxError(`AgentFlow metadata for ${id}: ${parsed.message}`, flowchartGroupPosition(group, statement.start + block.contentStart + (parsed.offset ?? 0)))
        const data = agentflowMetadata(Object.fromEntries(parsed.entries))
        if (Object.hasOwn(data, 'shape')) {
          if (invalidShape(data.shape)) (invalidShapeSources ??= new Map()).set(id, flowchartGroupPosition(group, statement.start + block.start))
          else invalidShapeSources?.delete(id)
        }
        metadata.set(id, { ...metadata.get(id), ...data })
        if (parserObservationActive('agentflow')) observeParserMutation('agentflow', 'set-metadata', { id, metadata: metadata.get(id) })
        if (prefix === id) {
          attachment = true
          if (!attachmentScopes.has(id)) attachmentScopes.set(id, frames.at(-1)?.id)
        }
        withoutMetadata += text.slice(cursor, block.start)
        cursor = block.end
      }
      text = withoutMetadata + text.slice(cursor)
      if (/^flow\s*$/i.test(text)) {
        const id = anonymousFlow!
        openScope(id, false); map?.(id, 'flow'); append(`subgraph ${id}[""]`, groupIndex, statement.start); continue
      }
      if (/^global\s*$/i.test(text)) {
        const id = syntheticIdentity('global')
        globalScopes.add(id); openScope(id, true); append(`subgraph ${id}`, groupIndex, statement.start); continue
      }
      if (/^end\s*$/i.test(text)) {
        const frame = frames.pop()
        if (!frame) throw syntaxError('AgentFlow end has no open flow or global block')
        if (frame.mapping !== undefined) {
          const mapping = mappings[frame.mapping]!, end = flowchartGroupPosition(group, statement.start + statement.text.length)
          mapping.endLine = end.line + 1
          mapping.endCol = end.col + 1
        }
        append('end', groupIndex, statement.start); continue
      }
      const flow = text.match(/^flow\s+([\p{L}\p{N}_.:-]+)(.*)$/u)
      if (flow) { openScope(flow[1]!, false); map?.(flow[1]!, 'flow'); append(`subgraph ${flow[1]}${flow[2]}`, groupIndex, statement.start); continue }
      if (/^(?:subgraph|global|flow)\b/i.test(text)) throw syntaxError('Unsupported AgentFlow container declaration')
      const connector = text.match(/^connector\s+([\p{L}\p{N}_.:-]+)(.*)$/u)
      if (connector) { connectors.add(connector[1]!); globals.add(connector[1]!); map?.(connector[1]!, 'connector'); text = `${connector[1]}${connector[2]}` }
      else if (map && !/^(?:direction|classDef|class|style|linkStyle|click|href|accTitle|accDescr)(?:\s|$)/i.test(text)) mapGraphOccurrences(statement.text, scan, map)
      // An attachment does not redeclare its target or move it into a flow.
      if (attachment && /^[\p{L}\p{N}_.:-]+\s*$/u.test(text)) continue
      if (frames.at(-1)?.global && !/^(?:direction|classDef|class|style|linkStyle|click)\b/.test(text)) {
        // Read only identifiers exposed by the shared production lexer. Match
        // them against the parsed graph below; labels and metadata cannot
        // become references. Capture before Flowchart's first-owner rule.
        const syntax = scanFlowchart(text),
          masked = text.split('')
        for (let i = 0; i < masked.length; i++) if (!syntax.topLevel[i]) masked[i] = ' '
        for (const link of syntax.links) for (let i = link.start; i < link.end; i++) masked[i] = ' '
        for (const word of masked.join('').matchAll(/[\p{L}\p{N}_.:-]+/gu)) globalMentions.add(word[0])
      }
      append(text, groupIndex, statement.start)
    }
  }
  if (frames.length) throw syntaxError('AgentFlow container is missing end')
  if (first) throw syntaxError('Empty AgentFlow diagram')
  const topology = grammar.join('\n')
  if (containsFlowchartOpaqueSyntax(topology)) throw syntaxError('AgentFlow contains source-preserved graph constructs')
  let graph: ReturnType<typeof parseMermaid>
  try { graph = withParserObservationGrammar('agentflow', 'flowchart', () => parseMermaid(topology)) }
  catch (error) {
    if (error instanceof MermaidSyntaxError) locateTopologyError(error, grammar, origins, groups)
    throw error
  }
  const allGroups = new Map<string, MermaidSubgraph>()
  const collect = (group: MermaidSubgraph): void => { allGroups.set(group.id, group); group.children.forEach(collect) }
  graph.subgraphs.forEach(collect)
  // AgentFlow declarations own containment. Flowchart also treats a link to
  // a root subgraph as membership; that reference cannot move a declared flow.
  for (const group of allGroups.values()) group.children = []
  graph.subgraphs = []
  for (const [id, parentId] of declaredParents) {
    const group = allGroups.get(id)!
    if (parentId === undefined) graph.subgraphs.push(group)
    else allGroups.get(parentId)!.children.push(group)
    if (parserObservationActive('agentflow')) observeParserMutation('agentflow', 'attach-flow', { id, parent: parentId })
  }
  const edgeIds = new Set(graph.edges.flatMap(edge => edge.id ? [edge.id] : []))
  for (const [id] of metadata) if (!graph.nodes.has(id) && !allGroups.has(id) && !edgeIds.has(id)) {
    graph.nodes.set(id, { id, label: id, shape: 'rectangle' })
    const scope = attachmentScopes.get(id)
    if (scope) allGroups.get(scope)?.nodeIds.push(id)
  }
  for (const id of globalMentions) if (graph.nodes.has(id)) globals.add(id)
  const escaped: MermaidSubgraph[] = []
  const hoist = (groups: MermaidSubgraph[], nested = false): MermaidSubgraph[] => groups.flatMap(group => {
    group.children = hoist(group.children, true)
    if (!globalScopes.has(group.id)) return [group]
    group.nodeIds.forEach(id => globals.add(id))
    if (nested) { escaped.push(...group.children); return [] }
    return group.children
  })
  graph.subgraphs = [...hoist(graph.subgraphs), ...escaped]
  const clearGlobals = (group: MermaidSubgraph): void => { group.nodeIds = group.nodeIds.filter(id => !globals.has(id)); group.children.forEach(clearGlobals) }
  graph.subgraphs.forEach(clearGlobals)
  const roleMap = new Map<string, AgentflowRole>()
  for (const [id, node] of graph.nodes) {
    const data = metadata.get(id)
    const invalidAt = invalidShapeSources?.get(id)
    if (!connectors.has(id) && invalidAt)
      throw syntaxError(`No such shape: ${JSON.stringify(data!.shape)}. AgentFlow shapes must be known lowercase names`, invalidAt)
    roleMap.set(id, connectors.has(id) ? 'connector' : agentflowRole(data?.shape ?? node.shape))
    if (data?.label !== undefined) {
      node.label = String(data.label)
      node.labelContent = { value: node.label, prepared: prepareDisplayText(node.label, data.labelType === 'markdown' ? 'formatted' : 'literal') }
      if (data.labelType === 'markdown') node.markdownLabel = true
      else delete node.markdownLabel
    }
  }
  assertMermaidGraphWork(graph)
  if (collectMappings) {
    const byPosition = (left: AgentflowMapping, right: AgentflowMapping) => left.line - right.line || left.col - right.col
    if (mappings.some((mapping, index) => index > 0 && byPosition(mappings[index - 1]!, mapping) > 0)) mappings.sort(byPosition)
  }
  return { kind: 'agentflow', graph, metadata, roles: roleMap, connectors, globals, mappings }
}
