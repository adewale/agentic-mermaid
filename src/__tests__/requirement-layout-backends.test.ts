import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { layoutMermaidWithReceipt, parseRegisteredMermaid } from '../agent/core.ts'
import { renderMermaidPNGWithReceipt } from '../agent/png.ts'
import { renderMermaidSVGWithReceipt } from '../index.ts'
import { withRenderStageObserver } from '../render-stages.ts'
import { layoutRequirementDiagram } from '../requirement/layout.ts'
import { parseRequirementDiagram } from '../requirement/parser.ts'
import { segmentEntersLabelRect } from '../shared/edge-label-geometry.ts'

const native = { graphLayout: { backend: 'agentic' as const } }
const fixture = readFileSync(new URL('../../eval/layout-compare/fixtures/requirement-backends.mmd', import.meta.url), 'utf8')
const source = (direction: string) => fixture.replace('direction TB', `direction ${direction}`)

describe('Requirement layout backends', () => {
  test.each(['TB', 'BT', 'LR', 'RL'])('retains measured cards, relationship labels and distinct routes natively in %s', direction => {
    const model = parseRequirementDiagram(source(direction)), original = structuredClone(model)
    const placed = layoutRequirementDiagram(model, native)
    expect(model).toEqual(original)
    expect(layoutRequirementDiagram(model, native)).toEqual(placed)
    expect(placed.nodes).toHaveLength(3)
    expect(placed.edges.map(edge => [edge.src, edge.dst, edge.type])).toEqual(model.relations.map(edge => [edge.src, edge.dst, edge.type]))
    const rects = placed.edges.map(edge => ({ x: edge.labelPosition.x - edge.label.width / 2 - 6, y: edge.labelPosition.y - edge.label.height / 2 - 4, w: edge.label.width + 12, h: edge.label.height + 8 }))
    for (const [index, edge] of placed.edges.entries()) {
      expect(edge.points.length).toBeGreaterThanOrEqual(2)
      expect(edge.labelPosition).not.toBe(edge.points.find(point => point.x === edge.labelPosition.x && point.y === edge.labelPosition.y))
      for (const node of placed.nodes) expect(rects[index]!.x >= node.x + node.width || rects[index]!.x + rects[index]!.w <= node.x || rects[index]!.y >= node.y + node.height || rects[index]!.y + rects[index]!.h <= node.y).toBe(true)
      for (let cursor = 1; cursor < edge.points.length; cursor++) {
        const a = edge.points[cursor - 1]!, b = edge.points[cursor]!
        expect(a.x === b.x || a.y === b.y).toBe(true)
        for (const [other, rect] of rects.entries()) if (other !== index) expect(segmentEntersLabelRect(a, b, rect)).toBe(false)
      }
    }
    const rendered = renderMermaidSVGWithReceipt(source(direction), native)
    expect(rendered.receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'agentic', role: 'primary' })])
    expect(rendered.receipt.layoutCertification?.status).toBe('passed')
    for (const text of ['performance-1', 'Respond quickly', 'bench suite', 'verifies', 'traces', 'refines']) expect(rendered.svg).toContain(text)
  })

  test('uses the native producer across source, parsed, layout and PNG while preserving explicit ELK', () => {
    const input = source('TB'), stages: string[] = [], parsed = parseRegisteredMermaid(input)
    const options = { ...native, padding: 33 }
    if (!parsed.ok) throw new Error('fixture must parse')
    const rendered = withRenderStageObserver(sample => stages.push(sample.stage), () => renderMermaidSVGWithReceipt(input, options))
    expect(stages).toContain('agentic')
    expect(stages).not.toContain('elk')
    expect(renderMermaidSVGWithReceipt(parsed.value, options).svg).toBe(rendered.svg)
    expect(layoutMermaidWithReceipt(input, options).receipt.layoutDecisions).toEqual(rendered.receipt.layoutDecisions)
    const png = renderMermaidPNGWithReceipt(input, options)
    expect(png.png.length).toBeGreaterThan(0)
    expect(png.receipt.layoutDecisions).toEqual(rendered.receipt.layoutDecisions)
    const legacy = renderMermaidSVGWithReceipt(input), elk = renderMermaidSVGWithReceipt(input, { graphLayout: { backend: 'elk' } })
    expect(elk.svg).toBe(legacy.svg)
    expect(legacy.receipt.layoutDecisions).toBeUndefined()
    expect(elk.receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'elk' })])
    expect(renderMermaidSVGWithReceipt(input, { graphLayout: { backend: 'agentic', fallback: 'elk' } }).receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'agentic', attempts: [{ backend: 'agentic', outcome: 'selected' }] })])
    JSON.stringify(rendered.receipt)
    JSON.stringify(png.receipt)
  })

  test('retains empty native canvases without starting ELK', () => {
    const result = renderMermaidSVGWithReceipt('requirementDiagram', native)
    expect(result.receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'agentic' })])
  })
})
