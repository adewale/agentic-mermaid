import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { renderMermaidSVGWithReceipt, renderMermaidASCIIWithReceipt } from '../index.ts'
import { layoutMermaidWithReceipt, parseRegisteredMermaid } from '../agent/core.ts'
import { renderMermaidPNGWithReceipt } from '../agent/png.ts'
import { layoutArchitectureDiagram } from '../architecture/layout.ts'
import { parseArchitectureDiagram } from '../architecture/parser.ts'
import { toMermaidLines } from '../mermaid-source.ts'
import { withRenderStageObserver } from '../render-stages.ts'

const native = { graphLayout: { backend: 'agentic' as const } }
const fixture = readFileSync(new URL('../../eval/layout-compare/fixtures/architecture-backends.mmd', import.meta.url), 'utf8')
const faces = 'architecture-beta\nservice left(disk)[Left]\nservice top(disk)[Top]\nservice bottom(disk)[Bottom]\nservice right(server)[Right]\njunction center\nleft:R --> L:center\ntop:B --> T:center\nbottom:T --> B:center\ncenter:R --> L:right'
const literalIcons = 'architecture-beta\nservice a "<b>日本 API</b>\\nSecond line" [Backend]\nservice b(database)[Storage]\na:R-->L:b'

describe('Architecture layout backends', () => {
  test.each([['alignment', fixture], ['four faces', faces], ['literal icons', literalIcons]])('retains authored ports, junctions, alignments and complete routes: %s', (_name, source) => {
    const model = parseArchitectureDiagram(toMermaidLines(source)), original = structuredClone(model)
    const placed = layoutArchitectureDiagram(model, native)
    expect(model).toEqual(original)
    expect(layoutArchitectureDiagram(model, native)).toEqual(placed)
    expect(placed.services.map(service => [service.id, service.label, service.icon, service.iconText, service.parentId])).toEqual(model.services.map(service => [service.id, service.label, service.icon, service.iconText, service.parentId]))
    expect(placed.junctions.map(junction => junction.id)).toEqual(model.junctions.map(junction => junction.id))
    expect(placed.edges.map(edge => [edge.source, edge.target, edge.hasArrowStart, edge.hasArrowEnd, edge.label])).toEqual(model.edges.map(edge => [edge.source, edge.target, edge.hasArrowStart, edge.hasArrowEnd, edge.label]))
    const boxes = new Map([...placed.services, ...placed.junctions].map(node => [node.id, node]))
    for (const edge of placed.edges) {
      expect(edge.points.length).toBeGreaterThanOrEqual(2)
      for (const [endpoint, point] of [[edge.source, edge.points[0]!], [edge.target, edge.points.at(-1)!]] as const) {
        const box = boxes.get(endpoint.id)!
        expect(point.x).toBeCloseTo(endpoint.side === 'L' ? box.x : endpoint.side === 'R' ? box.x + box.width : box.x + box.width / 2, 5)
        expect(point.y).toBeCloseTo(endpoint.side === 'T' ? box.y : endpoint.side === 'B' ? box.y + box.height : box.y + box.height / 2, 5)
      }
      for (let i = 1; i < edge.points.length; i++) expect(edge.points[i - 1]!.x === edge.points[i]!.x || edge.points[i - 1]!.y === edge.points[i]!.y).toBe(true)
    }
    if (source === fixture) expect(new Set(placed.services.filter(service => service.id.startsWith('src')).map(service => service.y)).size).toBe(1)
    const rendered = renderMermaidSVGWithReceipt(source, native)
    expect(rendered.receipt.layoutCertification?.status).toBe('passed')
    expect(rendered.receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'agentic', role: 'primary' })])
    if (source === literalIcons) {
      expect(rendered.svg).toContain('&lt;b&gt;日本 API&lt;/b&gt;')
      expect(rendered.svg).not.toContain('<b>日本 API</b>')
      expect(rendered.svg).toContain('Second line')
      const parsed = parseRegisteredMermaid(source)
      if (!parsed.ok) throw new Error('literal icon fixture must parse')
      const text = renderMermaidASCIIWithReceipt(parsed.value, { ...native, colorMode: 'none' })
      expect(text.text).toContain('Second line')
      // Architecture projects pixel placement into cells, then independently
      // builds graphical companion evidence. Attribute both real placements.
      expect(text.receipt.layoutDecisions).toEqual([
        expect.objectContaining({ selected: 'agentic', role: 'primary' }),
        expect.objectContaining({ selected: 'agentic', role: 'companion' }),
      ])
    }
  })

  test('uses native placement across public surfaces and retains explicit ELK bytes', () => {
    const options = { ...native, nodeSpacing: 51 }, stages: string[] = [], parsed = parseRegisteredMermaid(fixture)
    if (!parsed.ok) throw new Error('fixture must parse')
    const result = withRenderStageObserver(sample => stages.push(sample.stage), () => renderMermaidSVGWithReceipt(fixture, options))
    expect(stages).toContain('agentic')
    expect(stages).not.toContain('elk')
    expect(renderMermaidSVGWithReceipt(parsed.value, options).svg).toBe(result.svg)
    expect(layoutMermaidWithReceipt(fixture, options).receipt.layoutDecisions).toEqual(result.receipt.layoutDecisions)
    const png = renderMermaidPNGWithReceipt(fixture, options)
    expect(png.png.length).toBeGreaterThan(0)
    expect(png.receipt.layoutDecisions).toEqual(result.receipt.layoutDecisions)
    expect(renderMermaidSVGWithReceipt(fixture, { graphLayout: { backend: 'elk' } }).svg).toBe(renderMermaidSVGWithReceipt(fixture).svg)
  })

  const compounds = JSON.parse(readFileSync(new URL('../../eval/mermaid-docs-corpus/corpus.json', import.meta.url), 'utf8')) as Array<{ family: string; index: number; source: string }>
  test.each(compounds.filter(entry => entry.family === 'architecture'))('retains all authored Architecture relationships and certifies final compound paint: $index', ({ source }) => {
    const model = parseArchitectureDiagram(toMermaidLines(source)), original = structuredClone(model)
    const placed = layoutArchitectureDiagram(model, native)
    expect(model).toEqual(original)
    expect(placed.edges.map(edge => [edge.source, edge.target])).toEqual(model.edges.map(edge => [edge.source, edge.target]))
    expect(placed.services.map(service => [service.id, service.parentId])).toEqual(model.services.map(service => [service.id, service.parentId]))
    const rendered = withRenderStageObserver(sample => { expect(sample.stage).not.toBe('elk') }, () => renderMermaidSVGWithReceipt(source, native))
    expect(rendered.receipt.layoutCertification?.status).toBe('passed')
    expect(rendered.receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'agentic' })])
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw new Error('corpus input must parse')
    expect(renderMermaidSVGWithReceipt(parsed.value, native).svg).toBe(rendered.svg)
  })

  test('retains native empty frames and empty diagrams without fetching ELK', () => {
    const grouped = 'architecture-beta\ngroup g[Group]'
    const framed = withRenderStageObserver(sample => { expect(sample.stage).not.toBe('elk') }, () => renderMermaidSVGWithReceipt(grouped, native))
    expect(framed.svg).toContain('Group')
    expect(framed.receipt.layoutCertification?.status).toBe('passed')
    expect(renderMermaidSVGWithReceipt(grouped, { graphLayout: { backend: 'agentic', fallback: 'elk' } }).receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'agentic' })])
    expect(renderMermaidSVGWithReceipt('architecture-beta', native).receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'agentic' })])
  })
})
