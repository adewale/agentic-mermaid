import { describe, expect, test } from 'bun:test'
import { convertToAsciiGraph } from '../ascii/converter.ts'
import { createMapping } from '../ascii/grid.ts'
import { renderMermaidASCIIWithMeta } from '../ascii/meta.ts'
import type { AsciiConfig } from '../ascii/types.ts'
import { parseMermaid } from '../parser.ts'
import { contactSheetScenarios } from '../../eval/visual-rubric/scenarios.ts'

const config: AsciiConfig = { useAscii: false, paddingX: 1, paddingY: 1, boxBorderPadding: 1, graphDirection: 'TD' }

describe('Terminal bundle admission requires allocated forward clearance', () => {
  test('same-level fan-in stays on ordinary routes while a genuine forward join remains bundled', () => {
    const graph = convertToAsciiGraph(parseMermaid('flowchart TD\nA --> C\nB --> C\nA1 --> A\nA2 --> A'), { ...config })
    createMapping(graph)
    expect(graph.nodes.find(node => node.name === 'A')!.gridCoord!.y).toBe(0)
    expect(graph.bundles.map(bundle => bundle.sharedNode.name)).toEqual(['C'])
    for (const edge of graph.edges.filter(edge => edge.to.name === 'A')) {
      expect(edge.bundle).toBeUndefined()
      expect(edge.path.length).toBeGreaterThanOrEqual(2)
      for (const point of edge.path) { expect(point.x).toBeGreaterThanOrEqual(0); expect(point.y).toBeGreaterThanOrEqual(0) }
    }
    for (const bundle of graph.bundles) for (const point of bundle.sharedPath) expect(point.y).toBeGreaterThanOrEqual(0)
  })

  test.each(['TD', 'BT', 'LR', 'RL'])('the previously failing contact-sheet AI source renders attributable relationships in %s, ASCII and Unicode', direction => {
    const original = contactSheetScenarios().find(scenario => scenario.letter === 'AI')!.source
    const source = original.replace('flowchart TD', `flowchart ${direction}`)
    const parsed = parseMermaid(source)
    for (const useAscii of [true, false]) {
      const rendered = renderMermaidASCIIWithMeta(source, { useAscii })
      expect(rendered.ascii.trim().length).toBeGreaterThan(0)
      expect(rendered.warnings.some(warning => warning.code === 'ASCII_RENDER_FAILED')).toBe(false)
      const edges = rendered.regions.filter(region => region.kind === 'edge')
      expect(edges).toHaveLength(parsed.edges.length)
      for (const [index, edge] of parsed.edges.entries()) {
        const owned = edges.find(region => region.id === `edge#${index}:${edge.source}->${edge.target}`)!
        expect(owned).toMatchObject({ from: edge.source, to: edge.target })
        expect(owned.ownedCellSpans!.length).toBeGreaterThan(0)
        expect(owned.ports).toHaveLength(2)
        for (const port of owned.ports!) { expect(port.x).toBeGreaterThanOrEqual(0); expect(port.y).toBeGreaterThanOrEqual(0) }
      }
      for (const id of parsed.nodes.keys()) expect(rendered.regions.find(region => region.kind === 'node' && region.id === id)?.projectedText).toBeDefined()
    }
  })
})
