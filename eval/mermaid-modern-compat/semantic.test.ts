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
import type { FlowchartValidDiagram, JourneyMutationOp, ParsedDiagram } from '../../src/agent/types.ts'
import { BUILTIN_FAMILY_METADATA } from '../../src/agent/families.ts'
import { censusDisplayText, labelCensus, referenceLabels } from './label-census.ts'
import { officialCorpusInventory } from '../shared/official-fences.ts'
import { inspectAgenticGrammar } from './grammar-agentic.ts'
import { nativeMeaningChanged } from './grammar-triage.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const upstream = resolve(process.env.MERMAID_UPSTREAM_DIR ?? join(ROOT, '../mermaid'))
const referenceDir = resolve(process.env.MERMAID_REFERENCE_DIR ?? join(ROOT, '../mermaid-reference'))
const target = resolve(process.env.AM_MODERN_TARGET_DIR ?? ROOT)
const reportPath = resolve(process.env.AM_MODERN_GATE_REPORT ?? join(HERE, 'output/semantic-gate.json'))
const PIN = currentReferencePin
const am = await import(pathToFileURL(join(target, 'src/agent/core.ts')).href) as typeof import('../../src/agent/core.ts')
const terminalApi = await import(pathToFileURL(join(target, 'src/ascii/index.ts')).href) as typeof import('../../src/ascii/index.ts')
const terminalModel = await import(pathToFileURL(join(target, 'src/ascii/terminal-document.ts')).href) as typeof import('../../src/ascii/terminal-document.ts')
let oracle: ReturnType<typeof startModernReference> | undefined
let admittedReference: ReturnType<typeof admitCurrentReference> | undefined
interface UnavailableSemantic { status: 'unavailable'; reason: string; parserIdentity: Record<string, string> }
const results: Array<{ name: string; origin: string; status: 'passed' | 'failed' | 'unavailable'; error?: string; reason?: string; parserIdentity?: Record<string, string> }> = []
const diagnostics: Array<{ name: string; origin: string; source: string; reference: ReferenceReply; representation?: string; verifyOk?: boolean; warnings?: string[]; rendered: boolean; error?: string }> = []
const syntaxQualifications: unknown[] = []

function semantic(name: string, origin: string, check: () => Promise<void | UnavailableSemantic>): void {
  test(name, async () => {
    try {
      const outcome = await check()
      results.push(outcome ? { name, origin, ...outcome } : { name, origin, status: 'passed' })
    }
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

semantic('ZenUML official sources, canonical writes and checked edits use the real pinned syntax control', '@zenuml/core@3.47.9 public ZenUml.parse with addon 1.0.1; no AST/action oracle is exposed', async () => {
  const inputs = officialCorpusInventory().occurrences.filter(input => input.family === 'zenuml')
  expect(inputs).toHaveLength(32)
  expect(new Set(inputs.map(input => input.source)).size).toBe(16)
  for (const input of inputs) {
    const reference = await accepted(input.source)
    expect(reference.parserIdentity?.parser).toBe('@zenuml/core@3.47.9')
    expect(reference.parserAst?.unavailable).toContain('not an AST')
    const parsed = am.parseRegisteredMermaid(input.source)
    if (!parsed.ok || parsed.value.body.kind !== 'zenuml') throw Error(`Native ZenUML required: ${input.id}`)
    const canonical = am.serializeMermaid(parsed.value, { wrapper: 'canonical' })
    const canonicalReference = await accepted(canonical)
    const before = inspectAgenticGrammar('zenuml', input.source).native.observation
    const after = inspectAgenticGrammar('zenuml', canonical).native.observation
    expect(before.semantic, input.id).toBeDefined()
    expect(nativeMeaningChanged('zenuml', before, after), input.id).toBe(false)
    const changed = am.mutateChecked(parsed.value, { kind: 'set_title', title: 'Qualified ZenUML' })
    if (!changed.ok) throw Error(`${input.id}: ${changed.error.message}`)
    const checkedSource = am.serializeMermaid(changed.value, { wrapper: 'canonical' })
    const checkedReference = await accepted(checkedSource)
    expect(am.renderMermaidSVG(changed.value)).toContain('Qualified ZenUML')
    syntaxQualifications.push({ family: 'zenuml', id: input.id, source: input.source, reference, canonical, canonicalReference, checkedSource, checkedReference })
  }
  const source = readFileSync(join(ROOT, 'eval/layout-compare/fixtures/zenuml-native-checkout.mmd'), 'utf8')
  const parsed = am.parseRegisteredMermaid(source)
  if (!parsed.ok || parsed.value.body.kind !== 'zenuml') throw Error('Native Checkout required')
  const changed = am.mutateChecked(parsed.value, { kind: 'rename_participant', id: 'Stock', newId: 'Inventory' })
  if (!changed.ok) throw Error(changed.error.message)
  const written = am.serializeMermaid(changed.value, { wrapper: 'canonical' })
  await accepted(written)
  const reloaded = am.parseRegisteredMermaid(written)
  if (!reloaded.ok) throw Error('Checked ZenUML output must reload natively')
  const layout = am.layoutMermaid(reloaded.value)
  expect(layout.edges.filter(edge => edge.label?.text === 'accepted' || edge.label?.text === 'rejected').map(edge => [edge.from, edge.to])).toEqual([['Inventory', 'API'], ['Inventory', 'API']])
  expect(layout.edges.find(edge => edge.label?.text === 'result = reserve()')?.to).toBe('Inventory')
  expect(layout.edges.find(edge => edge.label?.text === 'checkout()')?.from).toBe('Buyer')
  const messages = am.parseRegisteredMermaid('zenuml\nAlice->Bob: Hello\nBob->Alice: Reply')
  if (!messages.ok || messages.value.body.kind !== 'zenuml') throw Error('Expected native message edit control')
  const first = messages.value.body.statements[0]!
  if (first.kind !== 'message') throw Error('Expected a message statement')
  const edited = am.mutateChecked(messages.value, { kind: 'set_statement', id: first.id, statement: { ...first, label: 'Updated Hello' } })
  if (!edited.ok) throw Error(edited.error.message)
  for (const [diagram, labels] of [[messages.value, ['Alice', 'Bob', 'Hello', 'Reply']], [edited.value, ['Alice', 'Bob', 'Updated Hello', 'Reply']]] as const) {
    const reference = await accepted(am.serializeMermaid(diagram, { wrapper: 'canonical' }))
    expect(reference.parserAst?.unavailable).toContain('not an AST')
    expect(referenceLabels('zenuml', reference)?.map(label => label.text)).toEqual([...labels])
    const census = labelCensus('zenuml', reference, diagram, am.renderMermaidSVG(diagram))
    if (census.status !== 'measured') throw Error(census.reason)
    expect(census.labels.length).toBeGreaterThan(0)
    for (const label of census.labels) for (const surface of ['model', 'facts', 'svg', 'ascii', 'meta']) expect(label.presence[surface]).toBe(true)
  }
})

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

semantic('Timeline text fields remain text across keyword, separator and directive contexts', 'packages/mermaid/src/diagrams/timeline/parser/timeline.jison; reviewed field-context writer contract', async () => {
  const built = am.buildMermaid('timeline', [
    { kind: 'set_title', title: 'Report %%{literal' },
    { kind: 'add_section', label: 'Phase: next' },
    { kind: 'add_period', sectionIndex: 0, label: 'section Phase', events: ['First: next', 'tail:'] },
    { kind: 'add_period', sectionIndex: 0, label: 'title' },
    { kind: 'add_period', sectionIndex: 0, label: '2026', events: ['%%{literal', '#37; literal'] },
  ])
  expect(built.ok).toBe(true)
  if (!built.ok) throw new Error(JSON.stringify(built.error))
  const source = am.serializeMermaid(built.value)
  const reference = await accepted(source)
  const displayed = (value: string): string => censusDisplayText(value).trim()
  expect((reference.snapshot.data.getSections as string[]).map(displayed)).toEqual(['Phase: next'])
  const tasks = reference.snapshot.data.getTasks as unknown as Array<{ task: string; section: string; events: string[] }>
  expect(tasks.map(task => ({ label: displayed(task.task), section: displayed(task.section), events: task.events.map(displayed) }))).toEqual([
    { label: 'section Phase', section: 'Phase: next', events: ['First: next', 'tail:'] },
    { label: 'title', section: 'Phase: next', events: [] },
    { label: '2026', section: 'Phase: next', events: ['%%{literal', '#37; literal'] },
  ])
  const reloaded = am.parseRegisteredMermaid(source)
  if (!reloaded.ok || reloaded.value.body.kind !== 'timeline') throw new Error('Expected editable Timeline')
  expect(reloaded.value.body).toEqual(built.value.body)
  const moved = am.mutate(reloaded.value, { kind: 'move_period', fromSection: 0, fromIndex: 1, toSection: 0, toIndex: 0 })
  expect(moved.ok).toBe(true)
  if (!moved.ok) throw new Error(moved.error.message)
  await accepted(am.serializeMermaid(moved.value))
  const svg = am.renderMermaidSVG(moved.value)
  expect(svg).toContain('section Phase')
  expect(svg).not.toContain('&#116;itle')
})

semantic('Sequence spaced actor tokens retain identities through declarations, editing and rendering', 'packages/mermaid/src/diagrams/sequence/parser/sequenceDiagram.jison: ACTOR and ID states', async () => {
  const source = 'sequenceDiagram\nparticipant Alice Smith\nactor Bob Jones\nAlice Smith->>Bob Jones: first\nBob Jones-->>Alice Smith: second\nNote over Alice Smith,Bob Jones: Shared note'
  const expected = await accepted(source)
  const parsed = am.parseRegisteredMermaid(source)
  if (!parsed.ok || parsed.value.body.kind !== 'sequence') throw new Error('Expected editable Sequence')
  expect(parsed.value.body.participants.map(participant => [participant.id, participant.label, participant.kind])).toEqual([
    ['Alice Smith', 'Alice Smith', 'participant'], ['Bob Jones', 'Bob Jones', 'actor'],
  ])
  expect(parsed.value.body.messages.map(message => [message.from, message.to, message.text])).toEqual([
    ['Alice Smith', 'Bob Jones', 'first'], ['Bob Jones', 'Alice Smith', 'second'],
  ])
  const after = await accepted(am.serializeMermaid(parsed.value))
  expect(after.snapshot.data.getActors).toEqual(expected.snapshot.data.getActors)
  expect(after.snapshot.data.getMessages).toEqual(expected.snapshot.data.getMessages)
  const edited = am.mutate(parsed.value, { kind: 'set_message_text', index: 0, text: 'Revised' })
  if (!edited.ok) throw new Error(edited.error.message)
  const reloaded = am.parseRegisteredMermaid(am.serializeMermaid(edited.value))
  if (!reloaded.ok || reloaded.value.body.kind !== 'sequence') throw new Error('Expected editable reload')
  expect(reloaded.value.body.messages[0]).toMatchObject({ from: 'Alice Smith', to: 'Bob Jones', text: 'Revised' })
  await accepted(am.serializeMermaid(edited.value))
  expect(am.renderMermaidSVG(edited.value)).toContain('data-id="Alice Smith"')
  expect(am.renderMermaidASCII(edited.value)).toContain('Revised')
  expect(am.verifyMermaid(edited.value).ok).toBe(true)
  for (const [declaration, id, label] of [
    ['participant Alice Smith as Caller', 'Alice Smith as Caller', 'Alice Smith as Caller'],
    ['participant Alice as Caller', 'Alice', 'Caller'],
  ]) {
    const input = `sequenceDiagram\n${declaration}\n${id}->>Bob: hello`
    const reference = await accepted(input)
    const parsed = am.parseRegisteredMermaid(input)
    if (!parsed.ok || parsed.value.body.kind !== 'sequence') throw new Error('Expected editable declaration')
    expect(parsed.value.body.participants[0]).toMatchObject({ id, label })
    expect((await accepted(am.serializeMermaid(parsed.value))).snapshot.data.getActors).toEqual(reference.snapshot.data.getActors)
  }
  expect(am.mutate(parsed.value, { kind: 'set_participant_label', id: 'Alice Smith', label: 'Caller' })).toMatchObject({ ok: false, error: { code: 'INVALID_OP' } })
  expect(parsed.value.body.participants[0]!.id).toBe('Alice Smith')
  const added = am.mutate(parsed.value, { kind: 'add_participant', id: 'Carol White', participantKind: 'actor' })
  if (!added.ok) throw new Error(added.error.message)
  const actors = (await accepted(am.serializeMermaid(added.value))).snapshot.data.getActors as unknown as Array<[string, { type: string; description: string }]>
  expect(actors.find(([id]) => id === 'Carol White')?.[1]).toMatchObject({ type: 'actor', description: 'Carol White' })
})

semantic('Canonical wrappers diagnose consumed configuration failures and preserve authored color text', 'Mermaid public parse; theme-base.js derives palette colors even outside the owning diagram family', async () => {
  for (const [source, problem] of [
    ['%%{init: definitely-not-an-object}%%\nmindmap\n root', 'init directive payload'],
    ['---\nconfig:\n  themeVariables: 1\'\n---\nmindmap\n root', 'pinned configuration processing rejects this value'],
    ['---\nconfig:\n  theme: base\n  themeVariables:\n    git0: "##374151"\n---\nmindmap\n root', 'pinned configuration processing rejects this value'],
  ]) {
    if (!oracle) throw new Error('Reference unavailable')
    expect((await oracle.parse(source!)).ok).toBe(false)
    const parsed = am.parseRegisteredMermaid(source!)
    if (!parsed.ok || parsed.value.body.kind !== 'mindmap') throw new Error('Expected editable diagram with repairable wrapper')
    expect(am.serializeMermaid(parsed.value)).toContain(source!.slice(0, source!.indexOf('mindmap')))
    expect(() => am.serializeMermaid(parsed.value, { wrapper: 'canonical' })).toThrow(problem!)
  }
  const source = '---\nconfig:\n  theme: base\n  themeVariables:\n    cScale1: "\\r#00FF00"\n---\nradar-beta\naxis A\ncurve c{1}'
  const parsed = am.parseRegisteredMermaid(source)
  if (!parsed.ok) throw new Error('Expected Radar')
  const written = am.serializeMermaid(parsed.value, { wrapper: 'canonical' })
  await accepted(written)
  const reload = am.parseRegisteredMermaid(written)
  if (!reload.ok) throw new Error('Expected reload')
  expect(reload.value.meta.frontmatter?.themeVariables).toEqual({ cScale1: '\r#00FF00' })
  expect(am.renderMermaidSVG(written)).toBe(am.renderMermaidSVG(source))
  const empty = am.parseRegisteredMermaid('%%{init: {}}%%\nmindmap\n root')
  if (!empty.ok) throw new Error('Expected empty init object')
  await accepted(am.serializeMermaid(empty.value, { wrapper: 'canonical' }))
})

semantic('Gantt calendar formats and preserved comments export without changing dates or tick text', 'packages/mermaid/src/diagrams/gantt/parser/gantt.jison: axisFormat excludes hash; gantt config axisFormat accepts text', async () => {
  for (const format of ['%#:%M', '%H:%#', '#']) {
    const source = `---\nconfig:\n  gantt:\n    barHeight: 24\n---\ngantt\ndateFormat HH:mm\naxisFormat ${format}\nInitial: milestone, m1, 17:49, 2m\nTask: t1, after m1, 10m\n%%{ retained comment`
    const parsed = am.parseRegisteredMermaid(source)
    if (!parsed.ok || parsed.value.body.kind !== 'gantt') throw new Error('Expected editable Gantt')
    const edited = am.mutate(parsed.value, { kind: 'rename_task', sectionIndex: 0, taskIndex: 1, label: 'Renamed' })
    if (!edited.ok) throw new Error(edited.error.message)
    for (const wrapper of ['verbatim', 'canonical'] as const) {
      const written = am.serializeMermaid(edited.value, { wrapper })
      const reply = await accepted(written)
      expect((reply.snapshot.data.getConfig as { axisFormat: string }).axisFormat).toBe(format)
      const reload = am.parseRegisteredMermaid(written)
      if (!reload.ok || reload.value.body.kind !== 'gantt') throw new Error('Expected Gantt reload')
      expect<unknown>(reload.value.body).toEqual(edited.value.body)
      expect(am.renderMermaidSVG(written)).toBe(am.renderMermaidSVG(edited.value))
      expect(am.renderMermaidASCII(written)).toBe(am.renderMermaidASCII(edited.value))
      expect(written).toContain('%% { retained comment')
    }
  }
})

semantic('C4 empty boundaries export without fabricated children or changed layout', 'packages/mermaid/src/diagrams/c4/c4Db.ts: updateLayoutConfig ignores empty arguments', async () => {
  const source = 'C4Context\nUpdateLayoutConfig("5","3")\nBoundary(outer,"Outer") {\nBoundary(inner,"Inner") { }\n}\nPerson(p,"Person")\nRel(p,inner,"visits")'
  const parsed = am.parseRegisteredMermaid(source)
  if (!parsed.ok || parsed.value.body.kind !== 'c4') throw new Error('Expected editable C4')
  const written = am.serializeMermaid(parsed.value)
  const reference = await accepted(written)
  expect(reference.snapshot.data.getC4ShapeInRow).toBe(5)
  expect(reference.snapshot.data.getC4BoundaryInRow).toBe(3)
  expect((reference.snapshot.data.getC4ShapeArray as Array<{ alias: string }>).map(node => node.alias)).toEqual(['p'])
  expect((reference.snapshot.data.getBoundaries as Array<{ alias: string; parentBoundary: string }>).map(node => [node.alias, node.parentBoundary])).toEqual([['global', ''], ['outer', 'global'], ['inner', 'outer']])
  const reloaded = am.parseRegisteredMermaid(written)
  if (!reloaded.ok || reloaded.value.body.kind !== 'c4') throw new Error('Expected editable C4 reload')
  expect(reloaded.value.body.directives).toHaveLength(1)
  expect(am.verifyMermaid(written).warnings.filter(warning => warning.code === 'UNSUPPORTED_SYNTAX')).toEqual([])
  expect(reloaded.value.body.layout).toEqual(parsed.value.body.layout)
  expect(reloaded.value.body.boundaries.map(node => [node.id, node.parentId])).toEqual([['outer', undefined], ['inner', 'outer']])
  expect(am.serializeMermaid(reloaded.value)).toBe(written)
  const drawing = (input: string) => am.renderMermaidSVG(input).replace(/am-[a-z0-9]+/g, 'am-scope').replace(/ data-source-line="\d+"/g, '')
  expect(drawing(written)).toBe(drawing(source))
  expect(am.renderMermaidASCII(written)).toBe(am.renderMermaidASCII(source))
})

semantic('C4 known argument values compile to complete tokens while retaining containment and relationships', 'packages/mermaid/src/diagrams/c4/parser/c4Diagram.jison: attribute, string and string_kv_value states', async () => {
  for (const [declaration, label] of [['Person(A,n)', 'n'], ['Person(A,=)', '='], ['Person(A,""o)', '""o'], ['Person(A,"%%{literal")', '%%{literal']] as const) {
    const source = `C4Context\nSystem_Boundary(g,"Group") {\n${declaration}\nPerson(B,"B")\nRel(A,B,"uses")\n}`
    const parsed = am.parseRegisteredMermaid(source)
    if (!parsed.ok || parsed.value.body.kind !== 'c4') throw new Error('Expected editable C4')
    expect(parsed.value.body.elements[0]).toMatchObject({ id: 'A', label, parentId: 'g' })
    const written = am.serializeMermaid(parsed.value)
    const reference = await accepted(written)
    const shapes = reference.snapshot.data.getC4ShapeArray as unknown as Array<{ alias: string; label: { text: string }; parentBoundary: string }>
    expect(shapes.map(shape => ({ id: shape.alias, label: censusDisplayText(shape.label.text), parent: shape.parentBoundary }))).toEqual([
      { id: 'A', label, parent: 'g' }, { id: 'B', label: 'B', parent: 'g' },
    ])
    const reloaded = am.parseRegisteredMermaid(written)
    if (!reloaded.ok || reloaded.value.body.kind !== 'c4') throw new Error('Expected editable C4 reload')
    expect(reloaded.value.body.elements[0]).toMatchObject({ id: 'A', label, parentId: 'g' })
    expect(reloaded.value.body.relationships[0]).toMatchObject({ from: 'A', to: 'B', label: 'uses' })
    expect(am.renderMermaidSVG(parsed.value)).toBe(am.renderMermaidSVG(written))
    expect(am.renderMermaidASCII(parsed.value)).toBe(am.renderMermaidASCII(written))
  }
})

semantic('Gantt task text cannot introduce keyword or date tokens or change dependency dates', 'packages/mermaid/src/diagrams/gantt/parser/gantt.jison: taskTxt and taskData', async () => {
  for (const label of ['gantt-plan', '2014-01-01 later', 'call worker', 'href "target"', 'title Launch', 'Plan: next %%{literal', '#37; literal']) {
    const source = 'gantt\ndateFormat YYYY-MM-DD\nBuild :a, 2024-01-01, 2d\nNext :b, after a, 1d\nShip :ship, after b, 1d'
    const original = am.parseRegisteredMermaid(source)
    if (!original.ok || original.value.body.kind !== 'gantt') throw new Error('Expected Gantt')
    const changed = am.mutate(original.value, { kind: 'rename_task', sectionIndex: 0, taskIndex: 1, label })
    expect(changed.ok, label).toBe(true)
    if (!changed.ok) throw new Error(changed.error.message)
    const written = am.serializeMermaid(changed.value)
    const reference = await accepted(written)
    const tasks = reference.snapshot.data.getTasks as unknown as Array<{ id: string; task: string; startTime: string; endTime: string }>
    expect(tasks.map(task => [task.id, censusDisplayText(task.task), task.startTime, task.endTime])).toEqual([
      ['a', 'Build', '2024-01-01T00:00:00.000Z', '2024-01-03T00:00:00.000Z'],
      ['b', label, '2024-01-03T00:00:00.000Z', '2024-01-04T00:00:00.000Z'],
      ['ship', 'Ship', '2024-01-04T00:00:00.000Z', '2024-01-05T00:00:00.000Z'],
    ])
    const reload = am.parseRegisteredMermaid(written)
    if (!reload.ok || reload.value.body.kind !== 'gantt') throw new Error('Expected editable Gantt reload')
    expect(reload.value.body.sections[0]!.tasks[1]).toMatchObject({ label, taskId: 'b', start: 'after a', end: '1d' })
    expect(am.renderMermaidSVG(changed.value)).toBe(am.renderMermaidSVG(written))
  }
})

semantic('Block quoted payloads preserve formatting, literal entities, identity and containment', 'packages/mermaid/src/diagrams/block/parser/block.jison: string tokens; authored formatting contract', async () => {
  const source = 'block\nblock:g["Group"]\na["A"]\nb["B"]\nend\na --> b'
  const original = am.parseRegisteredMermaid(source)
  if (!original.ok || original.value.body.kind !== 'block') throw new Error('Expected Block')
  const labels = ['%%{literal "quote"', '<b>bold</b> #lt;b#gt; #35;37;', '`literal tick']
  let changed = original.value
  for (const [id, label] of [['g', labels[0]!], ['a', labels[1]!], ['b', labels[2]!]]) {
    const result = am.mutate(changed, { kind: 'update_block', id: id!, changes: { label } })
    if (!result.ok) throw new Error(result.error.message)
    changed = result.value
  }
  const linked = am.mutate(changed, { kind: 'add_edge', from: 'b', to: 'a', label: '%%{edge "quote"' })
  if (!linked.ok) throw new Error(linked.error.message)
  const written = am.serializeMermaid(linked.value)
  const reference = await accepted(written)
  interface ReferenceBlock { id: string; label: string; children?: ReferenceBlock[] }
  const blocks = reference.snapshot.data.getBlocks as unknown as ReferenceBlock[]
  expect(blocks.map(node => [node.id, censusDisplayText(node.label), node.children?.map(child => child.id)])).toEqual([
    ['g', labels[0], ['a', 'b']],
  ])
  expect(blocks[0]!.children?.map(node => censusDisplayText(node.label))).toEqual(['bold <b> #37;', '`literal tick'])
  const edges = reference.snapshot.data.getEdges as unknown as Array<{ start: string; end: string; label: string }>
  expect(edges.map(edge => [edge.start, edge.end, censusDisplayText(edge.label)])).toEqual([['a', 'b', ''], ['b', 'a', '%%{edge "quote"']])
  const reload = am.parseRegisteredMermaid(written)
  if (!reload.ok || reload.value.body.kind !== 'block') throw new Error('Expected editable Block reload')
  expect(reload.value.body.root.children?.[0]).toMatchObject({ id: 'g', label: labels[0], children: [{ id: 'a', label: labels[1] }, { id: 'b', label: labels[2] }] })
  const svg = am.renderMermaidSVG(linked.value)
  expect(svg).toBe(am.renderMermaidSVG(written))
  expect(svg).toContain('font-weight="bold"')
  expect(svgLabels(svg).join('\n')).toContain('bold <b> #37;')
  expect(am.renderMermaidASCII(linked.value)).toContain('bold <b> #37;')
})

semantic('Journey literal text is independent of statement tokens and actor separators', 'packages/mermaid/src/diagrams/user-journey/parser/journey.jison; grammar-neutral text contract', async () => {
  const source = 'journey\nsection Work\nRead: 3: Me\nShip: 5: Me, Cat'
  const original = am.parseRegisteredMermaid(source)
  if (!original.ok || original.value.body.kind !== 'journey') throw new Error('Expected Journey')
  let diagram: ParsedDiagram = original.value
  const ops: JourneyMutationOp[] = [
    { kind: 'set_title', title: 'Book &lt; #2; %%{literal' },
    { kind: 'set_section_label', index: 0, label: 'Part: &amp;' },
    { kind: 'set_task_text', sectionIndex: 0, taskIndex: 0, text: 'journey: #35; &lt;' },
    { kind: 'set_task_actors', sectionIndex: 0, taskIndex: 0, actors: ['A; B', 'C, D'] },
    { kind: 'set_accessibility_title', title: 'Read &lt; %%{ ;' },
    { kind: 'set_accessibility_description', description: 'First { literal }\nSecond; %%{ #35;' },
  ]
  for (const op of ops) {
    const edited = am.mutate(diagram, op)
    if (!edited.ok) throw new Error(edited.error.message)
    diagram = edited.value
  }
  const written = am.serializeMermaid(diagram)
  const tasks = (await accepted(written)).snapshot.data.getTasks as unknown as Array<{ task: string; people: string[]; score: number }>
  expect(tasks.map(task => [censusDisplayText(task.task), task.score, task.people.map(censusDisplayText)])).toEqual([
    ['journey: #35; &lt;', 3, ['A; B', 'C, D']], ['Ship', 5, ['Me', 'Cat']],
  ])
  const reload = am.parseRegisteredMermaid(written)
  if (!reload.ok || reload.value.body.kind !== 'journey') throw new Error('Expected editable Journey reload')
  expect<unknown>(reload.value.body).toEqual(diagram.body)
  expect(am.renderMermaidSVG(diagram)).toBe(am.renderMermaidSVG(written))
  expect(am.renderMermaidASCII(diagram)).toContain('journey: #35; &lt;')
})

semantic('Ishikawa keyword-like labels remain text without changing cause ownership', 'packages/mermaid/src/diagrams/ishikawa/parser/ishikawa.jison; grammar-neutral text contract', async () => {
  const source = 'ishikawa\naccTitle: X &amp; Y\nProblem &amp; effect\n  Process\n    Delay\n  People'
  const original = am.parseRegisteredMermaid(source)
  if (!original.ok || original.value.body.kind !== 'ishikawa') throw new Error('Expected Ishikawa')
  const edited = am.mutate(original.value, { kind: 'set_label', id: 'cause-1', label: 'ishikawa: %%{literal #35; &lt;' })
  if (!edited.ok) throw new Error(edited.error.message)
  expect(edited.value.meta.accessibility.title).toBe('X & Y')
  const written = am.serializeMermaid(edited.value)
  await accepted(written)
  const reload = am.parseRegisteredMermaid(written)
  if (!reload.ok || reload.value.body.kind !== 'ishikawa') throw new Error('Expected editable Ishikawa reload')
  expect(reload.value.body.nodes).toEqual([
    { id: 'effect', label: 'Problem & effect' }, { id: 'cause-1', label: 'ishikawa: %%{literal #35; &lt;', parentId: 'effect' },
    { id: 'cause-2', label: 'Delay', parentId: 'cause-1' }, { id: 'cause-3', label: 'People', parentId: 'effect' },
  ])
  expect(am.renderMermaidSVG(edited.value)).toBe(am.renderMermaidSVG(written))
  expect(am.renderMermaidASCII(edited.value)).toContain('ishikawa: %%{literal #35; &lt;')
})

semantic('Treemap quoted text retains hierarchy and quantities through delimiter escapes', 'packages/mermaid/src/diagrams/treemap/parser/treemap.jison; grammar-neutral text contract', async () => {
  const source = 'treemap\naccTitle: X &amp; Y\n"Portfolio &amp; assets"\n  "First": 20\n  "Second": 30'
  const original = am.parseRegisteredMermaid(source)
  if (!original.ok || original.value.body.kind !== 'treemap') throw new Error('Expected Treemap')
  const label = 'Both "quotes" and \'apostrophes\' %%{literal #35; &lt;\nLiteral <br/> #10;'
  const edited = am.mutate(original.value, { kind: 'set_label', id: 'treemap-1', label })
  if (!edited.ok) throw new Error(edited.error.message)
  const written = am.serializeMermaid(edited.value)
  await accepted(written)
  const reload = am.parseRegisteredMermaid(written)
  if (!reload.ok || reload.value.body.kind !== 'treemap') throw new Error('Expected editable Treemap reload')
  expect(reload.value.body.nodes).toEqual([
    { id: 'treemap-0', label: 'Portfolio & assets' }, { id: 'treemap-1', label, value: 20, parentId: 'treemap-0' },
    { id: 'treemap-2', label: 'Second', value: 30, parentId: 'treemap-0' },
  ])
  expect(reload.value.meta.accessibility.title).toBe('X & Y')
  expect(reload.value.body.accessibilityTitle).toBe('X & Y')
  expect(am.renderMermaidSVG(written)).toContain('X &amp; Y')
  expect(am.renderMermaidSVG(edited.value)).toBe(am.renderMermaidSVG(written))
  for (const line of label.split('\n')) expect(am.renderMermaidASCII(edited.value)).toContain(line)
})

semantic('Floating State annotations retain independent identities and scope beside connected states', 'packages/mermaid/src/diagrams/state/parser/stateDiagram.jison: note NOTE_TEXT AS ID (upstream drops its semantic action)', async () => {
  const source = 'stateDiagram-v2\nN1 --> N2\nstate Group {\nA\nnote "Inner #lt;b#gt;" as N1\nA --> N1\n}\nnote "Outer<br/>next" as N2\nN2 --> Group'
  await accepted(source)
  const parsed = am.parseRegisteredMermaid(source)
  if (!parsed.ok || parsed.value.body.kind !== 'state') throw new Error('Expected editable State')
  expect(parsed.value.body.states).toEqual([
    expect.objectContaining({ id: 'N2' }),
    expect.objectContaining({ id: 'Group', states: [expect.objectContaining({ id: 'A' }), expect.objectContaining({ id: 'N1' })] }),
  ])
  expect(parsed.value.body.floatingNotes).toEqual([
    expect.objectContaining({ id: 'N1', text: 'Inner <b>', scope: { parent: 'Group' } }),
    expect.objectContaining({ id: 'N2', text: 'Outer\nnext' }),
  ])
  const changed = am.mutate(parsed.value, { kind: 'rename_state', from: 'N1', to: 'Memo' })
  if (!changed.ok) throw new Error(changed.error.message)
  const written = am.serializeMermaid(changed.value)
  await accepted(written)
  const reload = am.parseRegisteredMermaid(written)
  if (!reload.ok || reload.value.body.kind !== 'state') throw new Error('Expected editable State reload')
  expect(reload.value.body.states.find(state => state.id === 'Group')).toMatchObject({ id: 'Group', states: [expect.objectContaining({ id: 'A' }), expect.objectContaining({ id: 'Memo' })], transitions: [{ from: 'A', to: 'Memo' }] })
  expect(reload.value.body.transitions).toEqual([{ from: 'Memo', to: 'N2' }, { from: 'N2', to: 'Group' }])
  expect(reload.value.body.floatingNotes).toEqual(parsed.value.body.floatingNotes)
  const svg = am.renderMermaidSVG(changed.value)
  expect(svg).toContain('data-id="Memo"')
  expect(svg).toContain('data-floating-note-id="N1"')
  expect(svgLabels(svg)).toContain('Inner <b>')
  const terminal = am.renderMermaidASCIIWithMeta(changed.value, { useAscii: true, colorMode: 'none' })
  expect(terminal.warnings.filter(warning => warning.code === 'ASCII_RENDER_FAILED')).toEqual([])
  expect(terminal.regions.filter(region => region.id.startsWith('note:')).sort((a, b) => a.id.localeCompare(b.id)).map(region => [region.id, region.parentId, region.projectedText])).toEqual([
    ['note:N1', 'Group', 'Inner <b>'], ['note:N2', undefined, 'Outer\nnext'],
  ])
  expect(terminal.regions.filter(region => region.kind === 'edge').map(region => [region.from, region.to])).toEqual(expect.arrayContaining([['A', 'Memo'], ['Memo', 'N2'], ['N2', 'Group']]))
  const receipt = terminalApi.renderMermaidASCIIWithReceipt(written, { useAscii: true, colorMode: 'none' })
  const document = terminalModel.terminalDocumentOf(receipt)
  if (!document) throw new Error('Expected retained terminal document')
  const entries = [...document.entries()]
  for (const edge of document.regions().filter(region => region.kind === 'edge')) {
    const start = edge.ports?.find(port => port.end === 'start'), end = edge.ports?.find(port => port.end === 'end')
    if (!start || !end) throw new Error(`Missing ports for ${edge.id}`)
    const ink = new Set(entries.filter(([, , cell]) => /stroke|marker/.test(cell.kind ?? '')
      && cell.owners.some(owner => owner.kind === 'edge' && owner.id === edge.id)
      && cell.glyph.trim()).map(([x, y]) => `${x},${y}`))
    const contacts = (port: typeof start) => [...ink].filter(key => {
      const [x, y] = key.split(',').map(Number)
      return Math.abs(x! - port.x) + Math.abs(y! - port.y) <= 1
    })
    for (const port of [start, end]) {
      expect(contacts(port).length).toBeGreaterThan(0)
      const frame = entries.filter(([x, y, cell]) => Math.abs(x - port.x) + Math.abs(y - port.y) <= 1
        && /stroke|marker/.test(cell.kind ?? '') && cell.owners.some(owner => owner.id === port.nodeId && ['node', 'note', 'cluster', 'group'].includes(owner.kind ?? 'node')))
      expect(contacts(port).some(key => {
        const [x, y] = key.split(',').map(Number)
        return frame.some(([fx, fy]) => Math.abs(fx - x!) + Math.abs(fy - y!) <= 1)
      })).toBe(true)
    }
    const queue = contacts(start), seen = new Set(queue)
    for (let at = 0; at < queue.length; at++) {
      const [x, y] = queue[at]!.split(',').map(Number)
      for (const next of [`${x! - 1},${y}`, `${x! + 1},${y}`, `${x},${y! - 1}`, `${x},${y! + 1}`]) {
        if (ink.has(next) && !seen.has(next)) { seen.add(next); queue.push(next) }
      }
    }
    expect(contacts(end).some(key => seen.has(key)), `${edge.from}->${edge.to} has connected emitted ink`).toBe(true)
  }

})

semantic('Mindmap escaped labels retain anonymous identities, formatting and nested ownership', 'packages/mermaid/src/diagrams/mindmap/parser/mindmap.jison: NSTR/NSTR2 and nodeWithoutId', async () => {
  const source = 'mindmap\nroot(R &amp; D)\n  ["`Say "hi" and `tick``"]\n    nested[Child]\n  {{%%{t}}'
  const parsed = am.parseRegisteredMermaid(source)
  if (!parsed.ok || parsed.value.body.kind !== 'mindmap') throw new Error('Expected editable Mindmap')
  const expected = parsed.value.body.root
  expect(expected.label).toBe('R & D')
  expect(expected.children.map(node => [node.id, node.label, node.children.map(child => child.id)])).toEqual([
    ['Say "hi" and `tick`', 'Say "hi" and `tick`', ['nested']], ['%%{t', '%%{t', []],
  ])
  const written = am.serializeMermaid(parsed.value)
  await accepted(written)
  expect(am.renderMermaidSVG(written)).toBe(am.renderMermaidSVG(source))
  expect(am.renderMermaidASCII(written)).toBe(am.renderMermaidASCII(source))
  const reload = am.parseRegisteredMermaid(written)
  if (!reload.ok || reload.value.body.kind !== 'mindmap') throw new Error('Expected editable Mindmap reload')
  expect(reload.value.body.root).toEqual(expected)
  const edited = am.mutate(parsed.value, { kind: 'rename_node', from: '%%{t', to: 'literal' })
  if (!edited.ok) throw new Error(edited.error.message)
  await accepted(am.serializeMermaid(edited.value))
  expect(am.renderMermaidSVG(edited.value)).toContain('Say &quot;hi&quot; and `tick`')
  expect(am.renderMermaidASCII(edited.value)).toContain('Say "hi" and `tick`')
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
    writeFileSync(reportPath, JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), reference: admittedReference ?? PIN, target, assertions: results, syntaxQualifications, diagnostics, note: 'Only the selected semantic assertions gate success. Diagnostic syntax gaps and upstream-negative acceptance are informational. SVG checks assert authored identity and content, not Mermaid layout or appearance.' }, null, 2) + '\n')
    console.log(`Modern semantic assertions: ${results.filter(result => result.status === 'passed').length}/${results.length} qualified; unavailable: ${results.filter(result => result.status === 'unavailable').length}; diagnostic probes: ${diagnostics.length}; ${reportPath}`)
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
  semantic(`independent label surfaces: ${family.id}`, 'FamilyDescriptor.example through independent DB, tagged Event Modeling parser AST or tagged public ZenUML rendered SVG text', async () => {
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
