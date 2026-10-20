import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { renderMermaidSVGWithReceipt } from '../index.ts'
import { layoutMermaidWithReceipt, parseRegisteredMermaid } from '../agent/core.ts'
import { renderMermaidPNGWithReceipt } from '../agent/png.ts'
import { layoutErDiagram } from '../er/layout.ts'
import { parseErDiagram } from '../er/parser.ts'
import { toMermaidLines } from '../mermaid-source.ts'
import { withRenderStageObserver } from '../render-stages.ts'
import { releaseBenchCases } from '../../eval/benchmark/release-bench-cases.ts'
import { missingSvgLabels } from '../../eval/benchmark/release-bench-fidelity.ts'

const native = { graphLayout: { backend: 'agentic' as const } }
const compoundFixture = readFileSync(new URL('../../eval/layout-compare/fixtures/er-compound-backends.mmd', import.meta.url), 'utf8')
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

  test.each(['TB', 'BT', 'LR', 'RL'])('retains nested ER frames, local directions and frame/leaf endpoints in %s', direction => {
    const source = compoundFixture.replace('direction LR', `direction ${direction}`)
    const model = parseErDiagram(toMermaidLines(source)), original = structuredClone(model)
    const placed = layoutErDiagram(model, native)
    expect(model).toEqual(original)
    expect(layoutErDiagram(model, native)).toEqual(placed)
    expect(placed.entities).toHaveLength(4)
    expect(placed.groups.map(({ id, parentId, label }) => ({ id, parentId, label }))).toEqual(model.groups.map(({ id, parentId, label }) => ({ id, parentId, label })))
    expect(placed.relationships.map(({ entity1, entity2, cardinality1, cardinality2, identifying, label }) => ({ entity1, entity2, cardinality1, cardinality2, identifying, label }))).toEqual(model.relationships.map(({ entity1, entity2, cardinality1, cardinality2, identifying, label }) => ({ entity1, entity2, cardinality1, cardinality2, identifying, label })))
    const boxes = new Map([...placed.entities, ...placed.groups].map(box => [box.id, box]))
    const outline = (p: { x: number; y: number }, id: string) => {
      const box = boxes.get(id)!
      return p.x >= box.x - .01 && p.x <= box.x + box.width + .01 && p.y >= box.y - .01 && p.y <= box.y + box.height + .01
        && Math.min(Math.abs(p.x - box.x), Math.abs(p.x - box.x - box.width), Math.abs(p.y - box.y), Math.abs(p.y - box.y - box.height)) < .01
    }
    for (const rel of placed.relationships) {
      expect(rel.points.length).toBeGreaterThanOrEqual(2)
      expect(outline(rel.points[0]!, rel.entity1)).toBe(true)
      expect(outline(rel.points.at(-1)!, rel.entity2)).toBe(true)
      const normal = (point: { x: number; y: number }, toward: { x: number; y: number }, id: string) => {
        const box = boxes.get(id)!, dx = toward.x - point.x, dy = toward.y - point.y
        return Math.abs(point.x - box.x) < .01 && dx < 0 && dy === 0
          || Math.abs(point.x - box.x - box.width) < .01 && dx > 0 && dy === 0
          || Math.abs(point.y - box.y) < .01 && dy < 0 && dx === 0
          || Math.abs(point.y - box.y - box.height) < .01 && dy > 0 && dx === 0
      }
      expect(normal(rel.points[0]!, rel.points[1]!, rel.entity1)).toBe(true)
      expect(normal(rel.points.at(-1)!, rel.points.at(-2)!, rel.entity2)).toBe(true)
      for (const card of placed.entities) if (card.id !== rel.entity1 && card.id !== rel.entity2) {
        for (let i = 1; i < rel.points.length; i++) {
          const a = rel.points[i - 1]!, b = rel.points[i]!
          const crosses = a.x === b.x
            ? a.x > card.x + .01 && a.x < card.x + card.width - .01 && Math.max(a.y, b.y) > card.y + .01 && Math.min(a.y, b.y) < card.y + card.height - .01
            : a.y > card.y + .01 && a.y < card.y + card.height - .01 && Math.max(a.x, b.x) > card.x + .01 && Math.min(a.x, b.x) < card.x + card.width - .01
          expect(crosses).toBe(false)
        }
      }
    }
    for (const group of model.groups) for (const id of group.entityIds) {
      const parent = boxes.get(group.id)!, child = boxes.get(id)!
      expect(child.x).toBeGreaterThanOrEqual(parent.x)
      expect(child.y).toBeGreaterThanOrEqual(parent.y)
      expect(child.x + child.width).toBeLessThanOrEqual(parent.x + parent.width)
      expect(child.y + child.height).toBeLessThanOrEqual(parent.y + parent.height)
    }
    const stages: string[] = [], options = { ...native, nodeSpacing: 53 }
    const rendered = withRenderStageObserver(sample => stages.push(sample.stage), () => renderMermaidSVGWithReceipt(source, options))
    expect(stages).not.toContain('elk')
    const reference = renderMermaidSVGWithReceipt(source, { ...options, graphLayout: { backend: 'elk' } })
    const nativeProof = rendered.receipt.layoutCertification!, referenceProof = reference.receipt.layoutCertification!
    if (nativeProof.scope !== 'native-scene' || referenceProof.scope !== 'native-scene') throw new Error('SVG must retain native Scene evidence')
    const expectedLabels = releaseBenchCases().find(input => input.id === 'er:compound-domains')!.expectedSvgLabels
    expect(missingSvgLabels(rendered.svg, expectedLabels)).toEqual([])
    expect(missingSvgLabels(reference.svg, expectedLabels)).toEqual([])
    expect(nativeProof.coverage.unmeasured).toBe(0)
    if (referenceProof.status === 'passed') expect(nativeProof.status).toBe('passed')
    for (const issue of nativeProof.issues) expect(referenceProof.issues).toContainEqual(expect.objectContaining({ code: issue.code, id: issue.id, by: issue.by }))
    expect(rendered.receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'agentic', attempts: [{ backend: 'agentic', outcome: 'selected' }] })])
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw new Error('compound fixture must parse')
    expect(renderMermaidSVGWithReceipt(parsed.value, options).svg).toBe(rendered.svg)
    expect(layoutMermaidWithReceipt(source, options).receipt.layoutDecisions).toEqual(rendered.receipt.layoutDecisions)
    expect(renderMermaidPNGWithReceipt(source, options).receipt.layoutDecisions).toEqual(rendered.receipt.layoutDecisions)
    expect(renderMermaidSVGWithReceipt(source, { graphLayout: { backend: 'elk' } }).svg).toBe(renderMermaidSVGWithReceipt(source).svg)
  })

  test.each([0, 8])('keeps nested frame connectors clear of unrelated cards with bend radius %s', bendRadius => {
    const source = 'erDiagram\ndirection LR\nsubgraph TOP\n direction TB\n subgraph B1\n  direction RL\n  I1 ||--|| F1 : links\n end\n subgraph B2\n  direction BT\n  I2 ||--|| F2 : links\n end\nend\nA ||--|| TOP : links\nTOP ||--|| B : links\nB1 ||--|| B2 : links'
    const style = { roles: { relationship: { bendRadius } } }
    const reference = renderMermaidSVGWithReceipt(source, { graphLayout: { backend: 'elk' }, style })
    if (bendRadius === 0) expect(reference.receipt.layoutCertification?.status).toBe('passed')
    const result = renderMermaidSVGWithReceipt(source, { ...native, style })
    expect(result.receipt.layoutCertification?.status).toBe('passed')
    expect(result.receipt.layoutDecisions?.[0]?.selected).toBe('agentic')
    if (bendRadius > 0) expect(result.svg).toMatch(/<path\b[^>]*d="[^"]*Q/)
  })

  test('retains native empty frames and diagrams even when fallback is permitted', () => {
    for (const source of ['erDiagram', 'erDiagram\nsubgraph Zone\n A\nend', 'erDiagram\nsubgraph Empty\nend', '---\ntitle: Empty ER title\n---\nerDiagram']) {
      const result = renderMermaidSVGWithReceipt(source, { graphLayout: { backend: 'agentic', fallback: 'elk' } })
      expect(result.receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'agentic', attempts: [{ backend: 'agentic', outcome: 'selected' }] })])
      if (source.includes('title:')) {
        expect(result.svg).toContain('Empty ER title')
        expect(result.svg).toBe(renderMermaidSVGWithReceipt(source, { graphLayout: { backend: 'elk' } }).svg)
      }
    }
  })
})
