import { coalesceFlowchartLines, flowchartGroupPosition, flowchartStatementSpans, scanFlowchart } from '../flowchart-lexer.ts'
import { readMetadataBlock } from '../shared/metadata-yaml.ts'
import { parseMermaid } from '../parser.ts'
import { assertMermaidGraphWork } from '../shared/diagram-limits.ts'
import type { MermaidSubgraph } from '../types.ts'
import type { AgentflowBody, AgentflowMapping, AgentflowRole } from './types.ts'
import { containsFlowchartOpaqueSyntax } from '../agent/flowchart-unsupported.ts'

const roles = new Set<AgentflowRole>(['task', 'tool', 'action', 'input', 'refdoc', 'decision', 'connector'])

/** Metadata is data, including unknown nested keys. Prototype-shaped keys
 * are dropped before any model, projection or edit can consume the value. */
export function agentflowMetadata(value: unknown): Record<string, unknown> {
  const clean = (input: unknown, depth: number): unknown => {
    if (depth > 64) throw new Error('AgentFlow metadata nesting exceeds the host limit')
    if (Array.isArray(input)) return input.map(item => clean(item, depth + 1))
    if (input && typeof input === 'object') return Object.fromEntries(Object.entries(input).filter(([key]) => !['__proto__', 'prototype', 'constructor'].includes(key)).map(([key, item]) => [key, clean(item, depth + 1)]))
    if (input === null || typeof input === 'string' || typeof input === 'boolean' || (typeof input === 'number' && Number.isFinite(input))) return input
    throw new Error('AgentFlow metadata must contain finite YAML data values')
  }
  const cleaned = clean(value, 0)
  return cleaned && typeof cleaned === 'object' && !Array.isArray(cleaned) ? cleaned as Record<string, unknown> : {}
}

export function agentflowRole(shape: unknown): AgentflowRole {
  if (typeof shape === 'string' && roles.has(shape as AgentflowRole)) return shape as AgentflowRole
  return shape === 'subroutine' || shape === 'subprocess' || shape === 'subproc' ? 'tool'
    : shape === 'lean-right' || shape === 'lean-r' ? 'input' : shape === 'diamond' ? 'decision'
      : shape === 'lin-doc' || shape === 'lined-document' ? 'refdoc' : shape === 'hexagon' || shape === 'hex' ? 'action' : 'task'
}

/** Flowchart supplies overlapping vertex/link syntax only. Container and
 * metadata records are captured before that projection is parsed. */
export function parseAgentflow(source: string): AgentflowBody {
  const metadata = new Map<string, Record<string, unknown>>(), connectors = new Set<string>(), globals = new Set<string>(), mappings: AgentflowMapping[] = []
  const grammar: string[] = [], frames: Array<{ global: boolean; id?: string }> = []
  const attachmentScopes = new Map<string, string | undefined>()
  const globalScopes = new Set<string>()
  let first = true, synthetic = 0
  const authoredIds = new Set(source.match(/[\p{L}\p{N}_-]+/gu) ?? [])
  for (const group of coalesceFlowchartLines(source.split(/\r?\n/))) {
    for (const statement of flowchartStatementSpans(group.text)) {
      let text = statement.text.trim()
      if (!text || text.startsWith('%%')) continue
      if (first) {
        const header = text.match(/^agentflow-beta(?:\s+(LR|RL|TB|TD|BT))?\s*$/i)
        if (!header) throw new Error('Expected agentflow-beta and a supported direction')
        grammar.push(`flowchart ${header[1] ?? 'TB'}`); first = false; continue
      }
      const at = flowchartGroupPosition(group, statement.start), end = flowchartGroupPosition(group, statement.start + statement.text.length)
      const map = (id: string, type: AgentflowMapping['type']): void => { mappings.push({ id, type, line: at.line + 1, col: at.col + 1, endLine: end.line + 1, endCol: end.col + 1 }) }
      const scan = scanFlowchart(text)
      const blocks = scan.regions.filter(region => region.kind === 'metadata' && region.parent === -1)
      for (const block of [...blocks].reverse()) {
        if (!block.closed) throw new Error('Unclosed AgentFlow metadata block')
        const prefix = text.slice(0, block.start).trimEnd()
        const id = prefix.match(/^(?:flow\s+|connector\s+)?([\p{L}\p{N}_.:-]+)/u)?.[1]
        if (!id || /-->|-\.-|--x/.test(prefix)) throw new Error('AgentFlow inline metadata needs one declared node, connector or flow')
        const parsed = readMetadataBlock(text, text.indexOf('{', block.start), 'flowchart')
        if (!parsed.ok) throw new Error(`AgentFlow metadata for ${id}: ${parsed.message}`)
        metadata.set(id, { ...metadata.get(id), ...agentflowMetadata(Object.fromEntries(parsed.entries)) })
        if (prefix === id) {
          map(id, 'attachment')
          if (!attachmentScopes.has(id)) attachmentScopes.set(id, frames.at(-1)?.id)
        }
        text = text.slice(0, block.start) + text.slice(block.end)
      }
      if (/^global\s*$/i.test(text)) {
        let id = `__agentflow_global_${synthetic++}`
        while (authoredIds.has(id)) id += '_'
        globalScopes.add(id); frames.push({ global: true, id }); grammar.push(`subgraph ${id}`); continue
      }
      if (/^end\s*$/i.test(text)) {
        if (!frames.pop()) throw new Error('AgentFlow end has no open flow or global block')
        grammar.push('end'); continue
      }
      const flow = text.match(/^flow\s+([\p{L}\p{N}_.:-]+)(.*)$/u)
      if (flow) { frames.push({ global: false, id: flow[1]! }); map(flow[1]!, 'flow'); grammar.push(`subgraph ${flow[1]}${flow[2]}`); continue }
      if (/^(?:subgraph|global|flow)\b/i.test(text)) throw new Error('Unsupported AgentFlow container declaration')
      const connector = text.match(/^connector\s+([\p{L}\p{N}_.:-]+)(.*)$/u)
      if (connector) { connectors.add(connector[1]!); globals.add(connector[1]!); map(connector[1]!, 'connector'); text = `${connector[1]}${connector[2]}` }
      else if (!blocks.length || !mappings.some(mapping => mapping.line === at.line + 1 && mapping.type === 'attachment')) {
        const id = text.match(/^([\p{L}\p{N}_.:-]+)/u)?.[1]
        if (id) {
          const edge = /-->|-\.-|--x/.test(text)
          const edgeId = text.match(/\s([\p{L}\p{N}_.:-]+)@(?=[-=.ox<>])/u)?.[1]
          map(edgeId ?? id, edge ? 'edge' : 'vertex')
        }
      }
      // An attachment does not redeclare its target or move it into a flow.
      if (blocks.length && /^[\p{L}\p{N}_.:-]+\s*$/u.test(text) && mappings.at(-1)?.type === 'attachment') continue
      grammar.push(text)
    }
  }
  if (frames.length) throw new Error('AgentFlow container is missing end')
  if (first) throw new Error('Empty AgentFlow diagram')
  const topology = grammar.join('\n')
  if (containsFlowchartOpaqueSyntax(topology)) throw new Error('AgentFlow contains source-preserved graph constructs')
  const graph = parseMermaid(topology)
  const allGroups = new Map<string, MermaidSubgraph>()
  const collect = (group: MermaidSubgraph): void => { allGroups.set(group.id, group); group.children.forEach(collect) }
  graph.subgraphs.forEach(collect)
  for (const [id] of metadata) if (!graph.nodes.has(id) && !allGroups.has(id) && !graph.edges.some(edge => edge.id === id)) {
    graph.nodes.set(id, { id, label: id, shape: 'rectangle' })
    const scope = attachmentScopes.get(id)
    if (scope) allGroups.get(scope)?.nodeIds.push(id)
  }
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
    roleMap.set(id, connectors.has(id) ? 'connector' : agentflowRole(data?.shape ?? node.shape))
    if (data?.label !== undefined) node.label = String(data.label)
  }
  assertMermaidGraphWork(graph)
  return { kind: 'agentflow', graph, metadata, roles: roleMap, connectors, globals, mappings }
}
