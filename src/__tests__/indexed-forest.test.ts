import { describe, expect, test } from 'bun:test'
import { withPerformanceExperiments as flags } from '../experimental-performance.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { parseMermaid } from '../parser.ts'
import { onShapeOutline } from '../layout-rubric.ts'
import type { Direction } from '../types.ts'
import { renderMermaidSVG } from '../index.ts'
import { layoutMeasuredForest } from '../layout/measured-forest.ts'
import type { MeasuredGraph } from '../layout/agentic-layered-core.ts'
import { scanSvgStartTags, decodedSvgAttributeValue } from '../svg-structure.ts'

describe('certified indexed forest layout', () => {
  test.each(['TD', 'BT', 'LR', 'RL'] as const)('retains measured native leaf boxes beside a multiline sibling in %s', direction => {
    const source = `flowchart ${direction}\nA[a<br/>b<br/>c<br/>d<br/>e<br/>f<br/>g<br/>h] --> B[Short]\nA --> C[Short]\nD[Root] --> E[a<br/>b<br/>c<br/>d<br/>e<br/>f<br/>g<br/>h]\nD --> F[Short]`
    const tags = scanSvgStartTags(renderMermaidSVG(source, { graphLayout: { backend: 'agentic', fallback: 'none' } }))
    const height = (id: string) => Number(decodedSvgAttributeValue(tags.find(tag => decodedSvgAttributeValue(tag, 'data-id') === `node-shape:${id}`)!, 'height'))
    expect(height('F')).toBe(height('D'))
    expect(height('E')).toBeGreaterThan(height('F'))
  })

  test.each(['TD', 'BT', 'LR', 'RL'] as const)('seats a complete leaf beside its taller sibling without lengthening their routes in %s', direction => {
    const horizontal = direction === 'LR' || direction === 'RL', reverse = direction === 'BT' || direction === 'RL'
    const input: MeasuredGraph = {
      direction, padding: 20, nodeSpacing: 20, layerSpacing: 60,
      nodes: [40, 100, 40].map((main, index) => ({ id: String(index), width: horizontal ? main : 100, height: horizontal ? 100 : main })),
      edges: [{ source: 0, target: 1, minSpan: 1 }, { source: 0, target: 2, minSpan: 1 }],
    }
    const output = layoutMeasuredForest(input)!, local = layoutMeasuredForest(input, 'scope')!, legacy = layoutMeasuredForest(input, 'elk-projection')!
    const nearFace = (placed: typeof output, index: number) => horizontal
      ? placed.nodes[index]!.x + (reverse ? input.nodes[index]!.width : 0)
      : placed.nodes[index]!.y + (reverse ? input.nodes[index]!.height : 0)
    expect(nearFace(output, 1)).toBe(nearFace(output, 2))
    // Local siblings may have external contacts omitted from this projection.
    expect(Math.abs(nearFace(local, 1) - nearFace(local, 2))).toBe(30)
    expect(Math.abs(nearFace(legacy, 1) - nearFace(legacy, 2))).toBe(30)
    expect(output.edges.reduce((length, edge) => length + edge.points.slice(1).reduce((sum, point, index) => sum + Math.abs(point.x - edge.points[index]!.x) + Math.abs(point.y - edge.points[index]!.y), 0), 0)).toBe(240)
  })

  test.each(['TD', 'BT', 'LR', 'RL'] as const)('packs disconnected components without changing their internal geometry in %s', direction => {
    const horizontal = direction === 'LR' || direction === 'RL'
    const input: MeasuredGraph = {
      direction, padding: 20, nodeSpacing: 20, layerSpacing: 60,
      nodes: Array.from({ length: 3 }, (_, index) => ({ id: String(index), width: horizontal ? 40 : 100, height: horizontal ? 100 : 40 })),
      edges: [{ source: 1, target: 2, minSpan: 1 }],
    }
    const before = structuredClone(input), output = layoutMeasuredForest(input)!
    expect(input).toEqual(before)
    expect(output.nodes).toHaveLength(3)
    expect(horizontal ? output.height : output.width).toBe(140)
    expect(horizontal ? output.width : output.height).toBe(240)
    const source = output.nodes[1]!, target = output.nodes[2]!
    expect(Math.abs(horizontal ? target.x - source.x : target.y - source.y)).toBe(100)
    expect(horizontal ? source.y : source.x).toBe(horizontal ? target.y : target.x)
    const points = output.edges[0]!.points
    expect(points.reduce((length, point, index) => index ? length + Math.abs(point.x - points[index - 1]!.x) + Math.abs(point.y - points[index - 1]!.y) : 0, 0)).toBe(60)
  })

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
      test(`keeps disconnected fan bands local to their own measured roots in ${direction}`, () => {
        const graph: MeasuredGraph = {
          nodes: [160, 40, 40, 40, 160, 40].map((height, index) => ({ id: 'ABCDEF'[index]!, width: horizontal ? height : 60, height: horizontal ? 60 : height })),
          edges: [{ source: 0, target: 1, minSpan: 1 }, { source: 0, target: 2, minSpan: 1 }, { source: 3, target: 4, minSpan: 1 }, { source: 3, target: 5, minSpan: 1 }],
          direction, padding: 20, nodeSpacing: 40, layerSpacing: 50,
        }
        const before = structuredClone(graph), output = layoutMeasuredForest(graph)!
        expect(graph).toEqual(before)
        expect(layoutMeasuredForest(graph)).toEqual(output)
        // Each fan needs 160 + 50 + 40 main units. Unrelated tall cards
        // at different depths must not become two shared 160-unit bands.
        expect(horizontal ? output.width : output.height).toBe(290)
        expect(horizontal ? output.height : output.width).toBe(400)
        const boxes = output.nodes.map((point, index) => ({ ...graph.nodes[index]!, label: graph.nodes[index]!.id, shape: 'rectangle' as const, ...point }))
        const main = (index: number) => horizontal ? boxes[index]!.x : boxes[index]!.y
        const mainEnd = (index: number) => main(index) + (horizontal ? boxes[index]!.width : boxes[index]!.height)
        const cross = (index: number) => horizontal ? boxes[index]!.y : boxes[index]!.x
        const crossEnd = (index: number) => cross(index) + (horizontal ? boxes[index]!.height : boxes[index]!.width)
        for (const component of [[0, 1, 2], [3, 4, 5]]) expect(Math.max(...component.map(mainEnd)) - Math.min(...component.map(main))).toBe(250)
        expect(Math.min(...[3, 4, 5].map(cross)) - Math.max(...[0, 1, 2].map(crossEnd))).toBe(40)
        for (const [index, edge] of graph.edges.entries()) {
          const source = boxes[edge.source]!, target = boxes[edge.target]!, path = output.edges[index]!.points
          expect(onShapeOutline(source, path[0]!, 1e-8)).toBe(true)
          expect(onShapeOutline(target, path.at(-1)!, 1e-8)).toBe(true)
          const gap = direction === 'BT' || direction === 'RL' ? main(edge.source) - mainEnd(edge.target) : main(edge.target) - mainEnd(edge.source)
          expect(gap).toBeGreaterThanOrEqual(50)
          for (let cursor = 1; cursor < path.length; cursor++) {
            const a = path[cursor - 1]!, b = path[cursor]!
            expect(a.x === b.x || a.y === b.y).toBe(true)
            for (const box of boxes) {
              const enters = a.x === b.x
                ? a.x > box.x && a.x < box.x + box.width && Math.max(a.y, b.y) > box.y && Math.min(a.y, b.y) < box.y + box.height
                : a.y > box.y && a.y < box.y + box.height && Math.max(a.x, b.x) > box.x && Math.min(a.x, b.x) < box.x + box.width
              expect(enters).toBe(false)
            }
          }
        }
      })
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
