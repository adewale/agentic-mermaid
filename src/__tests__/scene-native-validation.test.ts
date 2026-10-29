import { expect, test } from 'bun:test'
import * as marks from '../scene/marks.ts'
import { createNativeSceneValidator, SCENE_VALIDATION_LIMITS, SceneValidationError } from '../scene/scene-validation.ts'
import { deferredTerminalProjectionInput, withDeferredTerminalProjections } from '../scene/deferred-terminal-projection.ts'
import { serializeLinearGradientResources } from '../scene/gradient-resources.ts'
import type { LinearGradientDescriptor, SceneDoc } from '../scene/ir.ts'
import { drawNative } from '../scene/native-drawing.ts'
import { certifyNativePaint } from '../scene/paint-certification.ts'
import { serializeMarkerResource, tipAnchoredArrow } from '../scene/marker-resources.ts'
import type { DrawingProducer } from '../scene/drawing.ts'
import { scanSvgStartTags } from '../svg-structure.ts'

const header: Omit<SceneDoc, 'parts'> = { family: 'flowchart', width: 200, height: 100, colors: { bg: '#fff', fg: '#111' }, transparent: false }
const shape = (id = 'A') => marks.shape({ id, role: 'node', geometry: { kind: 'rect', x: 10, y: 10, width: 20, height: 20 }, paint: { fill: '#111' } })
const label = (text: string, id = 'label') => marks.text({ id, role: 'label', text, x: 10, y: 20, fontSize: 0.1, anchor: 'start', paint: { fill: '#111' } })

test.each(['clear', 'covered', 'non-enumerable-paint', 'mutate-after-emission', 'getter-after-emission', 'same-object-two-writes'] as const)('native paint certifies actual emitted occurrences for %s', mode => {
  const marker = tipAnchoredArrow('occurrence-arrow', { width: 8, height: 5 }, 'end', { fill: '#000' }, 'userSpaceOnUse')
  const context = { positioned: { width: 200, height: 100 }, colors: header.colors, resolved: { renderOptions: {} } }
  const geometry = { kind: 'rect' as const, x: mode === 'clear' ? 90 : 40, y: 10, width: 35, height: 70 }
  let getterX = geometry.x
  if (mode === 'getter-after-emission') Object.defineProperty(geometry, 'x', { enumerable: true, configurable: true, get() { return getterX } })
  const paint = { fill: '#fff' }
  if (mode === 'non-enumerable-paint') Object.defineProperty(paint, 'fill', { value: '#fff', enumerable: false, writable: false, configurable: false })
  const fields = { id: 'cover', role: 'node' as const, geometry, paint }
  const producer: DrawingProducer = factory => {
    const open = factory.documentOpen({ id: 'root', width: 200, height: 100, colors: header.colors, transparent: false, font: 'Inter', hasMonoFont: false }, '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">')
    const definitions = factory.definitions({ id: 'markers' }, `<defs>${serializeMarkerResource(marker)}</defs>`)
    const edge = factory.connector({ id: 'edge', role: 'edge', lineStyle: 'solid', geometry: { kind: 'line', x1: 20, y1: 40, x2: 50, y2: 40 }, paint: { stroke: '#000' }, endpoints: { from: 'outside', to: 'cover' }, markers: { end: marker } })
    const first = factory.shape(fields)
    if (mode === 'mutate-after-emission' || mode === 'same-object-two-writes') geometry.x = 90
    if (mode === 'getter-after-emission') getterX = 90
    // Reuse the SAME fields and geometry objects. The first occurrence remains
    // the opaque rectangle already emitted at x40, even after another write.
    const parts = [open, definitions, edge, first]
    if (mode === 'same-object-two-writes') {
      fields.id = 'later'
      parts.push(factory.shape(fields))
    }
    parts.push(factory.documentClose())
    return { ...header, parts }
  }
  const drawing = drawNative(producer, context, 'flowchart')
  const rectangles = scanSvgStartTags(drawing.svg).filter(tag => tag.name === 'rect').map(tag => Object.fromEntries(tag.attributes.map(attribute => [attribute.name, attribute.value])))
  const first = rectangles.find(rectangle => rectangle['data-id'] === 'cover')!
  expect(first).toMatchObject({ x: mode === 'clear' ? '90' : '40', y: '10', width: '35', height: '70', fill: '#fff' })
  if (mode === 'same-object-two-writes') expect(rectangles.find(rectangle => rectangle['data-id'] === 'later')).toMatchObject({ x: '90' })
  // The literal user-space arrow fill occupies x42..50, y37.5..42.5.
  // It is entirely inside the EMITTED x40..75 opaque first rectangle in
  // every non-clear case. Later aliases cannot make those pixels visible.
  const proof = certifyNativePaint(drawing.header, drawing.paint)
  if (mode === 'clear') expect(proof.status).toBe('passed')
  else expect(proof.status).not.toBe('passed')
})

test.each(['after-connector', 'before-connector'] as const)('native marker paint retains actual resource bytes when its descriptor changes %s', when => {
  const marker = tipAnchoredArrow('resource-arrow', { width: 8, height: 5 }, 'end', { fill: '#000' }, 'userSpaceOnUse')
  const context = { positioned: { width: 200, height: 100 }, colors: header.colors, resolved: { renderOptions: {} } }
  const producer: DrawingProducer = factory => {
    const open = factory.documentOpen({ id: 'root', width: 200, height: 100, colors: header.colors, transparent: false, font: 'Inter', hasMonoFont: false }, '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">')
    const definitions = factory.definitions({ id: 'markers' }, `<defs>${serializeMarkerResource(marker)}</defs>`)
    if (when === 'before-connector') marker.paint!.fill = 'none'
    const edge = factory.connector({ id: 'edge', role: 'edge', lineStyle: 'solid', geometry: { kind: 'line', x1: 20, y1: 40, x2: 50, y2: 40 }, paint: { stroke: '#000' }, endpoints: { from: 'outside', to: 'cover' }, markers: { end: marker } })
    if (when === 'after-connector') marker.paint!.fill = 'none'
    return { ...header, parts: [open, definitions, edge,
      factory.shape({ id: 'cover', role: 'node', geometry: { kind: 'rect', x: 40, y: 10, width: 35, height: 70 }, paint: { fill: '#fff' } }),
      factory.documentClose(),
    ] }
  }
  const drawing = drawNative(producer, context, 'flowchart')
  const tags = scanSvgStartTags(drawing.svg)
  const polygon = tags.find(tag => tag.name === 'polygon')!
  expect(Object.fromEntries(polygon.attributes.map(attribute => [attribute.name, attribute.value]))).toMatchObject({ points: '0 0, 8 2.5, 0 5', fill: '#000' })
  expect(drawing.svg).toContain('marker-end="url(#resource-arrow)"')
  // The emitted resource remains opaque. Its later descriptor cannot make
  // the fully covered actual arrow disappear from the proof obligation.
  expect(certifyNativePaint(drawing.header, drawing.paint).status).not.toBe('passed')
})

test('native emitted group ownership is retained or refused after owner mutation', () => {
  const owner = { id: 'cover', role: 'node' as const }
  const context = { positioned: { width: 200, height: 100 }, colors: header.colors, resolved: { renderOptions: {} } }
  const producer: DrawingProducer = factory => {
    const open = factory.documentOpen({ id: 'root', width: 200, height: 100, colors: header.colors, transparent: false, font: 'Inter', hasMonoFont: false }, '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">')
    const artwork = factory.shape({ id: 'cover-artwork', role: 'node', identity: false, owner, geometry: { kind: 'rect', x: 90, y: 10, width: 35, height: 70 }, paint: { fill: '#fff' } })
    const group = factory.group({ id: 'cover', role: 'node', owner, open: '<g data-id="cover">', close: '</g>', children: [{ node: artwork, indent: 2 }] })
    owner.id = 'different'
    return { ...header, parts: [open, group, factory.documentClose()] }
  }
  const drawing = drawNative(producer, context, 'flowchart')
  expect(scanSvgStartTags(drawing.svg).some(tag => tag.name === 'g' && tag.attributes.some(attribute => attribute.name === 'data-id' && attribute.value === 'cover'))).toBe(true)
  const proof = certifyNativePaint(drawing.header, drawing.paint)
  if (proof.status === 'passed') {
    const artwork = drawing.paint.primitives.find(primitive => primitive.id === 'cover-artwork')!
    expect(artwork.owner).toEqual({ id: 'cover', role: 'node' })
  } else expect(proof.status).toBe('unverified')
})

test.each(['after-drawing', 'after-document-open'] as const)('native actual stylesheet cannot be replaced by palette mutation %s', when => {
  const colors = { bg: '#fff', fg: '#111', surface: '#fff' }
  const marker = tipAnchoredArrow('palette-arrow', { width: 8, height: 5 }, 'end', { fill: '#000' }, 'userSpaceOnUse')
  const context = { positioned: { width: 200, height: 100 }, colors, resolved: { renderOptions: {} } }
  const producer: DrawingProducer = factory => {
    const open = factory.documentOpen({ id: 'root', width: 200, height: 100, colors, transparent: false, font: 'Inter', hasMonoFont: false }, '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" style="--bg:#fff;--fg:#111;--surface:#fff">')
    if (when === 'after-document-open') colors.surface = '#ffffff00'
    return { ...header, colors, parts: [open,
      factory.definitions({ id: 'markers' }, `<defs>${serializeMarkerResource(marker)}</defs>`),
      factory.connector({ id: 'edge', role: 'edge', lineStyle: 'solid', geometry: { kind: 'line', x1: 20, y1: 40, x2: 50, y2: 40 }, paint: { stroke: '#000' }, endpoints: { from: 'outside', to: 'cover' }, markers: { end: marker } }),
      factory.shape({ id: 'cover', role: 'node', geometry: { kind: 'rect', x: 40, y: 10, width: 35, height: 70 }, paint: { fill: 'var(--surface)' } }),
      factory.documentClose(),
    ] }
  }
  const drawing = drawNative(producer, context, 'flowchart')
  if (when === 'after-drawing') colors.surface = '#ffffff00'
  const tags = scanSvgStartTags(drawing.svg)
  const root = tags.find(tag => tag.name === 'svg')!
  expect(root.attributes.find(attribute => attribute.name === 'style')?.value).toBe('--bg:#fff;--fg:#111;--surface:#fff')
  const body = tags.find(tag => tag.name === 'rect' && tag.attributes.some(attribute => attribute.name === 'data-id' && attribute.value === 'cover'))!
  expect(Object.fromEntries(body.attributes.map(attribute => [attribute.name, attribute.value]))).toMatchObject({ x: '40', width: '35', fill: 'var(--surface)' })
  // The SAME emitted stylesheet still makes the covering body opaque white.
  expect(certifyNativePaint(drawing.header, drawing.paint).status).not.toBe('passed')
})

test.each([4_000, 50_000])('a clear admitted immutable native polyline retains final paint certification with %i points', pointCount => {
  const colors = Object.freeze({ bg: '#fff', fg: '#111' })
  const points = Array.from({ length: pointCount }, (_, index) => Object.freeze({ x: index + 40, y: 40 }))
  Object.freeze(points)
  const geometry = Object.freeze({ kind: 'polyline' as const, points })
  const fields = Object.freeze({ id: 'clear-polyline', role: 'chrome' as const, geometry, paint: Object.freeze({ fill: 'none', stroke: '#111', strokeWidth: '1' }) })
  const width = Math.max(5_000, pointCount + 80)
  const context = { positioned: { width, height: 100 }, colors, resolved: { renderOptions: {} } }
  const producer: DrawingProducer = factory => ({ ...header, width, colors, parts: [
    factory.documentOpen({ id: 'root', width, height: 100, colors, transparent: false, font: 'Inter', hasMonoFont: false }, `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="100">`),
    factory.shape(fields),
    factory.documentClose(),
  ] })
  const drawing = drawNative(producer, context, 'flowchart')
  const polyline = scanSvgStartTags(drawing.svg).find(tag => tag.name === 'polyline')!
  const attributes = Object.fromEntries(polyline.attributes.map(attribute => [attribute.name, attribute.value]))
  expect(attributes).toMatchObject({ fill: 'none', stroke: '#111', 'stroke-width': '1' })
  expect(attributes.points!.trim().split(/\s+/)).toHaveLength(pointCount)
  expect(Object.isFrozen(points) && points.every(point => Object.isFrozen(point))).toBe(true)
  const proof = certifyNativePaint(drawing.header, drawing.paint)
  expect(proof.status, JSON.stringify(proof.issues)).toBe('passed')
})

test.each(['different-viewport', 'transparent-root'] as const)('native paint cannot certify unsupported emitted root context for %s', mode => {
  const marker = tipAnchoredArrow('viewport-custody-arrow', { width: 8, height: 5 }, 'end', { fill: '#000' }, 'userSpaceOnUse')
  const context = { positioned: { width: 200, height: 100 }, colors: header.colors, resolved: { renderOptions: {} } }
  const producer: DrawingProducer = factory => ({ ...header, parts: [
    factory.documentOpen({ id: 'root', width: 200, height: 100, colors: header.colors, transparent: false, font: 'Inter', hasMonoFont: false }, mode === 'different-viewport'
      ? '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="100">'
      : '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" opacity="0">'),
    factory.definitions({ id: 'markers' }, `<defs>${serializeMarkerResource(marker)}</defs>`),
    factory.connector({ id: 'edge', role: 'edge', lineStyle: 'solid', geometry: { kind: 'line', x1: 20, y1: 40, x2: 50, y2: 40 }, paint: { stroke: '#000' }, endpoints: { from: 'outside', to: 'cover' }, markers: { end: marker } }),
    factory.shape({ id: 'cover', role: 'node', geometry: { kind: 'rect', x: 90, y: 10, width: 35, height: 70 }, paint: { fill: '#fff' } }),
    factory.documentClose(),
  ] })
  const drawing = drawNative(producer, context, 'flowchart')
  const root = scanSvgStartTags(drawing.svg).find(tag => tag.name === 'svg')!
  expect(Object.fromEntries(root.attributes.map(attribute => [attribute.name, attribute.value]))).toMatchObject(mode === 'different-viewport' ? { width: '30', height: '100' } : { width: '200', height: '100', opacity: '0' })
  expect(root.attributes.some(attribute => attribute.name === 'viewBox')).toBe(false)
  // The narrow standalone viewport clips the marker's x42..50 fill; opacity0
  // instead hides it inside a matching viewport. Neither emitted root is
  // described by the typed 200px opaque canvas used for paint checking.
  expect(certifyNativePaint(drawing.header, drawing.paint).status).not.toBe('passed')
})

test('native paint inspects the same document occurrence roster that it emits', () => {
  const marker = tipAnchoredArrow('roster-arrow', { width: 8, height: 5 }, 'end', { fill: '#000' }, 'userSpaceOnUse')
  const context = { positioned: { width: 200, height: 100 }, colors: header.colors, resolved: { renderOptions: {} } }
  const producer: DrawingProducer = factory => {
    const open = factory.documentOpen({ id: 'root', width: 200, height: 100, colors: header.colors, transparent: false, font: 'Inter', hasMonoFont: false }, '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">')
    const definitions = factory.definitions({ id: 'markers' }, `<defs>${serializeMarkerResource(marker)}</defs>`)
    const edge = factory.connector({ id: 'edge', role: 'edge', lineStyle: 'solid', geometry: { kind: 'line', x1: 20, y1: 40, x2: 50, y2: 40 }, paint: { stroke: '#000' }, endpoints: { from: 'outside', to: 'cover' }, markers: { end: marker } })
    const cover = factory.shape({ id: 'cover', role: 'node', geometry: { kind: 'rect', x: 40, y: 10, width: 35, height: 70 }, paint: { fill: '#fff' } })
    const clear = factory.shape({ id: 'other', role: 'node', geometry: { kind: 'rect', x: 90, y: 10, width: 35, height: 70 }, paint: { fill: '#fff' } })
    const close = factory.documentClose()
    const coveredParts = [open, definitions, edge, cover, close]
    const clearParts = [open, definitions, edge, clear, close]
    let reads = 0
    return { ...header, get parts() { return ++reads <= 2 ? coveredParts : clearParts } }
  }
  const drawing = drawNative(producer, context, 'flowchart')
  const cover = scanSvgStartTags(drawing.svg).find(tag => tag.name === 'rect' && tag.attributes.some(attribute => attribute.name === 'data-id' && attribute.value === 'cover'))!
  expect(cover).toBeDefined()
  expect(Object.fromEntries(cover.attributes.map(attribute => [attribute.name, attribute.value]))).toMatchObject({ x: '40', width: '35', fill: '#fff' })
  // This emitted occurrence covers the complete black marker. Inspecting a
  // different fragment returned by a later roster read cannot certify it.
  expect(certifyNativePaint(drawing.header, drawing.paint).status).not.toBe('passed')
})

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
