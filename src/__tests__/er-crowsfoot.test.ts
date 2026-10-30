/**
 * Crow's-foot glyph correction (bundled in plan §ER 6).
 *
 * Upstream reference (mermaid erMarkers.js, verified 2026-07):
 *   ONLY_ONE      = two ticks
 *   ZERO_OR_ONE   = one tick + circle
 *   ONE_OR_MORE   = crow's foot (3 fan lines) + one tick
 *   ZERO_OR_MORE  = crow's foot + circle (no tick)
 *
 * The shipped renderer drew ZERO_OR_ONE with TWO ticks (indistinguishable
 * from "exactly one" plus a circle) and ONE_OR_MORE with no tick
 * (indistinguishable from a bare "many"). These invariants judge the
 * regenerated goldens (P5): each cardinality's marker is asserted by its
 * exact primitive counts in the scene geometry; the four expected signatures
 * (2L0C, 1L1C, 4L0C, 3L1C) are pairwise distinct by construction.
 */
import { describe, it, expect } from 'bun:test'
import { createRequire } from 'node:module'
import { parseErDiagram } from '../er/parser.ts'
import { layoutErDiagram } from '../er/layout.ts'
import { lowerErScene } from '../er/renderer.ts'
import { toMermaidLines } from '../mermaid-source.ts'
import { parseRegisteredMermaid, serializeMermaid, mutate, renderMermaidSVG, renderMermaidASCII } from '../agent/core.ts'
import { renderMermaidSVGWithReceipt } from '../index.ts'
import { resolveRenderRequestForExecution, resolvedFamilyRenderContextOf } from '../render-contract.ts'
import { positionResolvedFamily } from '../positioning.ts'
import { lowerPositionedFamilyScene } from '../graphical-render.ts'
import { DefaultBackend } from '../scene/backend.ts'
import { visitSceneNodes } from '../scene/walk.ts'
import type { SceneDoc, ShapeMark } from '../scene/ir.ts'
import { drawNative } from '../scene/native-drawing.ts'
import { inspectScenePrimitives } from '../scene/inspection.ts'
import { nativeDrawingOf } from '../scene/drawing.ts'

const { JSDOM } = createRequire(import.meta.url)('jsdom')

function firstMarker(scene: SceneDoc): ShapeMark {
  let marker: ShapeMark | undefined
  visitSceneNodes(scene.parts, node => {
    if (!marker && node.kind === 'shape' && node.role === 'cardinality' && node.id.endsWith(':1')) marker = node
  })
  if (!marker) throw new Error('marker not found')
  return marker
}

/** Expected local ink in (distance from endpoint toward shaft, perpendicular).
 * These literal signatures express the authored ER vocabulary, independently
 * of the renderer's geometry helper and retained Scene compounds. */
const glyphs = {
  one: { lines: [[4, -6, 4, 6], [8, -6, 8, 6]], circles: [] },
  'zero-one': { lines: [[4, -6, 4, 6]], circles: [[12, 0, 4]] },
  many: { lines: [[4, -7, 16, 0], [4, 0, 16, 0], [4, 7, 16, 0], [20, -6, 20, 6]], circles: [] },
  'zero-many': { lines: [[4, -7, 16, 0], [4, 0, 16, 0], [4, 7, 16, 0]], circles: [[20, 0, 4]] },
} as const

function expectOwnedGlyph(group: Element, carrier: Element, end: 'start' | 'end', kind: keyof typeof glyphs | 'parent'): void {
  const points = carrier.getAttribute('points')!.trim().split(/\s+/).map(pair => pair.split(',').map(Number))
  const [at, toward] = end === 'start' ? [points[0]!, points[1]!] : [points.at(-1)!, points.at(-2)!]
  const dx = toward[0]! - at[0]!, dy = toward[1]! - at[1]!, length = Math.hypot(dx, dy)
  expect(length).toBeGreaterThan(0)
  const local = (x: number, y: number) => [((x - at[0]!) * dx + (y - at[1]!) * dy) / length, (-(x - at[0]!) * dy + (y - at[1]!) * dx) / length]
  const number = (element: Element, name: string) => Number(element.getAttribute(name))
  const close = (actual: number[], expected: readonly number[]) => {
    expect(actual).toHaveLength(expected.length)
    actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, 6))
  }
  const children = [...group.children]
  expect(children.every(child => child.closest('[data-role="cardinality"]') === group)).toBe(true)
  expect(group.querySelectorAll('[data-id]')).toHaveLength(0)
  if (kind === 'parent') {
    expect(children.map(child => child.localName)).toEqual(['polygon'])
    const vertices = children[0]!.getAttribute('points')!.split(/\s+/).map(pair => {
      const [x, y] = pair.split(',').map(Number)
      return local(x!, y!)
    }).sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!)
    const expected = [[0, 0], [6, -4], [6, 4], [12, 0]]
    vertices.forEach((vertex, index) => close(vertex, expected[index]!))
    return
  }
  const expected = glyphs[kind]
  expect(children.map(child => child.localName)).toEqual([...expected.lines.map(() => 'line'), ...expected.circles.map(() => 'circle')])
  const lines = children.filter(child => child.localName === 'line').map(line => {
    const a = local(number(line, 'x1'), number(line, 'y1')), b = local(number(line, 'x2'), number(line, 'y2'))
    return a[0]! < b[0]! - .000001 || Math.abs(a[0]! - b[0]!) < .000001 && a[1]! < b[1]! ? [...a, ...b] : [...b, ...a]
  }).sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!)
  lines.forEach((line, index) => close(line, expected.lines[index]!))
  children.filter(child => child.localName === 'circle').forEach((circle, index) => close([...local(number(circle, 'cx'), number(circle, 'cy')), number(circle, 'r')], expected.circles[index]!))
}

/** Lower `A <glyphs> B : x` and return the marker geometry at entity1's end. */
function markerFor(glyphs: string): { lines: number; circles: number; category: string } {
  const lines = toMermaidLines(`erDiagram\nA ${glyphs} B : x`)
  const scene = lowerErScene({
    positioned: layoutErDiagram(parseErDiagram(lines)),
    colors: { bg: '#ffffff', fg: '#27272A' },
    resolved: { renderOptions: {} },
  })
  const mark = firstMarker(scene)
  if (mark.geometry.kind !== 'compound') throw new Error('marker not compound')
  const kinds = mark.geometry.children.map(g => g.kind)
  return {
    lines: kinds.filter(k => k === 'line').length,
    circles: kinds.filter(k => k === 'circle').length,
    category: String(mark.channels?.category),
  }
}

describe('crow\'s-foot marker vocabulary (upstream reference)', () => {
  it.each(['agentic', 'elk'] as const)('%s emits every endpoint piece inside its own relationship occurrence through Native and Scene', backend => {
    const source = `erDiagram
direction LR
A["Account ledger"]
B["Session window"]
A ||--o{ B : opens
A |o..|{ B : revokes
B }o--o| A : belongs
A u--|| A : retries`
    const authored = [
      ['A', 'B', 'opens', 'one', 'zero-many', 'rel:A-B#0'],
      ['A', 'B', 'revokes', 'zero-one', 'many', 'rel:A-B#1'],
      ['B', 'A', 'belongs', 'zero-many', 'zero-one', 'rel:B-A#0'],
      ['A', 'A', 'retries', 'parent', 'one', 'rel:A-A#0'],
    ] as const
    const options = { graphLayout: { backend, fallback: 'none' as const }, embedFontImport: false }
    const rendered = renderMermaidSVGWithReceipt(source, options)
    expect(rendered.receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: backend, attempts: [{ backend, outcome: 'selected' }] })])
    const request = resolveRenderRequestForExecution(source, options, 'svg')
    const layout = positionResolvedFamily('er', request)
    const scene = lowerPositionedFamilyScene(request, layout)
    const drawing = drawNative(nativeDrawingOf(lowerErScene)!, { positioned: layout.positioned, colors: request.appearance.colors, resolved: resolvedFamilyRenderContextOf(request) }, 'er')
    for (const paint of [drawing.paint, inspectScenePrimitives(scene)]) {
      const markers = paint.primitives.filter(primitive => primitive.role === 'cardinality')
      expect(markers).toHaveLength(authored.length * 2)
      for (const primitive of markers) {
        expect(primitive.owner).toEqual({ id: primitive.id, role: 'cardinality' })
        expect(primitive.ancestors.at(-1)).toEqual({ id: primitive.id, role: 'cardinality' })
      }
    }
    for (const svg of [rendered.svg, drawing.svg, DefaultBackend.render(scene, { seed: 0 })]) {
      const dom = new JSDOM(svg, { contentType: 'image/svg+xml' })
      try {
        const document = dom.window.document as Document
        const carriers = [...document.querySelectorAll('[data-role="relationship"][data-from]')]
        const markers = [...document.querySelectorAll('[data-role="cardinality"]')]
        expect(carriers).toHaveLength(authored.length)
        expect(markers).toHaveLength(authored.length * 2)
        const identities = [...document.querySelectorAll('[data-id]')].map(element => element.getAttribute('data-id'))
        expect(new Set(identities).size).toBe(identities.length)
        for (const [index, [from, to, label, startKind, endKind, edgeId]] of authored.entries()) {
          const carrier = carriers[index]!
          expect([carrier.getAttribute('data-from'), carrier.getAttribute('data-to'), carrier.getAttribute('data-label'), carrier.getAttribute('data-id')]).toEqual([from, to, label, edgeId])
          for (const [end, kind, suffix] of [['start', startKind, '1'], ['end', endKind, '2']] as const) {
            const id = `card:${edgeId.slice(4)}:${suffix}`
            const matching = markers.filter(marker => marker.getAttribute('data-id') === id)
            expect(matching).toHaveLength(1)
            const marker = matching[0]!
            expect(marker.localName).toBe('g')
            expect([marker.getAttribute('data-owner-id'), marker.getAttribute('data-owner-role'), marker.getAttribute('data-end'), marker.getAttribute('data-endpoint')]).toEqual([edgeId, 'relationship', end, end === 'start' ? from : to])
            expect(marker.hasAttribute('data-from') || marker.hasAttribute('data-to')).toBe(false)
            expectOwnedGlyph(marker, carrier, end, kind)
          }
        }
      } finally { dom.window.close() }
    }
  })

  it('keeps delimiter-bearing endpoint tuples independent of unrelated relationship insertion', () => {
    const first = '"A-B" ||--o{ C : first', other = 'A }|--o| "B-C" : other', second = '"A-B" ||--|| C : second'
    const observe = (relations: string[]) => {
      const dom = new JSDOM(renderMermaidSVG('erDiagram\n' + relations.join('\n')), { contentType: 'image/svg+xml' })
      try {
        return [...(dom.window.document as Document).querySelectorAll('[data-role="relationship"]')].map(carrier => [carrier.getAttribute('data-label'), carrier.getAttribute('data-id')])
      } finally { dom.window.close() }
    }
    const original = observe([first, second])
    const inserted = observe([first, other, second])
    expect(inserted.filter(([label]) => label !== 'other')).toEqual(original)
    expect(new Set(inserted.map(([, id]) => id)).size).toBe(3)
  })

  it('the parent endpoint remains distinct through parsing, editing, writing and both renderers', () => {
    const source = 'erDiagram\nPROJECT u--o{ TEAM_MEMBER : "parent"'
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok || parsed.value.body.kind !== 'er') throw new Error('Expected structured ER')
    expect(parsed.value.body.relations[0]).toMatchObject({ leftCard: 'parent', rightCard: 'zero-or-many' })
    const renamed = mutate(parsed.value, { kind: 'rename_entity', from: 'PROJECT', to: 'RELEASE' })
    if (!renamed.ok) throw new Error('rename failed')
    const written = serializeMermaid(renamed.value)
    const native = parseErDiagram(toMermaidLines(written))
    expect(native.relationships[0]).toMatchObject({ entity1: 'RELEASE', cardinality1: 'parent', cardinality2: 'zero-many' })
    const scene = lowerErScene({ positioned: layoutErDiagram(native), colors: { bg: '#ffffff', fg: '#27272A' }, resolved: { renderOptions: {} } })
    const marker = firstMarker(scene)
    if (marker.geometry.kind !== 'compound') throw new Error('Expected parent geometry')
    expect(marker.channels?.category).toBe('parent')
    expect(marker.geometry.children.map(piece => piece.kind)).toEqual(['polygon'])
    expect(renderMermaidSVG(written)).toContain('data-cardinality1="parent"')
    expect(renderMermaidASCII(written, { colorMode: 'none' })).toContain('◇')
    const added = mutate(renamed.value, { kind: 'add_relation', from: 'RELEASE', to: 'TEAM_MEMBER', leftCard: 'parent', rightCard: 'one-only', label: 'owns' })
    if (!added.ok) throw new Error('add parent relation failed')
    expect(parseErDiagram(toMermaidLines(serializeMermaid(added.value))).relationships[1]).toMatchObject({ cardinality1: 'parent', cardinality2: 'one' })
    expect(mutate(renamed.value, { kind: 'add_relation', from: 'RELEASE', to: 'TEAM_MEMBER', leftCard: 'one-only', rightCard: 'parent', label: 'invalid' } as never)).toMatchObject({ ok: false, error: { code: 'INVALID_OP' } })
    expect(parseErDiagram(toMermaidLines('erDiagram\nMenu'))!.entities[0]?.id).toBe('Menu')
    expect(() => parseErDiagram(toMermaidLines('erDiagram\nPROJECTu--o{ TEAM_MEMBER : x'))).toThrow()
  })

  it('|| (exactly one) draws two ticks, no circle', () => {
    expect(markerFor('||--|| ')).toEqual({ lines: 2, circles: 0, category: 'one' })
  })

  it('|o (zero or one) draws exactly one tick + one circle', () => {
    expect(markerFor('|o--o|')).toEqual({ lines: 1, circles: 1, category: 'zero-one' })
  })

  it('}| (one or more) draws the crow\'s foot + one tick', () => {
    expect(markerFor('}|--|{')).toEqual({ lines: 4, circles: 0, category: 'many' })
  })

  it('}o (zero or more) draws the crow\'s foot + circle, no tick', () => {
    expect(markerFor('}o--o{')).toEqual({ lines: 3, circles: 1, category: 'zero-many' })
  })
})
