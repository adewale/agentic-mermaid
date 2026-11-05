import { renderFlowchart } from '../agent/flowchart-body.ts'
import { quoteMetadataString } from '../shared/metadata-yaml.ts'
import type { AgentflowBody } from './types.ts'

function metadataLines(value: Record<string, unknown>, indent = '  '): string[] {
  const scalar = (item: unknown): string => typeof item === 'string' ? quoteMetadataString(item) : JSON.stringify(item)
  return Object.entries(value).flatMap(([key, item]) => {
    const name = /^[A-Za-z_]\w*$/.test(key) ? key : quoteMetadataString(key)
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      if (!Object.keys(item).length) throw new Error('An empty nested metadata mapping has no portable AgentFlow spelling')
      return [`${indent}${name}:`, ...metadataLines(item as Record<string, unknown>, indent + '  ')]
    }
    if (Array.isArray(item)) {
      if (item.some(child => child && typeof child === 'object')) throw new Error('Nested collection metadata cannot be written portably by the AgentFlow metadata lexer')
      return [`${indent}${name}: [${item.map(scalar).join(', ')}]`]
    }
    return [`${indent}${name}: ${scalar(item)}`]
  })
}

export function renderAgentflow(body: AgentflowBody): string {
  const graph = structuredClone(body.graph)
  const declaration = (id: string): string[] => {
    const node = graph.nodes.get(id)
    if (!node) return []
    const lines = renderFlowchart({ ...graph, nodes: new Map([[id, node]]), edges: [], subgraphs: [], classDefs: new Map(), classAssignments: new Map(), nodeStyles: new Map(), linkStyles: new Map() }, 'flowchart').trimEnd().split('\n').slice(1)
    graph.nodes.delete(id)
    return lines
  }
  const connectors = [...body.connectors].flatMap(id => declaration(id).map(line => `  connector ${line.trimStart()}`))
  const globals = [...body.globals].filter(id => !body.connectors.has(id)).flatMap(id => declaration(id))
  const source = renderFlowchart(graph, 'flowchart').trimEnd().split('\n').slice(1).map(line => line.replace(/^(\s*)subgraph\b/, '$1flow'))
  const metadata = [...body.metadata].flatMap(([id, value]) => Object.keys(value).length ? [`  ${id}@{`, ...metadataLines(value, '    '), '  }'] : [])
  return [`agentflow-beta ${graph.direction}`, ...connectors, ...(globals.length ? ['  global', ...globals.map(line => `  ${line}`), '  end'] : []), ...source, ...metadata].join('\n') + '\n'
}
