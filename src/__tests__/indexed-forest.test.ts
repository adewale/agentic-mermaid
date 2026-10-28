import { describe, expect, test } from 'bun:test'
import { withPerformanceExperiments as flags } from '../experimental-performance.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { parseMermaid } from '../parser.ts'
import { onShapeOutline } from '../layout-rubric.ts'
import type { Direction } from '../types.ts'
import { renderMermaidSVG } from '../index.ts'
import { layoutMeasuredForest } from '../layout/measured-forest.ts'
import type { MeasuredGraph } from '../layout/agentic-layered-core.ts'

describe('certified indexed forest layout', () => {
  test.each([
    { nodeSpacing: 0, layerSpacing: 0, padding: 0 },
    { nodeSpacing: 1, layerSpacing: 0, padding: 0 },
    { nodeSpacing: 0, layerSpacing: 1, padding: 0 },
  ])('retains ELK for tight spacing without forest route channels: %j', options => {
    const source = `flowchart BT
N0[x] --> N1["a<br/>b"]
N0 --> N2[x]
N0 --> N3[x]
N3 --> N6[x]
N3 --> N7[x]
N8[x] --> N9[x]`
    const baseline = flags([], () => renderMermaidSVG(source, options))
    expect(flags(['indexed-layout'], () => renderMermaidSVG(source, options))).toBe(baseline)
  })

  test('leaves Architecture side-constrained placement on its existing producer', () => {
    const source = `architecture-beta
service a[A wider root service]
service b[Short]
service c[Another long branch]
service d[First leaf]
service e[Second leaf with a longer label]
service f[Disconnected service]
service g[Its child]
a:R --> L:b
a:R --> L:c
b:R --> L:d
c:R --> L:e
f:R --> L:g`
    const baseline = flags([], () => renderMermaidSVG(source))
    expect(flags(['indexed-layout'], () => renderMermaidSVG(source))).toBe(baseline)
  })

  for (const direction of ['TD', 'LR', 'BT', 'RL'] satisfies Direction[]) {
    test(`keeps variable-size nodes and edges connected without overlap in ${direction}`, () => {
      const graph = parseMermaid(`flowchart ${direction}\nA[A wider root label] --> B[B]\nA --> C[Wide child label]\nC --> D[D]\nC --> E[Another long descendant]\nF[Disconnected]\nG --> H`)
      const positioned = flags(['indexed-layout'], () => layoutGraphSync(graph))
      expect(positioned.certification).toMatchObject({ status: 'passed', strategy: 'indexed-forest', hardViolations: 0 })
      expect(positioned.nodes.map(node => node.id).sort()).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'])
      expect(positioned.edges.map(edge => [edge.source, edge.target])).toEqual([['A', 'B'], ['A', 'C'], ['C', 'D'], ['C', 'E'], ['G', 'H']])
      for (let i = 0; i < positioned.nodes.length; i++) {
        for (let j = i + 1; j < positioned.nodes.length; j++) {
          const a = positioned.nodes[i]!, b = positioned.nodes[j]!
          expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true)
        }
      }
      for (const edge of positioned.edges) {
        const source = positioned.nodes.find(node => node.id === edge.source)!, target = positioned.nodes.find(node => node.id === edge.target)!
        expect(onShapeOutline(source, edge.points[0]!, 1)).toBe(true)
        expect(onShapeOutline(target, edge.points.at(-1)!, 1)).toBe(true)
        const sourceMain = direction === 'LR' || direction === 'RL' ? source.x : source.y
        const targetMain = direction === 'LR' || direction === 'RL' ? target.x : target.y
        expect((targetMain - sourceMain) * (direction === 'BT' || direction === 'RL' ? -1 : 1)).toBeGreaterThan(0)
      }
      const again = flags(['indexed-layout'], () => layoutGraphSync(graph))
      expect(again).toEqual(positioned)
    })
  }

  describe('measured forest band-gap routing', () => {
    const uniformGeometry = {
      TD: { width: 228, height: 208, nodes: [{ x: 84, y: 40 }, { x: 40, y: 128 }, { x: 128, y: 128 }], paths: [
        [{ x: 114, y: 80 }, { x: 114, y: 104 }, { x: 70, y: 104 }, { x: 70, y: 128 }],
        [{ x: 114, y: 80 }, { x: 114, y: 104 }, { x: 158, y: 104 }, { x: 158, y: 128 }],
      ] },
      BT: { width: 228, height: 208, nodes: [{ x: 84, y: 128 }, { x: 40, y: 40 }, { x: 128, y: 40 }], paths: [
        [{ x: 114, y: 128 }, { x: 114, y: 104 }, { x: 70, y: 104 }, { x: 70, y: 80 }],
        [{ x: 114, y: 128 }, { x: 114, y: 104 }, { x: 158, y: 104 }, { x: 158, y: 80 }],
      ] },
      LR: { width: 248, height: 188, nodes: [{ x: 40, y: 74 }, { x: 148, y: 40 }, { x: 148, y: 108 }], paths: [
        [{ x: 100, y: 94 }, { x: 124, y: 94 }, { x: 124, y: 60 }, { x: 148, y: 60 }],
        [{ x: 100, y: 94 }, { x: 124, y: 94 }, { x: 124, y: 128 }, { x: 148, y: 128 }],
      ] },
      RL: { width: 248, height: 188, nodes: [{ x: 148, y: 74 }, { x: 40, y: 40 }, { x: 40, y: 108 }], paths: [
        [{ x: 148, y: 94 }, { x: 124, y: 94 }, { x: 124, y: 60 }, { x: 100, y: 60 }],
        [{ x: 148, y: 94 }, { x: 124, y: 94 }, { x: 124, y: 128 }, { x: 100, y: 128 }],
      ] },
    }
    for (const direction of ['TD', 'BT', 'LR', 'RL'] as const) {
      const horizontal = direction === 'LR' || direction === 'RL'
      const input: MeasuredGraph = {
        nodes: [{ id: 'A', width: 60, height: 36.900000000000006 }, { id: 'B', width: 60, height: 36.900000000000006 }, { id: 'C', width: 92, height: 181.8 }]
          .map(node => horizontal ? { ...node, width: node.height, height: node.width } : node),
        edges: [{ source: 0, target: 1, minSpan: 1 }, { source: 0, target: 2, minSpan: 1 }],
        direction, padding: 40, nodeSpacing: 28, layerSpacing: 48,
      }
      test(`keeps unequal sibling bands clear with outward ports in ${direction}`, () => {
        const before = structuredClone(input), output = layoutMeasuredForest(input)!
        expect(input).toEqual(before)
        expect(layoutMeasuredForest(input)).toEqual(output)
        for (const [index, edge] of input.edges.entries()) {
          const path = output.edges[index]!.points
          for (let cursor = 1; cursor < path.length; cursor++) for (let node = 0; node < input.nodes.length; node++) {
            if (node === edge.source || node === edge.target) continue
            const a = path[cursor - 1]!, b = path[cursor]!, box = { ...input.nodes[node]!, ...output.nodes[node]! }
            const enters = a.x === b.x
              ? a.x > box.x && a.x < box.x + box.width && Math.max(a.y, b.y) > box.y && Math.min(a.y, b.y) < box.y + box.height
              : a.y > box.y && a.y < box.y + box.height && Math.max(a.x, b.x) > box.x && Math.min(a.x, b.x) < box.x + box.width
            expect(enters).toBe(false)
          }
          const a = path[0]!, b = path[1]!, c = path.at(-2)!, d = path.at(-1)!
          const source = { ...input.nodes[edge.source]!, ...output.nodes[edge.source]! }, target = { ...input.nodes[edge.target]!, ...output.nodes[edge.target]! }
          if (direction === 'TD') { expect(a.y).toBe(source.y + source.height); expect(b.y).toBeGreaterThan(a.y); expect(d.y).toBe(target.y); expect(c.y).toBeLessThan(d.y) }
          if (direction === 'BT') { expect(a.y).toBe(source.y); expect(b.y).toBeLessThan(a.y); expect(d.y).toBe(target.y + target.height); expect(c.y).toBeGreaterThan(d.y) }
          if (direction === 'LR') { expect(a.x).toBe(source.x + source.width); expect(b.x).toBeGreaterThan(a.x); expect(d.x).toBe(target.x); expect(c.x).toBeLessThan(d.x) }
          if (direction === 'RL') { expect(a.x).toBe(source.x); expect(b.x).toBeLessThan(a.x); expect(d.x).toBe(target.x + target.width); expect(c.x).toBeGreaterThan(d.x) }
        }
      })
      test(`moves an exact sibling border contact into the open band gap in ${direction}`, () => {
        const nodes = [{ id: 'A', width: 60, height: 40 }, { id: 'B', width: 60, height: 40 }, { id: 'C', width: 92, height: 136 }]
          .map(node => horizontal ? { ...node, width: node.height, height: node.width } : node)
        const output = layoutMeasuredForest({ ...input, nodes })!, bend = output.edges[0]!.points[1]!
        const source = { ...nodes[0]!, ...output.nodes[0]! }, sibling = { ...nodes[2]!, ...output.nodes[2]! }
        const faces = direction === 'TD' ? [source.y + source.height, sibling.y]
          : direction === 'BT' ? [sibling.y + sibling.height, source.y]
            : direction === 'LR' ? [source.x + source.width, sibling.x] : [sibling.x + sibling.width, source.x]
        const coordinate = horizontal ? bend.x : bend.y
        expect(coordinate).toBeGreaterThan(Math.min(...faces))
        expect(coordinate).toBeLessThan(Math.max(...faces))
      })
      test(`retains the exact uniform forest geometry in ${direction}`, () => {
        const expected = uniformGeometry[direction]
        expect(layoutMeasuredForest({ ...input, nodes: input.nodes.map(node => ({ ...node, width: 60, height: 40 })) })).toEqual({
          topology: 'forest', width: expected.width, height: expected.height, nodes: expected.nodes,
          edges: expected.paths.map(points => ({ points })),
        })
      })
    }
  })

  test.each([
    'flowchart LR\nA --> B\nB --> A',
    'flowchart TD\nA --> B\nA --> C\nB --> D\nC --> D',
    'flowchart TD\nA --> B\nA --> B',
    'flowchart TD\nA -- label --> B',
    'flowchart TD\nA ---> B',
    'flowchart TD\nA{Decision} --> B',
    'flowchart TD\nsubgraph S[Group]\nA --> B\nend',
  ])('keeps the original certified ELK strategies for an ineligible graph: %s', source => {
    const graph = parseMermaid(source)
    const baseline = flags([], () => layoutGraphSync(graph))
    expect(flags(['indexed-layout'], () => layoutGraphSync(graph))).toEqual(baseline)
  })
})
