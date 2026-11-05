import { expect, test } from 'bun:test'
import { decodeHTML } from 'entities'
import { mutateAgentflow, parseAgentflowBody } from '../agent/agentflow-body.ts'
import { parseRegisteredMermaid, renderMermaidASCII, serializeMermaid } from '../agent/core.ts'
import { parseAgentflow } from '../agentflow/parser.ts'
import { projectAgentflowGraph } from '../agentflow/projection.ts'
import { renderAgentflow } from '../agentflow/source.ts'
import { renderMermaidASCIIWithReceipt } from '../ascii/index.ts'
import { terminalDocumentOf } from '../ascii/terminal-document.ts'
import { renderMermaidSVG } from '../index.ts'
import { startUpstreamMermaid } from './helpers/upstream-mermaid.ts'

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
  expect([...body.roles]).toEqual([
    ['llm', 'connector'],
    ['guide', 'refdoc'],
    ['brief', 'input'],
    ['write', 'tool'],
    ['publish', 'action'],
  ])
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

test('global declarations after a flow release every referenced node without reading labels as identities', () => {
  const body = parseAgentflow(`agentflow-beta
flow pipeline[Pipeline]
  A[Alpha] --> B[Beta]
  C["A --> B"]
end
global
  A --> B
end`)
  expect([...body.globals].sort()).toEqual(['A', 'B'])
  expect(body.graph.subgraphs[0]!.nodeIds).toEqual(['C'])
  const again = parseAgentflow(renderAgentflow(body))
  expect([...again.globals].sort()).toEqual(['A', 'B'])
  expect(again.graph.subgraphs[0]!.nodeIds).toEqual(['C'])
})

test('AgentFlow empty and comma-terminated metadata preserve YAML scalars and nested sequences', () => {
  for (const blank of ['{}', '{\n}', '{\n\n}']) {
    const body = parseAgentflow(`agentflow-beta\nA[Alpha]@${blank}`)
    expect(body.graph.nodes.get('A')!.label).toBe('Alpha')
  }
  const body = parseAgentflow(`agentflow-beta
A[Alpha]@{
  tools: ["read",
    "write"],
  note: 'first,
    second',
  instruction: |
    Do a thing,
    then stop
  protocol: "mcp", # an ordinary YAML comment
}`)
  expect(body.metadata.get('A')).toEqual({ tools: ['read', 'write'], note: 'first, second', instruction: 'Do a thing,\nthen stop\n', protocol: 'mcp' })
  expect(parseAgentflow(renderAgentflow(body)).metadata).toEqual(body.metadata)
})

test('metadata labels replace retained prepared text, and framed rectangle aliases retain the tool role', () => {
  const source = 'agentflow-beta\nA[Old caption]@{ label: "New caption", shape: framed-rectangle }'
  const body = parseAgentflow(source)
  expect(body.roles.get('A')).toBe('tool')
  expect(body.graph.nodes.get('A')!.labelContent!.value).toBe('New caption')
  const svg = renderMermaidSVG(source)
  expect(svg).toContain('New caption')
  expect(svg).not.toContain('Old caption')
})

test('unknown or nonlowercase shape metadata refuses typed interpretation while retaining exact source', () => {
  for (const shape of ['Rounded', 'missing-shape', 'connector', 123]) {
    const source = `agentflow-beta\nA[Alpha]@{ shape: ${JSON.stringify(shape)} }`
    expect(() => parseAgentflow(source)).toThrow('No such shape')
    expect(parseAgentflowBody(source)).toEqual({ ok: true, value: { kind: 'opaque', family: 'agentflow', source } })
  }
  const original = parseAgentflow('agentflow-beta\nA[Alpha]')
  expect(mutateAgentflow(original, { kind: 'set_metadata', target: 'A', metadata: { shape: 'Rounded' } }).ok).toBe(false)
  expect(original.metadata.size).toBe(0)
})

test('known out-of-catalogue shape metadata remains available with the domain default role', () => {
  const body = parseAgentflow('agentflow-beta\nA[Alpha]@{ shape: icon, icon: "fa:bell" }')
  expect(body.metadata.get('A')).toEqual({ shape: 'icon', icon: 'fa:bell' })
  expect(body.roles.get('A')).toBe('task')
  expect(parseAgentflow(renderAgentflow(body)).metadata).toEqual(body.metadata)
})

test('full-line comments cannot introduce semicolon statements while quoted percent labels stay literal', () => {
  const source = 'agentflow-beta TB\nflow team[Team]\nA[First]@{shape: task}\nB[Second]@{shape: tool}\nA --> B\nend'
  const commented = '%%a\n%%;phantom\n' + source.replace('A --> B', '  %%;second-phantom\nA --> B')
  const original = parseAgentflow(source),
    parsed = parseAgentflow(commented)
  expect({ ...parsed, mappings: undefined }).toEqual({ ...original, mappings: undefined })
  expect(parsed.graph.nodes.has('phantom')).toBe(false)
  const literal = parseAgentflow('agentflow-beta\nA["First\n%%; still a label\nLast"]')
  expect(literal.graph.nodes.get('A')?.label).toContain('%%; still a label')
})

test('AgentFlow retains percent-pair label text while exporting the three pinned comment-spec witnesses portably', async () => {
  const upstream = startUpstreamMermaid()
  const logicalText = (value: string) => decodeHTML(value.replace(/ﬂ°°(\d+)¶ß/g, '&#$1;').replace(/<br\s*\/?\s*>/gi, '\n'))
  try {
    // Mermaid12.2 agentflow-comments.spec.ts's three unquoted label states.
    for (const [statement, label] of [
      ['a[Plain %% not part of the label\nlabel]', 'Plain %% not part of the label\nlabel'],
      ['a(-ellipse %% not part of the label\nlabel-)', 'ellipse %% not part of the label\nlabel'],
      ['a[/trap %% not part of the label\nlabel/]', 'trap %% not part of the label\nlabel'],
    ]) {
      const source = `agentflow-beta TB\n  ${statement}\n  b --> a`,
        parsed = parseRegisteredMermaid(source)
      if (!parsed.ok || parsed.value.body.kind !== 'agentflow') throw Error('Expected native AgentFlow')
      expect(parsed.value.body.graph.nodes.get('a')!.label).toBe(label!)
      const originalControl = await upstream.parse(source)
      if (!originalControl.ok || !originalControl.flowchart) throw Error('Pinned Mermaid must accept the original witness')
      expect(logicalText(originalControl.flowchart.vertices.find(node => node.id === 'a')!.text)).not.toContain('%%')
      const written = serializeMermaid(parsed.value),
        control = await upstream.parse(written)
      if (!control.ok || !control.flowchart) throw Error(`Pinned Mermaid rejects AgentFlow export: ${JSON.stringify(control)}`)
      expect(logicalText(control.flowchart.vertices.find(node => node.id === 'a')!.text)).toBe(label!)
      const again = parseRegisteredMermaid(written)
      if (!again.ok || again.value.body.kind !== 'agentflow') throw Error('Expected native AgentFlow export readback')
      expect(again.value.body.graph.nodes.get('a')!.label).toBe(label!)
      expect(renderMermaidSVG(parsed.value)).toBe(renderMermaidSVG(written))
      expect(renderMermaidASCII(parsed.value)).toBe(renderMermaidASCII(source))
      expect(renderMermaidASCII(again.value)).toBe(renderMermaidASCII(written))
      expect(again.value.body.graph.edges.map(edge => [edge.source, edge.target, edge.style, edge.hasArrowStart, edge.hasArrowEnd])).toEqual(parsed.value.body.graph.edges.map(edge => [edge.source, edge.target, edge.style, edge.hasArrowStart, edge.hasArrowEnd]))
      expect(renderMermaidASCII(written)).toContain('%%')
    }
  } finally {
    upstream.close()
  }
})
