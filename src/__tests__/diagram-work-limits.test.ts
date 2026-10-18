import { describe, expect, spyOn, test } from 'bun:test'
import type { ElkNode } from 'elkjs'
import { parseMermaid } from '../parser.ts'
import { renderMermaidSVG, renderMermaidASCII } from '../index.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { elkLayoutSync } from '../elk-instance.ts'
import * as elkAdapter from '../elk-instance.ts'
import * as terminalGrid from '../ascii/grid.ts'

function cartesian(sources: number, targets: number): string {
  const from = Array.from({ length: sources }, (_, i) => `a${i}`).join(' & ')
  const to = Array.from({ length: targets }, (_, i) => `b${i}`).join(' & ')
  return `flowchart TD\n${from} --> ${to}`
}

describe('graph work admission', () => {
  test('rejects Cartesian expansion before allocating an oversized edge set', () => {
    expect(() => { parseMermaid(cartesian(100, 100)) }).toThrow(/DIAGRAM_WORK_LIMIT.*edges/)
  })

  test('admits exactly 5000 expanded edges and counts cumulative statements', () => {
    const source = cartesian(100, 50)
    expect(parseMermaid(source).edges).toHaveLength(5000)
    expect(() => { parseMermaid(`${source}\na0 --> b0`) }).toThrow(/DIAGRAM_WORK_LIMIT.*edges/)
  })

  test('rejects excessive declarations while reading the source', () => {
    const source = `flowchart TD\n${Array.from({ length: 5001 }, (_, i) => `n${i}`).join('\n')}`
    expect(() => { parseMermaid(source) }).toThrow(/DIAGRAM_WORK_LIMIT.*nodes/)
  })

  test('rejects excessive graph nesting before recursive projection', () => {
    const source = `flowchart TD\n${Array.from({ length: 65 }, (_, i) => `subgraph g${i}`).join('\n')}\nA\n${'end\n'.repeat(65)}`
    expect(() => { parseMermaid(source) }).toThrow(/DIAGRAM_WORK_LIMIT.*nesting/)
  })

  test('bounds state transitions and generated concurrency containers', () => {
    const transitions = `stateDiagram-v2\n${'A --> B\n'.repeat(5001)}`
    expect(() => { parseMermaid(transitions) }).toThrow(/DIAGRAM_WORK_LIMIT.*edges/)
    const regions = `stateDiagram-v2\nstate C {\nA\n${'--\n'.repeat(5000)}}`
    expect(() => { parseMermaid(regions) }).toThrow(/DIAGRAM_WORK_LIMIT.*nodes/)
  })

  test('source configuration cannot raise the work budget for SVG or terminal output', () => {
    const source = `---\nconfig:\n  maxEdges: 20000\n---\n${cartesian(100, 100)}`
    // Keep a missing admission check from performing the oversized layout in
    // the regression probe, including when CI runs it against base production.
    const elk = spyOn(elkAdapter, 'elkLayoutSync').mockImplementation(() => { throw new Error('ELK started before work admission') })
    const grid = spyOn(terminalGrid, 'createMapping').mockImplementation(() => { throw new Error('terminal layout started before work admission') })
    try {
      for (const render of [renderMermaidSVG, renderMermaidASCII]) {
        expect(() => render(source)).toThrow(/DIAGRAM_WORK_LIMIT.*edges/)
      }
      expect(elk).not.toHaveBeenCalled()
      expect(grid).not.toHaveBeenCalled()
    } finally {
      elk.mockRestore()
      grid.mockRestore()
    }
  })

  test('programmatic graphs are bounded before graph conversion', () => {
    const graph = parseMermaid('flowchart TD\nA --> B')
    graph.edges = Array.from({ length: 5001 }, () => ({ ...graph.edges[0]! }))
    const elk = spyOn(elkAdapter, 'elkLayoutSync').mockImplementation(() => { throw new Error('ELK started before work admission') })
    try {
      expect(() => layoutGraphSync(graph)).toThrow(/DIAGRAM_WORK_LIMIT.*edges/)
      expect(elk).not.toHaveBeenCalled()
    } finally { elk.mockRestore() }
  })

  test('direct ELK adapters reject oversized input before selecting an algorithm', () => {
    const graph: ElkNode = {
      id: 'root',
      layoutOptions: { 'elk.algorithm': 'not-an-algorithm' },
      children: Array.from({ length: 5001 }, (_, i) => ({ id: `n${i}`, width: 20, height: 20 })),
    }
    expect(() => elkLayoutSync(graph)).toThrow(/DIAGRAM_WORK_LIMIT.*nodes/)
  })
})
