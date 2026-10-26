import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { layoutMermaidWithReceipt, parseRegisteredMermaid } from '../agent/core.ts'
import { renderMermaidPNGWithReceipt } from '../agent/png.ts'
import { renderMermaidSVGWithReceipt } from '../index.ts'
import { withRenderStageObserver } from '../render-stages.ts'
import { layoutRequirementDiagram } from '../requirement/layout.ts'
import { parseRequirementDiagram } from '../requirement/parser.ts'
import { segmentEntersLabelRect } from '../shared/edge-label-geometry.ts'
import { scanSvgStartTags } from '../svg-structure.ts'

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

  test.each(['TB', 'BT', 'LR', 'RL'].flatMap(direction => (['agentic', 'elk'] as const).map(backend => ({ direction, backend }))))('keeps emitted rounded self-loop contacts normal with fractional padding in $direction using $backend', ({ direction, backend }) => {
    const input = `requirementDiagram\ndirection ${direction}\nrequirement r {\ntext: Card\n}\nr - traces -> r`
    for (const bendRadius of [0, 12]) {
      const result = renderMermaidSVGWithReceipt(input, { padding: 32.123456789, graphLayout: { backend, fallback: 'none' }, style: { roles: { relationship: { bendRadius } } } })
      expect(result.receipt.layoutCertification?.status).toBe('passed')
      expect(result.receipt.layoutDecisions?.[0]?.selected).toBe(backend)
      const tags = scanSvgStartTags(result.svg).map(tag => ({ name: tag.name, attrs: Object.fromEntries(tag.attributes.map(attribute => [attribute.name, attribute.value])) }))
      const card = tags.find(tag => tag.name === 'rect' && tag.attrs.x !== undefined && tag.attrs.stroke !== 'none')!.attrs
      const relationships = tags.filter(tag => tag.attrs['data-role'] === 'relationship')
      expect(relationships).toHaveLength(1)
      const path = relationships[0]!.attrs
      expect(path['data-from']).toBe('r')
      expect(path['data-to']).toBe('r')
      expect(path['data-relationship']).toBe('traces')
      expect(path['marker-end']).toBe('url(#requirement-arrow)')
      expect(result.svg).toContain('Card')
      expect(result.svg).toContain('&lt;&lt;traces&gt;&gt;')
      const tokens = (path.d ?? ('M ' + path.points!.trim().split(/\s+/).join(' L '))).match(/[MLQ]|-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/ig)!
      const lines: Array<readonly [{ x: number; y: number }, { x: number; y: number }]> = []
      let point = { x: NaN, y: NaN }
      for (let index = 0; index < tokens.length;) {
        const command = tokens[index++]!
        if (command === 'Q') { index += 2; point = { x: Number(tokens[index++]), y: Number(tokens[index++]) } }
        else {
          expect(['M', 'L']).toContain(command)
          const next = { x: Number(tokens[index++]), y: Number(tokens[index++]) }
          if (command === 'L') lines.push([point, next])
          point = next
        }
      }
      if (bendRadius > 0) expect(path.d).toContain('Q')
      const normal = (at: { x: number; y: number }, toward: { x: number; y: number }) => {
        const x = Number(card.x), y = Number(card.y), right = x + Number(card.width), bottom = y + Number(card.height)
        const dx = toward.x - at.x, dy = toward.y - at.y, near = (a: number, b: number) => Math.abs(a - b) < 1e-6
        return dy === 0 && at.y > y && at.y < bottom && (near(at.x, x) && dx < 0 || near(at.x, right) && dx > 0)
          || dx === 0 && at.x > x && at.x < right && (near(at.y, y) && dy < 0 || near(at.y, bottom) && dy > 0)
      }
      // Read the serialized legs, rather than trusting the positioned polyline:
      // marker auto-orientation follows this actual last leg too.
      expect(normal(lines[0]![0], lines[0]![1])).toBe(true)
      expect(normal(lines.at(-1)![1], lines.at(-1)![0])).toBe(true)
    }
  })

  test.each(['agentic', 'elk'] as const)('paints authored dashed relationships and solid containment with %s', backend => {
    for (const type of ['contains', 'copies', 'derives', 'satisfies', 'verifies', 'refines', 'traces']) for (const bendRadius of [0, 12]) {
      const input = `requirementDiagram\nrequirement r {\ntext: Card\n}\nelement proof {\ntype: evidence\n}\nproof - ${type} -> r`
      const result = renderMermaidSVGWithReceipt(input, { graphLayout: { backend, fallback: 'none' }, style: { roles: { relationship: { bendRadius } } } })
      expect(result.receipt.layoutCertification?.status).toBe('passed')
      const relationships = scanSvgStartTags(result.svg).filter(tag => tag.attributes.some(attribute => attribute.name === 'data-role' && attribute.value === 'relationship'))
      expect(relationships).toHaveLength(1)
      const paint = Object.fromEntries(relationships[0]!.attributes.map(attribute => [attribute.name, attribute.value]))
      expect(paint['data-from']).toBe('proof')
      expect(paint['data-to']).toBe('r')
      expect(paint['data-relationship']).toBe(type)
      if (type === 'contains') {
        expect(paint['stroke-dasharray']).toBeUndefined()
        expect(paint['marker-start']).toBe('url(#requirement-contains)')
        expect(paint['marker-end']).toBeUndefined()
      } else {
        expect(paint['stroke-dasharray']).toBe('6 4')
        expect(paint['marker-end']).toBe('url(#requirement-arrow)')
        expect(paint['marker-start']).toBeUndefined()
      }
      expect(result.svg).toContain(`&lt;&lt;${type}&gt;&gt;`)
    }
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
