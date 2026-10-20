import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import fc from 'fast-check'
import { asTreemap, describeMermaidFacts, mutate, parseRegisteredMermaid, renderMermaidASCII, renderMermaidSVG, serializeMermaid, verifyMermaid } from '../agent/core.ts'
import { mutateTreemap, renderTreemap } from '../agent/treemap-body.ts'
import { lowerPositionedFamilyScene } from '../graphical-render.ts'
import { positionResolvedFamily } from '../positioning.ts'
import { resolveRenderRequest } from '../render-contract.ts'
import type { SceneNode } from '../scene/ir.ts'
import { visitSceneNodes } from '../scene/walk.ts'
import { layoutTreemapDiagram, resolveTreemapConfig, squarifyTreemap } from '../treemap/layout.ts'
import { parseTreemapDiagram } from '../treemap/parser.ts'
import type { PositionedTreemap } from '../treemap/types.ts'
import { fcParameters } from './helpers/fc-parameters.ts'

const inlineRows = JSON.parse(readFileSync(new URL('../../eval/mermaid-treemap-bench/inline-row-regressions.json', import.meta.url), 'utf8')) as {
  cases: { id: string; source: string; expectedNodes: { label: string; parent: number | null; value: number | null; className: string }[] }[]
}
function hierarchy(body: ReturnType<typeof parseTreemapDiagram>) {
  const indices = new Map(body.nodes.map((node, index) => [node.id, index]))
  return body.nodes.map(node => ({ label: node.label, parent: node.parentId === undefined ? null : indices.get(node.parentId), value: node.value ?? null, className: node.className ?? '' }))
}

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

  test('same-line rows use their own whitespace indentation for following children', () => {
    const body = parseTreemapDiagram('treemap\n"Root"\n  "A":1 "Section"\n    "B":2\n  "C":3')
    expect(body.nodes.map(node => [node.label, node.parentId, node.value])).toEqual([
      ['Root', undefined, undefined],
      ['A', 'treemap-0', 1],
      ['Section', 'treemap-0', undefined],
      ['B', 'treemap-2', 2],
      ['C', 'treemap-2', 3],
    ])
    expect(parseTreemapDiagram(renderTreemap(body))).toEqual(body)
  })

  for (const regression of inlineRows.cases)
    test(`${regression.id} retains the independent pinned parent topology through public serialization`, () => {
      const parsed = parseRegisteredMermaid(regression.source)
      if (!parsed.ok) throw Error(JSON.stringify(parsed.error))
      const diagram = asTreemap(parsed.value)
      if (!diagram) throw Error('Accepted inline grammar rows must retain a native body')
      expect(hierarchy(diagram.body)).toEqual(regression.expectedNodes)
      const canonical = serializeMermaid(diagram),
        reparsed = parseRegisteredMermaid(canonical)
      if (!reparsed.ok) throw Error(JSON.stringify(reparsed.error))
      const again = asTreemap(reparsed.value)
      if (!again) throw Error('Canonical inline grammar rows must retain a native body')
      expect(hierarchy(again.body)).toEqual(regression.expectedNodes)
      expect(serializeMermaid(again)).toBe(canonical)
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

  test('verify names omitted quantitative-cell labels from the actual render and clears the finding when they fit', () => {
    const source = 'treemap\n"Portfolio"\n  "Delivery": 199\n  "Compliance evidence": 1'
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw Error('fixture did not parse')
    for (const input of [source, parsed.value]) {
      const paintedText = [...renderMermaidSVG(input).matchAll(/<text\b[^>]*>[\s\S]*?<\/text>/g)].map(match => match[0]).join('')
      expect(paintedText).not.toContain('Compliance')
      expect(verifyMermaid(input).warnings).toContainEqual(
        expect.objectContaining({
          code: 'LABELS_HIDDEN',
          target: 'data-labels',
          labels: ['Compliance evidence'],
        }),
      )
      const renderOptions = { mermaidConfig: { treemap: { nodeWidth: 2000, nodeHeight: 600 } } }
      expect(renderMermaidSVG(input, renderOptions)).toContain('Compliance')
      expect(renderMermaidSVG(input, renderOptions)).toContain('evidence')
      expect(verifyMermaid(input, { renderOptions }).warnings.filter(warning => warning.code === 'LABELS_HIDDEN')).toEqual([])
    }
    expect(renderMermaidASCII(source)).toContain('Compliance evidence: 1')
  })

  test('hidden and zero-area leaves keep exact accessible data without fabricating painted text or area', () => {
    const source = '---\nconfig:\n  treemap:\n    valueFormat: ".0f"\n---\ntreemap\n"Primary": 9999\n"Rare <risk> & evidence": 0.00000001\n"No incidents": 0'
    const request = resolveRenderRequest(source, { embedFontImport: false }, 'svg'),
      positioned = positionResolvedFamily('treemap', request),
      chart = positioned.positioned as PositionedTreemap,
      svg = renderMermaidSVG(source, { embedFontImport: false }),
      paintedText = [...svg.matchAll(/<text\b[^>]*>[\s\S]*?<\/text>/g)].map(match => match[0]).join('')
    for (const [id, name] of [
      ['treemap-1', 'Rare &lt;risk&gt; &amp; evidence: 1e-8'],
      ['treemap-2', 'No incidents: 0'],
    ]) {
      const group = svg.match(new RegExp(`<g\\b(?=[^>]*\\bdata-id="${id}")[^>]*>[\\s\\S]*?<\\/g>`))?.[0] ?? ''
      expect(group).toContain('role="graphics-symbol"')
      expect(group).toContain(`aria-label="${name}"`)
      expect(group).toContain(`<title>${name}</title>`)
    }
    expect(paintedText).not.toContain('Rare')
    expect(paintedText).not.toContain('No incidents')
    const zero = chart.cells.find(cell => cell.node.id === 'treemap-2')!
    expect([zero.width, zero.height]).toEqual([0, 0])
    expect(verifyMermaid(source).warnings).toContainEqual(expect.objectContaining({ code: 'LABELS_HIDDEN', labels: ['Rare <risk> & evidence', 'No incidents'] }))
    expect(renderMermaidASCII(source)).toContain('Rare <risk> & evidence: 0')
  })

  test('exhausted content space retains nested quantities and accessible ancestry across canonical reload', () => {
    const source = '---\nconfig:\n  treemap:\n    nodeHeight: 4.2\n---\ntreemap\n"Branch"\n  "Inner"\n    "Budget": 1\n  "Empty": 0',
      options = { style: { roles: { group: { fontSize: 10 } } } }
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw Error('fixture did not parse')
    for (const input of [source, serializeMermaid(parsed.value)]) {
      const request = resolveRenderRequest(input, options, 'svg'),
        chart = positionResolvedFamily('treemap', request).positioned as PositionedTreemap,
        svg = renderMermaidSVG(input, options)
      expect(chart.cells.map(cell => [cell.node.id, cell.node.parentId, cell.total])).toEqual([
        ['treemap-0', undefined, 1],
        ['treemap-1', 'treemap-0', 1],
        ['treemap-2', 'treemap-1', 1],
        ['treemap-3', 'treemap-0', 0],
      ])
      for (const cell of chart.cells.slice(1)) expect([cell.width, cell.height, cell.label, cell.valueLabel]).toEqual([0, 0, undefined, undefined])
      expect(new Set(chart.hiddenLabels)).toEqual(new Set(['Inner', 'Budget', 'Empty']))
      for (const [id, role, name, parent] of [
        ['treemap-1', 'group', 'Inner: 1', 'treemap-0'],
        ['treemap-2', 'graphics-symbol', 'Budget: 1', 'treemap-1'],
        ['treemap-3', 'graphics-symbol', 'Empty: 0', 'treemap-0'],
      ]) {
        const open = svg.match(new RegExp(`<g\\b(?=[^>]*\\bdata-id="${id}")[^>]*>`))?.[0] ?? ''
        expect(open).toContain(` role="${role}"`)
        expect(open).toContain(`aria-label="${name}"`)
        expect(open).toContain(`data-parent="${parent}"`)
        expect(svg).toContain(`${open}<title>${name}</title>`)
      }
      expect(verifyMermaid(input, { renderOptions: options }).warnings).toContainEqual(expect.objectContaining({ code: 'LABELS_HIDDEN', labels: expect.arrayContaining(['Inner', 'Budget', 'Empty']) }))
      expect(renderMermaidASCII(input)).toContain('Budget: 1')
    }
  })

  test('section typography and header paint coexist with bound quantitative bars and authored classes', () => {
    const source = 'treemap\n"Region A"\n  "Large": 60:::hot\n  "Small": 40\n"Region B"\n  "Other": 100\nclassDef hot fill:#ff9966,stroke:#333333,stroke-width:2px,color:#111111;',
      style = {
        roles: {
          group: { fontFamily: 'Inter', fontSize: 18, fontWeight: 750, textTransform: 'uppercase', letterSpacing: 0.5, paddingX: 14, paddingY: 9, fillColor: '#eef2ff', headerFillColor: '#dbeafe', textColor: '#112233', borderColor: '#334155', lineWidth: 2, cornerRadius: 8 },
          node: { fontSize: 11, fontWeight: 600, textTransform: 'lowercase', letterSpacing: 0.3, fillColor: '#ccffcc', cornerRadius: 3, paddingX: 7, paddingY: 5 },
          bar: { borderColor: '#222222' },
        },
        semanticSlots: { selected: { fillColor: '#1d4ed8', strokeColor: '#020617', lineWidth: 3 } },
        bindings: [{ channel: 'category', value: '0', slot: 'selected', role: 'bar' }],
      } as const,
      request = resolveRenderRequest(source, { style }, 'svg'),
      positioned = positionResolvedFamily('treemap', request),
      chart = positioned.positioned as PositionedTreemap,
      group = chart.cells.find(cell => cell.node.label === 'Region A')!,
      otherGroup = chart.cells.find(cell => cell.node.label === 'Region B')!,
      large = chart.cells.find(cell => cell.node.label === 'Large')!,
      small = chart.cells.find(cell => cell.node.label === 'Small')!
    expect(group.label).toMatchObject({ text: 'REGION A', fontSize: 18, fontWeight: 750, fontFamily: 'Inter', letterSpacing: 0.5 })
    expect(large.label).toMatchObject({ text: 'large', fontSize: 11, fontWeight: 600, letterSpacing: 0.3 })
    expect(large.labelY).toBe(large.y + 5 + large.label!.height / 2)
    expect(group.valueLabel).toMatchObject({ text: '100', fontSize: 18, fontWeight: 750 })
    expect(group.width * group.height).toBeCloseTo(otherGroup.width * otherGroup.height, 8)
    expect((large.width * large.height) / (small.width * small.height)).toBeCloseTo(1.5, 8)
    expect(large.x).toBeGreaterThanOrEqual(group.x + 14)
    expect(large.y).toBeGreaterThanOrEqual(group.y + group.headerHeight! + 9)
    const nodes: SceneNode[] = []
    visitSceneNodes(lowerPositionedFamilyScene(request, positioned).parts, node => nodes.push(node))
    const bar = (id: string) => nodes.find(node => node.kind === 'shape' && node.role === 'bar' && node.owner?.id === id)
    expect(bar(group.node.id)).toMatchObject({ geometry: { kind: 'rect', rx: 8 }, channels: { category: '0', value: 0.5 }, paint: { fill: '#1d4ed8', stroke: '#020617', strokeWidth: '3' } })
    expect(bar(large.node.id)).toMatchObject({ channels: { value: 0.3 }, paint: { fill: '#ff9966', stroke: '#333333', strokeWidth: '2px' } })
    expect(bar(small.node.id)).toMatchObject({ paint: { fill: '#1d4ed8' } })
    expect(nodes.find(node => node.id === `header:${group.node.id}`)).toMatchObject({ role: 'chrome', owner: { id: group.node.id, role: 'group' }, paint: { fill: '#dbeafe' } })
    expect(nodes.find(node => node.id === `label:${group.node.id}`)).toMatchObject({ paint: { fill: '#112233' } })
    expect(nodes.find(node => node.id === `label:${large.node.id}`)).toMatchObject({ owner: { id: large.node.id, role: 'node' }, paint: { fill: '#111111' } })
    expect(renderMermaidSVG(source, { style }).replace(/<[^>]*>/g, '')).toContain('REGION A')
    const authoredRequest = resolveRenderRequest(source.replace('"Region A"', '"Region A":::hot'), { style }, 'svg'),
      authoredScene = lowerPositionedFamilyScene(authoredRequest, positionResolvedFamily('treemap', authoredRequest)),
      authoredNodes: SceneNode[] = []
    visitSceneNodes(authoredScene.parts, node => authoredNodes.push(node))
    expect(authoredNodes.find(node => node.id === `header:${group.node.id}`)).toMatchObject({ paint: { fill: '#ff9966' } })
    const lowContrast = { ...style, roles: { ...style.roles, group: { ...style.roles.group, textColor: '#ffffff' } } },
      lowRequest = resolveRenderRequest(source, { style: lowContrast }, 'svg'),
      lowNodes: SceneNode[] = []
    visitSceneNodes(lowerPositionedFamilyScene(lowRequest, positionResolvedFamily('treemap', lowRequest)).parts, node => lowNodes.push(node))
    expect(lowNodes.find(node => node.id === `label:${group.node.id}`)).toMatchObject({ paint: { fill: '#ffffff' } })
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
