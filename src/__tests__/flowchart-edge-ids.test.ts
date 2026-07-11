/**
 * Flowchart v11.6 edge IDs (`e1@-->`) as stable edge identity
 * (plan §Flowchart 7; upstream PR #6136).
 *
 * Contract:
 *  - the render parser carries the authored ID on MermaidEdge.id;
 *  - the agent parser stays STRUCTURED (edge IDs no longer force opaque) and
 *    the serializer re-emits `id@` verbatim before the arrow operator;
 *  - the SVG emits the authored ID as the edge's `data-id` (X4 identity
 *    contract — nodes/subgraphs already carry data-id);
 *  - ops (remove_edge, set_label) target edges by authored ID as well as by
 *    the endpoint form `A->B`/`A->B#k`;
 *  - the flowchart_edge_id UNSUPPORTED_SYNTAX lint is retired (modeled now);
 *    edge METADATA (`e1@{ animate: true }`) stays opaque + linted.
 */
import { describe, it, expect } from 'bun:test'

import { parseMermaid as parseGraph } from '../parser.ts'
import { renderMermaidSVG } from '../index.ts'
import { asFlowchart, mutate, parseMermaid, serializeMermaid, verifyMermaid } from '../agent/index.ts'

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

  it('edges without an authored ID carry none', () => {
    expect(parseGraph('flowchart LR\n  A --> B').edges[0]!.id).toBeUndefined()
  })
})

describe('flowchart edge IDs — round-trip', () => {
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
    expect(verify.warnings).not.toContainEqual(expect.objectContaining({ syntax: 'flowchart_edge_id' }))
  })

  it('edge METADATA statements remain opaque and linted', () => {
    const source = 'flowchart LR\n  A e1@==> B\n  e1@{ animate: true }\n'
    const diagram = parseAgent(source)
    expect(diagram.body.kind).toBe('opaque')
    expect(serializeMermaid(diagram)).toBe(source)
    const syntaxes = verifyMermaid(source).warnings
      .map(w => (w.code === 'UNSUPPORTED_SYNTAX' ? (w as { syntax?: string }).syntax : ''))
      .filter(Boolean)
    expect(syntaxes).toContain('flowchart_edge_metadata')
  })
})
