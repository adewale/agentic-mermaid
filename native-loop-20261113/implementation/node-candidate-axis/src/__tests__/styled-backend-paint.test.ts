import { describe, expect, test } from 'bun:test'

import * as marks from '../scene/marks.ts'
import { RoughBackend } from '../scene/rough-backend.ts'
import { getFamily, type BuiltinFamilyId } from '../agent/families.ts'
import { positionResolvedFamily } from '../positioning.ts'
import { resolveRenderRequestForExecution } from '../render-contract.ts'
import { sceneNodeSerialization } from '../scene/serialization.ts'
import { visitSceneNodes } from '../scene/walk.ts'
import type { ShapeMark } from '../scene/ir.ts'
import '../index.ts'

describe('styled backend paint fallback', () => {
  test.each(['packet', 'kanban', 'requirement', 'block', 'ishikawa'] as const)('%s primary surfaces share their semantic container sketch treatment', (family: BuiltinFamilyId) => {
    const request = resolveRenderRequestForExecution(getFamily(family)!.example, { embedFontImport: false }, 'svg'),
      scene = getFamily(family)!.lowerScene!({ positioned: positionResolvedFamily(family, request).positioned, colors: request.appearance.colors, resolved: { renderOptions: request.renderOptions, styleFace: request.appearance.face, familyConfig: request.familyConfig, familyAppearance: request.appearance.family } }),
      surfaces: ShapeMark[] = []
    visitSceneNodes(scene.parts, node => {
      if (node.kind !== 'group' || (node.role !== 'node' && node.role !== 'group')) return
      const surface = node.children.find(child => child.node.kind === 'shape')?.node
      if (surface?.kind !== 'shape') return
      expect(surface.owner).toEqual({ id: node.identity!.id, role: node.role })
      expect(surface.role).toBe(node.role)
      expect(surface.identity).toBeUndefined()
      surfaces.push(surface)
    })
    expect(surfaces.length).toBeGreaterThan(0)
    for (const surface of surfaces) {
      const draw = (seed: number) => RoughBackend.drawNode(surface, { seed, style: { stroke: 'jittered', fill: 'hachure', strokeWidth: 1.5 } })
      expect(draw(17)).not.toBe(sceneNodeSerialization(surface))
      expect(draw(17)).toContain('<path')
      expect(draw(17)).toBe(draw(17))
      expect(draw(18)).not.toBe(draw(17))
      expect(draw(17)).not.toContain('data-id=')
    }
    visitSceneNodes(scene.parts, node => {
      if (node.kind === 'shape' && node.role === 'chrome') expect(RoughBackend.drawNode(node, { seed: 17, style: { stroke: 'jittered' } })).toBe(sceneNodeSerialization(node))
    })
  })

  test('uses semantic stroke paint for class-only connectors', () => {
    const connector = marks.connector({
      id: 'series-line',
      role: 'series',
      geometry: {
        kind: 'path',
        d: 'M 0 0 L 50 50',
        points: [
          { x: 0, y: 0 },
          { x: 50, y: 50 },
        ],
      },
      lineStyle: 'solid',
      paint: {
        stroke: '#ff0000',
        strokeWidth: '3',
      },
    })

    const svg = RoughBackend.drawNode(connector, {
      seed: 7,
      style: { stroke: 'jittered', strokeWidth: 1.5 },
    })

    expect(svg).toContain('stroke="#ff0000"')
    expect(svg).not.toContain('stroke="var(--_line)"')
    expect(svg).toContain('stroke-opacity="0"')
  })

  test('uses semantic fill paint for class-only fill shapes', () => {
    const bar = marks.shape({
      id: 'bar',
      role: 'bar',
      geometry: {
        kind: 'rect',
        x: 10,
        y: 10,
        width: 30,
        height: 20,
      },
      paint: {
        fill: '#00aa00',
      },
    })

    const svg = RoughBackend.drawNode(bar, {
      seed: 11,
      style: { stroke: 'jittered', fill: 'hachure', strokeWidth: 1.5 },
    })

    expect(svg).toContain('stroke="#00aa00"')
    expect(svg).not.toContain('class="xychart-bar"')
  })

})
