import { describe, expect, test } from 'bun:test'
import { DefaultBackend, getFamily, validateSceneDoc } from '../agent/index.ts'
import { layoutErDiagram } from '../er/layout.ts'
import { parseErDiagram } from '../er/parser.ts'
import type { MarkPaint, SceneDoc, SceneNode, ShapeMark, TextMark } from '../scene/ir.ts'
import { scanSvgStartTags } from '../svg-structure.ts'

function fixture(): SceneDoc {
  const positioned = layoutErDiagram(parseErDiagram([
    'erDiagram', 'A {', 'int id PK', 'string name "authored comment"', '}', 'A ||--o{ B : owns',
  ]))
  return getFamily('er')!.lowerScene!({ positioned,
    colors: { bg: '#ffffff', fg: '#111111', embedFontImport: false }, resolved: { renderOptions: {} } })
}

function nodes(scene: SceneDoc): SceneNode[] {
  const walk = (node: SceneNode): SceneNode[] => [node, ...(node.kind === 'group' ? node.children.flatMap(child => walk(child.node)) : [])]
  return scene.parts.flatMap(walk)
}

// Literal public MarkPaint inputs and SVG observations. These are independent
// of the private emission vocabulary and match the existing native writer.
const paint: MarkPaint = {
  fill: '#123456', fillOpacity: '0.4', stroke: '#abcdef', strokeOpacity: '0.6', strokeWidth: '2',
  strokeDasharray: '4 2', strokeDashoffset: '1', strokeLinecap: 'round', strokeLinejoin: 'bevel',
  strokeMiterlimit: '3', vectorEffect: 'non-scaling-stroke', paintOrder: 'stroke fill', opacity: '0.5',
}
const expected = {
  fill: '#123456', 'fill-opacity': '0.4', stroke: '#abcdef', 'stroke-opacity': '0.6', 'stroke-width': '2',
  'stroke-dasharray': '4 2', 'stroke-dashoffset': '1', 'stroke-linecap': 'round', 'stroke-linejoin': 'bevel',
  'stroke-miterlimit': '3', 'vector-effect': 'non-scaling-stroke', 'paint-order': 'stroke fill', opacity: '0.5',
}

function attributes(node: SceneNode): Record<string, string> {
  const svg = DefaultBackend.drawNode(node, { seed: 0 })
  return Object.fromEntries(scanSvgStartTags(svg)[0]!.attributes.map(attribute => [attribute.name, attribute.value]))
}

describe('public ER Scene paint projection', () => {
  test('keeps the complete supported paint surface on rectangles, paths, lines and badges', () => {
    const scene = fixture()
    const selected = ['entity-rect:A', 'entity-header:A', 'entity-divider:A', 'attr:A:id:key-badge', 'rel-label:A-B#0:bg']
      .map(id => nodes(scene).find(node => node.id === id))
    expect(selected.every(node => node?.kind === 'shape')).toBe(true)
    for (const node of selected as ShapeMark[]) node.paint = { ...paint }
    expect(validateSceneDoc(scene).valid).toBe(true)
    for (const node of selected as ShapeMark[]) expect(attributes(node)).toMatchObject(expected)
    expect(() => DefaultBackend.render(scene, { seed: 0 })).not.toThrow()
    expect(Object.isFrozen(scene)).toBe(false)
  })

  test('keeps the complete supported paint surface on prepared name, type, key and comment text', () => {
    const scene = fixture()
    const selected = ['entity-name:A', 'entity-empty:B', 'attr:A:id:key-text', 'attr:A:id:type', 'attr:A:id', 'attr:A:name:comment']
      .map(id => nodes(scene).find(node => node.id === id))
    expect(selected.every(node => node?.kind === 'text')).toBe(true)
    for (const node of selected as TextMark[]) node.paint = { ...paint }
    expect(validateSceneDoc(scene).valid).toBe(true)
    for (const node of selected as TextMark[]) expect(attributes(node)).toMatchObject(expected)
    expect(() => DefaultBackend.render(scene, { seed: 0 })).not.toThrow()
  })

  test('projects accepted public transforms on shape and text marks', () => {
    const scene = fixture()
    const selected = ['entity-rect:A', 'entity-header:A', 'entity-divider:A', 'attr:A:id:key-badge', 'entity-name:A']
      .map(id => nodes(scene).find(node => node.id === id)!)
    for (const node of selected) node.transform = { kind: 'matrix', a: 1, b: 0, c: 0, d: 1, e: 2, f: 3 }
    expect(validateSceneDoc(scene).valid).toBe(true)
    for (const node of selected) expect(attributes(node).transform).toBe('matrix(1 0 0 1 2 3)')
    expect(() => DefaultBackend.render(scene, { seed: 0 })).not.toThrow()
  })

  test('keeps caller-authored inert hooks on native shape and text marks', () => {
    const scene = fixture()
    const selected = ['entity-rect:A', 'entity-name:A']
      .map(id => nodes(scene).find(node => node.id === id) as ShapeMark | TextMark)
    for (const node of selected) node.attributes = {
      className: 'caller-hook', data: { note: 'A & "B"' }, ariaHidden: true, tabIndex: 0, ariaLabel: 'caller label',
    }
    expect(validateSceneDoc(scene).valid).toBe(true)
    for (const node of selected) expect(attributes(node)).toMatchObject({
      class: 'caller-hook', 'data-note': 'A &amp; &quot;B&quot;', 'aria-hidden': 'true', tabindex: '0', 'aria-label': 'caller label',
    })
    expect(() => DefaultBackend.render(scene, { seed: 0 })).not.toThrow()
  })

  test('continues to reject unsafe public paint before rendering', () => {
    const scene = fixture()
    const shape = nodes(scene).find(node => node.id === 'entity-rect:A') as ShapeMark
    shape.paint.fill = 'url(https://example.com/external.svg#paint)'
    expect(validateSceneDoc(scene).valid).toBe(false)
    expect(() => DefaultBackend.render(scene, { seed: 0 })).toThrow()
    expect(Object.isFrozen(shape.paint)).toBe(false)
  })
})
