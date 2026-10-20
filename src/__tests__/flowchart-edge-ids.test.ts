/**
 * Flowchart v11.6 edge IDs (`e1@-->`) as stable edge identity
 * (plan §Flowchart 7; upstream PR #6136).
 *
 * Contract:
 *  - the render parser carries the authored ID on MermaidEdge.id;
 *  - the agent parser stays STRUCTURED (edge IDs no longer force opaque) and
 *    the serializer re-emits `id@` verbatim before the arrow operator;
 *  - the SVG emits the authored ID as the edge's `data-id` (X4 identity
 *    contract — nodes/subgraphs already carry data-id, and keep it when an
 *    edge ID repeats theirs);
 *  - ops (remove_edge, set_label) target edges by authored ID as well as by
 *    the endpoint form `A->B`/`A->B#k`;
 *  - the flowchart_edge_id UNSUPPORTED_SYNTAX lint is retired (modeled now);
 *  - edge METADATA (`e1@{ animate: true }`) is typed on the structured body,
 *    round-trips byte-identically, and renders natively without the
 *    flowchart_edge_metadata lint.
 */
import { describe, it, expect } from 'bun:test'

import { parseMermaid as parseGraph } from '../parser.ts'
import { renderMermaidSVG } from '../index.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { lowerGraphScene } from '../renderer.ts'
import { asFlowchart, mutate, parseRegisteredMermaid as parseMermaid, serializeMermaid, verifyMermaid } from '../agent/index.ts'
import { startUpstreamMermaid } from './helpers/upstream-mermaid.ts'

const SOURCE = 'flowchart LR\n  A e1@--> B\n'

function parseAgent(source: string) {
  const parsed = parseMermaid(source)
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
  return parsed.value
}

describe('flowchart edge IDs — parse', () => {
  it('the render parser models the authored edge ID', () => {
    const graph = parseGraph(SOURCE)
    expect(graph.edges).toHaveLength(1)
    expect(graph.edges[0]!.id).toBe('e1')
    expect([...graph.nodes.keys()]).toEqual(['A', 'B'])
  })

  it('IDs ride every operator family (thick, dotted, text-label arrows)', () => {
    expect(parseGraph('flowchart LR\n  A e1@==> B').edges[0]!.id).toBe('e1')
    expect(parseGraph('flowchart LR\n  A e2@-.-> B').edges[0]!.id).toBe('e2')
    const text = parseGraph('flowchart LR\n  A e3@-- label --> B').edges[0]!
    expect(text.id).toBe('e3')
    expect(text.label).toBe('label')
  })

  // Upstream's LINK_ID is any run of non-space, non-`"` characters before
  // `@`; a metadata statement names it as a node id. Ours leaves out the
  // region delimiters and `@` (`e[1`, `e1@x` stay rejected).
  it.each(['e.1', 'e:1', 'e&1', 'e/1', 'é1'])('reads the edge id %s, its metadata and writes both back', id => {
    const source = `flowchart LR\n  A ${id}@==x B\n  ${id}@{ animate: true }`
    const parsed = parseMermaid(source)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    for (const graph of [parseGraph(source), parseGraph(serializeMermaid(parsed.value))]) {
      expect([...graph.nodes.keys()]).toEqual(['A', 'B'])
      expect(graph.edges).toEqual([expect.objectContaining({ id, source: 'A', target: 'B', endMarker: 'cross', animate: true })])
    }
  })

  it('names one edge of a `&` product, as Mermaid does: the first from the last source to the first target', async () => {
    const sources = ['flowchart LR\n  A & B e1@--> C & D', 'flowchart LR\n  A e1@-- t --> B & C', 'flowchart LR\n  A & A e1@==> C']
    const upstream = startUpstreamMermaid()
    try {
      const named = (diagram: { db: { getEdges(): Array<{ start: string; end: string; id: string; isUserDefinedId?: boolean }> } }) => diagram.db.getEdges().map(edge => [edge.start, edge.end, edge.isUserDefinedId ? edge.id : ''])
      const mermaid = await upstream.projectAll(sources, named)
      expect(mermaid).toEqual([
        [['A', 'C', ''], ['A', 'D', ''], ['B', 'C', 'e1'], ['B', 'D', '']],
        [['A', 'B', 'e1'], ['A', 'C', '']],
        [['A', 'C', 'e1'], ['A', 'C', '']],
      ])
      expect(sources.map(source => parseGraph(source).edges.map(edge => [edge.source, edge.target, edge.id ?? '']))).toEqual(mermaid)
    } finally { upstream.close() }
  })

  // An edge id names one link. Mermaid's `addSingleLink` leaves an id an
  // earlier link has off a later one, and ours does too, so the typed body
  // holds no two edges with one id; verify reports each such link, and the
  // writer leaves the id off it. Metadata names the first link, also where a
  // node has the id. [source, the lines verify reports]
  const REPEATED_IDS: ReadonlyArray<readonly [string, readonly number[]]> = [
    ['flowchart LR\n  A e1@--> B\n  C e1@--> D', [3]],
    ['flowchart LR\n  A e1@--> B e1@--> C\n  C e1@-- t --> A', [2, 3]],
    ['flowchart LR\n  A e1@--> B\n  B & C e1@--> D', [3]],
    ['flowchart LR\n  A e1@--> B\n  e1 --> C\n  C e1@==> D\n  e1@{ animate: true }', [4]],
  ]
  it.each(REPEATED_IDS)('names one link with an edge id an earlier link has, as Mermaid does: %s', async (source, lines) => {
    const upstream = startUpstreamMermaid()
    try {
      const parsed = parseAgent(source)
      const serialized = serializeMermaid(parsed)
      const named = (diagram: { db: { getEdges(): Array<{ start: string; end: string; id: string; isUserDefinedId?: boolean; animate?: boolean }> } }) =>
        diagram.db.getEdges().map(edge => [edge.start, edge.end, edge.isUserDefinedId ? edge.id : '', edge.animate ?? false])
      const [mermaid, rewritten] = await upstream.projectAll([source, serialized], named)
      expect(rewritten).toEqual(mermaid)
      for (const graph of [asFlowchart(parsed)!.body.graph, parseGraph(serialized)]) {
        expect(graph.edges.map(edge => [edge.source, edge.target, edge.id ?? '', edge.animate ?? false])).toEqual(mermaid!)
      }
      expect(verifyMermaid(source).warnings.flatMap(warning => warning.code === 'UNSUPPORTED_SYNTAX' ? [`${warning.syntax}@${warning.line}`] : []))
        .toEqual(lines.map(line => `flowchart_duplicate_edge_id@${line}`))
    } finally { upstream.close() }
  })

  it('edges without an authored ID carry none', () => {
    expect(parseGraph('flowchart LR\n  A --> B').edges[0]!.id).toBeUndefined()
  })
})

describe('flowchart edge IDs — round-trip', () => {
  it('writes metadata declarations separately from named links without losing their identities', async () => {
    const upstream = startUpstreamMermaid()
    try {
      for (const metadata of ["A@{ shape: 'rect' }", 'A@{ shape: diamond, label: "Question" }\nB@{ shape: rounded }']) {
        const source = `flowchart LR\nA id1@-->B\n${metadata}`
        const diagram = parseAgent(source)
        const serialized = serializeMermaid(diagram)
        expect(await upstream.accepts(source)).toBe(true)
        expect(await upstream.accepts(serialized)).toBe(true)
        const reparsed = asFlowchart(parseAgent(serialized))!
        expect(reparsed.body.graph.nodes).toEqual(asFlowchart(diagram)!.body.graph.nodes)
        expect(reparsed.body.graph.edges).toEqual(asFlowchart(diagram)!.body.graph.edges)
        expect(serializeMermaid(reparsed)).toBe(serialized)
        expect(renderMermaidSVG(serialized)).toContain('data-id="id1"')
      }
    } finally { upstream.close() }
  })

  it('agent parse is structured and serialization is byte-identical', () => {
    const diagram = parseAgent(SOURCE)
    expect(diagram.body.kind).toBe('flowchart')
    expect(asFlowchart(diagram)).not.toBeNull()
    expect(serializeMermaid(diagram)).toBe(SOURCE)
  })

  it('round-trip is stable for labeled and lengthened ID edges', () => {
    for (const src of [
      'flowchart LR\n  A e1@-->|yes| B\n',
      'flowchart LR\n  A e9@==> B\n',
      'flowchart TD\n  A e1@--> B\n  B e2@--> C\n',
    ]) {
      const once = serializeMermaid(parseAgent(src))
      expect(serializeMermaid(parseAgent(once))).toBe(once)
      expect(once).toBe(src)
    }
  })
})

describe('flowchart edge IDs — SVG identity (X4)', () => {
  it('emits data-id on the edge line', () => {
    const svg = renderMermaidSVG(SOURCE)
    expect(svg).toMatch(/<polyline[^>]*class="edge"[^>]*data-id="e1"/)
  })

  it('edges without authored IDs receive deterministic endpoint/occurrence identity', () => {
    const svg = renderMermaidSVG('flowchart LR\n  A --> B')
    expect(svg).toMatch(/<polyline[^>]*data-id="edge:A-&gt;B#0"/)
    expect(svg).toMatch(/<polyline[^>]*data-role="edge"/)
  })

  // Mermaid accepts an edge id a node or subgraph also has (mermaid-js/mermaid#7033).
  // The node or subgraph keeps that identity, and the edge its endpoint one.
  it.each([
    ['the node it leaves', 'flowchart LR\n  A A@--> B', 'A', 'node'],
    ['a node a later link declares', 'flowchart LR\n  A e1@--> B\n  e1 --> C', 'e1', 'node'],
    ['a subgraph', 'flowchart LR\n  subgraph S\n    X\n  end\n  A S@--> B', 'S', 'group'],
  ])('an edge id naming %s leaves every data-id unique', (_case, source, id, role) => {
    const marks = [...renderMermaidSVG(source).matchAll(/<[a-z]+\b[^>]*\sdata-id="[^"]*"[^>]*>/g)].map(([element]) => ({
      id: element.match(/\sdata-id="([^"]*)"/)![1],
      role: element.match(/\sdata-role="([^"]*)"/)?.[1],
      from: element.match(/\sdata-from="([^"]*)"/)?.[1],
      to: element.match(/\sdata-to="([^"]*)"/)?.[1],
    }))
    expect(new Set(marks.map(mark => mark.id)).size).toBe(marks.length)
    expect(marks).toContainEqual({ id, role, from: undefined, to: undefined })
    expect(marks).toContainEqual({ id: 'edge:A-&gt;B#0', role: 'edge', from: 'A', to: 'B' })
  })
})

describe('flowchart edge classes — authored edge paint', () => {
  it('applies classDef stroke and width to only the assigned edge', () => {
    const source = [
      'flowchart LR',
      '  A e1@--> B',
      '  B e2@--> C',
      '  classDef hot stroke:#ff0000,stroke-width:6px',
      '  class e1 hot',
    ].join('\n')
    const graph = parseGraph(source)
    expect(graph.classAssignments.get('e1')).toBe('hot')
    const svg = renderMermaidSVG(source)
    const assigned = svg.match(/<(?:polyline|path)\b[^>]*data-id="e1"[^>]*>/)?.[0]
    const unrelated = svg.match(/<(?:polyline|path)\b[^>]*data-id="e2"[^>]*>/)?.[0]
    expect(assigned).toContain('class="edge hot"')
    expect(assigned).toContain('stroke="#ff0000"')
    expect(assigned).toContain('stroke-width="6px"')
    expect(assigned).toMatch(/marker-end="url\(#arrowhead-[^)]*\)"/)
    const markerId = assigned?.match(/marker-end="url\(#([^)]*)\)"/)?.[1]
    expect(markerId).toBeDefined()
    const marker = svg.match(new RegExp(`<marker\\b[^>]*id="${markerId}"[^>]*>`))?.[0]
    expect(marker).toContain('markerUnits="userSpaceOnUse"')
    expect(marker).toContain('markerWidth="8"')
    expect(marker).toContain('markerHeight="8"')
    expect(unrelated).toContain('class="edge"')
    expect(unrelated).not.toContain('stroke="#ff0000"')
    expect(unrelated).not.toContain('stroke-width="6px"')
  })

  it('keeps the authored class in typed Scene connector identity', () => {
    const source = 'flowchart LR\n  A e1@--> B\n  classDef hot stroke:#ff0000\n  class e1 hot'
    const positioned = layoutGraphSync(parseGraph(source))
    const scene = lowerGraphScene({
      positioned,
      colors: { bg: '#fff', fg: '#111' },
      resolved: { renderOptions: {} },
    })
    const edge = scene.parts.find(part => part.kind === 'connector' && part.identity?.id === 'e1')
    expect(edge?.kind).toBe('connector')
    if (edge?.kind !== 'connector') return
    expect(edge.identity?.classNames).toEqual(['hot'])
    expect(renderMermaidSVG(source)).toContain('class="edge hot"')
  })

  it('uses fixed-size endpoints when class paint changes width without a color', () => {
    const svg = renderMermaidSVG('flowchart LR\n  A e1@--> B\n  classDef wide stroke-width:6px\n  class e1 wide')
    const edge = svg.match(/<(?:polyline|path)\b[^>]*data-id="e1"[^>]*>/)?.[0]
    expect(edge).toContain('marker-end="url(#arrowhead-fixed)"')
    expect(svg).toMatch(/<marker\b[^>]*id="arrowhead-fixed"[^>]*markerUnits="userSpaceOnUse"/)
  })

  it('retains explicit linkStyle precedence over edge-class paint', () => {
    const source = [
      'flowchart LR',
      '  A e1@--> B',
      '  classDef hot stroke:#ff0000,stroke-width:6px',
      '  class e1 hot',
      '  linkStyle 0 stroke:#00ff00,stroke-width:3px',
    ].join('\n')
    const edge = renderMermaidSVG(source).match(/<(?:polyline|path)\b[^>]*data-id="e1"[^>]*>/)?.[0]
    expect(edge).toContain('class="edge hot"')
    expect(edge).toContain('stroke="#00ff00"')
    expect(edge).toContain('stroke-width="3px"')
  })
})

describe('flowchart edge IDs — op targeting', () => {
  it('remove_edge accepts the authored ID', () => {
    const d = asFlowchart(parseAgent(SOURCE))!
    const removed = mutate(d, { kind: 'remove_edge', id: 'e1' })
    if (!removed.ok) throw new Error(removed.error.message)
    expect(removed.value.body.graph.edges).toHaveLength(0)
  })

  it('set_label accepts the authored ID as target', () => {
    const d = asFlowchart(parseAgent(SOURCE))!
    const labeled = mutate(d, { kind: 'set_label', target: 'e1', label: 'yes' })
    if (!labeled.ok) throw new Error(labeled.error.message)
    expect(labeled.value.body.graph.edges[0]!.label).toBe('yes')
    expect(serializeMermaid(labeled.value)).toBe('flowchart LR\n  A e1@-->|yes| B\n')
  })

  it('set_label names the node an edge id also names, and the endpoint form that edge', () => {
    const d = asFlowchart(parseAgent('flowchart LR\n  A A@--> B'))!
    const node = mutate(d, { kind: 'set_label', target: 'A', label: 'Start' })
    const edge = mutate(d, { kind: 'set_label', target: 'A->B', label: 'go' })
    if (!node.ok || !edge.ok) throw new Error('set_label failed')
    expect(serializeMermaid(node.value)).toBe('flowchart LR\n  A[Start] A@--> B\n')
    expect(serializeMermaid(edge.value)).toBe('flowchart LR\n  A A@-->|go| B\n')
  })

  it('endpoint targeting still works alongside authored IDs', () => {
    const d = asFlowchart(parseAgent(SOURCE))!
    const removed = mutate(d, { kind: 'remove_edge', id: 'A->B' })
    if (!removed.ok) throw new Error(removed.error.message)
    expect(removed.value.body.graph.edges).toHaveLength(0)
  })
})

describe('flowchart edge IDs — verify contract', () => {
  it('no longer warns UNSUPPORTED_SYNTAX flowchart_edge_id', () => {
    const verify = verifyMermaid(SOURCE)
    expect(verify.ok).toBe(true)
    expect(verify.layout.edges.map(e => `${e.from}->${e.to}`)).toEqual(['A->B'])
    expect(verify.warnings).not.toContainEqual(expect.objectContaining({ syntax: 'flowchart_edge_id' }))
  })

  it('edge METADATA statements are typed, round-trip, render natively, and never become a phantom node', () => {
    const source = 'flowchart LR\n  A e1@==> B\n  e1@{ animate: true }\n'
    const graph = parseGraph(source)
    expect([...graph.nodes.keys()].sort()).toEqual(['A', 'B'])
    expect(graph.edges.map(e => `${e.source}->${e.target}:${e.style}`)).toEqual(['A->B:thick'])
    expect(graph.edges[0]).toMatchObject({ animate: true })
    const diagram = parseAgent(source)
    expect(diagram.body.kind).toBe('flowchart')
    if (diagram.body.kind !== 'flowchart') return
    expect(diagram.body.graph.edges[0]).toMatchObject({ id: 'e1', animate: true })
    expect(serializeMermaid(diagram)).toBe(source)
    expect(renderMermaidSVG(source)).toContain('data-animate="true"')
    const syntaxes = verifyMermaid(source).warnings
      .map(w => (w.code === 'UNSUPPORTED_SYNTAX' ? (w as { syntax?: string }).syntax : ''))
      .filter(Boolean)
    expect(syntaxes).not.toContain('flowchart_edge_metadata')
  })
})
