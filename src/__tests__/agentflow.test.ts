import { expect, test } from 'bun:test'
import { decodeHTML } from 'entities'
import { mutateAgentflow, parseAgentflowBody } from '../agent/agentflow-body.ts'
import { parseRegisteredMermaid, renderMermaidASCII, serializeMermaid } from '../agent/core.ts'
import { agentflowMetadata, parseAgentflow } from '../agentflow/parser.ts'
import { projectAgentflowGraph } from '../agentflow/projection.ts'
import { renderAgentflow } from '../agentflow/source.ts'
import { renderMermaidASCIIWithReceipt } from '../ascii/index.ts'
import { terminalDocumentOf } from '../ascii/terminal-document.ts'
import { MermaidSyntaxError, parseAgentflowModel, renderMermaidSVG, renderMermaidSVGWithReceipt } from '../index.ts'
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

test.each(['\n', '\r\n'])('AgentFlow container mappings end at their own closing token with %j lines', newline => {
  const body = parseAgentflow([
    'agentflow-beta TB', 'flow Outer[Outer]', '  flow Inner[Inner]',
    '    a[A]', '  end', '  after[After]', 'end', 'flow Right[Right]', '  b[B]', 'end',
  ].join(newline))
  expect(body.mappings.filter(mapping => mapping.type === 'flow')).toEqual([
    { id: 'Outer', type: 'flow', line: 2, col: 1, endLine: 7, endCol: 4 },
    { id: 'Inner', type: 'flow', line: 3, col: 3, endLine: 5, endCol: 6 },
    { id: 'Right', type: 'flow', line: 8, col: 1, endLine: 10, endCol: 4 },
  ])
  expect(body.graph.subgraphs.map(group => [group.id, group.children.map(child => child.id)])).toEqual([['Outer', ['Inner']], ['Right', []]])
})

test.each([
  ['a --> b', ['a', 'b'], ['a', 'b'], 1],
  ['a[A] --> b[B] --> c[C]', ['a', 'b', 'c'], ['a[A]', 'b[B]', 'c[C]'], 2],
  ['a["x --> y @{ hidden }"] --> b[Done]', ['a', 'b'], ['a["x --> y @{ hidden }"]', 'b[Done]'], 1],
  ['a x-- "pretend & d" --x b', ['a', 'b'], ['a', 'b'], 1],
  ['a & b ==> c & d', ['a', 'b', 'c', 'd'], ['a', 'b', 'c', 'd'], 1],
  ['a e1@--> b[B]@{ instruction: "x --> y" } --> c', ['a', 'b', 'c'], ['a', 'b[B]@{ instruction: "x --> y" }', 'c'], 2],
  ['a:::hot --> b', ['a', 'b'], ['a:::hot', 'b'], 1],
  ['a[A]; b[B] --> c', ['a', 'b', 'c'], ['a[A]', 'b[B]', 'c'], 1],
  [`a["${'W'.repeat(1100)}"] --> b`, ['a', 'b'], [`a["${'W'.repeat(1100)}"]`, 'b'], 1],
] as const)('AgentFlow retains each actual vertex occurrence independently of its links: %s', (statement, ids, texts, edges) => {
  const body = parseAgentflow(`agentflow-beta TB\n  ${statement}`)
  const vertices = body.mappings.filter(mapping => mapping.type === 'vertex')
  expect(vertices.map(mapping => mapping.id)).toEqual([...ids])
  expect(vertices.map(mapping => statement.slice(mapping.col - 3, mapping.endCol - 3))).toEqual([...texts])
  expect(vertices.every(mapping => mapping.line === 2 && mapping.endLine === 2)).toBe(true)
  expect([...body.graph.nodes.keys()]).toEqual([...ids])
  expect(body.mappings.filter(mapping => mapping.type === 'edge')).toHaveLength(edges)
})

test('AgentFlow attachments and paint directives cannot masquerade as vertex declarations', () => {
  const body = parseAgentflow('agentflow-beta\na[A] --> b[B]\na@{ instruction: "c --> d" }\nstyle a fill:red\nclassDef hot color:blue\nclass a hot')
  expect(body.mappings.filter(mapping => mapping.type === 'vertex').map(mapping => mapping.id)).toEqual(['a', 'b'])
  expect(body.mappings.filter(mapping => mapping.type === 'attachment')).toEqual([{ id: 'a', type: 'attachment', line: 3, col: 1, endLine: 3, endCol: 29 }])
  expect([...body.graph.nodes.keys()]).toEqual(['a', 'b'])
  expect(body.graph.nodeStyles.get('a')).toEqual({ fill: 'red' })
})

test.each([
  [['agentflow-beta TB', 'a[Prior]@{ shape: task }', '', '  a[Alpha]@{ x: *, }'], 4, '*'],
  [['agentflow-beta TB', 'flow Outer', '  a[First]', '', '  b[Second]@{', '\tshape: rounded', '  }', 'end'], 6, '\t'],
  [['agentflow-beta TB', '  b[Beta]@{ x: *,', '    y: 1 }'], 2, '*'],
  [['agentflow-beta TB', '  节点[🙂Alpha]@{ label: "#quot;A#quot;", x: *, }'], 2, '*'],
  [['agentflow-beta TB', '  a[Alpha]@{ shape: Rounded }', 'a@{ instruction: Later }'], 2, '@{'],
] as const)('AgentFlow metadata refusals point to their physical source: %j', (lines, line, marker) => {
  for (const newline of ['\n', '\r\n']) {
    let failure: unknown
    try { parseAgentflow(lines.join(newline)) } catch (error) { failure = error }
    expect(failure).toBeInstanceOf(MermaidSyntaxError)
    expect(failure).toMatchObject({ diagramType: 'agentflow', line, column: lines[line - 1]!.indexOf(marker) + 1 })
  }
})

test('strict AgentFlow errors retain their class and source coordinates through wrappers', () => {
  const source = 'agentflow-beta TB\n\n  a[Alpha]@{ x: *, }'
  const wrapper = '---\ntitle: Wrapped\n---\n%%{init: {"theme":"dark"}}%%\n'
  let failure: unknown
  try { parseAgentflowModel(wrapper + source) } catch (error) { failure = error }
  expect(failure).toBeInstanceOf(MermaidSyntaxError)
  expect(failure).toMatchObject({ code: 'MERMAID_SYNTAX_ERROR', name: 'MermaidSyntaxError', diagramType: 'agentflow', line: 7, column: 17 })
  // A superseded invalid shape is not an invalid final model, and connector
  // metadata does not inherit the task-role shape policy.
  expect(parseAgentflow('agentflow-beta\na@{ shape: Rounded }\na@{ shape: tool }').roles.get('a')).toBe('tool')
  expect(parseAgentflow('agentflow-beta\na@{ shape: Rounded }\nconnector a[API]').roles.get('a')).toBe('connector')
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

test.each<{ name: string; prefix: string; between: string; suffix: string; parents: Record<string, string | null> }>([
  { name: 'siblings', prefix: '', between: '', suffix: '', parents: { A: null, B: null } },
  { name: 'nested siblings', prefix: 'flow Outer\n', between: '', suffix: 'end\n', parents: { Outer: null, A: 'Outer', B: 'Outer' } },
  { name: 'separate nested scopes', prefix: 'flow Left\n', between: 'end\nflow Right\n', suffix: 'end\n', parents: { Left: null, A: 'Left', Right: null, B: 'Right' } },
  { name: 'flow escaping a nested global block', prefix: 'flow Left\nglobal\n', between: 'guide["B is a label"]\nend\nend\n', suffix: '', parents: { Left: null, A: null, B: null } },
])('AgentFlow $name retain declared ownership through mutual flow references and collapsed display', ({ prefix, between, suffix, parents }) => {
  const source = `agentflow-beta TB\n${prefix}flow A["Flow A"]\n a1["Task A1"]\n a1 --> B\nend\n${between}flow B["Flow B"]\n b1["Task B1"]\n b1 --> A\nend\n${suffix}`
  const ownership = (groups: ReturnType<typeof parseAgentflow>['graph']['subgraphs']) => {
    const parents: Record<string, string | null> = {}
    const visit = (items: typeof groups, parent: string | null): void => {
      for (const group of items) { parents[group.id] = parent; visit(group.children, group.id) }
    }
    visit(groups, null)
    return parents
  }
  for (const collapsed of [false, true]) {
    const body = parseAgentflow(source + (collapsed ? 'A@{ view: collapsed }\n' : ''))
    expect(ownership(body.graph.subgraphs)).toEqual(parents)
    expect(body.graph.edges.map(edge => [edge.source, edge.target])).toEqual([['a1', 'B'], ['b1', 'A']])
    expect(body.graph.nodes.has('A')).toBe(false)
    expect(body.graph.nodes.has('B')).toBe(false)
    const reloaded = parseAgentflow(renderAgentflow(body))
    expect(ownership(reloaded.graph.subgraphs)).toEqual(parents)
    expect(reloaded.graph).toEqual(body.graph)
    const projected = projectAgentflowGraph(body)
    if (collapsed) {
      const { A: _collapsedParent, ...visibleParents } = parents
      expect(ownership(projected.subgraphs)).toEqual(visibleParents)
      expect(projected.nodes.has('a1')).toBe(false)
      expect(projected.nodes.has('A')).toBe(true)
      expect(projected.edges.map(edge => [edge.source, edge.target])).toEqual([['A', 'B'], ['b1', 'A']])
    } else expect(ownership(projected.subgraphs)).toEqual(parents)
    // Projection must never change the editable source's container authority.
    expect(ownership(body.graph.subgraphs)).toEqual(parents)
  }
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

test('strict AgentFlow input refusals are syntax errors while editable parsing preserves their source', () => {
  for (const [input, message] of [
    ['agentflow-beta LR\nflow team\na --> b', 'AgentFlow container is missing end'],
    ['agentflow-beta LR\na@{ shape: TOOL }', 'No such shape: "TOOL". AgentFlow shapes must be known lowercase names'],
    ['agentflow-beta LR\na@{ instruction: broken', 'Unclosed AgentFlow metadata block'],
  ] as const) {
    let failure: unknown
    try { parseAgentflowModel(input) } catch (error) { failure = error }
    expect(failure).toBeInstanceOf(MermaidSyntaxError)
    expect(failure).toMatchObject({ name: 'MermaidSyntaxError', code: 'MERMAID_SYNTAX_ERROR', diagramType: 'agentflow', message })
    expect(parseAgentflowBody(input)).toEqual({ ok: true, value: { kind: 'opaque', family: 'agentflow', source: input } })
    const registered = parseRegisteredMermaid(input)
    expect(registered.ok && registered.value.body).toEqual({ kind: 'opaque', family: 'agentflow', source: input })
  }
})

test('AgentFlow metadata host nesting refusal remains distinct from authored syntax errors', () => {
  let value: unknown = 'leaf'
  for (let depth = 0; depth < 65; depth++) value = { nested: value }
  let failure: unknown
  try { agentflowMetadata(value) } catch (error) { failure = error }
  expect(failure).toBeInstanceOf(Error)
  expect(failure).not.toBeInstanceOf(MermaidSyntaxError)
  expect(failure).toMatchObject({ message: 'AgentFlow metadata nesting exceeds the host limit' })
})

test('AgentFlow graph-only consumers omit occurrence records without changing complete output receipts', () => {
  const complete = parseAgentflow(source)
  const { mappings, ...domain } = complete
  const { mappings: omitted, ...renderDomain } = parseAgentflow(source, false)
  expect(mappings.length).toBeGreaterThan(0)
  expect(omitted).toEqual([])
  expect(renderDomain).toEqual(domain)
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
  const direct = renderMermaidSVGWithReceipt(source)
  const owned = renderMermaidSVGWithReceipt(parsed.value)
  expect(direct.svg).toBe(owned.svg)
  expect(JSON.parse(JSON.stringify(direct.receipt))).toEqual(JSON.parse(JSON.stringify(owned.receipt)))
  const terminal = renderMermaidASCIIWithReceipt(source, { colorMode: 'none', layoutSafety: 'strict' })
  const ownedTerminal = renderMermaidASCIIWithReceipt(parsed.value, { colorMode: 'none', layoutSafety: 'strict' })
  expect(terminal.text).toBe(ownedTerminal.text)
  expect(JSON.parse(JSON.stringify(terminal.receipt))).toEqual(JSON.parse(JSON.stringify(ownedTerminal.receipt)))
  for (const invalid of ['agentflow-beta\na@{ x: *, }', 'agentflow-beta\na@{ shape: Rounded }']) {
    const failures = [true, false].map(collect => {
      try { parseAgentflow(invalid, collect) } catch (error) {
        if (!(error instanceof MermaidSyntaxError)) throw error
        return { name: error.name, code: error.code, message: error.message, line: error.line, column: error.column }
      }
      throw new Error('Expected the malformed source to fail')
    })
    expect(failures[0]).toEqual(failures[1])
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

test('anonymous AgentFlow containers keep empty titles, global escape and collision-safe identities through edits', async () => {
  const source = 'agentflow-beta\nglobal\n A\nend\nflow\n A --> B --> C\nend\n__agentflow_flow_1[Authored identity]'
  const upstream = startUpstreamMermaid()
  try {
    const control = await upstream.parse(source)
    if (!control.ok || !control.flowchart) throw Error('Pinned Mermaid must accept anonymous flows')
    expect(control.flowchart.subgraphs).toHaveLength(1)
    expect(control.flowchart.subgraphs[0]!.title).toBe('')
    expect(control.flowchart.subgraphs[0]!.nodes.slice().sort()).toEqual(['B', 'C'])
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok || parsed.value.body.kind !== 'agentflow') throw Error('Expected native anonymous AgentFlow')
    const body = parsed.value.body, flow = body.graph.subgraphs[0]!
    expect(flow.label).toBe('')
    expect(flow.id).not.toBe('__agentflow_flow_1')
    expect(flow.nodeIds).toEqual(['B', 'C'])
    expect(body.globals.has('A')).toBe(true)
    expect(body.mappings.find(mapping => mapping.id === flow.id)).toMatchObject({ type: 'flow', line: 5, col: 1 })
    const edited = mutateAgentflow(body, { kind: 'set_label', target: 'B', label: 'Reviewed' })
    if (!edited.ok) throw Error(edited.error.message)
    expect(edited.value.graph.subgraphs[0]!.id).toBe(flow.id)
    expect(edited.value.graph.subgraphs[0]!.label).toBe('')
    const canonical = renderAgentflow(edited.value)
    expect(parseAgentflow(canonical).graph).toEqual(edited.value.graph)
    const written = await upstream.parse(canonical)
    if (!written.ok || !written.flowchart) throw Error('Anonymous-flow export must remain valid Mermaid')
    expect(written.flowchart.subgraphs[0]).toMatchObject({ id: flow.id, title: '' })
    expect(written.flowchart.subgraphs[0]!.nodes.slice().sort()).toEqual(['B', 'C'])
    expect(renderMermaidSVG(parsed.value)).toContain(`data-id="${flow.id}"`)
  } finally { upstream.close() }
})

test('inline metadata belongs to each destination declaration without losing links, mappings or editability', async () => {
  const source = 'agentflow-beta TB\nflow pipeline[Pipeline]\n  x[Start] --> b["Beta"]@{\n    shape: tool\n    instruction: "hand off"\n  } --> c[Last]@{ shape: action }\nend'
  const upstream = startUpstreamMermaid()
  try {
    const control = await upstream.project(source, diagram => ({ vertices: [...diagram.db.getVertices()].map(([id, vertex]: [string, any]) => ({ id, text: vertex.text, metadata: vertex.metadata })), edges: diagram.db.getEdges().map((edge: any) => [edge.start, edge.end]) }))
    if (!control.ok) throw Error(`Pinned Mermaid must accept destination metadata: ${control.error}`)
    expect(control.value.vertices.find(node => node.id === 'b')?.metadata).toEqual({ shape: 'subroutine', instruction: 'hand off' })
    expect(control.value.edges).toEqual([['x', 'b'], ['b', 'c']])
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok || parsed.value.body.kind !== 'agentflow') throw Error('Expected native destination metadata')
    const body = parsed.value.body
    expect(body.metadata.get('b')).toEqual({ shape: 'tool', instruction: 'hand off' })
    expect(body.metadata.get('c')).toEqual({ shape: 'action' })
    expect([...body.metadata.keys()]).toEqual(['b', 'c'])
    expect([...body.roles]).toEqual([['x', 'task'], ['b', 'tool'], ['c', 'action']])
    expect(body.graph.edges.map(edge => [edge.source, edge.target])).toEqual([['x', 'b'], ['b', 'c']])
    expect(body.graph.subgraphs[0]!.nodeIds).toEqual(['x', 'b', 'c'])
    expect(body.mappings.find(mapping => mapping.id === 'b' && mapping.type === 'vertex')).toMatchObject({ line: 3, col: 16, endLine: 6, endCol: 4 })
    const edited = mutateAgentflow(body, { kind: 'rename_node', from: 'b', to: 'handoff' })
    if (!edited.ok) throw Error(edited.error.message)
    expect(edited.value.metadata.get('handoff')?.instruction).toBe('hand off')
    expect(edited.value.graph.edges.map(edge => [edge.source, edge.target])).toEqual([['x', 'handoff'], ['handoff', 'c']])
    const canonical = renderAgentflow(edited.value)
    expect(parseAgentflow(canonical).metadata).toEqual(edited.value.metadata)
    expect(await upstream.publicAccepts(canonical)).toBe(true)
    expect(renderMermaidSVG(parsed.value)).toContain('agentflow-tool')
    expect(renderMermaidASCII(parsed.value)).toContain('Beta')
  } finally { upstream.close() }
})
