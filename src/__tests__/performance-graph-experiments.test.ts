import { describe, expect, test } from 'bun:test'
import { withPerformanceExperiments } from '../experimental-performance.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { parseMermaid } from '../parser.ts'
import { onShapeOutline } from '../layout-rubric.ts'
import type { Direction } from '../types.ts'
import { renderMermaidSVG, renderMermaidSVGWithReceipt } from '../index.ts'

const flags = withPerformanceExperiments

describe('certified ELK tree-shaped graph layout', () => {
  test.each([
    { nodeSpacing: 0, layerSpacing: 0, padding: 0 },
    { nodeSpacing: 1, layerSpacing: 0, padding: 0 },
    { nodeSpacing: 0, layerSpacing: 1, padding: 0 },
  ])('keeps tight-spacing ELK geometry identical across shared cache paths: %j', options => {
    const source = `flowchart BT
N0[x] --> N1["a<br/>b"]
N0 --> N2[x]
N0 --> N3[x]
N3 --> N6[x]
N3 --> N7[x]
N8[x] --> N9[x]`
    const baseline = flags([], () => renderMermaidSVG(source, options))
    expect(flags(['text-spans', 'position-cache'], () => renderMermaidSVG(source, options))).toBe(baseline)
  })

  for (const direction of ['TD', 'LR', 'BT', 'RL'] satisfies Direction[]) {
    test(`keeps variable-size nodes and edges connected without overlap in ${direction}`, () => {
      const graph = parseMermaid(`flowchart ${direction}\nA[A wider root label] --> B[B]\nA --> C[Wide child label]\nC --> D[D]\nC --> E[Another long descendant]\nF[Disconnected]\nG --> H`)
      const positioned = flags(['text-spans', 'position-cache'], () => layoutGraphSync(graph))
      expect(positioned.certification).toMatchObject({ status: 'passed', strategy: 'default', hardViolations: 0 })
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
      const again = flags(['text-spans', 'position-cache'], () => layoutGraphSync(graph))
      expect(again).toEqual(positioned)
    })
  }

})

test('positioned caching preserves C4 artifacts with private identity callbacks', () => {
  const prior = process.env.AGENTIC_MERMAID_ELK_CACHE
  const source = 'C4Deployment\ntitle Runtime\nNode(parent,"Production","Linux") {\nContainer(api,"API","Go")\n}\nPerson(user,"User")\nRel(user,api,"Calls","HTTPS")'
  try {
    process.env.AGENTIC_MERMAID_ELK_CACHE = '1'
    const baseline = flags([], () => renderMermaidSVGWithReceipt(source))
    expect(baseline.receipt.layoutCertification?.status).toBe('passed')
    for (let request = 0; request < 2; request++) {
      const actual = flags(['position-cache'], () => renderMermaidSVGWithReceipt(source))
      expect(actual.svg).toBe(baseline.svg)
      expect(actual.receipt.layoutCertification).toEqual(baseline.receipt.layoutCertification)
    }
  } finally {
    if (prior === undefined) delete process.env.AGENTIC_MERMAID_ELK_CACHE
    else process.env.AGENTIC_MERMAID_ELK_CACHE = prior
  }
})
