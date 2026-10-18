import '../index.ts'
import { describe, expect, test } from 'bun:test'
import { resolveRenderRequestForExecution, resolvedFamilyRenderContextOf, resolvedRenderExecutionPlanOf } from '../render-contract.ts'
import { positionResolvedFamily } from '../positioning.ts'
import { inspectScenePrimitives } from '../scene/inspection.ts'
import { sceneFidelityProblems } from '../scene/fidelity.ts'
import type { SceneDoc, SceneNode } from '../scene/ir.ts'
import type { RenderOptions } from '../types.ts'
import type { PositionedErDiagram } from '../er/types.ts'

function lower(source: string, options: RenderOptions = {}, measure?: (text: string) => number) {
  const request = resolveRenderRequestForExecution(source, options, 'svg', undefined,
    measure ? { textMeasurement: { id: 'test:owned-artwork', version: '1.0.0', measure: input => measure(input.text) } } : {})
  const family = resolvedRenderExecutionPlanOf(request).family
  const layout = positionResolvedFamily(family.id, request)
  const scene = family.lowerScene!({ positioned: layout.positioned, colors: request.appearance.colors, resolved: resolvedFamilyRenderContextOf(request) })
  return { scene, positioned: layout.positioned }
}

function leaves(scene: SceneDoc): SceneNode[] {
  const result: SceneNode[] = []
  const visit = (node: SceneNode): void => {
    result.push(node)
    if (node.kind === 'group') node.children.forEach(child => visit(child.node))
  }
  scene.parts.forEach(visit)
  return result
}

describe('owned source artwork retains its actual primitives', () => {
  test.each([
    ['flowchart', 'flowchart LR\nA@{icon: "fa fa-book", label: "Book"}\nB@{icon: "unknown:private", label: "Fallback"}\nC@{img: "https://example.com/picture.png", label: "Image"}\nA --> B --> C'],
    ['mindmap', 'mindmap\n root((Root))\n  child[Book]\n   ::icon(fa fa-book)\n  other[Fallback]\n   ::icon(unknown:private)'],
    ['architecture', 'architecture-beta\ngroup g(cloud)[Group]\nservice a(mdi:api)[API] in g\nservice b(unknown:private)[Fallback] in g\na:R --> L:b'],
    ['sequence', 'sequenceDiagram\nactor A as Person\nparticipant B@{ "type": "database", "alias": "Store" }\nparticipant C@{ "type": "control", "alias": "Control" }\nparticipant D@{ "type": "collections", "alias": "Collection" }\nparticipant E@{ "type": "queue", "alias": "Queue" }\nparticipant F@{ "type": "entity", "alias": "Entity" }\nparticipant G@{ "type": "boundary", "alias": "Boundary" }\nA->>B: request'],
  ])('%s icon components have geometry, semantic owners and prepared fallback text', (_family, source) => {
    const { scene } = lower(source)
    const icons = leaves(scene).filter(node => node.role === 'icon')
    expect(icons.some(node => node.kind === 'shape')).toBe(true)
    expect(icons.every(node => node.kind !== 'document')).toBe(true)
    expect(icons.every(node => node.owner)).toBe(true)
    const inspection = inspectScenePrimitives(scene)
    expect(inspection.coverage.unmeasured).toBe(0)
    expect(inspection.coverage.fallbackText).toBe(0)
    expect(sceneFidelityProblems(scene)).toEqual([])
  })

  test.each([
    ['xychart', 'xychart-beta\nx-axis [A,B]\nbar [3,7]\nline [2,8]'],
    ['quadrant', 'quadrantChart\nAlpha: [0.3,0.4]'],
    ['pie', 'pie\n"Alpha": 4\n"Beta": 6'],
  ])('%s interactive artwork distinguishes conditional tooltip paint from transparent hits and metadata', (_family, source) => {
    const { scene } = lower(source, { interactive: true })
    const nodes = leaves(scene)
    expect(nodes.some(node => node.kind === 'group' && node.visibility === 'conditional')).toBe(true)
    expect(nodes.some(node => node.kind === 'shape' && node.paint.fill === 'transparent')).toBe(true)
    expect(nodes.every(node => node.kind !== 'document' || node.element !== 'content' || node.nonPaint === 'interaction-metadata')).toBe(true)
    const inspection = inspectScenePrimitives(scene)
    expect(inspection.coverage.unmeasured).toBe(0)
    expect(inspection.coverage.fallbackText).toBe(0)
    expect(inspection.primitives.some(primitive => primitive.visibility === 'conditional' && primitive.text?.measurement === 'prepared')).toBe(true)
    expect(sceneFidelityProblems(scene)).toEqual([])
  })

  test('class marker carriers retain both real marker resources without becoming semantic relationships', () => {
    const { scene } = lower('classDiagram\nA o--* B')
    const nodes = leaves(scene)
    const relationship = nodes.find(node => node.kind === 'connector' && node.role === 'relationship')!
    const carrier = nodes.find(node => node.kind === 'connector' && node.role === 'chrome')!
    expect(relationship.kind).toBe('connector')
    expect(carrier.kind).toBe('connector')
    if (relationship.kind !== 'connector' || carrier.kind !== 'connector') throw new Error('missing class connectors')
    expect(carrier.owner).toEqual({ id: relationship.id, role: 'relationship' })
    expect(carrier.stroke.opacity).toBe(0)
    expect(carrier.markers.start?.id).toBe('cls-aggregation')
    expect(carrier.markers.end?.id).toBe('cls-composition')
    expect(sceneFidelityProblems(scene)).toEqual([])
  })

  test('ER empty-row text is measured during layout and the same italic block reaches paint', () => {
    const { scene, positioned } = lower('erDiagram\nA', {}, text => text === '(no attributes)' ? 280 : text.length * 10)
    const entity = (positioned as PositionedErDiagram).entities[0]!
    const placeholder = leaves(scene).find(node => node.id === 'entity-empty:A')!
    expect(entity.emptyAttributeBlock).toBeDefined()
    expect(entity.width).toBeGreaterThan(entity.emptyAttributeBlock!.width)
    expect(placeholder.kind).toBe('text')
    if (placeholder.kind !== 'text') throw new Error('missing ER placeholder')
    expect(placeholder.block).toBe(entity.emptyAttributeBlock)
    expect(placeholder.block!.lineBlocks[0]!.runs.every(run => run.italic)).toBe(true)
  })
})
