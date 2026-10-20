import { afterAll, beforeAll, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { decodeXML } from 'entities'
import ts from 'typescript'
import fc from 'fast-check'
import { fcParameters } from '../../src/__tests__/helpers/fc-parameters.ts'
import { admitCurrentReference, currentReferencePin, startModernReference, type ReferenceReply } from './reference.ts'
import { startGrammarReference } from './grammar-reference.ts'
import type { FlowchartValidDiagram } from '../../src/agent/types.ts'
import { BUILTIN_FAMILY_METADATA } from '../../src/agent/families.ts'
import { censusDisplayText, labelCensus } from './label-census.ts'
import { officialCorpusInventory } from '../shared/official-fences.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const upstream = resolve(process.env.MERMAID_UPSTREAM_DIR ?? join(ROOT, '../mermaid'))
const referenceDir = resolve(process.env.MERMAID_REFERENCE_DIR ?? join(ROOT, '../mermaid-reference'))
const target = resolve(process.env.AM_MODERN_TARGET_DIR ?? ROOT)
const reportPath = resolve(process.env.AM_MODERN_GATE_REPORT ?? join(HERE, 'output/semantic-gate.json'))
const PIN = currentReferencePin
const am = await import(pathToFileURL(join(target, 'src/agent/core.ts')).href) as typeof import('../../src/agent/core.ts')
let oracle: ReturnType<typeof startModernReference> | undefined
let admittedReference: ReturnType<typeof admitCurrentReference> | undefined
const results: Array<{ name: string; origin: string; status: 'passed' | 'failed'; error?: string }> = []
const diagnostics: Array<{ name: string; origin: string; source: string; reference: ReferenceReply; representation?: string; verifyOk?: boolean; warnings?: string[]; rendered: boolean; error?: string }> = []

function semantic(name: string, origin: string, check: () => Promise<void>): void {
  test(name, async () => {
    try { await check(); results.push({ name, origin, status: 'passed' }) }
    catch (error) { results.push({ name, origin, status: 'failed', error: String(error) }); throw error }
  }, 30_000)
}

/** Select the actual static input of a reviewed upstream test; never eval its body. */
function specSource(file: string, title: string): string {
  const ast = ts.createSourceFile(file, readFileSync(join(upstream, file), 'utf8'), ts.ScriptTarget.Latest, true)
  let source: string | undefined
  function visit(node: ts.Node): void {
    if (source) return
    if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]) && node.arguments[0].text === title) {
      function findInput(child: ts.Node): void {
        if (source) return
        if (ts.isCallExpression(child) && child.arguments[0] && ts.isStringLiteralLike(child.arguments[0]) && /^\s*(?:flowchart|graph|stateDiagram|sequenceDiagram|gitGraph)\b/.test(child.arguments[0].text)) source = child.arguments[0].text
        if (ts.isVariableDeclaration(child) && child.initializer && ts.isStringLiteralLike(child.initializer) && /^\s*(?:flowchart|graph|stateDiagram|sequenceDiagram|gitGraph)\b/.test(child.initializer.text)) source = child.initializer.text
        ts.forEachChild(child, findInput)
      }
      ts.forEachChild(node, findInput)
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  if (!source) throw new Error(`No portable static source in ${file}: ${title}`)
  return source
}

async function accepted(source: string): Promise<Extract<ReferenceReply, { ok: true }>> {
  if (!oracle) throw new Error('Reference did not start')
  const reply = await oracle.parse(source)
  if (!reply.ok) throw new Error(`Pinned Mermaid rejects source:\n${source}\n${reply.error}`)
  return reply
}

function flow(source: string): FlowchartValidDiagram {
  const parsed = am.parseRegisteredMermaid(source)
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
  const narrowed = am.asFlowchart(parsed.value)
  if (!narrowed) throw new Error(`Expected structured flowchart, got ${parsed.value.body.kind}`)
  return narrowed
}

function svgGroups(svg: string, id: string): string[] {
  return [...svg.matchAll(/<g\b[^>]*>/g)].map(match => match[0]).filter(tag => tag.includes(`data-id="${id}"`))
}
function svgLabels(svg: string): string[] {
  return [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map(match => decodeXML(match[1]!.replace(/<[^>]*>/g, '')).trim())
}
function upstreamGroups(reply: Extract<ReferenceReply, { ok: true }>): Array<{ id: string; nodes: string[]; title: string }> {
  return reply.snapshot.data.getSubGraphs as unknown as Array<{ id: string; nodes: string[]; title: string }>
}
function upstreamClasses(reply: Extract<ReferenceReply, { ok: true }>, id: string): string[] | undefined {
  const vertices = reply.snapshot.data.getVertices as unknown as Array<[string, { classes: string[] }]>
  return vertices.find(([key]) => key === id)?.[1].classes
}

const FLOW_DB = 'packages/mermaid/src/diagrams/flowchart/flowDb.spec.ts'
semantic('Flowchart block-scalar labels from the pinned parser spec render without losing their lines', 'packages/mermaid/src/diagrams/flowchart/parser/flow-node-data.spec.js: Multi line strings should be supported', async () => {
  const source = specSource('packages/mermaid/src/diagrams/flowchart/parser/flow-node-data.spec.js', 'Multi line strings should be supported')
  const before = await accepted(source)
  const vertices = before.snapshot.data.getVertices as unknown as Array<[string, { text: string }]>
  const label = vertices.find(([id]) => id === 'A')![1].text.trimEnd()
  expect(label).toBe('This is a\nmultiline string')
  const parsed = am.parseRegisteredMermaid(source)
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
  await accepted(am.serializeMermaid(parsed.value))
  for (const output of [am.renderMermaidSVG(source), am.renderMermaidASCII(source)]) {
    for (const line of label.split('\n')) expect(output).toContain(line)
  }
})

semantic('Sequence spaced participant metadata retains the actor types through editing', 'packages/mermaid/src/diagrams/sequence/sequenceDiagram.spec.js: should parse a participant config object separated from the name by whitespace', async () => {
  const source = specSource('packages/mermaid/src/diagrams/sequence/sequenceDiagram.spec.js', 'should parse a participant config object separated from the name by whitespace')
  await accepted(source)
  const parsed = am.parseRegisteredMermaid(source)
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
  const diagram = am.asSequence(parsed.value)
  expect(diagram).not.toBeNull()
  if (!diagram) throw new Error('Expected editable participants')
  expect(diagram.body.participants).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'Gina', kind: 'database' }),
    expect.objectContaining({ id: 'Harry', kind: 'database' }),
  ]))
  const edited = am.mutate(diagram, { kind: 'set_participant_label', id: 'Harry', label: 'Orders' })
  if (!edited.ok) throw new Error(edited.error.message)
  const actors = (await accepted(am.serializeMermaid(edited.value))).snapshot.data.getActors as unknown as Array<[string, { type: string; description: string }]>
  expect(actors.find(([id]) => id === 'Harry')?.[1]).toMatchObject({ type: 'database', description: 'Orders' })
  expect(am.renderMermaidSVG(edited.value)).toContain('Orders')
})

semantic('Class punctuation and Unicode names retain their endpoints after typed edits', 'mermaid-js/mermaid#3423; pinned classDiagram.jison className/alphaNumToken grammar', async () => {
  for (const id of ['Bugs-Bunny', 'domain.Order', '注文']) {
    const source = `classDiagram\nAnimal <|-- ${id}`
    const before = await accepted(source)
    const relations = before.snapshot.data.getRelations
    const parsed = am.parseRegisteredMermaid(source)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    const diagram = am.asClass(parsed.value)
    expect(diagram).not.toBeNull()
    if (!diagram) throw new Error('Expected editable Class endpoints')
    expect(diagram.body.relations).toEqual([expect.objectContaining({ from: 'Animal', to: id })])
    const edited = am.mutate(diagram, { kind: 'add_member', class: id, text: '+String name' })
    if (!edited.ok) throw new Error(edited.error.message)
    expect((await accepted(am.serializeMermaid(edited.value))).snapshot.data.getRelations).toEqual(relations)
    expect(am.renderMermaidSVG(edited.value)).toContain(`data-id="${id}"`)
  }
})

semantic('Architecture compact edges retain sides and boundary identity', 'packages/parser/src/language/architecture/architecture.langium Edge grammar; Pele architecture parser', async () => {
  const source = 'architecture-beta\ngroup cloud(cloud)[Cloud]\nservice api(server)[API] in cloud\nservice db(database)[DB]\napi{group}:R-->L:db'
  const expected = (await accepted(source)).snapshot.data.getEdges
  const parsed = am.parseRegisteredMermaid(source)
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
  expect(am.asArchitecture(parsed.value)).not.toBeNull()
  expect((await accepted(am.serializeMermaid(parsed.value))).snapshot.data.getEdges).toEqual(expected)
  expect(am.renderMermaidSVG(source)).toContain('API')
  expect(am.renderMermaidASCII(source)).toContain('DB')
})

semantic('GitGraph can pick the same merge relative to different parents', 'packages/mermaid/src/diagrams/git/gitGraph.spec.ts: should support cherry-picking of merge commits with empty tag', async () => {
  const source = specSource('packages/mermaid/src/diagrams/git/gitGraph.spec.ts', 'should support cherry-picking of merge commits with empty tag')
  await accepted(source)
  const parsed = am.parseRegisteredMermaid(source)
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
  const diagram = am.asGitGraph(parsed.value)
  expect(diagram).not.toBeNull()
  if (!diagram) throw new Error('Expected editable GitGraph')
  const picked = diagram.body.commits.filter(commit => commit.source === 'cherry-pick')
  expect(picked).toHaveLength(2)
  expect(picked.map(commit => commit.cherryParent)).toEqual(['ZERO', 'B'])
  await accepted(am.serializeMermaid(diagram))
  expect(am.renderMermaidSVG(diagram)).toContain('type-cherry_pick')
})

semantic('Ellipse vertices retain their shape and text after an unrelated edit', 'packages/mermaid/src/diagrams/flowchart/parser/flow-text.spec.js: should handle text in ellipse vertices', async () => {
  const source = specSource('packages/mermaid/src/diagrams/flowchart/parser/flow-text.spec.js', 'should handle text in ellipse vertices')
  const expected = (await accepted(source)).snapshot.data.getVertices
  const diagram = flow(source)
  expect(diagram.body.graph.nodes.get('A')).toMatchObject({ shape: 'ellipse', label: 'this is an ellipse' })
  const edited = am.mutate(diagram, { kind: 'rename_node', from: 'B', to: 'Completed' })
  expect(edited.ok).toBe(true)
  if (!edited.ok) throw new Error(edited.error.message)
  const vertices = (await accepted(am.serializeMermaid(edited.value))).snapshot.data.getVertices as Array<[string, unknown]>
  expect(vertices.find(([id]) => id === 'A')).toEqual((expected as Array<[string, unknown]>).find(([id]) => id === 'A'))
  const reshaped = am.mutate(edited.value, { kind: 'set_shape', id: 'Completed', shape: 'ellipse' })
  expect(reshaped.ok).toBe(true)
  if (!reshaped.ok) throw new Error(reshaped.error.message)
  const authored = (await accepted(am.serializeMermaid(reshaped.value))).snapshot.data.getVertices as Array<[string, unknown]>
  expect(authored.find(([id]) => id === 'Completed')?.[1]).toMatchObject({ type: 'ellipse' })
  expect(am.renderMermaidSVG(edited.value)).toContain('<ellipse')
  expect(am.renderMermaidASCII(edited.value)).toContain('this is an ellipse')
})

semantic('Architecture literal icons retain STRING escapes and stay independent of labels', 'packages/parser/src/language/architecture/architecture.langium Service iconText=STRING; Langium STRING converter', async () => {
  for (const [token, text] of [['"TXT"', 'TXT'], ['"a\\nb"', 'a\nb'], ['"a\\\\b"', 'a\\b'], ["'it\\'s'", "it's"], ['"<b>日本</b>"', '<b>日本</b>'], ['""', ''], ['"  head\n    tail  "', '  head\n    tail  ']]) {
    const source = `architecture-beta\nservice a ${token} [API]`
    const reference = await accepted(source)
    expect(reference.snapshot.data.getServices).toEqual([expect.objectContaining({ id: 'a', iconText: text, title: 'API' })])
    const parsed = am.parseRegisteredMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    const diagram = am.asArchitecture(parsed.value)
    expect(diagram?.body.services[0]).toMatchObject({ id: 'a', iconText: text, label: 'API' })
    if (!diagram) throw new Error('Expected editable text icon')
    const edited = am.mutate(diagram, { kind: 'set_service_label', id: 'a', label: 'Updated API' })
    expect(edited.ok).toBe(true)
    if (!edited.ok) throw new Error(edited.error.message)
    expect((await accepted(am.serializeMermaid(edited.value))).snapshot.data.getServices).toEqual([expect.objectContaining({ id: 'a', iconText: text, title: 'Updated API' })])
    expect(am.renderMermaidSVG(edited.value)).toContain('architecture-icon-text')
  }
})

semantic('Sequence parallel overlays retain their distinct kind, branches and editable messages', 'packages/mermaid/src/diagrams/sequence/sequenceDiagram.spec.js: it should handle par_over statements; sequenceDiagram.jison par_sections', async () => {
  const source = specSource('packages/mermaid/src/diagrams/sequence/sequenceDiagram.spec.js', 'it should handle par_over statements')
  const originalMessages = (await accepted(source)).snapshot.data.getMessages
  const sourceParsed = am.parseRegisteredMermaid(source)
  expect(sourceParsed.ok).toBe(true)
  if (!sourceParsed.ok) throw new Error(JSON.stringify(sourceParsed.error))
  expect((await accepted(am.serializeMermaid(sourceParsed.value))).snapshot.data.getMessages).toEqual(originalMessages)
  expect(am.renderMermaidSVG(source)).toContain('Alice note')
  const branched = 'sequenceDiagram\npar_over Independent\nA->>B: first\nand Other\nC->>D: second\nend\nA->>D: joined'
  const parsed = am.parseRegisteredMermaid(branched)
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
  const diagram = am.asSequence(parsed.value)
  const fragment = diagram?.body.statements.find(statement => statement.kind === 'fragment')
  expect(fragment?.kind === 'fragment' && fragment.fragment.fragmentKind).toBe('par_over')
  if (!diagram) throw new Error('Expected editable overlay')
  const edited = am.mutate(diagram, { kind: 'set_fragment_branch_label', fragmentIndex: 0, branchIndex: 1, label: 'Updated branch' })
  expect(edited.ok).toBe(true)
  if (!edited.ok) throw new Error(edited.error.message)
  const messages = (await accepted(am.serializeMermaid(edited.value))).snapshot.data.getMessages as Array<Record<string, unknown>>
  expect(messages.map(message => message.type)).toEqual([32, 0, 20, 0, 21, 0])
  expect(messages.map(message => message.message)).toEqual(['Independent', 'first', 'Updated branch', 'second', '', 'joined'])
  expect(am.renderMermaidASCII(edited.value)).toContain('Updated branch')
})

const REPEATED_TITLE = 'keeps the title of the first declaration'
const NESTED_REDECLARATION = 'flattens a subgraph redeclared inside its own body instead of creating a cycle'
const subgraphWitnesses = [{ testTitle: REPEATED_TITLE, label: 'First' }, { testTitle: NESTED_REDECLARATION, label: 'S' }]
semantic('upstream repeated subgraph identity, members and first title survive public parsing', `${FLOW_DB}: ${REPEATED_TITLE}; ${NESTED_REDECLARATION}`, async () => {
  for (const witness of subgraphWitnesses) {
    const source = specSource(FLOW_DB, witness.testTitle)
    const expected = [{ id: 'S', nodes: ['x', 'y'], title: witness.label }]
    expect(upstreamGroups(await accepted(source)).map(group => ({ id: group.id, nodes: group.nodes, title: group.title }))).toEqual(expected)
    const parsed = flow(source)
    expect(parsed.body.graph.subgraphs.map(group => ({ id: group.id, nodes: group.nodeIds, title: group.label }))).toEqual(expected)
  }
})

semantic('typed edits retain the repeated subgraph members in layout and SVG', `${FLOW_DB}: ${REPEATED_TITLE}; ${NESTED_REDECLARATION}; public projections derived from the upstream membership assertions`, async () => {
  for (const witness of subgraphWitnesses) {
    const source = specSource(FLOW_DB, witness.testTitle)
    const original = flow(source)
    const edited = am.mutate(original, { kind: 'add_node', id: 'extra', label: 'Extra' })
    if (!edited.ok) throw new Error(edited.error.message)
    for (const diagram of [original, edited.value]) {
      const serialized = am.serializeMermaid(diagram)
      const reference = await accepted(serialized)
      expect(upstreamGroups(reference).find(group => group.id === 'S')?.nodes).toEqual(['x', 'y'])
      expect(am.verifyMermaid(diagram).ok).toBe(true)
      const positioned = am.layoutMermaid(diagram)
      expect(positioned.nodes.map(node => node.id)).toEqual(expect.arrayContaining(['x', 'y']))
      expect(positioned.groups.filter(group => group.id === 'S').map(group => ({ label: group.label, members: [...group.members].sort() }))).toEqual([{ label: witness.label, members: ['x', 'y'] }])
      for (const svg of [am.renderMermaidSVG(diagram), am.renderMermaidSVG(serialized)]) {
        expect(svgGroups(svg, 'S')).toHaveLength(1)
        for (const id of ['x', 'y']) {
          expect(svgGroups(svg, id)).toHaveLength(1)
          expect(svgLabels(svg)).toContain(id)
        }
      }
    }
  }
})

semantic('class assignments accumulate in author order and survive typed rename, serialization and SVG', 'packages/mermaid/src/diagrams/flowchart/flowDb.ts: FlowDB.setClass appends; parser/flow-style.spec.js class application contract', async () => {
  const source = 'flowchart TD\nA\nclassDef foo fill:#ff0000\nclassDef bar stroke:#0000ff\nclass A foo\nclass A bar'
  expect(upstreamClasses(await accepted(source), 'A')).toEqual(['foo', 'bar'])
  const original = flow(source)
  expect(original.body.graph.classAssignments.get('A')?.split(/\s+/)).toEqual(['foo', 'bar'])
  const edited = am.mutate(original, { kind: 'rename_node', from: 'A', to: 'Renamed' })
  if (!edited.ok) throw new Error(edited.error.message)
  expect(edited.value.body.graph.classAssignments.get('Renamed')?.split(/\s+/)).toEqual(['foo', 'bar'])
  expect(upstreamClasses(await accepted(am.serializeMermaid(edited.value)), 'Renamed')).toEqual(['foo', 'bar'])
  const svg = am.renderMermaidSVG(edited.value)
  const node = svgGroups(svg, 'Renamed')[0]
  expect(node?.match(/\bclass="([^"]*)"/)?.[1]?.split(/\s+/)).toEqual(expect.arrayContaining(['node', 'foo', 'bar']))
  expect(svg).toContain('#ff0000')
  expect(svg).toContain('#0000ff')
})

interface XyData {
  title: string
  xAxis: { title?: string; type: string; categories?: string[]; min?: number; max?: number }
  yAxis: { title?: string; type: string; categories?: string[]; min?: number; max?: number }
  plots: Array<{ type: string; title: string; data: Array<[string | number, number]>; pointLabels?: string[] }>
}
function xySemantics(reply: Extract<ReferenceReply, { ok: true }>): XyData {
  const data = reply.snapshot.data.getXYChartData as unknown as XyData
  return { title: data.title, xAxis: data.xAxis, yAxis: data.yAxis, plots: data.plots.map(plot => ({ type: plot.type, title: plot.title, data: plot.data, ...(plot.pointLabels ? { pointLabels: plot.pointLabels } : {}) })) }
}
const XY_DOCS = 'packages/mermaid/src/docs/syntax/xyChart.md'
for (const title of ['Different Colors in xyChart', 'Smallest AI models scoring above 60% on MMLU']) {
  semantic(`XY writer preserves the official title, axes, values and point labels: ${title}`, `${XY_DOCS}: title ${JSON.stringify(title)}`, async () => {
    const document = readFileSync(join(upstream, XY_DOCS), 'utf8')
    const source = [...document.matchAll(/```mermaid[\w-]*[^\n]*\n([\s\S]*?)```/g)].map(match => match[1]!).find(sample => sample.includes(`title "${title}"`))
    if (!source) throw new Error(`No official example with title ${title}`)
    const expected = xySemantics(await accepted(source))
    const parsed = am.parseRegisteredMermaid(source)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    const chart = am.asXyChart(parsed.value)
    if (!chart) throw new Error('Expected structured XY chart')
    expect(chart.body.title).toBe(title)
    expect(chart.body.series.map(series => series.values)).toEqual(expected.plots.map(plot => plot.data.map(point => point[1])))
    const expectedLabels = expected.plots.flatMap((plot, series) => plot.pointLabels?.flatMap((label, point) => label ? [`series#${series} point#${point} : ${label}`] : []) ?? [])
    expect(am.describeMermaidFacts(chart).filter(fact => fact.includes(' point#'))).toEqual(expectedLabels.sort())
    expect(xySemantics(await accepted(am.serializeMermaid(chart)))).toEqual(expected)
    const changedTitle = `${title} updated`
    const edited = am.mutate(chart, { kind: 'set_title', title: changedTitle })
    if (!edited.ok) throw new Error(edited.error.message)
    expect(xySemantics(await accepted(am.serializeMermaid(edited.value)))).toEqual({ ...expected, title: changedTitle })
  })
}

for (const witness of [
  { arrow: '<--', label: 'calls', kind: 'association', markerAt: 'from' },
  { arrow: '--|>', label: 'inherits', kind: 'inheritance', markerAt: 'to' },
] as const) {
  semantic(`Class writer preserves the marked endpoint: ${witness.arrow}`, 'packages/mermaid/src/diagrams/class/parser/classDiagram.jison; minimized reviewed grammar-assessment witness', async () => {
    const source = `classDiagram\nA ${witness.arrow} B : ${witness.label}`
    const expected = (await accepted(source)).snapshot.data.getRelations
    const parsed = am.parseRegisteredMermaid(source)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    const diagram = am.asClass(parsed.value)
    if (!diagram) throw new Error('Expected structured Class diagram')
    expect(diagram.body.relations).toEqual([{ from: 'A', to: 'B', kind: witness.kind, markerAt: witness.markerAt, label: witness.label }])
    const edited = am.mutate(diagram, { kind: 'add_member', class: 'A', text: '+String name' })
    if (!edited.ok) throw new Error(edited.error.message)
    for (const candidate of [diagram, edited.value]) {
      expect((await accepted(am.serializeMermaid(candidate))).snapshot.data.getRelations).toEqual(expected)
    }
  })
}

semantic('Flowchart writer preserves typed shape metadata and named-edge identity in valid Mermaid', 'packages/mermaid/src/diagrams/flowchart/parser/flow.jison; minimized reviewed grammar-assessment witness', async () => {
  const source = "flowchart LR\nA id1@-->B\nA@{ shape: 'rect' }"
  const expected = await accepted(source)
  const diagram = flow(source)
  expect(diagram.body.graph.nodes.get('A')?.authoredShape).toBe('rect')
  expect(diagram.body.graph.edges).toEqual([expect.objectContaining({ id: 'id1', source: 'A', target: 'B' })])
  const serialized = am.serializeMermaid(diagram)
  const actual = await accepted(serialized)
  for (const getter of ['getDirection', 'getVertices', 'getEdges']) expect(actual.snapshot.data[getter]).toEqual(expected.snapshot.data[getter])
  expect(am.renderMermaidSVG(serialized)).toContain('data-id="id1"')
})

semantic('Mindmap writer preserves quoted delimiter labels, identities, shapes and parentage', 'packages/mermaid/src/diagrams/mindmap/parser/mindmap.jison; minimized reviewed grammar-assessment witness', async () => {
  const source = 'mindmap\n  root["String containing []"]\n    child("Closing )")'
  const expected = (await accepted(source)).snapshot.data.getMindmap
  const parsed = am.parseRegisteredMermaid(source)
  if (!parsed.ok || parsed.value.body.kind !== 'mindmap') throw new Error('Expected structured Mindmap')
  expect(parsed.value.body.root).toMatchObject({ id: 'root', label: 'String containing []', shape: 'rect', children: [{ id: 'child', label: 'Closing )', shape: 'rounded', children: [] }] })
  expect((await accepted(am.serializeMermaid(parsed.value))).snapshot.data.getMindmap).toEqual(expected)
})

semantic('Quadrant writer preserves reserved axis text and declared point values in the real grammar', 'packages/mermaid/src/diagrams/quadrant-chart/parser/quadrant.jison; minimized reviewed grammar-assessment witness', async () => {
  const source = 'quadrantChart\n  x-axis "x-axis-1" --> "x-axis-2"\n  A: [0.5, 0.5]'
  const parsed = am.parseRegisteredMermaid(source)
  if (!parsed.ok || parsed.value.body.kind !== 'quadrant') throw new Error('Expected structured Quadrant')
  expect(parsed.value.body.xAxis).toEqual({ near: 'x-axis-1', far: 'x-axis-2' })
  expect(parsed.value.body.points).toEqual([{ label: 'A', x: 0.5, y: 0.5 }])
  const grammar = startGrammarReference(referenceDir, upstream)
  try {
    await grammar.prepare('quadrant', source)
    const before = await grammar.parse('quadrant', source)
    const after = await grammar.parse('quadrant', am.serializeMermaid(parsed.value))
    expect(before.accepted).toBe(true)
    expect(after.accepted).toBe(true)
    if (before.actions.status !== 'available' || after.actions.status !== 'available') throw new Error('Quadrant grammar model calls must be observable')
    // These real model-builder calls contain authored text and numeric values,
    // so no rendered coordinates or diagram-size counts stand in for meaning.
    expect(after.actions.value).toEqual(before.actions.value)
  } finally { grammar.close() }
})

beforeAll(() => {
  const admitted = admitCurrentReference(upstream, referenceDir)
  if (admitted.domVersion !== '26.1.0') throw new Error(`Use reviewed jsdom@26.1.0; got ${admitted.domVersion}`)
  admittedReference = admitted
  oracle = startModernReference(referenceDir)
})

afterAll(async () => {
  try {
    if (!oracle) return
    // These source-derived gaps remain diagnostics, not deliberately failing
    // compatibility tests or assertions that a missing feature must stay absent.
    const authored = JSON.parse(readFileSync(join(HERE, 'authored-probes.json'), 'utf8')) as Array<{ id: string; family: string; source: string; upstream: string }>
    const probes = authored.filter(probe => ['architecture', 'sequence'].includes(probe.family)).map(probe => ({ name: probe.id, origin: probe.upstream, source: probe.source }))
    probes.push({ name: 'state-floating-note', origin: 'packages/mermaid/src/diagrams/state/stateDiagram.spec.js: should handle floating notes', source: specSource('packages/mermaid/src/diagrams/state/stateDiagram.spec.js', 'should handle floating notes') })
    probes.push({ name: 'generous-read-journey-extension', origin: 'src/__tests__/journey-semicolon-extension.test.ts; upstream rejection is informational under write-strict/read-generously policy', source: 'journey\n  A: 5: Me; B: 3: Me' })
    for (const probe of probes) {
      const reference = await oracle.parse(probe.source)
      const diagnostic: typeof diagnostics[number] = { ...probe, reference, rendered: false }
      try {
        const parsed = am.parseRegisteredMermaid(probe.source)
        if (parsed.ok) {
          diagnostic.representation = parsed.value.body.kind
          const verification = am.verifyMermaid(parsed.value)
          diagnostic.verifyOk = verification.ok
          diagnostic.warnings = verification.warnings.map(warning => warning.code)
        }
        am.renderMermaidSVG(probe.source)
        diagnostic.rendered = true
      } catch (error) { diagnostic.error = String(error) }
      diagnostics.push(diagnostic)
    }
    mkdirSync(dirname(reportPath), { recursive: true })
    writeFileSync(reportPath, JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), reference: admittedReference ?? PIN, target, assertions: results, diagnostics, note: 'Only the selected semantic assertions gate success. Diagnostic syntax gaps and upstream-negative acceptance are informational. SVG checks assert authored identity and content, not Mermaid layout or appearance.' }, null, 2) + '\n')
    console.log(`Modern semantic assertions: ${results.filter(result => result.status === 'passed').length}/${results.length}; diagnostic probes: ${diagnostics.length}; ${reportPath}`)
  } finally { oracle?.close() }
})


for (const source of [
  'flowchart LR\n Login["Login / SSO"] -->|accepted| Store["Store & index"]',
  'sequenceDiagram\n participant Login as Login / SSO\n participant Store as Store & index\n Login->>Store: accepted',
  'classDiagram\n class Login["Login / SSO"]\n class Store["Store & index"]\n Login --> Store : accepted',
  'erDiagram\n Login["Login / SSO"]\n Store["Store & index"]\n Login ||--o{ Store : accepted',
  'stateDiagram-v2\n state "Login / SSO" as Login\n state "Store & index" as Store\n Login --> Store: accepted',
]) {
  semantic(`independent authored label census: ${source.split('\n')[0]}`, 'portable authored labels', async () => {
    if (!oracle) throw new Error('Independent reference not installed')
    const reply = await oracle.parse(source)
    if (!reply.ok) throw new Error(reply.error)
    const data = reply.snapshot.data
    const diagramData = data.getData as { nodes?: Array<{ label?: string }>; edges?: Array<{ label?: string }> } | undefined
    const actorLabels = Array.isArray(data.getActors) ? data.getActors.map(entry => (entry as unknown as [string, { description: string }])[1].description) : []
    const messageLabels = Array.isArray(data.getMessages) ? data.getMessages.map(entry => (entry as { message?: string }).message) : []
    const expected = [...(diagramData?.nodes ?? []).map(node => node.label), ...(diagramData?.edges ?? []).map(edge => edge.label), ...actorLabels, ...messageLabels].filter((label): label is string => typeof label === 'string' && label.length > 0)
    expect(expected.length).toBeGreaterThan(0)
    const parsed = am.parseRegisteredMermaid(source)
    if (!parsed.ok) throw new Error('Source failed to parse')
    const facts = am.describeMermaidFacts(parsed.value).join('\n')
    for (const label of expected) expect(facts).toContain(label)
  })
}

for (const family of BUILTIN_FAMILY_METADATA) {
  semantic(`independent label surfaces: ${family.id}`, 'FamilyDescriptor.example parsed by the independently installed reference DB', async () => {
    const reference = await accepted(family.example)
    const parsed = am.parseRegisteredMermaid(family.example)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    const census = labelCensus(family.id, reference, parsed.value, am.renderMermaidSVG(parsed.value))
    if (census.status !== 'measured') throw new Error(census.reason)
    expect(census.labels.length).toBeGreaterThan(0)
    for (const label of census.labels) {
      for (const surface of ['model', 'facts', 'svg', 'ascii', 'meta']) {
        expect({ family: family.id, path: label.path, text: label.text, surface, present: label.presence[surface] }).toEqual({ family: family.id, path: label.path, text: label.text, surface, present: true })
      }
    }
  })
}

semantic('generated sequence edits retain boxes, activation, properties and punctuation', 'Mermaid 12.2.0 sequence DB with real DOM color admission; public typed edit and roundtrip', async () => {
  await fc.assert(fc.asyncProperty(
    fc.array(fc.constantFrom('literal * star', 'literal # comment', 'literal \\ slash', 'a < b > c'), { minLength: 1, maxLength: 5 }),
    fc.array(fc.constantFrom('A', 'Alice', 'Updated', 'Client', '}', '"quoted"', '{braces}', 'style:x}'), { minLength: 1, maxLength: 3 }).map(words => words.join(' ')),
    fc.constantFrom('participant A as Alice', 'participant A', 'participant A@{type: database, alias: Alice}', 'participant A@{type: database, alias: Alice, future: keep-me}'),
    async (messages, renamed, declaration) => {
      const controls = ['box transparent Crew', 'properties A: {"color":"red"}', 'activate A', 'deactivate A']
      const source = `sequenceDiagram\n  ${controls[0]}\n    ${declaration}\n    actor B as Bob\n  end\n  ${controls[1]}\n  ${controls[2]}\n${messages.map(message => `  A->>B: ${message}`).join('\n')}\n  ${controls[3]}`
      const before = await accepted(source)
      const messageText = (reply: typeof before) => (reply.snapshot.data.getMessages as unknown as Array<{ type: number; message: string }>).filter(message => message.type === 0).map(message => message.message)
      const expectedMessages = messages.map(message => message.split('#')[0]!.trim())
      expect(messageText(before)).toEqual(expectedMessages)
      const parsed = am.parseRegisteredMermaid(source)
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
      const edited = am.mutate(parsed.value, { kind: 'set_participant_label', id: 'A', label: renamed })
      if (!edited.ok) throw new Error(JSON.stringify(edited.error))
      const output = am.serializeMermaid(edited.value)
      for (const control of controls) expect(output).toContain(control)
      if (declaration.includes('future:')) expect(output).toContain('keep-me')
      const after = await accepted(output)
      expect(messageText(after)).toEqual(expectedMessages)
      const actors = after.snapshot.data.getActors as unknown as Array<[string, { description: string; type: string; properties: unknown }]>
      expect(actors.map(([id, actor]) => [id, actor.type, actor.description])).toEqual([['A', declaration.includes('database') ? 'database' : 'participant', renamed], ['B', 'actor', 'Bob']])
      expect(actors[0]![1].properties).toEqual({ color: 'red' })
      expect(after.snapshot.data.getBoxes).toEqual(before.snapshot.data.getBoxes)
      const reparsed = am.parseRegisteredMermaid(output)
      if (!reparsed.ok || reparsed.value.body.kind !== 'sequence') throw new Error('Expected structured Sequence')
      expect(reparsed.value.body.participants.map(actor => [actor.id, actor.kind, actor.label])).toEqual([['A', declaration.includes('database') ? 'database' : 'participant', renamed], ['B', 'actor', 'Bob']])
      expect(reparsed.value.body.messages.map(message => message.text)).toEqual(expectedMessages)
    },
  ), fcParameters({ numRuns: 100, examples: [[['ping'], 'New } "label"', 'participant A@{type: database, alias: Alice, future: keep-me}'], [['ping'], 'style:x}', 'participant A@{type: database, alias: Alice}']] }))
})

semantic('recognized Sequence messages survive semantic read-back throughout the official corpus', 'Retained official Sequence fences and independent reference DB messages, including preserved controls', async () => {
  let compared = 0
  for (const sample of officialCorpusInventory().occurrences.filter(sample => sample.family === 'sequence')) {
    if (!oracle) throw new Error('Independent reference did not start')
    const reference = await oracle.parse(sample.source)
    if (!reference.ok) continue
    const parsed = am.parseRegisteredMermaid(sample.source)
    if (!parsed.ok || parsed.value.body.kind !== 'sequence') continue
    const facts = am.describeMermaidFacts(parsed.value).map(censusDisplayText)
    const messages = reference.snapshot.data.getMessages as unknown as Array<{ type: number; from?: string; to?: string; message: string }>
    for (const message of messages.filter(message => message.type !== 2 && typeof message.from === 'string' && typeof message.to === 'string')) {
      const expected = censusDisplayText(`message ${message.from} -> ${message.to} : ${message.message}`)
      expect({ sample: sample.id, expected, present: facts.includes(expected) }).toEqual({ sample: sample.id, expected, present: true })
      compared++
    }
  }
  expect(compared).toBeGreaterThan(0)
})
