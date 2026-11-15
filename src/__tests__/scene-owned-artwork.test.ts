import '../index.ts'
import { describe, expect, test } from 'bun:test'
import { resolveRenderRequestForExecution, resolvedFamilyRenderContextOf, resolvedRenderExecutionPlanOf } from '../render-contract.ts'
import { positionResolvedFamily } from '../positioning.ts'
import { inspectScenePrimitives } from '../scene/inspection.ts'
import { sceneFidelityProblems } from '../scene/fidelity.ts'
import type { SceneDoc, SceneNode } from '../scene/ir.ts'
import type { PositionedGraph, RenderOptions } from '../types.ts'
import type { PositionedMindmapDiagram } from '../mindmap/types.ts'
import type { PositionedArchitectureDiagram } from '../architecture/types.ts'
import type { PositionedXYChart } from '../xychart/types.ts'
import type { PositionedPieChart } from '../pie/types.ts'
import type { PositionedQuadrantChart } from '../quadrant/types.ts'
import type { TooltipLayout } from '../shared/tooltip-layout.ts'
import { nodePaintBounds, nodeWorldBounds } from '../scene/bounds.ts'
import type { PositionedErDiagram } from '../er/types.ts'
import type { PositionedClassDiagram } from '../class/types.ts'

function lower(source: string, options: RenderOptions = {}, measure?: (text: string, fontStyle: 'normal' | 'italic') => number) {
  const request = resolveRenderRequestForExecution(source, options, 'svg', undefined,
    measure ? { textMeasurement: { id: 'test:owned-artwork', version: '1.0.0', measure: input => measure(input.text, input.fontStyle) } } : {})
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
  ])('%s interactive artwork distinguishes conditional tooltip paint from transparent hits and metadata', (family, source) => {
    const { scene, positioned } = lower(source, { interactive: true }, text => text.length * 17)
    const nodes = leaves(scene)
    const plans: TooltipLayout[] = family === 'xychart'
      ? [...(positioned as PositionedXYChart).bars.map(bar => bar.tooltip!), ...(positioned as PositionedXYChart).lines.flatMap(line => line.points.map(point => point.tooltip!))]
      : family === 'pie' ? (positioned as PositionedPieChart).slices.map(slice => slice.tooltip!)
        : (positioned as PositionedQuadrantChart).points.map(point => point.tooltip!)
    expect(plans.every(Boolean)).toBe(true)
    expect(plans.map(plan => plan.text)).toEqual(family === 'xychart' ? ['3', '7', '2', '8'] : family === 'pie' ? ['Alpha: 4 (40.0%)', 'Beta: 6 (60.0%)'] : ['Alpha: [0.3, 0.4]'])
    for (const plan of plans) {
      const painted = nodes.find(node => node.kind === 'text' && node.block === plan.block)
      expect(painted?.kind).toBe('text')
      if (painted?.kind !== 'text') throw new Error('tooltip did not consume its positioned block')
      expect(painted.block).toBe(plan.block)
      expect(painted.text).toBe(plan.text.replace(/[\t\n\r ]+/g, ' ').trim())
      expect(painted.block!.width).toBe(plan.block.lineBlocks[0]!.runs.map(run => run.text).join('').length * 17)
      expect(painted.x).toBe(Math.round(plan.textX * 100) / 100)
      expect(painted.y).toBe(Math.round(plan.textY * 100) / 100)
    }
    expect(nodes.some(node => node.kind === 'group' && node.visibility === 'conditional')).toBe(true)
    expect(nodes.some(node => node.kind === 'shape' && node.paint.fill === 'transparent')).toBe(true)
    expect(nodes.every(node => node.kind !== 'document' || node.element !== 'content' || node.nonPaint === 'interaction-metadata')).toBe(true)
    const inspection = inspectScenePrimitives(scene)
    expect(inspection.coverage.unmeasured).toBe(0)
    expect(inspection.coverage.fallbackText).toBe(0)
    expect(inspection.primitives.some(primitive => primitive.visibility === 'conditional' && primitive.text?.measurement === 'prepared')).toBe(true)
    expect(sceneFidelityProblems(scene)).toEqual([])
  })

  test.each([
    ['flowchart', 'flowchart LR\nA@{icon: "unknown:private", label: "Fallback"}'],
    ['mindmap', 'mindmap\n root((Root))\n  other[Fallback]\n   ::icon(unknown:private)'],
    ['architecture', '---\nconfig:\n  architecture:\n    iconSize: 32\n---\narchitecture-beta\ngroup g(unknown:groupprivate)[Group]\nservice a(unknown:private)[Fallback] in g'],
  ])('%s fallback icons retain the actual positioned text object and measurement', (family, source) => {
    const { scene, positioned } = lower(source, {}, text => ['PR', 'P', 'G'].includes(text) ? 91 : text.length * 8)
    const blocks = family === 'flowchart' ? (positioned as PositionedGraph).nodes.map(node => node.iconFallbackBlock)
      : family === 'mindmap' ? (positioned as PositionedMindmapDiagram).nodes.map(node => node.iconFallbackBlock)
        : [...(positioned as PositionedArchitectureDiagram).services.map(service => service.iconFallbackBlock), ...(positioned as PositionedArchitectureDiagram).groups.map(group => group.iconFallbackBlock)]
    const retained = blocks.filter(block => block !== undefined)
    expect(retained).toHaveLength(family === 'architecture' ? 2 : 1)
    const text = leaves(scene).filter(node => node.kind === 'text' && node.role === 'icon')
    expect(text).toHaveLength(retained.length)
    for (const block of retained) {
      const painted = text.find(node => node.kind === 'text' && node.block === block)
      expect(painted?.kind).toBe('text')
      if (painted?.kind !== 'text') throw new Error('icon did not consume its positioned block')
      expect(painted.block).toBe(block)
      expect(painted.block!.width).toBe(91)
      expect(painted.text).toBe(block.prepared.source)
      expect(painted.fontSize).toBe(block.fontSize)
    }
  })

  test('Pie hover-only emphasis retains its future foreground ink bounds', () => {
    const { scene } = lower('---\nconfig:\n  pie:\n    highlightSlice: hover\n---\npie\n"Alpha": 4\n"Beta": 6', { interactive: false })
    const hit = leaves(scene).find(node => node.kind === 'shape' && node.conditionalPaint)
    expect(hit?.kind).toBe('shape')
    if (hit?.kind !== 'shape') throw new Error('missing conditional Pie emphasis')
    expect(hit.paint.fill).toBe('transparent')
    expect(hit.conditionalPaint).toMatchObject({ fill: 'transparent', stroke: 'var(--fg)' })
    const geometry = nodeWorldBounds(hit)!, ink = nodePaintBounds(hit)!
    expect(ink.x0).toBeLessThan(geometry.x0)
    expect(ink.x1).toBeGreaterThan(geometry.x1)
    expect(inspectScenePrimitives(scene).primitives.find(primitive => primitive.id === hit.id)).toMatchObject({ visibility: 'conditional', coverage: 'measured', bounds: ink })
    expect(leaves(scene).some(node => node.kind === 'text' && node.id.endsWith(':body:text'))).toBe(false)
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

  test.each([
    ['annotation', 'classDiagram\nclass A <<interface>>', 'annotationBlock'],
    ['abstract member', 'classDiagram\nclass A {\n+run()*\n}', 'methodBlocks'],
  ] as const)('Class %s uses its actual italic metrics before placement', (_name, source, field) => {
    const { scene, positioned } = lower(source, {}, (text, fontStyle) => fontStyle === 'italic' ? 320 : text.length * 2)
    const cls = (positioned as PositionedClassDiagram).classes[0]!
    const block = field === 'annotationBlock' ? cls.annotationBlock! : cls.methodBlocks![0]!
    expect(block.lineBlocks[0]!.runs.every(run => run.italic)).toBe(true)
    expect(block.width).toBe(320)
    expect(cls.width).toBeGreaterThan(block.width)
    expect(leaves(scene).some(node => node.kind === 'text' && node.block === block)).toBe(true)
    expect(sceneFidelityProblems(scene)).toEqual([])
  })
})
