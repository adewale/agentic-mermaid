import { describe, expect, test } from 'bun:test'
import { DefaultBackend, getFamily, validateSceneDoc } from '../agent/index.ts'
import { resolveRenderRequest, resolvedFamilyRenderContextOf } from '../render-contract.ts'
import { positionResolvedFamily } from '../positioning.ts'
import { scanSvgStartTags } from '../svg-structure.ts'
import type { SceneNode, ShapeMark } from '../scene/ir.ts'

function fixture(shapeSource: string) {
  const request = resolveRenderRequest(`flowchart LR\n${shapeSource}`, { embedFontImport: false }, 'svg')
  const family = getFamily('flowchart')!
  const layout = positionResolvedFamily('flowchart', request)
  const scene = family.lowerScene!({ positioned: layout.positioned, colors: request.appearance.colors,
    resolved: resolvedFamilyRenderContextOf(request) })
  let shape: ShapeMark | undefined
  const visit = (node: SceneNode): void => {
    if (node.kind === 'shape' && node.geometry.kind === 'compound') shape = node
    if (node.kind === 'group') for (const child of node.children) visit(child.node)
  }
  scene.parts.forEach(visit)
  if (!shape?.childPaints) throw new Error('Expected actual native compound child paints')
  return { scene, shape, paints: shape.childPaints }
}

describe('compound child paint compatibility', () => {
  test.each(['A[[Subroutine]]', 'A[(Database)]'])('%s uses complete child paint instead of parent defaults', source => {
    const { scene, shape, paints } = fixture(source)
    shape.paint.stroke = '#f00'
    shape.paint.strokeWidth = '9'
    delete paints[1]!.stroke
    delete paints[1]!.strokeWidth
    expect(validateSceneDoc(scene).valid).toBe(true)
    const svg = DefaultBackend.render(scene, { seed: 0 })
    const lines = scanSvgStartTags(svg).filter(tag => tag.name === 'line')
    expect(lines).toHaveLength(2)
    const first = new Map(lines[0]!.attributes.map(attribute => [attribute.name, attribute.value]))
    const second = new Map(lines[1]!.attributes.map(attribute => [attribute.name, attribute.value]))
    expect(first.has('stroke')).toBe(false)
    expect(first.has('stroke-width')).toBe(false)
    expect(second.get('stroke')).toBe('var(--_node-stroke)')
    expect(second.get('stroke-width')).toBe('0.75')
    expect(Object.isFrozen(paints[1])).toBe(false)
  })

  test.each([
    ['A[[Subroutine]]', [0]],
    ['A[(Database)]', [3, 4]],
  ] as const)('%s keeps parent and child surface paints independent', (source, indices) => {
    const { scene, shape, paints } = fixture(source)
    for (const index of indices) expect(paints[index]).not.toBe(shape.paint)
    if (indices.length === 2) expect(paints[indices[0]!]).not.toBe(paints[indices[1]!])
    shape.paint.strokeWidth = '9'
    for (const index of indices) expect(paints[index]!.strokeWidth).toBe('0.75')
    expect(validateSceneDoc(scene).valid).toBe(true)
    const svg = DefaultBackend.render(scene, { seed: 0 })
    const surfaces = scanSvgStartTags(svg).filter(tag => source.includes('Subroutine') ? tag.name === 'rect' : tag.name === 'ellipse')
    expect(surfaces).toHaveLength(indices.length)
    for (const surface of surfaces) {
      expect(new Map(surface.attributes.map(attribute => [attribute.name, attribute.value])).get('stroke-width')).toBe('0.75')
    }
  })
})
