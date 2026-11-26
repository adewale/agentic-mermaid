import { describe, expect, test } from 'bun:test'

import { Resvg } from '@resvg/resvg-js'
import * as marks from '../scene/marks.ts'
import type { StyleBackend } from '../scene/backend.ts'
import { PAINT_MARGIN } from '../scene/paint-margin.ts'
import { HybridBackend } from '../scene/hybrid-backend.ts'
import { RoughBackend } from '../scene/rough-backend.ts'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'
import { renderMermaidSVG } from '../index.ts'
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

// Rasterized ink, read back by resvg rather than from the emitted path data.
// The view grows by `grow` user units on every side so ink past the original
// box is drawn, not clipped; the box is in the original user space.
function inkBox(svg: string, view: { x: number; y: number; w: number; h: number }, grow: number) {
  const scale = 2, open = svg.match(/<svg\b[^>]*>/)![0]
  const grown = svg.replace(open, open.replace(/\s(?:width|height|viewBox)="[^"]*"/g, '')
    .replace('<svg', `<svg width="${(view.w + 2 * grow) * scale}" height="${(view.h + 2 * grow) * scale}" viewBox="${view.x - grow} ${view.y - grow} ${view.w + 2 * grow} ${view.h + 2 * grow}"`))
    // The page backdrop and root background fill the canvas by design.
    .replace(/<rect\b[^>]*data-backdrop="page"[^>]*\/>/g, '')
  const { width, height, pixels } = new Resvg(grown, { font: { loadSystemFonts: false } }).render()
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (pixels[(y * width + x) * 4 + 3]! < 8) continue
    x0 = Math.min(x0, x / scale); y0 = Math.min(y0, y / scale); x1 = Math.max(x1, (x + 1) / scale); y1 = Math.max(y1, (y + 1) / scale)
  }
  return { x0: x0 + view.x - grow, y0: y0 + view.y - grow, x1: x1 + view.x - grow, y1: y1 + view.y - grow }
}

describe('paint margin', () => {
  // Bowing and jitter grow with a mark's size; on marks this large an
  // unbounded sketch strays well past the margin. A backend may draw a mark
  // it cannot sketch within the margin crisp.
  const strokeWidth = 2
  const large = [
    marks.shape({ id: 'wide', role: 'node', geometry: { kind: 'rect', x: 40, y: 40, width: 3000, height: 40 }, paint: { fill: 'none', stroke: '#000', strokeWidth: String(strokeWidth) } }),
    marks.shape({ id: 'round', role: 'node', geometry: { kind: 'circle', cx: 400, cy: 400, r: 360 }, paint: { fill: 'none', stroke: '#000', strokeWidth: String(strokeWidth) } }),
  ]
  const sketches: Array<[string, StyleBackend, { stroke: 'jittered' | 'freehand'; roughness: number; bowing: number; passes: number }]> = [
    ['rough', RoughBackend, { stroke: 'jittered', roughness: 1.25, bowing: 1.2, passes: 2 }],
    ['hybrid', HybridBackend, { stroke: 'freehand', roughness: 1.25, bowing: 1.2, passes: 2 }],
  ]
  test.each(sketches.flatMap(([name, backend, style]) => large.map(mark => ({ name, backend, style, mark }))))('a $name sketch of a large $mark.identity.id mark inks within the margin of its canonical paint', ({ backend, style, mark }) => {
    const geometry = mark.geometry as { kind: 'rect'; x: number; y: number; width: number; height: number } | { kind: 'circle'; cx: number; cy: number; r: number }
    const canonical = geometry.kind === 'rect'
      ? { x0: geometry.x, y0: geometry.y, x1: geometry.x + geometry.width, y1: geometry.y + geometry.height }
      : { x0: geometry.cx - geometry.r, y0: geometry.cy - geometry.r, x1: geometry.cx + geometry.r, y1: geometry.cy + geometry.r }
    const view = { x: 0, y: 0, w: canonical.x1 + 40, h: canonical.y1 + 40 }
    for (const seed of [1, 2, 3]) {
      const body = backend.drawNode(mark, { seed, style: { ...style, strokeWidth } })
      const ink = inkBox(`<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`, view, 40)
      // Sketch strokes may be up to twice the canonical width.
      const allowed = PAINT_MARGIN + strokeWidth * 2
      expect([canonical.x0 - ink.x0, canonical.y0 - ink.y0, ink.x1 - canonical.x1, ink.y1 - canonical.y1].every(stray => stray <= allowed)).toBe(true)
    }
  })

  // Layout reserves the margin, so no backend inks past the canvas, even when
  // the author asks for no canvas padding at all.
  const backends = [['default', undefined], ['rough', 'excalidraw'], ['hybrid', 'freehand']] as const
  test.each(BUILTIN_FAMILY_METADATA.flatMap(family => backends.flatMap(([backend, style]) => [undefined, 0].map(padding => ({ family: family.id, example: family.example, backend, style, padding })))))('$family example stays on its canvas under the $backend backend (padding $padding)', ({ example, style, padding }) => {
    const svg = renderMermaidSVG(example, { embedFontImport: false, ...(style ? { style } : {}), ...(padding === undefined ? {} : { padding }) })
    const [x, y, w, h] = svg.match(/<svg\b[^>]*\sviewBox="([^"]+)"/)![1]!.split(/[\s,]+/).map(Number)
    const ink = inkBox(svg, { x: x!, y: y!, w: w!, h: h! }, PAINT_MARGIN * 4)
    expect({ left: ink.x0 >= x!, top: ink.y0 >= y!, right: ink.x1 <= x! + w!, bottom: ink.y1 <= y! + h! }).toEqual({ left: true, top: true, right: true, bottom: true })
  })

  // Families that read a canvas margin from their own config keep the paint
  // margin too, however small the configured value.
  const configured: Array<[BuiltinFamilyId, string]> = [
    ['mindmap', 'mindmap:\n    padding: 0'],
    ['architecture', 'architecture:\n    padding: 0'],
    ['c4', 'c4:\n    diagramMarginX: 0\n    diagramMarginY: 0'],
  ]
  test.each(configured.flatMap(([family, config]) => backends.map(([backend, style]) => ({ family, config, backend, style }))))('$family with a zero configured margin stays on its canvas under the $backend backend', ({ family, config, style }) => {
    const source = `---\nconfig:\n  ${config}\n---\n${getFamily(family)!.example}`
    const svg = renderMermaidSVG(source, { embedFontImport: false, ...(style ? { style } : {}) })
    const [x, y, w, h] = svg.match(/<svg\b[^>]*\sviewBox="([^"]+)"/)![1]!.split(/[\s,]+/).map(Number)
    const ink = inkBox(svg, { x: x!, y: y!, w: w!, h: h! }, PAINT_MARGIN * 4)
    expect({ left: ink.x0 >= x!, top: ink.y0 >= y!, right: ink.x1 <= x! + w!, bottom: ink.y1 <= y! + h! }).toEqual({ left: true, top: true, right: true, bottom: true })
  })
})
