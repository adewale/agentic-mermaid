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
    expect(syntaxes).toContain('flowchart_edge_id')
    expect(syntaxes).toContain('flowchart_edge_metadata')
  })

  test('edge-id detection handles text-label arrows without scanning inside labels', () => {
    const source = 'flowchart LR\n  A e1@-- text --> B\n'
    expect(edgeTriples(source)).toEqual([['A', 'B', 'text']])
    expect(edgeTriples('flowchart LR\n  A e1@-- x;y;z --> B')).toEqual([['A', 'B', 'x;y;z']])
    const diagram = parseAgent(source)
    expect(diagram.body.kind).toBe('opaque')
    expect(serializeMermaid(diagram)).toBe(source)
    expect(verifyMermaid(source).warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax: 'flowchart_edge_id', line: 2 }))

    const labelOnly = 'flowchart LR\n  A -->|email e1@--> text| B\n'
    expect(parseAgent(labelOnly).body.kind).toBe('flowchart')
    expect(verifyMermaid(labelOnly).warnings).not.toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax: 'flowchart_edge_id' }))
  })

  test('edge IDs preserve topology and source while warning that edge identity is unmodeled', () => {
    const source = 'flowchart LR\n  A e1@--> B\n'
    const graph = parseGraph(source)
    expect([...graph.nodes.keys()]).toEqual(['A', 'B'])
    expect(graph.edges.map(e => `${e.source}->${e.target}`)).toEqual(['A->B'])

    const diagram = parseAgent(source)
    expect(diagram.body.kind).toBe('opaque')
    expect(serializeMermaid(diagram)).toBe(source)

    const verify = verifyMermaid(source)
    expect(verify.ok).toBe(true)
    expect(verify.layout.edges.map(e => `${e.from}->${e.to}`)).toEqual(['A->B'])
    expect(verify.warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax: 'flowchart_edge_id', line: 2 }))
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
    expect(warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax: 'flowchart_edge_id', line: 2 }))
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

  test('class shorthand before compact arrows keeps the edge and escaped classDef commas', () => {
    const graph = parseGraph('flowchart LR\n  A:::animate-->B\n  classDef animate stroke-dasharray: 9\\,5,stroke:#333;')
    expect(graph.edges.map(e => `${e.source}->${e.target}`)).toEqual(['A->B'])
    expect(graph.classAssignments.get('A')).toBe('animate')
    expect(graph.classDefs.get('animate')).toEqual({ 'stroke-dasharray': '9,5', stroke: '#333' })
  })
})
