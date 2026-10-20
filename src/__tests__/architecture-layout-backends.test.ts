import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { renderMermaidSVGWithReceipt, GraphLayoutUnsupportedError } from '../index.ts'
import { layoutMermaidWithReceipt, parseRegisteredMermaid } from '../agent/core.ts'
import { renderMermaidPNGWithReceipt } from '../agent/png.ts'
import { layoutArchitectureDiagram } from '../architecture/layout.ts'
import { parseArchitectureDiagram } from '../architecture/parser.ts'
import { toMermaidLines } from '../mermaid-source.ts'
import { withRenderStageObserver } from '../render-stages.ts'

const native = { graphLayout: { backend: 'agentic' as const } }
const fixture = readFileSync(new URL('../../eval/layout-compare/fixtures/architecture-backends.mmd', import.meta.url), 'utf8')
const faces = 'architecture-beta\nservice left(disk)[Left]\nservice top(disk)[Top]\nservice bottom(disk)[Bottom]\nservice right(server)[Right]\njunction center\nleft:R --> L:center\ntop:B --> T:center\nbottom:T --> B:center\ncenter:R --> L:right'

describe('Architecture layout backends', () => {
  test.each([['alignment', fixture], ['four faces', faces]])('retains authored ports, junctions, alignments and complete routes: %s', (_name, source) => {
    const model = parseArchitectureDiagram(toMermaidLines(source)), original = structuredClone(model)
    const placed = layoutArchitectureDiagram(model, native)
    expect(model).toEqual(original)
    expect(layoutArchitectureDiagram(model, native)).toEqual(placed)
    expect(placed.services.map(service => [service.id, service.label, service.icon, service.parentId])).toEqual(model.services.map(service => [service.id, service.label, service.icon, service.parentId]))
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

  test('attributes compound declines while retaining native empty diagrams', () => {
    const grouped = 'architecture-beta\ngroup g[Group]\nservice a(server)[A] in g'
    expect(() => renderMermaidSVGWithReceipt(grouped, native)).toThrow(GraphLayoutUnsupportedError)
    expect(renderMermaidSVGWithReceipt(grouped, { graphLayout: { backend: 'agentic', fallback: 'elk' } }).receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'elk', reason: 'Architecture compound child order and boundary placement', attempts: [expect.objectContaining({ backend: 'agentic', outcome: 'unsupported' }), { backend: 'elk', outcome: 'selected' }] })])
    expect(renderMermaidSVGWithReceipt('architecture-beta', native).receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'agentic' })])
  })
})
