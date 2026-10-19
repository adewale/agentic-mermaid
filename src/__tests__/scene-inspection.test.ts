import { expect, test } from 'bun:test'
import * as marks from '../scene/marks.ts'
import { inspectScenePrimitives } from '../scene/inspection.ts'
import { nodePaintBounds } from '../scene/bounds.ts'
import { sceneFidelityProblems } from '../scene/fidelity.ts'
import { validateSceneDoc } from '../scene/scene-validation.ts'
import { preparePixelText } from '../shared/prepared-text.ts'
import type { SceneDoc, SceneNode } from '../scene/ir.ts'

const scene = (parts: SceneNode[]): SceneDoc => ({ family: 'flowchart', transparent: false, width: 200, height: 100, colors: { bg: '#fff', fg: '#111' }, parts })

test('inspection preserves semantic subjects, paint order and exact layout text under affine artwork', () => {
  const block = preparePixelText('Hello', { fontSize: 12, fontWeight: 400 })
  const label = marks.text({ id: 'label', role: 'label', text: 'Hello', block, x: 10, y: 20, fontSize: 12, anchor: 'start', paint: { fill: '#111' } })
  const group = marks.group({ id: 'authored:A', role: 'node', open: '<g transform="translate(50 10) scale(2)">', close: '</g>', transform: { kind: 'matrix', a: 2, b: 0, c: 0, d: 2, e: 50, f: 10 }, children: [{ node: label, indent: 0 }] })
  const inspection = inspectScenePrimitives(scene([group]))
  expect(inspection.coverage).toEqual({ measured: 1, unmeasured: 0, nonPainting: 0, preparedText: 1, fallbackText: 0 })
  const primitive = inspection.primitives[0]!
  expect(primitive.owner).toEqual({ id: 'authored:A', role: 'node' })
  expect(primitive.bounds!.x0).toBe(70)
  expect(primitive.text).toMatchObject({ source: 'Hello', displayed: 'Hello', measurement: 'prepared' })
  expect(label.owner).toBeUndefined()
  expect(sceneFidelityProblems(scene([group]))).toEqual([])
})

test('opaque content, fallback metrics and conditional states remain explicit evidence', () => {
  const fallback = marks.text({ id: 'legacy', role: 'label', text: 'Legacy', x: 10, y: 20, fontSize: 12, anchor: 'start', paint: {} })
  const tooltip = marks.group({ id: 'tooltip', role: 'chrome', visibility: 'conditional', open: '<g>', close: '</g>', children: [{ node: fallback, indent: 0 }] })
  const inspection = inspectScenePrimitives(scene([marks.documentContent({ id: 'unknown', role: 'chrome' }, '<path d="M0 0 L20 20"/>'), tooltip]))
  expect(inspection.primitives[0]).toMatchObject({ coverage: 'unmeasured', reason: 'opaque-visible-content' })
  expect(inspection.primitives[1]).toMatchObject({ visibility: 'conditional', text: { measurement: 'fallback' } })
  expect(inspection.coverage.unmeasured).toBe(1)
  expect(inspection.coverage.fallbackText).toBe(1)
})

test('nested semantic groups retain their own subject and full ancestor chain', () => {
  const shape = marks.shape({ id: 'body', role: 'node', geometry: { kind: 'rect', x: 10, y: 10, width: 20, height: 20 }, paint: { fill: '#111' } })
  const child = marks.group({ id: 'inner', role: 'node', open: '<g>', close: '</g>', children: [{ node: shape, indent: 0 }] })
  const parent = marks.group({ id: 'outer', role: 'group', open: '<g>', close: '</g>', children: [{ node: child, indent: 0 }] })
  const primitive = inspectScenePrimitives(scene([parent])).primitives[0]!
  expect(primitive.owner).toEqual({ id: 'inner', role: 'node' })
  expect(primitive.ancestors).toEqual([{ id: 'outer', role: 'group' }, { id: 'inner', role: 'node' }])
})

test('admission rejects false non-painting and prepared-text claims', () => {
  const visible = marks.documentContent({ id: 'false-metadata', role: 'chrome', nonPaint: 'accessibility' }, '<rect x="0" y="0" width="10" height="10"/>')
  expect(validateSceneDoc(scene([visible]), { mode: 'internal' }).diagnostics.some(d => d.path.endsWith('.nonPaint'))).toBe(true)
  const text = marks.text({ id: 'missing', role: 'label', text: 'Lost', x: 10, y: 20, fontSize: 12, anchor: 'start', paint: {} })
  const missing = validateSceneDoc(scene([{ ...text, measurement: 'prepared', block: undefined }]), { mode: 'internal' })
  expect(missing.diagnostics).toContainEqual(expect.objectContaining({ code: 'SCENE_DOCUMENT', path: 'scene.parts[0].block' }))
  const forged = preparePixelText('Forged', { fontSize: 12, fontWeight: 400 })
  const sourceOnly = { ...text, block: { ...text.block!, prepared: { ...text.block!.prepared, source: 'Forged' } } }
  expect(validateSceneDoc(scene([sourceOnly]), { mode: 'internal' }).diagnostics).toContainEqual(expect.objectContaining({ code: 'SCENE_FIDELITY', path: 'scene.parts[0].block' }))

  expect(() => marks.text({ id: 'mismatch', role: 'label', text: 'Forged', block: forged, x: 10, y: 20, fontSize: 13, anchor: 'start', paint: {} })).toThrow('retained prepared block')
})

test('transparent hit targets paint nothing, and singular composed transforms supply no paint or hit evidence', () => {
  const target = marks.shape({ id: 'hit', role: 'chrome', geometry: { kind: 'rect', x: 0, y: 0, width: 100, height: 80 }, paint: { fill: 'transparent' } })
  expect(inspectScenePrimitives(scene([target])).primitives[0]?.coverage).toBe('non-painting')
})


test('overflowing current and conditional strokes remain unmeasured', () => {
  const polygon = marks.shape({ id: 'overflow', role: 'node', geometry: { kind: 'polygon', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] }, paint: { stroke: '#000', strokeWidth: '1e308', strokeLinejoin: 'miter', strokeMiterlimit: '4' } })
  const conditional = marks.shape({ id: 'alternate', role: 'chrome', visibility: 'conditional', transform: { kind: 'matrix', a: 10, b: 0, c: 0, d: 10, e: 0, f: 0 }, geometry: { kind: 'rect', x: 0, y: 0, width: 10, height: 10 }, paint: { fill: 'transparent' }, conditionalPaint: { stroke: '#000', strokeWidth: '1e308' } })
  for (const node of [polygon, conditional]) {
    expect(nodePaintBounds(node)).toBeUndefined()
    expect(inspectScenePrimitives(scene([node])).primitives[0]?.coverage).toBe('unmeasured')
  }
})


test('inline connector labels expose their actual retained text, owner, order and final bounds', () => {
  const block = preparePixelText('Read', { fontSize: 12, fontWeight: 400 })
  const edge = marks.connector({ id: 'relationship', role: 'edge', lineStyle: 'solid', geometry: { kind: 'line', x1: 5, y1: 5, x2: 95, y2: 5 }, paint: { stroke: '#111' }, labels: [{ id: 'inline-label', text: 'Read', block, anchor: { x: 20, y: 30 }, paint: { fill: '#111' }, fontSize: 12, fontWeight: 400, textAnchor: 'start', visual: { kind: 'inline' } }] })
  const primitive = inspectScenePrimitives(scene([edge])).primitives[1]!
  expect(primitive).toMatchObject({ id: 'inline-label', kind: 'text', owner: { id: 'relationship', role: 'edge' }, order: 1, coverage: 'measured', text: { source: 'Read', measurement: 'prepared' } })
  expect(primitive.bounds?.x0).toBe(20)
  expect(primitive.bounds?.x1).toBe(20 + block.width)
})


test.each(['transparent', 'rgba(0,0,0,0)', '#00000000'])('invisible %s strokes cannot enlarge visible paint', stroke => {
  const node = marks.shape({ id: 'filled', role: 'node', geometry: { kind: 'rect', x: 0, y: 0, width: 10, height: 20 }, paint: { fill: '#fff', stroke, strokeWidth: '1000' } })
  expect(nodePaintBounds(node)).toEqual({ x0: 0, y0: 0, x1: 10, y1: 20 })
})


test.each([
  ['visible', 'invisible', '#111', undefined, 'measured'],
  ['no-fill', 'solid', 'none', undefined, 'non-painting'],
  ['alpha-zero', 'solid', 'rgba(0,0,0,0)', undefined, 'non-painting'],
  ['opacity-zero', 'solid', '#111', '0', 'non-painting'],
] as const)('inline %s text visibility is independent of its route', (_name, lineStyle, fill, opacity, coverage) => {
  const block = preparePixelText('Read', { fontSize: 12, fontWeight: 400 })
  const edge = marks.connector({ id: 'relationship', role: 'edge', lineStyle, geometry: { kind: 'line', x1: 5, y1: 5, x2: 95, y2: 5 }, paint: { stroke: '#111' }, labels: [{ id: 'inline-label', text: 'Read', block, anchor: { x: 20, y: 30 }, paint: { fill, opacity }, fontSize: 12, fontWeight: 400, textAnchor: 'start', visual: { kind: 'inline' } }] })
  const inspection = inspectScenePrimitives(scene([edge]))
  expect(inspection.primitives[1]).toMatchObject({ id: 'inline-label', coverage })
  expect(inspection.coverage.preparedText).toBe(coverage === 'measured' ? 1 : 0)
})
