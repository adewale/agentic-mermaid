import { renderFlowchart } from '../agent/flowchart-body.ts'
import { scanFlowchart } from '../flowchart-lexer.ts'
import { quoteMetadataString } from '../shared/metadata-yaml.ts'
import type { AgentflowBody } from './types.ts'

function metadataLines(value: Record<string, unknown>, indent = '  '): string[] {
  const scalar = (item: unknown): string => (typeof item === 'string' ? quoteMetadataString(item) : JSON.stringify(item))
  const field = (prefix: string, item: unknown, padding: string): string[] => {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      if (!Object.keys(item).length) throw new Error('An empty nested metadata mapping has no portable AgentFlow spelling')
      return [`${padding}${prefix}`, ...metadataLines(item as Record<string, unknown>, padding + '  ')]
    }
    if (Array.isArray(item)) {
      if (item.some(child => child && typeof child === 'object')) return [`${padding}${prefix}`, ...item.flatMap(child => field('-', child, padding + '  '))]
      return [`${padding}${prefix} [${item.map(scalar).join(', ')}]`]
    }
    return [`${padding}${prefix} ${scalar(item)}`]
  }
  return Object.entries(value).flatMap(([key, item]) => field(`${/^[A-Za-z_]\w*$/.test(key) ? key : quoteMetadataString(key)}:`, item, indent))
}

/** AgentFlow's lexer treats percent pairs inside bare shape text as
 * comments. Shield only classified label fields, leaving identities, styles
 * and metadata in their own grammar. The shared label writer already owns
 * formatting and entity-looking literal text. */
function protectLabelComments(source: string): string {
  if (!source.includes('%')) return source
  return source
    .split('\n')
    .map(line => {
      const fields = scanFlowchart(line).regions.filter(region => region.parent === -1 && ['shape', 'pipe', 'edge-text'].includes(region.kind))
      let cursor = 0,
        written = ''
      for (const field of fields) {
        written += line.slice(cursor, field.contentStart) + line.slice(field.contentStart, field.contentEnd).replace(/%/g, '#37;')
        cursor = field.contentEnd
      }
      return written + line.slice(cursor)
    })
    .join('\n')
}

export function renderAgentflow(body: AgentflowBody): string {
  const graph = structuredClone(body.graph)
  const declaration = (id: string): string[] => {
    const node = graph.nodes.get(id)
    if (!node) return []
    const lines = protectLabelComments(renderFlowchart({ ...graph, nodes: new Map([[id, node]]), edges: [], subgraphs: [], classDefs: new Map(), classAssignments: new Map(), nodeStyles: new Map(), linkStyles: new Map() }, 'flowchart'))
      .trimEnd()
      .split('\n')
      .slice(1)
    graph.nodes.delete(id)
    return lines
  }
  const connectors = [...body.connectors].flatMap(id => declaration(id).map(line => `  connector ${line.trimStart()}`))
  const globals = [...body.globals].filter(id => !body.connectors.has(id)).flatMap(id => declaration(id))
  const source = protectLabelComments(renderFlowchart(graph, 'flowchart'))
    .trimEnd()
    .split('\n')
    .slice(1)
    .map(line => line.replace(/^(\s*)subgraph\b/, '$1flow'))
  const metadata = [...body.metadata].flatMap(([id, value]) => (Object.keys(value).length ? [`  ${id}@{`, ...metadataLines(value, '    '), '  }'] : []))
  return [`agentflow-beta ${graph.direction}`, ...connectors, ...(globals.length ? ['  global', ...globals.map(line => `  ${line}`), '  end'] : []), ...source, ...metadata].join('\n') + '\n'
}
