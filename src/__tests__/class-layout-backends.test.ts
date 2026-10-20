import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { renderMermaidSVGWithReceipt, GraphLayoutUnsupportedError } from '../index.ts'
import { layoutMermaidWithReceipt, parseRegisteredMermaid } from '../agent/core.ts'
import { renderMermaidPNGWithReceipt } from '../agent/png.ts'
import { layoutClassDiagram } from '../class/layout.ts'
import { parseClassDiagram } from '../class/parser.ts'
import { toMermaidLines } from '../mermaid-source.ts'
import { withRenderStageObserver } from '../render-stages.ts'

const native = { graphLayout: { backend: 'agentic' as const } }
const fixture = readFileSync(new URL('../../eval/layout-compare/fixtures/class-backends.mmd', import.meta.url), 'utf8')

describe('Class layout backends', () => {
  test.each(['TB', 'BT', 'LR', 'RL'])('retains member compartments, notes, cardinalities and relationship meaning in %s', direction => {
    const source = fixture.replace('direction LR', `direction ${direction}`)
    const model = parseClassDiagram(toMermaidLines(source)), original = structuredClone(model)
    const placed = layoutClassDiagram(model, native)
    expect(model).toEqual(original)
    expect(layoutClassDiagram(model, native)).toEqual(placed)
    expect(placed.classes.map(cls => [cls.id, cls.label, cls.annotation, cls.attributes, cls.methods])).toEqual(model.classes.map(cls => [cls.id, cls.label, cls.annotation, cls.attributes, cls.methods]))
    expect(placed.relationships.map(({ from, to, type, fromType, toType, markerAt, lineStyle, fromCardinality, toCardinality, label }) => ({ from, to, type, fromType, toType, markerAt, lineStyle, fromCardinality, toCardinality, label }))).toEqual(model.relationships.map(({ from, to, type, fromType, toType, markerAt, lineStyle, fromCardinality, toCardinality, label }) => ({ from, to, type, fromType, toType, markerAt, lineStyle, fromCardinality, toCardinality, label })))
    expect(placed.notes.map(note => [note.for, note.text])).toEqual(model.notes.map(note => [note.for, note.text]))
    for (const relation of placed.relationships) {
      expect(relation.points.length).toBeGreaterThanOrEqual(2)
      for (let i = 1; i < relation.points.length; i++) expect(relation.points[i - 1]!.x === relation.points[i]!.x || relation.points[i - 1]!.y === relation.points[i]!.y).toBe(true)
      if (relation.fromCardinality) expect(relation.fromCardinalityPosition).toBeDefined()
      if (relation.toCardinality) expect(relation.toCardinalityPosition).toBeDefined()
    }
    const rendered = renderMermaidSVGWithReceipt(source, native)
    expect(rendered.receipt.layoutCertification?.status).toBe('passed')
    expect(rendered.receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'agentic', role: 'primary' })])
    for (const label of ['Account', 'Audit', 'Repository', 'Retain prepared note text', 'records', 'reviews', 'belongs', 'delegates', 'stores']) expect(rendered.svg).toContain(label)
  })

  test('uses the selected producer across source/parsed/layout/PNG surfaces and retains explicit ELK bytes', () => {
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

  test('retains lollipop interfaces and treats generated-looking authored identities as cards', () => {
    for (const source of ['classDiagram\nConsumer --() API : uses', 'classDiagram\nclass `ns:Authored`\nclass B\n`ns:Authored` --> B']) {
      const parsed = parseClassDiagram(toMermaidLines(source)), placed = layoutClassDiagram(parsed, native)
      if (source.includes('ns:Authored')) expect(placed.classes.map(cls => cls.id)).toContain('ns:Authored')
      expect(placed.classes.map(cls => [cls.id, cls.isInterface])).toEqual(parsed.classes.map(cls => [cls.id, cls.isInterface || undefined]))
      expect(placed.namespaces).toEqual([])
      expect(renderMermaidSVGWithReceipt(source, native).receipt.layoutCertification?.status).toBe('passed')
    }
  })

  test('attributes namespace declines while retaining native empty diagrams', () => {
    const grouped = 'classDiagram\nnamespace Zone {\nclass A\n}'
    expect(() => renderMermaidSVGWithReceipt(grouped, native)).toThrow(GraphLayoutUnsupportedError)
    expect(renderMermaidSVGWithReceipt(grouped, { graphLayout: { backend: 'agentic', fallback: 'elk' } }).receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'elk', reason: 'Class compound namespaces', attempts: [expect.objectContaining({ backend: 'agentic', outcome: 'unsupported' }), { backend: 'elk', outcome: 'selected' }] })])
    expect(renderMermaidSVGWithReceipt('classDiagram', native).receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'agentic' })])
  })
})
