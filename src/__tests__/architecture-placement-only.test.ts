import { describe, expect, test } from 'bun:test'
import { layoutNativeGraphPlacementSync } from '../layout-engine.ts'
import { layoutAgenticGraph, type MeasuredGraph } from '../layout/agentic-layered.ts'
import { createMeasuredLayoutCache } from '../layout/agentic-producer-core.ts'
import { GraphLayoutUnsupportedError } from '../layout/backend.ts'
import { parseArchitectureDiagram, architectureToMermaidGraph } from '../architecture/parser.ts'
import { layoutArchitectureDiagram } from '../architecture/layout.ts'
import { architectureLayoutMetrics, DEFAULT_ARCHITECTURE_VISUAL } from '../architecture/config.ts'
import { toMermaidLines } from '../mermaid-source.ts'
import { renderMermaidSVGWithReceipt } from '../index.ts'
import { layoutMermaidWithReceipt } from '../agent/core.ts'
import { scanSvgStartTags } from '../svg-structure.ts'
import type { RenderOptions } from '../types.ts'

describe('Architecture placement-only ownership', () => {
  test('returns only placement and preserves family-owned junction sizing', () => {
    const graph = architectureToMermaidGraph(parseArchitectureDiagram(toMermaidLines('architecture-beta\njunction j\nservice b(server)[B]\nj:R-->L:b')))
    const original = structuredClone(graph)
    const placed = layoutNativeGraphPlacementSync(graph, { nodeSizes: new Map([['j', { width: 92, height: 92 }]]) })
    expect(Object.keys(placed).sort()).toEqual(['groups', 'height', 'nodes', 'width'])
    expect(placed.nodes.find(node => node.id === 'j')).toEqual(expect.objectContaining({ width: 92, height: 92 }))
    expect(graph).toEqual(original)
  })

  test.each([
    ['four-line group', 'architecture-beta\ngroup g["One<br/>Two<br/>Three<br/>Four"]\nservice a(server)[A] in g', {}],
    ['nested custom-font groups', 'architecture-beta\ngroup outer["Outer<br/>Header"]\ngroup inner["One<br/>Two<br/>Three<br/>Four"] in outer\nservice a(server)[A] in inner', { groupFontSize: 20, groupFontWeight: 700, groupLetterSpacing: 1 }],
  ] as const)('retains measured header bands and centers multiline titles: %s', (_name, source, overrides) => {
    const visual = { ...DEFAULT_ARCHITECTURE_VISUAL, ...overrides }
    const options: RenderOptions = { graphLayout: { backend: 'agentic', fallback: 'none' }, architecture: { visual: overrides } }
    const model = parseArchitectureDiagram(toMermaidLines(source))
    const placed = layoutArchitectureDiagram(model, options, architectureLayoutMetrics(visual))
    const groups = placed.groups.flatMap(group => [group, ...group.children])
    const rendered = renderMermaidSVGWithReceipt(source, options)
    const tags = scanSvgStartTags(rendered.svg).map(tag => Object.fromEntries(tag.attributes.map(attr => [attr.name, attr.value])))
    const bands = tags.filter(tag => tag.class === 'architecture-group-band')
    const titles = tags.filter(tag => tag.class === 'architecture-group-label')
    expect(bands).toHaveLength(groups.length)
    expect(titles).toHaveLength(groups.length)
    for (const [index, group] of groups.entries()) {
      expect(group.headerHeight).toBeDefined()
      const bandBottom = Number(bands[index]!.d!.match(/ V([-\d.]+)/)![1])
      const titleCenter = Number(titles[index]!.y)
      expect(bandBottom - group.y).toBeGreaterThanOrEqual(group.labelBlock!.height + 8)
      expect(bandBottom).toBeCloseTo(group.y + group.headerHeight!, 5)
      expect(titleCenter).toBeCloseTo(group.y + group.headerHeight! / 2, 5)
      expect(titleCenter - group.labelBlock!.height / 2).toBeGreaterThanOrEqual(group.y + 4)
      expect(titleCenter + group.labelBlock!.height / 2).toBeLessThanOrEqual(bandBottom - 4)
      const children = [...group.children, ...placed.services.filter(service => service.parentId === group.id)]
      for (const child of children) expect(child.y).toBeGreaterThanOrEqual(bandBottom)
      expect(group.label).toBe(model.groups.find(authored => authored.id === group.id)!.label)
    }
    expect(rendered.receipt.layoutCertification?.status).toBe('passed')
    expect(rendered.receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'agentic' })])
  })

  test('keeps the placement-only flag in the measured cache key and clones returned geometry', () => {
    let computations = 0
    const cached = createMeasuredLayoutCache(input => {
      computations++
      return { topology: 'layered', width: 100, height: 100, nodes: [{ x: input.placementOnly ? 20 : 10, y: 10 }], edges: [] }
    })
    const input: MeasuredGraph = { nodes: [{ id: 'a', width: 10, height: 10 }], edges: [], direction: 'TB', padding: 10, nodeSpacing: 10, layerSpacing: 10 }
    expect(cached(input).nodes[0]!.x).toBe(10)
    const placement = cached({ ...input, placementOnly: true })
    expect(placement.nodes[0]!.x).toBe(20)
    placement.nodes[0]!.x = 999
    expect(cached({ ...input, placementOnly: true }).nodes[0]!.x).toBe(20)
    expect(computations).toBe(process.env.AGENTIC_MERMAID_ELK_CACHE === '0' ? 3 : 2)
  })

  test('omits acyclic route output without changing rank/channel placement', () => {
    const input: MeasuredGraph = { nodes: ['a', 'b', 'c'].map(id => ({ id, width: 80, height: 40 })),
      edges: [{ source: 0, target: 1, minSpan: 1, label: { width: 90, height: 25 } }, { source: 0, target: 2, minSpan: 2 }],
      direction: 'TB', padding: 20, nodeSpacing: 35, layerSpacing: 50 }
    const full = layoutAgenticGraph(input), placement = layoutAgenticGraph({ ...input, placementOnly: true })
    expect(placement.nodes).toEqual(full.nodes)
    expect([placement.width, placement.height]).toEqual([full.width, full.height])
    expect(placement.edges).toEqual([{ points: [] }, { points: [] }])
    expect(full.edges.every(edge => edge.points.length >= 2)).toBe(true)
  })

  test('retains every cross-scope edge as a rank constraint beyond the boundary-router limit', () => {
    const nodes = Array.from({ length: 18 }, (_, index) => ({ id: `n${index}`, width: 40, height: 30, parent: index < 9 ? 0 : 1 }))
    const input: MeasuredGraph = { nodes, groups: ['first', 'second'].map(id => ({ id, minWidth: 100, padding: { top: 20, left: 10, right: 10, bottom: 10 } })),
      edges: Array.from({ length: 18 }, (_, index) => ({ source: 9 + index % 9, target: index % 9, minSpan: index === 17 ? 3 : 1 })),
      direction: 'TB', padding: 20, nodeSpacing: 35, layerSpacing: 50 }
    const original = structuredClone(input)
    expect(() => layoutAgenticGraph(input)).toThrow('agentic local cross-hierarchy size limit')
    const placement = layoutAgenticGraph({ ...input, placementOnly: true })
    expect(placement.groups![1]!.y + placement.groups![1]!.height).toBeLessThan(placement.groups![0]!.y)
    expect(placement.edges).toHaveLength(input.edges.length)
    expect(input).toEqual(original)
  })

  test('keeps temporary cyclic and loop geometry when placement selection depends on it', () => {
    const nodes = ['a', 'b', 'c'].map(id => ({ id, width: 80, height: 40 }))
    for (const edges of [
      [{ source: 0, target: 1, minSpan: 1 }, { source: 1, target: 2, minSpan: 1 }, { source: 2, target: 0, minSpan: 1 }],
      [{ source: 0, target: 0, minSpan: 1, label: { width: 70, height: 24 } }],
    ]) {
      const input: MeasuredGraph = { nodes, edges, direction: 'TB', padding: 20, nodeSpacing: 35, layerSpacing: 50 }
      expect(layoutAgenticGraph({ ...input, placementOnly: true }).nodes).toEqual(layoutAgenticGraph(input).nodes)
    }
  })

  test('does not turn unsupported hints or defects into an edge-filtered retry', () => {
    const graph = architectureToMermaidGraph(parseArchitectureDiagram(toMermaidLines('architecture-beta\nservice a(server)[A]\nservice b(server)[B]\na:R-->L:b')))
    expect(() => layoutNativeGraphPlacementSync(graph, { layoutHints: { ranks: { a: 0 } } })).toThrow(GraphLayoutUnsupportedError)
    graph.edges[0]!.target = 'missing'
    expect(() => layoutNativeGraphPlacementSync(graph)).toThrow('unknown endpoint')
  })
})

const backends: [string, RenderOptions][] = [
  ['default', {}], ['ELK', { graphLayout: { backend: 'elk' } }],
  ['native', { graphLayout: { backend: 'agentic', fallback: 'none' } }],
  ['native with explicit ELK fallback', { graphLayout: { backend: 'agentic', fallback: 'elk' } }],
]
for (const [name, backend] of backends) for (const [from, to] of [['R', 'L'], ['L', 'R'], ['T', 'B'], ['B', 'T']]) {
  test(`custom Architecture rings reserve space, contact authored sides and retain family proof: ${name}/${from}`, () => {
    const source = `architecture-beta\njunction j\njunction unused\nservice b(server)[B]\nj:${from}<-->${to}:b`
    const options: RenderOptions = { ...backend, architecture: { visual: { junctionOuterRadius: 40 } } }
    const rendered = renderMermaidSVGWithReceipt(source, options)
    expect(rendered.receipt.layoutCertification?.status).toBe('passed')
    const layout = layoutMermaidWithReceipt(source, { ...options, debug: true }).layout
    const junction = layout.nodes.find(node => node.id === 'j')!, unused = layout.nodes.find(node => node.id === 'unused')!
    expect([junction.w, junction.h, unused.w, unused.h].map(Number)).toEqual([80, 80, 80, 80])
    expect(Math.hypot(junction.x - unused.x, junction.y - unused.y)).toBeGreaterThanOrEqual(80 + 36)
    const tags = scanSvgStartTags(rendered.svg).map(tag => ({ name: tag.name, attrs: Object.fromEntries(tag.attributes.map(attr => [attr.name, attr.value])) }))
    const ring = tags.find(tag => tag.attrs['data-id'] === 'junction-ring:j')!.attrs
    expect(Number(ring.r)).toBe(40)
    expect(Math.abs(junction.x + 40 - Number(ring.cx))).toBeLessThanOrEqual(.5)
    expect(Math.abs(junction.y + 40 - Number(ring.cy))).toBeLessThanOrEqual(.5)
    const route = tags.find(tag => tag.attrs.class === 'architecture-edge')!.attrs
    const values = (route.points ?? route.d ?? '').match(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi)!.map(Number)
    expect(values[0]).toBeCloseTo(Number(ring.cx) + (from === 'L' ? -40 : from === 'R' ? 40 : 0), 5)
    expect(values[1]).toBeCloseTo(Number(ring.cy) + (from === 'T' ? -40 : from === 'B' ? 40 : 0), 5)
    expect(layout.edges[0]!.route?.invariant).toBe('side-anchored')
    if (backend.graphLayout) expect(rendered.receipt.layoutDecisions?.[0]!.selected).toBe(backend.graphLayout.backend)
    else expect(rendered.receipt.layoutDecisions).toBeUndefined()
  })
}
