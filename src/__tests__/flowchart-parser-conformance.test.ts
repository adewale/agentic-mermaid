import { describe, expect, test } from 'bun:test'

import { parseMermaid as parseGraph } from '../parser.ts'
import { parseMermaid, serializeMermaid, verifyMermaid } from '../agent/index.ts'

function nodeIds(source: string): string[] {
  return [...parseGraph(source).nodes.keys()]
}

function edgeTriples(source: string): Array<[string, string, string | undefined]> {
  return parseGraph(source).edges.map(e => [e.source, e.target, e.label])
}

function parseAgent(source: string) {
  const parsed = parseMermaid(source)
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
  return parsed.value
}

describe('flowchart parser conformance safety floor (issue #36)', () => {
  test.each([
    ['flowchart LR\n  A-->B', ['A', 'B'], [['A', 'B', undefined]]],
    ['flowchart LR\n  A-->|text|B', ['A', 'B'], [['A', 'B', 'text']]],
    ['flowchart LR\n  A-- text -->B', ['A', 'B'], [['A', 'B', 'text']]],
    ['flowchart LR\n  A-.->B;', ['A', 'B'], [['A', 'B', undefined]]],
    ['flowchart LR\n  node-1-->node-2', ['node-1', 'node-2'], [['node-1', 'node-2', undefined]]],
  ] as const)('compact edge syntax preserves topology: %s', (source, expectedNodes, expectedEdges) => {
    expect(nodeIds(source)).toEqual([...expectedNodes])
    expect(edgeTriples(source)).toEqual(expectedEdges.map(([source, target, label]) => [source, target, label]))
    expect(verifyMermaid(source).layout.edges).toHaveLength(expectedEdges.length)
  })

  test('compact marker syntax keeps the target instead of fabricating a shaft node', () => {
    const graph = parseGraph('flowchart LR\n  A---oB')
    expect([...graph.nodes.keys()]).toEqual(['A', 'B'])
    expect(graph.edges).toHaveLength(1)
    expect(graph.edges[0]).toMatchObject({ source: 'A', target: 'B', endMarker: 'circle', hasArrowEnd: true })
  })

  test('compact edge target may be an inline node definition without being swallowed as an asymmetric source', () => {
    const source = 'flowchart TD\n  B["fa:fa-twitter for peace"]\n  B-->C["fab:fa-truck-bold a custom icon"]'
    const graph = parseGraph(source)
    expect([...graph.nodes.keys()]).toEqual(['B', 'C'])
    expect(graph.nodes.get('B')?.label).toBe('fa:fa-twitter for peace')
    expect(graph.nodes.get('C')?.label).toBe('fab:fa-truck-bold a custom icon')
    expect(graph.edges.map(e => `${e.source}->${e.target}`)).toEqual(['B->C'])
    const diagram = parseAgent(source)
    const serialized = serializeMermaid(diagram)
    const reparsed = parseAgent(serialized)
    expect(serializeMermaid(reparsed)).toBe(serialized)
  })

  test('compact ampersand fanout matches the documented expanded form', () => {
    const graph = parseGraph('flowchart TB\n  A & B--> C & D')
    expect([...graph.nodes.keys()]).toEqual(['A', 'B', 'C', 'D'])
    expect(graph.edges.map(e => `${e.source}->${e.target}`).sort()).toEqual([
      'A->C', 'A->D', 'B->C', 'B->D',
    ])
  })

  test('same-line semicolon statements are parsed instead of silently dropping later statements', () => {
    const graph = parseGraph('flowchart LR\n  A-->B; B-->C')
    expect([...graph.nodes.keys()]).toEqual(['A', 'B', 'C'])
    expect(graph.edges.map(e => `${e.source}->${e.target}`)).toEqual(['A->B', 'B->C'])
  })

  test('semicolon splitting preserves semicolons inside edge labels', () => {
    expect(edgeTriples('flowchart LR\n  A -->|x;y| B; B --> C')).toEqual([
      ['A', 'B', 'x;y'],
      ['B', 'C', undefined],
    ])
    expect(edgeTriples('flowchart LR\n  A -- x;y;z --> B; B --> C')).toEqual([
      ['A', 'B', 'x;y;z'],
      ['B', 'C', undefined],
    ])
  })

  test('same-line unsupported statements are preserved and warned instead of dropped', () => {
    const clickSource = 'flowchart LR\n  A-->B; click A href "https://example.com"\n'
    const clickDiagram = parseAgent(clickSource)
    expect(clickDiagram.body.kind).toBe('opaque')
    expect(serializeMermaid(clickDiagram)).toBe(clickSource)
    expect(verifyMermaid(clickSource).warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax: 'flowchart_interaction_directive', line: 2 }))

    const metadataSource = 'flowchart LR\n  A e1@--> B; e1@{ animate: true }\n'
    const metadataDiagram = parseAgent(metadataSource)
    expect(metadataDiagram.body.kind).toBe('opaque')
    expect(serializeMermaid(metadataDiagram)).toBe(metadataSource)
    const syntaxes = verifyMermaid(metadataSource).warnings.map(w => w.code === 'UNSUPPORTED_SYNTAX' ? w.syntax : '').filter(Boolean)
    expect(syntaxes).toContain('flowchart_edge_metadata')
    // Edge IDs themselves are modeled structured identity now — no lint.
    expect(syntaxes).not.toContain('flowchart_edge_id')
  })

  test('edge IDs on text-label arrows are modeled without scanning inside labels', () => {
    const source = 'flowchart LR\n  A e1@-- text --> B\n'
    expect(edgeTriples(source)).toEqual([['A', 'B', 'text']])
    expect(edgeTriples('flowchart LR\n  A e1@-- x;y;z --> B')).toEqual([['A', 'B', 'x;y;z']])
    const diagram = parseAgent(source)
    expect(diagram.body.kind).toBe('flowchart')
    // Canonical serialization uses the pipe-label form; the authored ID and
    // canonical form are round-trip stable.
    const serialized = serializeMermaid(diagram)
    expect(serialized).toBe('flowchart LR\n  A e1@-->|text| B\n')
    expect(serializeMermaid(parseAgent(serialized))).toBe(serialized)

    const labelOnly = 'flowchart LR\n  A -->|email e1@--> text| B\n'
    expect(parseAgent(labelOnly).body.kind).toBe('flowchart')
    expect(parseGraph(labelOnly).edges[0]!.id).toBeUndefined()
  })

  test('edge IDs are modeled as structured identity (no lint, byte round-trip)', () => {
    const source = 'flowchart LR\n  A e1@--> B\n'
    const graph = parseGraph(source)
    expect([...graph.nodes.keys()]).toEqual(['A', 'B'])
    expect(graph.edges.map(e => `${e.source}->${e.target}`)).toEqual(['A->B'])
    expect(graph.edges[0]!.id).toBe('e1')

    const diagram = parseAgent(source)
    expect(diagram.body.kind).toBe('flowchart')
    expect(serializeMermaid(diagram)).toBe(source)

    const verify = verifyMermaid(source)
    expect(verify.ok).toBe(true)
    expect(verify.layout.edges.map(e => `${e.from}->${e.to}`)).toEqual(['A->B'])
    expect(verify.warnings).not.toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax: 'flowchart_edge_id' }))
  })

  test('edge metadata is preserved as opaque source and never parsed as a phantom node', () => {
    const source = 'flowchart LR\n  A e1@==> B\n  e1@{ animate: true }\n'
    const graph = parseGraph(source)
    expect([...graph.nodes.keys()].sort()).toEqual(['A', 'B'])
    expect(graph.nodes.has('e1')).toBe(false)
    expect(graph.edges.map(e => `${e.source}->${e.target}:${e.style}`)).toEqual(['A->B:thick'])

    const diagram = parseAgent(source)
    expect(diagram.body.kind).toBe('opaque')
    expect(serializeMermaid(diagram)).toBe(source)

    const warnings = verifyMermaid(source).warnings
    expect(warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax: 'flowchart_edge_metadata', line: 3 }))
  })

  test('click/href directives are source-preserved and ignored for local layout without phantom nodes', () => {
    const source = 'flowchart LR\n  A-->B\n  click A href "https://example.com" "open docs"\n'
    const graph = parseGraph(source)
    expect([...graph.nodes.keys()]).toEqual(['A', 'B'])
    expect(graph.nodes.has('click')).toBe(false)
    expect(graph.edges.map(e => `${e.source}->${e.target}`)).toEqual(['A->B'])

    const diagram = parseAgent(source)
    expect(diagram.body.kind).toBe('opaque')
    expect(serializeMermaid(diagram)).toBe(source)
    expect(verifyMermaid(source).warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax: 'flowchart_interaction_directive', line: 3 }))
  })

  test('markdown-string labels are source-preserved and warned, never silently dropped', () => {
    const source = 'flowchart LR\n  A["`**bold** text`"] --> B\n'
    const diagram = parseAgent(source)
    expect(diagram.body.kind).toBe('opaque')
    expect(serializeMermaid(diagram)).toBe(source)
    const verify = verifyMermaid(source)
    expect(verify.ok).toBe(true)
    expect(verify.warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax: 'flowchart_markdown_string', line: 2 }))
  })

  test('node metadata @{ shape } is modeled for documented names, opaque + warned otherwise, no phantom nodes', () => {
    const source = 'flowchart LR\n  A@{ shape: rounded, label: "Start" }\n  A --> B\n'
    const graph = parseGraph(source)
    expect([...graph.nodes.keys()].sort()).toEqual(['A', 'B'])
    expect(graph.nodes.has('shape')).toBe(false)
    expect(graph.nodes.has('label')).toBe(false)
    expect(graph.nodes.get('A')).toMatchObject({ shape: 'rounded', semanticShape: 'rounded', label: 'Start' })

    // Documented shape/label metadata is STRUCTURED now (repo #44): the
    // canonical serialization keeps the authored spelling and is stable.
    const diagram = parseAgent(source)
    expect(diagram.body.kind).toBe('flowchart')
    const serialized = serializeMermaid(diagram)
    expect(serialized).toContain('A@{ shape: rounded, label: "Start" }')
    expect(serializeMermaid(parseAgent(serialized))).toBe(serialized)

    const verify = verifyMermaid(source)
    expect(verify.ok).toBe(true)
    expect(verify.warnings).not.toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax: 'flowchart_node_metadata' }))

    // UNDOCUMENTED shape names keep the lossless opaque fallback + loud lint.
    const unknown = 'flowchart LR\n  A@{ shape: zigzag, label: "Start" }\n  A --> B\n'
    const unknownDiagram = parseAgent(unknown)
    expect(unknownDiagram.body.kind).toBe('opaque')
    expect(serializeMermaid(unknownDiagram)).toBe(unknown)
    expect(verifyMermaid(unknown).warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax: 'flowchart_node_metadata', line: 2 }))

    // Edge metadata must NOT be reclassified as node metadata.
    const edgeMeta = verifyMermaid('flowchart LR\n  A e1@==> B\n  e1@{ animate: true }\n').warnings
      .map(w => w.code === 'UNSUPPORTED_SYNTAX' ? w.syntax : '').filter(Boolean)
    expect(edgeMeta).toContain('flowchart_edge_metadata')
    expect(edgeMeta).not.toContain('flowchart_node_metadata')

    // The multiline block (the form Mermaid's docs use) behaves like the
    // single-line form: documented shapes are modeled, and an approximate
    // geometry announces its substitution (delay renders as rounded).
    const multiline = verifyMermaid('flowchart TD\n  C@{\n    shape: delay,\n    label: "Wait"\n  }\n  C --> D\n')
    expect(multiline.ok).toBe(true)
    expect(multiline.warnings).not.toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax: 'flowchart_node_metadata' }))
    expect(multiline.warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax: 'flowchart_shape_substitution', node: 'C' }))
  })

  test('class shorthand before compact arrows keeps the edge and escaped classDef commas', () => {
    const graph = parseGraph('flowchart LR\n  A:::animate-->B\n  classDef animate stroke-dasharray: 9\\,5,stroke:#333;')
    expect(graph.edges.map(e => `${e.source}->${e.target}`)).toEqual(['A->B'])
    expect(graph.classAssignments.get('A')).toBe('animate')
    expect(graph.classDefs.get('animate')).toEqual({ 'stroke-dasharray': '9,5', stroke: '#333' })
  })
})
