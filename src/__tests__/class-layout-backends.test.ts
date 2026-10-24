import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { renderMermaidSVGWithReceipt } from '../index.ts'
import { layoutMermaidWithReceipt, parseRegisteredMermaid } from '../agent/core.ts'
import { renderMermaidPNGWithReceipt } from '../agent/png.ts'
import { layoutClassDiagram } from '../class/layout.ts'
import { parseClassDiagram } from '../class/parser.ts'
import { toMermaidLines } from '../mermaid-source.ts'
import { releaseBenchCases } from '../../eval/benchmark/release-bench-cases.ts'
import { missingSvgLabels } from '../../eval/benchmark/release-bench-fidelity.ts'
import { withRenderStageObserver } from '../render-stages.ts'

const native = { graphLayout: { backend: 'agentic' as const } }
const fixture = readFileSync(new URL('../../eval/layout-compare/fixtures/class-backends.mmd', import.meta.url), 'utf8')
const compoundFixture = readFileSync(new URL('../../eval/layout-compare/fixtures/class-compound-backends.mmd', import.meta.url), 'utf8')

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

  test.each(['TB', 'BT', 'LR', 'RL'])('retains independent namespace frames, members and labels in %s', direction => {
    const source = compoundFixture.replace('direction TB', `direction ${direction}`)
    const model = parseClassDiagram(toMermaidLines(source)), original = structuredClone(model)
    const placed = layoutClassDiagram(model, native)
    expect(model).toEqual(original)
    expect(layoutClassDiagram(model, native)).toEqual(placed)
    expect(placed.classes.map(cls => [cls.id, cls.label, cls.attributes, cls.methods, cls.annotation, Boolean(cls.isInterface)]))
      .toEqual(model.classes.map(cls => [cls.id, cls.label, cls.attributes, cls.methods, cls.annotation, Boolean(cls.isInterface)]))
    expect(placed.classes.map(cls => cls.id)).toContain('class-namespace:Platform')
    expect(placed.namespaces.map(ns => [ns.id, ns.parentId])).toEqual([
      ['Platform', undefined], ['Platform.Domain', 'Platform'], ['Audit', undefined],
    ])
    expect(placed.relationships.map(rel => [rel.from, rel.to, rel.type, rel.label, rel.fromCardinality, rel.toCardinality]))
      .toEqual(model.relationships.map(rel => [rel.from, rel.to, rel.type, rel.label, rel.fromCardinality, rel.toCardinality]))
    const boxes = new Map([...placed.classes, ...placed.namespaces].map(box => [box.id, box]))
    for (const frame of placed.namespaces) {
      for (const id of [...frame.classIds, ...placed.namespaces.filter(child => child.parentId === frame.id).map(child => child.id)]) {
        const child = boxes.get(id)!
        expect(child.x).toBeGreaterThanOrEqual(frame.x - .01)
        expect(child.y).toBeGreaterThanOrEqual(frame.y + frame.headerHeight - .01)
        expect(child.x + child.width).toBeLessThanOrEqual(frame.x + frame.width + .01)
        expect(child.y + child.height).toBeLessThanOrEqual(frame.y + frame.height + .01)
      }
    }
    const stages: string[] = []
    const options = { ...native, nodeSpacing: 53 }
    const result = withRenderStageObserver(sample => stages.push(sample.stage), () => renderMermaidSVGWithReceipt(source, options))
    expect(stages).not.toContain('elk')
    const reference = renderMermaidSVGWithReceipt(source, { ...options, graphLayout: { backend: 'elk' } })
    expect(reference.receipt.layoutCertification?.status).toBe('passed')
    expect(result.receipt.layoutCertification?.status).toBe('passed')
    expect(result.receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'agentic', attempts: [{ backend: 'agentic', outcome: 'selected' }] })])
    const expected = releaseBenchCases().find(input => input.id === 'class:compound-namespaces')!.expectedSvgLabels
    expect(missingSvgLabels(result.svg, expected)).toEqual([])
    expect(missingSvgLabels(reference.svg, expected)).toEqual([])
  })

  test('retains namespace geometry across public surfaces, flattened grouping and empty frames', () => {
    const parsed = parseRegisteredMermaid(compoundFixture)
    if (!parsed.ok) throw new Error('compound fixture must parse')
    const result = renderMermaidSVGWithReceipt(compoundFixture, native)
    expect(renderMermaidSVGWithReceipt(parsed.value, native).svg).toBe(result.svg)
    expect(layoutMermaidWithReceipt(compoundFixture, native).receipt.layoutDecisions).toEqual(result.receipt.layoutDecisions)
    expect(renderMermaidPNGWithReceipt(compoundFixture, native).receipt.layoutDecisions).toEqual(result.receipt.layoutDecisions)
    const flat = layoutClassDiagram(parseClassDiagram(toMermaidLines(compoundFixture)), { ...native, class: { hierarchicalNamespaces: false } })
    expect(flat.namespaces).toHaveLength(3)
    expect(flat.namespaces.every(ns => ns.parentId === undefined)).toBe(true)
    for (const source of ['classDiagram\nnamespace Empty {\n}', '---\ntitle: Empty namespaces\n---\nclassDiagram\nnamespace Outer {\nnamespace Inner {\n}\n}']) {
      const empty = renderMermaidSVGWithReceipt(source, { graphLayout: { backend: 'agentic', fallback: 'elk' } })
      expect(empty.receipt.layoutDecisions?.[0]?.selected).toBe('agentic')
      expect(empty.svg).toContain(source.includes('Outer') ? 'Inner' : 'Empty')
    }
  })

  test('routes cross-namespace relationships while retaining native empty diagrams', () => {
    const grouped = 'classDiagram\nnamespace Left {\nclass A\n}\nnamespace Right {\nclass B\n}\nA --> B'
    const stages: string[] = []
    const result = withRenderStageObserver(sample => stages.push(sample.stage), () => renderMermaidSVGWithReceipt(grouped, native))
    expect(stages).not.toContain('elk')
    expect(result.receipt.layoutCertification?.status).toBe('passed')
    expect(result.receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'agentic' })])
    expect(renderMermaidPNGWithReceipt(grouped, native).receipt.layoutDecisions).toEqual(result.receipt.layoutDecisions)
    expect(layoutMermaidWithReceipt(grouped, native).receipt.layoutDecisions).toEqual(result.receipt.layoutDecisions)
    for (const source of ['classDiagram', '---\ntitle: Empty Class title\n---\nclassDiagram']) {
      const result = renderMermaidSVGWithReceipt(source, native)
      expect(result.receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'agentic' })])
      expect(result.svg).toBe(renderMermaidSVGWithReceipt(source, { graphLayout: { backend: 'elk' } }).svg)
      if (source.includes('title:')) expect(result.svg).toContain('Empty Class title')
    }
  })
})
