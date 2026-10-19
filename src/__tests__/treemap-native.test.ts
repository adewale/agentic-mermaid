import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import { parseTreemapDiagram } from '../treemap/parser.ts'
import { layoutTreemapDiagram, squarifyTreemap, resolveTreemapConfig } from '../treemap/layout.ts'
import { renderTreemap, mutateTreemap } from '../agent/treemap-body.ts'
import { parseRegisteredMermaid, asTreemap, mutate, serializeMermaid, verifyMermaid, renderMermaidSVG, renderMermaidASCII, describeMermaidFacts } from '../agent/core.ts'
import { fcParameters } from './helpers/fc-parameters.ts'

describe('native Treemap', () => {
  test('retains indentation, sibling order, duplicate labels and late class definitions', () => {
    const body = parseTreemapDiagram('treemap\n"First"\n  "Same": 10:::hot\n  "Nested"\n    "Same", 30\n"Second"\n  "Other": 60\nclassDef hot fill:#f96,color:#111;')
    expect(body.nodes.map(node => [node.label, node.parentId, node.value])).toEqual([
      ['First', undefined, undefined],
      ['Same', 'treemap-0', 10],
      ['Nested', 'treemap-0', undefined],
      ['Same', 'treemap-2', 30],
      ['Second', undefined, undefined],
      ['Other', 'treemap-4', 60],
    ])
    expect(body.classDefs.hot).toEqual({ fill: '#f96', color: '#111' })
    expect(parseTreemapDiagram(renderTreemap(body))).toEqual(body)
  })

  test('area partitions conserve quantity and stay disjoint for generated positive weights', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 10000 }), { minLength: 1, maxLength: 30 }), weights => {
        const total = weights.reduce((a, b) => a + b, 0)
        const tiles = squarifyTreemap(
          weights.map((value, index) => ({ id: String(index), value })),
          { x: 13, y: 17, width: 840, height: 520 },
        )
        expect(tiles).toHaveLength(weights.length)
        for (const tile of tiles) {
          expect((tile.width * tile.height) / (840 * 520)).toBeCloseTo(weights[Number(tile.id)]! / total, 9)
          expect(tile.x).toBeGreaterThanOrEqual(13 - 1e-7)
          expect(tile.y).toBeGreaterThanOrEqual(17 - 1e-7)
          expect(tile.x + tile.width).toBeLessThanOrEqual(853 + 1e-7)
          expect(tile.y + tile.height).toBeLessThanOrEqual(537 + 1e-7)
        }
        for (let i = 0; i < tiles.length; i++)
          for (let j = i + 1; j < tiles.length; j++) {
            const a = tiles[i]!,
              b = tiles[j]!
            const overlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
            expect(overlap).toBeLessThan(1e-6)
          }
      }),
      fcParameters({ numRuns: 100 }),
    )
  })

  test('quoted siblings on one physical line retain line indentation and following nested children', () => {
    const body = parseTreemapDiagram('treemap\n"Root"\n  "A":1 "Section"\n    "B":2\n  "C":3')
    expect(body.nodes.map(node => [node.label, node.parentId, node.value])).toEqual([
      ['Root', undefined, undefined],
      ['A', 'treemap-0', 1],
      ['Section', 'treemap-0', undefined],
      ['B', 'treemap-2', 2],
      ['C', 'treemap-0', 3],
    ])
    expect(parseTreemapDiagram(renderTreemap(body))).toEqual(body)
  })

  test('typed edits reject cycles and preserve unrelated branches through canonical reload', () => {
    const parsed = parseRegisteredMermaid('treemap\n"Root"\n  "A": 20\n  "Branch"\n    "B": 30')
    if (!parsed.ok) throw Error('fixture did not parse')
    const diagram = asTreemap(parsed.value)!
    expect(diagram).not.toBeNull()
    expect(mutate(diagram, { kind: 'move_node', id: 'treemap-0', parentId: 'treemap-2' }).ok).toBe(false)
    const changed = mutate(diagram, { kind: 'set_value', id: 'treemap-3', value: 60 })
    expect(changed.ok).toBe(true)
    if (!changed.ok) return
    expect(describeMermaidFacts(changed.value)).toContain('node#3 treemap-3 parent treemap-2 : "B" value 60')
    expect(serializeMermaid(diagram)).toContain('"B": 30')
  })

  test('large budget values render and long frontmatter titles remain visible in all outputs', () => {
    const source = '---\ntitle: Product investment\n---\ntreemap\n"Build"\n  "Engineering": 7000000\n  "Design": 3000000'
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw Error('fixture did not parse')
    expect(verifyMermaid(parsed.value).ok).toBe(true)
    for (const style of ['default', 'hand-drawn', 'watercolor', 'blueprint']) {
      const svg = renderMermaidSVG(source, style === 'default' ? {} : { style })
      expect(svg).toContain('Engineering')
      expect(svg).toContain('Product investment')
      expect(svg).not.toMatch(/\b(?:NaN|Infinity)\b/)
    }
    expect(renderMermaidASCII(source)).toContain('Engineering: 7,000,000')
  })

  test('readable numeric separators retain quantity and disclose pinned portability', () => {
    const parsed = parseRegisteredMermaid('treemap\n"Budget": 7_000')
    if (!parsed.ok) throw Error('fixture did not parse')
    expect(asTreemap(parsed.value)!.body.nodes[0]!.value).toBe(7000)
    expect(verifyMermaid(parsed.value).warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax: 'treemap_numeric_separator' }))
  })

  test('small and large finite edits write decimal Mermaid quantities without rounding them', () => {
    const body = parseTreemapDiagram('treemap\n"Value": 1')
    for (const value of [1e-8, 1e30, 1.2345678901234568e25]) {
      const changed = mutateTreemap(body, { kind: 'set_value', id: 'treemap-0', value })
      if (!changed.ok) throw Error(changed.error.message)
      const source = renderTreemap(changed.value)
      expect(source).not.toMatch(/\d[eE][+-]?\d/)
      expect(parseTreemapDiagram(source).nodes[0]!.value).toBe(value)
    }
  })

  test('zero weights never fabricate area and unknown syntax remains lossless but cannot draw', () => {
    const body = parseTreemapDiagram('treemap\n"Empty": 0\n"Present": 10')
    const chart = layoutTreemapDiagram(body)
    expect(chart.cells.find(cell => cell.node.label === 'Empty')!.width).toBe(0)
    expect(mutateTreemap(body, { kind: 'set_value', id: 'treemap-0', value: -1 }).ok).toBe(false)
    expect(resolveTreemapConfig({ nodeWidth: -1 }).width).toBe(resolveTreemapConfig().width)
    const source = 'treemap\n"A": 1\nunknown syntax'
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw Error('fixture did not preserve')
    expect(parsed.value.body.kind).toBe('opaque')
    expect(serializeMermaid(parsed.value).trimEnd()).toBe(source)
    expect(verifyMermaid(parsed.value).ok).toBe(false)
  })
})
