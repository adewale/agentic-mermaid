import { expect, test } from 'bun:test'
import { parseAgentflow } from '../agentflow/parser.ts'
import { renderAgentflow } from '../agentflow/source.ts'
import { projectAgentflowGraph } from '../agentflow/projection.ts'
import { mutateAgentflow, parseAgentflowBody } from '../agent/agentflow-body.ts'
import { renderMermaidSVG } from '../index.ts'
import { renderMermaidASCIIWithReceipt } from '../ascii/index.ts'
import { terminalDocumentOf } from '../ascii/terminal-document.ts'

const source = `agentflow-beta TB
connector llm[LLM API]@{ protocol: http }
global
  guide[Brand guide]@{ shape: refdoc }
end
flow team[Publishing]
  flow writer[Writer]@{ model: assistant }
    brief[Brief]@{ shape: input }
    write[Write copy]@{ shape: tool, connectorRef: llm.chat }
    brief --> write
    write -.- guide
  end
  publish[Publish]@{ shape: action }
  write transfer@--> publish
end
transfer@{ instruction: Review before publishing }
writer@{
  instruction: "Follow the brand guide"
  custom:
    retained: true
    constructor: stripped
}`

test('AgentFlow preserves roles, connector and global ownership, arbitrary metadata, and attachment mappings', () => {
  const body = parseAgentflow(source)
  expect([...body.roles]).toEqual([['llm', 'connector'], ['guide', 'refdoc'], ['brief', 'input'], ['write', 'tool'], ['publish', 'action']])
  expect(body.connectors.has('llm')).toBe(true)
  expect(body.globals.has('guide')).toBe(true)
  expect(body.graph.subgraphs[0]?.children[0]?.nodeIds).toEqual(['brief', 'write'])
  expect(body.metadata.get('writer')).toMatchObject({ model: 'assistant', instruction: 'Follow the brand guide', custom: { retained: true } })
  expect(body.metadata.get('writer')?.custom).toEqual({ retained: true })
  expect(body.mappings.filter(mapping => mapping.id === 'writer').map(mapping => mapping.type)).toEqual(['flow', 'attachment'])
  expect(body.mappings.filter(mapping => mapping.id === 'transfer').map(mapping => mapping.type)).toEqual(['edge', 'attachment'])
  const reparsed = parseAgentflow(renderAgentflow(body))
  expect(reparsed.graph).toEqual(body.graph)
  expect(reparsed.metadata).toEqual(body.metadata)
  expect(reparsed.roles).toEqual(body.roles)
})

test('AgentFlow typed metadata and identity edits keep family-owned records and portable source in agreement', () => {
  const original = parseAgentflow(source)
  const renamed = mutateAgentflow(original, { kind: 'rename_node', from: 'write', to: 'draft' })
  if (!renamed.ok) throw new Error(renamed.error.message)
  expect(renamed.value.roles.get('draft')).toBe('tool')
  expect(renamed.value.metadata.get('draft')?.connectorRef).toBe('llm.chat')
  expect(renamed.value.graph.edges[2]).toMatchObject({ source: 'draft', target: 'publish', id: 'transfer' })
  const edited = mutateAgentflow(renamed.value, { kind: 'set_metadata', target: 'draft', metadata: { shape: 'tool', instruction: 'Use cited sources', unknown: ['one', 'two'] } })
  if (!edited.ok) throw new Error(edited.error.message)
  expect(parseAgentflow(renderAgentflow(edited.value)).metadata.get('draft')).toEqual({ shape: 'tool', instruction: 'Use cited sources', unknown: ['one', 'two'] })
  expect(original.graph.nodes.has('write')).toBe(true)
  expect(original.metadata.get('write')?.instruction).toBeUndefined()
  const connector = mutateAgentflow(original, { kind: 'rename_node', from: 'llm', to: 'api' })
  if (!connector.ok) throw new Error(connector.error.message)
  expect(connector.value.connectors.has('api')).toBe(true)
  expect(connector.value.metadata.get('write')?.connectorRef).toBe('api.chat')
})

test('collapsed flows retarget cross-boundary edges while the editable model keeps their children', () => {
  const body = parseAgentflow(`${source}\nwriter@{ view: collapsed }`)
  const projected = projectAgentflowGraph(body)
  expect(body.graph.nodes.has('write')).toBe(true)
  expect(projected.nodes.has('write')).toBe(false)
  expect(projected.nodes.has('writer')).toBe(true)
  expect(projected.subgraphs[0]?.nodeIds).toContain('writer')
  expect(projected.edges.find(edge => edge.id === 'transfer')).toMatchObject({ source: 'writer', target: 'publish' })
})

test('standalone metadata can define a scoped task; malformed and unsafe constructs retain source', () => {
  const body = parseAgentflow('agentflow-beta LR\nflow team\nworker@{ shape: tool, label: "Lookup" }\nend')
  expect(body.graph.nodes.get('worker')?.label).toBe('Lookup')
  expect(body.graph.subgraphs[0]?.nodeIds).toEqual(['worker'])
  for (const input of ['agentflow-beta LR\nflow team\na --> b', 'agentflow-beta LR\na --> b\nclick a callback']) {
    const parsed = parseAgentflowBody(input)
    expect(parsed.ok && parsed.value).toEqual({ kind: 'opaque', family: 'agentflow', source: input })
  }
})

test('AgentFlow native SVG and strict terminal preserve visible endpoints and nested roles', () => {
  const svg = renderMermaidSVG(source)
  expect(svg).toContain('data-id="transfer"')
  expect(svg).toContain('agentflow-tool')
  expect(svg).toContain('data-parent-id="team"')
  const result = renderMermaidASCIIWithReceipt(source, { colorMode: 'none', layoutSafety: 'strict' })
  expect(result.receipt.layoutCertification?.status).toBe('passed')
  const regions = terminalDocumentOf(result)!.regions()
  expect(regions.find(region => region.id === 'write')).toMatchObject({ kind: 'node', parentId: 'writer', projectedText: 'Write copy' })
  expect(regions.find(region => region.id === 'guide')?.parentId).toBeUndefined()
  expect(regions.find(region => region.id === 'transfer')).toMatchObject({ from: 'write', to: 'publish' })
})

test('nested metadata sequences stay native and renaming retains source order', () => {
  const input = `agentflow-beta\nA[Collect]@{ shape: tool }\nB[Publish]\nA@{\n  context:\n    -\n      name: \"First\"\n      values: [1, 2]\n    - [\"nested\", \"list\"]\n}`
  const body = parseAgentflow(input)
  expect(parseAgentflow(renderAgentflow(body)).metadata).toEqual(body.metadata)
  const edited = mutateAgentflow(body, { kind: 'rename_node', from: 'A', to: 'Collect' })
  if (!edited.ok) throw new Error(edited.error.message)
  expect([...edited.value.metadata.keys()]).toEqual(['Collect'])
  expect(edited.value.metadata.get('Collect')?.context).toEqual([{ name: 'First', values: [1, 2] }, ['nested', 'list']])
})
