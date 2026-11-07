// Regression: fan-out peers with differing label widths must be equalized and
// aligned (the "warnings"/"ok" symmetry).
//
// In `C -->|warnings| D["warnings"]` + `C -->|ok| E["ok"]`, D and E are genuine
// fan-out peers of C. ELK places them at different widths (97 vs 60) AND
// different main-axis positions (~32px apart, driven by that width gap), so they
// look mismatched. applySymmetricFanoutEmissions exists to equalize such peers,
// but its same-rank gate previously rejected any pair more than 28px apart —
// tighter than the very width-driven drift it was meant to absorb — so it bailed
// and the asymmetry stood. Widening that gate to 40 (still below layerSpacing,
// and AFTER the peer confirmation, so non-peers are never affected) lets the pass
// equalize them. Reverting the gate to 28 fails the assertions below.

import { describe, test, expect } from 'bun:test'
import { parseRegisteredMermaid as parseMermaid, layoutMermaid } from '../agent/index.ts'
import { applySymmetricFanoutEmissions } from '../layout/passes/fanout.ts'
import { parseMermaid as parseGraph } from '../parser.ts'
import { resolveRenderStyle } from '../styles.ts'
import type { Direction, Point, PositionedNode, PositionedEdge } from '../types.ts'
import { renderMermaidSVG } from '../index.ts'
import { decodedSvgAttributeValue, scanSvgStartTags } from '../svg-structure.ts'

const SYM = [
  'flowchart LR',
  '  A["warnings"] -->|warnings| B["ok"]',
  '  B -->|ok| C["rendered"]',
  '  A2["same word: warnings"] --> A',
  '  B2["same word: ok"] --> B',
  '  C -->|warnings| D["warnings"]',
  '  C -->|ok| E["ok"]',
].join('\n')

describe('fan-out peer symmetry', () => {
  for (const direction of ['TB', 'BT', 'LR', 'RL'] satisfies Direction[]) {
    test(`spreads center-aligned unequal terminal peers without moving their bodies in ${direction}`, () => {
      const horizontal = direction === 'LR' || direction === 'RL', reverse = direction === 'BT' || direction === 'RL'
      const point = ({ x, y }: Point): Point => horizontal ? { x: reverse ? 300 - y : y, y: x } : { x, y: reverse ? 300 - y : y }
      const nodes: PositionedNode[] = ([
        { id: 'D', label: 'Root D', shape: 'rectangle', x: 100, y: 0, width: 80, height: 40 },
        { id: 'E', label: 'E0\nE1', shape: 'rectangle', x: 0, y: 88, width: 60, height: 160 },
        { id: 'F', label: 'Branch F', shape: 'rectangle', x: 140, y: 148, width: 98, height: 40 },
      ] satisfies PositionedNode[]).map(node => ({ ...node, ...(horizontal
        ? { x: reverse ? 300 - node.y - node.height : node.y, y: node.x, width: node.height, height: node.width }
        : { y: reverse ? 300 - node.y - node.height : node.y }) }))
      const edges: PositionedEdge[] = ['E', 'F'].map((target, index) => ({ source: 'D', target, style: 'solid', hasArrowStart: false, hasArrowEnd: true,
        points: [{ x: 140, y: 40 }, { x: 140, y: 64 }, { x: index ? 189 : 30, y: 64 }, { x: index ? 189 : 30, y: index ? 148 : 88 }].map(point) }))
      const before = structuredClone(nodes), originalEdges = structuredClone(edges), graph = parseGraph(`flowchart ${direction}\nD --> E\nD --> F`)
      const run = () => applySymmetricFanoutEmissions(nodes, edges, [], graph, new Set(), resolveRenderStyle())
      run()
      expect(nodes).toEqual(before)
      expect(edges.map(edge => [edge.source, edge.target, edge.hasArrowStart, edge.hasArrowEnd])).toEqual([['D', 'E', false, true], ['D', 'F', false, true]])
      const cross = (p: Point) => horizontal ? p.y : p.x
      expect(cross(edges[0]!.points[0]!)).toBeLessThan(cross(edges[1]!.points[0]!))
      for (const edge of edges) {
        const source = nodes[0]!, target = nodes.find(node => node.id === edge.target)!
        for (const [node, p, q, outward] of [[source, edge.points[0]!, edge.points[1]!, reverse ? -1 : 1], [target, edge.points.at(-1)!, edge.points.at(-2)!, reverse ? 1 : -1]] as const) {
          if (horizontal) {
            expect(p.x).toBe(outward > 0 ? node.x + node.width : node.x)
            expect(p.y).toBeGreaterThan(node.y); expect(p.y).toBeLessThan(node.y + node.height)
            expect(q.y).toBe(p.y); expect((q.x - p.x) * outward).toBeGreaterThan(0)
          } else {
            expect(p.y).toBe(outward > 0 ? node.y + node.height : node.y)
            expect(p.x).toBeGreaterThan(node.x); expect(p.x).toBeLessThan(node.x + node.width)
            expect(q.x).toBe(p.x); expect((q.y - p.y) * outward).toBeGreaterThan(0)
          }
        }
      }
      const once = structuredClone(edges)
      run(); expect(edges).toEqual(once)
      // Nearby cases retain their existing routes rather than borrowing this
      // unlabelled, one-band, distinct-terminal-fan contract.
      for (const control of ['caption', 'different centers', 'extra source edge', 'parallel occurrence', 'custom style'] as const) {
        const untouchedNodes = structuredClone(before), untouchedEdges = structuredClone(originalEdges)
        if (control === 'caption') untouchedEdges[0]!.label = 'authored caption'
        if (control === 'different centers') {
          if (horizontal) untouchedNodes[2]!.x += 12
          else untouchedNodes[2]!.y += 12
        }
        if (control === 'extra source edge') untouchedEdges.push({ ...structuredClone(originalEdges[0]!), target: 'D' })
        if (control === 'parallel occurrence') untouchedEdges.push(structuredClone(originalEdges[0]!))
        if (control === 'custom style') untouchedEdges[0]!.inlineStyle = { stroke: 'red' }
        const retained = structuredClone({ nodes: untouchedNodes, edges: untouchedEdges })
        applySymmetricFanoutEmissions(untouchedNodes, untouchedEdges, [], graph, new Set(), resolveRenderStyle())
        expect({ nodes: untouchedNodes, edges: untouchedEdges }).toEqual(retained)
      }
    })
  }

  test('retains measured forest leaf seating and distinct exits through final SVG emission', () => {
    const source = 'flowchart TB\nA[A0<br/>A1<br/>A2<br/>A3<br/>A4<br/>A5<br/>A6<br/>A7] --> B[Branch B]\nA --> C[Branch C]\nD[Root D] --> E[E0<br/>E1<br/>E2<br/>E3<br/>E4<br/>E5<br/>E6<br/>E7]\nD --> F[Branch F]'
    const options = { graphLayout: { backend: 'agentic' as const, fallback: 'none' as const }, embedFontImport: false }
    const svg = renderMermaidSVG(source, options)
    expect(renderMermaidSVG(source, options)).toBe(svg)
    const tags = scanSvgStartTags(svg).map(tag => ({ name: tag.name, ...Object.fromEntries(tag.attributes.map(attribute => [attribute.name, decodedSvgAttributeValue(tag, attribute.name)])) })) as Array<Record<string, string>>
    expect(tags.filter(tag => tag.class === 'node').map(tag => [tag['data-id'], tag['data-label']])).toEqual([
      ['A', 'A0\nA1\nA2\nA3\nA4\nA5\nA6\nA7'], ['B', 'Branch B'], ['C', 'Branch C'], ['D', 'Root D'], ['E', 'E0\nE1\nE2\nE3\nE4\nE5\nE6\nE7'], ['F', 'Branch F'],
    ])
    const routes = tags.filter(tag => tag['data-role'] === 'edge')
    expect(routes.map(tag => [tag['data-from'], tag['data-to'], tag['data-arrow-start'], tag['data-arrow-end']])).toEqual([
      ['A', 'B', 'false', 'true'], ['A', 'C', 'false', 'true'], ['D', 'E', 'false', 'true'], ['D', 'F', 'false', 'true'],
    ])
    const E = tags.find(tag => tag['data-id'] === 'node-shape:E')!, F = tags.find(tag => tag['data-id'] === 'node-shape:F')!
    expect(Number(E.height)).toBeGreaterThan(Number(F.height))
    expect(Number(E.width)).toBeLessThan(Number(F.width))
    // Complete forest leaf seating aligns incoming faces. Centering the short
    // sibling again would restore the extra wire removed by that producer.
    expect(Number(E.y)).toBeCloseTo(Number(F.y), 8)
    const exits = routes.filter(tag => tag['data-from'] === 'D').map(tag => Number(tag.points!.split(/[ ,]/)[0]))
    expect(exits[0]!).toBeLessThan(exits[1]!)
  })

  test('peers with differing label widths are equalized to a common width and aligned', () => {
    const p = parseMermaid(SYM)
    expect(p.ok).toBe(true)
    if (!p.ok) return
    const layout = layoutMermaid(p.value)
    const D = layout.nodes.find(n => n.id === 'D')!
    const E = layout.nodes.find(n => n.id === 'E')!
    expect(D).toBeDefined()
    expect(E).toBeDefined()
    // Equal width (both widened to the wider "warnings" box) ...
    expect(D.w).toBe(E.w)
    // ... and aligned on the main (flow) axis — LR ⇒ identical x.
    expect(D.x).toBe(E.x)
  })
})
