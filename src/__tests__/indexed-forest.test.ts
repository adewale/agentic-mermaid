import { describe, expect, test } from 'bun:test'
import { withPerformanceExperiments as flags } from '../experimental-performance.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { parseMermaid } from '../parser.ts'
import { onShapeOutline } from '../layout-rubric.ts'
import type { Direction } from '../types.ts'
import { renderMermaidSVG } from '../index.ts'

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
      expect(positioned.nodes.map(node => node.id).sort()).toEqual([...graph.nodes.keys()].sort())
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
