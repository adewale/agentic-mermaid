import { describe, expect, test } from 'bun:test'
import { layoutErDiagram, ER_STYLE_DEFAULTS, erRelationshipBlock } from '../er/layout.ts'
import { parseErDiagram } from '../er/parser.ts'
import { separateRelationshipLabels, lowerErScene } from '../er/renderer.ts'
import { projectErPositioned } from '../positioned-views/er.ts'
import { f } from '../positioned-views/geometry.ts'
import type { InternalStyleFace } from '../scene/style-registry.ts'
import type { PositionedErDiagram, PositionedErRelationship } from '../er/types.ts'
import { toMermaidLines } from '../mermaid-source.ts'
import { pillRect, segmentEntersLabelRect } from '../shared/edge-label-geometry.ts'
import { resolveRenderStyle } from '../styles.ts'

const style = resolveRenderStyle({}, ER_STYLE_DEFAULTS)
const relationship = (points: PositionedErRelationship['points'], label = 'owns'): PositionedErRelationship => ({
  entity1: 'A', entity2: 'B', cardinality1: 'one', cardinality2: 'zero-many', identifying: true, label, points,
})
const diagram = (relationships: PositionedErRelationship[]): PositionedErDiagram => ({
  width: 600, height: 300, entities: [], groups: [], relationships, labelPlacement: 'shaft-aware',
})

function foreignConflicts(placed: PositionedErDiagram): number {
  const positions = separateRelationshipLabels(placed, style)
  let conflicts = 0
  for (const [owner, center] of positions) {
    const rect = pillRect(center.x, center.y, owner.labelBlock ?? erRelationshipBlock(owner, style))
    for (const other of placed.relationships) if (other !== owner && other.points.slice(1).some((b, i) => segmentEntersLabelRect(other.points[i]!, b, rect))) conflicts++
  }
  return conflicts
}

describe('ER label reservations and foreign shafts', () => {
  test('keeps legacy placement when the selected producer did not opt into the new policy', () => {
    const owner = relationship([{ x: 20, y: 150 }, { x: 580, y: 150 }])
    owner.labelPosition = { x: 180, y: 150 }
    const foreign = relationship([{ x: 300, y: 30 }, { x: 300, y: 270 }], '')
    const placed = diagram([owner, foreign])
    delete placed.labelPlacement
    expect(separateRelationshipLabels(placed, style).get(owner)).toEqual({ x: 300, y: 150 })
  })

  test.each([0, 64])('moves a label clear of an unrelated shaft among %s distant routes', distant => {
    const owner = relationship([{ x: 20, y: 150 }, { x: 580, y: 150 }])
    const foreign = relationship([{ x: 300, y: 30 }, { x: 300, y: 270 }], '')
    const remote = Array.from({ length: distant }, (_, i) => relationship([{ x: 1000 + i * 40, y: -600 }, { x: 1000 + i * 40, y: -100 }], ''))
    const placed = diagram([owner, foreign, ...remote]), original = structuredClone(placed)
    const center = separateRelationshipLabels(placed, style).get(owner)!
    expect(center.x).not.toBe(300)
    expect(center.y).toBe(150)
    expect(foreignConflicts(placed)).toBe(0)
    expect(placed).toEqual(original)
  })

  test('retains a clear producer reservation and ignores one left off a changed route', () => {
    const owner = relationship([{ x: 20, y: 150 }, { x: 580, y: 150 }])
    owner.labelPosition = { x: 180, y: 150 }
    const placed = diagram([owner])
    expect(separateRelationshipLabels(placed, style).get(owner)).toEqual({ x: 180, y: 150 })
    owner.points = [{ x: 20, y: 200 }, { x: 580, y: 200 }]
    expect(separateRelationshipLabels(placed, style).get(owner)).toEqual({ x: 300, y: 200 })
  })

  test('rejects a reserved label that covers a cardinality endpoint or a foreign shaft', () => {
    const owner = relationship([{ x: 20, y: 150 }, { x: 580, y: 150 }])
    const foreign = relationship([{ x: 300, y: 30 }, { x: 300, y: 270 }], '')
    const placed = diagram([owner, foreign])
    for (const x of [24, 300]) {
      owner.labelPosition = { x, y: 150 }
      expect(separateRelationshipLabels(placed, style).get(owner)!.x).not.toBe(x)
      expect(foreignConflicts(placed)).toBe(0)
    }
  })

  test('uses exact interval subtraction when every center-out sample meets a foreign shaft', () => {
    const owner = relationship([{ x: 50, y: 150 }, { x: 550, y: 150 }])
    const foreign = [125, 150, 175, 200, 250, 300, 350, 400, 425, 450, 475].map(x => relationship([{ x, y: 30 }, { x, y: 270 }], ''))
    const placed = diagram([owner, ...foreign])
    expect(foreignConflicts(placed)).toBe(0)
  })

  test.each(['TB', 'BT', 'LR', 'RL'])('translates producer reservations with the route and title in %s', direction => {
    const source = `erDiagram\ndirection ${direction}\nA ||--o{ B : owns\nB ||--o{ C : contains`
    const parsed = parseErDiagram(toMermaidLines(source))
    parsed.title = 'Account ownership'
    const placed = layoutErDiagram(parsed, { graphLayout: { backend: 'agentic' } })
    expect(placed.labelPlacement).toBe('shaft-aware')
    expect(placed.relationships.some(rel => rel.labelPosition)).toBe(true)
    for (const rel of placed.relationships) if (rel.labelPosition) {
      const p = rel.labelPosition
      expect(rel.points.slice(1).some((b, i) => {
        const a = rel.points[i]!
        return a.x === b.x && Math.abs(p.x - a.x) < .001 && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y)
          || a.y === b.y && Math.abs(p.y - a.y) < .001 && p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x)
      })).toBe(true)
    }
  })

  test('does not opt ELK into native label placement', () => {
    const source = 'erDiagram\nA ||--o{ B : owns'
    const placed = layoutErDiagram(parseErDiagram(toMermaidLines(source)), { graphLayout: { backend: 'elk' } })
    expect(placed.labelPlacement).toBeUndefined()
    expect(placed.relationships.every(rel => rel.labelPosition === undefined)).toBe(true)
  })

  const styleFaces: [string, Readonly<InternalStyleFace>][] = [
    ['edge width and bend radius', { edge: { lineWidth: 7, bendRadius: 18 } }],
    ['relationship role override', { roles: { relationship: { lineWidth: 11, bendRadius: 24, fontSize: 18 } } }],
    ['identifying category override', {
      roles: { relationship: { lineWidth: 3, bendRadius: 10 } },
      semanticSlots: { identifying: { lineWidth: 13, bendRadius: 28, fontSize: 19 } },
      bindings: [{ role: 'relationship', channel: 'category', value: 'identifying', slot: 'identifying' }],
    }],
  ]
  test.each(styleFaces)('shares final native label centers between projection and paint with %s', (_, styleFace) => {
    const source = 'erDiagram\nA ||--o{ B : owns\nA ||..o{ C : references\nB ||--o{ D : contains\nC ||..o{ D : finds'
    const options = { graphLayout: { backend: 'agentic' as const } }
    const placed = layoutErDiagram(parseErDiagram(toMermaidLines(source)), options, styleFace)
    const original = structuredClone(placed)
    const projected = projectErPositioned({ positioned: placed, options: {} })
    const scene = lowerErScene({ positioned: placed, colors: { bg: '#ffffff', fg: '#222222' }, resolved: { renderOptions: options, styleFace } })
    for (const [index, rel] of placed.relationships.entries()) {
      const mark = scene.parts.find(part => part.kind === 'text' && part.id.startsWith('rel-label:') && part.text === rel.label)
      if (!mark || mark.kind !== 'text') throw new Error('relationship label must be painted')
      expect({ x: mark.x, y: mark.y }).toEqual(rel.finalLabelPosition!)
      expect(projected.edges![index]!.label).toEqual(expect.objectContaining({ x: f(mark.x), y: f(mark.y), text: rel.label }))
    }
    expect(placed).toEqual(original)
  })

  test('clears the forty-entity qualification workload without changing relationship semantics', () => {
    const source = ['erDiagram', ...Array.from({ length: 40 }, (_, i) => [
      `  E${i} {`, '    int id PK', `    string name${i}`, '  }',
      ...(i > 0 ? [`  E${Math.floor((i - 1) / 2)} ||--o{ E${i} : has`] : []),
    ]).flat()].join('\n')
    const parsed = parseErDiagram(toMermaidLines(source))
    const placed = layoutErDiagram(parsed, { graphLayout: { backend: 'agentic' } })
    expect(placed.relationships.map(({ entity1, entity2, cardinality1, cardinality2, identifying, label }) => ({ entity1, entity2, cardinality1, cardinality2, identifying, label }))).toEqual(parsed.relationships)
    expect(foreignConflicts(placed)).toBe(0)
  })
})
