import { expect, test } from 'bun:test'
import * as marks from '../scene/marks.ts'
import { inspectScenePrimitives } from '../scene/inspection.ts'
import { sceneFidelityProblems } from '../scene/fidelity.ts'
import { validateSceneDoc } from '../scene/scene-validation.ts'
import { preparePixelText } from '../shared/prepared-text.ts'
import type { SceneDoc, SceneNode } from '../scene/ir.ts'

const scene = (parts: SceneNode[]): SceneDoc => ({ family: 'flowchart', transparent: false, width: 200, height: 100, colors: { bg: '#fff', fg: '#111' }, parts })

test('inspection preserves semantic subjects, paint order and exact layout text under affine artwork', () => {
  const block = preparePixelText('Hello', { fontSize: 12, fontWeight: 400 })
  const label = marks.text({ id: 'label', role: 'label', text: 'Hello', block, x: 10, y: 20, fontSize: 12, anchor: 'start', paint: { fill: '#111' } }, '<text x="10" y="20" font-size="12">Hello</text>')
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
  const fallback = marks.text({ id: 'legacy', role: 'label', text: 'Legacy', x: 10, y: 20, fontSize: 12, anchor: 'start', paint: {} }, '<text x="10" y="20" font-size="12">Legacy</text>')
  const tooltip = marks.group({ id: 'tooltip', role: 'chrome', visibility: 'conditional', open: '<g>', close: '</g>', children: [{ node: fallback, indent: 0 }] })
  const inspection = inspectScenePrimitives(scene([marks.documentContent({ id: 'unknown', role: 'chrome' }, '<path d="M0 0 L20 20"/>'), tooltip]))
  expect(inspection.primitives[0]).toMatchObject({ coverage: 'unmeasured', reason: 'opaque-visible-content' })
  expect(inspection.primitives[1]).toMatchObject({ visibility: 'conditional', text: { measurement: 'fallback' } })
  expect(inspection.coverage.unmeasured).toBe(1)
  expect(inspection.coverage.fallbackText).toBe(1)
})

test('nested semantic groups retain their own subject and full ancestor chain', () => {
  const shape = marks.shape({ id: 'body', role: 'node', geometry: { kind: 'rect', x: 10, y: 10, width: 20, height: 20 }, paint: { fill: '#111' } }, '<rect x="10" y="10" width="20" height="20" fill="#111"/>')
  const child = marks.group({ id: 'inner', role: 'node', open: '<g>', close: '</g>', children: [{ node: shape, indent: 0 }] })
  const parent = marks.group({ id: 'outer', role: 'group', open: '<g>', close: '</g>', children: [{ node: child, indent: 0 }] })
  const primitive = inspectScenePrimitives(scene([parent])).primitives[0]!
  expect(primitive.owner).toEqual({ id: 'inner', role: 'node' })
  expect(primitive.ancestors).toEqual([{ id: 'outer', role: 'group' }, { id: 'inner', role: 'node' }])
})

test('admission rejects false non-painting and prepared-text claims', () => {
  const visible = marks.documentContent({ id: 'false-metadata', role: 'chrome', nonPaint: 'accessibility' }, '<rect x="0" y="0" width="10" height="10"/>')
  expect(validateSceneDoc(scene([visible]), { mode: 'internal' }).diagnostics.some(d => d.path.endsWith('.nonPaint'))).toBe(true)
  const text = marks.text({ id: 'missing', role: 'label', text: 'Lost', x: 10, y: 20, fontSize: 12, anchor: 'start', paint: {} }, '<text x="10" y="20" font-size="12">Lost</text>')
  expect(validateSceneDoc(scene([{ ...text, measurement: 'prepared', block: undefined }]), { mode: 'internal' }).valid).toBe(false)
  const forged = preparePixelText('Forged', { fontSize: 1, fontWeight: 900 })
  const falsePlan = { ...text, measurement: 'prepared' as const, prepared: true as const, block: forged, textLayout: { ...text.textLayout!, width: forged.width, height: forged.height, lineHeight: forged.lineHeight } }
  expect(validateSceneDoc(scene([falsePlan]), { mode: 'internal' }).valid).toBe(false)
  expect(() => marks.text({ id: 'mismatch', role: 'label', text: 'Forged', block: forged, x: 10, y: 20, fontSize: 12, anchor: 'start', paint: {} }, '<text x="10" y="20" font-size="12">Forged</text>')).toThrow('retained prepared block')
})

test('transparent hit targets paint nothing, and singular composed transforms supply no paint or hit evidence', () => {
  const target = marks.shape({ id: 'hit', role: 'chrome', geometry: { kind: 'rect', x: 0, y: 0, width: 100, height: 80 }, paint: { fill: 'transparent' } }, '<rect x="0" y="0" width="100" height="80" fill="transparent"/>')
  expect(inspectScenePrimitives(scene([target])).primitives[0]?.coverage).toBe('non-painting')
})
