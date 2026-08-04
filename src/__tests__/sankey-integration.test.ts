import { describe, expect, test } from 'bun:test'
import { layoutMermaid, parseRegisteredMermaid as parseMermaid, verifyMermaid } from '../agent/index.ts'
import { renderMermaidASCII } from '../ascii/index.ts'
import { renderMermaidSVG } from '../index.ts'
import { resolveSankeyVisualConfig } from '../sankey/config.ts'
import { layoutSankeyDiagram } from '../sankey/layout.ts'
import { parseSankeyDiagram } from '../sankey/parser.ts'

const BASIC = 'sankey-beta\n  Coal,Electricity,127.93\n  Gas,Electricity,80\n  Electricity,Homes,120\n  Electricity,Industry,87.93'

describe('sankey integration · parse → verify → layout → render seam', () => {
  test('the public seam is green end to end', () => {
    const parsed = parseMermaid(BASIC)
    expect(parsed.ok).toBe(true)
    const verified = verifyMermaid(BASIC)
    expect(verified.ok).toBe(true)
    expect(verified.warnings).toEqual([])
    const svg = renderMermaidSVG(BASIC)
    expect(svg).toContain('</svg>')
    expect(renderMermaidASCII(BASIC).length).toBeGreaterThan(0)
  })

  test('layout JSON projects node boxes and ribbon edges (rubric visibility)', () => {
    const parsed = parseMermaid(BASIC)
    if (!parsed.ok) throw new Error('parse failed')
    const layout = layoutMermaid(parsed.value)
    expect(layout.kind).toBe('sankey')
    expect(layout.nodes.map(n => n.id).sort()).toEqual(['Coal', 'Electricity', 'Gas', 'Homes', 'Industry'])
    expect(layout.edges.length).toBe(4)
    expect(layout.edges[0]!.from).toBe('Coal')
    expect(layout.edges[0]!.to).toBe('Electricity')
    // Every node box sits on-canvas.
    for (const node of layout.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0)
      expect(node.y).toBeGreaterThanOrEqual(0)
      expect(node.x + node.w).toBeLessThanOrEqual(layout.bounds.w)
      expect(node.y + node.h).toBeLessThanOrEqual(layout.bounds.h)
    }
  })

  test('malformed sources fail loudly through the public renderer', () => {
    expect(() => renderMermaidSVG('sankey-beta\nA,B')).toThrow(/exactly three CSV columns/)
    expect(() => renderMermaidSVG('sankey-beta\nA,B,10\nB,A,5')).toThrow(/cycle/)
  })

  test('rejects the sankey-beta: header that Mermaid 11.16 detects but cannot parse', () => {
    expect(() => renderMermaidSVG('sankey-beta:\n  A,B,1')).toThrow()
  })

  test('accessibility directives stay structured and project into the SVG ARIA slots', () => {
    const source = `sankey-beta\naccTitle: Energy flows\naccDescr: Where the energy goes\nA,B,10`
    const parsed = parseMermaid(source)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.value.body.kind).toBe('sankey')
      expect(parsed.value.meta.accessibility).toEqual({ title: 'Energy flows', descr: 'Where the energy goes' })
    }
    const svg = renderMermaidSVG(source)
    expect(svg).toContain('Energy flows')
    expect(svg).toContain('aria-labelledby')
  })
})

describe('sankey integration · conservation lint (FLOW_IMBALANCE)', () => {
  test('an imbalanced intermediate emits an advisory lint that never flips ok', () => {
    const verified = verifyMermaid('sankey-beta\n  A,Hub,120\n  Hub,B,95')
    expect(verified.ok).toBe(true)
    expect(verified.warnings).toEqual([
      {
        code: 'FLOW_IMBALANCE',
        node: 'Hub',
        inflow: 120,
        outflow: 95,
        message: 'Sankey node "Hub" receives 120 but emits 95; ' + 'the unaccounted 25 renders as node height with no matching ribbon',
      },
    ])
  })

  test('pure sources/sinks are never flagged and float representation is not an imbalance', () => {
    expect(verifyMermaid(BASIC).warnings).toEqual([])
    // 0.1 + 0.2 !== 0.3 in binary; the relative tolerance absorbs representation,
    // not data drift.
    expect(verifyMermaid('sankey-beta\n  A,Hub,0.1\n  B,Hub,0.2\n  Hub,C,0.3').warnings).toEqual([])
  })

  test('every imbalanced intermediate is reported once, in first-appearance order', () => {
    const verified = verifyMermaid('sankey-beta\n  A,H1,10\n  H1,H2,8\n  H2,B,5')
    expect(verified.warnings.map(w => (w.code === 'FLOW_IMBALANCE' ? w.node : w.code))).toEqual(['H1', 'H2'])
  })
})

describe('sankey integration · deterministic layout invariants', () => {
  const layout = (source: string, config = {}) => layoutSankeyDiagram(parseSankeyDiagram(source.split('\n')), {}, { ...resolveSankeyVisualConfig(), ...config })

  test('flow conservation: a hub node is as tall as its incoming ribbons stacked', () => {
    const chart = layout(BASIC)
    const hub = chart.nodes.find(n => n.label === 'Electricity')!
    const incoming = chart.links.filter(l => l.target === 'Electricity')
    const stacked = incoming.reduce((sum, l) => sum + l.width, 0)
    expect(Math.abs(hub.y1 - hub.y0 - stacked)).toBeLessThan(0.6)
  })

  test('nodes in one layer never overlap and respect nodePadding', () => {
    const chart = layout(BASIC)
    const layers = new Map<number, typeof chart.nodes>()
    for (const node of chart.nodes) {
      layers.set(node.layer, [...(layers.get(node.layer) ?? []), node])
    }
    for (const layer of layers.values()) {
      const sorted = [...layer].sort((a, b) => a.y0 - b.y0)
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i]!.y0 - sorted[i - 1]!.y1).toBeGreaterThanOrEqual(chart.visual.nodePadding - 0.01)
      }
    }
  })

  test('showValues adds Mermaid\'s 15px second-line allowance to node padding', () => {
    const withValues = layout('sankey-beta\n  A,X,1\n  B,Y,1', { nodePadding: 12, showValues: true })
    const withoutValues = layout('sankey-beta\n  A,X,1\n  B,Y,1', { nodePadding: 12, showValues: false })
    const firstLayerGap = (chart: ReturnType<typeof layout>) => {
      const layer = chart.nodes.filter(node => node.layer === 0).sort((a, b) => a.y0 - b.y0)
      return layer[1]!.y0 - layer[0]!.y1
    }
    expect(firstLayerGap(withValues)).toBeGreaterThanOrEqual(27 - 0.01)
    expect(firstLayerGap(withoutValues)).toBeGreaterThanOrEqual(12 - 0.01)
  })

  test('outlined labels use Mermaid\'s central-layer policy', () => {
    const source = 'sankey-beta\n  A,Hub,10\n  B,Hub,5\n  Hub,C,15'
    const outlined = layout(source, { labelStyle: 'outlined' })
    const legacy = layout(source, { labelStyle: 'legacy' })
    const node = (chart: ReturnType<typeof layout>, label: string) => chart.nodes.find(item => item.label === label)!
    expect(node(outlined, 'A').labelAnchor).toBe('end')
    expect(node(outlined, 'Hub').labelAnchor).toBe('start')
    expect(node(outlined, 'C').labelAnchor).toBe('start')
    expect(node(legacy, 'A').labelAnchor).toBe('start')
    expect(node(legacy, 'C').labelAnchor).toBe('end')
  })

  test('link endpoints attach to their node faces', () => {
    const chart = layout(BASIC)
    const byLabel = new Map(chart.nodes.map(n => [n.label, n]))
    for (const link of chart.links) {
      const source = byLabel.get(link.source)!
      const target = byLabel.get(link.target)!
      expect(link.sx).toBeCloseTo(source.x1, 5)
      expect(link.tx).toBeCloseTo(target.x0, 5)
      expect(link.sy).toBeGreaterThanOrEqual(source.y0 - 0.01)
      expect(link.sy).toBeLessThanOrEqual(source.y1 + 0.01)
      expect(link.ty).toBeGreaterThanOrEqual(target.y0 - 0.01)
      expect(link.ty).toBeLessThanOrEqual(target.y1 + 0.01)
    }
  })

  test('zero-value links stay parseable and their nodes stay visible (1px floor)', () => {
    const chart = layout('sankey-beta\n  A,B,0\n  A,C,10')
    const b = chart.nodes.find(n => n.label === 'B')!
    expect(b.y1 - b.y0).toBeGreaterThanOrEqual(1)
    const zero = chart.links.find(l => l.target === 'B')!
    expect(zero.width).toBe(0)
  })

  test('an all-zero diagram renders deterministically with visible nodes and zero-width links', () => {
    const source = 'sankey-beta\n  A,B,0\n  A,C,0'
    const chart = layout(source)
    expect(chart.total).toBe(0)
    expect(chart.nodes.every(node => node.value === 0 && node.y1 - node.y0 >= 1)).toBe(true)
    expect(chart.links.every(link => link.value === 0 && link.width === 0)).toBe(true)
    const svg = renderMermaidSVG(source)
    expect(svg).toContain('</svg>')
    expect(renderMermaidSVG(source)).toBe(svg)
  })

  test('incompatible flow width and node width grow the flow area instead of placing nodes off-canvas', () => {
    const chart = layout('sankey-beta\n  A,B,1', { width: 1, nodeWidth: 200 })
    expect(chart.nodes.map(node => [node.x0, node.x1])).toEqual([
      [24, 224],
      [224, 424],
    ])
    for (const node of chart.nodes) {
      expect(node.x0).toBeGreaterThanOrEqual(0)
      expect(node.x1).toBeLessThanOrEqual(chart.width)
    }
    expect(chart.links[0]!.sx).toBeLessThanOrEqual(chart.links[0]!.tx)
  })

  test('layer counts follow longest-path depth', () => {
    const chart = layout('sankey-beta\n  A,B,1\n  B,C,1\n  A,C,1')
    const layerOf = (label: string) => chart.nodes.find(n => n.label === label)!.layer
    expect(layerOf('A')).toBe(0)
    expect(layerOf('B')).toBe(1)
    expect(layerOf('C')).toBe(2)
  })

  test('geometry is identical across repeated layouts (stable regions)', () => {
    const first = JSON.stringify(layout(BASIC))
    expect(JSON.stringify(layout(BASIC))).toBe(first)
  })
})
