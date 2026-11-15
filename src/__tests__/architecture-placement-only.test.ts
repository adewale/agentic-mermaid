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

  test('retains every cross-scope rank constraint when full boundary routing has no clear corridor', () => {
    const nodes = Array.from({ length: 18 }, (_, index) => ({ id: `n${index}`, width: 40, height: 30, parent: index < 9 ? 0 : 1 }))
    const input: MeasuredGraph = { nodes, groups: ['first', 'second'].map(id => ({ id, minWidth: 100, padding: { top: 20, left: 10, right: 10, bottom: 10 } })),
      edges: Array.from({ length: 18 }, (_, index) => ({ source: 9 + index % 9, target: index % 9, minSpan: index === 17 ? 3 : 1 })),
      direction: 'TB', padding: 20, nodeSpacing: 35, layerSpacing: 50 }
    const original = structuredClone(input)
    let routingFailure: unknown
    try { layoutAgenticGraph(input) } catch (error) { routingFailure = error }
    expect(routingFailure).toBeInstanceOf(GraphLayoutUnsupportedError)
    expect((routingFailure as GraphLayoutUnsupportedError).reason).toBe('cross-hierarchy route has no bounded clear corridor')
    const placement = layoutAgenticGraph({ ...input, placementOnly: true })
    const shortLinks = layoutAgenticGraph({ ...input, placementOnly: true, edges: input.edges.map(edge => ({ ...edge, minSpan: 1 })) })
    expect(placement.groups![1]!.y + placement.groups![1]!.height).toBeLessThan(placement.groups![0]!.y)
    // The last parallel occurrence carries the longer authored span. Keeping
    // only one edge per scope pair would lose this additional rank separation.
    expect(placement.groups![0]!.y).toBeGreaterThan(shortLinks.groups![0]!.y)
    expect(placement.edges).toHaveLength(input.edges.length)
    expect(placement.edges.every(edge => edge.points.length === 0)).toBe(true)
    for (const [index, node] of placement.nodes.entries()) {
      const group = placement.groups![nodes[index]!.parent]!
      expect(node.x).toBeGreaterThanOrEqual(group.x + 10)
      expect(node.y).toBeGreaterThanOrEqual(group.y + 20)
      expect(node.x + nodes[index]!.width).toBeLessThanOrEqual(group.x + group.width - 10)
      expect(node.y + nodes[index]!.height).toBeLessThanOrEqual(group.y + group.height - 10)
    }
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

  test('applies internal rank hints and propagates invalid hints and endpoint defects', () => {
    const graph = architectureToMermaidGraph(parseArchitectureDiagram(toMermaidLines('architecture-beta\nservice a(server)[A]\nservice b(server)[B]\na:R-->L:b')))
    const original = structuredClone(graph)
    const plain = layoutNativeGraphPlacementSync(graph)
    // Unlisted siblings default to partition zero, so a singleton zero hint
    // retains placement while a positive partition places a after b in LR.
    expect(layoutNativeGraphPlacementSync(graph, { layoutHints: { ranks: { a: 0 } } })).toEqual(plain)
    const ranked = layoutNativeGraphPlacementSync(graph, { layoutHints: { ranks: { a: 1 } } })
    const a = ranked.nodes.find(node => node.id === 'a')!, b = ranked.nodes.find(node => node.id === 'b')!
    expect(b.x + b.width).toBeLessThan(a.x)
    expect(ranked.nodes.map(node => node.id)).toEqual(plain.nodes.map(node => node.id))
    expect(graph).toEqual(original)
    expect(() => layoutNativeGraphPlacementSync(graph, { layoutHints: { ranks: { absent: 1 } } })).toThrow('LAYOUT_HINT_INVALID: unknown node')
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


// Explicit height is a requested minimum; the omission path stays separate.
for (const backend of ['elk', 'agentic'] as const) for (const fixture of [
  { name: 'one-line band', minimum: 36, source: 'architecture-beta\ngroup g(cloud)[Group]\nservice a(server)[A] in g\nservice b(server)[B]\na:R-->L:b' },
  { name: 'multiline measured minimum', minimum: 10, source: 'architecture-beta\ngroup g(cloud)["One<br/>Two<br/>Three<br/>Four"]\nservice a(server)[A] in g\nservice b(server)[B]\na:R-->L:b' },
  { name: 'nested title and normal exit', minimum: 64, source: 'architecture-beta\ntitle Visible Architecture\ngroup outer(cloud)[Outer]\ngroup inner(server)[Inner] in outer\nservice a(server)[A] in inner\nservice b(server)[B]\na:T-->B:b' },
  { name: 'empty measured footprint', minimum: 96, source: 'architecture-beta\ngroup empty(cloud)[Empty Group]\ngroup app(server)[Application]\nservice a(server)[A] in app\nservice b(database)[B]\na:R-->L:b' },
]) {
  test(`explicit Architecture header minimum reserves actual geometry: ${backend}/${fixture.name}`, () => {
    const options: RenderOptions = { graphLayout: { backend, fallback: 'none' }, architecture: { visual: { groupHeaderHeight: fixture.minimum } } }
    const model = parseArchitectureDiagram(toMermaidLines(fixture.source))
    const placed = layoutArchitectureDiagram(model, options, architectureLayoutMetrics(DEFAULT_ARCHITECTURE_VISUAL))
    const groups = placed.groups.flatMap(group => [group, ...group.children])
    const rendered = renderMermaidSVGWithReceipt(fixture.source, options)
    const tags = scanSvgStartTags(rendered.svg).map(tag => Object.fromEntries(tag.attributes.map(attr => [attr.name, attr.value])))
    const bands = tags.filter(tag => tag.class === 'architecture-group-band'), titles = tags.filter(tag => tag.class === 'architecture-group-label')
    expect(bands).toHaveLength(groups.length)
    for (const [index, group] of groups.entries()) {
      const height = group.headerHeight!
      expect(height).toBeGreaterThanOrEqual(fixture.minimum)
      expect(height).toBeGreaterThanOrEqual(group.labelBlock!.height + 8)
      expect(Number(bands[index]!.d!.match(/ V([-\d.]+)/)![1])).toBeCloseTo(group.y + height, 5)
      expect(Number(titles[index]!.y)).toBeCloseTo(group.y + height / 2, 5)
      const children = [...group.children, ...placed.services.filter(service => service.parentId === group.id), ...placed.junctions.filter(junction => junction.parentId === group.id)]
      for (const child of children) expect(child.y).toBeGreaterThanOrEqual(group.y + height + 18)
      if (children.length === 0) {
        expect(group.width).toBeGreaterThanOrEqual(36 + group.labelBlock!.width + 12)
        expect(group.height).toBeGreaterThanOrEqual(height)
      }
      expect(group.y + height).toBeLessThanOrEqual(placed.height)
    }
    const items = new Map([...placed.services, ...placed.junctions].map(item => [item.id, item]))
    for (const edge of placed.edges) {
      expect(edge.obstacleFree).toBe(true)
      for (const [endpoint, port, next] of [[edge.source, edge.points[0]!, edge.points[1]!], [edge.target, edge.points.at(-1)!, edge.points.at(-2)!]] as const) {
        const box = items.get(endpoint.id)!
        expect(port.x).toBe(endpoint.side === 'L' ? box.x : endpoint.side === 'R' ? box.x + box.width : box.x + box.width / 2)
        expect(port.y).toBe(endpoint.side === 'T' ? box.y : endpoint.side === 'B' ? box.y + box.height : box.y + box.height / 2)
        const outward = endpoint.side === 'L' ? next.x < port.x && next.y === port.y
          : endpoint.side === 'R' ? next.x > port.x && next.y === port.y
          : endpoint.side === 'T' ? next.y < port.y && next.x === port.x : next.y > port.y && next.x === port.x
        expect(outward).toBe(true)
      }
      for (const group of groups) for (let index = 1; index < edge.points.length; index++) {
        const a = edge.points[index - 1]!, b = edge.points[index]!
        expect(Math.max(a.x, b.x) > group.x && Math.min(a.x, b.x) < group.x + group.width
          && Math.max(a.y, b.y) > group.y && Math.min(a.y, b.y) < group.y + group.headerHeight!).toBe(false)
      }
    }
    const edges = tags.filter(tag => tag.class === 'architecture-edge')
    expect(edges).toHaveLength(model.edges.length)
    for (const [index, edge] of model.edges.entries()) {
      expect(edges[index]!['data-from']).toBe(edge.source.id)
      expect(edges[index]!['data-to']).toBe(edge.target.id)
      expect(edges[index]!['data-from-side']).toBe(edge.source.side)
      expect(edges[index]!['data-to-side']).toBe(edge.target.side)
      expect(edges[index]!['marker-end']).toBeDefined()
    }
  })
}


for (const backend of ['elk', 'agentic'] as const) {
  test(`explicit Architecture header minima stay isolated across repeated requests: ${backend}`, () => {
    const source = 'architecture-beta\ngroup g(cloud)[Group]\nservice a(server)[A] in g\nservice b(server)[B]\na:R-->L:b'
    const render = (minimum?: number) => renderMermaidSVGWithReceipt(source, { graphLayout: { backend, fallback: 'none' }, ...(minimum === undefined ? {} : { architecture: { visual: { groupHeaderHeight: minimum } } }) }).svg
    const omitted = render(), first = render(36), higher = render(64), repeated = render(36), omittedAgain = render()
    expect(repeated).toBe(first)
    expect(omittedAgain).toBe(omitted)
    expect(first).not.toBe(omitted)
    expect(higher).not.toBe(first)
    const bandHeight = (svg: string) => {
      const path = scanSvgStartTags(svg).map(tag => Object.fromEntries(tag.attributes.map(attr => [attr.name, attr.value]))).find(tag => tag.class === 'architecture-group-band')!.d!
      const values = /^M[-\d.]+,([-\d.]+) H[-\d.]+ V([-\d.]+)/.exec(path)!
      return Number(values[2]) - Number(values[1])
    }
    expect(bandHeight(first)).toBe(36)
    expect(bandHeight(higher)).toBe(64)
    expect(bandHeight(omittedAgain)).toBe(28)
  })

  test(`an explicit standalone empty Architecture group reserves its actual title and frame: ${backend}`, () => {
    const svg = renderMermaidSVGWithReceipt('architecture-beta\ngroup empty(cloud)[Empty Group]', { graphLayout: { backend, fallback: 'none' }, architecture: { visual: { groupHeaderHeight: 96 } } }).svg
    const tags = scanSvgStartTags(svg).map(tag => Object.fromEntries(tag.attributes.map(attr => [attr.name, attr.value])))
    const frame = tags.find(tag => tag.class === 'architecture-group-frame')!, band = tags.find(tag => tag.class === 'architecture-group-band')!, title = tags.find(tag => tag.class === 'architecture-group-label')!, canvas = tags[0]!
    const values = /^M[-\d.]+,([-\d.]+) H[-\d.]+ V([-\d.]+)/.exec(band.d!)!
    const height = Number(values[2]) - Number(values[1])
    expect(height).toBe(96)
    expect(Number(frame.width)).toBeGreaterThan(36 + Number(title.textLength))
    expect(Number(frame.height)).toBeGreaterThanOrEqual(height)
    expect(Number(title.y)).toBe(Number(frame.y) + height / 2)
    expect(Number(title.x) + Number(title.textLength)).toBeLessThan(Number(canvas.width))
    expect(Number(title.y) + Number(title['font-size'])).toBeLessThan(Number(canvas.height))
  })
}
