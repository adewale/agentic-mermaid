import { describe, expect, test } from 'bun:test'

import { lowerClassScene } from '../class/renderer.ts'
import { renderMermaidSVG } from '../index.ts'
import type { MarkerDescriptor } from '../scene/ir.ts'

function markerResources(): readonly MarkerDescriptor[] {
  const scene = lowerClassScene({
    positioned: {
      width: 100,
      height: 100,
      classes: [],
      notes: [],
      namespaces: [],
      relationships: [],
    },
    colors: { bg: '#ffffff', fg: '#111111' },
    resolved: { renderOptions: {} },
  })
  const definitions = scene.parts.find(part => part.id === 'defs')
  if (definitions?.kind !== 'document' || !definitions.markerResources) {
    throw new Error('class Scene is missing typed marker resources')
  }
  return definitions.markerResources
}

function markerById(resources: readonly MarkerDescriptor[], id: string): MarkerDescriptor {
  const marker = resources.find(resource => resource.id === id)
  if (!marker) throw new Error(`missing marker ${id}`)
  return marker
}

function markerTag(svg: string, id: string): string {
  const tag = svg.match(new RegExp(`<marker id="${id}"[^>]*>`))?.[0]
  if (!tag) throw new Error(`missing serialized marker ${id}`)
  return tag
}

describe('class endpoint marker geometry (#178)', () => {
  test('typed diamond and lollipop resources anchor their node-facing tip or tangent', () => {
    const resources = markerResources()
    const diamondPoints = [
      { x: 7, y: 1 },
      { x: 13, y: 6 },
      { x: 7, y: 11 },
      { x: 1, y: 6 },
    ]

    for (const id of ['cls-composition', 'cls-aggregation']) {
      expect(markerById(resources, id)).toMatchObject({
        size: { width: 14, height: 12 },
        viewBox: { x: 0, y: 0, width: 14, height: 12 },
        ref: { x: 13, y: 6 },
        orient: 'auto-start-reverse',
        overflow: 'hidden',
        geometry: { kind: 'polygon', points: diamondPoints },
      })
    }

    const lollipop = markerById(resources, 'cls-lollipop')
    expect(lollipop).toMatchObject({
      size: { width: 14, height: 14 },
      viewBox: { x: 0, y: 0, width: 14, height: 14 },
      ref: { x: 12, y: 7 },
      orient: 'auto-start-reverse',
      overflow: 'hidden',
      geometry: { kind: 'circle', cx: 7, cy: 7, r: 5 },
    })
    if (lollipop.geometry?.kind !== 'circle' || !lollipop.ref) {
      throw new Error('lollipop marker must have circle geometry and a reference point')
    }
    expect(lollipop.geometry.cx + lollipop.geometry.r).toBe(lollipop.ref.x)
  })

  test('already-correct triangle and open-arrow tip anchors stay unchanged', () => {
    const resources = markerResources()
    expect(markerById(resources, 'cls-inherit')).toMatchObject({
      ref: { x: 12, y: 5 },
      orient: 'auto-start-reverse',
      geometry: {
        kind: 'polygon',
        points: [{ x: 0, y: 0 }, { x: 12, y: 5 }, { x: 0, y: 10 }],
      },
    })
    expect(markerById(resources, 'cls-arrow')).toMatchObject({
      ref: { x: 8, y: 3 },
      orient: 'auto-start-reverse',
      geometry: {
        kind: 'polyline',
        points: [{ x: 0, y: 0 }, { x: 8, y: 3 }, { x: 0, y: 6 }],
      },
    })
  })

  test('default and rough SVG serialize the same affected marker attachment contract', () => {
    const source = `classDiagram
      Whole *-- Part
      Team o-- Member
      Service ()-- Port`
    const outputs = [
      renderMermaidSVG(source),
      renderMermaidSVG(source, { style: 'hand-drawn', seed: 7 }),
    ]

    for (const svg of outputs) {
      for (const id of ['cls-composition', 'cls-aggregation']) {
        expect(markerTag(svg, id)).toContain('refX="13"')
        expect(markerTag(svg, id)).toContain('refY="6"')
        expect(markerTag(svg, id)).toContain('orient="auto-start-reverse"')
      }
      expect(markerTag(svg, 'cls-lollipop')).toContain('refX="12"')
      expect(markerTag(svg, 'cls-lollipop')).toContain('refY="7"')
      expect(markerTag(svg, 'cls-lollipop')).toContain('orient="auto-start-reverse"')
      expect(svg).toContain('<circle cx="7" cy="7" r="5"')
    }
  })

  const directions = ['TB', 'BT', 'LR', 'RL'] as const
  const relationships = [
    { syntax: '*--', id: 'cls-composition', side: 'start' },
    { syntax: '--*', id: 'cls-composition', side: 'end' },
    { syntax: 'o--', id: 'cls-aggregation', side: 'start' },
    { syntax: '--o', id: 'cls-aggregation', side: 'end' },
    { syntax: '()--', id: 'cls-lollipop', side: 'start' },
    { syntax: '--()', id: 'cls-lollipop', side: 'end' },
  ] as const

  for (const direction of directions) {
    test(`${direction} preserves prefix and suffix marker placement`, () => {
      for (const relationship of relationships) {
        const svg = renderMermaidSVG(`classDiagram
          direction ${direction}
          A ${relationship.syntax} B`)
        expect(svg).toContain(`marker-${relationship.side}="url(#${relationship.id})"`)
        expect(markerTag(svg, relationship.id)).toContain(relationship.id === 'cls-lollipop' ? 'refX="12"' : 'refX="13"')
        expect(markerTag(svg, relationship.id)).toContain('orient="auto-start-reverse"')
      }
    })
  }
})
