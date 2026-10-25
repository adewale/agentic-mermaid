import { expect, test } from 'bun:test'
import * as marks from '../scene/marks.ts'
import { createNativeSceneValidator, SCENE_VALIDATION_LIMITS, SceneValidationError } from '../scene/scene-validation.ts'
import { deferredTerminalProjectionInput, withDeferredTerminalProjections } from '../scene/deferred-terminal-projection.ts'
import { serializeLinearGradientResources } from '../scene/gradient-resources.ts'
import type { LinearGradientDescriptor, MarkerDescriptor, SceneDoc } from '../scene/ir.ts'

const header: Omit<SceneDoc, 'parts'> = { family: 'flowchart', width: 200, height: 100, colors: { bg: '#fff', fg: '#111' }, transparent: false }
const shape = (id = 'A') => marks.shape({ id, role: 'node', geometry: { kind: 'rect', x: 10, y: 10, width: 20, height: 20 }, paint: { fill: '#111' } })
const label = (text: string, id = 'label') => marks.text({ id, role: 'label', text, x: 10, y: 20, fontSize: 0.1, anchor: 'start', paint: { fill: '#111' } })

test('native admission resolves companion labels and owners submitted after connectors', () => {
  const validator = createNativeSceneValidator(header)
  validator.node(marks.connector({ id: 'edge', role: 'edge', lineStyle: 'solid', geometry: { kind: 'line', x1: 10, y1: 10, x2: 20, y2: 20 }, paint: { stroke: '#111' }, owner: { id: 'A', role: 'node' }, labels: [{ text: 'Hello', visual: { kind: 'companion', markId: 'label' } }] }))
  validator.node(label('Hello'))
  expect(validator.node(shape())).toContain('<rect ')
  const result = validator.finish()
  expect(result).toEqual({ valid: true, diagnostics: [] })
  expect(validator.finish()).toBe(result)
  expect(() => validator.node(shape('late'))).toThrow(/already finished/)

  const missing = createNativeSceneValidator(header)
  missing.node(marks.connector({ id: 'edge', role: 'edge', lineStyle: 'solid', geometry: { kind: 'line', x1: 10, y1: 10, x2: 20, y2: 20 }, paint: { stroke: '#111' }, owner: { id: 'missing-owner', role: 'node' }, labels: [{ text: 'Hello', visual: { kind: 'companion', markId: 'missing-label' } }] }))
  expect(missing.finish().diagnostics).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: 'SCENE_REFERENCE', path: expect.stringContaining('.owner') }),
    expect.objectContaining({ code: 'SCENE_REFERENCE', path: expect.stringContaining('.visual.markId') }),
  ]))
})

test('native owned artwork requires its reported matching semantic enclosure', () => {
  for (const enclosing of [undefined, 'A', 'B']) {
    const validator = createNativeSceneValidator(header)
    validator.node(marks.shape({ id: 'frame:A', role: 'node', identity: false, owner: { id: 'A', role: 'node' }, geometry: { kind: 'rect', x: 10, y: 10, width: 20, height: 20 }, paint: { fill: '#111' } }))
    validator.node(marks.group({ id: 'wrapper:A', role: 'node', open: '<g data-id="A">', close: '</g>', children: [] }))
    if (enclosing) validator.enclosure('frame:A', { id: enclosing, role: 'node' })
    const result = validator.finish()
    expect(result.valid).toBe(enclosing === 'A')
    if (enclosing !== 'A') expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'SCENE_FIDELITY', path: 'scene.parts[0].identity' }))
  }
})

test('native admission refuses invalid geometry, headers, depth and retained group trees immediately', () => {
  expect(() => createNativeSceneValidator({ ...header, width: Number.NaN })).toThrow(SceneValidationError)
  expect(() => createNativeSceneValidator({ ...header, colors: { ...header.colors, font: 'url(https://example.com/font)' } })).toThrow(SceneValidationError)
  const validator = createNativeSceneValidator(header)
  const invalid = shape()
  if (invalid.geometry.kind !== 'rect') throw new Error('Expected rect')
  invalid.geometry.width = Number.NaN
  expect(() => validator.node(invalid)).toThrow(SceneValidationError)
  expect(validator.finish().diagnostics).toContainEqual(expect.objectContaining({ code: 'SCENE_FINITE', path: 'scene.parts[0].geometry.width' }))
  expect(() => createNativeSceneValidator(header).depth(SCENE_VALIDATION_LIMITS.maxDepth + 1)).toThrow(SceneValidationError)
  expect(() => createNativeSceneValidator(header).node(shape(), -1)).toThrow(SceneValidationError)
  expect(() => createNativeSceneValidator(header).node(marks.group({ id: 'tree', role: 'group', open: '<g>', close: '</g>', children: [{ node: shape(), indent: 2 }] }))).toThrow(/shallow/)
})

test('native numeric admission retains field reads and ordered diagnostics at finite and extent boundaries', () => {
  const validator = createNativeSceneValidator(header)
  const node = shape()
  const reads: string[] = []
  const values = { x: Number.NaN, y: Infinity, width: -SCENE_VALIDATION_LIMITS.maxExtent - 1, height: SCENE_VALIDATION_LIMITS.maxExtent + 1, rx: -0, ry: 0 }
  for (const [field, value] of Object.entries(values)) {
    Object.defineProperty(node.geometry, field, { configurable: true, get() { reads.push(field); return value } })
  }
  expect(() => validator.node(node)).toThrow(SceneValidationError)
  expect(reads).toEqual(['x', 'y', 'width', 'height', 'rx', 'rx', 'ry', 'ry'])
  expect(validator.finish().diagnostics).toEqual([
    { code: 'SCENE_FINITE', path: 'scene.parts[0].geometry.x', message: 'must be a finite number' },
    { code: 'SCENE_FINITE', path: 'scene.parts[0].geometry.y', message: 'must be a finite number' },
    { code: 'SCENE_BOUNDS', path: 'scene.parts[0].geometry.width', message: 'must be non-negative' },
    { code: 'SCENE_BOUNDS', path: 'scene.parts[0].geometry.width', message: 'must not exceed 1000000 user units' },
    { code: 'SCENE_BOUNDS', path: 'scene.parts[0].geometry.height', message: 'must not exceed 1000000 user units' },
  ])
  const boundary = shape()
  if (boundary.geometry.kind !== 'rect') throw new Error('Expected rect')
  boundary.geometry.x = -SCENE_VALIDATION_LIMITS.maxExtent
  boundary.geometry.width = -0
  boundary.geometry.height = SCENE_VALIDATION_LIMITS.maxExtent
  const accepted = createNativeSceneValidator(header)
  accepted.node(boundary)
  expect(accepted.finish()).toEqual({ valid: true, diagnostics: [] })
  expect(Object.is(boundary.geometry.width, -0)).toBe(true)
})

test('native admission resolves local paint resources and refuses undeclared resources', () => {
  const gradient: LinearGradientDescriptor = { id: 'paint', units: 'userSpaceOnUse', x1: 0, y1: 0, x2: 20, y2: 0, stops: [{ offset: 0, color: '#111' }, { offset: 1, color: '#fff' }] }
  for (const declared of [false, true]) {
    const validator = createNativeSceneValidator(header)
    validator.node(marks.shape({ id: 'gradient', role: 'node', geometry: { kind: 'rect', x: 10, y: 10, width: 20, height: 20 }, paint: { fill: 'url(#paint)' } }))
    if (declared) validator.node(marks.definitions({ id: 'definitions', gradientResources: [gradient] }, `<defs>\n${serializeLinearGradientResources([gradient])}\n</defs>`))
    const result = validator.finish()
    expect(result.valid).toBe(declared)
    if (!declared) expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'SCENE_REFERENCE', path: 'scene.parts[0].paint.fill' }))
  }
})

test('native text and point budgets accumulate across transient leaves', () => {
  const text = createNativeSceneValidator(header)
  const textMark = Object.freeze(label('x'.repeat(40_000)))
  for (let index = 0; index < 50; index++) text.node(textMark)
  expect(() => text.node(textMark)).toThrow(/aggregate 2000000-byte/)

  const points = createNativeSceneValidator(header)
  const line = (id: string, count: number) => marks.shape({ id, role: 'chrome', geometry: { kind: 'polyline', points: Array.from({ length: count }, (_, index) => ({ x: index % 100, y: 10 })) }, paint: { stroke: '#111' } })
  points.node(line('first', 25_000))
  points.node(line('second', 25_000))
  expect(() => points.node(line('third', 2))).toThrow(/aggregate 50000-point/)
})

test('native line quotas count semantic endpoint and tangent visits, including reversed and zero-length lines', () => {
  for (const { x2, charge, failurePath } of [
    { x2: 20, charge: 8, failurePath: '.route.contours[0].endTangent' },
    { x2: 0, charge: 8, failurePath: '.route.contours[0].endTangent' },
    { x2: 10, charge: 4, failurePath: '.route.contours[0].end' },
  ]) {
    const validator = createNativeSceneValidator(header)
    const remaining = charge - 1
    validator.node(marks.shape({ id: 'budget', role: 'chrome',
      geometry: { kind: 'polyline', points: Array.from({ length: SCENE_VALIDATION_LIMITS.maxPoints - remaining }, () => ({ x: 0, y: 0 })) },
      paint: { stroke: '#111' } }))
    const edge = withDeferredTerminalProjections(() => marks.connector({ id: 'line', role: 'message', lineStyle: 'solid',
      geometry: { kind: 'line', x1: 10, y1: 10, x2, y2: 10 }, paint: { stroke: '#111' } }))
    expect(() => validator.node(edge)).toThrow(SceneValidationError)
    expect(validator.finish().diagnostics).toEqual([
      { code: 'SCENE_BOUNDS', path: `scene.parts[1]${failurePath}`, message: 'Scene points exceed the aggregate 50000-point limit' },
    ])
  }
})

test('native marker quotas preserve shared point arrays while charging each resource reference', () => {
  const arrowPoints = [{ x: 0, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 10 }]
  const filled: MarkerDescriptor = { id: 'filled', shape: 'arrow', size: { width: 10, height: 10 },
    ref: { x: 10, y: 5 }, orient: 'auto-start-reverse', geometry: { kind: 'polygon', points: arrowPoints }, paint: { fill: '#111' } }
  const open: MarkerDescriptor = { ...filled, id: 'open', shape: 'open-arrow',
    geometry: { kind: 'polyline', points: arrowPoints }, paint: { fill: 'none', stroke: '#111' } }
  const validator = createNativeSceneValidator(header)
  // Definitions charge five visits: two refs plus one shared three-point array.
  // The line charges eight more before its end-marker's repeated ref visit.
  validator.node(marks.shape({ id: 'budget', role: 'chrome',
    geometry: { kind: 'polyline', points: Array.from({ length: SCENE_VALIDATION_LIMITS.maxPoints - 13 }, () => ({ x: 0, y: 0 })) },
    paint: { stroke: '#111' } }))
  validator.node(marks.definitions({ id: 'resources', markerResources: [filled, open] }, '<defs/>'))
  const edge = withDeferredTerminalProjections(() => marks.connector({ id: 'line', role: 'message', lineStyle: 'solid',
    geometry: { kind: 'line', x1: 10, y1: 10, x2: 20, y2: 10 }, paint: { stroke: '#111' }, markers: { end: filled } }))
  expect(() => validator.node(edge)).toThrow(SceneValidationError)
  expect(validator.finish().diagnostics).toEqual([
    { code: 'SCENE_BOUNDS', path: 'scene.parts[2].markers.end.ref', message: 'Scene points exceed the aggregate 50000-point limit' },
  ])
})

test('native admission enforces per-fragment and aggregate serialization limits', () => {
  expect(() => createNativeSceneValidator(header).serialization('x'.repeat(SCENE_VALIDATION_LIMITS.maxSerializationBytesPerNode + 1))).toThrow(/oversized SVG serialization/)
  const validator = createNativeSceneValidator(header)
  const chunk = `<metadata>${'x'.repeat(4_100_000)}</metadata>`
  for (let index = 0; index < 3; index++) validator.node(marks.documentContent({ id: `metadata:${index}`, role: 'chrome' }, chunk))
  expect(() => validator.node(marks.documentContent({ id: 'metadata:over', role: 'chrome' }, chunk))).toThrow(/aggregate 16000000-byte/)
})

test('native admission bounds total node count even when each leaf is tiny', () => {
  const validator = createNativeSceneValidator(header)
  const node = marks.documentClose()
  for (let index = 0; index < SCENE_VALIDATION_LIMITS.maxNodes; index++) validator.node(node)
  expect(() => validator.node(node)).toThrow(/too many Scene nodes/)
})


test('native transient connector validation leaves its registered derived projection unevaluated', () => {
  const edge = () => withDeferredTerminalProjections(() => marks.connector({ id: 'edge', role: 'edge', lineStyle: 'solid', geometry: { kind: 'line', x1: 10, y1: 10, x2: 20, y2: 20 }, paint: { stroke: '#111' } }))
  for (const crossChecks of [false, true]) {
    const node = edge()
    expect(deferredTerminalProjectionInput(node)).toBeDefined()
    const validator = createNativeSceneValidator(header, { crossChecks })
    validator.node(node)
    expect(validator.finish().valid).toBe(true)
    expect(deferredTerminalProjectionInput(node) !== undefined).toBe(!crossChecks)
  }
  const invalid = edge()
  invalid.route.bendRadius = Number.NaN
  expect(() => createNativeSceneValidator(header).node(invalid)).toThrow(SceneValidationError)
  expect(deferredTerminalProjectionInput(invalid)).toBeDefined()
})


test('native resource limits accumulate across otherwise admissible definitions', () => {
  const validator = createNativeSceneValidator(header)
  const definition = (start: number, count: number) => {
    const gradientResources: LinearGradientDescriptor[] = Array.from({ length: count }, (_, index) => ({ id: `g${start + index}`, units: 'userSpaceOnUse', x1: 0, y1: 0, x2: 20, y2: 0, stops: [{ offset: 0, color: '#111' }, { offset: 1, color: '#fff' }] }))
    return marks.definitions({ id: `definitions:${start}`, gradientResources }, `<defs>\n${serializeLinearGradientResources(gradientResources)}\n</defs>`)
  }
  validator.node(definition(0, 5_000))
  validator.node(definition(5_000, 5_000))
  expect(() => validator.node(definition(10_000, 1))).toThrow(/10000 aggregate gradient resources/)
})
