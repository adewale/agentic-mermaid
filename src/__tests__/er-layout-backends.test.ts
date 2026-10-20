import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { renderMermaidSVGWithReceipt, GraphLayoutUnsupportedError } from '../index.ts'
import { layoutMermaidWithReceipt, parseRegisteredMermaid } from '../agent/core.ts'
import { renderMermaidPNGWithReceipt } from '../agent/png.ts'
import { layoutErDiagram } from '../er/layout.ts'
import { parseErDiagram } from '../er/parser.ts'
import { toMermaidLines } from '../mermaid-source.ts'
import { withRenderStageObserver } from '../render-stages.ts'

const native = { graphLayout: { backend: 'agentic' as const } }
const fixture = readFileSync(new URL('../../eval/layout-compare/fixtures/er-backends.mmd', import.meta.url), 'utf8')

describe('ER layout backends', () => {
  test.each(['TB', 'BT', 'LR', 'RL'])('preserves cards, cardinalities, identifying shafts and labels in %s', direction => {
    const source = fixture.replace('direction LR', `direction ${direction}`)
    const model = parseErDiagram(toMermaidLines(source)), original = structuredClone(model)
    const placed = layoutErDiagram(model, native)
    expect(model).toEqual(original)
    expect(layoutErDiagram(model, native)).toEqual(placed)
    expect(placed.entities.map(entity => [entity.id, entity.attributes])).toEqual(model.entities.map(entity => [entity.id, entity.attributes]))
    expect(placed.relationships.map(({ entity1, entity2, cardinality1, cardinality2, identifying, label }) => ({ entity1, entity2, cardinality1, cardinality2, identifying, label }))).toEqual(model.relationships.map(({ entity1, entity2, cardinality1, cardinality2, identifying, label }) => ({ entity1, entity2, cardinality1, cardinality2, identifying, label })))
    for (const rel of placed.relationships) {
      expect(rel.points.length).toBeGreaterThanOrEqual(2)
      for (let i = 1; i < rel.points.length; i++) expect(rel.points[i - 1]!.x === rel.points[i]!.x || rel.points[i - 1]!.y === rel.points[i]!.y).toBe(true)
    }
    const rendered = renderMermaidSVGWithReceipt(source, native)
    expect(rendered.receipt.layoutCertification?.status).toBe('passed')
    expect(rendered.receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'agentic', role: 'primary' })])
    for (const label of ['CUSTOMER', 'ORDER', 'AUDIT', 'Stable customer id', 'customer_id', 'places', 'reviews', 'belongs', 'records', 'delegates']) expect(rendered.svg).toContain(label)
  })

  test('uses native placement across public surfaces and retains explicit ELK bytes', () => {
    const options = { ...native, nodeSpacing: 51 }, stages: string[] = [], parsed = parseRegisteredMermaid(fixture)
    if (!parsed.ok) throw new Error('fixture must parse')
    const rendered = withRenderStageObserver(sample => stages.push(sample.stage), () => renderMermaidSVGWithReceipt(fixture, options))
    expect(stages).toContain('agentic')
    expect(stages).not.toContain('elk')
    expect(renderMermaidSVGWithReceipt(parsed.value, options).svg).toBe(rendered.svg)
    expect(layoutMermaidWithReceipt(fixture, options).receipt.layoutDecisions).toEqual(rendered.receipt.layoutDecisions)
    const png = renderMermaidPNGWithReceipt(fixture, options)
    expect(png.png.length).toBeGreaterThan(0)
    expect(png.receipt.layoutDecisions).toEqual(rendered.receipt.layoutDecisions)
    const legacy = renderMermaidSVGWithReceipt(fixture), elk = renderMermaidSVGWithReceipt(fixture, { graphLayout: { backend: 'elk' } })
    expect(elk.svg).toBe(legacy.svg)
    expect(legacy.receipt.layoutDecisions).toBeUndefined()
    expect(elk.receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'elk' })])
  })

  test('attributes grouped ER fallback while retaining native empty diagrams', () => {
    const grouped = 'erDiagram\nsubgraph Zone\n A\nend'
    expect(() => renderMermaidSVGWithReceipt(grouped, native)).toThrow(GraphLayoutUnsupportedError)
    const result = renderMermaidSVGWithReceipt(grouped, { graphLayout: { backend: 'agentic', fallback: 'elk' } })
    expect(result.receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'elk', reason: 'ER compound geometry and frame endpoints', attempts: [expect.objectContaining({ backend: 'agentic', outcome: 'unsupported' }), { backend: 'elk', outcome: 'selected' }] })])
    expect(renderMermaidSVGWithReceipt('erDiagram', native).receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'agentic' })])
  })
})
