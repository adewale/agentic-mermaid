import { describe, expect, test } from 'bun:test'

import { parseMermaid as parseGraph } from '../parser.ts'
import { coalesceFlowchartLines } from '../flowchart-lexer.ts'
import { parseRegisteredMermaid as parseMermaid, serializeMermaid, verifyMermaid } from '../agent/index.ts'
import { renderMermaidSVG } from '../index.ts'
import { applyOps } from '../agent/core.ts'
import { renderMermaidASCIIWithMeta } from '../ascii/meta.ts'
import { startUpstreamMermaid } from './helpers/upstream-mermaid.ts'
import { expectNearLinearGrowth } from './helpers/complexity.ts'

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
  test('anonymous group titles containing link syntax write a valid stable identifier', async () => {
    const source = 'graph TD;A-->B;subgraph "title in quotes --xs";c-->d;end;'
    const diagram = parseAgent(source)
    const serialized = serializeMermaid(diagram)
    const upstream = startUpstreamMermaid()
    try {
      expect(await upstream.accepts(source)).toBe(true)
      expect(await upstream.accepts(serialized), serialized).toBe(true)
    } finally { upstream.close() }
    for (const text of [source, serialized]) {
      const graph = parseGraph(text)
      expect(graph.subgraphs[0]?.label).toBe('title in quotes --xs')
      expect(graph.subgraphs[0]?.nodeIds).toEqual(['c', 'd'])
      expect(graph.edges.map(edge => [edge.source, edge.target])).toEqual([['A', 'B'], ['c', 'd']])
    }
    expect(serializeMermaid(parseAgent(serialized))).toBe(serialized)
  })

  test('anonymous group IDs reserve authored nodes and containers regardless of declaration order', async () => {
    const declarations = 'subgraph "A--B"\nD[Delta]\nend\nsubgraph "A  B"\nE[Echo]\nend'
    const authored = 'A_B[Important]\nA_B_2[Also important]\nsubgraph A_B_3[Explicit]\nC[Charlie]\nend'
    const upstream = startUpstreamMermaid()
    try {
      for (const source of [`flowchart TD\n${authored}\n${declarations}`, `flowchart TD\n${declarations}\n${authored}`]) {
        expect(await upstream.accepts(source)).toBe(true)
        const serialized = serializeMermaid(parseAgent(source))
        expect(await upstream.accepts(serialized), serialized).toBe(true)
        for (const text of [source, serialized]) {
          const graph = parseGraph(text)
          expect(graph.nodes.get('A_B')?.label).toBe('Important')
          expect(graph.nodes.get('A_B_2')?.label).toBe('Also important')
          expect(graph.subgraphs.map(group => [group.label, group.nodeIds]).sort()).toEqual([
            ['A  B', ['E']], ['A--B', ['D']], ['Explicit', ['C']],
          ])
          expect(new Set(graph.subgraphs.map(group => group.id)).size).toBe(3)
          expect(graph.subgraphs.every(group => !graph.nodes.has(group.id))).toBe(true)
          const svg = renderMermaidSVG(text)
          for (const label of ['Important', 'Also important', 'Explicit', 'Delta', 'Echo']) expect(svg).toContain(label)
        }
        expect(serializeMermaid(parseAgent(serialized))).toBe(serialized)
      }
    } finally { upstream.close() }
  })

  test('anonymous IDs cannot hide endpoints in compact marker links', () => {
    const source = 'flowchart TD\nXo--xY\nsubgraph "X?"\nA\nend\nsubgraph "Y?"\nB\nend'
    for (const text of [source, serializeMermaid(parseAgent(source))]) {
      const graph = parseGraph(text)
      expect([...graph.nodes.keys()].sort()).toEqual(['A', 'B', 'X', 'Y'])
      expect(graph.edges.map(edge => [edge.source, edge.target, edge.startMarker, edge.endMarker])).toEqual([['X', 'Y', 'circle', 'cross']])
      expect(graph.subgraphs.every(group => !graph.nodes.has(group.id))).toBe(true)
    }
  })

  test.each([
    ['A<br>B', 'A\\nB', 'A\nB'],
    ['A--B', 'A#45;#45;B', 'A--B'],
  ])('distinct anonymous spellings retain separate groups with the same visible title: %s / %s', (first, second, label) => {
    const source = `flowchart TD\nsubgraph "${first}"\nX\nend\nsubgraph "${second}"\nY\nend`
    for (const text of [source, serializeMermaid(parseAgent(source))]) {
      const graph = parseGraph(text)
      expect(graph.subgraphs.map(group => [group.label, group.nodeIds])).toEqual([[label, ['X']], [label, ['Y']]])
      expect(new Set(graph.subgraphs.map(group => group.id)).size).toBe(2)
      expect(renderMermaidSVG(text).match(/class="subgraph"/g)).toHaveLength(2)
    }
  })

  test.each([
    ['direct', 'subgraph S[First]\nsubgraph S[First]\nA[Alpha]\nend\nB[Beta]\nend', ['A', 'B'], []],
    ['through another group', 'subgraph S[First]\nsubgraph T[Middle]\nsubgraph S[First]\nA[Alpha]\nend\nB[Beta]\nend\nC[Gamma]\nend', ['A', 'C'], ['B']],
  ] as const)('nested redeclaration %s keeps one acyclic group and all authored nodes', (_name, body, members, innerMembers) => {
    const source = `flowchart LR\n${body}\nA e1@-->B\nB e2@-->A`
    const canonical = serializeMermaid(parseAgent(source))
    for (const text of [source, canonical]) {
      const graph = parseGraph(text)
      expect(graph.subgraphs).toHaveLength(1)
      const group = graph.subgraphs[0]!
      expect(group).toMatchObject({ id: 'S', label: 'First', nodeIds: [...members] })
      expect(group.children.map(child => child.id)).toEqual(innerMembers.length ? ['T'] : [])
      if (innerMembers.length) expect(group.children[0]).toMatchObject({ id: 'T', nodeIds: [...innerMembers], children: [] })
      expect(graph.edges.map(edge => [edge.source, edge.target])).toEqual([['A', 'B'], ['B', 'A']])
      const svg = renderMermaidSVG(text)
      const terminal = renderMermaidASCIIWithMeta(text, { colorMode: 'none' })
      for (const [id, label] of [['A', 'Alpha'], ['B', 'Beta'], ...(innerMembers.length ? [['C', 'Gamma']] : [])]) {
        expect(svg.match(new RegExp(`class="node[^\\"]*" data-id="${id}"`, 'g'))).toHaveLength(1)
        expect(svg).toContain(label!)
        expect(terminal.ascii).toContain(label!)
        expect(terminal.regions.find(region => region.id === id)?.parentId).toBe(id === 'B' && innerMembers.length ? 'T' : 'S')
      }
    }
  })

  test.each(['', 'subgraph Outer[Outside]\n'])('repeated containers keep their members and reciprocal edges in every output: %s', outer => {
    const source = `flowchart LR\n${outer}subgraph S[First]\nA[Alpha]\nend\nsubgraph S[Later]\nB[Beta]\nend\n${outer ? 'end\n' : ''}A e1@-->B\nB e2@-->A`
    const edited = applyOps({ source, ops: [{ kind: 'add_node', id: 'C', label: 'Gamma' }] })
    expect(edited.ok).toBe(true)
    if (!edited.ok) return
    for (const text of [source, edited.source]) {
      const graph = parseGraph(text)
      const containers = outer ? graph.subgraphs[0]!.children : graph.subgraphs
      expect(containers).toHaveLength(1)
      expect(containers[0]).toMatchObject({ id: 'S', label: 'First', nodeIds: ['A', 'B'] })
      expect(graph.edges.map(edge => [edge.id, edge.source, edge.target])).toEqual([['e1', 'A', 'B'], ['e2', 'B', 'A']])
      const svg = renderMermaidSVG(text)
      expect(svg.match(/class="node[^\"]*" data-id="A"/g)).toHaveLength(1)
      expect(svg.match(/class="node[^\"]*" data-id="B"/g)).toHaveLength(1)
      expect(svg).toContain('Alpha')
      expect(svg).toContain('Beta')
      expect(svg).toContain('data-from="A" data-to="B"')
      expect(svg).toContain('data-from="B" data-to="A"')
      const terminal = renderMermaidASCIIWithMeta(text, { colorMode: 'none' })
      expect(terminal.ascii).toContain('Alpha')
      expect(terminal.ascii).toContain('Beta')
      expect(terminal.ascii).toContain('First')
      for (const [id, from, to] of [['e1', 'A', 'B'], ['e2', 'B', 'A']]) {
        const region = terminal.regions.find(region => region.id === id)!
        expect(region).toMatchObject({ kind: 'edge', from, to })
        const rows = terminal.ascii.split('\n')
        const ink = region.ownedCellSpans!.map(span => rows[span.row]!.slice(span.start, span.end)).join('')
        expect(ink).toMatch(/[►◄▼▲]/)
      }
      for (const id of ['A', 'B']) expect(terminal.regions.find(region => region.id === id)?.parentId).toBe('S')
    }
  })

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

  test('partially consumed statements fail closed instead of inventing or dropping content', () => {
    for (const statement of [
      'frobnicate keep-me',
      'A -- bad ??? B',
      'A -->',
      // A `&` takes its node from its own line, as upstream: none follows.
      'A --> B &',
      'A &\n  B --> C',
      'A --> B & \n  C',
      // A link at a line's end does not take in a keyword: `end` is no node.
      'subgraph X\n  B -->\n  end',
      // A string opened after other title text is not the title's, as upstream.
      'subgraph X "title\n  more"\n  C\n  end',
    ]) {
      const source = `flowchart TD\n  A --> B\n  ${statement}`
      expect(() => parseGraph(source), statement).toThrow(/fully consume|invalid flowchart statement/i)
      const parsed = parseMermaid(source)
      expect(parsed.ok, statement).toBe(false)
    }
  })

  // Upstream's lexer reads a string, a label's text and a text-arrow label
  // across line breaks, and its link token takes the whitespace around it,
  // line breaks included (flow.jison), so one statement may span lines.
  test.each([
    ['A["line1\n  line2"] --> B', ['A:rectangle:line1\nline2', 'B:rectangle:B', 'A-solid->B']],
    ['A[l1\n  l2] --> B', ['A:rectangle:l1\nl2', 'B:rectangle:B', 'A-solid->B']],
    ['A(r\n  t)', ['A:rounded:r\nt']],
    ['A{d\n  m}', ['A:diamond:d\nm']],
    // The render path decodes `&quot;` to a `"` in the middle of the text.
    ['A[x &quot;\n  y] --> B', ['A:rectangle:x &quot;\ny', 'B:rectangle:B', 'A-solid->B']],
    ['A -->|some\n  text| B', ['A:rectangle:A', 'B:rectangle:B', 'A-solid->B:some\ntext']],
    ['A -- some\n  text --> B', ['A:rectangle:A', 'B:rectangle:B', 'A-solid->B:some\ntext']],
    // Upstream trims a label, so a break at either end of it is not text.
    ['A -- some\n  --> B', ['A:rectangle:A', 'B:rectangle:B', 'A-solid->B:some']],
    ['A[\n  foo]', ['A:rectangle:foo']],
    ['A -->\n  B', ['A:rectangle:A', 'B:rectangle:B', 'A-solid->B']],
    ['A ==>\n  B', ['A:rectangle:A', 'B:rectangle:B', 'A-thick->B']],
    ['A -.->\n\n  %% note\n  B', ['A:rectangle:A', 'B:rectangle:B', 'A-dotted->B']],
    ['A["a"] -->\n   B -->\n   C', ['A:rectangle:a', 'B:rectangle:B', 'C:rectangle:C', 'A-solid->B', 'B-solid->C']],
    ['A\n  --> B', ['A:rectangle:A', 'B:rectangle:B', 'A-solid->B']],
    ['A --> B\n  --> C', ['A:rectangle:A', 'B:rectangle:B', 'C:rectangle:C', 'A-solid->B', 'B-solid->C']],
    // Upstream folds `\nx-->` into one link and loses x; ours keeps the node.
    ['A --> B\n  x--> C', ['A:rectangle:A', 'B:rectangle:B', 'x:rectangle:x', 'C:rectangle:C', 'A-solid->B', 'x-solid->C']],
    // Upstream's `end` token takes the whitespace after it.
    ['subgraph S\n    A\n  end B', ['A:rectangle:A', 'B:rectangle:B', 'S:S{A}']],
    // Its link token takes the whitespace after it, so a pipe label may follow
    // a space, or start the next line.
    ['A --> |yes| B', ['A:rectangle:A', 'B:rectangle:B', 'A-solid->B:yes']],
    ['A ==> |"y e"| B', ['A:rectangle:A', 'B:rectangle:B', 'A-thick->B:y e']],
    ['A -->\n  |yes| B', ['A:rectangle:A', 'B:rectangle:B', 'A-solid->B:yes']],
    // A subgraph's `id[…]` title is a label, which runs on across lines.
    ['subgraph S[a\n    b]\n    A\n  end', ['A:rectangle:A', 'S:a\nb{A}']],
    ['subgraph S["a\n    b"]\n    A\n  end', ['A:rectangle:A', 'S:a\nb{A}']],
  ])('%j is read alike by the renderer, the typed body, its output and verify', (body, expected) => {
    const readingOf = (graph: ReturnType<typeof parseGraph>) => [
      ...[...graph.nodes.values()].map(node => `${node.id}:${node.shape}:${node.label}`),
      ...graph.edges.map(edge => `${edge.source}-${edge.style}->${edge.target}${edge.label ? `:${edge.label}` : ''}`),
      ...graph.subgraphs.map(group => `${group.id}:${group.label}{${group.nodeIds.join(' ')}}`),
    ]
    const source = `flowchart TD\n  ${body}`
    expect(readingOf(parseGraph(source))).toEqual(expected)
    const typed = parseAgent(source)
    expect(typed.body.kind === 'flowchart' && readingOf(typed.body.graph)).toEqual(expected)
    expect(readingOf(parseGraph(serializeMermaid(typed)))).toEqual(expected)
    const verify = verifyMermaid(source)
    expect(verify.ok).toBe(true)
    expect(verify.warnings.filter(warning => warning.code === 'UNSUPPORTED_SYNTAX')).toEqual([])
  })

  // A statement after `;` on the header line runs on as on a line of its own.
  test.each(['A["x\n  y"]', 'A -->|x\n  y| B'])('%j after the header reads and verifies as on its own line', body => {
    const source = `flowchart TD;${body}`
    expect(parseAgent(source).body).toEqual(parseAgent(`flowchart TD\n  ${body}`).body)
    expect(verifyMermaid(source).warnings.filter(warning => warning.code === 'UNSUPPORTED_SYNTAX')).toEqual([])
  })

  // A later node's `]` or `"` does not close the title either.
  test.each([
    ['subgraph S[a\n    A --> B\n  end', ['A->B'], [['A', 'B']]],
    ['subgraph S[Stage one\n    a1 --> a2\n  end\n  subgraph T[Two]\n    b1\n  end', ['a1->a2'], [['a1', 'a2'], ['b1']]],
    ['subgraph one[Stage one\n    a1[Start] --> a2[Middle]\n  end\n  a2 --> b1[Finish]', ['a1->a2', 'a2->b1'], [['a1', 'a2']]],
    ['subgraph "Stage one\n    A --> B["x"]\n  end\n  C --> A', ['A->B', 'C->A'], [['A', 'B']]],
  ])('an unclosed subgraph title does not take in the statements after it: %j', (body, edges, members) => {
    const graph = parseGraph(`flowchart TD\n  ${body}`)
    expect(graph.edges.map(edge => `${edge.source}->${edge.target}`)).toEqual(edges)
    expect(graph.subgraphs.map(group => group.nodeIds)).toEqual(members)
  })

  // Upstream nests no shape text, so a line left deeper ends where it ends;
  // a text-arrow label carries its stroke, not its opener, onto each line.
  test('lines that leave text open are joined in linear time', () => {
    expect(() => parseGraph(`flowchart TD\n${'A[x\n'.repeat(12)}`)).toThrow()
    expectNearLinearGrowth('nested shape text', size => {
      coalesceFlowchartLines(Array.from({ length: size }, () => 'A[x'))
    }, 8_000)
    expectNearLinearGrowth('a long text-arrow opener', size => {
      const lines = [`A -${'.'.repeat(size)} x`, ...Array.from({ length: size }, () => 'y'), 'z .-> B']
      expect(coalesceFlowchartLines(lines)).toHaveLength(1)
    }, 32_000)
  })

  test('root direction directives override the graph without becoming phantom nodes', () => {
    const source = 'flowchart TD\n  direction LR\n  A --> B'
    const graph = parseGraph(source)
    expect(graph.direction).toBe('LR')
    expect([...graph.nodes.keys()]).toEqual(['A', 'B'])
    expect(edgeTriples(source)).toEqual([['A', 'B', undefined]])
    expect(serializeMermaid(parseAgent(source))).toStartWith('flowchart LR\n')
  })

  test('quoted edge labels may contain closer and pipe syntax without ending early', () => {
    const textArrow = 'flowchart LR\n  A -- "go --> now" --> B --> C'
    expect(edgeTriples(textArrow)).toEqual([
      ['A', 'B', 'go --> now'],
      ['B', 'C', undefined],
    ])

    const pipeArrow = 'flowchart LR\n  A -->|"left | right"| B --> C'
    expect(edgeTriples(pipeArrow)).toEqual([
      ['A', 'B', 'left | right'],
      ['B', 'C', undefined],
    ])

    const marker = parseGraph('flowchart LR\n  A e1@-- "not --x yet" --x B --> C')
    expect(marker.edges[0]).toMatchObject({ id: 'e1', label: 'not --x yet', endMarker: 'cross' })
    expect(marker.edges[1]).toMatchObject({ source: 'B', target: 'C' })
    expect(marker.edges[1]!.id).toBeUndefined()
  })

  test('unterminated quoted edge syntax fails closed', () => {
    for (const statement of ['A -- "only --> inside" B', 'A -->|"left | right" B']) {
      expect(() => parseGraph(`flowchart LR\n  ${statement}`), statement).toThrow(/fully consume/i)
    }
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

  test('same-line rendered metadata canonicalizes to typed structure without semantic loss', () => {
    const clickSource = 'flowchart LR\n  A-->B; click A href "https://example.com"\n'
    const clickDiagram = parseAgent(clickSource)
    expect(clickDiagram.body.kind).toBe('flowchart')
    expect(serializeMermaid(clickDiagram)).toBe('flowchart LR\n  A --> B\n  click A href "https://example.com"\n')
    expect(renderMermaidSVG(clickSource)).toContain('data-href="https://example.com"')

    const metadataSource = 'flowchart LR\n  A e1@--> B; e1@{ animate: true }\n'
    const metadataDiagram = parseAgent(metadataSource)
    expect(metadataDiagram.body.kind).toBe('flowchart')
    expect(serializeMermaid(metadataDiagram)).toBe('flowchart LR\n  A e1@--> B\n  e1@{ animate: true }\n')
    const syntaxes = verifyMermaid(metadataSource).warnings.map(w => w.code === 'UNSUPPORTED_SYNTAX' ? w.syntax : '').filter(Boolean)
    expect(syntaxes).not.toContain('flowchart_opaque')
    expect(renderMermaidSVG(metadataSource)).toContain('data-animate="true"')
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

  test('safe click/href directives render inert link metadata without phantom nodes', () => {
    const source = 'flowchart LR\n  A-->B\n  click A href "https://example.com"\n'
    const graph = parseGraph(source)
    expect([...graph.nodes.keys()]).toEqual(['A', 'B'])
    expect(graph.nodes.has('click')).toBe(false)
    expect(graph.edges.map(e => `${e.source}->${e.target}`)).toEqual(['A->B'])

    const diagram = parseAgent(source)
    expect(diagram.body.kind).toBe('flowchart')
    expect(serializeMermaid(diagram)).toBe('flowchart LR\n  A --> B\n  click A href "https://example.com"\n')
    expect(graph.nodes.get('A')?.href).toBe('https://example.com')
    expect(renderMermaidSVG(source)).toContain('data-href="https://example.com" role="link"')
    expect(verifyMermaid(source).warnings).not.toContainEqual(expect.objectContaining({ syntax: 'flowchart_interaction_directive' }))
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
    expect(edgeMeta).not.toContain('flowchart_opaque')
    expect(edgeMeta).not.toContain('flowchart_edge_metadata')
    expect(edgeMeta).not.toContain('flowchart_node_metadata')

    // The multiline block (the form Mermaid's docs use) behaves like the
    // single-line form: documented shapes are modeled with native semantic geometry.
    const multiline = verifyMermaid('flowchart TD\n  C@{\n    shape: delay\n    label: "Wait"\n  }\n  C --> D\n')
    expect(multiline.ok).toBe(true)
    expect(multiline.warnings).not.toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax: 'flowchart_node_metadata' }))
    expect(multiline.warnings).not.toContainEqual(expect.objectContaining({ syntax: 'flowchart_shape_substitution' }))
  })

  test('class shorthand before compact arrows keeps the edge and escaped classDef commas', () => {
    const graph = parseGraph('flowchart LR\n  A:::animate-->B\n  classDef animate stroke-dasharray: 9\\,5,stroke:#333;')
    expect(graph.edges.map(e => `${e.source}->${e.target}`)).toEqual(['A->B'])
    expect(graph.classAssignments.get('A')).toBe('animate')
    expect(graph.classDefs.get('animate')).toEqual({ 'stroke-dasharray': '9,5', stroke: '#333' })
  })
})
