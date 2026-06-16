import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'

import { parseMermaid as parseGraph } from '../parser.ts'
import {
  asFlowchart,
  layoutMermaid,
  parseMermaid,
  renderMermaidASCII,
  renderMermaidSVG,
  serializeMermaid,
  verifyMermaid,
} from '../agent/index.ts'

const ISSUE_29_CASES = [
  {
    name: 'inline metadata on an edge statement',
    source: 'flowchart TD\n  A@{ shape: manual-input, label: "User types" } --> B[OK]\n',
    expectedNodes: ['A', 'B'],
    expectedEdges: [['A', 'B']],
    labels: { A: 'User types', B: 'OK' },
  },
  {
    name: 'standalone metadata statement',
    source: 'flowchart TD\n  A@{ shape: document, label: "Spec" }\n  A --> B[OK]\n',
    expectedNodes: ['A', 'B'],
    expectedEdges: [['A', 'B']],
    labels: { A: 'Spec', B: 'OK' },
  },
  {
    name: 'standalone metadata updates an existing implicit node',
    source: 'flowchart TD\n  A --> B[OK]\n  A@{ shape: document, label: "Spec" }\n',
    expectedNodes: ['A', 'B'],
    expectedEdges: [['A', 'B']],
    labels: { A: 'Spec', B: 'OK' },
  },
  {
    name: 'multiline metadata block',
    source: 'flowchart TD\n  A@{\n    shape: delay,\n    label: "Wait"\n  }\n  A --> B\n',
    expectedNodes: ['A', 'B'],
    expectedEdges: [['A', 'B']],
    labels: { A: 'Wait', B: 'B' },
  },
] as const

function parseAgent(source: string) {
  const parsed = parseMermaid(source)
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
  return parsed.value
}

describe('flowchart @{...} node metadata preservation (issue #29)', () => {
  for (const c of ISSUE_29_CASES) {
    test(`${c.name}: agent parse falls back to lossless opaque source`, () => {
      const diagram = parseAgent(c.source)
      expect(diagram.kind).toBe('flowchart')
      expect(diagram.body.kind).toBe('opaque')
      expect(diagram.body.kind === 'opaque' ? diagram.body.source : '').toBe(c.source)
      expect(serializeMermaid(diagram)).toBe(c.source)
      expect(asFlowchart(diagram)).toBeNull()

      const reparsed = parseAgent(serializeMermaid(diagram))
      expect(serializeMermaid(reparsed)).toBe(c.source)
    })

    test(`${c.name}: legacy renderer parser keeps nodes and edges without fabricating metadata keys`, () => {
      const graph = parseGraph(c.source)
      expect([...graph.nodes.keys()].sort()).toEqual([...c.expectedNodes].sort())
      expect(graph.nodes.has('shape')).toBe(false)
      expect(graph.nodes.has('label')).toBe(false)
      for (const [id, label] of Object.entries(c.labels)) {
        expect(graph.nodes.get(id)?.label).toBe(label)
      }
      expect(graph.edges.map(e => [e.source, e.target])).toEqual(c.expectedEdges.map(([source, target]) => [source, target]))
    })

    test(`${c.name}: render and layout degrade to labeled rectangle fallback`, () => {
      const diagram = parseAgent(c.source)
      const verify = verifyMermaid(c.source)
      expect(verify.ok).toBe(true)
      expect(verify.layout.nodes.map(n => n.id).sort()).toEqual([...c.expectedNodes].sort())
      expect(verify.layout.nodes.some(n => n.id === 'shape' || n.id === 'label')).toBe(false)

      const layout = layoutMermaid(diagram)
      expect(layout.nodes.map(n => n.id).sort()).toEqual([...c.expectedNodes].sort())
      expect(layout.edges.map(e => [e.from, e.to])).toEqual(c.expectedEdges.map(([source, target]) => [source, target]))

      const svg = renderMermaidSVG(c.source)
      const ascii = renderMermaidASCII(c.source)
      for (const label of Object.values(c.labels)) {
        expect(svg).toContain(label)
        expect(ascii).toContain(label)
      }
    })
  }

  test('metadata keys are never interpreted as nodes across generated blocks', () => {
    const idArb = fc.constantFrom('A', 'Node_1', 'node-2')
    const shapeArb = fc.constantFrom('manual-input', 'document', 'delay', 'rect', 'cloud')
    const labelArb = fc
      .array(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 '.split('')), { minLength: 1, maxLength: 12 })
      .map(chars => chars.join('').trim() || 'Node')
    fc.assert(
      fc.property(idArb, shapeArb, labelArb, fc.boolean(), (id, shape, label, multiline) => {
        const metadata = multiline
          ? `${id}@{\n    shape: ${shape},\n    label: "${label}"\n  }`
          : `${id}@{ shape: ${shape}, label: "${label}" }`
        const source = `flowchart TD\n  ${metadata}\n  ${id} --> B[OK]\n`
        const graph = parseGraph(source)
        expect(graph.nodes.has('shape')).toBe(false)
        expect(graph.nodes.has('label')).toBe(false)
        expect(graph.nodes.get(id)?.label).toBe(label)
        expect(graph.nodes.get('B')?.label).toBe('OK')
        expect(graph.edges).toHaveLength(1)
        expect(graph.edges[0]!.source).toBe(id)
        expect(graph.edges[0]!.target).toBe('B')
      }),
      { numRuns: 30 },
    )
  })
})
