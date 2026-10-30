import { describe, expect, spyOn, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { renderMermaidSVGWithReceipt } from '../index.ts'
import { layoutMermaidWithReceipt, parseRegisteredMermaid } from '../agent/core.ts'
import { renderMermaidPNGWithReceipt } from '../agent/png.ts'
import { layoutErDiagram } from '../er/layout.ts'
import { parseErDiagram } from '../er/parser.ts'
import { toMermaidLines } from '../mermaid-source.ts'
import { withRenderStageObserver } from '../render-stages.ts'
import { missingSvgLabels } from './helpers/svg-labels.ts'
import { measureQuality } from '../agent/quality.ts'

import * as agenticProducer from '../layout/agentic-layered.ts'
import * as elkProducer from '../elk-instance.ts'
import * as erLabels from '../er/label-layout.ts'
import { ErRouteGeometryError } from '../er/errors.ts'

const native = { graphLayout: { backend: 'agentic' as const } }
const compoundFixture = readFileSync(new URL('../../eval/layout-compare/fixtures/er-compound-backends.mmd', import.meta.url), 'utf8')
const fixture = readFileSync(new URL('../../eval/layout-compare/fixtures/er-backends.mmd', import.meta.url), 'utf8')

describe('ER layout backends', () => {
  test.each([1, 4])('keeps %s relationships among thousands of isolated entities within its geometry allowance', count => {
    const source = 'erDiagram\n' + Array.from({ length: count }, (_, i) => `N${i * 2} ||--|| N${i * 2 + 1} : owns`).join('\n')
      + '\n' + Array.from({ length: 4096 }, (_, i) => `N${i}`).join('\n')
    const options = { graphLayout: { backend: 'elk' as const, fallback: 'none' as const } }
    let rendered!: ReturnType<typeof renderMermaidSVGWithReceipt>
    expect(() => { rendered = renderMermaidSVGWithReceipt(source, options) }).not.toThrow()
    const ids = [...rendered.svg.matchAll(/<g class="entity" data-id="([^"]+)"/g)].map(match => match[1]!)
    expect(new Set(ids).size).toBe(4096)
    expect(ids.toSorted()).toEqual(Array.from({ length: 4096 }, (_, i) => `N${i}`).toSorted())
    expect(rendered.svg.match(/class="er-relationship"/g)).toHaveLength(count)
    for (let i = 0; i < count; i++) expect(rendered.svg).toContain(`data-from="N${i * 2}" data-to="N${i * 2 + 1}"`)
    expect(rendered.svg).toContain('data-label="owns"')
    expect(rendered.receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'elk', fallback: 'none', attempts: [{ backend: 'elk', outcome: 'selected' }] })])
  })

  test.each(['elk', 'agentic'].flatMap(backend => ['TB', 'BT', 'LR', 'RL'].map(direction => ({ backend, direction }))))('finishes a 128-entity chain within the shared geometry allowance with $backend in $direction', ({ backend, direction }) => {
    const source = `erDiagram\ndirection ${direction}\n` + Array.from({ length: 127 }, (_, i) => `N${i} ||--o{ N${i + 1} : owns`).join('\n')
    const options = { graphLayout: { backend: backend as 'elk' | 'agentic', fallback: 'none' as const } }
    let result!: ReturnType<typeof layoutMermaidWithReceipt>
    expect(() => { result = layoutMermaidWithReceipt(source, options) }).not.toThrow()
    const { layout, receipt } = result
    expect(layout.nodes.map(node => node.id)).toEqual(Array.from({ length: 128 }, (_, i) => `N${i}`))
    expect(layout.edges.map(edge => [edge.from, edge.to])).toEqual(Array.from({ length: 127 }, (_, i) => [`N${i}`, `N${i + 1}`]))
    const quality = measureQuality(layout)
    expect(quality.edgeCrossings).toBe(0)
    expect(quality.routeOverlaps).toEqual({ parallel: 0, opposing: 0 })
    expect(quality.labelConflicts?.total).toBe(0)
    expect(receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: backend, fallback: 'none' })])
    const rendered = renderMermaidSVGWithReceipt(source, options)
    expect(rendered.receipt.layoutCertification?.status).toBe('passed')
    expect(rendered.svg.match(/class="er-relationship"/g)).toHaveLength(127)
  })

  test.each(['TB', 'BT', 'LR', 'RL'])('reserves cardinality leads without crossing a neighbouring tree route in %s', direction => {
    const source = `erDiagram\n  direction ${direction}\n` + Array.from({ length: 40 }, (_, index) =>
      `  E${index} {\n    int id PK\n    string name${index}\n  }\n` + (index ? `  E${Math.floor((index - 1) / 2)} ||--o{ E${index} : has\n` : ''),
    ).join('')
    const result = layoutMermaidWithReceipt(source, native), quality = measureQuality(result.layout)
    expect(result.layout.nodes).toHaveLength(40)
    expect(result.layout.edges.map(edge => [edge.from, edge.to])).toEqual(Array.from({ length: 39 }, (_, index) => [`E${Math.floor(index / 2)}`, `E${index + 1}`]))
    expect(quality.edgeCrossings).toBe(0)
    expect(quality.routeOverlaps).toEqual({ parallel: 0, opposing: 0 })
    expect(quality.labelConflicts?.total).toBe(0)
    expect(renderMermaidSVGWithReceipt(source, native).receipt.layoutCertification?.status).toBe('passed')
  })

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
    const expectedLabels = ['Accounts and orders with retained measured headers', 'Customer records', 'Audit trail and records', 'CUSTOMER', 'ORDER', 'AUDIT', 'RECORD', 'Stable customer id', 'places', 'records', 'exchanges', 'logs']
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
    if (bendRadius > 0) {
      expect(result.svg).toMatch(/<path\b[^>]*d="[^"]*Q/)
      // Read the actual emitted path, independently of the curve projector.
      // Rounding only corner coordinates once created a tiny diagonal from
      // the unrounded M endpoint to its first L command.
      for (const svg of [reference.svg, result.svg]) {
        const attrs = (tag: string) => Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map(match => [match[1]!, match[2]!]))
        const boxes = new Map([...svg.matchAll(/<rect\b[^>]*>/g)].flatMap(match => {
          const a = attrs(match[0]), id = a['data-id']?.startsWith('entity-rect:') ? a['data-id'].slice(12) : a['data-id']?.startsWith('er-group:') && a['data-id'].endsWith(':box') ? a['data-id'].slice(9, -4) : undefined
          return id ? [[id, { x: Number(a.x), y: Number(a.y), width: Number(a.width), height: Number(a.height) }] as const] : []
        }))
        const paths = [...svg.matchAll(/<(?:path|polyline)\b[^>]*class="er-relationship"[^>]*>/g)].map(match => attrs(match[0]))
        expect(paths).toHaveLength(5)
        for (const path of paths) {
          const tokens = (path.d ?? ('M ' + path.points!.trim().split(/\s+/).join(' L '))).match(/[MLQ]|-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/ig)!, lines: Array<readonly [{ x: number; y: number }, { x: number; y: number }]> = []
          let point = { x: NaN, y: NaN }
          for (let i = 0; i < tokens.length;) {
            const command = tokens[i++]!
            if (command === 'Q') { i += 2; point = { x: Number(tokens[i++]), y: Number(tokens[i++]) } }
            else {
              expect(['M', 'L']).toContain(command)
              const next = { x: Number(tokens[i++]), y: Number(tokens[i++]) }
              if (command === 'L') lines.push([point, next])
              point = next
            }
          }
          const first = lines[0]!, last = lines.at(-1)!
          const normal = (at: { x: number; y: number }, toward: { x: number; y: number }, id: string) => {
            const b = boxes.get(id)!, dx = toward.x - at.x, dy = toward.y - at.y, near = (a: number, c: number) => Math.abs(a - c) < 1e-6
            return dy === 0 && (near(at.x, b.x) && dx < 0 || near(at.x, b.x + b.width) && dx > 0)
              || dx === 0 && (near(at.y, b.y) && dy < 0 || near(at.y, b.y + b.height) && dy > 0)
          }
          expect(normal(first[0], first[1], path['data-from']!)).toBe(true)
          expect(normal(last[1], last[0], path['data-to']!)).toBe(true)
        }
      }
    }
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

const mixedFrameNormals = 'erDiagram\ndirection LR\nsubgraph TOP\n direction TB\n subgraph B1\n  direction RL\n  I1 ||--|| F1 : links\n end\n subgraph B2\n  direction BT\n  I2 ||--|| F2 : links\n end\nend\nA ||--|| TOP : links\nTOP ||--|| B : links\nB1 ||--|| B2 : links'

const frameOnlyNormals = 'erDiagram\ndirection LR\nsubgraph Tall\n subgraph N0\n  subgraph N1\n   subgraph N2\n    subgraph N3\n     subgraph N4\n      subgraph N5\n       subgraph N6\n       end\n      end\n     end\n    end\n   end\n  end\n end\nend\nsubgraph Flat\nend\nTall ||--|| Flat : links'

const siblingFrameNormals = "erDiagram\n    subgraph title1\n        A1 ||--|| A2 : links\n    end\n\n    subgraph title2\n        B1 ||--|| B2 : links\n    end\n\n    subgraph title3\n        C1 ||--|| C2 : links\n    end\n\n    title1 ||--|| title2 : links\n    title2 ||--|| title3 : links\n    title2 ||--|| C2 : links"

test.each([...['TB', 'BT', 'LR', 'RL'].flatMap(direction => ['agentic', 'elk'].map(backend => ({ direction, backend: backend as 'agentic' | 'elk', framesOnly: false, vocabulary: false }))), ...(['agentic', 'elk'] as const).map(backend => ({ direction: 'LR', backend, framesOnly: true, vocabulary: false })), ...(['agentic', 'elk'] as const).map(backend => ({ direction: 'LR', backend, framesOnly: false, vocabulary: true }))].map(entry => ({ ...entry, siblings: false })).concat(...['TB', 'BT', 'LR', 'RL'].flatMap(direction => (['agentic', 'elk'] as const).map(backend => ({ direction, backend, framesOnly: false, vocabulary: false, siblings: true })))))('ER rebuilt frame routes retain actual normal contacts in $direction with $backend framesOnly=$framesOnly vocabulary=$vocabulary siblings=$siblings', ({ direction, backend, framesOnly, vocabulary, siblings }) => {
  const mixed = vocabulary ? mixedFrameNormals.replace('I1 ||--|| F1', 'I1 }|--o| F1').replace('I2 ||--|| F2 : links', 'I2 }o--|| F2').replace('A ||--|| TOP', 'A u--o{ TOP').replace('TOP ||--|| B', 'TOP |o--|{ B').replace('B1 ||--|| B2 : links', 'B1 }o--o{ B2') : mixedFrameNormals
  const source = siblings ? direction === 'LR' ? siblingFrameNormals : siblingFrameNormals.replace('erDiagram', `erDiagram\ndirection ${direction}`) : (framesOnly ? frameOnlyNormals : mixed).replace('direction LR', `direction ${direction}`), options = { graphLayout: { backend, ...(siblings ? { fallback: 'none' as const } : {}) } }
  const model = parseErDiagram(toMermaidLines(source)), original = structuredClone(model)
  const placed = layoutErDiagram(model, options), rendered = renderMermaidSVGWithReceipt(source, options)
  if (!framesOnly && !siblings) {
    // TOP explicitly says TB and B1 -> B2 is an authored dependency between
    // its direct child frames, even when the diagram's outer flow differs.
    const first = placed.groups.find(group => group.id === 'B1')!, second = placed.groups.find(group => group.id === 'B2')!
    expect(second.y).toBeGreaterThan(first.y + first.height)
  }
  expect(model).toEqual(original)
  expect(placed.relationships.map(({ entity1, entity2, cardinality1, cardinality2, identifying, label }) => ({ entity1, entity2, cardinality1, cardinality2, identifying, label }))).toEqual(model.relationships.map(({ entity1, entity2, cardinality1, cardinality2, identifying, label }) => ({ entity1, entity2, cardinality1, cardinality2, identifying, label })))
  expect(rendered.receipt.layoutDecisions?.[0]?.selected).toBe(backend)
  expect(rendered.receipt.layoutCertification?.status).toBe('passed')
  const attributes = (tag: string) => Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map(match => [match[1]!, match[2]!]))
  const rectangles = [...rendered.svg.matchAll(/<rect\b[^>]*>/g)].map(match => attributes(match[0]))
  const boxes = new Map(rectangles.flatMap(attrs => {
    const id = attrs['data-id']?.startsWith('entity-rect:') ? attrs['data-id'].slice('entity-rect:'.length)
      : attrs['data-id']?.startsWith('er-group:') && attrs['data-id'].endsWith(':box') ? attrs['data-id'].slice('er-group:'.length, -4) : undefined
    return id ? [[id, { x: Number(attrs.x), y: Number(attrs.y), width: Number(attrs.width), height: Number(attrs.height), rx: Number(attrs.rx ?? 0), ry: Number(attrs.ry ?? 0), strokeHalf: Number(attrs['stroke-width'] ?? 0) / 2 }] as const] : []
  }))
  expect([...boxes.keys()].sort()).toEqual([...model.entities.map(entity => entity.id), ...model.groups.map(group => group.id)].sort())
  const normal = (point: { x: number; y: number }, next: { x: number; y: number }, box: { x: number; y: number; width: number; height: number; rx: number; ry: number }) => {
    const dx = next.x - point.x, dy = next.y - point.y, near = (a: number, b: number) => Math.abs(a - b) < 1e-6
    const flatY = point.y >= box.y + box.ry && point.y <= box.y + box.height - box.ry, flatX = point.x >= box.x + box.rx && point.x <= box.x + box.width - box.rx
    return flatY && (near(point.x, box.x) && dx < 0 && dy === 0 || near(point.x, box.x + box.width) && dx > 0 && dy === 0)
      || flatX && (near(point.y, box.y) && dy < 0 && dx === 0 || near(point.y, box.y + box.height) && dy > 0 && dx === 0)
  }
  const enters = (a: { x: number; y: number }, b: { x: number; y: number }, box: { x: number; y: number; width: number; height: number }) => {
    let lo = 0, hi = 1
    for (const [origin, delta, min, max] of [[a.x, b.x - a.x, box.x, box.x + box.width], [a.y, b.y - a.y, box.y, box.y + box.height]]) {
      if (delta === 0) { if (origin! <= min! || origin! >= max!) return false }
      else { const first = (min! - origin!) / delta!, last = (max! - origin!) / delta!; lo = Math.max(lo, Math.min(first, last)); hi = Math.min(hi, Math.max(first, last)); if (lo >= hi) return false }
    }
    return lo < hi
  }
  const lines = [...rendered.svg.matchAll(/<line\b[^>]*>/g)].map(match => attributes(match[0]))
  const relationships = [...rendered.svg.matchAll(/<polyline\b[^>]*class="er-relationship"[^>]*>/g)].map(match => attributes(match[0]))
  expect(relationships).toHaveLength(model.relationships.length)
  for (const [relationshipIndex, rel] of relationships.entries()) {
    const expected = model.relationships[relationshipIndex]!
    expect([rel['data-cardinality1'], rel['data-cardinality2'], rel['data-label'] ?? '', rel['data-identifying']]).toEqual([expected.cardinality1, expected.cardinality2, expected.label, String(expected.identifying)])
    const points = rel.points!.split(/\s+/).map(pair => { const [x, y] = pair.split(',').map(Number); return { x: x!, y: y! } })
    const start = points[0]!, end = points.at(-1)!, next = points.find(p => p.x !== start.x || p.y !== start.y)!, previous = [...points].reverse().find(p => p.x !== end.x || p.y !== end.y)!
    expect(normal(start, next, boxes.get(rel['data-from']!)!)).toBe(true)
    expect(normal(end, previous, boxes.get(rel['data-to']!)!)).toBe(true)
    for (const [index, point] of points.entries()) if (index) {
      const before = points[index - 1]!
      expect(point.x === before.x || point.y === before.y).toBe(true)
      for (const entity of model.entities) expect(enters(before, point, boxes.get(entity.id)!)).toBe(false)
      for (const group of placed.groups) expect(enters(before, point, { ...boxes.get(group.id)!, height: group.headerHeight })).toBe(false)
    }

  }
  type InkBox = { x: number; y: number; width: number; height: number }
  const overlaps = (a: InkBox, b: InkBox) => Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) && Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y)
  const inflated = (box: InkBox, r: number): InkBox => ({ x: box.x - r, y: box.y - r, width: box.width + r * 2, height: box.height + r * 2 })
  const rect = (attrs: Record<string, string>): InkBox => ({ x: Number(attrs.x), y: Number(attrs.y), width: Number(attrs.width), height: Number(attrs.height) })
  const headers = new Map(rectangles.flatMap(attrs => attrs['data-id']?.startsWith('er-group:') && attrs['data-id'].endsWith(':header') ? [[attrs['data-id'].slice('er-group:'.length, -7), rect(attrs)] as const] : []))
  const glyphPieces = new Map<string, InkBox[]>()
  let currentGlyph: string | undefined
  const tags = [...rendered.svg.matchAll(/<(line|circle|polygon|rect|polyline|path|text)\b[^>]*>/g)]
  for (const match of tags) {
    const attrs = attributes(match[0]), tag = match[1]!
    if (attrs['data-id']) currentGlyph = attrs['data-id'].startsWith('card:') ? attrs['data-id'] : undefined
    if (!['line', 'circle', 'polygon'].includes(tag)) currentGlyph = undefined
    if (!currentGlyph) continue
    const half = Number(attrs['stroke-width'] ?? 0) / 2
    let box: InkBox
    if (tag === 'line') {
      const x1 = Number(attrs.x1), x2 = Number(attrs.x2), y1 = Number(attrs.y1), y2 = Number(attrs.y2)
      const length = Math.hypot(x2 - x1, y2 - y1), nx = length ? -(y2 - y1) / length * half : 0, ny = length ? (x2 - x1) / length * half : 0
      const xs = [x1 + nx, x1 - nx, x2 + nx, x2 - nx], ys = [y1 + ny, y1 - ny, y2 + ny, y2 - ny]
      // Actual SVG defaults to butt caps. It does not grow a line along its
      // tangent; expanding both axes invents overlapping endpoint ink.
      box = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
      if (attrs['stroke-linecap'] && attrs['stroke-linecap'] !== 'butt') box = inflated(box, half)
    } else if (tag === 'circle') {
      const radius = Number(attrs.r) + half
      box = { x: Number(attrs.cx) - radius, y: Number(attrs.cy) - radius, width: radius * 2, height: radius * 2 }
    } else {
      const vertices = attrs.points!.split(/\s+/).map(pair => pair.split(',').map(Number)), xs = vertices.map(p => p[0]!), ys = vertices.map(p => p[1]!)
      box = inflated({ x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }, half * Number(attrs['stroke-miterlimit'] ?? 4))
    }
    const pieces = glyphPieces.get(currentGlyph) ?? []
    pieces.push(box); glyphPieces.set(currentGlyph, pieces)
  }
  const paths = relationships.map(rel => rel.points!.split(/\s+/).map(pair => { const [x, y] = pair.split(',').map(Number); return { x: x!, y: y! } }))
  const marks = relationships.flatMap((rel, index) => ['1', '2'].map((end, i) => {
    const id = `card:${rel['data-id']!.slice('rel:'.length)}:${end}`, pieces = glyphPieces.get(id)!
    expect(pieces?.length).toBeGreaterThan(0)
    const kind = i ? rel['data-cardinality2']! : rel['data-cardinality1']!
    expect(pieces).toHaveLength(({ one: 2, 'zero-one': 2, many: 4, 'zero-many': 4, parent: 1 } as Record<string, number>)[kind]!)
    return { id, kind, pieces, index, owner: i ? rel['data-to']! : rel['data-from']! }
  }))
  const frames = rectangles.filter(attrs => attrs['data-id']?.startsWith('er-group:') && attrs['data-id'].endsWith(':box')).flatMap(attrs => {
    const b = rect(attrs), h = Number(attrs['stroke-width']) / 2, id = attrs['data-id']!.slice('er-group:'.length, -4)
    return [{ id, box: { x: b.x - h, y: b.y - h, width: h * 2, height: b.height + h * 2 } }, { id, box: { x: b.x + b.width - h, y: b.y - h, width: h * 2, height: b.height + h * 2 } },
      { id, box: { x: b.x - h, y: b.y - h, width: b.width + h * 2, height: h * 2 } }, { id, box: { x: b.x - h, y: b.y + b.height - h, width: b.width + h * 2, height: h * 2 } }]
  })
  for (const mark of marks) for (const piece of mark.pieces) {
    if (mark.kind !== 'parent') expect(overlaps(piece, boxes.get(mark.owner)!)).toBe(false)
    for (const frame of frames) if (frame.id !== mark.owner) expect(overlaps(piece, frame.box)).toBe(false)
    for (const entity of model.entities) if (entity.id !== mark.owner) expect(overlaps(piece, inflated(boxes.get(entity.id)!, boxes.get(entity.id)!.strokeHalf))).toBe(false)
    for (const [id, header] of headers) if (id !== mark.owner) expect(overlaps(piece, header)).toBe(false)
    for (const other of marks) if (other.id !== mark.id) for (const otherPiece of other.pieces) expect(overlaps(piece, otherPiece)).toBe(false)
    for (const [index, path] of paths.entries()) if (index !== mark.index) {
      const envelope = inflated(piece, Number(relationships[index]!['stroke-width'] ?? 1) / 2)
      for (let i = 1; i < path.length; i++) expect(enters(path[i - 1]!, path[i]!, envelope)).toBe(false)
    }
  }
  const pills: InkBox[] = []
  for (let i = 0; i < tags.length; i++) {
    if (tags[i]![1] !== 'text' || tags[i - 1]?.[1] !== 'rect') continue
    const attrs = attributes(tags[i - 1]![0])
    if (attrs.rx === '2' && attrs['stroke-width'] === '0.5') pills.push(inflated(rect(attrs), .25))
  }
  const labelled = relationships.map((rel, index) => rel['data-label'] ? index : -1).filter(index => index >= 0)
  expect(pills).toHaveLength(labelled.length)
  for (const [pillIndex, pill] of pills.entries()) {
    for (const frame of frames) expect(overlaps(pill, frame.box)).toBe(false)
    for (const entity of model.entities) expect(overlaps(pill, inflated(boxes.get(entity.id)!, boxes.get(entity.id)!.strokeHalf))).toBe(false)
    for (const header of headers.values()) expect(overlaps(pill, header)).toBe(false)
    for (const mark of marks) for (const piece of mark.pieces) expect(overlaps(pill, piece)).toBe(false)
    for (const [index, path] of paths.entries()) if (index !== labelled[pillIndex]) {
      const envelope = inflated(pill, Number(relationships[index]!['stroke-width'] ?? 1) / 2)
      for (let i = 1; i < path.length; i++) expect(enters(path[i - 1]!, path[i]!, envelope)).toBe(false)
    }
    for (let earlier = 0; earlier < pillIndex; earlier++) expect(overlaps(pill, pills[earlier]!)).toBe(false)
  }

})


describe('ER final candidate backend ownership', () => {
  test('rechecks moved cardinality ink before allocating the next automatic port', () => {
    const source = 'erDiagram\nA ||--|| B : ""\nA ||--|| B : ""\nA ||--|| B : ""'
    const original = agenticProducer.layoutAgenticGraph
    const producer = spyOn(agenticProducer, 'layoutAgenticGraph').mockImplementation(input => {
      const placed = original(input), a = placed.nodes[0]!, b = placed.nodes[1]!, y = a.y + input.nodes[0]!.height / 2
      // A legal but crowded producer candidate makes successive final seats
      // depend on ink moved by the previous allocation, on both owned faces.
      return { ...placed, edges: placed.edges.map(edge => ({ ...edge, points: [{ x: a.x + input.nodes[0]!.width, y }, { x: b.x, y }] })) }
    })
    try {
      let rendered!: ReturnType<typeof renderMermaidSVGWithReceipt>
      expect(() => { rendered = renderMermaidSVGWithReceipt(source, { graphLayout: { backend: 'agentic', fallback: 'none' } }) }).not.toThrow()
      expect(rendered.receipt.layoutCertification?.status).toBe('passed')
      const placed = layoutErDiagram(parseErDiagram(toMermaidLines(source)), native)
      expect(placed.relationships).toHaveLength(3)
      for (const end of [false, true]) {
        const ports = placed.relationships.map(rel => (end ? rel.points.at(-1)! : rel.points[0]!).y).sort((a, b) => a - b)
        expect(ports[1]! - ports[0]!).toBeGreaterThan(13)
        expect(ports[2]! - ports[1]!).toBeGreaterThan(13)
      }
    } finally { producer.mockRestore() }
  })

  test('rejects actual incomplete native geometry before selecting a requested ELK fallback, sharing final work', () => {
    const source = 'erDiagram\nFALLBACK_OWNER_A ||--o{ FALLBACK_OWNER_B : late final geometry'
    const model = parseErDiagram(toMermaidLines(source)), originalNative = agenticProducer.layoutAgenticGraph, originalFinalize = erLabels.finalizeErRelationshipLabels
    const finalizations: Array<{ work: NonNullable<Parameters<typeof originalFinalize>[3]>; operations: number }> = []
    const producer = spyOn(agenticProducer, 'layoutAgenticGraph').mockImplementation(input => {
      const placed = originalNative(input)
      // A finite but incomplete returned candidate reaches real ER final
      // admission. The producer itself has not thrown a capability error.
      return { ...placed, edges: placed.edges.map(edge => ({ ...edge, points: [{ ...edge.points[0]! }] })) }
    })
    const elk = spyOn(elkProducer, 'elkLayoutSync')
    const finish = spyOn(erLabels, 'finalizeErRelationshipLabels').mockImplementation((diagram, style, face, work) => {
      if (work) finalizations.push({ work, operations: work.operations })
      return originalFinalize(diagram, style, face, work)
    })
    try {
      expect(() => layoutErDiagram(model, { graphLayout: { backend: 'agentic', fallback: 'none' } })).toThrow(ErRouteGeometryError)
      expect(elk).not.toHaveBeenCalled()
      finalizations.length = 0
      const rendered = renderMermaidSVGWithReceipt(source, { graphLayout: { backend: 'agentic', fallback: 'elk' } })
      expect(rendered.receipt.layoutDecisions).toEqual([expect.objectContaining({ requested: 'agentic', selected: 'elk', fallback: 'elk', attempts: [expect.objectContaining({ backend: 'agentic', outcome: 'candidate-rejected' }), { backend: 'elk', outcome: 'selected' }] })])
      expect(rendered.receipt.layoutCertification?.status).toBe('passed')
      expect(rendered.svg).toContain('data-from="FALLBACK_OWNER_A"')
      expect(rendered.svg).toContain('data-to="FALLBACK_OWNER_B"')
      expect(rendered.svg).toContain('late final geometry')
      expect(producer).toHaveBeenCalledTimes(2)
      expect(elk).toHaveBeenCalledTimes(1)
      expect(finalizations.length).toBeGreaterThanOrEqual(2)
      // One per-request debit object survives the fallback. ELK observes the
      // operations already spent finishing the rejected Native candidate.
      expect(finalizations.every(entry => entry.work === finalizations[0]!.work)).toBe(true)
      expect(finalizations.at(-1)!.operations).toBeGreaterThan(finalizations[0]!.operations)
    } finally { finish.mockRestore(); elk.mockRestore(); producer.mockRestore() }
  })

  test('propagates an unexpected late finalizer error without invoking ELK', () => {
    const model = parseErDiagram(toMermaidLines('erDiagram\nUNEXPECTED_OWNER_A ||--|| UNEXPECTED_OWNER_B : unexpected final error'))
    const unexpected = new Error('ER_ROUTE_BLOCKED: unexpected host failure is not a typed candidate refusal')
    const elk = spyOn(elkProducer, 'elkLayoutSync')
    const finish = spyOn(erLabels, 'finalizeErRelationshipLabels').mockImplementation(() => { throw unexpected })
    try {
      let caught: unknown
      try { layoutErDiagram(model, { graphLayout: { backend: 'agentic', fallback: 'elk' } }) } catch (error) { caught = error }
      expect(caught).toBe(unexpected)
      expect(elk).not.toHaveBeenCalled()
    } finally { finish.mockRestore(); elk.mockRestore() }
  })
})
