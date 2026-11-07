import { containsFlowchartOpaqueSyntax } from '../agent/flowchart-unsupported.ts'
import { coalesceFlowchartLines, type FlowchartScan, flowchartGroupPosition, flowchartStatementSpans, scanFlowchart } from '../flowchart-lexer.ts'
import { normalizeV11Shape } from '../flowchart-shapes.ts'
import { parseMermaid } from '../parser.ts'
import { assertMermaidGraphWork } from '../shared/diagram-limits.ts'
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
function metadataDeclaration(text: string, scan: FlowchartScan, before: number): { id: string; start: number } {
  const end = text.slice(0, before).trimEnd().length
  const shape = scan.regions.find(region => region.parent === -1 && region.kind === 'shape' && region.end === end)
  const nameEnd = shape?.start ?? end
  let afterLink = 0
  for (const link of scan.links) if (link.end <= nameEnd) afterLink = link.end
  const match = /([\p{L}\p{N}_.:-]+)\s*$/u.exec(text.slice(afterLink, nameEnd))
  if (!match) throw syntaxError('AgentFlow inline metadata needs a declared node, connector or flow')
  const start = afterLink + match.index
  if (!scan.topLevel[start]) throw syntaxError('AgentFlow metadata target must be outside label text')
  return { id: match[1]!, start }
}

/** Flowchart supplies overlapping vertex/link syntax only. Container and
 * metadata records are captured before that projection is parsed. */
export function parseAgentflow(source: string): AgentflowBody {
  const metadata = new Map<string, Record<string, unknown>>(), connectors = new Set<string>(), globals = new Set<string>(), mappings: AgentflowMapping[] = []
  const grammar: string[] = [], frames: Array<{ global: boolean; id?: string; mapping?: number }> = []
  const declaredParents = new Map<string, string | undefined>()
  const openScope = (id: string, global: boolean): void => {
    if (!declaredParents.has(id)) declaredParents.set(id, frames.at(-1)?.id)
    frames.push({ global, id, ...(global ? {} : { mapping: mappings.length }) })
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
  for (const group of coalesceFlowchartLines(source.split(/\r?\n/))) {
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
        grammar.push(`flowchart ${header[1] ?? 'TB'}`); first = false; continue
      }
      const map = (id: string, type: AgentflowMapping['type'], start = 0, finish = statement.text.length): void => {
        const at = flowchartGroupPosition(group, statement.start + start), end = flowchartGroupPosition(group, statement.start + finish)
        mappings.push({ id, type, line: at.line + 1, col: at.col + 1, endLine: end.line + 1, endCol: end.col + 1 })
      }
      const scan = scanFlowchart(text)
      const blocks = scan.regions.filter(region => region.kind === 'metadata' && region.parent === -1)
      let attachment = false, withoutMetadata = '', cursor = 0
      const mappedVertices = new Set<string>()
      const anonymousFlow = /^flow\s*(?:@\s*\{|$)/i.test(text) ? syntheticIdentity('flow') : undefined
      for (const block of blocks) {
        if (!block.closed) throw syntaxError('Unclosed AgentFlow metadata block', flowchartGroupPosition(group, statement.start + block.start))
        const prefix = text.slice(0, block.start).trimEnd()
        const declaration = metadataDeclaration(text, scan, block.start)
        const id = anonymousFlow && prefix === 'flow' ? anonymousFlow : declaration.id
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
          map(id, 'attachment')
          if (!attachmentScopes.has(id)) attachmentScopes.set(id, frames.at(-1)?.id)
        }
        if (prefix !== id && !/^(?:flow|connector)\b/i.test(prefix)) { map(id, 'vertex', declaration.start, block.end); mappedVertices.add(id) }
        withoutMetadata += text.slice(cursor, block.start)
        cursor = block.end
      }
      text = withoutMetadata + text.slice(cursor)
      if (/^flow\s*$/i.test(text)) {
        const id = anonymousFlow!
        openScope(id, false); map(id, 'flow'); grammar.push(`subgraph ${id}[""]`); continue
      }
      if (/^global\s*$/i.test(text)) {
        const id = syntheticIdentity('global')
        globalScopes.add(id); openScope(id, true); grammar.push(`subgraph ${id}`); continue
      }
      if (/^end\s*$/i.test(text)) {
        const frame = frames.pop()
        if (!frame) throw syntaxError('AgentFlow end has no open flow or global block')
        if (frame.mapping !== undefined) {
          const mapping = mappings[frame.mapping]!, end = flowchartGroupPosition(group, statement.start + statement.text.length)
          mapping.endLine = end.line + 1
          mapping.endCol = end.col + 1
        }
        grammar.push('end'); continue
      }
      const flow = text.match(/^flow\s+([\p{L}\p{N}_.:-]+)(.*)$/u)
      if (flow) { openScope(flow[1]!, false); map(flow[1]!, 'flow'); grammar.push(`subgraph ${flow[1]}${flow[2]}`); continue }
      if (/^(?:subgraph|global|flow)\b/i.test(text)) throw syntaxError('Unsupported AgentFlow container declaration')
      const connector = text.match(/^connector\s+([\p{L}\p{N}_.:-]+)(.*)$/u)
      if (connector) { connectors.add(connector[1]!); globals.add(connector[1]!); map(connector[1]!, 'connector'); text = `${connector[1]}${connector[2]}` }
      else if (!attachment) {
        const id = text.match(/^([\p{L}\p{N}_.:-]+)/u)?.[1]
        if (id) {
          const edge = /-->|-\.-|--x/.test(text)
          const edgeId = text.match(/\s([\p{L}\p{N}_.:-]+)@(?=[-=.ox<>])/u)?.[1]
          if (edge || !mappedVertices.has(id)) map(edgeId ?? id, edge ? 'edge' : 'vertex')
        }
      }
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
      grammar.push(text)
    }
  }
  if (frames.length) throw syntaxError('AgentFlow container is missing end')
  if (first) throw syntaxError('Empty AgentFlow diagram')
  const topology = grammar.join('\n')
  if (containsFlowchartOpaqueSyntax(topology)) throw syntaxError('AgentFlow contains source-preserved graph constructs')
  const graph = withParserObservationGrammar('agentflow', 'flowchart', () => parseMermaid(topology))
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
  const byPosition = (left: AgentflowMapping, right: AgentflowMapping) => left.line - right.line || left.col - right.col
  if (mappings.some((mapping, index) => index > 0 && byPosition(mappings[index - 1]!, mapping) > 0)) mappings.sort(byPosition)
  return { kind: 'agentflow', graph, metadata, roles: roleMap, connectors, globals, mappings }
}
