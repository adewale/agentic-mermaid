import { afterAll, beforeAll, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { decodeXML } from 'entities'
import ts from 'typescript'
import { admitCurrentReference, currentReferencePin, startModernReference, type ReferenceReply } from './reference.ts'
import { startGrammarReference } from './grammar-reference.ts'
import type { FlowchartValidDiagram } from '../../src/agent/types.ts'

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
  })
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
        if (ts.isCallExpression(child) && child.arguments[0] && ts.isStringLiteralLike(child.arguments[0]) && /^(?:flowchart|graph|stateDiagram)\b/.test(child.arguments[0].text)) source = child.arguments[0].text
        if (ts.isVariableDeclaration(child) && child.initializer && ts.isStringLiteralLike(child.initializer) && /^(?:flowchart|graph|stateDiagram)\b/.test(child.initializer.text)) source = child.initializer.text
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
